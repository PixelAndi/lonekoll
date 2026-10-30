// Adds digit samples that users have shared (lonekoll-siffror.json files) to
// the set built into the app (src/ocr/shared-digits.json), so the scanner
// knows the clock's digits from the start. Keeps the newest SAMPLES_PER_DIGIT
// of each digit and skips exact duplicates.
//   node scripts/add-digit-samples.mjs file1.json [file2.json …]
import { readFileSync, writeFileSync } from 'node:fs';

const SAMPLES_PER_DIGIT = 60;
const target = new URL('../src/ocr/shared-digits.json', import.meta.url);
const set = JSON.parse(readFileSync(target, 'utf8'));
const seen = new Set(set.samples.map((s) => `${s.d}:${s.px}`));
let added = 0;
for (const path of process.argv.slice(2)) {
  const file = JSON.parse(readFileSync(path, 'utf8'));
  if (file.format !== 'lonekoll-digits' || file.width !== set.width || file.height !== set.height) {
    console.error(`${path}: not a Lönekoll digit file`);
    continue;
  }
  for (const s of file.samples) {
    if (!/^\d$/.test(s.d) || typeof s.px !== 'string' || seen.has(`${s.d}:${s.px}`)) continue;
    seen.add(`${s.d}:${s.px}`);
    set.samples.unshift({ d: s.d, px: s.px });
    added++;
  }
}
const kept = new Map();
set.samples = set.samples.filter((s) => {
  const n = kept.get(s.d) ?? 0;
  kept.set(s.d, n + 1);
  return n < SAMPLES_PER_DIGIT;
});
writeFileSync(target, JSON.stringify(set) + '\n');
console.log(`added ${added}; the set now has ${set.samples.length} samples`, Object.fromEntries([...kept].sort()));
