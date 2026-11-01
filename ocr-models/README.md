# OCR models kept in the repository

`latin_PP-OCRv4_rec.onnx` – PaddleOCR's PP-OCRv4 text recognition model
(`ch_PP-OCRv4_rec_infer.onnx` from the npm package `@gutenye/ocr-models`,
converted from [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR),
Apache License 2.0) with its last layer cut down to Latin letters, digits and
signs by `scripts/trim-paddle-rec.py`; its characters, in class order, are
`src/ocr/latin_v4_keys.txt`. Used to read photographed pay slips
(`src/ocr/paddleWorker.ts`). `scripts/copy-ocr-assets.mjs` copies it to
`public/ocr/paddle` with the detection model and ONNX Runtime's WebAssembly.
