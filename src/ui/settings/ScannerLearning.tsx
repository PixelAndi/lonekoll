import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app-context.ts';
import { downloadBlob } from '../../backup.ts';
import { db, forgetDigits } from '../../db.ts';
import { digitFile, digitsLearned, GLYPH_H, GLYPH_W, memoryReady, shareableSamples, withShared, type GlyphSample } from '../../ocr/glyphs.ts';

// How far the scanner has come in learning the clock's digits, a way to start
// over, and sharing the learned digits anonymously to make the scanner better
// for everyone.

export function ScannerLearning() {
  const { t } = useApp();
  const own = useLiveQuery(() => db.learning.get('digits'), []);
  const memory = own ? withShared(own) : undefined;
  const learned = memory ? digitsLearned(memory) : 0;
  const ready = !!memory && memoryReady(memory);
  const [shared, setShared] = useState(false);
  const share = () => {
    if (!own) return;
    downloadBlob(new Blob([JSON.stringify(digitFile(own))], { type: 'application/json' }), 'lonekoll-siffror.json');
    setShared(true);
  };
  return (
    <div className="field">
      <span className="field-label">{t('learn.title')}</span>
      <p className="small">
        {ready && own
          ? own.checked
            ? t('learn.readyChecked', { percent: Math.round((own.correct / own.checked) * 100), correct: own.correct, checked: own.checked })
            : t('learn.ready')
          : t('learn.progress', { n: learned })}
      </p>
      <p className="muted small">{t('learn.hint')}</p>
      {own && shareableSamples(own).length > 0 && (
        <>
          <span className="field-label">{t('learn.shareTitle')}</span>
          <DigitSheet samples={shareableSamples(own)} />
          <p className="muted small">{t('learn.shareHint')}</p>
          <button type="button" className="button button-small" onClick={share}>
            {t('learn.share')}
          </button>
          {shared && <p className="small ok">{t('learn.shareDone')}</p>}
        </>
      )}
      {own && own.samples.length > 0 && (
        <div className="button-row">
          <button type="button" className="button button-small" onClick={() => confirm(t('learn.forgetConfirm')) && void forgetDigits()}>
            {t('learn.forget')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Exactly what is shared: the digit pictures, grouped by digit. */
function DigitSheet({ samples }: { samples: GlyphSample[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const perRow = 20;
    const byDigit = [...'0123456789'].map((d) => samples.filter((s) => s.label === d).slice(0, perRow));
    c.width = perRow * (GLYPH_W + 2);
    c.height = 10 * (GLYPH_H + 2);
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(c.width, c.height);
    img.data.fill(255);
    byDigit.forEach((list, row) =>
      list.forEach((s, col) => {
        for (let y = 0; y < GLYPH_H; y++) {
          for (let x = 0; x < GLYPH_W; x++) {
            const v = 255 - s.data[y * GLYPH_W + x];
            const k = ((row * (GLYPH_H + 2) + y) * c.width + col * (GLYPH_W + 2) + x) * 4;
            img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
          }
        }
      }),
    );
    ctx.putImageData(img, 0, 0);
  }, [samples]);
  return <canvas ref={canvas} className="digit-sheet" aria-hidden="true" />;
}
