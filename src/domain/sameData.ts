import type { StampPair } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';

// Something scanned or added again: what the new reading adds, what it lacks
// of what is saved, or that it is the same. Nothing is changed on its own –
// the user says which of the new things to add and which of the missing ones
// to remove (by default: add what is new, remove nothing).

// ---- Stamps of a day ----

export interface Stamp {
  field: 'in' | 'out';
  time: string;
  /** Its key, for the choices: "in@06:00". */
  key: string;
  /** The other stamp of its pair in the reading it comes from (to pair it again). */
  partner: string | null;
}

export interface StampDiff {
  added: Stamp[];
  missing: Stamp[];
}

function stamps(rows: StampPair[]): Stamp[] {
  return rows.flatMap((r) =>
    (['in', 'out'] as const)
      .filter((f) => r[f])
      .map((field) => ({ field, time: r[field]!, key: `${field}@${r[field]}`, partner: r[field === 'in' ? 'out' : 'in'] ?? null })),
  );
}

/** Stamps of the new reading not saved, and saved ones the new reading lacks (each time counted as often as it occurs). */
export function stampDiff(saved: StampPair[], read: StampPair[]): StampDiff {
  const a = stamps(saved);
  const b = stamps(read);
  const take = (from: Stamp[], other: Stamp[]) => {
    const left = [...other];
    return from.filter((s) => {
      const i = left.findIndex((o) => o.key === s.key);
      if (i < 0) return true;
      left.splice(i, 1);
      return false;
    });
  };
  return { added: take(b, a), missing: take(a, b) };
}

export const sameStamps = (d: StampDiff) => !d.added.length && !d.missing.length;

/** The saved rows with the chosen new stamps added (paired as in the new reading) and the chosen missing ones removed. */
export function mergeStamps(saved: StampPair[], diff: StampDiff, add: Set<string>, remove: Set<string>): StampPair[] {
  const rows: StampPair[] = saved.map((r) => ({ ...r }));
  for (const s of diff.missing.filter((m) => remove.has(m.key))) {
    const row = rows.find((r) => r[s.field] === s.time);
    if (!row) continue;
    row[s.field] = null;
    delete row[`${s.field}Manual`];
    delete row[`${s.field}Read`];
    delete row[`${s.field}Doubt`];
  }
  for (const s of diff.added.filter((a) => add.has(a.key))) {
    const other = s.field === 'in' ? 'out' : 'in';
    // Beside its partner when that is saved (or was just added), else in a free place, else a row of its own.
    const row = (s.partner && rows.find((r) => r[other] === s.partner && !r[s.field])) ?? rows.find((r) => !r[s.field] && !r[other]);
    if (row) row[s.field] = s.time;
    else rows.push({ in: s.field === 'in' ? s.time : null, out: s.field === 'out' ? s.time : null });
  }
  return rows.filter((r) => r.in || r.out).sort((x, y) => (x.in ?? x.out ?? '').localeCompare(y.in ?? y.out ?? ''));
}

// ---- A pay slip ----

/** The figures of a slip that are compared besides its lines. */
export const SLIP_FIELDS = ['periodEnd', 'payDate', 'gross', 'tax', 'net', 'otherDeductions', 'taxTable'] as const;
export type SlipField = (typeof SLIP_FIELDS)[number];

export interface FieldChange {
  key: SlipField;
  saved?: string | number;
  read?: string | number;
}

export interface SlipDiff {
  added: SlipLine[];
  missing: SlipLine[];
  /** Figures the new reading has that are not saved, has otherwise, or lacks. */
  fields: FieldChange[];
}

export const lineKey = (l: SlipLine) => [l.code, l.text, l.from ?? '', l.to ?? '', l.quantity ?? '', l.unitPrice ?? '', l.amount ?? ''].join('|');

export function slipDiff(saved: PaySlip, read: PaySlip): SlipDiff {
  const take = (from: SlipLine[], other: SlipLine[]) => {
    const left = other.map(lineKey);
    return from.filter((l) => {
      const i = left.indexOf(lineKey(l));
      if (i < 0) return true;
      left.splice(i, 1);
      return false;
    });
  };
  const fields: FieldChange[] = [];
  for (const key of SLIP_FIELDS) {
    const a = saved[key];
    const b = read[key];
    if (a !== b && !(a === undefined && b === undefined)) fields.push({ key, saved: a, read: b });
  }
  // A pay day filled in from the settings is no figure read from the slip.
  const real = fields.filter((f) => !(f.key === 'payDate' && read.payDateFrom === 'setting'));
  return { added: take(read.lines, saved.lines), missing: take(saved.lines, read.lines), fields: real };
}

export const sameSlipData = (d: SlipDiff) => !d.added.length && !d.missing.length && !d.fields.length;

/** The saved slip with the chosen new lines added, the chosen missing ones removed and the chosen figures taken from the new reading. */
export function mergeSlip(saved: PaySlip, diff: SlipDiff, add: Set<string>, remove: Set<string>, fields: Set<SlipField>, read: PaySlip): PaySlip {
  const removed = new Set<string>();
  const lines = saved.lines.filter((l) => {
    const k = lineKey(l);
    if (remove.has(k) && diff.missing.some((m) => lineKey(m) === k) && !removed.has(k)) {
      removed.add(k);
      return false;
    }
    return true;
  });
  lines.push(...diff.added.filter((l) => add.has(lineKey(l))));
  const out: PaySlip = { ...saved, lines };
  for (const f of diff.fields) if (fields.has(f.key)) (out as unknown as Record<string, unknown>)[f.key] = read[f.key];
  if (fields.has('payDate')) out.payDateFrom = read.payDateFrom;
  return out;
}
