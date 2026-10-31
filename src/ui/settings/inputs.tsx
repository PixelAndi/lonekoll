import { useEffect, useState, type InputHTMLAttributes } from 'react';
import type { Language } from '../../i18n.ts';

/** Text/number input that saves when it loses focus (not on every keystroke). */
/**
 * An input saved when the user leaves it or presses Enter. If `onCommit`
 * returns false the text couldn't be used, and the saved value is shown again.
 */
export function LazyInput({
  value,
  onCommit,
  ...rest
}: { value: string; onCommit: (v: string) => boolean | void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      onBlur={() => {
        if (draft !== value && onCommit(draft) === false) setDraft(value);
      }}
    />
  );
}

export const numberOrUndefined = (v: string) => {
  const n = Number(v.replace(',', '.').replace(/\s/g, ''));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

/** 187.5 → "187,5" in Swedish. */
export const decimalText = (n: number | undefined, lang: Language) =>
  n === undefined ? '' : String(n).replace('.', lang === 'en' ? '.' : ',');
