import { useMemo, useState } from 'react';
import { useApp } from '../app-context.ts';
import { calculateShifts } from '../domain/calc.ts';
import { hourlyRateOn, hourlySupplement, minimumWageOn, wagePeriodOn } from '../domain/model.ts';
import { datesInRange, formatDuration, todayLocal } from '../domain/time.ts';
import { formatter } from '../format.ts';
import { LANGUAGE_NAMES, translator, type Language } from '../i18n.ts';
import { goBack } from '../router.ts';
import { PhotoThumb, Spinner } from './common.tsx';
import { coverageText, totalText } from './CompareView.tsx';
import { SlipNotFound } from './SlipsView.tsx';
import { diffText, noteText, rowLabel, rowReference, sideText, useSlipComparison } from './slipComparison.ts';
import { stampText } from './stamps.ts';

/** A printable report for the employer; Swedish by default. */
export function ReportView({ id }: { id: string }) {
  const app = useApp();
  const data = useSlipComparison(id);
  const [lang, setLang] = useState<Language>('sv');
  const [withPhotos, setWithPhotos] = useState(false);
  const t = useMemo(() => translator(lang), [lang]);
  const fmt = useMemo(() => formatter(lang), [lang]);
  const shiftResults = useMemo(() => calculateShifts(app.days, app.settings).results, [app.days, app.settings]);

  if (data === undefined) return <Spinner />;
  if (data === null) return <SlipNotFound />;
  const { slip, comparison, start, end, period, tax, taxYear } = data;
  const settings = app.settings;
  const total = totalText(comparison, t, fmt);
  const findings = comparison.rows.filter((r) => ['diff', 'check', 'missing', 'extra'].includes(r.status) && r.key !== 'gross' && r.key !== 'net');
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
        const rate = hourlyRateOn(settings, d);
        if (rate === null) return [];
        const w = wagePeriodOn(settings, d);
        const m = w?.basis === 'minimum' ? minimumWageOn(settings, d) : null;
        return m
          ? [t('report.hourlyMinimum', { hourly: fmt.number(rate), minimum: fmt.number(m.minimum), supplement: fmt.number(w ? hourlySupplement(w) : 0) })]
          : [`${fmt.number(rate)} kr`];
      }),
    ),
  ];
  const byDate = new Map(app.days.map((d) => [d.date, d]));
  const logDates = datesInRange(start, end).filter((d) => byDate.has(d));
  const photoIds = logDates.flatMap((d) => byDate.get(d)!.photoIds.map((pid) => ({ date: d, id: pid })));

  return (
    <div className="report">
      <div className="report-controls no-print">
        <button type="button" className="button" onClick={() => goBack({ name: 'slip', id })}>
          {app.t('common.back')}
        </button>
        <label className="inline-field">
          {app.t('report.language')}
          <select value={lang} onChange={(e) => setLang(e.target.value as Language)}>
            {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} /> {app.t('report.includePhotos')}
        </label>
        <button type="button" className="button button-primary" onClick={() => window.print()}>
          {app.t('common.print')}
        </button>
      </div>

      <article className="report-page">
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
                <td>
                  {start} – {end}
                </td>
              </tr>
              {slip.payDate && (
                <tr>
                  <th>{t('report.payDate')}</th>
                  <td>{slip.payDate}</td>
                </tr>
              )}
              <tr>
                <th>{t('report.hourly')}</th>
                <td>{rates.join(', ') || '–'}</td>
              </tr>
              <tr>
                <th>{t('report.created')}</th>
                <td>{todayLocal()}</td>
              </tr>
            </tbody>
          </table>
        </header>

        <section>
          <h2>{t('report.summary')}</h2>
          <p className="report-total">
            <strong>{total.text}</strong>
          </p>
          {comparison.coverage.map((c) => (
            <p key={c.code}>{coverageText(c, t, fmt)}</p>
          ))}
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
              {comparison.rows.map((row) => (
                <tr key={row.key} className={row.key === 'gross' ? 'report-sum' : ''}>
                  <td>{rowLabel(row, t)}</td>
                  <td className="num">{sideText(row.expected, row.key, fmt)}</td>
                  <td className="num">{sideText(row.slip, row.key, fmt)}</td>
                  <td className="num">{diffText(row, fmt)}</td>
                  <td>{t(`status.${row.status}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>

        {findings.length > 0 && (
          <section>
            <h2>{t('report.details')}</h2>
            {findings.map((row) => (
              <div key={row.key} className="report-finding">
                <h3>
                  {rowLabel(row, t)} – {t(`status.${row.status}`)}
                </h3>
                {row.notes.map((n, i) => (
                  <p key={i}>{noteText(n, t, fmt)}</p>
                ))}
                <p className="report-ref">{rowReference(row, t, settings, end, taxYear, fmt)}</p>
              </div>
            ))}
          </section>
        )}

        <section>
          <h2>{t('report.assumptions')}</h2>
          <ul>
            {settings.scheduleMode === 'fixed' ? (
              <li>{t('report.scheduleFixed', { n: settings.schedule.weeks.length })}</li>
            ) : (
              <>
                <li>{t('report.scheduleNone')}</li>
                <li>{t('report.overtimeRule', { limit: formatDuration(settings.ordinaryShiftMinutes) })}</li>
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
            {period.sick && period.sick.weeksUsed > 0 && <li>{t('month.sickBasis', { weeks: period.sick.weeksUsed })}</li>}
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
                const day = byDate.get(date)!;
                const shifts = shiftResults.filter((r) => r.shift.date === date);
                const worked = shifts.reduce((s, r) => s + r.shift.workedMinutes, 0);
                const ob = shifts.reduce((s, r) => s + r.obMinutes[1] + r.obMinutes[2] + r.obMinutes[3] + r.obMinutes[4], 0);
                const ot = shifts.reduce((s, r) => s + r.overtime50 + r.overtime100, 0);
                return (
                  <tr key={date}>
                    <td>{fmt.date(date)}</td>
                    <td>{stampText(day.rows, true)}</td>
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

        {withPhotos && photoIds.length > 0 && (
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

        <footer className="report-disclaimer">{t('report.disclaimer')}</footer>
      </article>
    </div>
  );
}
