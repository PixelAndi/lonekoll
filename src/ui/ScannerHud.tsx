import { useApp } from '../app-context.ts';
import { TARGET_WIDTH, type Aim, type Hint } from '../ocr/live.ts';

// The scanner's targeting display: a target reticle in the middle, a tracker
// that follows the table where it was found (gliding between readings), a
// guide line with an arrow showing which way to move the phone, chevrons for
// closer / further, a turn arrow for tilt, and the lock-on with a ring that
// fills while the reading is confirmed.

export type HudState = 'searching' | 'adjusting' | 'locked' | 'grabbed' | 'idle';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The table is about 23.5 bar heights wide and 5.5 high. */
const TABLE_ASPECT = 5.5 / 23.5;

export function ScannerHud({
  frame,
  area,
  toFrame,
  aim,
  hint,
  state,
  progress,
}: {
  frame: { width: number; height: number };
  /** The search area in frame pixels. */
  area: Box;
  /** Search-area image pixels → frame pixels. */
  toFrame: number;
  aim: Aim | null;
  hint: Hint | null;
  state: HudState;
  /** 0–3: how far the confirmation has come. */
  progress: number;
}) {
  const { t } = useApp();
  // The target: the table centred in the search area.
  const tw = area.width * TARGET_WIDTH;
  const th = tw * TABLE_ASPECT;
  const tx = area.left + area.width / 2;
  const ty = area.top + area.height / 2;
  const target = { left: tx - tw / 2, top: ty - th / 2, width: tw, height: th };
  const unit = Math.min(frame.width, frame.height) / 100;

  // The tracker, in frame pixels.
  const tracker = aim && {
    x: area.left + aim.table.cx * toFrame,
    y: area.top + aim.table.cy * toFrame,
    w: aim.table.width * toFrame,
    h: aim.table.height * toFrame,
    deg: (aim.table.angle * 180) / Math.PI,
  };
  const on = state === 'locked' || state === 'grabbed';

  // Corner brackets of a box, with arms of length `arm`.
  const brackets = (b: Box, arm: number) =>
    [
      [b.left, b.top, 1, 1],
      [b.left + b.width, b.top, -1, 1],
      [b.left, b.top + b.height, 1, -1],
      [b.left + b.width, b.top + b.height, -1, -1],
    ]
      .map(([x, y, sx, sy]) => `M${x} ${y + sy * arm} V${y} H${x + sx * arm}`)
      .join(' ');

  // Closer: chevrons at the target's corners pointing out; further: pointing in.
  const zoom = hint === 'closer' ? 1 : hint === 'further' ? -1 : 0;
  const chevrons =
    zoom &&
    [
      [target.left, target.top, -1, -1],
      [target.left + target.width, target.top, 1, -1],
      [target.left, target.top + target.height, -1, 1],
      [target.left + target.width, target.top + target.height, 1, 1],
    ]
      .map(([x, y, sx, sy]) => {
        const d = 4 * unit;
        // The chevron's tip points out (closer) or in (further).
        const tipX = x + sx * d * (zoom > 0 ? 1.6 : 0.4);
        const tipY = y + sy * d * (zoom > 0 ? 1.6 : 0.4);
        const back = zoom > 0 ? -1 : 1;
        return `M${tipX + back * sx * d} ${tipY} L${tipX} ${tipY} L${tipX} ${tipY + back * sy * d}`;
      })
      .join(' ');

  // Move: a line from the target to the table, with an arrow at the table end.
  const move = tracker && ['up', 'down', 'left', 'right'].includes(hint ?? '');
  const arrow = (() => {
    if (!move || !tracker) return null;
    const dx = tracker.x - tx;
    const dy = tracker.y - ty;
    const len = Math.hypot(dx, dy);
    if (len < unit * 3) return null;
    const ux = dx / len;
    const uy = dy / len;
    const end = { x: tx + dx * 0.85, y: ty + dy * 0.85 };
    const head = 3.5 * unit;
    return {
      line: `M${tx} ${ty} L${end.x} ${end.y}`,
      head: `M${end.x - ux * head - uy * head * 0.7} ${end.y - uy * head + ux * head * 0.7} L${end.x} ${end.y} L${end.x - ux * head + uy * head * 0.7} ${end.y - uy * head - ux * head * 0.7}`,
    };
  })();

  // Turn: an arc over the target with an arrow, clockwise when the table's right side is low.
  const turn = hint === 'straighten' && aim ? (aim.angle > 0 ? 1 : -1) : 0;
  const arcR = th * 0.9;
  const turnPath = turn
    ? `M${tx - arcR * 0.8} ${ty - arcR * 0.6} A${arcR} ${arcR} 0 0 1 ${tx + arcR * 0.8} ${ty - arcR * 0.6}`
    : '';

  // The lock ring sits at the target's top right, clear of the text being read.
  const ringR = 3.2 * unit;
  const ringC = 2 * Math.PI * ringR;
  const ringX = target.left + target.width - ringR;
  const ringY = target.top - ringR - 1.6 * unit;
  const label =
    state === 'searching' ? t('hud.searching') : state === 'adjusting' ? t('hud.adjusting') : state === 'locked' ? t('hud.locked') : state === 'grabbed' ? t('hud.grabbed') : '';

  return (
    <svg className={`hud hud-${state}`} viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <mask id="hud-cutout">
          <rect width={frame.width} height={frame.height} fill="white" />
          <rect x={area.left} y={area.top} width={area.width} height={area.height} rx={2 * unit} fill="black" />
        </mask>
        <linearGradient id="hud-sweep" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#7fd3ff" stopOpacity="0" />
          <stop offset="1" stopColor="#7fd3ff" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <rect width={frame.width} height={frame.height} className="hud-dim" mask="url(#hud-cutout)" />
      <path d={brackets(area, 7 * unit)} className="hud-area" />

      {/* Searching: a scan line sweeping the target. */}
      {state === 'searching' && (
        <g className="hud-sweep" style={{ ['--sweep' as string]: `${target.height + 8 * unit}px` }}>
          <rect x={target.left} y={target.top - 4 * unit} width={target.width} height={4 * unit} fill="url(#hud-sweep)" />
        </g>
      )}

      {/* The target. */}
      <path d={brackets(target, 3.5 * unit)} className="hud-target" />
      <path d={`M${tx - 2 * unit} ${ty} H${tx + 2 * unit} M${tx} ${ty - 2 * unit} V${ty + 2 * unit}`} className="hud-cross" />
      <text x={target.left} y={target.top - 1.6 * unit} className="hud-label" fontSize={2.6 * unit}>
        {label}
      </text>

      {/* The tracker: glides to where the table was found. */}
      {tracker && state !== 'grabbed' && (
        <g className="hud-tracker" style={{ transform: `translate(${tracker.x}px, ${tracker.y}px) rotate(${tracker.deg}deg)` }}>
          <g style={{ transform: `scale(${tracker.w}, ${tracker.h})` }} className="hud-tracker-box">
            <rect x={-0.5} y={-0.5} width={1} height={1} />
            <path d="M-0.5 -0.32 V-0.5 H-0.42 M0.42 -0.5 H0.5 V-0.32 M0.5 0.32 V0.5 H0.42 M-0.42 0.5 H-0.5 V0.32" />
          </g>
        </g>
      )}

      {arrow && (
        <g className="hud-move">
          <path d={arrow.line} className="hud-move-line" />
          <path d={arrow.head} className="hud-move-head" />
        </g>
      )}
      {chevrons && <path d={chevrons} className="hud-zoom" />}
      {turn !== 0 && (
        <g className="hud-turn" style={{ transform: turn < 0 ? `translate(${2 * tx}px, 0) scale(-1, 1)` : undefined }}>
          <path d={turnPath} />
          <path d={`M${tx + arcR * 0.8 - 2.5 * unit} ${ty - arcR * 0.6 - 2 * unit} L${tx + arcR * 0.8} ${ty - arcR * 0.6} L${tx + arcR * 0.8 - 3 * unit} ${ty - arcR * 0.6 + 1.5 * unit}`} />
        </g>
      )}

      {/* Lock-on: a ring that fills while the reading is confirmed. */}
      {on && (
        <g className="hud-ring">
          <circle cx={ringX} cy={ringY} r={ringR} className="hud-ring-track" />
          <circle
            cx={ringX}
            cy={ringY}
            r={ringR}
            className="hud-ring-fill"
            strokeDasharray={`${(ringC * Math.min(3, progress)) / 3} ${ringC}`}
            transform={`rotate(-90 ${ringX} ${ringY})`}
          />
        </g>
      )}
      {state === 'grabbed' && (
        <>
          <rect width={frame.width} height={frame.height} className="hud-flash" />
          <g className="scanner-check" transform={`translate(${tx} ${ty}) scale(${(th * 0.45) / 34})`}>
            <circle r="34" />
            <path d="M-15 1 -4 12 17 -11" />
          </g>
        </>
      )}
    </svg>
  );
}
