import { useEffect, useState, type InputHTMLAttributes } from 'react';

/** Text/number input that saves when it loses focus (not on every keystroke). */
export function LazyInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input {...rest} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onCommit(draft)} />;
}

export const numberOrUndefined = (v: string) => {
  const n = Number(v.replace(',', '.').replace(/\s/g, ''));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

/** 187.5 → "187,5" in Swedish. */
export const decimalText = (n: number | undefined, lang: 'sv' | 'en') =>
  n === undefined ? '' : String(n).replace('.', lang === 'sv' ? ',' : '.');
