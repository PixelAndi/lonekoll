// Downloads Skatteverket's tax tables (monthly pay, columns 1 and 3) and the
// municipal tax rates for a year, and writes them to src/domain/tax-data/.
// Run once a year when the new tables are out (December):
//   node scripts/fetch-tax-data.mjs 2027
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const year = Number(process.argv[2] ?? new Date().getFullYear());
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'src', 'domain', 'tax-data');
const TABLES_API = 'https://skatteverket.entryscape.net/rowstore/dataset/88320397-5c32-4c16-ae79-d36d95b17b95/json';
const TABLES_PAGE = 'https://www.skatteverket.se/foretag/arbetsgivare/arbetsgivaravgifterochskatteavdrag/skattetabeller.html';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchTable(table) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const url = `${TABLES_API}?_limit=500&_offset=${offset}&tabellnr=${table}&${encodeURIComponent('år')}=${year}`;
    const page = await getJson(url);
    rows.push(...page.results);
    if (page.results.length < 500) break;
  }
  const amounts = [];
  const percent = [];
  for (const r of rows) {
    const from = Number(r['inkomst fr.o.m.']);
    const to = r['inkomst t.o.m.'] === '' ? 0 : Number(r['inkomst t.o.m.']);
    const row = [from, to, Number(r['kolumn 1']), Number(r['kolumn 3'])];
    if (r['antal dgr'] === '30B') amounts.push(row);
    else if (r['antal dgr'] === '30%') percent.push(row);
  }
  amounts.sort((a, b) => a[0] - b[0]);
  percent.sort((a, b) => a[0] - b[0]);
  return { amounts, percent };
}

/** "UPPLANDS VÄSBY" → "Upplands Väsby", "S:T OLOFS FÖRSAMLING" → "S:t Olofs församling". */
function titleCase(name) {
  return name
    .toLowerCase()
    .split(' ')
    .map((word, i) => (word === 'församling' && i > 0 ? word : word.replace(/(^|-)(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())))
    .join(' ');
}

async function fetchRates() {
  const page = await (await fetch(TABLES_PAGE)).text();
  const link = page.match(new RegExp(`href="([^"]*skattesatser-kommuner-${year}[^"]*\\.txt)"`))?.[1];
  if (!link) throw new Error(`No municipal tax rate file for ${year} on ${TABLES_PAGE}`);
  const text = await (await fetch(new URL(link, TABLES_PAGE))).text();
  const [header, ...lines] = text.split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const [cMun, cParish, cExcl, cFee] = [col('kommun'), col('församling'), col('summa, exkl. kyrkoavgift'), col('kyrkoavgift')];
  if ([cMun, cParish, cExcl, cFee].includes(-1)) throw new Error(`Unexpected columns: ${header.join(' | ')}`);
  const byName = new Map();
  for (const l of lines) {
    const name = titleCase(l[cMun].trim());
    const m = byName.get(name) ?? { name, rate: Number(l[cExcl]), parishes: [] };
    m.parishes.push({ name: titleCase(l[cParish].trim()), fee: Number(l[cFee]) });
    byName.set(name, m);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

const tables = {};
const percent = {};
for (let table = 29; table <= 42; table++) {
  const t = await fetchTable(table);
  if (t.amounts.length === 0) continue;
  tables[table] = t.amounts;
  percent[table] = t.percent;
  process.stdout.write(`table ${table}: ${t.amounts.length} + ${t.percent.length} rows\n`);
}
if (Object.keys(tables).length === 0) throw new Error(`No tax tables for ${year} yet`);
const municipalities = await fetchRates();

mkdirSync(outDir, { recursive: true });
const source = 'Skatteverket open data (skattetabeller, kommunala skattesatser)';
writeFileSync(path.join(outDir, `tables-${year}.json`), JSON.stringify({ year, source, columns: ['from', 'to', 'kolumn 1', 'kolumn 3'], tables, percent }));
writeFileSync(path.join(outDir, `rates-${year}.json`), JSON.stringify({ year, source, municipalities }));
console.log(`Wrote ${Object.keys(tables).length} tables and ${municipalities.length} municipalities for ${year} to ${path.relative(root, outDir)}`);
