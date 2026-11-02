import { describe, expect, it } from 'vitest';
import { missingHolidayPay } from './holidayPay.ts';
import { DEFAULT_SETTINGS, type DayRecord, type Settings } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';
import { addDays, isoWeekday } from './time.ts';

// Made-up: Kristi himmelsfärd 2027 is Thursday 6 May. Worked Mon–Fri 06:00–14:00 around it.
const settings: Settings = { ...DEFAULT_SETTINGS, employedSince: '2026-01-01', ordinaryShiftMinutes: 480, wages: [{ from: '2026-01-01', basis: 'fixed', hourly: 200 }] };
const worked = (from: string, to: string, skip: string[] = []): DayRecord[] => {
  const out: DayRecord[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isoWeekday(d) <= 5 && !skip.includes(d)) out.push({ date: d, rows: [{ in: '06:00', out: '14:00' }], photoIds: [] } as unknown as DayRecord);
  return out;
};
const line = (category: SlipLine['category'], quantity: number, price: number, text: string): SlipLine => ({ code: '1', text, quantity, unit: 'Timmar', unitPrice: price, amount: quantity * price, category });
const slip = (month: string, lines: SlipLine[]): PaySlip => ({ periodStart: `${month}-01`, lines, gross: lines.reduce((s, l) => s + (l.amount ?? 0), 0), balances: {} });

describe('helglön on weekday holidays', () => {
  const days = worked('2027-04-05', '2027-05-28', ['2027-05-06']);

  it('is found missing when the day was a usual working day, not worked, and the slip pays none', () => {
    const [m] = missingHolidayPay([slip('2027-05', [line('wage', 160, 200, 'Timlön'), line('ob1', 4, 50, 'OB 1')])], days, settings);
    expect(m).toMatchObject({ date: '2027-05-06', name: 'holiday.ascension', hours: 8, paidHours: 0, rate: 200, amount: 1600, evidence: 'log' });
  });

  it('is fine when the slip pays it, or the next slip pays it late', () => {
    expect(missingHolidayPay([slip('2027-05', [line('wage', 160, 200, 'Timlön'), line('holidayPay', 8, 200, 'Helglön')])], days, settings)).toEqual([]);
    const late = [slip('2027-05', [line('wage', 160, 200, 'Timlön'), line('ob1', 4, 50, 'OB 1')]), slip('2027-06', [line('wage', 160, 200, 'Timlön'), line('holidayPay', 8, 200, 'Helglön')])];
    expect(missingHolidayPay(late, [...days, ...worked('2027-06-01', '2027-06-30')], settings)).toEqual([]);
  });

  it('isn’t asked of a holiday worked, a slip not read whole, or an employment shorter than four weeks', () => {
    const all = worked('2027-04-05', '2027-05-28');
    expect(missingHolidayPay([slip('2027-05', [line('wage', 168, 200, 'Timlön'), line('ob1', 4, 50, 'OB 1')])], all, settings)).toEqual([]);
    const partial = { ...slip('2027-05', [line('wage', 160, 200, 'Timlön'), line('ob1', 4, 50, 'OB 1')]), gross: 99999 };
    expect(missingHolidayPay([partial], days, settings)).toEqual([]);
    expect(missingHolidayPay([slip('2027-05', [line('wage', 160, 200, 'Timlön'), line('ob1', 4, 50, 'OB 1')])], days, { ...settings, employedSince: '2027-04-20' })).toEqual([]);
  });
});
