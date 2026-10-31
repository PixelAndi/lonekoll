import type { ReactNode } from 'react';

// Pictures for the guide steps: simple sketches of the clock and the app, in
// the app's colours (so they follow light and dark), and without words, so
// they work in every language. The clock's own Swedish labels are kept, as
// that is what is on the screen.

export type ArtName =
  | 'scan1'
  | 'scan2'
  | 'scan3'
  | 'scan4'
  | 'slips1'
  | 'slips2'
  | 'slips3'
  | 'slips4'
  | 'komp1'
  | 'komp2'
  | 'komp3'
  | 'komp4'
  | 'vacation1'
  | 'vacation2'
  | 'vacation3'
  | 'vacation4'
  | 'offline'
  | 'install'
  | 'privacy';

export function GuideArt({ name, label }: { name: ArtName; label?: string }) {
  return (
    <svg className="guide-art" viewBox="0 0 160 110" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} direction="ltr">
      {ART[name]}
    </svg>
  );
}

/** A phone, its screen's content drawn inside (x from 48 to 112). */
const Phone = ({ children }: { children?: ReactNode }) => (
  <>
    <rect className="art-frame" x="44" y="3" width="72" height="104" rx="10" />
    <rect className="art-soft" x="49" y="12" width="62" height="86" rx="3" />
    {children}
  </>
);

/** The time clock's table: date strip with the day buttons, column names, rows of times. */
const ClockTable = ({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <rect className="clock-screen" x="0" y="0" width="140" height="70" rx="5" />
    <rect className="clock-head" x="8" y="7" width="124" height="13" rx="2" />
    <text className="clock-head-text" x="12" y="17">
      « Föreg Dag
    </text>
    <text className="clock-head-text" x="128" y="17" textAnchor="end">
      Nästa Dag »
    </text>
    <rect className="clock-sub" x="8" y="22" width="124" height="7" rx="1" />
    {[38, 50, 62].map((ty) => (
      <g key={ty}>
        <rect className="clock-time" x="30" y={ty - 5} width="20" height="5" rx="1" />
        <rect className="clock-time" x="76" y={ty - 5} width="20" height="5" rx="1" />
      </g>
    ))}
  </g>
);

const Check = ({ x, y, r = 9 }: { x: number; y: number; r?: number }) => (
  <g>
    <circle className="art-ok" cx={x} cy={y} r={r} />
    <path className="art-mark" d={`M${x - r * 0.45} ${y} l${r * 0.3} ${r * 0.35} l${r * 0.6} ${-r * 0.7}`} />
  </g>
);

const Cross = ({ x, y, r = 9 }: { x: number; y: number; r?: number }) => (
  <g>
    <circle className="art-bad" cx={x} cy={y} r={r} />
    <path className="art-mark" d={`M${x - r * 0.4} ${y - r * 0.4} l${r * 0.8} ${r * 0.8} M${x + r * 0.4} ${y - r * 0.4} l${-r * 0.8} ${r * 0.8}`} />
  </g>
);

/** A finger's tap: two rings. */
const Tap = ({ x, y }: { x: number; y: number }) => (
  <g className="art-tap">
    <circle cx={x} cy={y} r="5" />
    <circle cx={x} cy={y} r="11" />
  </g>
);

const ClockIcon = ({ x, y, r }: { x: number; y: number; r: number }) => (
  <g>
    <circle className="art-accent" cx={x} cy={y} r={r} />
    <path className="art-mark" d={`M${x} ${y - r * 0.6} V${y} L${x + r * 0.45} ${y + r * 0.3}`} />
  </g>
);

const Coins = ({ x, y, size = 1 }: { x: number; y: number; size?: number }) => (
  <g>
    {[0, 1, 2].map((i) => (
      <ellipse key={i} className="art-coin" cx={x} cy={y - i * 6 * size} rx={13 * size} ry={5 * size} />
    ))}
  </g>
);

const Sun = ({ x, y, r }: { x: number; y: number; r: number }) => (
  <g>
    {Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return <line key={i} className="art-sun-ray" x1={x + Math.cos(a) * r * 1.3} y1={y + Math.sin(a) * r * 1.3} x2={x + Math.cos(a) * r * 1.75} y2={y + Math.sin(a) * r * 1.75} />;
    })}
    <circle className="art-sun" cx={x} cy={y} r={r} />
  </g>
);

const Document = ({ x, y, w = 40, h = 52, lines = 4 }: { x: number; y: number; w?: number; h?: number; lines?: number }) => (
  <g>
    <path className="art-frame" d={`M${x} ${y} h${w - 10} l10 10 v${h - 10} h${-w} Z`} />
    {Array.from({ length: lines }, (_, i) => (
      <line key={i} className="art-line" x1={x + 6} y1={y + 18 + i * 8} x2={x + w - 8} y2={y + 18 + i * 8} />
    ))}
  </g>
);

/** Twelve months in a row; `filled` of them coloured (or the listed ones). */
const MonthBar = ({ x, y, w, filled }: { x: number; y: number; w: number; filled: number[] }) => {
  const cell = w / 12;
  return (
    <g>
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} className={filled.includes(i) ? 'art-ok' : 'art-empty'} x={x + i * cell} y={y} width={cell - 2} height="16" rx="3" />
      ))}
    </g>
  );
};

const Calendar = ({ x, y, children }: { x: number; y: number; children?: ReactNode }) => (
  <g>
    <rect className="art-frame" x={x} y={y} width="84" height="74" rx="6" />
    <rect className="art-accent" x={x} y={y} width="84" height="16" rx="6" />
    <rect className="art-accent" x={x} y={y + 8} width="84" height="8" />
    {Array.from({ length: 15 }, (_, i) => (
      <rect key={i} className="art-empty" x={x + 6 + (i % 5) * 15.5} y={y + 22 + Math.floor(i / 5) * 16} width="12" height="12" rx="2" />
    ))}
    {children}
  </g>
);

const ART: Record<ArtName, ReactNode> = {
  // Scanning: pick the day on the clock, open the camera, fit the table in the frame, hold still and save.
  scan1: (
    <>
      <ClockTable x={10} y={24} />
      {/* The date strip with the day buttons. */}
      <rect className="art-ring" x="14" y="27" width="132" height="21" rx="4" />
      <Tap x={136} y={58} />
    </>
  ),
  scan2: (
    <Phone>
      {[22, 34, 46].map((ly) => (
        <line key={ly} className="art-line" x1="56" y1={ly} x2="104" y2={ly} />
      ))}
      <circle className="art-accent" cx="80" cy="74" r="12" />
      <rect className="art-on-accent" x="73" y="70" width="14" height="9" rx="2" />
      <circle className="art-accent" cx="80" cy="74.5" r="2.6" />
      <Tap x={94} y={90} />
    </Phone>
  ),
  scan3: (
    <Phone>
      <ClockTable x={54} y={36} scale={0.37} />
      <path className="art-ok-stroke" d="M52 32 v-6 h8 M108 32 v-6 h-8 M52 66 v6 h8 M108 66 v6 h-8" />
    </Phone>
  ),
  scan4: (
    <Phone>
      <rect className="art-empty" x="54" y="18" width="52" height="6" rx="3" />
      <rect className="art-ok" x="54" y="18" width="52" height="6" rx="3" />
      {[36, 48, 60].map((ly) => (
        <g key={ly}>
          <rect className="art-ink" x="56" y={ly - 4} width="18" height="6" rx="1" />
          <rect className="art-ink" x="84" y={ly - 4} width="18" height="6" rx="1" />
        </g>
      ))}
      <rect className="art-accent" x="56" y="74" width="48" height="14" rx="7" />
      <path className="art-mark-on-accent" d="M73 81 l4 4 l9 -8" />
    </Phone>
  ),

  // Pay slips: enter the pay, import the PDF, read the rows, follow the rule or save a report.
  slips1: (
    <Phone>
      <circle className="art-ink" cx="80" cy="30" r="9" />
      <circle className="art-soft" cx="80" cy="30" r="4" />
      <rect className="art-frame" x="56" y="50" width="48" height="16" rx="4" />
      <text className="art-text" x="98" y="61" textAnchor="end">
        kr
      </text>
      <line className="art-accent-stroke" x1="58" y1="70" x2="102" y2="70" />
      <line className="art-line" x1="56" y1="82" x2="96" y2="82" />
    </Phone>
  ),
  slips2: (
    <>
      <Document x={10} y={22} w={44} h={62} lines={5} />
      <rect className="art-bad" x="16" y="70" width="26" height="11" rx="2" />
      <text className="art-text-on-color" x="29" y="78.5" textAnchor="middle">
        PDF
      </text>
      <path className="art-arrow" d="M62 54 h22 m-7 -7 l7 7 l-7 7" />
      <g transform="translate(46 0)">
        <Phone>
          <rect className="art-frame" x="58" y="40" width="44" height="30" rx="4" />
        </Phone>
      </g>
    </>
  ),
  slips3: (
    <Phone>
      {[24, 42, 60, 78].map((ly, i) => (
        <g key={ly}>
          <line className="art-line" x1="56" y1={ly} x2="88" y2={ly} />
          {i === 2 ? <Cross x={100} y={ly} r={6} /> : <Check x={100} y={ly} r={6} />}
        </g>
      ))}
    </Phone>
  ),
  slips4: (
    <>
      <rect className="art-frame" x="8" y="18" width="78" height="40" rx="6" />
      <line className="art-line" x1="16" y1="30" x2="70" y2="30" />
      <text className="art-link" x="16" y="49">
        § 3.3
      </text>
      <line className="art-accent-stroke" x1="16" y1="52" x2="46" y2="52" />
      <Document x={104} y={22} w={44} h={62} lines={5} />
      <Check x={142} y={82} r={9} />
    </>
  ),

  // Komp time: money or time, choose per day, take time off, see what is left.
  komp1: (
    <>
      <rect className="art-frame" x="10" y="25" width="140" height="60" rx="30" />
      <rect className="art-accent" x="80" y="29" width="66" height="52" rx="26" />
      <Coins x={45} y={66} />
      <ClockIcon x={113} y={55} r={17} />
    </>
  ),
  komp2: (
    <Phone>
      <line className="art-line" x1="56" y1="24" x2="104" y2="24" />
      <line className="art-line" x1="56" y1="36" x2="90" y2="36" />
      <rect className="art-frame" x="54" y="54" width="52" height="22" rx="11" />
      <rect className="art-accent" x="80" y="56" width="24" height="18" rx="9" />
      <Coins x={67} y={70} size={0.5} />
      <ClockIcon x={92} y={65} r={7} />
      <Tap x={96} y={74} />
    </Phone>
  ),
  komp3: (
    <Calendar x={38} y={18}>
      <rect className="art-accent" x={38 + 6 + 2 * 15.5} y={18 + 22 + 16} width="12" height="12" rx="2" />
      <ClockIcon x={126} y={30} r={16} />
    </Calendar>
  ),
  komp4: (
    <>
      <ClockIcon x={48} y={55} r={30} />
      <rect className="art-empty" x="92" y="44" width="56" height="22" rx="11" />
      <rect className="art-ok" x="92" y="44" width="34" height="22" rx="11" />
    </>
  ),

  // Vacation pay: a year's pay → vacation pay, a slip a month, all twelve, vacation days marked.
  vacation1: (
    <>
      <Coins x={30} y={66} />
      <MonthBar x={8} y={76} w={92} filled={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]} />
      <path className="art-arrow" d="M104 55 h16 m-7 -7 l7 7 l-7 7" />
      <Sun x={140} y={55} r={9} />
    </>
  ),
  vacation2: (
    <>
      <Document x={18} y={8} w={30} h={38} lines={2} />
      <Document x={66} y={8} w={30} h={38} lines={2} />
      <path className="art-arrow" d="M33 52 v10 m-5 -5 l5 5 l5 -5 M81 52 v10 m-5 -5 l5 5 l5 -5" />
      <MonthBar x={8} y={70} w={144} filled={[0, 2, 3, 6, 9]} />
    </>
  ),
  vacation3: (
    <>
      <Check x={80} y={34} r={16} />
      <MonthBar x={8} y={66} w={144} filled={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]} />
    </>
  ),
  vacation4: (
    <Calendar x={38} y={18}>
      {[5, 6, 7, 8, 9].map((i) => (
        <rect key={i} className="art-sun-cell" x={38 + 6 + (i % 5) * 15.5} y={18 + 22 + Math.floor(i / 5) * 16} width="12" height="12" rx="2" />
      ))}
      <Sun x={128} y={28} r={9} />
    </Calendar>
  ),

  // The app: offline, on the home screen, private.
  offline: (
    <Phone>
      <path className="art-cloud" d="M64 44 a9 9 0 0 1 9 -9 a11 11 0 0 1 21 3 a7 7 0 0 1 2 14 h-26 a6 6 0 0 1 -6 -8 Z" />
      <line className="art-bad-stroke" x1="60" y1="60" x2="100" y2="30" />
      <Check x={80} y={80} r={9} />
    </Phone>
  ),
  install: (
    <Phone>
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} className={i === 4 ? 'art-accent' : 'art-empty'} x={56 + (i % 3) * 17} y={22 + Math.floor(i / 3) * 20} width="13" height="13" rx="3" />
      ))}
      <Tap x={80} y={48} />
    </Phone>
  ),
  privacy: (
    <>
      <Phone>
        <rect className="art-accent" x="68" y="50" width="24" height="20" rx="3" />
        <path className="art-accent-stroke" d="M72 50 v-6 a8 8 0 0 1 16 0 v6" />
      </Phone>
      <path className="art-arrow" d="M122 55 h26 m-7 -7 l7 7 l-7 7" />
      <line className="art-bad-stroke" x1="126" y1="68" x2="146" y2="42" />
    </>
  ),
};
