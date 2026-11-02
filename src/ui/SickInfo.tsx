import { useApp } from '../app-context.ts';
import { addDays, daysBetween, todayLocal } from '../domain/time.ts';
import { Cited } from './Cited.tsx';

// What the law asks of someone off sick, with the dates for their sick
// period: tell the employer the first day; the karensavdrag; sick pay from
// the employer up to day 14; a doctor's certificate from day 8; Försäkringskassan
// from day 15.

export function SickInfo({ start }: { start: string }) {
  const { t, fmt } = useApp();
  const today = todayLocal();
  const day = (n: number) => fmt.date(addDays(start, n - 1), 'inText');
  const dayNo = daysBetween(start, today) + 1;
  return (
    <div className="sick-info">
      <ul className="small">
        <li>{t('sick.tell')}</li>
        <li>
          <Cited text={t('sick.karens', { date: day(1) })} />
        </li>
        <li className={dayNo >= 6 ? 'warn-text' : undefined}>
          <strong>
            <Cited text={t('sick.certificate', { date: day(8) })} />
          </strong>
        </li>
        <li>
          <Cited text={t('sick.insurance', { date: day(15) })} />
        </li>
        <li>{t('sick.relapse')}</li>
      </ul>
    </div>
  );
}
