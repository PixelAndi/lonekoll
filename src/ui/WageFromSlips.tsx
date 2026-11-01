import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { db, saveSettings } from '../db.ts';
import { applyPattern, stepsNotInSettings, wageHistory, wagePatterns, type WageAnswer, type WagePattern, type WageStep } from '../domain/wageHistory.ts';
import { wagePeriodOn, type Settings } from '../domain/model.ts';
import { Card } from './common.tsx';
import { useIssues } from './issues-context.tsx';
import { wageRowText } from './wageText.ts';
import type { TextKey } from '../i18n.ts';
import { href } from '../router.ts';
import { Fold, Notice } from './common.tsx';
import { applyOverrides } from './slipComparison.ts';

// The wage as paid on the pay slips, step by step: each wage taken apart into
// the agreement's minimum and the personal supplement above it, each change
// named for what it was (the agreement's raise, the step after a year, a
// personal raise, a wage put right, a cut). Where the settings say something
// else, one tap sets them as the slips pay: the minimum plus the supplement,
// so the wage follows every new minimum. A wage below the minimum is set as
// the minimum – that is what was due – and the difference stays to take up.

export function WageFromSlips({ onlyChanges = false }: { onlyChanges?: boolean }) {
  const { t, fmt, settings } = useApp();
  const records = useLiveQuery(() => db.slips.toArray(), []);
  const steps = useMemo(
    () =>
      wageHistory(
        (records ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides)),
        settings,
      ),
    [records, settings],
  );
  const off = useMemo(() => stepsNotInSettings(steps, settings), [steps, settings]);
  if (!steps.length) return null;
  // In the settings: only a line saying the slips pay otherwise, with the way to the details.
  if (onlyChanges) {
    if (!off.length) return null;
    return (
      <Notice kind="info">
        {t('wageSlips.settingsNote', { n: off.length })} <a href={href({ name: 'issues' })}>{t('wageSlips.settingsLink')}</a>
      </Notice>
    );
  }
  const per = (s: { basis: WageStep['basis'] }, amount: number) => t(s.basis === 'hourly' ? 'wageSlips.perHour' : 'wageSlips.perMonth', { amount: fmt.money(amount) });
  const patterns = wagePatterns(steps, settings);
  return (
    <Fold
      title={t('wageSlips.title')}
      sub={off.length ? t('wageSlips.summaryDiffers', { n: off.length }) : t('wageSlips.summaryOk')}
      warn={off.length > 0}
      id="wage"
    >
      <p className="small">{t('wageHist.intro')}</p>
      <ul className="wage-history">
        {[...steps].reverse().map((s) => (
          <li key={s.from + s.amount} className={s.belowMinimum ? 'wage-below' : ''}>
            <div className="wage-step-head">
              <span>
                {fmt.date(s.from, 'numeric')}–{fmt.date(s.to, 'numeric')}
              </span>
              <strong>{per(s, s.amount)}</strong>
            </div>
            {s.known && (
              <p className="small muted">
                {s.above === 0
                  ? t('wageHist.atMinimum', { minimum: per(s, s.minimum) })
                  : s.above > 0
                    ? t('wageHist.parts', {
                        minimum: per(s, s.minimum),
                        above: per(s, s.above),
                      })
                    : t('wageHist.belowParts', {
                        minimum: per(s, s.minimum),
                        below: per(s, -s.above),
                      })}
              </p>
            )}
            {(s.change || s.belowMinimum) && (
              <p className="wage-kinds">
                {changeKinds(s).map(([key, amount]) => (
                  <span key={key} className={`tag wage-kind wage-kind-${key.split('.').pop()}`}>
                    {t(key, { amount: per(s, Math.abs(amount)) })}
                  </span>
                ))}
              </p>
            )}
            {s.retro && <p className="small muted">{t('wageSlips.retro')}</p>}
          </li>
        ))}
      </ul>
      {off.length === 0 ? (
        <p className="ok small">✓ {t('wageSlips.allFit')}</p>
      ) : (
        <ul className="wage-patterns small">
          {patterns
            .filter((p) => p.differs)
            .map((p) => {
              const answer = settings.wageAnswers?.[p.key];
              return (
                <li key={p.key}>
                  {fmt.date(p.from, 'numeric')}–{fmt.date(p.to, 'numeric')}: {wageRowText(p.row, t, fmt)} ·{' '}
                  <span className="muted">{t(answer === 'disputed' || answer === 'unsure' ? (`wageQ.answered.${answer}` as TextKey) : 'wageQ.answered.none')}</span>
                  {(answer === 'disputed' || answer === 'unsure') && (
                    <>
                      {' '}
                      <button type="button" className="owed-settle" onClick={() => answerPattern(settings, p, undefined)}>
                        {t('wageQ.change')}
                      </button>
                    </>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </Fold>
  );
}

/** What a step's change was made of, as labels with their amounts. */
function changeKinds(s: WageStep): [TextKey, number][] {
  const out: [TextKey, number][] = [];
  const c = s.change;
  if (c) {
    if (c.agreement > 0.005)
      out.push([c.revision && c.oneYear ? 'wageHist.kind.revisionOneYear' : c.oneYear ? 'wageHist.kind.oneYear' : 'wageHist.kind.revision', c.agreement]);
    if (c.corrected > 0.005) out.push(['wageHist.kind.corrected', c.corrected]);
    if (c.personal > 0.005) out.push(['wageHist.kind.personal', c.personal]);
    if (c.personal < -0.005) out.push(['wageHist.kind.lower', c.personal]);
    if (c.amount < -0.005) out.push(['wageHist.kind.cut', c.amount]);
  }
  if (s.belowMinimum) out.push(['wageHist.kind.below', s.minimum - s.amount]);
  return out;
}

/** Save the answer about a pattern; "agreed" puts its wage in the settings. No answer: asked again. */
function answerPattern(settings: Settings, p: WagePattern, answer: WageAnswer | undefined) {
  const answers = { ...settings.wageAnswers };
  if (answer) answers[p.key] = answer;
  else delete answers[p.key];
  void saveSettings(answer === 'agreed' ? { wages: applyPattern(settings, p), wageAnswers: answers } : { wageAnswers: answers });
}

/**
 * The wages the slips keep paying that the settings don't have, each asked about: is it the deal
 * between you and the employer (then into the settings), or is the slip wrong (then into the report)?
 */
/** The wages the slips keep paying, and those of them still to be asked about. */
export function useWagePatternsComputed(): { patterns: WagePattern[]; open: WagePattern[] } {
  const { settings } = useApp();
  const records = useLiveQuery(() => db.slips.toArray(), []);
  return useMemo(() => {
    const patterns = wagePatterns(wageHistory((records ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides)), settings), settings);
    const open = patterns.filter((p) => p.differs && settings.wageAnswers?.[p.key] !== 'disputed' && settings.wageAnswers?.[p.key] !== 'unsure');
    return { patterns, open };
  }, [records, settings]);
}

/** Answers given about wages: what was said, and the way to ask again. */
export function AnsweredWages() {
  const { t, fmt, settings } = useApp();
  const { patterns } = useIssues().wages;
  const answered = patterns.filter((p) => p.differs && (settings.wageAnswers?.[p.key] === 'disputed' || settings.wageAnswers?.[p.key] === 'unsure'));
  if (!answered.length) return null;
  return (
    <ul className="owed-items">
      {answered.map((p) => (
        <li key={p.key}>
          <strong>
            {fmt.date(p.from, 'numeric')}–{fmt.date(p.to, 'numeric')}: {wageRowText(p.row, t, fmt)}
          </strong>
          <br />
          <span className="small">{t(`wageQ.answered.${settings.wageAnswers[p.key]}` as TextKey)}</span>{' '}
          <button type="button" className="owed-settle small" onClick={() => answerPattern(settings, p, undefined)}>
            {t('wageQ.change')}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function WageQuestions() {
  const { t, fmt, settings } = useApp();
  const { open } = useIssues().wages;
  if (!open.length) return null;
  return (
    <Card title={t('wageQ.title')} className="card-highlight wage-questions">
      {open.map((p) => {
        const values = {
          from: fmt.date(p.from, 'inText'),
          to: fmt.date(p.to, 'inText'),
          slip: wageRowText(p.row, t, fmt),
          n: p.revisions,
          slips: p.steps.reduce((n, s) => n + s.slips.length, 0),
        };
        const supplement = p.row.basis === 'minimum' ? (p.row.supplement ?? 0) : null;
        const lead = supplement === null ? 'wageQ.other' : supplement === 0 ? 'wageQ.minimum' : p.revisions > 0 ? 'wageQ.kept' : 'wageQ.new';
        const firstOff = stepsNotInSettings(p.steps, settings)[0] ?? p.steps[0];
        return (
          <div key={p.key} className="wage-question">
            <p>{t(lead, values)}</p>
            <p>{t('wageQ.settings', { set: wageRowText(wagePeriodOn(settings, firstOff.from), t, fmt) })}</p>
            {p.steps.some((s) => s.belowMinimum) && <p className="small muted">{t('wageQ.below')}</p>}
            <p>
              <strong>{t('wageQ.ask')}</strong>
            </p>
            <div className="button-column">
              <button type="button" className="button button-primary" onClick={() => answerPattern(settings, p, 'agreed')}>
                {t('wageQ.agree')}
              </button>
              <button type="button" className="button" onClick={() => answerPattern(settings, p, 'disputed')}>
                {t('wageQ.dispute')}
              </button>
              <button type="button" className="button" onClick={() => answerPattern(settings, p, 'unsure')}>
                {t('wageQ.unsure')}
              </button>
            </div>
          </div>
        );
      })}
      <p className="small muted">{t('wageQ.hint')}</p>
    </Card>
  );
}
