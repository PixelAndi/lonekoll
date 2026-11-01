# Lönekoll – notes for Claude

A local-first PWA that checks a bakery worker's pay against what they
actually worked: clock stamps (photos of the time clock), printed timecards
(tidkort) and pay slips (lönebesked), under Livsmedelsavtalet and Tilläggsavtal
Bagerier. Live at https://pixelandi.github.io/lonekoll/ (GitHub Pages, deployed
by `.github/workflows/deploy.yml` on every push to `main`; the tests must pass).
README.md describes the features and rules in detail – read it first.

## Hard rules

- **This repository is public. Never commit personal data**: no real names,
  employer, addresses, employee numbers, stamp times, hours, amounts, wage
  rates, pay periods or dates taken from the owner's documents – not in code,
  tests, comments, fixtures, screenshots or commit messages. Tests use
  made-up values only. Before every commit, scan the staged diff for values
  you have seen in real documents this session, and replace any you find.
- **Real data may be used to develop the app, not stored in the repo.** The
  owner allows using their real documents and data – names and numbers
  included (their Google Drive folder `Lönekoll` via the Google Drive
  connector, the app's `Appdata/lonekoll-data.json` there, or files attached
  in chat) – to test and develop any of the app's functionality, on the
  condition that none of it ever becomes visible to the app's users (the app
  will be shared with colleagues, and this repo is public). Keep copies only in the session's
  scratchpad, never in the repo, and delete them when done. Debug harnesses
  (e.g. a temporary HTML page importing `src/ocr/browser.ts`) must be removed
  before committing.
- **The app's privacy promise is enforced by `src/privacy.test.ts`** and the
  CSP in `vite.config.ts`: nothing leaves the device except by the user's
  choice. Network calls exist only in `src/cloud/google.ts` (the user's own
  Google Drive, `drive.file` scope) and sharing only in `src/share.ts`. Don't
  loosen this; a deliberate exception must change the test, in the open.
- Never rewrite published history without the owner's explicit approval. (Old
  history holds a real worked-hours figure in commit 62f406d's message and
  two stamp times in a test file before e9ed513; the owner has seen them and
  decided to leave them.)
- Commit to `main` and push when the owner asks (they test on the live site).
  No pull requests unless asked. No model names in commits or code.

## Working with the owner

- The owner tests on their phone (Android, Chrome, app added to the home
  screen) and replies in English; the app's UI is Swedish first.
- Every user-facing string exists in four languages: `src/i18n.ts` (Swedish
  `sv` and English `en`), `src/i18n-pl.ts` (Polish), `src/i18n-prs.ts` (Dari).
  Swedish is the source; all dictionaries must have the same keys.
- Prefer measuring on real data over guessing; say plainly what was and
  wasn't tested.

## Commands

```
npm install
npm test          # vitest
npm run typecheck # tsc -b
npm run build     # also copies the OCR assets into public/ocr
npm run dev       # vite
```

Chromium and Playwright are pre-installed in cloud sessions: `require('playwright')`
with `vite preview` is how the UI has been checked. Google Drive can be faked
in Playwright by routing `https://accounts.google.com/gsi/client` and
`https://www.googleapis.com/**`.

## Map

- `src/domain/` – the rules and calculations: `model.ts` (settings, wage
  periods, minimum wage), `calc.ts`, `compare.ts` (calculated pay vs the slip),
  `payslip.ts` (pay slip parser for PDF and photo text), `raises.ts`,
  `coverage.ts`, `missing.ts`, `vacation.ts`, `tax.ts`, `sources.ts` (links to
  the agreement).
- `src/ocr/` – on-device reading (assets bundled, no network): tesseract.js
  for the clock and timecards – `pipeline.ts` (clock photos), `timecard.ts`
  (printed timecards: rules, rows, day alignment, voting across readings);
  PaddleOCR (PP-OCRv4 via onnxruntime-web, WASM workers) for pay slips –
  `paddle.ts` (line finding, CTC decoding, word boxes, å/ä/ö put back),
  `paddleWorker.ts`; `slipPhoto.ts` (words → table cells, grey bars
  lightened), `browser.ts` (entry points: `readPaySlipFast` is PaddleOCR,
  `readPaySlipImage` the older Tesseract fallback), `pageFind.ts` (aiming the
  camera; `SLIP_GAPS` for slips). The trimmed recognition model is committed
  in `ocr-models/` (`scripts/trim-paddle-rec.py` makes it from the npm model);
  `scripts/copy-ocr-assets.mjs` copies all OCR files to `public/ocr`.
- `src/ui/SlipScanner.tsx` – the live pay slip scanner (crops to the found
  print's height but the camera's full width; refuses print wider than tall);
  `src/ui/camera.ts` holds the camera helpers it shares with
  `TimecardScanner.tsx`, and `chime()` (tones made with Web Audio, no files;
  `settings.scanSound`, toggled by the speaker button in both scanners).
- `src/domain/agreementCheck.ts` – the slips against the agreement on their
  own (no clock data): the hourly wage against the minimum day by day (cause:
  the one-year step, a 1 April revision, or below), Bilaga J's lowest raise
  for wages above the minimum, and OB / overtime / sick pay / holiday pay
  prices; findings joined over months, with later "retro" or "Övrig
  ersättning" lines named as possible corrections, and the months that
  couldn't be checked. Shown on the pay slip page and per slip in the report
  (`AgreementFindings.tsx`). On the owner's slips it found the missed step
  after a year's employment (the owner confirms it happened).
- `src/domain/wageHistory.ts` – the wage on the slips step by step: each
  rate split into the agreement's minimum + "personligt tillägg", each change
  labelled (avtalshöjning 1 April, ettårshöjning, personlig höjning, up to the
  minimum, sänkning, under minimilönen); `wagesFromHistory` gives the settings
  that pay the same (minimum-basis rows with an hourly supplement; a period
  below the minimum set as the minimum). Shown and applied with one tap in
  `WageFromSlips.tsx` ("Ställ in lönen efter lönebeskeden").
- `src/domain/owed.ts` + `src/ui/Owed.tsx` – the rough owed estimate: card at
  the top of the pay slip page, one line on the Days tab, only when there is
  something. "Troligen för lite betalt" = agreement findings only; "Att utreda"
  = gross comparison differences, only for slips read reliably, with a wage
  read that the settings pay, a full basis and no absences the log lacks. A
  month counts from one source only; settled keys in `settings.settledOwed`;
  later corrections named, not subtracted; rough net from each slip's tax
  share (misread shares > 60 % ignored); amounts paid > 2 years ago flagged
  (MBL §64, hedged).
- `src/domain/basis.ts` – what a slip's comparison rests on (`periodBasis`):
  none (nothing logged: the report claims nothing, shows only what the slip
  pays), partial (days the slip pays without stamps; or, on summed slips,
  unlogged weekdays when the slip pays more hours than were logged) or full.
  With a partial basis, points where the slip shows *more* than the
  calculation become questions ("kan bero på saknade dagar"); where it shows
  less they stay claims (missing days can't explain them). Shown in the report
  (`BasisNote.tsx`, written for both employee and employer) and on the slip page.
- `src/ui/SlipsView.tsx` – the pay slip page: what was just read, "Att
  kontrollera" (incomplete readings, uncertain periods, the same slip saved
  more than once), the slips by year (`Fold`), then wage and vacation pay as
  folds. A photo read completely (`readCompletely` in SlipCheck.tsx) needs no
  check; a new reading of a slip already saved (same period and pay day)
  replaces it only when more complete. In Settings the wage card is one line
  linking to the pay slip page.
- `src/pdf/` – pay slip PDFs via pdf.js (bundled).
- `src/cloud/` – optional Google Drive copy: `google.ts` (only network file;
  OAuth client ID is here), `sync.ts` (upload, data.json for restore/merge,
  reduce old originals to previews, move files when a slip's period is
  corrected), `paths.ts` (Drive folder layout), `merge.ts`, `useCloud.ts`.
- `src/ui/` – React screens. `SlipCheck.tsx` is the check card shown after a
  slip is photographed or its period is uncertain.
- `src/db.ts` – Dexie (IndexedDB) tables; `src/backup.ts` – zip backup.

## Pay slips: the two layouts

The employer's slips come in two layouts (same table columns: Löneart,
Benämning, Datum, Kvantitet, Enhet, À-pris, Belopp):

- **Older:** one `1106 Timlön` line per working day, each with its date range
  (`YYMMDD - YYMMDD`), hours, à-pris and amount (plus sometimes a `0,00
  Timmar` line with only the price).
- **Newer:** summed lines per kind – Timlön total, OB, overtime, sick pay
  (with date ranges), Helglön, etc.

The parser handles both; photos of the older layout were verified to read
completely (rows split by tilt are joined, amounts without a comma recovered,
a lone figure placed by column, a misread price fixed). **PDFs of both were
verified on the owner's real slips (40 PDFs): every one gets its
period, pay day, gross, tax and net, and its lines add up to the gross.** The
newer layout has not been verified from a photo yet. Older slips print
"Löneperiod:" with a colon (versions before 0512ea8 missed it; such slips are
re-read at start, `tidySavedSlips`). Hourly overtime is printed as the
supplement ("Övertid 1/2/3, timavlönad, 50%/75%/100%") plus "Timlön vid
övertid" (the hour itself, read as wage). The 75 % level, seen only on
Saturdays, isn't in the app's rules, so it is compared as overtime in total. The pay day and payout
are printed on a grey bar (dark ink on grey, with print showing through from
the back); on a photo the bar is found and lightened (`lightenDarkBars`)
before the page is cleaned, which made the pay day readable on all 4 real
photos tried. A misread "Utbetalas" is accepted with a date after it, and
without the word the pay day is the date 1–62 days after the period (year
misread put right). If the payout is still unreadable it is gross − tax −
other deductions, rounded up to whole kronor (as these slips do). One real
photo still misses one of its 19 per-day lines (the check card warns).

Pay day setting (`settings.payDay`, default 25; `src/domain/payday.ts`): the
day of the month after the period, moved back to the last banking day
(weekends, public holidays, midsommar-/jul-/nyårsafton). It matched all 47
regular pay days on the owner's slips (2021–2026); one extra payout fell on
another day. It fills a pay day that couldn't be read (`payDateFrom:
'setting'`, said on the check card), and the check card notes a read pay day
that differs from it. A date read from the slip always wins.

The pay period is never taken from the import date: read from "Löneperiod"
(year checked against the other dates on the slip), else worked out from the
line dates or the pay day and flagged (`periodDoubt`) for the user to check.

## Open items

1. Verify reading of the newer (summed) slip layout from a real photo (PDFs
   are verified), and the live slip scanner on the owner's phone (speed,
   aiming). Measured on 4 real photos of older slips (cloud computer, 3
   workers): PaddleOCR read all 4 completely in 6–7 s each, Tesseract 3 of 4
   in 4–5 s. If too slow on the phone: try ONNX Runtime's WebGPU backend. Ask the owner where the 75 % overtime level comes from
   (Tilläggsavtal Bagerier or a local agreement) before adding it to the rules.
2. Partly done (`src/domain/basis.ts`, the report's "Underlag"): per-day slips
   name the exact days paid but not logged. Still open: compare each logged
   day's paid hours against its stamps and name the dates that differ.
3. A crash ("Något gick fel") on the Days tab with real data: reproduced with
   a slip saved without a period (its "" month broke the month list); fixed.
   If it comes back, ask the owner for a screenshot of the error screen.
4. Google sign-in has not been tried on an iPhone home-screen app (pop-up
   behaviour); if it fails, switch to a redirect-based sign-in.
5. Google OAuth app is in Testing: users must be added as test users; public
   use needs Google's verification (privacy policy page etc.).
6. Drive sync doesn't propagate deletions between phones (documented).
7. Possible: a space-saving option for the local-only mode.
