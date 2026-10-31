import { agreementFor, type ObLevel } from './agreement.ts';
import type { PayCategory, PeriodResult } from './calc.ts';
import type { Comparison, ComparisonRow, RowKey } from './compare.ts';
import type { DayRecord, Settings, StampPair } from './model.ts';
import { rowCertainty } from './reportCheck.ts';
import type { Source } from './sources.ts';
import { isHoliday } from './holidays.ts';
import { addDays, isoWeekday, type LocalDate } from './time.ts';

// The report's differences as numbered points an employer can go through one
// by one: what differs, a sum to check with a calculator, the days behind it,
// the rule quoted word for word, and either a correction asked for
// (Avvikelse) or a question (Fråga) when it may depend on a local agreement
// or an estimate.

/** A passage of the agreement, word for word as in the published PDF. */
export interface Quote {
  source: Source;
  section: string;
  text: string;
}

/**
 * Checked word for word against Livsmedelsavtalet 2025–2027 (the PDF linked in
 * sources.ts) when added. The agreement is in Swedish, so the quotes are too.
 */
const Q = {
  overtime: { source: 'agreement', section: '3.3', text: 'Med arbete på övertid avses arbete utöver det ordinarie arbetstidsmåttet per arbetspass för heltidsarbete.' },
  overtimePay: { source: 'bakery', section: '4', text: 'Tillägget är på vardagar 50% de två första timmarna, efter två timmar samt på sön- och helgdagar 100% på timlönen.' },
  sundayWindow: { source: 'bakery', section: '4', text: 'Söndagsdygn räknas från lördag kl. 11.00 till ordinarie arbetstidens början på måndagen.' },
  holidayWindow: { source: 'bakery', section: '4', text: 'Helgdagsdygnet räknas från kl. 18.00 dagen före helgdag till ordinarie arbetstidens början påföljande vardag.' },
  monthlyOvertime: {
    source: 'appendixF',
    section: '3',
    text: 'För övertidsarbete betalas dels lön per timme enligt punkt 1 i dessa riktlinjer dels övertidstillägg enligt respektive tilläggsavtal.',
  },
  obWithOvertime: { source: 'bakery', section: '2', text: 'OB måndag - söndag utgår samtidigt med övertidsersättning vid övertidsarbete.' },
  shiftedTime: {
    source: 'bakery',
    section: '3',
    text: 'Förskjuten tid är beordrad arbetstid som ligger utanför arbetstagarens ordinarie arbetstid men inom arbetstidsmåttet per arbetspass.',
  },
  shiftForm: {
    source: 'agreement',
    section: '4.4',
    text: 'Till tim- och prestationsavlönade arbetstagare betalas skiftformstillägg per arbetad timme beräknat på arbetstagarens genomsnittliga tim- och prestationslön.',
  },
  shiftFormOvertime: { source: 'agreement', section: '4.4', text: 'Tillägget betalas inte för arbetstimmar som arbetstagaren fått övertidsersättning för.' },
  holidayPay: {
    source: 'agreement',
    section: '5.1',
    text: 'Helglön betalas för det antal ordinarie arbetstimmar som arbetstagaren skulle ha arbetat om veckodagen inte varit helgdag eller fridag.',
  },
  holidayPayOb: {
    source: 'agreement',
    section: '5.1',
    text: 'I helglönen ingår också eventuella lönetillägg (exempelvis ob-tillägg) som skulle ha utgått, om veckodagen inte varit helgdag eller fridag.',
  },
  sickPay: { source: 'agreement', section: '5.2', text: 'Sjuklön regleras i lagen om sjuklön.' },
  monthlySick: {
    source: 'appendixF',
    section: '5.1',
    text: 'För sjukfrånvaro upp till 20 procent av genomsnittlig ordinarie veckoarbetstid i sjukperioden betalas ingen sjuklön',
  },
  vacationPay: { source: 'agreement', section: '5.7', text: 'Semesterlönen ska utgöra 13,2 % av semesterlöneunderlaget.' },
  vacationDeduction: {
    source: 'appendixF',
    section: '8',
    text: 'När arbetstagaren är frånvarande på grund av semester görs avdrag med 1/21,75 av månadslönen per semesterdag',
  },
  timebank: {
    source: 'appendixC',
    section: '5.3',
    text: 'Under betald ledighet betalas lön per timme som beräknas enligt följande. Beloppet på arbetstidskontot enligt punkt 2 divideras med antalet timmar för den anställde enligt punkt 5.1.',
  },
  komp: {
    source: 'agreement',
    section: '4.3',
    text: 'Övertidsarbete kompenseras med pengar eller efter överenskommelse med arbetstagaren med betald ledighet (kompensationsledighet).',
  },
} satisfies Record<string, Quote>;

export const QUOTES: Quote[] = Object.values(Q);

/** Why a point is a question rather than a correction asked for. */
export type QuestionReason = 'local-overtime' | 'estimate' | 'local-monthly' | 'slip-more' | 'only-on-slip';

/** One part of a point's sum: hours × rate = amount (owed to the employee when positive). */
export interface PointLine {
  key: RowKey;
  hours?: number;
  rate?: number;
  amount: number;
}

/** What a point's day table shows, in minutes per day. */
export type DayColumn = 'worked' | 'ob1' | 'ob2' | 'ob3' | 'ob4' | 'ot50' | 'ot100' | 'shiftedTime' | 'sick' | 'holiday' | 'absence';

export interface PointDay {
  date: LocalDate;
  stamps: StampPair[];
  /** Minutes per column, in the order of the point's columns. */
  minutes: number[];
  /** A photo of the clock was taken that day. */
  photo: boolean;
}

export interface ReportPoint {
  n: number;
  keys: RowKey[];
  kind: 'claim' | 'question';
  reason?: QuestionReason;
  /** Owed to the employee (positive) or paid more than calculated (negative). */
  amount: number;
  lines: PointLine[];
  columns: DayColumn[];
  days: PointDay[];
  quotes: Quote[];
  /** Table excerpts: the OB rates that apply (level and kr per hour). */
  obRates?: { level: ObLevel; rate: number; from: LocalDate }[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Rows that go together in one point. */
const GROUPS: RowKey[][] = [['ot50', 'ot100', 'otTotal'], ['sickPay', 'karens', 'sickDeduction']];
/** Totals and tax follow the other rows and get no point of their own. */
const NOT_POINTS = new Set<RowKey>(['gross', 'net', 'tax', 'taxTable', 'obTotal', 'vacationDays', 'timebankHours', 'kompEarned']);
const REVIEW = new Set(['diff', 'missing', 'extra', 'check']);

const COLUMNS: Partial<Record<RowKey, DayColumn[]>> = {
  wage: ['worked'],
  ob1: ['ob1'],
  ob2: ['ob2'],
  ob3: ['ob3'],
  ob4: ['ob4'],
  ot50: ['ot50', 'ot100'],
  shiftedTime: ['shiftedTime'],
  shiftForm: ['worked'],
  sickPay: ['sick'],
  holidayPay: ['holiday'],
  permission: ['absence'],
  kompPay: ['absence'],
  timebankPay: ['absence'],
};

function quotesFor(key: RowKey, monthly: boolean, period: PeriodResult): Quote[] {
  switch (key) {
    case 'ot50': {
      const quotes: Quote[] = [Q.overtime, Q.overtimePay];
      // The windows where overtime is +100 % from the start, when the period has overtime in them.
      const full = new Set<LocalDate>();
      for (const r of period.shifts) for (const [date, list] of r.byDate) if (list.some((b) => b.category === 'ot100')) full.add(date);
      const dates = [...full];
      if (dates.some((d) => [6, 7, 1].includes(isoWeekday(d)))) quotes.push(Q.sundayWindow);
      if (dates.some((d) => isHoliday(d) || isHoliday(addDays(d, 1)) || isHoliday(addDays(d, -1)))) quotes.push(Q.holidayWindow);
      if (monthly) quotes.push(Q.monthlyOvertime);
      return quotes;
    }
    case 'ob1':
    case 'ob2':
    case 'ob3':
    case 'ob4':
      return period.totals.ot50 || period.totals.ot100 ? [Q.obWithOvertime] : [];
    case 'shiftedTime':
      return [Q.shiftedTime];
    case 'shiftForm':
      return [Q.shiftForm, Q.shiftFormOvertime];
    case 'holidayPay':
      return [Q.holidayPay, Q.holidayPayOb];
    case 'sickPay':
      return monthly ? [Q.sickPay, Q.monthlySick] : [Q.sickPay];
    case 'vacationPay':
      return [Q.vacationPay];
    case 'vacationDeduction':
      return [Q.vacationDeduction];
    case 'timebankPay':
      return [Q.timebank];
    case 'kompPay':
      return [Q.komp];
    default:
      return [];
  }
}

/** Minutes of a column on each date in the period. */
function minutesByDate(column: DayColumn, period: PeriodResult, days: Map<LocalDate, DayRecord>): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  const add = (date: LocalDate, minutes: number) => {
    if (date < period.start || date > period.end || !minutes) return;
    out.set(date, (out.get(date) ?? 0) + minutes);
  };
  if (column === 'worked') {
    for (const r of period.shifts) for (const [date, m] of r.workedByDate) add(date, m);
  } else if (column === 'sick') {
    for (const d of period.sick?.days ?? []) add(d.date, d.lostMinutes);
  } else if (column === 'holiday') {
    for (const h of period.holidays) add(h.date, h.minutes);
  } else if (column === 'absence') {
    for (const [date, d] of days) if (d.absence?.hours) add(date, Math.round(d.absence.hours * 60));
  } else {
    const category = column as PayCategory;
    for (const r of period.shifts) for (const [date, list] of r.byDate) for (const b of list) if (b.category === category) add(date, b.minutes);
  }
  return out;
}

export function reportPoints(comparison: Comparison, period: PeriodResult, days: DayRecord[], settings: Settings): ReportPoint[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const monthly = !!period.totals.monthlySalary;
  const rows = comparison.rows.filter((r) => REVIEW.has(r.status) && !NOT_POINTS.has(r.key));
  const used = new Set<RowKey>();
  const points: ReportPoint[] = [];

  for (const row of rows) {
    if (used.has(row.key)) continue;
    const group = GROUPS.find((g) => g.includes(row.key));
    const members = group ? rows.filter((r) => group.includes(r.key)) : [row];
    members.forEach((r) => used.add(r.key));

    const lines = members.map((r) => pointLine(r, period));
    const amount = round2(lines.reduce((s, l) => s + l.amount, 0));
    const lead = group ? group[0] : row.key;

    // A question when it may depend on a local agreement or an estimate, or when the slip pays more.
    const certainties = members.map((r) => rowCertainty(r, period, settings));
    let reason: QuestionReason | undefined;
    if (members.every((r) => r.status === 'extra')) reason = 'only-on-slip';
    else if (amount < 0) reason = 'slip-more';
    else if (certainties.includes('local')) reason = monthly && lead !== 'ot50' ? 'local-monthly' : 'local-overtime';
    else if (certainties.includes('estimate')) reason = 'estimate';

    const columns = COLUMNS[lead] ?? [];
    const perColumn = columns.map((c) => minutesByDate(c, period, byDate));
    const dates = [...new Set(perColumn.flatMap((m) => [...m.keys()]))].sort();
    const pointDays: PointDay[] = dates.map((date) => {
      const day = byDate.get(date);
      return { date, stamps: day?.rows ?? [], minutes: perColumn.map((m) => m.get(date) ?? 0), photo: !!day?.photoIds.length };
    });

    const level = /^ob([1-4])$/.exec(lead)?.[1];
    const agreement = agreementFor(period.end);
    points.push({
      n: points.length + 1,
      keys: members.map((r) => r.key),
      kind: reason ? 'question' : 'claim',
      reason,
      amount,
      lines,
      columns,
      days: pointDays,
      quotes: quotesFor(lead === 'karens' || lead === 'sickDeduction' ? 'sickPay' : lead, monthly, period),
      obRates: level && agreement ? [{ level: Number(level) as ObLevel, rate: agreement.ob[Number(level) as ObLevel], from: agreement.from }] : undefined,
    });
  }
  return points;
}

/** The part of the sum a row adds: hours × the calculated rate, when that is what it comes to. */
function pointLine(row: ComparisonRow, period: PeriodResult): PointLine {
  const amount = round2(-(row.diff.amount ?? 0));
  const hours = row.diff.hours !== undefined ? round2(-row.diff.hours) : undefined;
  const rates = period.totals[row.key as PayCategory]?.rates ?? [];
  const rate = rates.length === 1 ? rates[0] : undefined;
  if (hours && rate !== undefined && Math.abs(hours * rate - amount) < 0.05) return { key: row.key, hours, rate, amount };
  return { key: row.key, amount };
}
