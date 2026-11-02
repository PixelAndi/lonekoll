import { useState } from 'react';
import { useApp } from '../app-context.ts';
import { saveDay } from '../db.ts';
import { isHoliday } from '../domain/holidays.ts';
import type { AbsenceType, DayRecord } from '../domain/model.ts';
import { usualWeekdays } from '../domain/reportCheck.ts';
import { datesInRange, isoWeekday, todayLocal } from '../domain/time.ts';
import { sickPeriodOn } from '../domain/sick.ts';
import { Field, Modal } from './common.tsx';
import { SickInfo } from './SickInfo.tsx';
import { TimeField } from './StampRowsEditor.tsx';

// Registering sickness or time off for a day or a stretch of days, without
// opening each day: from–to, the kind of leave, and for sickness the shift
// you were booked for (else sick pay goes by your recent shifts) and what the
// law asks of you on which day. Days that already have stamps are left alone;
// over several days only your usual working days are marked.

const LEAVE: AbsenceType[] = ['vacation', 'komp', 'timebank', 'permission', 'unpaid'];

export function AbsenceSheet({ kind, onClose }: { kind: 'sick' | 'leave'; onClose: () => void }) {
  const { t, days } = useApp();
  const today = todayLocal();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [type, setType] = useState<AbsenceType>(kind === 'sick' ? 'sick' : 'vacation');
  const [bookedStart, setBookedStart] = useState<string | null>(null);
  const [bookedEnd, setBookedEnd] = useState<string | null>(null);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const usual = usualWeekdays(days, today);
  const range = from && to && from <= to ? datesInRange(from, to) : [];
  // One day: that day. Several: the usual working days in them, not public holidays.
  const chosen = range.length === 1 ? range : range.filter((d) => usual.has(isoWeekday(d)) && !isHoliday(d));
  const free = chosen.filter((d) => !(byDate.get(d)?.rows.length ?? 0));
  // The sick period these days make (with any before them), seen from the first of them.
  const sickPeriod = kind === 'sick' && free.length ? sickPeriodOn(days, free[0], free) : null;

  const save = async () => {
    for (const date of free) {
      const before = byDate.get(date);
      const day: DayRecord = {
        ...(before ?? { date, rows: [], photoIds: [] }),
        absence: type === 'sick' ? { type, bookedStart: bookedStart ?? undefined, bookedEnd: bookedEnd ?? undefined } : { type },
        updatedAt: Date.now(),
      };
      await saveDay(day);
    }
    onClose();
  };

  return (
    <Modal
      title={t(kind === 'sick' ? 'absenceSheet.sickTitle' : 'absenceSheet.leaveTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="button button-primary" disabled={!free.length} onClick={() => void save()}>
            {free.length > 1 ? t('absenceSheet.saveDays', { n: free.length }) : t('absenceSheet.save')}
          </button>
        </>
      }
    >
      {kind === 'leave' && (
        <Field label={t('day.absence')}>
          <select value={type} onChange={(e) => setType(e.target.value as AbsenceType)}>
            {LEAVE.map((l) => (
              <option key={l} value={l}>
                {t(`absence.${l}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="field-row">
        <Field label={t('absenceSheet.from')}>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              if (e.target.value > to) setTo(e.target.value);
            }}
          />
        </Field>
        <Field label={t('absenceSheet.to')}>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {range.length > 1 && <p className="small muted">{t('absenceSheet.workdays', { n: chosen.length })}</p>}
      {chosen.length > free.length && <p className="small muted">{t('absenceSheet.hasStamps', { n: chosen.length - free.length })}</p>}
      {kind === 'sick' && (
        <>
          <div className="field">
            <span className="field-label">{t('day.booked')}</span>
            <div className="field-row">
              <TimeField label={t('day.in')} value={bookedStart} onChange={setBookedStart} />
              <TimeField label={t('day.out')} value={bookedEnd} onChange={setBookedEnd} />
            </div>
            <span className="field-hint">{t('day.bookedHint.sick')}</span>
          </div>
          {sickPeriod && <SickInfo period={sickPeriod} />}
        </>
      )}
    </Modal>
  );
}
