import { useApp } from '../app-context.ts';
import { TARGET_WIDTH, type Aim, type Hint } from '../ocr/live.ts';

// The scanner's guide: one frame showing where the clock's table should go,
// with a faint sketch of the table in it until the real one is found (the
// date bar with "Föreg Dag" and "Nästa Dag", then the In and Ut times), so it
// is plain what to line up with what. One big arrow shows which way to move the phone when that's what is
// needed; the frame turns green when the table is in place, and a check mark
// shows when the times are read. The words of the instruction are in the
// status line (Scanner).

export type HudState = 'searching' | 'adjusting' | 'locked' | 'grabbed' | 'idle';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The table is about 23.5 bar heights wide and 5.5 high, its date bar on top. */
const TABLE_ASPECT = 5.5 / 23.5;
const BAR_SHARE = 1 / 5.5;
/** Where things are on the clock's table, as shares of its width (see parse.ts and pipeline.ts). */
const FOREG_AT = 0.101;
const DATE_AT = 0.55;
const NASTA_AT = 0.751;
const IN_AT = 0.475;
const OUT_AT = 0.69;

export function ScannerHud({
  frame,
  area,
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
  // The table's place: centred in the search area (as live.ts aims for).
  const tw = area.width * TARGET_WIDTH;
  const th = tw * TABLE_ASPECT;
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  const table = { left: cx - tw / 2, top: cy - th / 2, width: tw, height: th };
  const unit = Math.min(frame.width, frame.height) / 100;
  // The frame leaves a little room around the table.
  const pad = th * 0.25;
  const box = { left: table.left - pad, top: table.top - pad, width: tw + pad * 2, height: th + pad * 2 };
  const radius = 2.5 * unit;
  const bar = th * BAR_SHARE;
  const font = bar * 0.62;
  const at = (share: number) => table.left + tw * share;

  // One big arrow beside the frame, pointing the way to move the phone.
  const arrowSize = 9 * unit;
  const arrow =
    hint === 'left' || hint === 'right' || hint === 'up' || hint === 'down'
      ? {
          left: { x: box.left - arrowSize * 0.9, y: cy, deg: 180 },
          right: { x: box.left + box.width + arrowSize * 0.9, y: cy, deg: 0 },
          up: { x: cx, y: box.top - arrowSize * 0.9, deg: -90 },
          down: { x: cx, y: box.top + box.height + arrowSize * 0.9, deg: 90 },
        }[hint]
      : null;

  const green = state === 'locked' || state === 'grabbed';
  return (
    <svg className={`hud hud-${state}`} viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <mask id="hud-cutout">
          <rect width={frame.width} height={frame.height} fill="white" />
          <rect x={box.left} y={box.top} width={box.width} height={box.height} rx={radius} fill="black" />
        </mask>
      </defs>
      <rect width={frame.width} height={frame.height} className="hud-dim" mask="url(#hud-cutout)" />

      {/* What to fit in the frame: a sketch of the clock's table, until the real one is found. */}
      {(state === 'searching' || state === 'idle') && (
        <g className="hud-sketch">
          <rect x={table.left} y={table.top} width={tw} height={bar} rx={bar * 0.15} className="hud-sketch-bar" />
          <text x={at(FOREG_AT)} y={table.top + bar * 0.68} fontSize={font}>
            ‹‹ Föreg Dag
          </text>
          <text x={at(DATE_AT)} y={table.top + bar * 0.68} fontSize={font} textAnchor="middle">
            {t('hud.sketchDate')}
          </text>
          <text x={at(NASTA_AT)} y={table.top + bar * 0.68} fontSize={font}>
            Nästa Dag ››
          </text>
          <text x={at(IN_AT)} y={table.top + bar * 1.75} fontSize={font * 0.9} textAnchor="middle">
            In
          </text>
          <text x={at(OUT_AT)} y={table.top + bar * 1.75} fontSize={font * 0.9} textAnchor="middle">
            Ut
          </text>
          {[2.9, 4.1].map((row) => (
            <g key={row}>
              <text x={at(IN_AT)} y={table.top + bar * row} fontSize={font} textAnchor="middle">
                00:00
              </text>
              <text x={at(OUT_AT)} y={table.top + bar * row} fontSize={font} textAnchor="middle">
                00:00
              </text>
            </g>
          ))}
        </g>
      )}

      {/* The frame: white while aiming, green when the table is in place. */}
      <rect x={box.left} y={box.top} width={box.width} height={box.height} rx={radius} className="hud-frame" />
      {state === 'searching' && (
        <text x={cx} y={box.top - 2.5 * unit} fontSize={3.4 * unit} textAnchor="middle" className="hud-caption">
          {t('hud.fit')}
        </text>
      )}

      {/* How far the reading has come, under the frame. */}
      {green && (
        <g className="hud-progress">
          <rect x={box.left} y={box.top + box.height + 2 * unit} width={box.width} height={1.2 * unit} rx={0.6 * unit} className="hud-progress-track" />
          <rect
            x={box.left}
            y={box.top + box.height + 2 * unit}
            width={(box.width * Math.min(3, Math.max(state === 'grabbed' ? 3 : 1, progress))) / 3}
            height={1.2 * unit}
            rx={0.6 * unit}
            className="hud-progress-fill"
          />
        </g>
      )}

      {arrow && (
        <g className="hud-arrow" transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.deg}) scale(${arrowSize / 20})`}>
          <path d="M-9 -6 H2 V-12 L12 0 L2 12 V6 H-9 Z" />
        </g>
      )}

      {state === 'grabbed' && (
        <>
          <rect width={frame.width} height={frame.height} className="hud-flash" />
          <g className="scanner-check" transform={`translate(${cx} ${cy}) scale(${Math.min(th * 0.45, 12 * unit) / 34})`}>
            <circle r="34" />
            <path d="M-15 1 -4 12 17 -11" />
          </g>
        </>
      )}
    </svg>
  );
}
