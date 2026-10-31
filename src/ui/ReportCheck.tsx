import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db } from '../db.ts';
import { calculatePeriod } from '../domain/calc.ts';
import { comparePeriod } from '../domain/compare.ts';
import { checkLevel, checkReport, type CheckItem, type ReportCheck } from '../domain/reportCheck.ts';
import { formatDuration, todayLocal } from '../domain/time.ts';
import { ltr } from '../format.ts';
import { href } from '../router.ts';
import { Modal, Notice } from './common.tsx';
import { applyOverrides, slipPeriod, type SlipComparison } from './slipComparison.ts';

// Checked before a report is saved: what is missing or unsure, and whether a
// setting is more likely wrong than the pay. See domain/reportCheck.ts.

/** The checks for a pay slip's report; undefined while loading. */
export function useReportCheck(data: SlipComparison | null | undefined): ReportCheck | undefined {
  const { days, settings } = useApp();
  const all = useLiveQuery(() => db.slips.toArray(), []);
  return useMemo(() => {
    if (!data || !all) return undefined;
    // The other slips: did the calculation match them? That says the settings are right.
    const others = all
      .filter((r) => r.id !== data.record.id)
      .map((r) => {
        const slip = applyOverrides(r.slip, settings.codeOverrides);
        const { start, end } = slipPeriod(slip, r.importedAt);
        const c = comparePeriod(calculatePeriod(days, settings, start, end), slip, days, settings);
        return { start, matched: c.totalDifference !== undefined && Math.abs(c.totalDifference) <= 1 && c.coverage.length === 0 };
      });
    return checkReport({ ...data, days, settings, today: todayLocal(), others });
  }, [data, all, days, settings]);
}

export function ReportCheckDialog({ check, slipId, onSave, onClose }: { check: ReportCheck; slipId: string; onSave: () => void; onClose: () => void }) {
  const { t } = useApp();
  const [confirmed, setConfirmed] = useState(false);
  const suspect = check.items.find((i) => i.code === 'settings-suspect');
  return (
    <Modal
      title={t('check.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.back')}
          </button>
          <button type="button" className="button button-primary" disabled={!confirmed} onClick={onSave}>
            {t('check.save')}
          </button>
        </>
      }
    >
      {suspect ? <Notice kind="warn">{t('check.suspect')}</Notice> : <p className="small">{t('check.intro')}</p>}
      <ul className="check-list">
        {check.items
          .filter((i) => i.code !== 'settings-suspect')
          .map((item) => (
            <CheckRow key={item.code} item={item} slipId={slipId} />
          ))}
      </ul>
      <label className="check-confirm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {t(check.suspect ? 'check.confirmSettings' : 'check.confirm')}
      </label>
    </Modal>
  );
}

const ICONS = { ok: '✓', info: 'i', warn: '!' };

function CheckRow({ item, slipId }: { item: CheckItem; slipId: string }) {
  const { t, fmt } = useApp();
  const level = checkLevel(item);
  const date = (d: string) => fmt.date(d);
  const dayLinks = (dates: string[]) =>
    dates.map((d, i) => (
      <span key={d}>
        {i > 0 && ', '}
        <a href={href({ name: 'day', date: d })}>{date(d)}</a>
      </span>
    ));
  const stamp = (s: { date: string; field: 'in' | 'out'; time: string }) => `${date(s.date)} ${t(s.field === 'in' ? 'day.in' : 'day.out').toLowerCase()} ${ltr(s.time)}`;
  const settingsLink = (label: string) => <a href={href({ name: 'settings' })}>{label}</a>;

  let title: string;
  let body: React.ReactNode;
  switch (item.code) {
    case 'settings-matched':
      title = t('check.matched.title', { months: item.months.map((m) => fmt.month(m)).join(', ') });
      body = t('check.matched.text');
      break;
    case 'settings-never-matched':
      title = t('check.neverMatched.title');
      body = t('check.neverMatched.text');
      break;
    case 'wage-rate':
      title = t('check.wage.title');
      body = (
        <>
          {t('check.wage.text', { slip: fmt.number(item.slip), settings: fmt.number(item.settings) })} {settingsLink(t('check.wage.fix'))}
        </>
      );
      break;
    case 'overtime-limit':
      title = t('check.overtime.title');
      body = (
        <>
          {t('check.overtime.text', { limit: formatDuration(item.limit), match: formatDuration(item.match) })} {settingsLink(t('check.overtime.fix'))}
        </>
      );
      break;
    case 'missing-days':
      title = t('check.missing.title', { n: item.dates.length });
      body = (
        <>
          {dayLinks(item.dates)} – {t('check.missing.text')}
        </>
      );
      break;
    case 'holidays':
      title = t('check.holidays.title', { n: item.dates.length });
      body = (
        <>
          {dayLinks(item.dates)} – {t('check.holidays.text')}
        </>
      );
      break;
    case 'stamp-issues':
      title = t('check.issues.title', { n: item.dates.length });
      body = (
        <>
          {dayLinks(item.dates)} – {t('check.issues.text')}
        </>
      );
      break;
    case 'doubts':
      title = t('check.doubts.title', { n: item.times.length });
      body = (
        <>
          {item.times.map(stamp).join(', ')}. {t('check.doubts.text')} {dayLinks([...new Set(item.times.map((x) => x.date))])}
        </>
      );
      break;
    case 'unread-lines':
      title = t('check.lines.title', { n: item.lines.length });
      body = (
        <>
          {item.lines.map((l) => `”${l.text}”${l.amount !== undefined ? ` ${fmt.money(l.amount)}` : ''}`).join(', ')}. {t('check.lines.text')}{' '}
          <a href={href({ name: 'slip', id: slipId })}>{t('check.lines.fix')}</a>
        </>
      );
      break;
    case 'edited':
      title = t('check.edited.title', { n: item.times.length });
      body = `${item.times.map((x) => `${stamp(x)} (${t('check.edited.read', { time: ltr(x.read) })})`).join(', ')}. ${t('check.edited.text')}`;
      break;
    default:
      return null;
  }
  return (
    <li>
      <span className={`check-icon check-icon-${level}`} aria-hidden="true">
        {ICONS[level]}
      </span>
      <div>
        <strong className="check-title">{title}</strong>
        <p className={`small ${level === 'ok' ? 'muted' : ''}`}>{body}</p>
      </div>
    </li>
  );
}
