import { specialDay } from './holidays.ts';
import { monthlyPayOn, type DayRecord, type Settings } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';
import { addDays, isoWeekday, toMinutes, type LocalDate } from './time.ts';

// Helglön on public holidays that fall Monday–Friday (Livsmedelsavtalet §5.1):
// paid for the ordinary hours you would have worked had the day not been a
// holiday (§5.1.2) – also on vacation, during the first 14 sick days and on
// leave of up to two weeks (§5.1.3) – on the slip for the month it falls in
// (§5.1.5); not for an employment shorter than four weeks (§5.1.4), nor to
// someone absent without good reason the working day before or after (which
// the app can't know, so the finding says so). A holiday is checked when the
// slip is read completely, the stamps (or the slip's own per-day lines) show
// that weekday as a usual working day, and the day itself wasn't worked; the
// slip's helglön hours (or a surplus on the next slip) are then set against
// the hours of the holidays it should pay.

export interface MissingHoliday {
  date: LocalDate;
  /** Translation key of the holiday's name. */
  name: string;
  /** The slip's period start. */
  month: LocalDate;
  /** Hours that should have been paid as helglön, and what the slip paid for them. */
  hours: number;
  paidHours: number;
  /** The slip's hourly wage (helglön also includes OB the day would have had: not counted here). */
  rate: number;
  amount: number;
  /** What showed it was a working day: the stamps, or the slip's per-day lines. */
  evidence: 'log' | 'slip';
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const HOURS = /^(tim|timmar|h)$/i;

/** Read to the last line: the lines add up to the gross, and more than one line was found. */
export function slipReadWhole(slip: PaySlip): boolean {
  if (slip.gross === undefined || slip.lines.length < 2) return false;
  const sum = slip.lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  return Math.abs(sum - slip.gross) < 0.02;
}

/** The slip's hourly wage: its most-paid price on wage lines. */
function hourlyRate(slip: PaySlip): number | undefined {
  const prices = new Map<number, number>();
  for (const l of slip.lines) {
    if (l.category !== 'wage' || !l.unitPrice || l.unitPrice < 50 || (l.quantity ?? 0) <= 0 || /retro/i.test(l.text)) continue;
    prices.set(l.unitPrice, (prices.get(l.unitPrice) ?? 0) + (l.quantity ?? 0));
  }
  return [...prices].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Minutes worked on a logged day (stamps in to out; a shift over midnight ends the next day). */
function workedMinutes(day: DayRecord): number {
  let m = 0;
  for (const r of day.rows) {
    if (!r.in || !r.out) continue;
    let d = toMinutes(r.out) - toMinutes(r.in);
    if (d <= 0) d += 24 * 60;
    m += d;
  }
  return m;
}

/** Wage lines for a single day (the older layout), by date. */
function perDayLines(slip: PaySlip): Map<LocalDate, SlipLine[]> {
  const out = new Map<LocalDate, SlipLine[]>();
  for (const l of slip.lines) {
    if (l.category !== 'wage' || !l.from || l.from !== (l.to ?? l.from) || (l.quantity ?? 0) <= 0) continue;
    out.set(l.from, [...(out.get(l.from) ?? []), l]);
  }
  return out;
}

const helgPaid = (slip: PaySlip) =>
  slip.lines.filter((l) => l.category === 'holidayPay' && (l.quantity ?? 0) > 0 && HOURS.test(l.unit ?? 'tim')).reduce((s, l) => s + (l.quantity ?? 0), 0);

interface Expected {
  date: LocalDate;
  name: string;
  hours: number;
  evidence: 'log' | 'slip';
}

/** The weekday holidays a slip should pay helglön for, with the hours, from what shows them to be working days. */
function expectedHolidays(slip: PaySlip, days: DayRecord[], settings: Settings): Expected[] {
  const start = slip.periodStart!;
  const end = slip.periodEnd ?? `${start.slice(0, 8)}31`;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const lines = perDayLines(slip);
  const out: Expected[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const special = specialDay(date);
    const weekday = isoWeekday(date);
    if (special?.kind !== 'holiday' || weekday > 5) continue;
    // An employment shorter than four weeks gets none (§5.1.4).
    if (settings.employedSince && settings.employedSince > addDays(date, -28)) continue;
    const day = byDate.get(date);
    // Worked on the holiday: paid as work (with OB), not helglön.
    if ((day && workedMinutes(day) > 0) || lines.has(date)) continue;
    // Unpaid leave or a longer absence: not checked.
    if (day?.absence && day.absence.type !== 'vacation' && day.absence.type !== 'sick') continue;
    // The same weekday worked around it: from the stamps, else from the slip's own per-day lines.
    const sameLogged = days.filter((d) => d.date !== date && isoWeekday(d.date) === weekday && d.date >= addDays(date, -35) && d.date <= addDays(date, 35) && workedMinutes(d) > 0);
    const sameOnSlip = [...lines.entries()].filter(([d]) => d !== date && isoWeekday(d) === weekday);
    let hours: number;
    let evidence: Expected['evidence'];
    if (sameLogged.length >= 2) {
      hours = sameLogged.reduce((s, d) => s + workedMinutes(d), 0) / sameLogged.length / 60;
      evidence = 'log';
    } else if (sameOnSlip.length >= 2) {
      hours = sameOnSlip.reduce((s, [, ls]) => s + ls.reduce((a, l) => a + (l.quantity ?? 0), 0), 0) / sameOnSlip.length;
      evidence = 'slip';
    } else continue;
    // Ordinary hours (§5.1.2): no more than the ordinary shift – stamps also hold breaks and minutes either side.
    const ordinary = settings.ordinaryShiftMinutes / 60;
    out.push({ date, name: special.name, hours: Math.min(ordinary, Math.round(hours * 2) / 2), evidence });
  }
  return out;
}

/** Weekday holidays the slips should have paid helglön for and didn't (or not in full). */
export function missingHolidayPay(slips: PaySlip[], days: DayRecord[], settings: Settings): MissingHoliday[] {
  const dated = slips.filter((s) => s.periodStart).sort((a, b) => a.periodStart!.localeCompare(b.periodStart!));
  const out: MissingHoliday[] = [];
  dated.forEach((slip, i) => {
    if (!slipReadWhole(slip) || monthlyPayOn(settings, slip.periodStart!) !== null) return;
    const rate = hourlyRate(slip);
    if (!rate) return;
    const expected = expectedHolidays(slip, days, settings);
    if (!expected.length) return;
    // Helglön paid late: a surplus on the next slip (beyond its own holidays) counts here.
    const next = dated[i + 1];
    const nextSurplus = next && slipReadWhole(next) ? Math.max(0, helgPaid(next) - expectedHolidays(next, days, settings).reduce((s, e) => s + e.hours, 0)) : 0;
    let paid = helgPaid(slip) + nextSurplus;
    for (const e of expected) {
      const covered = Math.min(paid, e.hours);
      paid -= covered;
      const short = e.hours - covered;
      if (short < 0.5) continue;
      out.push({ date: e.date, name: e.name, month: slip.periodStart!, hours: e.hours, paidHours: covered, rate, amount: round2(short * rate), evidence: e.evidence });
    }
  });
  return out;
}
