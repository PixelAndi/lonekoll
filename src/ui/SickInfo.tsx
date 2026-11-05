import { useApp } from '../app-context.ts';
import type { SickPeriod } from '../domain/sick.ts';
import { Cited } from './Cited.tsx';
import { href } from '../router.ts';

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
        {!period.workInjury && (
          <li>
            {t('sick.injury')} <a href={href({ name: 'help', section: 'injury' })}>{t('sick.injuryLink')}</a>
          </li>
        )}
      </ul>
      {period.workInjury && <WorkInjuryChecklist />}
    </div>
  );
}

/** "Arbetsskada" ticked on sick days: hurt at work, or on the way to or from it. */
export function WorkInjuryField({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useApp();
  return (
    <label className="inline-field work-injury-field">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> <span>{t('injury.checkbox')}</span>
    </label>
  );
}

/** What to do about a work injury, in short, with the way to the whole guide. */
function WorkInjuryChecklist() {
  const { t } = useApp();
  return (
    <div className="cal-check work-injury-check">
      <strong>{t('injury.checkTitle')}</strong>
      <ul className="small">
        <li>{t('injury.check.tell')}</li>
        <li>{t('injury.check.report')}</li>
        <li>{t('injury.check.care')}</li>
        <li>{t('injury.check.apply')}</li>
      </ul>
      <a className="small" href={href({ name: 'help', section: 'injury' })}>
        {t('sick.injuryLink')}
      </a>
    </div>
  );
}
