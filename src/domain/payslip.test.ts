import { describe, expect, it } from 'vitest';
import { classifyLine, parsePaySlip, parseSwedishNumber, type TextItem } from './payslip.ts';

// Same layout as a real bakery pay slip (x/y as pdf.js reports them), with
// a made-up employer, made-up amounts and no personal details.
const row = (y: number, cells: [string, number, number][]): TextItem[] =>
  cells.map(([str, x, width]) => ({ str, x, y, width }));

const items: TextItem[] = [
  ...row(762.6, [['Bageriet AB', 56.7, 138], ['Lönebesked', 311.8, 98.1]]),
  ...row(736.5, [['Löneperiod', 56.7, 43.5], ['2026-09-01 - 2026-09-30', 141.7, 89]]),
  ...row(700.9, [['Löneart', 56.7, 29.3], ['Benämning', 99.2, 43.5], ['Datum', 275, 24.9], ['Kvantitet', 347.3, 34.2], ['Enhet', 388.3, 22.2], ['A-Pris', 457.2, 23.5], ['Belopp', 510.3, 27.1]]),
  ...row(687.4, [['1106', 65.7, 17.8], ['Timlön', 99.2, 24], ['120,50', 357.1, 24.5], ['Timmar', 388.3, 27.1], ['180,00', 456.3, 24.5], ['21 690,00', 501.9, 35.6]]),
  ...row(675.4, [['3236', 65.7, 17.8], ['Uttag betalda semesterdagar, timavlönad', 99.2, 146.3], ['260903 - 260904', 275, 60.5], ['2,00', 366, 15.6], ['Dagar', 388.3, 21.8]]),
  ...row(663.4, [['3221', 65.7, 17.8], ['Semesterdaglön betald, timavlönad', 99.2, 125.4], ['260903 - 260904', 275, 60.5], ['2,00', 366, 15.6], ['Dagar', 388.3, 21.8], ['2 000,00', 449.6, 31.1], ['4 000,00', 506.3, 31.1]]),
  ...row(651.3, [['3168', 65.7, 17.8], ['Karens Timavlönad', 99.2, 68.9], ['260924 - 260924', 275, 60.5], ['8,00', 366, 15.6], ['Timmar', 388.3, 27.1], ['-144,00', 453.6, 27.1], ['-1 152,00', 503.6, 33.8]]),
  ...row(639.3, [['3171', 65.7, 17.8], ['Sjuk korttid dag 1-14, timavlönad', 99.2, 116.5], ['260924 - 260930', 275, 60.5], ['40,00', 361.5, 20], ['Timmar', 388.3, 27.1]]),
  ...row(627.3, [['3159', 65.7, 17.8], ['Sjuklön dag 1-14, timavlönad', 99.2, 103.2], ['260924 - 260930', 275, 60.5], ['40,00', 361.5, 20], ['Timmar', 388.3, 27.1], ['144,00', 456.3, 24.5], ['5 760,00', 506.3, 31.1]]),
  ...row(615.2, [['1149', 65.7, 17.8], ['OB-ersättning 1, timavlönad, à-pris', 99.2, 123.6], ['20,00', 361.5, 20], ['Timmar', 388.3, 27.1], ['50,89', 460.7, 20], ['1 017,80', 506.3, 31.1]]),
  ...row(603.2, [['4330', 65.7, 17.8], ['Arbetstidskonto Uttag timmar från tidbank', 99.2, 147.2], ['260911 - 260911', 275, 60.5], ['2,00', 366, 15.6], ['Timmar', 388.3, 27.1]]),
  ...row(591.2, [['1106', 65.7, 17.8], ['Timlön', 99.2, 24], ['260911 - 260911', 275, 60.5], ['-2,00', 363.3, 18.2], ['Timmar', 388.3, 27.1], ['180,00', 456.3, 24.5], ['-360,00', 510.3, 27.1]]),
  ...row(579.1, [['4331', 65.7, 17.8], ['Arbetstidskonto Utbet. pengar för ledig tid', 99.2, 147.2], ['260911 - 260911', 275, 60.5], ['2,00', 366, 15.6], ['Timmar', 388.3, 27.1], ['160,00', 456.3, 24.5], ['320,00', 513, 24.5]]),
  ...row(190.9, [['Semesterdagar', 56.7, 57.8], ['Totalt i år', 181.4, 36], ['Skatt beräknad på', 306.1, 68.9], ['Utbetalning', 439.4, 44]]),
  ...row(182.7, [['Betalda', 56.7, 23.7], ['4', 170.7, 3.9], ['Bruttolön', 181.4, 28], ['300 000,00', 264.3, 35], ['Bruttolön', 306.1, 28], ['31 275,80', 392.9, 31.1], ['Bruttolön', 439.4, 28], ['31 275,80', 526.2, 31.1]]),
  ...row(174.6, [['Obetalda', 56.7, 28.4], ['0', 170.7, 3.9], ['Skatt', 439.4, 15.9], ['6 000,00', 530, 27.2]]),
  ...row(166.6, [['Sparade', 56.7, 26.5], ['8', 170.7, 3.9], ['Skatt', 181.4, 15.9], ['70 000,00', 268.2, 31.1], ['Tabell', 306.1, 19.1], ['32,00', 406.5, 17.5], ['Övriga avdrag', 439.4, 44], ['-', 555, 2.3]]),
  ...row(158.5, [['Engångsskatt %', 306.1, 50.6], ['26,00', 406.5, 17.5]]),
  ...row(142.4, [['Komptid', 56.7, 25.7], ['-', 172.3, 2.3]]),
  ...row(134.4, [['Artbetstidskonto', 56.7, 50.2], ['48,00', 157.1, 17.5]]),
  ...row(66.7, [['Utbetalas 2026-10-23', 306.1, 96.2], ['25 275,80', 512.8, 44.5]]),
];

describe('parseSwedishNumber', () => {
  it('reads spaces as thousand separators and comma decimals', () => {
    expect(parseSwedishNumber('22 901,35')).toBe(22901.35);
    expect(parseSwedishNumber('-1 202,40')).toBe(-1202.4);
    expect(parseSwedishNumber('−375,74')).toBe(-375.74);
    expect(parseSwedishNumber('-')).toBeUndefined();
  });
});

describe('parsePaySlip', () => {
  const slip = parsePaySlip(items, 180);

  it('reads the header and the payout block', () => {
    expect(slip).toMatchObject({
      employer: 'Bageriet AB',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      payDate: '2026-10-23',
      gross: 31275.8,
      tax: 6000,
      net: 25275.8,
      taxTable: 32,
      taxBase: 31275.8,
      oneTimeTaxPercent: 26,
      otherDeductions: 0,
      balances: { vacationDaysPaid: 4, vacationDaysSaved: 8, compHours: undefined, timeBankHours: 48 },
    });
  });

  it('reads every line with quantity, price and amount', () => {
    expect(slip.lines.map((l) => [l.code, l.category, l.quantity, l.unitPrice, l.amount])).toEqual([
      ['1106', 'wage', 120.5, 180, 21690],
      ['3236', 'vacationDays', 2, undefined, undefined],
      ['3221', 'vacationPay', 2, 2000, 4000],
      ['3168', 'karens', 8, -144, -1152],
      ['3171', 'sickHours', 40, undefined, undefined],
      ['3159', 'sickPay', 40, 144, 5760],
      ['1149', 'ob1', 20, 50.89, 1017.8],
      ['4330', 'timebankHours', 2, undefined, undefined],
      ['1106', 'wage', -2, 180, -360],
      ['4331', 'timebankPay', 2, 160, 320],
    ]);
    expect(slip.lines[8]).toMatchObject({ from: '2026-09-11', to: '2026-09-11' });
  });

  it('adds up to the gross on the slip', () => {
    const sum = slip.lines.reduce((s, l) => s + (l.amount ?? 0), 0);
    expect(sum).toBeCloseTo(slip.gross!, 2);
  });
});

describe('classifyLine', () => {
  it('reads the lines of a monthly salary (Bilaga F)', () => {
    expect(classifyLine('Månadslön', 31670, undefined)).toBe('monthlySalary');
    expect(classifyLine('Sjukavdrag dag 1-14', -1553.04, 182.71)).toBe('sickDeduction');
    expect(classifyLine('Sjukfrånvaro', -1553.04, undefined)).toBe('sickDeduction');
    expect(classifyLine('Sjuklön dag 1-14', 73.08, undefined)).toBe('sickPay');
    expect(classifyLine('Karensavdrag', -1169.36, undefined)).toBe('karens');
    expect(classifyLine('Semesteravdrag', -2912.18, undefined)).toBe('vacationDeduction');
    expect(classifyLine('Semestertillägg', 1200, undefined)).toBe('vacationPay');
    expect(classifyLine('Tjänstledig utan lön', -1461.68, undefined)).toBe('absenceDeduction');
    expect(classifyLine('VAB', -1461.68, undefined)).toBe('absenceDeduction');
    // Overtime with a monthly salary: the whole hour and the supplement in one price.
    expect(classifyLine('Övertid', 3014.77, 274.07, 182.71)).toBe('ot50');
    expect(classifyLine('Övertid', 1461.68, 365.42, 182.71)).toBe('ot100');
  });

  it('recognises OB levels by price or name, and overtime', () => {
    expect(classifyLine('OB-tillägg', 1000, 98.87)).toBe('ob2');
    expect(classifyLine('OB 3 lördag', 1000, 999)).toBe('ob3');
    expect(classifyLine('Övertid 50%', 100, 93.94)).toBe('ot50');
    expect(classifyLine('Övertidstillägg', 100, 190, 190)).toBe('ot100');
    expect(classifyLine('Helglön', 1000, 190)).toBe('holidayPay');
    expect(classifyLine('Friskvård', 500, undefined)).toBe('other');
  });

  it('reads the wage for overtime hours as wage, apart from the supplement', () => {
    // An hourly slip prints both for each overtime day: the supplement and the hour itself.
    expect(classifyLine('Övertid 1, timavlönad, 50%', 90, 90, 180)).toBe('ot50');
    expect(classifyLine('Övertid 3, timavlönad, 100%', 360, 180, 180)).toBe('ot100');
    expect(classifyLine('Timlön vid övertid', 360, 180, 180)).toBe('wage');
    // A level the agreement as the app knows it doesn't have: compared as overtime in total.
    expect(classifyLine('Övertid 2, timavlönad, 75%', 270, 135, 180)).toBe('otUnknown');
  });
});

describe('the pay day on a photo', () => {
  const withBar = (cells: [string, number, number][]) => items.filter((i) => i.y !== 66.7).concat(row(66.7, cells));

  it('is read with "Utbetalas" misread', () => {
    const slip = parsePaySlip(withBar([['uuUibgjalas 2026-10-23.', 306.1, 96.2], ['25 275,80', 512.8, 44.5]]));
    expect([slip.payDate, slip.net]).toEqual(['2026-10-23', 25275.8]);
  });

  it('is the date shortly after the period when the word is lost, its year put right', () => {
    expect(parsePaySlip(withBar([['2026-10-23,', 306.1, 40], ['25 275,80', 512.8, 44.5]])).payDate).toBe('2026-10-23');
    expect(parsePaySlip(withBar([['2006-10-23', 306.1, 40]])).payDate).toBe('2026-10-23');
  });

  it('is not taken from a date far from the period', () => {
    expect(parsePaySlip(withBar([['2026-03-23', 306.1, 40]])).payDate).toBeUndefined();
  });
});

describe('the payout block', () => {
  it('doesn’t take the year’s tax for the month’s when the payout block is cut off', () => {
    // Only "Totalt i år" left: its Skatt (70 000) is more than the month's gross.
    const cut = items.filter((i) => !(i.x >= 439 && i.y < 200));
    const slip = parsePaySlip(cut.concat(row(182.7, [['Bruttolön', 306.1, 28], ['31 275,80', 392.9, 31.1]])));
    expect(slip.gross).toBe(31275.8);
    expect(slip.tax).toBeUndefined();
  });

  it('reads a dash as nothing (an extra payout with no tax)', () => {
    const noTax = items.filter((i) => !(i.y === 174.6 && i.x > 500)).concat(row(174.6, [['-', 555, 2.3]]));
    const slip = parsePaySlip(noTax);
    expect([slip.tax, slip.otherDeductions]).toEqual([0, 0]);
  });
});

describe('the pay period', () => {
  const withPeriod = (cells: [string, number, number][], payout = 'Utbetalas 2026-10-23') =>
    items.map((i) => i).filter((i) => i.y !== 736.5 && i.y !== 66.7).concat(row(736.5, cells), row(66.7, [[payout, 306.1, 96.2], ['25 275,80', 512.8, 44.5]]));

  it('is read as printed', () => {
    const slip = parsePaySlip(items);
    expect([slip.periodStart, slip.periodEnd, slip.periodDoubt]).toEqual(['2026-09-01', '2026-09-30', undefined]);
  });

  it('is read from a photo with stray spaces, a colon or an OCR slip in the label', () => {
    const slip = parsePaySlip(withPeriod([['Loneperiod:', 56.7, 43.5], ['2026 -09-01-2026-09-30', 141.7, 89]]));
    expect([slip.periodStart, slip.periodEnd]).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('is read under its heading', () => {
    const slip = parsePaySlip(items.filter((i) => i.y !== 736.5).concat(row(745, [['Löneperiod', 56.7, 43.5]]), row(736.5, [['2026-09-01 - 2026-09-30', 56.7, 89]])));
    expect([slip.periodStart, slip.periodEnd]).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('takes the year of every other date on the slip when its own was misread, and says so', () => {
    const slip = parsePaySlip(withPeriod([['Löneperiod', 56.7, 43.5], ['2028-09-01 - 2028-09-30', 141.7, 89]]));
    expect([slip.periodStart, slip.periodEnd, slip.periodDoubt]).toEqual(['2026-09-01', '2026-09-30', 'yearFixed']);
  });

  it('keeps a December period paid in January', () => {
    const december = items.filter((i) => i.y < 700 && i.y > 570 ? false : true).concat(row(687.4, [['1106', 65.7, 17.8], ['Timlön', 99.2, 24], ['120,50', 357.1, 24.5], ['Timmar', 388.3, 27.1], ['180,00', 456.3, 24.5], ['21 690,00', 501.9, 35.6]]));
    const slip = parsePaySlip(
      december.filter((i) => i.y !== 736.5 && i.y !== 66.7).concat(row(736.5, [['Löneperiod', 56.7, 43.5], ['2025-12-01 - 2025-12-31', 141.7, 89]]), row(66.7, [['Utbetalas 2026-01-23', 306.1, 96.2]])),
    );
    expect([slip.periodStart, slip.periodDoubt]).toEqual(['2025-12-01', undefined]);
  });

  it('is worked out from the pay lines when not readable, and marked as a guess – never today’s month', () => {
    const slip = parsePaySlip(withPeriod([['Löneperiod', 56.7, 43.5], ['2O26-O9-?1', 141.7, 89]]));
    expect([slip.periodStart, slip.periodEnd, slip.periodDoubt]).toEqual(['2026-09-01', '2026-09-30', 'guessed']);
  });

  it('is the month before the pay day when nothing else is dated', () => {
    const plain = items.filter((i) => i.y !== 736.5 && !/^\d{6} - \d{6}$/.test(i.str));
    const slip = parsePaySlip(plain);
    expect([slip.periodStart, slip.periodEnd, slip.periodDoubt]).toEqual(['2026-09-01', '2026-09-30', 'guessed']);
  });
});

describe('an older slip, one line per day, photographed', () => {
  // Made-up figures in the older layout: "1106 Timlön" for each day worked, with its date.
  // As a tilted photo gives it: each code and name a third of a line below its figures.
  const day = (y: number, date: string, hours: string, amount: string): TextItem[] => [
    ...row(y - 4, [['1106', 60, 18], ['Timlön', 85, 25]]),
    ...row(y, [[`${date} - ${date}`, 300, 60], [hours, 380, 16], ['Timmar', 400, 26], ['150,00', 442, 24], [amount, 486, 34]]),
  ];
  const slip = parsePaySlip([
    ...row(760, [['Bageriet AB', 60, 130], ['Lönebesked', 340, 90]]),
    ...row(684, [['Löneperiod:', 60, 50], ['2024-03-01 - 2024-03-31', 150, 90]]),
    ...row(629, [['Datum', 293, 25], ['Kvantitet Enhet', 347, 60], ['A-pris', 435, 25], ['Belopp', 482, 28]]),
    ...row(609, [['1106', 60, 18], ['Timlön', 85, 25], ['0,00', 378, 16], ['Timmar', 398, 26], ['150,00', 440, 24]]),
    ...day(596, '240304', '8,00', '1 200,00'),
    ...day(583, '240305', '9,50', '142500'), // the comma not seen
    ...day(570, '240306', '7,00', '1@5O,0O'), // a smudge
    ...day(557, '240307', '8,00', '1 200,00').map((i) => (i.str === '150,00' ? { ...i, str: '160,00' } : i)), // the price misread
    ...row(233, [['Bruttolön', 460, 30], ['4 875,00', 520, 30]]),
  ]);

  it('reads every day, joining each code to its figures', () => {
    expect(slip.lines.map((l) => [l.from, l.quantity, l.amount])).toEqual([
      [undefined, 0, undefined],
      ['2024-03-04', 8, 1200],
      ['2024-03-05', 9.5, 1425],
      ['2024-03-06', 7, 1050],
      ['2024-03-07', 8, 1200],
    ]);
    expect(slip.lines.every((l) => l.code === '1106' && l.category === 'wage')).toBe(true);
  });

  it('takes a lone figure under À-pris as the price, and puts a misread price right', () => {
    expect(slip.lines[0].unitPrice).toBe(150);
    expect(slip.lines[4].unitPrice).toBe(150);
  });

  it('adds up to the gross pay', () => {
    expect(slip.lines.reduce((sum, l) => sum + (l.amount ?? 0), 0)).toBe(slip.gross);
    expect([slip.periodStart, slip.periodDoubt]).toEqual(['2024-03-01', undefined]);
  });
});
