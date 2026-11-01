import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, type CardRecord } from '../db.ts';
import { monthEnd } from '../domain/time.ts';
import { Card, Modal, Notice, PhotoThumb } from './common.tsx';
import { useOriginal } from '../cloud/useCloud.ts';
import { canShareFiles, shareFiles } from '../share.ts';
import { cardPlace, photoPlace, slipPlace } from '../cloud/paths.ts';

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
  const original = useOriginal(`card:${card.id}`);
  const url = useBlobUrl(original.blob ?? card.blob);
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
          {card.archived && !original.blob && <OriginalButton busy={original.busy} onClick={() => void original.load()} />}
          {url && (
            <a className="button" href={url} target="_blank" rel="noopener noreferrer">
              {t('sources.open')}
            </a>
          )}
        </>
      }
    >
      <p className="muted small">{t('sources.taken', { date: fmt.date(new Date(card.takenAt).toISOString().slice(0, 10)) })}</p>
      <PreviewNote archived={card.archived} fetched={!!original.blob} error={original.error} />
      {url && <img className="review-photo" src={url} alt="" />}
    </Modal>
  );
}

/** Fetches the full original of a picture kept on the phone only as a preview. */
export function OriginalButton({ busy, onClick }: { busy?: boolean; onClick: () => void }) {
  const { t } = useApp();
  return (
    <button type="button" className="button" disabled={busy} onClick={onClick}>
      {busy ? t('cloud.fetching') : t('cloud.original')}
    </button>
  );
}

export function PreviewNote({ archived, fetched, error }: { archived?: boolean; fetched: boolean; error?: string }) {
  const { t } = useApp();
  if (error) return <Notice kind="error">{t('cloud.failed', { error })}</Notice>;
  if (!archived || fetched) return null;
  return <p className="muted small">{t('cloud.preview')}</p>;
}

/** The timecard a day's rows were cut from, by its id. */
export function CardById({ id, onClose }: { id: string; onClose: () => void }) {
  const card = useLiveQuery(() => db.cards.get(id), [id]);
  return card ? <CardViewer card={card} onClose={onClose} /> : null;
}

/** A month's sources: its timecards and the clock photos of its days. */
export function MonthSources({ month }: { month: string }) {
  const { t, settings } = useApp();
  const cards = useLiveQuery(() => db.cards.where('month').equals(month).sortBy('takenAt'), [month]);
  const slips = useLiveQuery(() => db.slips.where('periodStart').between(`${month}-01`, `${month}-31`, true, true).toArray(), [month]);
  const [shareError, setShareError] = useState<string>();
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
      <p className="muted small">{t(settings.cloud?.mode === 'drive' ? 'sources.drive' : 'sources.local')}</p>
      {canShareFiles() && (
        <button
          type="button"
          className="button button-small"
          onClick={() => {
            // The files on the phone, named as in Drive; straight after the tap, as the share sheet requires.
            const files = [
              ...(cards ?? []).map((c) => new File([c.blob], cardPlace(c).name, { type: c.blob.type || 'image/jpeg' })),
              ...clock.map((p) => new File([p.blob], photoPlace(p).name, { type: p.blob.type || 'image/jpeg' })),
              ...(slips ?? []).map((s) => {
                const place = slipPlace(s);
                // A slip kept only as a preview is a picture now, whatever it was.
                const name = s.archived ? place.name.replace(/\.pdf$/, '.jpg') : place.name;
                return new File([s.pdf], name, { type: s.pdf.type || place.mime });
              }),
            ];
            setShareError(undefined);
            shareFiles(files, t('sources.shareTitle', { month })).catch((e: unknown) => setShareError(e instanceof Error ? e.message : String(e)));
          }}
        >
          {t('sources.share')}
        </button>
      )}
      {shareError && <Notice kind="error">{shareError}</Notice>}
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
