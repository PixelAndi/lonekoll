# Lönekoll

Check your pay against the time clock. Lönekoll is a local-first web app for
hourly-paid bakery workers covered by **Livsmedelsavtalet 2025–2027 with
Tilläggsavtal för Bageriföretag**. It reads photos of the time clock, works
out what you should be paid, compares that with your pay slip, and prints a
report you can go through with your employer.

> Svenska: Fota stämpelklockan efter varje pass, importera lönebeskedet (PDF)
> och se rad för rad om något skiljer – med hänvisning till avtalet. Allt
> sparas bara i din telefon.

## What it does

- **Scan → times.** After clocking out, scan the clock's day screen with the
  camera. Point it roughly at the clock's table: it only has to be inside a
  large frame, a bit off-centre or tilted is fine. Each frame is read in one
  pass; the table is found from the words on its date bar (the date, "Föreg
  Dag" and "Nästa Dag" give its place, size and tilt), and the stamp rows are
  read twice, once in that pass and once on their own as digits. Once locked
  on, the table is followed from frame to frame by matching a small picture of
  the date (no text recognition), and only the date and the rows are read
  there, which is much quicker. A searched frame counts as two readings when
  both agree, a followed frame as one, and the data is grabbed when at least
  three readings agree on every value: the scanner confirms
  with a check mark and the times, then opens the usual check. The guide is
  kept simple: one frame shows where the clock's table should go, with a
  faint sketch of the table in it (the date bar with "Föreg Dag" and "Nästa
  Dag", then the In and Ut times) until the real one is found; one plain
  instruction says what to do, with a big arrow beside the frame when the
  phone should move; the frame turns green when the table is in place, with a
  bar filling while the times are read. Only locked frames count. Nothing depends on the
  screen's colours. If a stamp is missing (the clock shows "xx:xx") and it
  isn't a shift that crosses midnight, the scanner says which one looks
  forgotten and asks whether to fill it in by hand or scan again. A shift
  that ends after midnight has its In on the previous day's screen: when a
  scan shows a morning Ut without In and that day isn't logged, the scanner
  asks to press "Föreg Dag" on the clock and scan it too ("Nästa Dag" the
  other way round), shows how with an animated sketch, checks that the clock
  shows the right day, and saves both days together. Days can always be typed
  in by hand instead, and saved photos can be chosen (those are read by
  finding the table's coloured bars). Times are read on the device
  (Tesseract OCR) and shown next to the picture for you to confirm.
  **The scanner learns.** Each saved scan teaches it the clock's digits: the
  digits of every time are kept as small pictures with the value you saved
  (your corrections included), on the phone only. Once it has seen every
  digit, it reads each scanned time a second way by comparing its digits
  with those: when both readings agree the scan finishes sooner, and a time
  it clearly reads differently is marked for you to double-check. It never
  makes a reading count for more unless both agree. Inställningar shows how
  far it has come and how often its own reading was right, and can make it
  forget.
- **Absences.** Sick (optionally the shift you were booked for), vacation,
  time off from the working-time account, a public holiday you would have
  worked, permission, unpaid leave.
- **With or without a schedule.** Without one, overtime follows the
  agreement's default limits. With a fixed (optionally rotating) schedule,
  overtime is time beyond the scheduled shift, a shift on a day off is
  overtime, a shift the employer moved pays förskjuten tid, and holiday pay
  and sick pay come from the schedule. Single days can be changed.
- **Only what applies to you.** OB, overtime, förskjuten tid and holiday pay
  can be switched off (e.g. when a personal supplement replaces förskjuten
  tid), skiftformstillägg can be switched on, and a personal supplement in the
  hourly wage is kept apart when checking the minimum wage.
- **Wage tied to the minimum.** A wage of "minimum wage + X kr" follows every
  new minimum (each 1 April, and the higher minimum after a year's employment
  from age 18) without new rows, and the slip's hourly price is checked
  against it. A supplement can be entered per month; it is converted with the
  agreement's 174 hours a month (Bilaga F §12).
- **Calculation per month.** Hourly wage, OB in four levels, overtime +50 % /
  +100 %, förskjuten tid, skiftformstillägg, sick pay and waiting-day
  deduction, holiday pay, time-bank payout, and estimated tax and net pay,
  plus warnings (below minimum wage, no break for 5 h, < 11 h rest, missing
  stamps).
- **Tax from the municipality.** Choose where you live (and whether you are
  in Svenska kyrkan); the app works out the tax table from Skatteverket's rates
  and checks the tax and net pay on the slip with Skatteverket's tables.
- **Pay slip comparison.** Import the PDF; each line is matched against the
  calculation, with the difference and the agreement section that applies.
- **Languages.** Swedish, English, Polish and Dari (chosen from the phone's
  language at first start, changeable in Settings). Dari is shown right to
  left, with Gregorian dates and the clock's Latin digits.
- **Report.** An A4 report, saved as PDF in Swedish (for the employer), in the
  user's app language, or both in one file (Swedish first), with the summary,
  explanations, assumptions, the day log and optionally the photos.
- **Offline.** After the first visit the app, including photo reading,
  works without internet.

## Privacy

Nobody but the user can see what they enter, including whoever develops or
hosts the app. This is a design rule, and it is enforced:

- Everything is stored in the browser (IndexedDB) on the user's device. There
  is no server, no account and no analytics.
- The built app ships a strict Content Security Policy (`connect-src 'self'`),
  so the browser blocks any connection to another server.
- The app has no way of sending data out: no network calls of its own, no
  sharing to other apps. The offline cache (`src/sw-template.js`) only passes
  on the app's own requests for its own files.
- Pay slips (lönebesked) are read on the device: the PDF's bytes go straight
  to pdf.js, which is bundled with the app, and the PDF and what was read from
  it are stored only in the device's IndexedDB (deleting the slip deletes
  both). It is never uploaded, and the app tells the user so where they import
  it. Importing one makes no request except for the app's own pdf.js files.
- `src/privacy.test.ts` checks all of this. The tests run before every
  deploy, so a change that adds a way to send data out, or loosens the
  security policy, fails the build and is never published.
- The only things that leave the device are what the user chooses to save:
  a backup zip and the printed report.
- The app is served by GitHub Pages. Like any website host, GitHub sees which
  addresses download the app's files; the repository owner gets no visitor
  logs, and no app data is ever sent.
- Never commit real photos, pay slips, names or stamp times to this repository
  (it is public); tests use made-up values only.

## Rules implemented

| Topic | Rule | Source |
| --- | --- | --- |
| Minimum wage | 169.92 / 176.83 kr/h (after one year's employment from age 18), from 1 Apr 2026; youth and trainee shares | Bageri §1 |
| OB | Level 1 Mon–Fri 00–06, Mon–Thu 18–24 · Level 2 Fri 18–24, Sat 00–06 · Level 3 Sat 06–24, Sun, New Year's Eve, Midsummer Eve · Level 4 public holidays (incl. Christmas Eve) | Bageri §2 |
| Overtime | With no schedule: time past 8 h in a shift (the usual local agreement; the agreement's own fallback without one is 9 h 15 min), and a sixth shift in a week (both configurable). Weekdays +50 % for 2 h then +100 %; from Sat 11:00 and from 18:00 the day before a holiday +100 %. Weekday OB is paid on top; holiday overtime gets Sunday OB instead of holiday OB | Avtalet §3.1.2, §3.3; Bageri §2, §4 |
| Sick pay | 80 % of lost pay including OB; waiting-day deduction 20 % of an average week's sick pay; days 1–14 | Sjuklönelagen 6 §; Avtalet §5.2 |
| Holiday pay | Hours you would have worked, with the OB of an ordinary weekday | Avtalet §5.1 |
| Vacation pay | Checked against the minimum per day (1 789 kr from 1 Apr 2026) | Avtalet §5.7; Bageri §5 |
| Working-time account | Hours taken and, if the hourly payout rate is entered, the amount | Bilaga C |
| With a schedule | Overtime past the scheduled length (optionally from a minimum per shift); a shift on a day off is overtime; work on a scheduled holiday is overtime plus holiday pay | Avtalet §3.3, §5.1 |
| Förskjuten tid | 37.07 kr/h (from 1 Apr 2026) for ordinary time outside the schedule when the employer moved the shift (marked on the day) | Bageri §3 |
| Skiftformstillägg | 5.3 % (two-shift, discontinuous three-shift, permanent night) or 11.1 % (continuous three-shift) of the hourly wage, not on overtime | Avtalet §4.4 |
| Tax | Table = municipal + regional tax + burial fee (+ church fee for members), 32.50 → 32 and 32.51 → 33; monthly table, column 1 (column 3 from 66) | Skatteverket |

Amounts change every 1 April; both agreement years are in
`src/domain/agreement.ts`. Add a new period there when a new agreement is
signed. Until then, a wage tied to the minimum keeps the last known minimum
and the app warns about it.

### Not covered

Vacation pay beyond the daily minimum (it depends on the whole earning year),
monthly salaries and time off in lieu, and one-time tax (engångsskatt) on
irregular payments. Without a schedule, the end of the Sunday/holiday
overtime window uses a configurable "ordinary start" (default 06:00), and sick
pay without a booked shift is an estimate from up to 13 weeks of logged
shifts. This is a calculation aid, not a legal assessment.

## Using it

1. Open the app on your phone and choose **Add to Home Screen**.
2. **Settings:** enter your hourly wage and the date it applies from: either
   "the minimum wage + a supplement" (follows the agreement by itself; enter
   "Employed since") or a fixed amount (add a row when it changes; put any
   personal supplement under "varav tillägg"),
   choose your schedule (or none), switch off supplements that don't apply to
   you, and choose your municipality under Tax.
3. After each shift, **Days → Scan the time clock** and follow the hints until
   it says Done. Missed a day? Page back on the clock with "Föreg Dag" and scan
   it. Saved photos (several at once) can be chosen with **Choose saved
   photos**.
4. When the pay slip arrives, **Pay slips → Import pay slip (PDF)**. Hours
   worked in one month are usually paid the month after.
5. **Create report for the employer** → print or save as PDF.

## Tax data

Skatteverket's monthly tax tables (tables 29–42, columns 1 and 3) and the
municipal tax rates per parish are bundled in `src/domain/tax-data/`. Fetch a
new year when Skatteverket publishes it (December):

```sh
node scripts/fetch-tax-data.mjs 2027
```

(Behind an HTTP proxy, Node's fetch needs `NODE_USE_ENV_PROXY=1`.)

## Development

```sh
npm install
npm run dev        # copies the OCR files to public/ocr, starts Vite
npm test           # unit tests (rules, pay slip parser, OCR parsing)
npm run build      # type-check and build to dist/
npm run preview    # serve dist/ (with the service worker and CSP)
```

Reading real photos can be tested in Node without committing them: put the
photos (`*.jpg`) and an optional `expected.json` in a folder outside the repo.

```sh
OCR_SAMPLES=/path/to/photos npx vitest run src/ocr/samples.test.ts
```

```json
{ "1.jpg": { "date": "2026-10-29", "rows": [{ "in": null, "out": "01:55" }] } }
```

Code layout:

- `src/domain/`: agreement amounts, Swedish time and holidays, shift
  building, pay calculation, pay slip parsing and comparison (no browser APIs;
  all unit-tested).
- `src/ocr/`: locating the clock table by colour, preprocessing, Tesseract
  wrapper, voting, and the live frame checks used by the scanner.
- `src/pdf/`: pdf.js text extraction.
- `src/ui/`: React screens; `src/db.ts` (Dexie/IndexedDB), `src/backup.ts`,
  `src/i18n.ts` (Swedish and English), `src/i18n-pl.ts` (Polish) and
  `src/i18n-prs.ts` (Dari).

## Deploying

`.github/workflows/deploy.yml` tests and builds on every pull request and
deploys `dist/` to GitHub Pages on pushes to `main`
(https://pixelandi.github.io/lonekoll/). Enable it once under
**Settings → Pages → Source: GitHub Actions**.
