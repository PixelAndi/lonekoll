import { describe, expect, it } from 'vitest';
import { mergeFromCloud, type CloudData } from './merge.ts';
import type { DayRecord } from '../domain/model.ts';

const day = (date: string, updatedAt: number) => ({ date, rows: [], photoIds: [], updatedAt }) as unknown as DayRecord;
const remote = (patch: Partial<CloudData>): CloudData => ({ app: 'lonekoll', version: 1, deviceId: 'other', savedAt: 1, days: [], photos: [], slips: [], cards: [], files: {}, ...patch });

describe('taking in what another phone added', () => {
  it('takes new days and days changed later there, keeps the rest', () => {
    const m = mergeFromCloud(
      { days: [day('2026-01-02', 5), day('2026-01-03', 9)], photos: [], slips: [], cards: [] },
      remote({ days: [day('2026-01-01', 1), day('2026-01-02', 7), day('2026-01-03', 8)] }),
    );
    expect(m.days.map((d) => d.date)).toEqual(['2026-01-01', '2026-01-02']);
  });

  it('takes records this phone lacks, only those whose file is in Drive', () => {
    const m = mergeFromCloud(
      { days: [], photos: [{ id: 'a' }], slips: [], cards: [] },
      remote({
        photos: [{ id: 'a', date: '2026-01-01', createdAt: 0 }, { id: 'b', date: '2026-01-01', createdAt: 0 }, { id: 'c', date: '2026-01-01', createdAt: 0 }],
        cards: [{ id: 'k', month: '2026-01', takenAt: 0 }],
        files: { 'photo:a': '1', 'photo:b': '2', 'card:k': '3' },
      }),
    );
    expect(m.photos.map((p) => p.id)).toEqual(['b']);
    expect(m.cards.map((c) => c.id)).toEqual(['k']);
  });
});
