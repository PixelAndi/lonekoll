import type { StampPair } from '../domain/model.ts';
import { ltr } from '../format.ts';
import type { Translate } from '../i18n.ts';

/**
 * The day's stamps as on the clock: * after a time typed in by hand, and a
 * time changed after scanning shown with what the scanner read.
 */
export function LogStamps({ rows, t }: { rows: StampPair[]; t: Translate }) {
  const time = (value: string | null, manual?: boolean, read?: string) => {
    if (!value) return '··:··';
    if (read && read !== value) return `${value} ✎`;
    return manual && !read ? `${value}*` : value;
  };
  const edited = rows.flatMap((r) => [
    r.inRead && r.in && r.inRead !== r.in ? r.inRead : null,
    r.outRead && r.out && r.outRead !== r.out ? r.outRead : null,
  ]).filter((x): x is string => !!x);
  return (
    <>
      {rows.map((r) => ltr(`${time(r.in, r.inManual, r.inRead)}–${time(r.out, r.outManual, r.outRead)}`)).join(' · ')}
      {edited.length > 0 && <span className="report-edited"> {t('report.editedMark', { times: edited.map((x) => ltr(x)).join(', ') })}</span>}
    </>
  );
}
