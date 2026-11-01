import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, type CardRecord } from '../db.ts';
import { monthEnd } from '../domain/time.ts';
import { Card, Modal, PhotoThumb } from './common.tsx';

// The sources kept for a month: pictures of its timecards and the photos of
// the clock, to look up what a day's times came from.

/** An object URL for a picture, freed when no longer shown. */
export function useBlobUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function CardThumb({ card, onClick }: { card: CardRecord; onClick: () => void }) {
  const url = useBlobUrl(card.blob);
  return (
    <button type="button" className="thumb thumb-card" onClick={onClick}>
      {url && <img src={url} alt="" />}
    </button>
  );
}

/** A timecard picture full size: pinch to zoom, or open it on its own to look closer. */
export function CardViewer({ card, onClose, onDelete }: { card: CardRecord; onClose: () => void; onDelete?: () => void }) {
  const { t, fmt } = useApp();
  const url = useBlobUrl(card.blob);
  return (
    <Modal
      title={t('sources.card', { month: fmt.month(`${card.month}-01`) })}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button type="button" className="button button-danger" onClick={onDelete}>
              {t('common.delete')}
            </button>
          )}
          {url && (
            <a className="button" href={url} target="_blank" rel="noopener noreferrer">
              {t('sources.open')}
            </a>
          )}
        </>
      }
    >
      <p className="muted small">{t('sources.taken', { date: fmt.date(new Date(card.takenAt).toISOString().slice(0, 10)) })}</p>
      {url && <img className="review-photo" src={url} alt="" />}
    </Modal>
  );
}

/** The timecard a day's rows were cut from, by its id. */
export function CardById({ id, onClose }: { id: string; onClose: () => void }) {
  const card = useLiveQuery(() => db.cards.get(id), [id]);
  return card ? <CardViewer card={card} onClose={onClose} /> : null;
}

/** A month's sources: its timecards and the clock photos of its days. */
export function MonthSources({ month }: { month: string }) {
  const { t } = useApp();
  const cards = useLiveQuery(() => db.cards.where('month').equals(month).sortBy('takenAt'), [month]);
  const photos = useLiveQuery(
    () =>
      db.photos
        .where('date')
        .between(`${month}-01`, monthEnd(`${month}-01`), true, true)
        .sortBy('date'),
    [month],
  );
  const [open, setOpen] = useState<CardRecord>();
  const clock = (photos ?? []).filter((p) => p.kind !== 'timecard');
  if (!cards?.length && !clock.length) return null;
  return (
    <Card title={t('sources.title')}>
      {cards && cards.length > 0 && (
        <>
          <p className="small">{t('sources.cards', { n: cards.length })}</p>
          <div className="thumbs">
            {cards.map((c) => (
              <CardThumb key={c.id} card={c} onClick={() => setOpen(c)} />
            ))}
          </div>
        </>
      )}
      {clock.length > 0 && (
        <>
          <p className="small">{t('sources.clock', { n: clock.length })}</p>
          <div className="thumbs">
            {clock.map((p) => (
              <a key={p.id} href={`#/day/${p.date}`} className="thumb-link">
                <PhotoThumb id={p.id} />
              </a>
            ))}
          </div>
        </>
      )}
      <p className="muted small">{t('sources.local')}</p>
      {open && (
        <CardViewer
          card={open}
          onClose={() => setOpen(undefined)}
          onDelete={() => {
            if (!confirm(t('sources.deleteConfirm'))) return;
            void db.cards.delete(open.id);
            setOpen(undefined);
          }}
        />
      )}
    </Card>
  );
}
