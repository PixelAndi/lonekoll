import { describe, expect, it } from 'vitest';
import type { DayRecord } from './model.ts';
import { currentSickPeriod, sickPeriodOn } from './sick.ts';

// Made-up days.
const sick = (date: string) => ({ date, rows: [], photoIds: [], absence: { type: 'sick' } }) as unknown as DayRecord;

describe('the sick period going on', () => {
  it('counts calendar days from the sick report, with the dates for the certificate and Försäkringskassan', () => {
    const p = currentSickPeriod([sick('2027-03-01'), sick('2027-03-02'), sick('2027-03-03')], '2027-03-03');
    expect(p).toMatchObject({ start: '2027-03-01', dayNo: 3, relapse: false, certificateFrom: '2027-03-08', insuranceFrom: '2027-03-15' });
  });

  it('is one period across a weekend between registered working days', () => {
    // Friday and Monday.
    expect(currentSickPeriod([sick('2027-03-05'), sick('2027-03-08')], '2027-03-08')).toMatchObject({ start: '2027-03-05', dayNo: 4 });
  });

  it('continues the sick pay days of a period that ended within five days, with no new karens, but counts the certificate afresh', () => {
    // Sick 1–3 March (3 days), well from 4 March, sick again 8 March: within five days of the end.
    const p = sickPeriodOn([sick('2027-03-01'), sick('2027-03-02'), sick('2027-03-03'), sick('2027-03-08')], '2027-03-08');
    expect(p).toMatchObject({ start: '2027-03-08', relapse: true, certificateFrom: '2027-03-15', insuranceFrom: '2027-03-19' });
    // A day later it is a new period.
    expect(sickPeriodOn([sick('2027-03-01'), sick('2027-03-03'), sick('2027-03-09')], '2027-03-09')).toMatchObject({ relapse: false, insuranceFrom: '2027-03-23' });
  });

  it('is two periods with a day worked between', () => {
    const worked = { date: '2027-03-09', rows: [{ in: '06:00', out: '14:00' }], photoIds: [] } as unknown as DayRecord;
    expect(sickPeriodOn([sick('2027-03-08'), worked, sick('2027-03-11')], '2027-03-11')).toMatchObject({ start: '2027-03-11', relapse: true });
  });

  it('ends with the last sick day', () => {
    expect(currentSickPeriod([sick('2027-03-01')], '2027-03-04')).toBeNull();
  });
});

describe('a sick period after a work injury', () => {
  const sick = (date: string, workInjury?: boolean): DayRecord => ({ date, rows: [], absence: { type: 'sick', workInjury }, photoIds: [], updatedAt: 0 });
  it('is marked when one of its days is', () => {
    const days = [sick('2030-03-04', true), sick('2030-03-05'), sick('2030-03-06')];
    expect(sickPeriodOn(days, '2030-03-06')?.workInjury).toBe(true);
  });
  it('is not marked otherwise', () => {
    expect(sickPeriodOn([sick('2030-03-04'), sick('2030-03-05')], '2030-03-05')?.workInjury).toBe(false);
  });
});
