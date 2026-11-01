import type { OcrWord } from './parse.ts';

// PaddleOCR (PP-OCRv4) for photographed pay slips: a detection model marks
// where text is (a probability per pixel), each text line is cut out and a
// recognition model reads it (a character per time step, CTC). The models run
// in workers (paddleWorker.ts); this file is the part around them, pure so it
// can be tested: finding the lines in the probability map, decoding what the
// recognition model says, placing each word on the page, and putting back
// the å, ä and ö the model doesn't know.

/** A line of text on the page: its middle, length along it, height across it and slope (radians). */
export interface TextBox {
  cx: number;
  cy: number;
  length: number;
  height: number;
  angle: number;
  /** The mean probability of text inside it. */
  score: number;
}

/**
 * The text lines in a detection map (DB): pixels above the threshold, joined
 * into pieces (4-connected). Printed lines on a page share one slope, taken
 * from the long pieces; each piece is measured along and across it and
 * widened as DB's "unclip" does (the model marks a shrunk core of the text).
 */
export function textBoxes(prob: Float32Array, width: number, height: number, threshold = 0.3, minScore = 0.5): TextBox[] {
  const n = width * height;
  const seen = new Uint8Array(n);
  const pixels = new Int32Array(n);
  const pieces: { from: number; to: number; sum: number }[] = [];
  let used = 0;
  for (let start = 0; start < n; start++) {
    if (seen[start] || prob[start] <= threshold) continue;
    const from = used;
    let sum = 0;
    seen[start] = 1;
    pixels[used++] = start;
    for (let k = from; k < used; k++) {
      const i = pixels[k];
      sum += prob[i];
      const x = i % width;
      const near = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width];
      for (const j of near) {
        if (j < 0 || j >= n || seen[j] || prob[j] <= threshold) continue;
        seen[j] = 1;
        pixels[used++] = j;
      }
    }
    if (used - from >= 6) pieces.push({ from, to: used, sum });
  }

  // The page's slope: the median of the long pieces' own (principal axis) slopes.
  const slopes: number[] = [];
  for (const p of pieces) {
    let mx = 0, my = 0;
    for (let k = p.from; k < p.to; k++) {
      mx += pixels[k] % width;
      my += Math.floor(pixels[k] / width);
    }
    const count = p.to - p.from;
    mx /= count;
    my /= count;
    let sxx = 0, syy = 0, sxy = 0;
    for (let k = p.from; k < p.to; k++) {
      const dx = (pixels[k] % width) - mx;
      const dy = Math.floor(pixels[k] / width) - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    // Long and thin: a line of text, whose slope can be trusted.
    if (sxx > 9 * syy && count > 60) slopes.push(0.5 * Math.atan2(2 * sxy, sxx - syy));
  }
  slopes.sort((a, b) => a - b);
  const angle = slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const boxes: TextBox[] = [];
  for (const p of pieces) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = p.from; k < p.to; k++) {
      const x = pixels[k] % width;
      const y = Math.floor(pixels[k] / width);
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    let length = u1 - u0 + 1;
    let tall = v1 - v0 + 1;
    const score = p.sum / (p.to - p.from);
    if (tall < 3 || score < minScore) continue;
    // DB's unclip: the shrunk core widened by area × 1.5 / perimeter on every side.
    const grow = (length * tall * 1.5) / (2 * (length + tall));
    length += 2 * grow;
    tall += 2 * grow;
    const u = (u0 + u1) / 2;
    const v = (v0 + v1) / 2;
    boxes.push({ cx: u * cos - v * sin, cy: u * sin + v * cos, length, height: tall, angle, score });
  }
  return boxes;
}

/** What the recognition model read in a line: the text, how sure it is, and the time step of each character. */
export interface LineReading {
  text: string;
  confidence: number;
  /** The time step each character was read at (for where it is along the line). */
  at: number[];
  steps: number;
}

/**
 * Greedy CTC decoding: the likeliest class at each time step, repeats
 * merged and blanks (class 0) dropped. Class k is dict[k - 1]; PaddleOCR's
 * dictionary has a space appended at its end.
 */
export function ctcDecode(data: Float32Array, steps: number, classes: number, dict: string[]): LineReading {
  let text = '';
  let sure = 0;
  const at: number[] = [];
  let last = -1;
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let p = data[t * classes];
    for (let c = 1; c < classes; c++) {
      const v = data[t * classes + c];
      if (v > p) {
        p = v;
        best = c;
      }
    }
    if (best !== 0 && best !== last) {
      text += dict[best - 1] ?? '';
      sure += p;
      at.push(t);
    }
    last = best;
  }
  return { text, confidence: at.length ? sure / at.length : 0, at, steps };
}

/**
 * The words of a line read, each with its box on the page: a word runs from
 * its first character's time step to its last, along the line's slope.
 */
export function wordsOfLine(reading: LineReading, box: TextBox): OcrWord[] {
  const words: OcrWord[] = [];
  const cos = Math.cos(box.angle);
  const sin = Math.sin(box.angle);
  const step = box.length / Math.max(1, reading.steps);
  const chars = [...reading.text];
  let k = 0;
  while (k < chars.length) {
    if (chars[k] === ' ') {
      k++;
      continue;
    }
    let end = k;
    while (end + 1 < chars.length && chars[end + 1] !== ' ') end++;
    const text = chars.slice(k, end + 1).join('');
    // Along the line, from the middle of the box: the first character's step to the last one's end.
    const u0 = reading.at[k] * step - box.length / 2 - step;
    const u1 = (reading.at[end] + 1) * step - box.length / 2 + step;
    const corners = [u0, u1].flatMap((u) =>
      [-box.height / 2, box.height / 2].map((v) => ({ x: box.cx + u * cos - v * sin, y: box.cy + u * sin + v * cos })),
    );
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    words.push({
      text,
      confidence: Math.round(reading.confidence * 100),
      bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
    });
    k = end + 1;
  }
  return words;
}

/**
 * Words printed on pay slips with å, ä or ö, which the recognition model
 * reads without them ("Bruttolon"), sometimes with a digit for a letter
 * ("Tim18n"). Matched without accents and with such digits as letters.
 */
const SWEDISH = [
  'Lönebesked', 'Löneperiod', 'Löneart', 'Benämning', 'Anställningsnummer', 'Timlön', 'Bruttolön', 'Förmån',
  'beräknad', 'Engångsskatt', 'Övriga', 'Övrig', 'Öresutjämning', 'Ersättning', 'ersättning', 'Arbetsgivaravgift',
  'Preliminär', 'Semesterdaglön', 'Sjuklön', 'Övertid', 'övertid', 'Helglön', 'OB-ersättning', 'Tjänstledig',
  'Föräldraledig', 'Frånvaro', 'Frånvaroavdrag', 'Löneavdrag', 'Grundlön', 'Månadslön', 'Lön', 'lön', 'Skifttillägg',
  'Tillägg', 'tillägg', 'Förskjuten', 'Semestertillägg', 'Semesterersättning', 'Utbet.', 'för', 'från', 'Ränta',
];
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Digits the model reads for letters in a word. */
const asLetters = (s: string) => s.replace(/8/g, 'o').replace(/1/g, 'l').replace(/0/g, 'o');
const LEXICON = new Map(SWEDISH.map((w) => [fold(w), w]));

/** A word read without its å, ä or ö (or with a digit for a letter) put back as printed. */
export function restoreSwedish(word: string): string {
  const m = word.match(/^(.*?)([:,.]?)$/)!;
  const [core, tail] = [m[1], m[2]];
  if (!/[a-z]/i.test(core)) return word;
  const found = LEXICON.get(fold(core)) ?? LEXICON.get(asLetters(fold(core)));
  if (!found) return word;
  // Keep the case as read for the first letter (a heading or a word inside a line).
  const first = core[0] === core[0].toUpperCase() ? found[0].toUpperCase() : found[0].toLowerCase();
  return first + found.slice(1) + tail;
}

/** Phrases whose short words can't be told by themselves: "beraknad pa", "i ar". */
export function restorePhrases(words: OcrWord[]): OcrWord[] {
  return words.map((w, i) => {
    const before = words[i - 1]?.text.toLowerCase();
    if (/^pa$/i.test(w.text) && before === 'beräknad') return { ...w, text: 'på' };
    if (/^ar$/i.test(w.text) && before === 'i') return { ...w, text: 'år' };
    if (/^iar$/i.test(w.text)) return { ...w, text: 'i år' };
    return w;
  });
}
