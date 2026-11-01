# Lönekoll

Check your pay against the time clock. Lönekoll is a local-first web app for
bakery workers on hourly pay or a monthly salary, covered by **Livsmedelsavtalet 2025–2027 with
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
  forget. A time it couldn't read at all and you typed in is learned too: its
  place on the screen follows from the times it did read (the In and Ut
  columns and the row spacing). Only cuts known to hold one character each
  (checked against the digits' proportions) are learned without checking.
- **Anonymous digit samples.** Under Inställningar the learned digits can be
  saved as a file to share with whoever develops the app: only the small
  single-digit pictures, in shuffled order, with no times, dates or names,
  and the page shows exactly what is in it. Nothing is sent automatically.
  Shared samples are added to the set built into the app
  (`node scripts/add-digit-samples.mjs file.json` updates
  `src/ocr/shared-digits.json`), so every new user's scanner starts out
  knowing the clock's digits.
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
- **Printed timecards (tidkort).** A small "Tidkort" button beside the scan
  button reads the time clock's printout from the employer: scanned live
  (the page in a paper-shaped frame is captured at full resolution when steady
  and sharp, page after page), photos or PDFs,
  several pages and months at once. The table's lines are removed before the
  text is read at about 2400 px across, every date of the period is counted
  in order (a misread date is put right by the weekday), and each day is
  checked against the card's own Arb Tid. A misread time is corrected from
  the card's second reading (Avr In / Avr Ut), a common digit mix-up or the
  total – only when exactly one correction makes the day add up; otherwise
  the day is put to the user. Days the app already has with other stamps,
  and ink in the Frånvaro box (handwritten sick or vacation notes, shown as a
  picture), are asked about before saving. The card itself is not stored.
- **Set up from a pay slip.** For a new user's first pay slip (or while no
  wage is set), the slip's page suggests settings, each with the line it
  comes from: the hourly wage or monthly salary, the overtime limit per shift
  that the slip's overtime fits, OB, the tax table and the employer. It shows
  whether the slip then matches; nothing changes until "Use selected".
- **Points to go through.** Each difference in the report is a numbered
  point: what differs (calculated and on the slip), a sum to check with a
  calculator (hours × rate = amount), the days and stamps behind it, the rule
  quoted word for word from the agreement with section and page, and either a
  correction asked for (Avvikelse) or a question when it may depend on a local
  agreement or an estimate, or the slip pays more (Fråga). An overview lists
  the points and their amounts, and each point has a box for the employer's
  answer. Clock photos of the days behind the points are always included.
- **Checks before a report is saved.** Saving first lists what to look at:
  working days without stamps, holidays without a shift marked (no
  schedule), stamps that don't add up, times saved while the scanner was
  unsure, pay slip lines the app can't check, and times changed by hand after
  scanning. When almost every row differs, or the gross differs by more than
  a tenth, it says to check the settings first, and points at a wage that
  differs from the slip or an overtime limit the slip fits. Earlier slips the
  calculation matched show the settings are probably right. Saving needs
  "I have checked" ticked. In the report, differences are "to go through",
  each with common innocent explanations; each row says how sure it is
  (certain, estimated, depends on local agreement); and times changed after
  scanning show what the scanner read.
- **Offline.** After the first visit the app works without internet; the
  scanner's text recognition (about 7 MB) is saved the first time it is used,
  or at once with "Make the app available offline" under Help and guides,
  which also explains adding the app to the home screen (with an install
  button where the browser offers one).
- **Guides.** A Help tab in the bottom bar lists the guides by topic (the
  time clock, your pay, the app), each on a page of its own: forgetting to
  stamp, scanning, checking a pay slip, komp time, vacation pay, installing,
  offline use and privacy. The forgotten-stamp guide shows, with pictures of the clock's two buttons, how to stamp after
  forgetting to clock in or out: press the grey button once so it lights up,
  then once more to stamp. The scanner repeats the tip when it finds a
  missing stamp.

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
- Every rule the app cites ("Bilaga F §5", "§3.1.2") links to where it can be
  read in full: the agreement as published by Livsmedelsarbetareförbundet,
  opened at the section's page (the page is also shown, for phones that open
  PDFs at the first page), and the Sick Pay Act at the Riksdag. The links are
  fixed addresses in `src/domain/sources.ts` and carry nothing from the app;
  they open only when tapped, without telling the other site where they came
  from.
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
| Overtime windows | The Sunday window runs from Saturday 11:00 and the holiday window from 18:00 the day before a holiday, both until ordinary working time starts on the next weekday: that day's scheduled start with a schedule, otherwise the "ordinary start" setting | Bageri §4 |
| Overtime | With no schedule: time past 8 h in a shift (the usual local agreement; the agreement's own fallback without one is 9 h 15 min), and a sixth shift in a week (both configurable). Weekdays +50 % for 2 h then +100 %; from Sat 11:00 and from 18:00 the day before a holiday +100 %. Weekday OB is paid on top; holiday overtime gets Sunday OB instead of holiday OB | Avtalet §3.1.2, §3.3; Bageri §2, §4 |
| Sick pay | 80 % of lost pay including OB; waiting-day deduction 20 % of an average week's sick pay; days 1–14 | Sjuklönelagen 6 §; Avtalet §5.2 |
| Holiday pay | Hours you would have worked, with the OB of an ordinary weekday | Avtalet §5.1 |
| Monthly salary | The same salary every calendar month, holidays included; a month the employment starts in is paid per day (or per hour for five working days or fewer). Pay per hour = salary × 12 / (52 × weekly hours), per day = salary × 12 / 365. Overtime pays the whole hour plus the supplement; no shift-form supplement. Sick hours on days 1–14 are deducted per hour, with no sick pay for the first 20 % of a week's hours in the spell and 80 % after; from day 15 every calendar day is deducted per day. Vacation deducts 1/21.75 of the salary a day; unpaid absence per hour for up to five working days, then per calendar day; never more than the salary. Minimum: the hourly minimum × 174. These are the agreement's guidelines; other rules may be agreed locally | Avtalet Bilaga F |
| Vacation pay | 13.2 % of the pay that fell due in the earning year (1 April–31 March, or the calendar year) less vacation pay itself, over the paid days earned (25, or a share rounded up for part of a year), at least 1 789 kr a day from 1 Apr 2026. Checked once a pay slip is imported for every month of the earning year; until then only against the minimum, with a progress bar under Pay slips showing the months still missing | Avtalet §5.7; Bageri §5 |
| Komptid | Overtime is paid in money, or taken as komp time (chosen in the settings and per day). Either an hour off per overtime hour with the supplement paid in money (default, as in most Livs supplements), or 1.5/2 hours off and nothing paid. Komp time taken is paid at the hourly wage; the month view shows the balance | Avtalet §4.3 |
| Working-time account | Hours taken and, if the hourly payout rate is entered, the amount | Bilaga C |
| With a schedule | Overtime past the scheduled length (optionally from a minimum per shift); a shift on a day off is overtime; work on a scheduled holiday is overtime plus holiday pay | Avtalet §3.3, §5.1 |
| Förskjuten tid | 37.07 kr/h (from 1 Apr 2026) for ordinary time outside the schedule when the employer moved the shift (marked on the day) | Bageri §3 |
| Skiftformstillägg | 5.3 % (two-shift, discontinuous three-shift, permanent night) or 11.1 % (continuous three-shift) of the hourly wage, not on overtime | Avtalet §4.4 |
| Tax | Table = municipal + regional tax + burial fee (+ church fee for members), 32.50 → 32 and 32.51 → 33; monthly table, column 1 (column 3 from 66) | Skatteverket |

Amounts change every 1 April; the agreement years in the app are in
`src/domain/agreement.ts`, each with its periods from the bakery supplement
(minimum wages, OB, förskjuten tid, lowest vacation pay) and Bilaga J:
1 November 2020 – 31 March 2023, 1 April 2023 – 31 March 2025 and 1 April
2025 – 31 March 2027, with no gap in between. Citations link to the edition in
force on the day (the 2020 and 2023 editions have their own pages, and their
shift-form supplement is §4.5); the 2023 edition is no longer on livs.se, so
it links to an archived copy. Under the 2020 edition the working day without a
local agreement was at most 9 hours (9 h 15 min from 2023). Tax tables and
municipal rates are bundled for 2021–2026. Add a new period there when a new agreement is
signed. Until then, a wage tied to the minimum keeps the last known minimum
and the app warns about it.

### Not covered

One-time tax (engångsskatt) on irregular payments, and absence that still
earns vacation pay (long sick leave, parental leave) in the vacation pay basis. Without a schedule, the end of the Sunday/holiday
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
