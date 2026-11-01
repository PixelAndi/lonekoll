/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm';
// The characters the trimmed recognition model knows (see ocr-models/README.md), in its class order.
import keys from './latin_v4_keys.txt?raw';
import { ctcDecode, textBoxes, type LineReading, type TextBox } from './paddle.ts';

// Runs PaddleOCR's models (ONNX Runtime, WebAssembly, one thread) off the
// main thread. Several of these read a slip's lines at the same time; the
// first also finds the lines. Everything comes from the app's own files
// (public/ocr/paddle), nothing from the network.

export type PaddleRequest =
  | { id: number; kind: 'init'; base: string; detect: boolean }
  | { id: number; kind: 'detect'; rgba: Uint8ClampedArray; width: number; height: number }
  | { id: number; kind: 'read'; lines: { rgba: Uint8ClampedArray; width: number }[] };

export type PaddleResponse =
  | { id: number; kind: 'ready' }
  | { id: number; kind: 'boxes'; boxes: TextBox[] }
  | { id: number; kind: 'lines'; lines: LineReading[] }
  | { id: number; kind: 'error'; error: string };

let detector: ort.InferenceSession | null = null;
let reader: ort.InferenceSession | null = null;
/** Class k is dict[k - 1] (class 0 is CTC's blank); the last is the space. */
const dict = keys.replace(/\r/g, '').split('\n');

/** The picture as the models take it: channels apart (blue, green, red), 0–1. */
function toTensor(rgba: Uint8ClampedArray, width: number, height: number): ort.Tensor {
  const plane = width * height;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    data[i] = rgba[i * 4 + 2] / 255;
    data[plane + i] = rgba[i * 4 + 1] / 255;
    data[2 * plane + i] = rgba[i * 4] / 255;
  }
  return new ort.Tensor('float32', data, [1, 3, height, width]);
}

async function handle(msg: PaddleRequest): Promise<PaddleResponse> {
  if (msg.kind === 'init') {
    ort.env.wasm.numThreads = 1;
    // ONNX Runtime's WebAssembly and its loader, from the app's own files.
    ort.env.wasm.wasmPaths = msg.base;
    reader = await ort.InferenceSession.create(`${msg.base}latin_PP-OCRv4_rec.onnx`);
    if (msg.detect) detector = await ort.InferenceSession.create(`${msg.base}ch_PP-OCRv4_det_infer.onnx`);
    return { id: msg.id, kind: 'ready' };
  }
  if (msg.kind === 'detect') {
    const out = await detector!.run({ [detector!.inputNames[0]]: toTensor(msg.rgba, msg.width, msg.height) });
    const map = out[detector!.outputNames[0]];
    return { id: msg.id, kind: 'boxes', boxes: textBoxes(map.data as Float32Array, msg.width, msg.height) };
  }
  const lines: LineReading[] = [];
  for (const line of msg.lines) {
    const out = await reader!.run({ [reader!.inputNames[0]]: toTensor(line.rgba, line.width, 48) });
    const t = out[reader!.outputNames[0]];
    lines.push(ctcDecode(t.data as Float32Array, t.dims[1], t.dims[2], dict));
  }
  return { id: msg.id, kind: 'lines', lines };
}

self.onmessage = (e: MessageEvent<PaddleRequest>) => {
  handle(e.data).then(
    (answer) => (self as unknown as Worker).postMessage(answer),
    (err) => (self as unknown as Worker).postMessage({ id: e.data.id, kind: 'error', error: String(err) } satisfies PaddleResponse),
  );
};
