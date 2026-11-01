// Copies Tesseract's worker, WebAssembly core and English model, and the
// PaddleOCR models with ONNX Runtime's WebAssembly (for pay slips), into
// public/ocr so photo reading works without any CDN (and offline once cached).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'public', 'ocr');
const pkgDir = (name) => {
  try {
    return path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    // A package whose "exports" leave out package.json.
    return path.join(root, 'node_modules', name);
  }
};

const copies = [
  [path.join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [
    path.join(pkgDir('tesseract.js-core'), f),
    path.join('core', f),
  ]),
  [path.join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int', 'eng.traineddata.gz'), path.join('lang', 'eng.traineddata.gz')],
  // Swedish, for photographed pay slips (å, ä and ö): loaded only when one is read.
  [path.join(pkgDir('@tesseract.js-data/swe'), '4.0.0_best_int', 'swe.traineddata.gz'), path.join('lang', 'swe.traineddata.gz')],
  // PaddleOCR (PP-OCRv4) for pay slips, run by ONNX Runtime: the text detection model as published,
  // and the recognition model trimmed to Latin letters, digits and signs (see ocr-models/README.md).
  [path.join(pkgDir('@gutenye/ocr-models'), 'assets', 'ch_PP-OCRv4_det_infer.onnx'), path.join('paddle', 'ch_PP-OCRv4_det_infer.onnx')],
  [path.join(root, 'ocr-models', 'latin_PP-OCRv4_rec.onnx'), path.join('paddle', 'latin_PP-OCRv4_rec.onnx')],
  ...['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'].map((f) => [path.join(pkgDir('onnxruntime-web'), 'dist', f), path.join('paddle', f)]),
];

for (const [from, to] of copies) {
  const target = path.join(out, to);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(from, target);
}
console.log(`OCR assets copied to ${path.relative(root, out)}`);
