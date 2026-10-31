// Where the rules the app cites can be read in full: the agreement as
// published by Livsmedelsarbetareförbundet (one PDF with the appendices and
// the bakery supplement; its printed page numbers are the PDF's pages), and
// the Sick Pay Act at the Riksdag. Opened only when the user taps a link.

export const AGREEMENT_URL = 'https://www.livs.se/globalassets/livs.se/arbetsplats--och-avtalsfragor/kollektivavtal/livsmedelsavtalet-2025.pdf';
export const SICK_PAY_ACT_URL = 'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-19911047-om-sjuklon_sfs-1991-1047/';

export type Source = 'agreement' | 'bakery' | 'appendixC' | 'appendixF' | 'sickPayAct';

/** The page each cited section starts on, in the agreement PDF. */
const PAGES: Record<Exclude<Source, 'sickPayAct'>, Record<string, number>> = {
  agreement: {
    '': 1,
    '2': 8,
    '3': 9,
    '3.1': 9,
    '3.1.1': 9,
    '3.1.2': 9,
    '3.2': 10,
    '3.3': 12,
    '4': 13,
    '4.3': 14,
    '4.4': 14,
    '5': 15,
    '5.1': 15,
    '5.1.3': 15,
    '5.2': 16,
    '5.5': 16,
    '5.7': 17,
    '7.2': 19,
  },
  // Tilläggsavtal för Bageriföretag.
  bakery: { '': 58, '1': 58, '2': 59, '3': 61, '4': 62, '5': 62 },
  // Bilaga C, Arbetstidskonto och deltidspension.
  appendixC: { '': 28, '5': 29, '5.3': 29 },
  // Bilaga F, Riktlinjer för månadslön.
  appendixF: { '': 39, '1': 39, '2': 39, '3': 40, '4': 40, '5': 40, '5.1': 40, '5.2': 41, '6': 41, '7': 41, '8': 41, '9': 42, '10': 42, '11': 42, '12': 43 },
};

export interface Citation {
  source: Source;
  /** "5.1.3", "10" (of "§10–11"), or '' for the document as a whole. */
  section: string;
  /** The page in the agreement PDF; none for the Sick Pay Act. */
  page?: number;
  href: string;
}

/** A section's page: the section's own, else the nearest enclosing one's. */
function pageOf(source: Exclude<Source, 'sickPayAct'>, section: string): number {
  const pages = PAGES[source];
  for (let s = section; ; s = s.includes('.') ? s.slice(0, s.lastIndexOf('.')) : '') {
    if (pages[s] !== undefined) return pages[s];
  }
}

export function cite(source: Source, section = ''): Citation {
  if (source === 'sickPayAct') {
    const paragraph = section.split('.')[0];
    return { source, section, href: paragraph ? `${SICK_PAY_ACT_URL}#P${paragraph}` : SICK_PAY_ACT_URL };
  }
  const page = pageOf(source, section);
  return { source, section, page, href: `${AGREEMENT_URL}#page=${page}` };
}

// The documents' names as the texts use them, in every language. A plain
// "agreement" without a section is ordinary prose and isn't linked.
const NAMES: [Source, string, { alone: boolean }][] = [
  ['bakery', 'Tilläggsavtal(?:et)? för Bageriföretag|Tilläggsavtal(?:et)? Bagerier|[Bb]akery supplement|ضمیمهٔ نانوایی', { alone: true }],
  ['appendixF', '(?:Bilaga|Appendix|Załącznik(?:a|u)?|ضمیمهٔ) F', { alone: true }],
  ['appendixC', '(?:Bilaga|Appendix|Załącznik(?:a|u)?|ضمیمهٔ) C', { alone: true }],
  ['sickPayAct', 'Sjuklönelagen|[Ss]ick [Pp]ay [Aa]ct|قانون معاش مریضی', { alone: false }],
  ['agreement', 'Livsmedelsavtalet', { alone: true }],
  ['agreement', '[Aa]greement|[Uu]kład(?:u|zie)?|قرارداد', { alone: false }],
];
const SECTION = String.raw`§\s?(\d+(?:\.\d+)*)(?:\s?[–-]\s?\d+(?:\.\d+)*)?|(\d+)\s?§`;
const PATTERN = new RegExp(
  String.raw`(?:(${NAMES.map(([, n]) => `(?:${n})`).join('|')})\s?(?:${SECTION})?)|(?:${SECTION})`,
  'g',
);

const sourceOf = (name: string): [Source, boolean] => {
  for (const [source, pattern, { alone }] of NAMES) if (new RegExp(`^(?:${pattern})$`).test(name)) return [source, alone];
  return ['agreement', false];
};

const hasSection = (source: Source, section: string) => source === 'sickPayAct' || PAGES[source][section] !== undefined;

/**
 * A text split into plain parts and the citations in it: "Bilaga F §12",
 * "Tilläggsavtal Bagerier §3", "Sjuklönelagen 6 §", "§5.1.3". A bare "§"
 * belongs to the document named last in the text if that has the section
 * ("… Bilaga F … (§2)"), otherwise to the agreement itself.
 */
export function splitCitations(text: string): (string | { text: string; citation: Citation })[] {
  const parts: (string | { text: string; citation: Citation })[] = [];
  let last: Source = 'agreement';
  let at = 0;
  for (const m of text.matchAll(PATTERN)) {
    const [whole, name, namedSection, namedAfter, bareSection, bareAfter] = m;
    const section = namedSection ?? namedAfter ?? bareSection ?? bareAfter ?? '';
    let source: Source;
    if (name) {
      const [named, alone] = sourceOf(name);
      if (!section && !alone) continue;
      source = named;
      last = named;
    } else {
      source = last !== 'sickPayAct' && hasSection(last, section) ? last : 'agreement';
    }
    // "Bilaga F:s", "Livsmedelsavtalet 2025–2027": only the name itself is linked.
    const linked = whole.trimEnd();
    if (m.index > at) parts.push(text.slice(at, m.index));
    parts.push({ text: linked, citation: cite(source, section) });
    at = m.index + linked.length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}
