import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, type SlipRecord } from '../db.ts';
import { datesIn, type PaySlip } from '../domain/payslip.ts';
import { Card, Field, Notice } from './common.tsx';
import { useBlobUrl } from './Sources.tsx';
import { decimalText, numberOrUndefined } from './settings/inputs.tsx';

// After a slip is read – above all from a photo – the user checks what
// matters most: the pay period (which month everything is compared with),
// the pay day and the totals. A period the app had to work out, or whose
// year it corrected, is pointed out.

/** Whether a slip should be checked before its comparison is trusted. */
export const needsCheck = (record: SlipRecord) => !record.slip.checked && (!!record.slip.periodDoubt || /^image\//.test(record.pdf.type));

/** The sum of the slip's pay lines, to set beside its gross pay. */
const linesSum = (slip: PaySlip) => Math.round(slip.lines.reduce((sum, l) => sum + (l.amount ?? 0), 0) * 100) / 100;

export function SlipCheck({ id }: { id: string }) {
  const record = useLiveQuery(() => db.slips.get(id), [id]);
  const [editing, setEditing] = useState(false);
  const { t } = useApp();
  if (!record) return null;
  if (!needsCheck(record) && !editing)
    return (
      <p className="small">
        <button type="button" className="link-button" onClick={() => setEditing(true)}>
          {t('slipCheck.edit')}
        </button>
      </p>
    );
  return <CheckForm record={record} onDone={() => setEditing(false)} />;
}

function CheckForm({ record, onDone }: { record: SlipRecord; onDone: () => void }) {
  const { t, fmt, lang } = useApp();
  const slip = record.slip;
  const [draft, setDraft] = useState(() => ({
    start: slip.periodStart ?? '',
    end: slip.periodEnd ?? '',
    payDate: slip.payDate ?? '',
    gross: decimalText(slip.gross, lang),
    tax: decimalText(slip.tax, lang),
    net: decimalText(slip.net, lang),
  }));
  const photo = /^image\//.test(record.pdf.type);
  const url = useBlobUrl(photo ? record.pdf : undefined);
  const [big, setBig] = useState(false);
  const sum = linesSum(slip);
  const gross = numberOrUndefined(draft.gross);
  const valid = (d: string) => datesIn(d).length === 1;
  const periodOk = valid(draft.start) && valid(draft.end) && draft.start <= draft.end;

  const save = async () => {
    const next: PaySlip = {
      ...slip,
      periodStart: draft.start,
      periodEnd: draft.end,
      payDate: valid(draft.payDate) ? draft.payDate : undefined,
      gross,
      tax: numberOrUndefined(draft.tax),
      net: numberOrUndefined(draft.net),
      periodDoubt: undefined,
      checked: true,
    };
    await db.slips.update(record.id, { slip: next, periodStart: draft.start });
    onDone();
  };

  const set = (key: keyof typeof draft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  return (
    <Card title={t('slipCheck.title')} className="slip-check">
      <p className="small">{t(photo ? 'slipCheck.introPhoto' : 'slipCheck.intro')}</p>
      {slip.periodDoubt === 'guessed' && <Notice kind="warn">{t('slipCheck.guessed')}</Notice>}
      {slip.periodDoubt === 'yearFixed' && <Notice kind="warn">{t('slipCheck.yearFixed')}</Notice>}
      {url && (
        <button type="button" className={`slip-check-photo ${big ? 'big' : ''}`} onClick={() => setBig(!big)} aria-label={t('slipCheck.zoom')}>
          <img src={url} alt="" />
        </button>
      )}
      <div className="slip-check-grid">
        <Field label={t('slipCheck.from')}>
          <input type="date" value={draft.start} onChange={set('start')} />
        </Field>
        <Field label={t('slipCheck.to')}>
          <input type="date" value={draft.end} onChange={set('end')} />
        </Field>
        <Field label={t('report.payDate')}>
          <input type="date" value={draft.payDate} onChange={set('payDate')} />
        </Field>
        <Field label={t('slips.gross')}>
          <input type="text" inputMode="decimal" value={draft.gross} onChange={set('gross')} />
        </Field>
        <Field label={t('slipCheck.tax')}>
          <input type="text" inputMode="decimal" value={draft.tax} onChange={set('tax')} />
        </Field>
        <Field label={t('slips.net')}>
          <input type="text" inputMode="decimal" value={draft.net} onChange={set('net')} />
        </Field>
      </div>
      {gross !== undefined && slip.lines.length > 0 && Math.abs(sum - gross) > 1 && (
        <Notice kind="warn">{t('slipCheck.sumDiffers', { sum: fmt.money(sum), gross: fmt.money(gross) })}</Notice>
      )}
      <details>
        <summary className="small">{t('slipCheck.lines', { n: slip.lines.length })}</summary>
        <table className="slip-check-lines small">
          <tbody>
            {slip.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.code}</td>
                <td>
                  {l.text}
                  {l.from && <span className="muted"> {l.from === l.to || !l.to ? l.from : `${l.from} – ${l.to}`}</span>}
                </td>
                <td className="num">{l.quantity !== undefined ? `${fmt.number(l.quantity, 2)} ${l.unit ?? ''}` : ''}</td>
                <td className="num">{l.amount !== undefined ? fmt.money(l.amount) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {!periodOk && <Notice kind="error">{t('slipCheck.badPeriod')}</Notice>}
      <div className="button-row">
        <button type="button" className="button button-primary" disabled={!periodOk} onClick={() => void save()}>
          {t('slipCheck.ok')}
        </button>
      </div>
    </Card>
  );
}
