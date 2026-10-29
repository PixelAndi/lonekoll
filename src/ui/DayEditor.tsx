import { useMemo, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, deleteDay, saveDay } from '../db.ts';
import { OB_LEVELS } from '../domain/agreement.ts';
import { calculateShifts, type ShiftResult } from '../domain/calc.ts';
import { specialDay } from '../domain/holidays.ts';
import type { Absence, AbsenceType, DayRecord, StampPair } from '../domain/model.ts';
import { addDays, formatDuration } from '../domain/time.ts';
import { goBack, href } from '../router.ts';
import { Card, Field, Icon, Modal, Notice, Page, PhotoThumb, usePhotoUrl } from './common.tsx';
import { flushFocusedField, StampRowsEditor } from './StampRowsEditor.tsx';

const ABSENCE_TYPES: AbsenceType[] = ['sick', 'vacation', 'timebank', 'holiday', 'permission', 'unpaid'];

export function DayEditor({ date }: { date: string }) {
  const { t, fmt, days, settings } = useApp();
  const existing = days.find((d) => d.date === date);
  // Re-mount the form when the date changes so state starts from that day.
  return <DayForm key={date} date={date} existing={existing} days={days} t={t} fmt={fmt} settings={settings} />;
}

type FormProps = { date: string; existing?: DayRecord } & Pick<ReturnType<typeof useApp>, 't' | 'fmt' | 'days' | 'settings'>;

function DayForm({ date, existing, days, t, fmt, settings }: FormProps) {
  const [rows, setRows] = useState<StampPair[]>(existing?.rows ?? []);
  const [absence, setAbsence] = useState<Absence | undefined>(existing?.absence);
  const [note, setNote] = useState(existing?.note ?? '');
  const [viewPhoto, setViewPhoto] = useState<string>();
  const latestRows = useRef(rows);
  latestRows.current = rows;
  const special = specialDay(date);

  // Preview the calculation with the edited stamps.
  const preview = useMemo(() => {
    const edited: DayRecord = { date, rows, absence, photoIds: existing?.photoIds ?? [], updatedAt: 0 };
    return calculateShifts([...days.filter((d) => d.date !== date), edited], settings);
  }, [days, date, rows, absence, existing, settings]);
  const shifts = preview.results.filter((r) => r.shift.date === date);
  const continued = preview.results.find((r) => r.shift.date !== date && r.shift.dates.includes(date));
  const issues = preview.issues.filter((i) => i.date === date);

  const back = () => goBack({ name: 'days', month: date.slice(0, 7) });
  const save = async () => {
    await flushFocusedField();
    await saveDay({
      date,
      rows: latestRows.current.filter((r) => r.in || r.out),
      absence,
      note: note.trim() || undefined,
      photoIds: existing?.photoIds ?? [],
      ocrConfidence: existing?.ocrConfidence,
      updatedAt: Date.now(),
    });
    back();
  };
  const remove = async () => {
    if (!confirm(t('day.deleteConfirm', { date }))) return;
    await deleteDay(date);
    back();
  };
  const removePhoto = async (id: string) => {
    if (!existing || !confirm(t('day.deletePhoto'))) return;
    await db.photos.delete(id);
    await saveDay({ ...existing, photoIds: existing.photoIds.filter((p) => p !== id) });
    setViewPhoto(undefined);
  };

  const setAbsenceType = (type: string) => setAbsence(type ? { type: type as AbsenceType } : undefined);
  const patchAbsence = (patch: Partial<Absence>) => absence && setAbsence({ ...absence, ...patch });

  return (
    <Page
      title={fmt.date(date, 'long')}
      actions={
        <div className="day-nav">
          <a className="icon-button" href={href({ name: 'day', date: addDays(date, -1) })} aria-label={t('common.previous')}>
            <Icon name="chevronLeft" />
          </a>
          <a className="icon-button" href={href({ name: 'day', date: addDays(date, 1) })} aria-label={t('common.next')}>
            <Icon name="chevronRight" />
          </a>
        </div>
      }
    >
      {special && <Notice>{t(special.name as never)}</Notice>}
      <Card title={t('day.stamps')}>
        {continued && <p className="muted small">↩ {t('days.continued')}</p>}
        <StampRowsEditor rows={rows} onChange={setRows} />
        <p className="muted small">{t('day.midnightHint')}</p>
      </Card>

      <Card title={t('day.absence')}>
        <Field label={t('day.absence')}>
          <select value={absence?.type ?? ''} onChange={(e) => setAbsenceType(e.target.value)}>
            <option value="">{t('absence.none')}</option>
            {ABSENCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`absence.${type}`)}
              </option>
            ))}
          </select>
        </Field>
        {(absence?.type === 'timebank' || absence?.type === 'permission') && (
          <Field label={t('day.hours')}>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.25"
              value={absence.hours ?? ''}
              onChange={(e) => patchAbsence({ hours: e.target.value ? Number(e.target.value) : undefined })}
            />
          </Field>
        )}
        {(absence?.type === 'sick' || absence?.type === 'holiday') && (
          <>
            <div className="field-row">
              <Field label={`${t('day.booked')} – ${t('day.in')}`}>
                <input type="time" value={absence.bookedStart ?? ''} onChange={(e) => patchAbsence({ bookedStart: e.target.value || undefined })} />
              </Field>
              <Field label={t('day.out')}>
                <input type="time" value={absence.bookedEnd ?? ''} onChange={(e) => patchAbsence({ bookedEnd: e.target.value || undefined })} />
              </Field>
            </div>
            <p className="muted small">{t(absence.type === 'sick' ? 'day.bookedHint.sick' : 'day.bookedHint.holiday')}</p>
          </>
        )}
        <Field label={t('day.note')}>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Card>

      <Card title={t('day.calculated')}>
        {shifts.length === 0 && issues.length === 0 && <p className="muted">{t('day.nothing')}</p>}
        {issues.map((i) => (
          <Notice key={i.code + i.time} kind="error">
            {t(`issue.${i.code}`, { time: i.time })}
          </Notice>
        ))}
        {shifts.map((r) => (
          <ShiftSummary key={r.shift.start} result={r} />
        ))}
      </Card>

      {existing && existing.photoIds.length > 0 && (
        <Card title={t('day.photos')}>
          <div className="thumbs">
            {existing.photoIds.map((id) => (
              <PhotoThumb key={id} id={id} onClick={() => setViewPhoto(id)} />
            ))}
          </div>
        </Card>
      )}

      <div className="form-actions">
        {existing && (
          <button type="button" className="button button-danger" onClick={remove}>
            {t('common.delete')}
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="button" onClick={back}>
          {t('common.cancel')}
        </button>
        <button type="button" className="button button-primary" onClick={save}>
          {t('common.save')}
        </button>
      </div>
      {viewPhoto && <PhotoViewer id={viewPhoto} onClose={() => setViewPhoto(undefined)} onDelete={() => removePhoto(viewPhoto)} />}
    </Page>
  );
}

export function ShiftSummary({ result }: { result: ShiftResult }) {
  const { t, settings } = useApp();
  const r = result;
  const limit = formatDuration(settings.ordinaryShiftMinutes);
  return (
    <div className="shift-summary">
      <h3>{t('day.shift', { start: r.startTime, end: r.endTime })}</h3>
      <dl className="kv">
        <div className="kv-pair">
          <dt>{t('day.worked')}</dt>
          <dd>{formatDuration(r.shift.workedMinutes)}</dd>
        </div>
        {OB_LEVELS.filter((l) => r.obMinutes[l] > 0).map((l) => (
          <div key={l} className="kv-pair">
            <dt>{t(`cat.ob${l}`)}</dt>
            <dd>{formatDuration(r.obMinutes[l])}</dd>
          </div>
        ))}
        {r.overtime50 > 0 && (
          <div className="kv-pair">
            <dt>{t('cat.ot50')}</dt>
            <dd>{formatDuration(r.overtime50)}</dd>
          </div>
        )}
        {r.overtime100 > 0 && (
          <div className="kv-pair">
            <dt>{t('cat.ot100')}</dt>
            <dd>{formatDuration(r.overtime100)}</dd>
          </div>
        )}
      </dl>
      {r.overtimeReason && <p className="muted small">{t('day.overtime')}: {t(`day.overtimeReason.${r.overtimeReason}`, { limit })}</p>}
      {r.warnings.map((w) => (
        <Notice key={w} kind="warn">
          {t(`warn.${w}`)}
        </Notice>
      ))}
    </div>
  );
}

function PhotoViewer({ id, onClose, onDelete }: { id: string; onClose: () => void; onDelete: () => void }) {
  const { t } = useApp();
  const url = usePhotoUrl(id);
  return (
    <Modal
      title={t('day.photos')}
      onClose={onClose}
      footer={
        <button type="button" className="button button-danger" onClick={onDelete}>
          {t('common.delete')}
        </button>
      }
    >
      {url && <img className="review-photo" src={url} alt="" />}
    </Modal>
  );
}
