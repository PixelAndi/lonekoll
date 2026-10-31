import type { Comparison } from '../domain/compare.ts';
import type { Settings } from '../domain/model.ts';
import { explanations } from '../domain/reportCheck.ts';
import type { DayColumn, Quote, ReportPoint } from '../domain/reportPoints.ts';
import type { Source } from '../domain/sources.ts';
import { formatDuration } from '../domain/time.ts';
import { ltr, type Formatter } from '../format.ts';
import type { TextKey, Translate } from '../i18n.ts';
import { Cited } from './Cited.tsx';
import { LogStamps } from './LogStamps.tsx';
import { noteText, rowLabel, rowReference, sideText } from './slipComparison.ts';

// The report's differences as numbered points (see domain/reportPoints.ts):
// an overview, then one box per point for the employer to go through.

/** The documents by their Swedish names, as they are titled (and linked, see sources.ts). */
const SOURCE_NAMES: Record<Exclude<Source, 'sickPayAct'>, string> = {
  agreement: 'Livsmedelsavtalet',
  bakery: 'Tilläggsavtal Bagerier',
  appendixC: 'Bilaga C',
  appendixF: 'Bilaga F',
};

const COLUMN_LABELS: Record<DayColumn, TextKey> = {
  worked: 'report.col.worked',
  ob1: 'report.col.ob',
  ob2: 'report.col.ob',
  ob3: 'report.col.ob',
  ob4: 'report.col.ob',
  ot50: 'point.col.ot50',
  ot100: 'point.col.ot100',
  shiftedTime: 'cat.shiftedTime',
  sick: 'point.col.sick',
  holiday: 'cat.holidayPay',
  absence: 'point.col.hours',
};

interface Props {
  points: ReportPoint[];
  comparison: Comparison;
  settings: Settings;
  end: string;
  taxYear: number;
  t: Translate;
  fmt: Formatter;
}

export const pointTitle = (p: ReportPoint, comparison: Comparison, t: Translate) =>
  p.keys.map((k) => rowLabel(comparison.rows.find((r) => r.key === k)!, t)).join(` ${t('point.and')} `);

/** The overview: each point, whether it is a correction or a question, and its amount. */
export function PointsOverview({ points, comparison, t, fmt }: Pick<Props, 'points' | 'comparison' | 't' | 'fmt'>) {
  const total = points.reduce((s, p) => s + p.amount, 0);
  const taxDiffers = comparison.rows.some((r) => (r.key === 'tax' || r.key === 'net') && r.status === 'diff');
  return (
    <>
      <table className="report-table point-overview">
        <thead>
          <tr>
            <th>{t('point.col.point')}</th>
            <th />
            <th>{t('point.col.kind')}</th>
            <th className="num">{t('point.col.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.n}>
              <td>{p.n}</td>
              <td>{pointTitle(p, comparison, t)}</td>
              <td>
                <span className={`point-kind point-kind-${p.kind}`}>{t(`point.kind.${p.kind}`)}</span>
              </td>
              <td className="num">{fmt.signedMoney(p.amount)}</td>
            </tr>
          ))}
          <tr className="report-sum">
            <td />
            <td>{t('point.total')}</td>
            <td />
            <td className="num">{fmt.signedMoney(Math.round(total * 100) / 100)}</td>
          </tr>
        </tbody>
      </table>
      <p className="report-ref">{t('point.amountNote')}</p>
      {taxDiffers && <p className="report-ref">{t('point.taxNote')}</p>}
    </>
  );
}

export function PointCard({ point: p, comparison, settings, end, taxYear, t, fmt }: Omit<Props, 'points' | 'period'> & { point: ReportPoint }) {
  const rows = p.keys.map((k) => comparison.rows.find((r) => r.key === k)!);
  const lead = rows[0];
  // "1,50 h × 90,00 kr + 1,00 h × 180,00 kr = 315,00 kr"
  const parts = p.lines.map((l) => (l.hours !== undefined && l.rate !== undefined ? `${fmt.number(l.hours)} h × ${fmt.money(l.rate)}` : fmt.money(l.amount)));
  const sum = `${parts.join(' + ')} = ${fmt.money(p.amount)}`.replace(/\+ −/g, '− ');
  const amount = fmt.money(Math.abs(p.amount));
  const ask =
    p.kind === 'claim'
      ? t('point.ask', { amount })
      : t(`point.question.${p.reason!}`, { amount, limit: formatDuration(settings.ordinaryShiftMinutes) });
  return (
    // A long list of days may break across pages; a short point stays together.
    <section className={p.days.length > 8 ? 'point point-long' : 'point'}>
      <header className="point-head">
        <h3>{t('point.title', { n: p.n, title: pointTitle(p, comparison, t) })}</h3>
        <span className={`point-kind point-kind-${p.kind}`}>{t(`point.kind.${p.kind}`)}</span>
      </header>
      <dl className="point-facts">
        <dt>{t('point.what')}</dt>
        <dd>
          {rows.map((r) => (
            <div key={r.key}>
              {t(r.slip.amount === undefined && r.slip.hours === undefined ? 'point.whatMissing' : 'point.whatRow', {
                label: rowLabel(r, t),
                expected: sideText(r.expected, r.key, fmt),
                slip: sideText(r.slip, r.key, fmt),
              })}
            </div>
          ))}
        </dd>
        <dt>{t('point.sum')}</dt>
        <dd>{ltr(sum)}</dd>
        {p.days.length > 0 && (
          <>
            <dt>{t('point.days')}</dt>
            <dd>
              <table className="report-table point-days">
                <thead>
                  <tr>
                    <th>{t('report.col.date')}</th>
                    <th>{t('report.col.stamps')}</th>
                    {p.columns.map((c) => (
                      <th key={c} className="num">
                        {t(COLUMN_LABELS[c])}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.days.map((d) => (
                    <tr key={d.date}>
                      <td>{fmt.date(d.date)}</td>
                      <td>
                        <LogStamps rows={d.stamps} t={t} />
                        {d.photo && <span className="point-photo"> {t('point.photo')}</span>}
                      </td>
                      {d.minutes.map((m, i) => (
                        <td key={i} className="num">
                          {m ? formatDuration(m) : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {p.days.length > 1 && (
                  <tfoot>
                    <tr>
                      <td colSpan={2}>{t('point.daysTotal')}</td>
                      {p.columns.map((c, i) => (
                        <td key={c} className="num">
                          {formatDuration(p.days.reduce((s, d) => s + d.minutes[i], 0))}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </dd>
          </>
        )}
        <dt>{t('point.rule')}</dt>
        <dd>
          {p.obRates?.map((r) => (
            <p key={r.level} className="point-quote">
              <Cited
                t={t}
                text={t('point.obTable', { from: fmt.date(r.from, 'numeric'), label: t(`cat.ob${r.level}`), rate: fmt.money(r.rate) })}
              />
            </p>
          ))}
          {p.quotes.map((q, i) => (
            <QuoteBlock key={i} quote={q} t={t} />
          ))}
          <p className="report-ref">
            <Cited t={t} text={rowReference(lead, t, settings, end, taxYear, fmt)} />
          </p>
          {rows.flatMap((r) => r.notes).map((n, i) => (
            <p key={i} className="report-ref">
              <Cited t={t} text={noteText(n, t, fmt)} />
            </p>
          ))}
        </dd>
        <dt>{t(p.kind === 'claim' ? 'point.askLabel' : 'point.questionLabel')}</dt>
        <dd>
          <strong>{ask}</strong>
          <div className="point-explain">
            {t('explain.title')} {explanations(lead).map((e) => t(`explain.${e}`)).join(' ')}
          </div>
        </dd>
      </dl>
      <div className="point-answer">
        <span className="point-answer-label">{t('point.answer')}</span>
        {p.reason === 'slip-more' || p.reason === 'only-on-slip' ? (
          <span>{t('point.answer.what')}</span>
        ) : (
          <>
            <span>☐ {t('point.answer.ok')}</span>
            <span>☐ {t(p.reason === 'local-overtime' || p.reason === 'local-monthly' ? 'point.answer.local' : 'point.answer.no')}</span>
          </>
        )}
        <span>{t('point.answer.comment')}</span>
      </div>
    </section>
  );
}

/** A passage quoted word for word, with a link to where it stands. */
function QuoteBlock({ quote, t }: { quote: Quote; t: Translate }) {
  const name = quote.source === 'sickPayAct' ? 'Sjuklönelagen' : SOURCE_NAMES[quote.source];
  return (
    <figure className="point-quote">
      <blockquote lang="sv">”{quote.text}”</blockquote>
      <figcaption>
        <Cited t={t} text={`${name} §${quote.section}`} />
      </figcaption>
    </figure>
  );
}
