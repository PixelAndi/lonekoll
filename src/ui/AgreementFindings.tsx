import type { ReactNode } from 'react';
import { agreementFor } from '../domain/agreement.ts';
import type { AgreementFinding } from '../domain/agreementCheck.ts';
import { higherMinimumFrom, type Settings } from '../domain/model.ts';
import type { Formatter } from '../format.ts';
import type { TextKey, Translate } from '../i18n.ts';
import { Cited } from './Cited.tsx';

// The pay slips against the collective agreement: what the agreement sets
// (minimum wage, lowest raise, OB, overtime, sick pay, holiday pay), what the
// slips paid, and about how much that comes to – with the months that
// couldn't be checked, and lines on later slips that may have put it right.

/** Months as ranges where they run on: "November 2021 – Augusti 2022, December 2022". */
export function monthRanges(months: string[], fmt: Formatter): string {
  const sorted = [...new Set(months)].sort();
  const next = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  };
  const runs: [string, string][] = [];
  for (const m of sorted) {
    const last = runs[runs.length - 1];
    if (last && next(last[1]) === m) last[1] = m;
    else runs.push([m, m]);
  }
  return runs.map(([a, b]) => (a === b ? fmt.month(a) : `${fmt.month(a)} – ${fmt.month(b)}`)).join(', ');
}

/** "aug.–okt. 2022", or one month. */
function monthSpan(months: string[], fmt: Formatter): string {
  const sorted = [...months].sort();
  const first = fmt.month(sorted[0]);
  return sorted.length === 1 ? first : `${first} – ${fmt.month(sorted[sorted.length - 1])}`;
}

/** One finding, said in full: the rule, what was paid, the months, about how much, and what may have corrected it. */
export function FindingItem({ f, settings, t, fmt, report = false, children }: { f: AgreementFinding; settings: Settings; t: Translate; fmt: Formatter; report?: boolean; children?: ReactNode }) {
  const key = (f.rule === 'minimum' ? `minimum.${f.cause}` : f.rule) as 'minimum.oneYear';
  // The report is read by the employer too: the employee is named in the third person there.
  const textKey = (report && key === 'minimum.oneYear' ? 'agr.text.minimum.oneYearReport' : `agr.text.${key}`) as TextKey;
  const date = f.months[f.months.length - 1];
  const raise = agreementFor(f.from)?.minimumRaise ?? 0;
  const values = {
    due: fmt.money(f.due),
    paid: fmt.money(f.paid),
    level: f.level ?? '',
    from: fmt.date(f.from, 'inText'),
    since: fmt.date(higherMinimumFrom(settings) ?? f.from, 'inText'),
    raise: fmt.money(raise),
    before: fmt.money(f.due - raise),
  };
  return (
    <li className="finding">
      <strong>{t(`agr.rule.${key}` as TextKey, values)}</strong>
      <p>
        <Cited t={t} date={date} text={t(textKey, values)} />
      </p>
      <p className="small">
        {t('agr.months', { months: monthSpan(f.months, fmt), n: f.months.length })}{' '}
        <strong>{t('agr.amount', { diff: fmt.money(f.due - f.paid), hours: fmt.number(f.hours, 2), amount: fmt.money(f.amount) })}</strong>
        {f.estimate && ` ${t('agr.estimate')}`}
      </p>
      {f.corrections && (
        <p className="small muted">
          {t('agr.corrections', { list: f.corrections.map((c) => `${c.text} ${fmt.money(c.amount)} (${fmt.month(c.month)})`).join(', ') })}
        </p>
      )}
      {children}
    </li>
  );
}
