import { useApp } from '../app-context.ts';
import type { Aim } from '../ocr/pageFind.ts';

// The pay slip scanner's guide, like the clock scanner's (ScannerHud): the
// screen dimmed around one upright frame, a faint sketch of a pay slip in it
// until a page is found (title, period, the table's columns, the grey bar
// with the payout at the bottom), one big arrow when the phone should move,
// the frame green when the slip is in place, a flash and a check mark when
// the picture is taken, and a bar under the frame while slips are read.
// Drawn in screen pixels over the video (shown with object-fit: cover).

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type SlipHudState = 'searching' | 'aiming' | 'ready' | 'grabbed';

export function SlipHud({ view, frame, page, state, hint, reading }: { view: { w: number; h: number }; frame: Box; page: Box | null; state: SlipHudState; hint: Aim | null; reading: boolean }) {
  const { t } = useApp();
  const unit = Math.min(view.w, view.h) / 100;
  const radius = 2 * unit;
  const { left: x, top: y, width: w, height: h } = frame;
  const cx = x + w / 2;
  const cy = y + h / 2;
  // The sketch: where things are on the employer's slips, as shares of the page.
  const row = (share: number) => y + h * share;
  const font = Math.max(9, w * 0.045);
  const columns = [0.08, 0.3, 0.55, 0.7, 0.86];
  const arrowSize = 10 * unit;
  const arrow =
    hint === 'left' || hint === 'right' || hint === 'up' || hint === 'down'
      ? {
          left: { x: x + arrowSize * 0.9, y: cy, deg: 180 },
          right: { x: x + w - arrowSize * 0.9, y: cy, deg: 0 },
          up: { x: cx, y: y + arrowSize * 0.9, deg: -90 },
          down: { x: cx, y: y + h - arrowSize * 0.9, deg: 90 },
        }[hint]
      : null;
  const green = state === 'ready' || state === 'grabbed';
  return (
    <svg className={`hud ${green ? 'hud-locked' : ''}`} viewBox={`0 0 ${view.w} ${view.h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <mask id="slip-hud-cutout">
          <rect width={view.w} height={view.h} fill="white" />
          <rect x={x} y={y} width={w} height={h} rx={radius} fill="black" />
        </mask>
      </defs>
      <rect width={view.w} height={view.h} className="hud-dim" mask="url(#slip-hud-cutout)" />

      {state === 'searching' && (
        <g className="hud-sketch">
          <text x={x + w * 0.06} y={row(0.07)} fontSize={font * 1.3}>
            {t('slipHud.title')}
          </text>
          <text x={x + w * 0.06} y={row(0.13)} fontSize={font * 0.85}>
            {t('slipHud.period')}
          </text>
          <rect x={x + w * 0.04} y={row(0.2)} width={w * 0.92} height={h * 0.035} rx={2} className="hud-sketch-bar" />
          {columns.map((c, i) => (
            <rect key={c} x={x + w * c} y={row(0.209)} width={w * (i === 1 ? 0.18 : 0.08)} height={h * 0.012} rx={1} fill="currentColor" opacity={0.7} />
          ))}
          {[0.27, 0.31, 0.35, 0.39, 0.43, 0.47].map((r) => (
            <g key={r} opacity={0.45}>
              {columns.map((c, i) => (
                <rect key={c} x={x + w * c} y={row(r)} width={w * (i === 1 ? 0.2 : 0.07)} height={h * 0.008} rx={1} />
              ))}
            </g>
          ))}
          <rect x={x + w * 0.04} y={row(0.84)} width={w * 0.92} height={h * 0.05} rx={2} className="hud-sketch-bar" />
          <text x={x + w * 0.06} y={row(0.874)} fontSize={font * 0.85}>
            {t('slipHud.payout')}
          </text>
        </g>
      )}

      {/* What was found: a thin line around the print, so it is plain what the camera sees. */}
      {page && state !== 'grabbed' && <rect x={page.left} y={page.top} width={page.width} height={page.height} rx={radius / 2} className="slip-hud-page" />}

      <rect x={x} y={y} width={w} height={h} rx={radius} className="hud-frame" />
      {state === 'searching' && (
        <text x={cx} y={Math.max(4 * unit, y - 2 * unit)} fontSize={3.6 * unit} textAnchor="middle" className="hud-caption">
          {t('slipHud.fit')}
        </text>
      )}

      {reading && (
        <g className="hud-progress">
          <rect x={x} y={y + h + 1.5 * unit} width={w} height={1.2 * unit} rx={0.6 * unit} className="hud-progress-track" />
          <rect x={x} y={y + h + 1.5 * unit} width={w} height={1.2 * unit} rx={0.6 * unit} className="hud-progress-fill slip-hud-busy" />
        </g>
      )}

      {arrow && (
        <g className="hud-arrow" transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.deg}) scale(${arrowSize / 20})`}>
          <path d="M-9 -6 H2 V-12 L12 0 L2 12 V6 H-9 Z" />
        </g>
      )}

      {state === 'grabbed' && (
        <>
          <rect width={view.w} height={view.h} className="hud-flash" />
          <g className="scanner-check" transform={`translate(${cx} ${cy}) scale(${(12 * unit) / 34})`}>
            <circle r="34" />
            <path d="M-15 1 -4 12 17 -11" />
          </g>
        </>
      )}
    </svg>
  );
}
