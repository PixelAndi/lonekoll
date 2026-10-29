// Copies Tesseract's worker, WebAssembly core and English model into
// public/ocr so photo reading works without any CDN (and offline once cached).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'public', 'ocr');
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));

const copies = [
  [path.join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [
    path.join(pkgDir('tesseract.js-core'), f),
    path.join('core', f),
  ]),
  [path.join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), path.join('lang', 'eng.traineddata.gz')],
];

for (const [from, to] of copies) {
  const target = path.join(out, to);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(from, target);
}
console.log(`OCR assets copied to ${path.relative(root, out)}`);
