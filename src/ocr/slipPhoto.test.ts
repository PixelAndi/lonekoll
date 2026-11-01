import { describe, expect, it } from 'vitest';
import { parsePaySlip } from '../domain/payslip.ts';
import type { OcrWord } from './parse.ts';
import { slipItemsFromWords } from './slipPhoto.ts';

// A made-up pay slip as the OCR reads a photo of it: single words with their boxes, on a picture
// 2400 px across, tilted a little (rows rise 1 px per 100 px across), the decimal comma read as a point.
const W = 2400;
let y = 200;
const words: OcrWord[] = [];
/** One printed row: [text, x] for each word, the x in pixels. */
function row(...cells: [string, number][]) {
  for (const [text, x] of cells) {
    const top = y - x / 100;
    words.push({ text, confidence: 90, bbox: { x0: x, y0: top, x1: x + text.length * 18, y1: top + 30 } });
  }
  y += 50;
}
row(['Bageriet', 230], ['AB', 400], ['Lönebesked', 1260]);
row(['Löneperiod', 230], ['2026-09-01', 570], ['-', 760], ['2026-09-30', 790]);
row(['Löneart', 230], ['Benämning', 400], ['Kvantitet', 1400], ['Enhet', 1566], ['A-Pris', 1844], ['Belopp', 2060]);
row(['1106', 265], ['Timlön', 400], ['120,50', 1440], ['Timmar', 1566], ['180.00', 1840], ['21', 2025], ['690,00', 2075]);
row(['1149', 265], ['OB-ersättning', 400], ['1,', 640], ['timavlönad', 680], ['20,00', 1460], ['Timmar', 1566], ['50,89', 1860], ['1', 2045], ['017,80', 2070]);
row(['Bruttolön', 1772], ['22', 2100], ['707,80', 2150]);
row(['Skatt', 1772], ['6', 2140], ['000,00', 2165]);
row(['Utbetalas', 1236], ['2026-10-23', 1430], ['16', 2070], ['707,80', 2120]);

describe('a photographed pay slip', () => {
  const items = slipItemsFromWords(words, W);

  it('puts the words back into the cells a PDF would have', () => {
    const strs = items.map((i) => i.str);
    expect(strs).toContain('2026-09-01 - 2026-09-30');
    expect(strs).toContain('21 690,00');
    expect(strs).toContain('180,00');
    // A number and a word never share a cell.
    expect(strs).toContain('120,50');
    expect(strs).toContain('Timmar');
  });

  it('reads like the PDF: the lines, the period, the pay', () => {
    const slip = parsePaySlip(items, 180);
    expect(slip.periodStart).toBe('2026-09-01');
    expect(slip.periodEnd).toBe('2026-09-30');
    expect(slip.lines.map((l) => [l.code, l.quantity, l.unitPrice, l.amount, l.category])).toEqual([
      ['1106', 120.5, 180, 21690, 'wage'],
      ['1149', 20, 50.89, 1017.8, 'ob1'],
    ]);
    expect([slip.gross, slip.tax, slip.payDate, slip.net]).toEqual([22707.8, 6000, '2026-10-23', 16707.8]);
  });
});
