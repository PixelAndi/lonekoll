import { useMemo, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, type SlipRecord } from '../db.ts';
import { lineKey, mergeSlip, mergeStamps, sameStamps, slipDiff, type SlipField, type Stamp, type StampDiff } from '../domain/sameData.ts';
import type { StampPair } from '../domain/model.ts';
import type { SlipLine } from '../domain/payslip.ts';
import type { TextKey } from '../i18n.ts';
import { Card, Notice } from './common.tsx';
import { stampText } from './stamps.ts';

// A day scanned or read again, beside what is saved for it: the same (nothing
// changes – it was a copy), or what the new reading adds (ticked: to be added)
// and what it lacks of what is saved (not ticked: to be removed only if the
// user says so), with how the day will be.

export function StampMerge({
  saved,
  diff,
  add,
  remove,
  onChange,
}: {
  saved: StampPair[];
  diff: StampDiff;
  add: Set<string>;
  remove: Set<string>;
  onChange: (add: Set<string>, remove: Set<string>) => void;
}) {
  const { t } = useApp();
  if (sameStamps(diff)) return <Notice kind="ok">{t('same.stampsCopy')}</Notice>;
  const label = (s: Stamp) => `${t(s.field === 'in' ? 'same.in' : 'same.out')} ${s.time}`;
  const toggle = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };
  return (
    <div className="same-merge">
      <p className="small">
        <strong>{t('same.savedDay', { stamps: stampText(saved) || '–' })}</strong>
      </p>
      {diff.added.length > 0 && (
        <fieldset>
          <legend className="small">{t('same.addedStamps')}</legend>
          {diff.added.map((s, i) => (
            <label key={`a${i}`} className="checkbox">
              <input type="checkbox" checked={add.has(s.key)} onChange={(e) => onChange(toggle(add, s.key, e.target.checked), remove)} />
              {label(s)}
            </label>
          ))}
        </fieldset>
      )}
      {diff.missing.length > 0 && (
        <fieldset>
          <legend className="small">{t('same.missingStamps')}</legend>
          {diff.missing.map((s, i) => (
            <label key={`m${i}`} className="checkbox">
              <input type="checkbox" checked={remove.has(s.key)} onChange={(e) => onChange(add, toggle(remove, s.key, e.target.checked))} />
              {t('same.remove', { stamp: label(s) })}
            </label>
          ))}
        </fieldset>
      )}
      <p className="small muted">{t('same.result', { stamps: stampText(mergeStamps(saved, diff, add, remove)) || '–' })}</p>
    </div>
  );
}

/**
 * A pay slip read again that differs from what is saved: its new lines and figures (ticked: to add),
 * the saved ones it lacks (not ticked: removed only if chosen), and figures read otherwise (not ticked:
 * kept as saved unless chosen). Nothing changes until "Spara valen"; "Behåll" drops the new reading.
 */
export function SlipMergeQuestion({ record }: { record: SlipRecord }) {
  const { t, fmt } = useApp();
  const candidate = record.candidate;
  const diff = useMemo(() => (candidate ? slipDiff(record.slip, candidate.slip) : null), [record.slip, candidate]);
  const [skipAdd, setSkipAdd] = useState<Set<string>>(new Set());
  const [doRemove, setDoRemove] = useState<Set<string>>(new Set());
  // A figure the saved slip lacks is taken by default; one read otherwise, or missing, only if chosen.
  const [fields, setFields] = useState<Set<SlipField> | null>(null);
  if (!candidate || !diff) return null;
  const chosenFields = fields ?? new Set(diff.fields.filter((f) => f.saved === undefined).map((f) => f.key));
  const toggle = <T,>(set: Set<T>, key: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };
  const lineText = (l: SlipLine) =>
    [l.text, l.from ? `${l.from}${l.to && l.to !== l.from ? `–${l.to}` : ''}` : '', l.quantity !== undefined && l.unitPrice !== undefined ? `${fmt.number(l.quantity)} × ${fmt.money(l.unitPrice)}` : '', l.amount !== undefined ? fmt.money(l.amount) : '']
      .filter(Boolean)
      .join(' · ');
  const value = (key: SlipField, v: string | number | undefined) =>
    v === undefined ? '–' : key === 'payDate' || key === 'periodEnd' ? fmt.date(String(v), 'numeric') : key === 'taxTable' ? String(v) : fmt.money(Number(v));
  const save = async () => {
    const add = new Set(diff.added.map(lineKey).filter((k) => !skipAdd.has(k)));
    const merged = mergeSlip(record.slip, diff, add, doRemove, chosenFields, candidate.slip);
    await db.slips
      .where('id')
      .equals(record.id)
      .modify((r) => {
        r.slip = merged;
        r.periodStart = merged.periodStart ?? r.periodStart;
        delete r.candidate;
      });
  };
  const keep = () =>
    db.slips
      .where('id')
      .equals(record.id)
      .modify((r) => {
        delete r.candidate;
      });
  return (
    <Card title={t('same.slipTitle', { month: record.slip.periodStart ? fmt.month(record.slip.periodStart) : record.fileName })} className="card-highlight">
      <p className="small">{t('same.slipIntro')}</p>
      <div className="same-merge">
        {diff.added.length > 0 && (
          <fieldset>
            <legend className="small">{t('same.addedLines')}</legend>
            {diff.added.map((l, i) => (
              <label key={`a${i}`} className="checkbox small">
                <input type="checkbox" checked={!skipAdd.has(lineKey(l))} onChange={(e) => setSkipAdd(toggle(skipAdd, lineKey(l), !e.target.checked))} />
                {lineText(l)}
              </label>
            ))}
          </fieldset>
        )}
        {diff.missing.length > 0 && (
          <fieldset>
            <legend className="small">{t('same.missingLines')}</legend>
            {diff.missing.map((l, i) => (
              <label key={`m${i}`} className="checkbox small">
                <input type="checkbox" checked={doRemove.has(lineKey(l))} onChange={(e) => setDoRemove(toggle(doRemove, lineKey(l), e.target.checked))} />
                {t('same.remove', { stamp: lineText(l) })}
              </label>
            ))}
          </fieldset>
        )}
        {diff.fields.length > 0 && (
          <fieldset>
            <legend className="small">{t('same.fields')}</legend>
            {diff.fields.map((f) => (
              <label key={f.key} className="checkbox small">
                <input type="checkbox" checked={chosenFields.has(f.key)} onChange={(e) => setFields(toggle(chosenFields, f.key, e.target.checked))} />
                {t(f.saved === undefined ? 'same.fieldAdd' : f.read === undefined ? 'same.fieldRemove' : 'same.fieldChange', {
                  field: t(`same.field.${f.key}` as TextKey),
                  saved: value(f.key, f.saved),
                  read: value(f.key, f.read),
                })}
              </label>
            ))}
          </fieldset>
        )}
      </div>
      <div className="button-row">
        <button type="button" className="button button-primary" onClick={() => void save()}>
          {t('same.saveChoices')}
        </button>
        <button type="button" className="button" onClick={() => void keep()}>
          {t('same.keepSaved')}
        </button>
      </div>
    </Card>
  );
}
