import { describe, expect, it } from 'vitest';
import type { DayRecord } from './model.ts';
import { currentSickPeriod } from './sick.ts';

// Made-up days.
const sick = (date: string) => ({ date, rows: [], photoIds: [], absence: { type: 'sick' } }) as unknown as DayRecord;

describe('the sick period going on', () => {
  it('counts calendar days from the first sick day, with the dates for the certificate and Försäkringskassan', () => {
    const p = currentSickPeriod([sick('2027-03-01'), sick('2027-03-02'), sick('2027-03-03')], '2027-03-03');
    expect(p).toMatchObject({ start: '2027-03-01', dayNo: 3, certificateFrom: '2027-03-08', insuranceFrom: '2027-03-15', sickDays: 3 });
  });

  it('continues a period fallen ill again within five days, and ends with the last sick day', () => {
    expect(currentSickPeriod([sick('2027-03-01'), sick('2027-03-05')], '2027-03-05')?.start).toBe('2027-03-01');
    expect(currentSickPeriod([sick('2027-03-01'), sick('2027-03-10')], '2027-03-10')?.start).toBe('2027-03-10');
    expect(currentSickPeriod([sick('2027-03-01')], '2027-03-04')).toBeNull();
  });
});
