import { useApp } from '../app-context.ts';
import type { SickPeriod } from '../domain/sick.ts';
import { Cited } from './Cited.tsx';

// What the law and the agreement ask of someone off sick, with the dates of
// their sick period: tell the employer the first day; the karensavdrag (none
// after a relapse within five days); a doctor's certificate from day 8, or
// earlier at the employer's cost; Försäkringskassan after 14 days of sick pay.

export function SickInfo({ period }: { period: SickPeriod }) {
  const { t, fmt } = useApp();
  const date = (d: string) => fmt.date(d, 'inText');
  return (
    <div className="sick-info">
      <ul className="small">
        <li>{t('sick.tell')}</li>
        <li>
          <Cited text={period.relapse ? t('sick.relapseNow') : t('sick.karens', { date: date(period.start) })} />
        </li>
        <li className={period.dayNo >= 6 ? 'warn-text' : undefined}>
          <strong>
            <Cited text={t('sick.certificate', { date: date(period.certificateFrom) })} />
          </strong>
        </li>
        <li>
          <Cited text={t('sick.earlyCertificate')} />
        </li>
        <li>
          <Cited text={t('sick.insurance', { date: date(period.insuranceFrom) })} />
        </li>
        {!period.relapse && <li>{t('sick.relapse')}</li>}
      </ul>
    </div>
  );
}
