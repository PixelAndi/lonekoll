import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, saveSettings } from '../db.ts';
import { calculatePeriod } from '../domain/calc.ts';
import { comparePeriod } from '../domain/compare.ts';
import { apply, suggestFromSlip, type Suggestion } from '../domain/slipSetup.ts';
import { formatDuration } from '../domain/time.ts';
import type { PaySlip } from '../domain/payslip.ts';
import { Card, Notice } from './common.tsx';

// Settings suggested from a pay slip (see domain/slipSetup.ts), offered for a
// new user's first slip, or while no wage is set.

export function SlipSetupCard({ id, slip, start, end }: { id: string; slip: PaySlip; start: string; end: string }) {
  const { t, fmt, days, settings } = useApp();
  const slipCount = useLiveQuery(() => db.slips.count(), []);
  const setup = useMemo(() => suggestFromSlip(slip, days, settings, start, end), [slip, days, settings, start, end]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const chosen = setup.suggestions.filter((s) => !off.has(s.code));
  // What is left of the difference with the chosen suggestions.
  const remaining = useMemo(() => {
    if (!chosen.length) return undefined;
    const next = apply(settings, chosen, start);
    return comparePeriod(calculatePeriod(days, next, start, end), slip, days, next).totalDifference;
  }, [chosen, settings, days, slip, start, end]);

  // "oktober 2026" inside a sentence (English keeps its capital).
  const month = settings.language === 'en' ? fmt.month(start) : fmt.month(start).toLocaleLowerCase();
  const firstUse = settings.wages.length === 0 || (slipCount ?? 0) <= 1;
  if (!setup.suggestions.length || !firstUse || settings.setupDismissed?.includes(id)) return null;

  const toggle = (code: string) => setOff((s) => (s.has(code) ? new Set([...s].filter((c) => c !== code)) : new Set([...s, code])));
  const use = () => void saveSettings(apply(settings, chosen, start));
  const later = () => void saveSettings({ setupDismissed: [...(settings.setupDismissed ?? []), id] });

  return (
    <Card title={t('setup.slip.title')} className="card-highlight">
      <p className="small">{t('setup.slip.intro', { month })}</p>
      <ul className="suggest-list">
        {setup.suggestions.map((s) => (
          <li key={s.code}>
            <label>
              <input type="checkbox" checked={!off.has(s.code)} onChange={() => toggle(s.code)} />
              <span>
                <strong>{title(s)}</strong>
                <span className="suggest-from">{source(s)}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {remaining !== undefined &&
        (Math.abs(remaining) <= 1 ? (
          <Notice kind="ok">{t('setup.slip.matches', { month })}</Notice>
        ) : (
          <Notice>{t('setup.slip.remaining', { amount: fmt.money(Math.abs(remaining)) })}</Notice>
        ))}
      <div className="button-row">
        <button type="button" className="button button-primary" disabled={!chosen.length} onClick={use}>
          {t('setup.slip.use')}
        </button>
        <button type="button" className="button" onClick={later}>
          {t('setup.slip.later')}
        </button>
      </div>
    </Card>
  );

  function title(s: Suggestion): string {
    switch (s.code) {
      case 'hourly':
        return t('setup.slip.hourly', { amount: fmt.money(s.hourly) });
      case 'monthly':
        return t('setup.slip.monthly', { amount: fmt.money(s.monthly) });
      case 'overtime-limit':
        return t('setup.slip.overtime', { limit: formatDuration(s.minutes) });
      case 'ob':
        return t('setup.slip.ob');
      case 'tax-table':
        return t('setup.slip.tax', { table: s.table });
      case 'employer':
        return t('setup.slip.employer', { employer: s.employer });
    }
  }

  function source(s: Suggestion): string {
    switch (s.code) {
      case 'hourly':
        return t('setup.slip.fromLine', { line: `${s.line} à ${fmt.number(s.hourly)}` });
      case 'monthly':
        return t('setup.slip.fromLine', { line: s.line });
      case 'overtime-limit':
        return t('setup.slip.fromOvertime', { hours: fmt.number(s.hours) });
      case 'ob':
        return t('setup.slip.fromLines', { lines: s.lines.map((l) => `”${l}”`).join(', ') });
      case 'tax-table':
        return t('setup.slip.fromTax');
      case 'employer':
        return t('setup.slip.fromHeader');
    }
  }
}
