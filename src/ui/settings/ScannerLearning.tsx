import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../../app-context.ts';
import { db, forgetDigits } from '../../db.ts';
import { digitsLearned, memoryReady } from '../../ocr/glyphs.ts';

// How far the scanner has come in learning the clock's digits, and a way to start over.

export function ScannerLearning() {
  const { t } = useApp();
  const memory = useLiveQuery(() => db.learning.get('digits'), []);
  const learned = memory ? digitsLearned(memory) : 0;
  const ready = !!memory && memoryReady(memory);
  return (
    <div className="field">
      <span className="field-label">{t('learn.title')}</span>
      <p className="small">
        {ready
          ? memory.checked
            ? t('learn.readyChecked', { percent: Math.round((memory.correct / memory.checked) * 100), correct: memory.correct, checked: memory.checked })
            : t('learn.ready')
          : t('learn.progress', { n: learned })}
      </p>
      <p className="muted small">{t('learn.hint')}</p>
      {memory && memory.samples.length > 0 && (
        <button type="button" className="button button-small" onClick={() => confirm(t('learn.forgetConfirm')) && void forgetDigits()}>
          {t('learn.forget')}
        </button>
      )}
    </div>
  );
}
