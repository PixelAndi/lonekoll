import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useApp } from '../app-context.ts';
import type { StampPair } from '../domain/model.ts';

/** "1505", "15.05", "15:05" → "15:05"; "" → null; anything else → undefined (invalid). */
export function normalizeTime(text: string): string | null | undefined {
  const s = text.trim();
  if (s === '') return null;
  const m = s.match(/^(\d{1,2})[:.,;]?(\d{2})$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * 24-hour time field. Native time inputs show AM/PM on English phones, which
 * is easy to mix up with the clock's 24-hour display.
 */
export function TimeField({ value, onChange, label, highlight }: { value: string | null; onChange: (v: string | null) => void; label: string; highlight?: boolean }) {
  const [draft, setDraft] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(value ?? '');
    setInvalid(false);
  }, [value]);
  return (
    <label>
      <span className="field-label">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        placeholder="hh:mm"
        maxLength={5}
        value={draft}
        className={`${highlight ? 'uncertain' : ''} ${invalid ? 'invalid' : ''}`}
        aria-invalid={invalid}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          // Pass on a complete four-digit time (or a cleared field) right away;
          // shorter input like "915" is taken when the field loses focus.
          const normalized = normalizeTime(text);
          const complete = normalized === null || (normalized !== undefined && text.replace(/\D/g, '').length === 4);
          if (complete && normalized !== value) onChange(normalized);
        }}
        onBlur={() => {
          const normalized = normalizeTime(draft);
          if (normalized === undefined) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          setDraft(normalized ?? '');
          if (normalized !== value) onChange(normalized);
        }}
      />
    </label>
  );
}

/** Lets a field that still has focus commit its value before the form saves. */
export async function flushFocusedField(): Promise<void> {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await new Promise((resolve) => setTimeout(resolve, 50));
}

export interface Uncertain {
  in?: boolean;
  out?: boolean;
}

/** Editable list of In/Ut pairs. Edited times are marked as typed by hand. */
export function StampRowsEditor({
  rows,
  onChange,
  uncertain = [],
}: {
  rows: StampPair[];
  onChange: Dispatch<SetStateAction<StampPair[]>>;
  uncertain?: Uncertain[];
}) {
  const { t } = useApp();
  // Functional updates, so two fields committing back to back don't overwrite each other.
  const update = (i: number, field: 'in' | 'out', value: string | null) => {
    onChange((current) => current.map((r, j) => (j === i ? { ...r, [field]: value, [field === 'in' ? 'inManual' : 'outManual']: true } : r)));
  };
  return (
    <div className="stamp-rows">
      {rows.map((row, i) => (
        <div className="stamp-row" key={i}>
          <TimeField label={t('day.in')} value={row.in} highlight={uncertain[i]?.in && !row.inManual} onChange={(v) => update(i, 'in', v)} />
          <TimeField label={t('day.out')} value={row.out} highlight={uncertain[i]?.out && !row.outManual} onChange={(v) => update(i, 'out', v)} />
          <button type="button" className="icon-button" aria-label={t('common.delete')} onClick={() => onChange((current) => current.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="button button-small" onClick={() => onChange((current) => [...current, { in: null, out: null }])}>
        + {t('day.addRow')}
      </button>
    </div>
  );
}
