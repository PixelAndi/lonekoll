import { RULES } from '../domain/agreement.ts';
import type { WagePeriod } from '../domain/model.ts';
import type { Formatter } from '../format.ts';
import type { Translate } from '../i18n.ts';

/** A wage row in words: "avtalets minimilön + 7,50 kr/tim", "… + 1 500 kr/mån (≈ 8,62 kr/tim)", "190,00 kr/tim". */
export function wageRowText(w: WagePeriod | undefined, t: Translate, fmt: Formatter): string {
  if (!w) return t('wageSlips.none');
  if (w.basis === 'monthly') return t('wageHist.row.monthly', { amount: fmt.money(w.monthly ?? 0) });
  if (w.basis === 'minimum') {
    if (!w.supplement) return t('wageHist.row.minimum');
    if (w.supplementPer === 'month')
      return t('wageHist.row.minimumPlusMonth', { supplement: fmt.money(w.supplement), hourly: fmt.money(Math.round((w.supplement / RULES.hoursPerMonth) * 100) / 100) });
    return t('wageHist.row.minimumPlus', { supplement: fmt.money(w.supplement) });
  }
  return t('wageHist.row.fixed', { amount: fmt.money(w.hourly) });
}
