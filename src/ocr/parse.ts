// Turns OCR words from the clock screen into a date and In/Ut stamp rows.
//
// Screen layout (one calendar day per screen):
//   [<< Föreg Dag]   [Tor 2026-10-29]   [Nästa Dag >>]      <- light cyan bar
//   Sch Tid | Saknas | In | Typ | Ut | Typ | Schema         <- lavender header
//   00:00   | 00:00  | 15:05 | In | 17:20 | Ut | Ldg        <- first row
//                    | 17:50 | In | 23:10 | Ut              <- more rows
// A missing stamp is shown as "xx:xx".

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface StampRow {
  in: string | null;
  out: string | null;
}

/** A row as read by OCR, with the confidence (0-100) of each time. */
export interface ReadRow extends StampRow {
  inConfidence?: number;
  outConfidence?: number;
}

/** Column centres as a fraction of the bar width, measured on real photos. */
const COLUMNS = { schTid: 0.18, saknas: 0.335, in: 0.475, out: 0.69 } as const;

export interface Parsed<T> {
  value: T;
  /** Lowest OCR confidence (0-100) of the words the value was read from. */
  confidence: number;
}

export function parseDate(words: OcrWord[]): Parsed<string | null> {
  const digitWords = words.filter((w) => /\d/.test(w.text));
  const compact = digitWords.map((w) => w.text).join('').replace(/\s+/g, '');
  const m = compact.match(/(20\d{2})-?(\d{2})-?(\d{2})/);
  if (!m) return { value: null, confidence: 0 };
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return { value: null, confidence: 0 };
  return { value: `${y}-${mo}-${d}`, confidence: Math.min(...digitWords.map((w) => w.confidence)) };
}

type Token = { kind: 'time'; value: string } | { kind: 'missing' };

/** Reads "15:05", "1505", "15.05" or the "xx:xx" placeholder. */
export function readTimeToken(raw: string): Token | null {
  const text = raw.trim();
  if (/^[xX×]{1,2}[:.;]?[xX×]{1,2}$/.test(text)) return { kind: 'missing' };
  const m = text.match(/^(\d{1,2})[:.;]?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  if (m[1].length + m[2].length < 3) return null;
  return { kind: 'time', value: `${String(h).padStart(2, '0')}:${m[2]}` };
}

interface Placed {
  token: Token;
  confidence: number;
  cx: number;
  cy: number;
  height: number;
}

export function parseRows(words: OcrWord[], cropWidth: number): Parsed<ReadRow[]> {
  const placed: Placed[] = [];
  for (const w of words) {
    const token = readTimeToken(w.text);
    if (!token) continue;
    placed.push({
      token,
      confidence: w.confidence,
      cx: (w.bbox.x0 + w.bbox.x1) / 2 / cropWidth,
      cy: (w.bbox.y0 + w.bbox.y1) / 2,
      height: w.bbox.y1 - w.bbox.y0,
    });
  }
  if (placed.length === 0) return { value: [], confidence: 0 };

  const heights = placed.map((p) => p.height).sort((a, b) => a - b);
  const lineGap = heights[Math.floor(heights.length / 2)] * 0.7;
  placed.sort((a, b) => a.cy - b.cy);
  const lines: Placed[][] = [];
  for (const p of placed) {
    const line = lines[lines.length - 1];
    if (line && p.cy - line[line.length - 1].cy < lineGap) line.push(p);
    else lines.push([p]);
  }

  const rows: ReadRow[] = [];
  const used: number[] = [];
  for (const line of lines) {
    const row: ReadRow & { seen: boolean } = { in: null, out: null, seen: false };
    for (const p of line) {
      const column = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).reduce((best, key) =>
        Math.abs(COLUMNS[key] - p.cx) < Math.abs(COLUMNS[best] - p.cx) ? key : best,
      );
      if (Math.abs(COLUMNS[column] - p.cx) > 0.09) continue;
      if (column !== 'in' && column !== 'out') continue;
      row.seen = true;
      if (p.token.kind === 'time') {
        row[column] = p.token.value;
        row[column === 'in' ? 'inConfidence' : 'outConfidence'] = p.confidence;
        used.push(p.confidence);
      }
    }
    if (row.seen) {
      const { seen: _seen, ...read } = row;
      rows.push(read);
    }
  }
  // A row with neither stamp (both "xx:xx") is how the screen shows an empty day.
  return {
    value: rows.filter((r) => r.in !== null || r.out !== null),
    confidence: used.length ? Math.min(...used) : 100,
  };
}

export type ReadingIssue = 'no-table' | 'no-date' | 'no-rows' | 'out-of-order' | 'implausible';

/** No row on the clock screen spans more than this (it splits shifts at midnight). */
const MAX_ROW_MINUTES = 13 * 60;

export function checkPlausible(rows: StampRow[]): boolean {
  return rows.every((r) => {
    if (!r.in || !r.out) return true;
    const [ih, im] = r.in.split(':').map(Number);
    const [oh, om] = r.out.split(':').map(Number);
    const span = oh * 60 + om - (ih * 60 + im);
    return span >= 0 && span <= MAX_ROW_MINUTES;
  });
}

export function checkOrder(rows: StampRow[]): boolean {
  let last = -1;
  for (const r of rows) {
    for (const t of [r.in, r.out]) {
      if (!t) continue;
      const [h, m] = t.split(':').map(Number);
      const minutes = h * 60 + m;
      if (minutes < last) return false;
      last = minutes;
    }
  }
  return true;
}
