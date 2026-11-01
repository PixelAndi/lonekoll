import { describe, expect, it } from 'vitest';
import { agreementFor } from './agreement.ts';
import { DEFAULT_SETTINGS, type Settings } from './model.ts';
import type { PaySlip } from './payslip.ts';
import { applyPattern, stepsNotInSettings, wageHistory, wagePatterns, wagesFromHistory } from './wageHistory.ts';

// Made-up employments and wages; the agreement's minimums are its own (public).
const min = (date: string) => agreementFor(date)!.minimumWage;
const slip = (month: string, rate: number): PaySlip => ({
  periodStart: `${month}-01`,
  lines: [
    {
      code: '1',
      text: 'Timlön',
      quantity: 100,
      unit: 'Timmar',
      unitPrice: rate,
      amount: rate * 100,
      category: 'wage',
    },
  ],
  balances: {},
});
const settings = (employedSince: string): Settings => ({
  ...DEFAULT_SETTINGS,
  employedSince,
  wages: [],
});

describe('the wage step by step', () => {
  const s = settings('2023-06-10');
  const supplement = 10;
  const slips = [
    slip('2024-03', min('2024-03-01').adult),
    slip('2024-05', min('2024-05-01').adult),
    slip('2024-07', min('2024-07-01').adultAfterOneYear),
    slip('2024-10', min('2024-10-01').adultAfterOneYear + supplement),
    slip('2025-05', min('2025-05-01').adultAfterOneYear + supplement),
  ];
  const steps = wageHistory(slips, s);

  it('takes each wage apart into the minimum and the personal supplement', () => {
    expect(steps.map((x) => x.above)).toEqual([0, 0, 0, supplement, supplement]);
    expect(steps.every((x) => !x.belowMinimum)).toBe(true);
  });

  it('names each change: the agreement’s raise, the step after a year, a personal raise', () => {
    const [, revision, oneYear, personal, both] = steps.map((x) => x.change!);
    expect(revision).toMatchObject({
      revision: true,
      oneYear: false,
      personal: 0,
    });
    expect(revision.agreement).toBeCloseTo(min('2024-05-01').adult - min('2024-03-01').adult, 2);
    expect(oneYear).toMatchObject({
      revision: false,
      oneYear: true,
      personal: 0,
    });
    expect(personal).toMatchObject({
      agreement: 0,
      personal: supplement,
      amount: supplement,
    });
    expect(both).toMatchObject({ revision: true, personal: 0 });
  });

  it('gives the settings that pay the same: the minimum plus the supplement, from the employment', () => {
    const wages = wagesFromHistory(steps, s);
    expect(wages).toEqual([
      {
        from: '2023-06-10',
        basis: 'minimum',
        hourly: 0,
        supplement: 0,
        supplementPer: 'hour',
      },
      {
        from: '2024-10-01',
        basis: 'minimum',
        hourly: 0,
        supplement,
        supplementPer: 'hour',
      },
    ]);
    expect(stepsNotInSettings(steps, { ...s, wages })).toEqual([]);
    expect(stepsNotInSettings(steps, s)).toHaveLength(steps.length);
  });
});

describe('a wage below the minimum', () => {
  const s = settings('2024-01-01');
  // From 1 January 2025 the higher minimum applies; the slips stay on the lower one.
  const steps = wageHistory([slip('2025-02', min('2025-02-01').adult), slip('2025-05', min('2025-05-01').adultAfterOneYear)], s);

  it('is told apart, and the rise that put it right is named as such', () => {
    expect(steps[0]).toMatchObject({ belowMinimum: true });
    expect(steps[0].above).toBeCloseTo(min('2025-02-01').adult - min('2025-02-01').adultAfterOneYear, 2);
    expect(steps[1].change!.corrected).toBeCloseTo(-steps[0].above, 2);
    expect(steps[1].change!.revision).toBe(true);
    expect(steps[1].change!.personal).toBe(0);
  });

  it('is set as the minimum: what was due', () => {
    expect(wagesFromHistory(steps, s)).toEqual([
      {
        from: '2024-01-01',
        basis: 'minimum',
        hourly: 0,
        supplement: 0,
        supplementPer: 'hour',
      },
    ]);
  });
});

describe('a wage the slips keep paying', () => {
  // Made up: the minimum until a personal supplement of 7.50 kr/h, kept through a 1 April raise;
  // the settings say 1 500 kr a month on top all along.
  const s: Settings = { ...settings('2023-01-01'), wages: [{ from: '2023-01-01', basis: 'minimum', hourly: 0, supplement: 1500, supplementPer: 'month' }] };
  const slips = [
    slip('2024-02', min('2024-02-01').adultAfterOneYear),
    slip('2024-03', min('2024-03-01').adultAfterOneYear + 7.5),
    slip('2024-05', min('2024-05-01').adultAfterOneYear + 7.5),
  ];
  const patterns = wagePatterns(wageHistory(slips, s), s);

  it('is found as a pattern: the same supplement through the agreement’s raises', () => {
    expect(patterns.map((p) => [p.from, p.row.supplement, p.revisions, p.differs, p.last])).toEqual([
      ['2023-01-01', 0, 0, true, false],
      ['2024-03-01', 7.5, 1, true, true],
    ]);
  });

  it('agreed, goes into the settings as the minimum plus an hourly supplement', () => {
    const wages = applyPattern(s, patterns[1]);
    expect(wages).toEqual([s.wages[0], { from: '2024-03-01', basis: 'minimum', hourly: 0, supplement: 7.5, supplementPer: 'hour' }]);
    const after = { ...s, wages };
    expect(wagePatterns(wageHistory(slips, after), after)[1].differs).toBe(false);
  });

  it('agreed for a time in between, the settings’ wage comes back after it', () => {
    const wages = applyPattern(s, patterns[0]);
    expect(wages.map((w) => [w.from, w.supplement, w.supplementPer])).toEqual([
      ['2023-01-01', 0, 'hour'],
      ['2024-03-01', 1500, 'month'],
    ]);
  });
});
