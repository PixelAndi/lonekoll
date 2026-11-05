import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { db, saveSettings } from '../db.ts';
import { uncheckedMonths } from '../domain/agreementCheck.ts';
import { href } from '../router.ts';
import { todayLocal } from '../domain/time.ts';
import { monthRanges } from './AgreementFindings.tsx';
import { Card, Fold, Icon, Page } from './common.tsx';
import { missingCount, useMissing } from './MissingView.tsx';
import { useIssues, vacationCheckKey } from './issues-context.tsx';
import { SlipMergeQuestion } from './SameData.tsx';
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
  const { owed, wages, night, toCheck, readAgain, vacation } = useIssues();
  const open = wages.open;
  const records = useLiveQuery(() => db.slips.toArray(), []);
  const { months } = useMissing();
  const missingDays = missingCount(months);
  const unchecked = useMemo(() => uncheckedMonths((records ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides)), settings), [records, settings]);
  const noSlip = unchecked.missing;
  const questions = open.length + (night ? 1 : 0) + toCheck + readAgain;
  const errors = owed ? owed.likely.length + owed.investigate.length : 0;
  const checks = errors + vacation.length;
  const nightAnswered = settings.nightAsked && settings.shiftForm === 'none';
  const okChecks = settings.checksOk ?? [];
  const dayCount = (n: number) => fmt.number(n, Number.isInteger(n) ? 0 : 1);
  const answered =
    (owed?.settled.length ?? 0) + Object.values(settings.wageAnswers ?? {}).filter((a) => a !== 'agreed').length + (nightAnswered ? 1 : 0) + okChecks.length;

  return (
    <Page title={t('nav.issues')}>
      <p className="muted small">{t('issues.intro')}</p>
      <StatusTiles
        tiles={[
          { id: 'issues-errors', label: t('kon.tile.likely'), n: owed?.likely.length ?? 0, sub: t('kon.tile.likelySub'), bad: true },
          { id: 'issues-errors', label: t('kon.tile.investigate'), n: owed?.investigate.length ?? 0, sub: t('kon.tile.investigateSub') },
          { id: 'issues-questions', label: t('kon.tile.questions'), n: questions, sub: t('kon.tile.questionsSub') },
          { id: 'issues-vacation', label: t('kon.tile.vacation'), n: vacation.length, sub: t('kon.tile.vacationSub') },
          { id: 'issues-missing', label: t('kon.tile.days'), n: missingDays, sub: t('kon.tile.daysSub') },
          { id: 'issues-missing', label: t('kon.tile.slips'), n: noSlip.length, sub: t('kon.tile.slipsSub') },
        ]}
      />
      {questions + checks === 0 && <p className="ok">✓ {t('issues.none')}</p>}

      {questions > 0 && (
        <h2 className="issues-heading" id="issues-questions">
          {t('issues.questions', { n: questions })}
        </h2>
      )}
      {(records ?? [])
        .filter((r) => r.candidate)
        .map((r) => (
          <SlipMergeQuestion key={r.id} record={r} />
        ))}
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
          <h2 className="issues-heading" id="issues-errors">
            {t('issues.errors', { n: errors })}
          </h2>
          <Card className="owed-card">
            <OwedMonths />
            {!settings.employedSince && <p className="small warn-text">{t('agr.noEmployed')}</p>}
            {!settings.birthDate && <p className="small muted">{t('agr.noBirth')}</p>}
            <OwedSection owed={owed} />
          </Card>
        </>
      )}

      {vacation.length > 0 && (
        <>
          <h2 className="issues-heading" id="issues-vacation">
            {t('check.vacation', { n: vacation.length })}
          </h2>
          <Card>
            <p className="small muted">{t('check.vacationIntro')}</p>
            <ul className="owed-items">
              {vacation.map((v) => (
                <li key={vacationCheckKey(v)}>
                  <strong>{fmt.month(v.month)}</strong>
                  <br />
                  <span className="small">
                    {t('check.vacationRow', {
                      printed: dayCount(v.printedPaid ?? 0),
                      expected: dayCount(v.expectedPaid ?? 0),
                      taken: dayCount(v.paidTaken),
                      saved: dayCount(v.printedSaved ?? 0),
                      savedExpected: dayCount(v.expectedSaved ?? v.printedSaved ?? 0),
                    })}
                  </span>{' '}
                  <button type="button" className="owed-settle small" onClick={() => void saveSettings({ checksOk: [...(settings.checksOk ?? []), vacationCheckKey(v)] })}>
                    {t('check.isRight')}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {(missingDays > 0 || noSlip.length > 0 || unchecked.unread.length > 0) && (
        <>
          <h2 className="issues-heading" id="issues-missing">
            {t('issues.missing')}
          </h2>
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
          {okChecks.length > 0 && (
            <ul className="owed-items">
              {okChecks.map((k) => (
                <li key={k}>
                  <strong>{k.startsWith('vacation:') ? t('check.vacationOk', { month: fmt.month(k.split(':')[1]) }) : k}</strong>{' '}
                  <button type="button" className="owed-settle small" onClick={() => void saveSettings({ checksOk: okChecks.filter((x) => x !== k) })}>
                    {t('owed.unsettle')}
                  </button>
                </li>
              ))}
            </ul>
          )}
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
      {owed && owed.archived.length > 0 && (
        <Fold title={t('issues.archived', { n: owed.archived.length })} sub={t('issues.archivedSub')}>
          <SettledList owed={owed} archived />
        </Fold>
      )}
    </Page>
  );
}

interface Tile {
  id: string;
  label: string;
  n: number;
  sub: string;
  bad?: boolean;
}

/** The situation at a glance, like the Kalender's counts: a square per kind of check, coloured by how it stands. */
function StatusTiles({ tiles }: { tiles: Tile[] }) {
  const { t } = useApp();
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <section className="card cal-focus">
      <div className="cal-focus-head">
        <strong>{t('kon.now')}</strong>
      </div>
      <div className="kon-tiles">
        {tiles.map((tile) => (
          <button
            key={tile.label}
            type="button"
            className={`kon-tile ${tile.n === 0 ? 'kon-ok' : tile.bad ? 'kon-bad' : 'kon-warn'}`}
            disabled={tile.n === 0}
            onClick={() => go(tile.id)}
          >
            <span className="kon-tile-head">
              <strong>{tile.label}</strong>
              <strong className="kon-tile-n">{tile.n === 0 ? '✓' : tile.n}</strong>
            </span>
            <span className="kon-tile-sub">{tile.n === 0 ? t('kon.tile.ok') : tile.sub}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** The last 24 months as squares: paid too little by the agreement, to look into, a slip that's fine, no slip. */
function OwedMonths() {
  const { t, fmt } = useApp();
  const { owed } = useIssues();
  const records = useLiveQuery(() => db.slips.toArray(), []);
  if (!owed) return null;
  const have = new Set((records ?? []).map((r) => r.periodStart));
  const now = todayLocal().slice(0, 7);
  const months: string[] = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1 - i, 1));
    months.push(d.toISOString().slice(0, 10));
  }
  const kind = (m: string) =>
    owed.likely.some((i) => i.months.includes(m)) ? 'kon-m-bad' : owed.investigate.some((i) => i.months.includes(m)) ? 'kon-m-warn' : have.has(m) ? 'kon-m-ok' : 'kon-m-none';
  return (
    <div className="kon-months">
      <div className="kon-months-grid">
        {months.map((m) => (
          <span key={m} className="kon-month">
            <i className={kind(m)} />
            <span>{fmt.monthShort(m).slice(0, 1).toLocaleUpperCase()}</span>
          </span>
        ))}
      </div>
      <p className="small muted">{t('kon.monthsKey', { from: fmt.month(months[0]), to: fmt.month(months[23]) })}</p>
    </div>
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
