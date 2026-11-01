import { describe, expect, it } from 'vitest';
import { agreementFor } from './agreement.ts';
import { DEFAULT_SETTINGS, type Settings } from './model.ts';
import type { PaySlip } from './payslip.ts';
import { stepsNotInSettings, wageHistory, wagesFromHistory } from './wageHistory.ts';

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
