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

- **Photo → times.** After clocking out, photograph the clock's day screen.
  The times are read on the device (Tesseract OCR, three readings voted per
  time) and shown next to a zoomed crop of the clock for you to confirm.
  Times the readings disagree on are highlighted. Missing stamps can be typed
  in and are marked as typed in. A shift over midnight (In on one day, Ut on
  the next) becomes one shift.
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
  against it.
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
- **Report.** A printable A4 report (Swedish or English) with the summary,
  explanations, assumptions, the day log and optionally the photos.
- **Offline.** After the first visit the app, including photo reading,
  works without internet.

## Privacy

- Everything is stored in the browser (IndexedDB) on the user's device. There
  is no server, no account and no analytics.
- The built app ships a strict Content Security Policy (`connect-src 'self'`),
  so the browser blocks any connection to another server.
- Backups are zip files the user saves and restores themselves
  (Settings → Your data).
- Never commit real photos or pay slips to this repository (it is public).

## Rules implemented

| Topic | Rule | Source |
| --- | --- | --- |
| Minimum wage | 169.92 / 176.83 kr/h (after one year's employment from age 18), from 1 Apr 2026; youth and trainee shares | Bageri §1 |
| OB | Level 1 Mon–Fri 00–06, Mon–Thu 18–24 · Level 2 Fri 18–24, Sat 00–06 · Level 3 Sat 06–24, Sun, New Year's Eve, Midsummer Eve · Level 4 public holidays (incl. Christmas Eve) | Bageri §2 |
| Overtime | With no schedule: time past 9 h 15 min in a shift, and a sixth shift in a week (configurable). Weekdays +50 % for 2 h then +100 %; from Sat 11:00 and from 18:00 the day before a holiday +100 %. Weekday OB is paid on top; holiday overtime gets Sunday OB instead of holiday OB | Avtalet §3.1.2, §3.3; Bageri §2, §4 |
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
3. After each shift, **Days → Photograph the time clock**. Missed a day? Page
   back on the clock with "Föreg Dag" and photograph it later. Several photos
   can be picked at once.
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
cd lonekoll
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
  wrapper, voting.
- `src/pdf/`: pdf.js text extraction.
- `src/ui/`: React screens; `src/db.ts` (Dexie/IndexedDB), `src/backup.ts`,
  `src/i18n.ts` (Swedish and English).

## Deploying

`.github/workflows/lonekoll.yml` tests and builds on every pull request and
deploys `dist/` to GitHub Pages on pushes to `main`. Enable it once under
**Settings → Pages → Source: GitHub Actions**.
