import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app-context.ts';
import { calculateShifts } from '../domain/calc.ts';
import { hourlyRateOn, hourlySupplement, minimumWageOn, monthlyPayOn, wagePeriodOn } from '../domain/model.ts';
import { datesInRange, formatDuration, todayLocal } from '../domain/time.ts';
import { formatter, ltr } from '../format.ts';
import { isRightToLeft, LANGUAGE_NAMES, LANGUAGE_TAGS, translator, type Language } from '../i18n.ts';
import { goBack } from '../router.ts';
import { PhotoThumb, Spinner } from './common.tsx';
import { Cited } from './Cited.tsx';
import { coverageText, totalText } from './CompareView.tsx';
import { SlipNotFound } from './SlipsView.tsx';
import { diffText, rowLabel, sideText, useSlipComparison } from './slipComparison.ts';
import { ReportCheckDialog, useReportCheck } from './ReportCheck.tsx';
import { needsReview, rowCertainty, type ReportCheck } from '../domain/reportCheck.ts';
import { reportPoints } from '../domain/reportPoints.ts';
import { periodBasis } from '../domain/basis.ts';
import { editionYears } from '../domain/sources.ts';
import { BasisSection } from './BasisNote.tsx';
import { FindingItem } from './AgreementFindings.tsx';
import { slipFindings } from '../domain/agreementCheck.ts';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.ts';
import { applyOverrides } from './slipComparison.ts';
import { LogStamps } from './LogStamps.tsx';
import { PointCard, PointsOverview } from './ReportPoints.tsx';
import { wageHistory, wagePatterns } from '../domain/wageHistory.ts';
import { wageRowText } from './wageText.ts';

/** The report for the employer, in Swedish, and in the user's own language too when that is another. */
export function ReportView({ id }: { id: string }) {
  const app = useApp();
  const data = useSlipComparison(id);
  const check = useReportCheck(data);
  /** Versions waiting for the checks to be confirmed before saving. */
  const [pending, setPending] = useState<Language[] | null>(null);
  // Swedish is for the employer; the app's language is for the user.
  const languages: Language[] = app.lang === 'sv' ? ['sv'] : ['sv', app.lang];
  const [preview, setPreview] = useState<Language>('sv');
  const [withPhotos, setWithPhotos] = useState(false);
  /** The versions being saved as PDF right now (through the print dialog). */
  const [printing, setPrinting] = useState<Language[] | null>(null);
  const shiftResults = useMemo(() => calculateShifts(app.days, app.settings).results, [app.days, app.settings]);

  // Print once the chosen versions are on the page; the title becomes the PDF's suggested file name.
  useEffect(() => {
    if (!printing || !data) return;
    const title = document.title;
    const month = data.start.slice(0, 7);
    document.title = `${translator('sv')('report.title')} ${month} – ${printing.map((l) => LANGUAGE_FILE_NAMES[l]).join(' + ')}`;
    const done = () => {
      document.title = title;
      setPrinting(null);
    };
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    return () => window.removeEventListener('afterprint', done);
  }, [printing, data]);

  if (data === undefined) return <Spinner />;
  if (data === null) return <SlipNotFound />;
  const shown = printing ?? [preview];
  // Anything to look at first opens the checks; otherwise straight to saving.
  const save = (langs: Language[]) => (check?.warnings ? setPending(langs) : setPrinting(langs));

  return (
    <div className="report">
      <div className="report-controls no-print">
        <button type="button" className="button" onClick={() => goBack({ name: 'slip', id })}>
          {app.t('common.back')}
        </button>
        {languages.length > 1 && (
          <div className="segmented" role="group" aria-label={app.t('report.preview')}>
            {languages.map((l) => (
              <button key={l} type="button" className={preview === l ? 'on' : ''} aria-pressed={preview === l} onClick={() => setPreview(l)}>
                {LANGUAGE_NAMES[l]}
              </button>
            ))}
          </div>
        )}
        <label className="inline-field">
          <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} /> {app.t('report.includePhotos')}
        </label>
        <div className="report-downloads">
          {languages.map((l) => (
            <button key={l} type="button" className={`button ${l === 'sv' ? 'button-primary' : ''}`} onClick={() => save([l])}>
              {app.t('report.downloadIn', { language: LANGUAGE_NAMES[l] })}
            </button>
          ))}
          {languages.length > 1 && (
            <button type="button" className="button" onClick={() => save(languages)}>
              {app.t('report.downloadBoth')}
            </button>
          )}
        </div>
        <p className="muted small report-download-hint">{app.t(languages.length > 1 ? 'report.downloadHintBoth' : 'report.downloadHint')}</p>
      </div>
      {pending && check && (
        <ReportCheckDialog
          check={check}
          slipId={id}
          onClose={() => setPending(null)}
          onSave={() => {
            setPending(null);
            setPrinting(pending);
          }}
        />
      )}
      {shown.map((l) => (
        <ReportPage key={l} lang={l} data={data} withPhotos={withPhotos} shiftResults={shiftResults} check={check} />
      ))}
    </div>
  );
}

/** Language names for file names (plain letters). */
const LANGUAGE_FILE_NAMES: Record<Language, string> = { sv: 'svenska', en: 'English', pl: 'polski', prs: 'Dari' };

/** The report itself in one language. */
function ReportPage({
  lang,
  data,
  withPhotos,
  shiftResults,
  check,
}: {
  lang: Language;
  data: NonNullable<ReturnType<typeof useSlipComparison>>;
  withPhotos: boolean;
  shiftResults: ReturnType<typeof calculateShifts>['results'];
  check?: ReportCheck;
}) {
  const app = useApp();
  const t = useMemo(() => translator(lang), [lang]);
  const fmt = useMemo(() => formatter(lang), [lang]);
  const { slip, comparison, start, end, period, tax, taxYear } = data;
  const settings = app.settings;
  const total = totalText(comparison, t, fmt);
  // What the comparison rests on: with nothing logged there is nothing to claim, only what the slip pays;
  // with days missing every difference may be those days, so the points are questions.
  const basis = periodBasis(slip, app.days, settings, start, end, todayLocal(), period.totals.wage?.hours);
  // The slip against the agreement on its own (needs no clock data): its own section.
  const allSlips = useLiveQuery(() => db.slips.toArray(), []);
  const slipsAll = (allSlips ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides));
  const findings = slipFindings(slip, slipsAll, settings);
  // The slips paying another wage than the settings in the period, and what the user said about it.
  const wageQuestions = wagePatterns(wageHistory(slipsAll, settings), settings)
    .filter((p) => p.differs && p.from <= end && p.to >= start)
    .map((p) => ({ pattern: p, answer: settings.wageAnswers?.[p.key], set: wagePeriodOn(settings, p.from > start ? p.from : start) }));
  const wageUnconfirmed = wageQuestions.some((q) => q.answer !== 'disputed');
  // Differences as numbered points to go through together.
  const points = basis.state === 'none' ? [] : reportPoints(comparison, period, app.days, settings, basis.state === 'partial', wageUnconfirmed);
  const reviewSummary =
    basis.state === 'none'
      ? t('basis.summaryNone')
      : points.length > 0 && comparison.totalDifference !== undefined && Math.abs(comparison.totalDifference) > 1
        ? t('report.reviewSummary', { n: points.length, amount: fmt.money(Math.abs(comparison.totalDifference)) }) +
          (comparison.netDifference !== undefined ? ` ${t('compare.netDiff', { amount: fmt.money(Math.abs(comparison.netDifference)) })}` : '') +
          (basis.state === 'partial' ? ` ${t('basis.summaryPartial')}` : '')
        : null;
  const matched = check?.items.find((i) => i.code === 'settings-matched');
  const certainties = comparison.rows.map((r) => rowCertainty(r, period, settings));
  const notApplied = [
    !settings.supplements.ob && t('settings.supp.ob'),
    !settings.supplements.overtime && t('settings.supp.overtime'),
    settings.scheduleMode === 'fixed' && !settings.supplements.shiftedTime && t('cat.shiftedTime'),
    !settings.supplements.holidayPay && t('settings.supp.holidayPay'),
  ].filter((x): x is string => !!x);
  // "189,33 kr" or, for a wage tied to the minimum, how it is made up.
  const rates = [
    ...new Set(
      datesInRange(start, end).flatMap((d) => {
        const monthlyPay = monthlyPayOn(settings, d);
        if (monthlyPay) return [t('report.monthlyRate', { monthly: fmt.number(monthlyPay.monthly), perHour: fmt.number(monthlyPay.perHour) })];
        const rate = hourlyRateOn(settings, d);
        if (rate === null) return [];
        const w = wagePeriodOn(settings, d);
        const m = w?.basis === 'minimum' ? minimumWageOn(settings, d) : null;
        return m
          ? [t('report.hourlyMinimum', { hourly: fmt.number(rate), minimum: fmt.number(m.minimum), supplement: fmt.number(w ? hourlySupplement(w) : 0) })]
          : [fmt.money(rate)];
      }),
    ),
  ];
  const monthlyPay = monthlyPayOn(settings, end);
  const byDate = new Map(app.days.map((d) => [d.date, d]));
  // The log, with the days the slip pays that are missing from it (so they can be looked up).
  const missingPaid = new Map(basis.paidNotLogged.map((d) => [d.date, d.hours]));
  const logDates = datesInRange(start, end).filter((d) => byDate.has(d) || missingPaid.has(d));
  const pointDates = new Set(points.flatMap((p) => p.days.map((d) => d.date)));
  const photoIds = logDates
    .filter((d) => withPhotos || pointDates.has(d))
    .flatMap((d) => byDate.get(d)!.photoIds.map((pid) => ({ date: d, id: pid })));

  return (
      <article className="report-page" lang={LANGUAGE_TAGS[lang]} dir={isRightToLeft(lang) ? 'rtl' : 'ltr'}>
        <header>
          <h1>{t('report.title')}</h1>
          <p className="report-subtitle">{t('report.subtitle')}</p>
          <table className="report-meta">
            <tbody>
              {settings.name && (
                <tr>
                  <th>{t('report.employee')}</th>
                  <td>{settings.name}</td>
                </tr>
              )}
              <tr>
                <th>{t('report.employer')}</th>
                <td>{settings.employer || slip.employer || '–'}</td>
              </tr>
              <tr>
                <th>{t('report.period')}</th>
                <td>{ltr(`${start} – ${end}`)}</td>
              </tr>
              {slip.payDate && (
                <tr>
                  <th>{t('report.payDate')}</th>
                  <td>{slip.payDate}</td>
                </tr>
              )}
              <tr>
                <th>{t(monthlyPay ? 'report.monthly' : 'report.hourly')}</th>
                <td>{rates.join(', ') || '–'}</td>
              </tr>
              <tr>
                <th>{t('report.created')}</th>
                <td>{todayLocal()}</td>
              </tr>
            </tbody>
          </table>
        </header>

        <BasisSection basis={basis} t={t} fmt={fmt} />

        {wageQuestions.length > 0 && basis.state !== 'none' && (
          <section className="report-wage">
            <h2>{t('report.wage.title')}</h2>
            {wageQuestions.map((q) => (
              <p key={q.pattern.key}>
                {t(q.answer === 'disputed' ? 'report.wage.disputed' : 'report.wage.unsure', {
                  slip: wageRowText(q.pattern.row, t, fmt),
                  set: wageRowText(q.set, t, fmt),
                })}
              </p>
            ))}
          </section>
        )}

        <section className="report-agreement">
          <h2>{t('report.agr.title')}</h2>
          {findings.length ? (
            <ul className="findings">
              {findings.map((f, i) => (
                <FindingItem key={i} f={f} settings={settings} t={t} fmt={fmt} report />
              ))}
            </ul>
          ) : (
            <p>{t('report.agr.none')}</p>
          )}
        </section>

        <section>
          <h2>{t('report.summary')}</h2>
          <p className="report-total">
            <strong>{reviewSummary ?? total.text}</strong>
          </p>
          {matched && <p className="muted small">{t('report.settingsMatched', { months: matched.months.map((m) => fmt.month(m)).join(', ') })}</p>}
          {points.length > 0 && <PointsOverview points={points} comparison={comparison} t={t} fmt={fmt} />}
          <h3 className="report-compare-title">{t(basis.state === 'none' ? 'basis.slipPays' : 'report.compareTitle')}</h3>
          {basis.state !== 'none' &&
            comparison.coverage.map((c) => (
              <p key={c.code}>{coverageText(c, t, fmt)}</p>
            ))}
          {basis.state === 'none' ? (
            <div className="table-scroll">
              <table className="report-table">
                <tbody>
                  {comparison.rows
                    .filter((row) => row.slip.amount !== undefined || row.slip.hours !== undefined)
                    .map((row) => (
                      <tr key={row.key} className={row.key === 'gross' ? 'report-sum' : ''}>
                        <td>{rowLabel(row, t)}</td>
                        <td className="num">{sideText(row.slip, row.key, fmt)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
          <div className="table-scroll">
          <table className="report-table">
            <thead>
              <tr>
                <th />
                <th className="num">{t('compare.expected')}</th>
                <th className="num">{t('compare.slip')}</th>
                <th className="num">{t('compare.diff')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row, i) => (
                <tr key={row.key} className={row.key === 'gross' ? 'report-sum' : ''}>
                  <td>
                    {rowLabel(row, t)}
                    {certainties[i] && <span className={`sure sure-${certainties[i]}`}>{t(`sure.${certainties[i]!}`)}</span>}
                  </td>
                  <td className="num">{sideText(row.expected, row.key, fmt)}</td>
                  <td className="num">{sideText(row.slip, row.key, fmt)}</td>
                  <td className="num">{diffText(row, fmt)}</td>
                  <td className={needsReview(row) ? 'report-review' : ''}>{t(needsReview(row) ? 'report.status.review' : `status.${row.status}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          )}
          {basis.state !== 'none' && certainties.some(Boolean) && <p className="report-ref">{t('report.sureNote')}</p>}
        </section>

        {points.length > 0 && (
          <section>
            <h2>{t('report.details')}</h2>
            {points.map((p) => (
              <PointCard key={p.n} point={p} comparison={comparison} settings={settings} end={end} taxYear={taxYear} t={t} fmt={fmt} />
            ))}
          </section>
        )}

        <section>
          <h2>{t('report.assumptions')}</h2>
          <ul>
            {monthlyPay && (
              <li>
                <Cited t={t} date={end} text={`${t('settings.monthlyRates', { perHour: fmt.number(monthlyPay.perHour), perDay: fmt.number(monthlyPay.perDay) })} ${t('report.monthlyLocal')}`} />
              </li>
            )}
            {settings.scheduleMode === 'fixed' ? (
              <li>{t('report.scheduleFixed', { n: settings.schedule.weeks.length })}</li>
            ) : (
              <>
                <li>{t('report.scheduleNone')}</li>
                <li>
                  <Cited t={t} date={end} text={t('report.overtimeRule', { limit: formatDuration(settings.ordinaryShiftMinutes) })} />
                </li>
              </>
            )}
            {notApplied.length > 0 && <li>{t('report.notApplied', { list: notApplied.join(', ') })}</li>}
            {tax.basis.kind !== 'unknown' && (
              <li>
                {t('report.taxBasis', {
                  text:
                    tax.basis.kind === 'table'
                      ? `${tax.basis.municipality ? `${tax.basis.municipality}, ` : ''}${t('cat.taxTable').toLowerCase()} ${tax.basis.table} (${taxYear})`
                      : `${fmt.number(tax.basis.percent)} %`,
                })}
              </li>
            )}
            {period.sick && period.sick.weeksUsed > 0 && period.sick.days.some((d) => d.basis === 'average') && <li>{t('month.sickBasis', { weeks: period.sick.weeksUsed })}</li>}
            <li>{t('month.excludesVacation')}</li>
            {settings.localDeals && (
              <li>
                {t('report.localDeals')}: {settings.localDeals}
              </li>
            )}
          </ul>
        </section>

        <section>
          <h2>{t('report.log')}</h2>
          <div className="table-scroll">
          <table className="report-table report-log">
            <thead>
              <tr>
                <th>{t('report.col.date')}</th>
                <th>{t('report.col.stamps')}</th>
                <th className="num">{t('report.col.worked')}</th>
                <th className="num">{t('report.col.ob')}</th>
                <th className="num">{t('report.col.ot')}</th>
                <th>{t('report.col.note')}</th>
              </tr>
            </thead>
            <tbody>
              {logDates.map((date) => {
                const day = byDate.get(date);
                if (!day)
                  return (
                    <tr key={date} className="report-log-missing">
                      <td>{fmt.date(date)}</td>
                      <td>–</td>
                      <td />
                      <td />
                      <td />
                      <td>{t('basis.logMissing', { hours: fmt.number(missingPaid.get(date) ?? 0, 2) })}</td>
                    </tr>
                  );
                const shifts = shiftResults.filter((r) => r.shift.date === date);
                const worked = shifts.reduce((s, r) => s + r.shift.workedMinutes, 0);
                const ob = shifts.reduce((s, r) => s + r.obMinutes[1] + r.obMinutes[2] + r.obMinutes[3] + r.obMinutes[4], 0);
                const ot = shifts.reduce((s, r) => s + r.overtime50 + r.overtime100, 0);
                return (
                  <tr key={date}>
                    <td>{fmt.date(date)}</td>
                    <td>
                      <LogStamps rows={day.rows} t={t} />
                    </td>
                    <td className="num">{worked ? formatDuration(worked) : ''}</td>
                    <td className="num">{ob ? formatDuration(ob) : ''}</td>
                    <td className="num">{ot ? formatDuration(ot) : ''}</td>
                    <td>
                      {day.absence ? t(`absence.${day.absence.type}`) : ''}
                      {day.absence?.hours ? ` ${fmt.number(day.absence.hours)} h` : ''}
                      {day.note ? ` ${day.note}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <p className="report-ref">{t('report.manualNote')}</p>
        </section>

        {photoIds.length > 0 && (
          <section className="report-photos">
            <h2>{t('report.photos')}</h2>
            <div className="report-photo-grid">
              {photoIds.map((p) => (
                <figure key={p.id}>
                  <PhotoThumb id={p.id} />
                  <figcaption>{p.date}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        <footer className="report-disclaimer">
          <Cited t={t} date={end} text={t('report.disclaimer', { edition: editionYears(end) })} />
        </footer>
      </article>
  );
}

