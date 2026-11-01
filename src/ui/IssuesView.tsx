import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { db, saveSettings } from '../db.ts';
import { uncheckedMonths } from '../domain/agreementCheck.ts';
import { href } from '../router.ts';
import { monthRanges } from './AgreementFindings.tsx';
import { Card, Fold, Icon, Page } from './common.tsx';
import { missingCount, useMissing } from './MissingView.tsx';
import { useIssues } from './issues-context.tsx';
import { NightWorkQuestion } from './NightWork.tsx';
import { OwedSection, SettledList } from './Owed.tsx';
import { applyOverrides } from './slipComparison.ts';
import { AnsweredWages, WageQuestions } from './WageFromSlips.tsx';

// Ärenden: everything the app has found to look at, in one place – the
// questions only the user can answer (the wage the slips pay, night work),
// what may have been paid too little, and what is missing – and below, what
// has been answered or put right, each with the way to undo it. The app is a
// daily log first; this is where its findings are kept track of.

export function IssuesView() {
  const { t, fmt, settings } = useApp();
  const { owed, wages, night, toCheck } = useIssues();
  const open = wages.open;
  const records = useLiveQuery(() => db.slips.toArray(), []);
  const { months } = useMissing();
  const missingDays = missingCount(months);
  const unchecked = useMemo(() => uncheckedMonths((records ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides)), settings), [records, settings]);
  const noSlip = unchecked.missing;
  const questions = open.length + (night ? 1 : 0) + toCheck;
  const errors = owed ? owed.likely.length + owed.investigate.length : 0;
  const nightAnswered = settings.nightAsked && settings.shiftForm === 'none';
  const answered = (owed?.settled.length ?? 0) + Object.values(settings.wageAnswers ?? {}).filter((a) => a !== 'agreed').length + (nightAnswered ? 1 : 0);

  return (
    <Page title={t('nav.issues')}>
      <p className="muted small">{t('issues.intro')}</p>
      {questions + errors === 0 && <p className="ok">✓ {t('issues.none')}</p>}

      {questions > 0 && <h2 className="issues-heading">{t('issues.questions', { n: questions })}</h2>}
      <WageQuestions />
      <NightWorkQuestion />
      {toCheck > 0 && (
        <a className="card issue-link" href={href({ name: 'slips' })}>
          <span>{t('issues.toCheck', { n: toCheck })}</span>
          <Icon name="chevronRight" />
        </a>
      )}

      {owed && errors > 0 && (
        <>
          <h2 className="issues-heading">{t('issues.errors', { n: errors })}</h2>
          <Card className="owed-card">
            {!settings.employedSince && <p className="small warn-text">{t('agr.noEmployed')}</p>}
            {!settings.birthDate && <p className="small muted">{t('agr.noBirth')}</p>}
            <OwedSection owed={owed} />
          </Card>
        </>
      )}

      {(missingDays > 0 || noSlip.length > 0 || unchecked.unread.length > 0) && (
        <>
          <h2 className="issues-heading">{t('issues.missing')}</h2>
          {missingDays > 0 && (
            <a className="card issue-link" href={href({ name: 'missing' })}>
              <span>{t('missing.link', { n: missingDays })}</span>
              <Icon name="chevronRight" />
            </a>
          )}
          {noSlip.length > 0 && (
            <a className="card issue-link" href={href({ name: 'slips' })}>
              <span>{t('issues.noSlip', { months: monthRanges(noSlip, fmt) })}</span>
              <Icon name="chevronRight" />
            </a>
          )}
          {unchecked.unread.length > 0 && <p className="small muted">{t('agr.unchecked', { months: monthRanges(unchecked.unread, fmt) })}</p>}
        </>
      )}

      {answered > 0 && (
        <Fold title={t('issues.answered', { n: answered })} sub={t('issues.answeredSub')}>
          {owed && <SettledList owed={owed} />}
          <AnsweredWages />
          {nightAnswered && (
            <ul className="owed-items">
              <li>
                <strong>{t('night.title')}</strong>
                <br />
                <span className="small">{t('issues.nightNo')}</span>{' '}
                <button type="button" className="owed-settle small" onClick={() => void saveSettings({ nightAsked: false })}>
                  {t('wageQ.change')}
                </button>
              </li>
            </ul>
          )}
        </Fold>
      )}
    </Page>
  );
}

/** One line on the days page, when something is open. */
export function IssuesLine() {
  const { t } = useApp();
  const n = useIssues().count;
  if (!n) return null;
  return (
    <a className="card issue-link issue-line" href={href({ name: 'issues' })}>
      <span>{t('issues.line', { n })}</span>
      <Icon name="chevronRight" />
    </a>
  );
}
