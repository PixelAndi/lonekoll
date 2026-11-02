import { describe, expect, it } from 'vitest';
import { calculateShifts } from './calc.ts';
import { calendarDays, monthCounts, slipAbsences, upcomingHolidays } from './calendar.ts';
import { DEFAULT_SETTINGS, type DayRecord, type Settings } from './model.ts';

// Made-up May 2026 (Första maj Friday 1 May; pay day 25 May, a Monday); "today" is Wednesday 13 May.
const settings: Settings = { ...DEFAULT_SETTINGS, employedSince: '2026-01-01', wages: [{ from: '2026-01-01', basis: 'fixed', hourly: 200 }] };
const work = (date: string, inT = '06:00', out = '14:00') => ({ date, rows: [{ in: inT, out }], photoIds: [] }) as unknown as DayRecord;
const away = (date: string, type: string) => ({ date, rows: [], photoIds: [], absence: { type } }) as unknown as DayRecord;
const days: DayRecord[] = [
  ...['2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17', '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24', '2026-04-27', '2026-04-28', '2026-04-29', '2026-04-30'].map((d) => work(d)),
  work('2026-05-04', '06:00', '16:00'),
  work('2026-05-05', '14:00', '22:00'),
  away('2026-05-08', 'vacation'),
  away('2026-05-11', 'sick'),
  away('2026-05-12', 'sick'),
];
const { results, issues } = calculateShifts(days, settings);
const list = calendarDays('2026-05-01', '2026-05-31', { days, results, issues, settings, today: '2026-05-13' });
const on = (d: string) => list.find((x) => x.date === d)!;

describe('the calendar’s days', () => {
  it('says what each day was', () => {
    expect(on('2026-05-04')).toMatchObject({ kind: 'worked', overtime: true });
    expect(on('2026-05-05')).toMatchObject({ kind: 'worked', overtime: false, ob: true, minutes: 480 });
    expect(on('2026-05-08').kind).toBe('vacation');
    expect(on('2026-05-11')).toMatchObject({ kind: 'sick', karens: true });
    expect(on('2026-05-12')).toMatchObject({ kind: 'sick', karens: false });
    // Usual working days, past, nothing registered.
    expect(on('2026-05-06').kind).toBe('missing');
    expect(on('2026-05-07').kind).toBe('missing');
    // The holiday isn't missing; the weekend is free; after today is to come.
    expect(on('2026-05-01')).toMatchObject({ kind: 'free', holiday: { name: 'holiday.mayDay', kind: 'holiday' } });
    expect(on('2026-05-02').kind).toBe('free');
    expect(on('2026-05-20').kind).toBe('future');
    expect(on('2026-05-25').payDay).toBe(true);
  });

  it('counts the month', () => {
    expect(monthCounts(list)).toMatchObject({ worked: 2, sick: 2, vacation: 1, holidays: 2, missing: 2 });
  });

  it('lists the holidays ahead, eves too', () => {
    expect(upcomingHolidays('2027-06-01', 3).map((h) => [h.date, h.kind])).toEqual([
      ['2027-06-06', 'holiday'],
      ['2027-06-25', 'sunday'],
      ['2027-06-26', 'holiday'],
    ]);
  });
});

describe('absences from the pay slips', () => {
  it('fill days with nothing logged: vacation and sick lines with dates, working days only', () => {
    const slip = {
      periodStart: '2026-06-01',
      balances: {},
      lines: [
        { code: '1', text: 'Semesterdaglön', from: '2026-06-22', to: '2026-06-28', quantity: 5, unit: 'Dagar', category: 'vacationPay' },
        { code: '2', text: 'Karens', from: '2026-06-03', to: '2026-06-03', quantity: 8, unit: 'Timmar', category: 'karens' },
      ],
    } as unknown as import('./payslip.ts').PaySlip;
    const map = slipAbsences([slip]);
    expect([...map.entries()].sort()).toEqual([
      ['2026-06-03', 'sick'],
      ['2026-06-22', 'vacation'],
      ['2026-06-23', 'vacation'],
      ['2026-06-24', 'vacation'],
      ['2026-06-25', 'vacation'],
      ['2026-06-26', 'vacation'],
    ]);
    const june = calendarDays('2026-06-22', '2026-06-26', { days: [], results: [], issues: [], settings, today: '2026-07-01', fromSlips: map });
    expect(june.every((d) => d.kind === 'vacation')).toBe(true);
  });
});
