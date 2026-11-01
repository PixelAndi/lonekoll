import { describe, expect, it } from 'vitest';
import { cardPlace, dueForReduce, photoPlace, slipPlace } from './paths.ts';
import type { CardRecord, PhotoRecord, SlipRecord } from '../db.ts';

describe('where files go in Google Drive', () => {
  it('sorts by year and month, then what it is', () => {
    expect(photoPlace({ id: 'abcdef12-3', date: '2026-09-14', blob: new Blob([], { type: 'image/jpeg' }), createdAt: 0 } as PhotoRecord)).toEqual({
      folders: ['2026', '2026-09 september', 'Stämpelklocka'],
      name: '2026-09-14 abcdef.jpg',
      mime: 'image/jpeg',
    });
    expect(photoPlace({ id: 'x1', date: '2026-09-14', kind: 'timecard', blob: new Blob(), createdAt: 0 } as PhotoRecord).folders).toEqual(['Appdata', 'Tidkortsrader']);
    expect(cardPlace({ id: 'c1', month: '2025-11', takenAt: 0, blob: new Blob() } as CardRecord)).toMatchObject({ folders: ['2025', '2025-11 november', 'Tidkort'], name: 'Tidkort 2025-11 c1.jpg' });
    expect(slipPlace({ id: 's1', periodStart: '2026-03-01', pdf: new Blob([], { type: 'application/pdf' }) } as SlipRecord)).toMatchObject({ folders: ['2026', '2026-03 mars'], name: 'Lönebesked 2026-03 s1.pdf' });
    expect(slipPlace({ id: 's2', periodStart: '2026-03-01', pdf: new Blob([], { type: 'image/jpeg' }) } as SlipRecord).name).toBe('Lönebesked 2026-03 s2.jpg');
    // A PDF kept on the phone as a picture is still a PDF in Drive.
    expect(slipPlace({ id: 's3', periodStart: '2026-03-01', fileName: 'mars.pdf', archived: true, pdf: new Blob([], { type: 'image/jpeg' }) } as SlipRecord).name).toBe('Lönebesked 2026-03 s3.pdf');
  });

  it('reduces originals on the device after the days chosen (or never)', () => {
    const day = 86_400_000;
    expect(dueForReduce(0, 29 * day, 30)).toBe(false);
    expect(dueForReduce(0, 30 * day, 30)).toBe(true);
    expect(dueForReduce(0, 1000 * day, null)).toBe(false);
  });
});
