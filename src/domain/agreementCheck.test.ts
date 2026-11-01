import { describe, expect, it } from 'vitest';
import { agreementFor } from './agreement.ts';
import { checkAgainstAgreement, slipFindings, uncheckedMonths } from './agreementCheck.ts';
import { DEFAULT_SETTINGS, type Settings } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';
import type { SlipCategory } from './payslip.ts';

// Made-up employments and slips; the agreement's amounts are its own (public).
const y2025 = agreementFor('2025-06-01')!;
const y2024 = agreementFor('2024-06-01')!;

const line = (category: SlipCategory, quantity: number, unitPrice: number, text = 'Timlön'): SlipLine => ({
  code: '1',
  text,
  quantity,
  unit: 'Timmar',
  unitPrice,
  amount: Math.round(quantity * unitPrice * 100) / 100,
  category,
});
const slip = (month: string, lines: SlipLine[]): PaySlip => ({ periodStart: `${month}-01`, lines, balances: {} });
const settings = (employedSince: string): Settings => ({ ...DEFAULT_SETTINGS, employedSince, wages: [] });

describe('the wage against the agreement’s minimum', () => {
  it('finds the step after a year’s employment not given, from the month it applies', () => {
    // Started 15 October 2024: from 15 October 2025 the higher minimum applies.
    const adult = y2025.minimumWage.adult;
    const slips = ['2025-09', '2025-10', '2025-11', '2025-12'].map((m) => slip(m, [line('wage', 160, adult)]));
    const [f] = checkAgainstAgreement(slips, settings('2024-10-15'));
    expect(f).toMatchObject({ rule: 'minimum', cause: 'oneYear', paid: adult, due: y2025.minimumWage.adultAfterOneYear });
    expect(f.months).toEqual(['2025-10-01', '2025-11-01', '2025-12-01']);
    // October from the 15th: 17 of 31 days of its hours.
    expect(f.hours).toBeCloseTo(160 * (17 / 31) + 320, 1);
    expect(f.estimate).toBe(true);
  });

  it('finds last year’s minimum still paid after 1 April', () => {
    const slips = [slip('2025-03', [line('wage', 150, y2024.minimumWage.adult)]), slip('2025-04', [line('wage', 150, y2024.minimumWage.adult)])];
    const [f] = checkAgainstAgreement(slips, settings('2025-01-01'));
    expect(f).toMatchObject({ rule: 'minimum', cause: 'revision', months: ['2025-04-01'], amount: Math.round(150 * (y2025.minimumWage.adult - y2024.minimumWage.adult) * 100) / 100 });
  });

  it('finds nothing when the minimum is paid', () => {
    expect(checkAgainstAgreement([slip('2025-06', [line('wage', 150, y2025.minimumWage.adult)])], settings('2025-01-01'))).toEqual([]);
  });
});

describe('the lowest raise', () => {
  it('finds a raise smaller than Bilaga J’s lowest, for a wage above the minimum', () => {
    const before = 200;
    const slips = [slip('2025-03', [line('wage', 150, before)]), slip('2025-04', [line('wage', 150, before + 1)])];
    const [f] = checkAgainstAgreement(slips, settings('2020-01-01'));
    expect(f).toMatchObject({ rule: 'lowestRaise', from: y2025.from, paid: before + 1, due: before + y2025.minimumRaise, months: ['2025-04-01'] });
  });
});

describe('the prices of supplements', () => {
  const s = settings('2020-01-01');

  it('finds OB, overtime, sick pay and holiday pay paid below what they should be', () => {
    const rate = 200;
    const found = checkAgainstAgreement(
      [
        slip('2025-06', [
          line('wage', 150, rate),
          line('ob1', 10, y2025.ob[1] - 5, 'OB 1'),
          line('ot50', 4, 80, 'Övertid 50 %'),
          line('sickPay', 8, 150, 'Sjuklön'),
          line('holidayPay', 8, 190, 'Helglön'),
        ]),
      ],
      s,
    );
    const by = (rule: string) => found.find((f) => f.rule === rule)!;
    expect(by('ob')).toMatchObject({ level: 1, amount: 50 });
    expect(by('overtime')).toMatchObject({ level: 50, due: 100, amount: 80 });
    expect(by('sickPay')).toMatchObject({ due: 160, amount: 80 });
    expect(by('holidayPay')).toMatchObject({ due: 200, amount: 80 });
  });

  it('accepts prices at or above them', () => {
    const ok = slip('2025-06', [line('wage', 150, 200), line('ob1', 10, y2025.ob[1], 'OB 1'), line('ot100', 4, 200, 'Övertid 100 %'), line('sickPay', 8, 160, 'Sjuklön')]);
    expect(checkAgainstAgreement([ok], s)).toEqual([]);
  });
});

describe('around the findings', () => {
  it('names a retroactive line or another payment on a later slip that may have put it right', () => {
    const adult = y2025.minimumWage.adult;
    const slips = [
      slip('2025-11', [line('wage', 160, adult)]),
      slip('2026-01', [line('wage', 160, y2025.minimumWage.adultAfterOneYear), { ...line('other', 1, 900, 'Retroaktiv lön'), unit: 'st' }]),
    ];
    const [f] = checkAgainstAgreement(slips, settings('2024-10-15'));
    expect(f.corrections).toEqual([{ month: '2026-01-01', text: 'Retroaktiv lön', amount: 900 }]);
  });

  it('gives one slip’s own findings, for its report', () => {
    const adult = y2025.minimumWage.adult;
    const slips = ['2025-11', '2025-12'].map((m) => slip(m, [line('wage', 100, adult)]));
    const own = slipFindings(slips[1], slips, settings('2024-10-15'));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ months: ['2025-12-01'], hours: 100 });
  });

  it('lists the months it couldn’t check: no slip, or no wage read', () => {
    const slips = [slip('2025-06', [line('wage', 150, 200)]), slip('2025-08', [line('ob1', 3, 60, 'OB 1')]), slip('2025-09', [line('wage', 150, 200)])];
    expect(uncheckedMonths(slips, settings('2025-05-10'))).toEqual({ missing: ['2025-05-01', '2025-07-01'], unread: ['2025-08-01'] });
  });
});
