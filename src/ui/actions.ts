// Ways to add something, opened from anywhere (Idag and the other pages):
// the clock scanner and the saved-photos picker live once in the app
// (ClockImportHost); the pay slip scanner lives on the Lön page, which is
// asked to open it when it next shows.

const CLOCK = 'lonekoll:clock';
const SLIP = 'lonekoll:slip-scan';

export type ClockAction = 'scan' | 'pick';

export const openClock = (action: ClockAction = 'scan') => window.dispatchEvent(new CustomEvent(CLOCK, { detail: action }));

export function onClock(handler: (action: ClockAction) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ClockAction>).detail);
  window.addEventListener(CLOCK, listener);
  return () => window.removeEventListener(CLOCK, listener);
}

let slipScanAsked = false;

/** Asks the Lön page to open the slip scanner (now if it shows, else when it does). */
export function askSlipScan() {
  slipScanAsked = true;
  window.dispatchEvent(new Event(SLIP));
}

/** The Lön page: whether the scanner was asked for (and the ask taken). */
export function takeSlipScan(): boolean {
  const asked = slipScanAsked;
  slipScanAsked = false;
  return asked;
}

export function onSlipScan(handler: () => void): () => void {
  const listener = () => takeSlipScan() && handler();
  window.addEventListener(SLIP, listener);
  return () => window.removeEventListener(SLIP, listener);
}
