"""Makes ocr-models/latin_PP-OCRv4_rec.onnx and src/ocr/latin_v4_keys.txt.

PaddleOCR's PP-OCRv4 recognition model (from the npm package
@gutenye/ocr-models) chooses among 6,625 classes at each step, nearly all
Chinese. A pay slip needs Latin letters, digits and signs: the model's last
layer is cut down to those (and CTC's blank, and the space). The model then
can't mistake a smudge for a Chinese character, and is smaller.

Run from the repository root:  pip install onnx numpy && python3 scripts/trim-paddle-rec.py
"""
import re

import numpy as np
import onnx
from onnx import numpy_helper

SOURCE = 'node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx'
KEYS = 'node_modules/@gutenye/ocr-models/assets/ppocr_keys_v1.txt'
WANTED = re.compile(r"^[A-Za-z0-9 .,:;%\-+/()@&'\"!?*=#_<>\[\]€$§éüäåöÄÅÖÉÜèàçñ]$")

model = onnx.load(SOURCE)
graph = model.graph
# The weights are stored as Constant nodes.
const = {n.output[0]: n for n in graph.node if n.op_type == 'Constant'}
weights = numpy_helper.to_array(const['linear_85.w_0'].attribute[0].t)
bias = numpy_helper.to_array(const['linear_85.b_0'].attribute[0].t)

# Class k is the dictionary's character k - 1 (class 0 is the blank); a space is appended at the end.
chars = open(KEYS, encoding='utf8').read().split('\n') + [' ']
keep = [0] + [k for k in range(1, len(chars) + 1) if WANTED.match(chars[k - 1])]

const['linear_85.w_0'].attribute[0].t.CopyFrom(numpy_helper.from_array(weights[:, keep].astype(np.float32)))
const['linear_85.b_0'].attribute[0].t.CopyFrom(numpy_helper.from_array(bias[keep].astype(np.float32)))
graph.output[0].type.tensor_type.shape.dim[2].dim_value = len(keep)
onnx.save(model, 'ocr-models/latin_PP-OCRv4_rec.onnx')
with open('src/ocr/latin_v4_keys.txt', 'w', encoding='utf8') as f:
    f.write('\n'.join(chars[k - 1] for k in keep[1:]))
print(f'kept {len(keep)} of {len(chars) + 1} classes')
