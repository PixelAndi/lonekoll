import { describe, expect, it } from 'vitest';
import { agreementFor } from './agreement.ts';
import { calculatePeriod } from './calc.ts';
import { DEFAULT_SETTINGS, minimumWageOn, type DayRecord, type Settings } from './model.ts';
import { cite, editionOn, splitCitations } from './sources.ts';

// Dates under Livsmedelsavtalet 1 November 2020 – 31 March 2023 (made-up shifts).
const settings: Settings = { ...DEFAULT_SETTINGS, wages: [{ from: '2020-01-01', hourly: 160 }], employedSince: '2019-01-01', birthDate: '1990-01-01' };
const saturday = (date: string): DayRecord => ({ date, rows: [{ in: '06:00', out: '12:00' }], photoIds: [], updatedAt: 0 });

describe('the agreement in force on older dates', () => {
  it('uses the 2020 agreement’s amounts, and its 1 April 2022 revision', () => {
    expect(agreementFor('2021-08-14')).toMatchObject({ ob: { 1: 43.65, 2: 84.8, 3: 133.02, 4: 195.67 }, shiftedTime: 33.09, vacationPayPerDayMin: 1534 });
    expect(agreementFor('2022-08-13')).toMatchObject({ ob: { 3: 135.94 }, shiftedTime: 33.82, vacationPayPerDayMin: 1568 });
    expect(minimumWageOn(settings, '2021-08-14')?.minimum).toBe(147.94);
    expect(minimumWageOn(settings, '2022-08-13')?.minimum).toBe(151.72);
  });

  it('pays OB at the rates of the day', () => {
    const ob = (date: string) => calculatePeriod([saturday(date)], settings, date.slice(0, 8) + '01', date.slice(0, 8) + '28').totals.ob3;
    expect(ob('2021-08-14')).toMatchObject({ hours: 6, rates: [133.02] });
    expect(ob('2022-08-13')).toMatchObject({ hours: 6, rates: [135.94] });
  });

  it('warns about dates whose agreement the app doesn’t have (April 2023 – March 2025)', () => {
    expect(agreementFor('2023-08-12')).toBeUndefined();
    const p = calculatePeriod([saturday('2023-08-12')], settings, '2023-08-01', '2023-08-31');
    expect(p.shifts[0].warnings).toContain('no-agreement');
  });
});

describe('links to the edition in force', () => {
  it('links older dates to the 2020 edition, with its own pages and numbering', () => {
    expect(editionOn('2021-08-14')).toBe('2020');
    expect(editionOn('2026-10-01')).toBe('2025');
    expect(cite('agreement', '4.4', '2020')).toMatchObject({ section: '4.5', page: 13, href: expect.stringMatching(/livsmedelsavtalet-2020-2023\.pdf#page=13$/) });
    expect(cite('agreement', '3.3', '2020').page).toBe(11);
    expect(cite('bakery', '2', '2020').page).toBe(59);
    // The text shows the section's number in that edition.
    const parts = splitCitations('Livsmedelsavtalet §4.4: skiftformstillägg', '2020');
    expect(typeof parts[0] === 'object' && parts[0].text).toBe('Livsmedelsavtalet §4.5');
  });
});
