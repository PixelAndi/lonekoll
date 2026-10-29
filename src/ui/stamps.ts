import type { StampPair } from '../domain/model.ts';

/** "15:00–18:30 · 19:00–··" with a * after times typed by hand. */
export function stampText(rows: StampPair[], markManual = false): string {
  const t = (time: string | null, manual?: boolean) => (time ?? '··:··') + (markManual && time && manual ? '*' : '');
  return rows.map((r) => `${t(r.in, r.inManual)}–${t(r.out, r.outManual)}`).join(' · ');
}

export function hasManual(rows: StampPair[]): boolean {
  return rows.some((r) => r.inManual || r.outManual);
}
