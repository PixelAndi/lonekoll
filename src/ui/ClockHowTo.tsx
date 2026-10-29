import { useApp } from '../app-context.ts';
import { isoWeekday, type LocalDate } from '../domain/time.ts';

// An animated sketch of the time clock's date bar, showing which button pages
// to another day: a finger taps "‹‹ Föreg Dag" (or "Nästa Dag ››") and the
// date on the bar changes. The clock's own Swedish labels are kept, since
// that is what the user sees on the screen.

const CLOCK_WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];

/** The date the way the clock shows it, e.g. "Tor 2026-10-29". */
const clockDate = (date: LocalDate) => `${CLOCK_WEEKDAYS[isoWeekday(date) - 1]} ${date}`;

/** `compact`: the sketch and one line, small enough to leave the camera view free while aiming. */
export function ClockHowTo({ from, to, direction, compact = false }: { from: LocalDate; to: LocalDate; direction: 'previous' | 'next'; compact?: boolean }) {
  const { t, fmt } = useApp();
  const previous = direction === 'previous';
  // The button sits at the left (Föreg Dag) or right (Nästa Dag) end of the bar.
  const buttonX = previous ? 62 : 258;
  return (
    <figure className={compact ? 'howto howto-compact' : 'howto'}>
      <svg viewBox="0 0 320 150" className={`howto-clock ${previous ? 'howto-previous' : 'howto-next'}`} role="img" aria-label={t('howto.title')}>
        {/* The clock and its screen. */}
        <rect x="4" y="4" width="312" height="142" rx="14" className="howto-case" />
        <rect x="16" y="16" width="288" height="118" rx="6" className="howto-screen" />
        {/* Date bar with the two paging buttons. */}
        <rect x="24" y="48" width="272" height="22" className="howto-bar" />
        <rect x={buttonX - 34} y="49" width="68" height="20" rx="4" className="howto-button" />
        <text x="62" y="63" className="howto-bar-text" textAnchor="middle">
          ‹‹ Föreg Dag
        </text>
        <text x="258" y="63" className="howto-bar-text" textAnchor="middle">
          Nästa Dag ››
        </text>
        <text x="160" y="63" className="howto-bar-text howto-date howto-date-from" textAnchor="middle">
          {clockDate(from)}
        </text>
        <text x="160" y="63" className="howto-bar-text howto-date howto-date-to" textAnchor="middle">
          {clockDate(to)}
        </text>
        {/* Header and stamp rows, as faint lines. */}
        <rect x="24" y="71" width="272" height="14" className="howto-header" />
        {[96, 112].map((y) => (
          <g key={y} className="howto-row">
            <rect x="130" y={y - 6} width="34" height="7" rx="2" />
            <rect x="200" y={y - 6} width="34" height="7" rx="2" />
          </g>
        ))}
        {/* The tap: a ring where the finger presses, and the finger. */}
        <circle cx={buttonX} cy="59" r="14" className="howto-ripple" />
        <g className="howto-finger" style={{ transformOrigin: `${buttonX}px 59px` }}>
          <path
            transform={`translate(${buttonX - 9} 58)`}
            d="M9 0c2 0 3.5 1.5 3.5 3.5V16l7-1c2.5-.3 4.5 1.6 4.5 4v4c0 1-.2 2-.6 3l-3.4 8H6l-6-9c-1-1.5-.6-3.4.9-4.3 1.2-.8 2.8-.6 3.8.4l.8.8V3.5C5.5 1.5 7 0 9 0Z"
          />
        </g>
      </svg>
      {compact ? (
        <figcaption>{t(previous ? 'howto.compactPrevious' : 'howto.compactNext', { date: fmt.date(to) })}</figcaption>
      ) : (
        <figcaption>
          <strong>{t('howto.title')}</strong>
          <ol>
            <li>{t(previous ? 'howto.stepPrevious' : 'howto.stepNext')}</li>
            <li>{t('howto.stepDate', { date: fmt.date(to) })}</li>
            <li>{t('howto.stepScan')}</li>
          </ol>
        </figcaption>
      )}
    </figure>
  );
}
