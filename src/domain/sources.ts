// Where the rules the app cites can be read in full: the agreement as
// published by Livsmedelsarbetareförbundet (one PDF with the appendices and
// the bakery supplement; its printed page numbers are the PDF's pages), and
// the Sick Pay Act at the Riksdag. Opened only when the user taps a link.
//
// A day is linked to the edition of the agreement in force then: the 2020
// edition (1 November 2020 – 31 March 2023) and the 2023 edition (1 April
// 2023 – 31 March 2025) have their own pages, and their shift-form supplement
// is §4.5 where the 2025 edition has §4.4. The 2023 edition is no longer on
// livs.se: it links to an archived copy of the printed agreement.

export const AGREEMENT_URL = 'https://www.livs.se/globalassets/livs.se/arbetsplats--och-avtalsfragor/kollektivavtal/livsmedelsavtalet-2025.pdf';
export const AGREEMENT_2020_URL = 'https://www.livs.se/globalassets/livs.se/arbetsplats--och-avtalsfragor/kollektivavtal/livsmedelsavtalet-2020-2023.pdf';
export const AGREEMENT_2023_URL = 'https://kollektivavtal.github.io/2023/livsmedelsavtalet.pdf';
export const SICK_PAY_ACT_URL = 'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-19911047-om-sjuklon_sfs-1991-1047/';

export type Source = 'agreement' | 'bakery' | 'appendixC' | 'appendixF' | 'sickPayAct';
type AgreementSource = Exclude<Source, 'sickPayAct'>;

export type Edition = '2020' | '2023' | '2025';

interface EditionInfo {
  url: string;
  /** The page each cited section starts on. */
  pages: Record<AgreementSource, Record<string, number>>;
  /** Sections numbered differently in this edition (the texts use the 2025 numbers). */
  renumbered?: Partial<Record<AgreementSource, Record<string, string>>>;
}

const EDITIONS: Record<Edition, EditionInfo> = {
  '2025': {
    url: AGREEMENT_URL,
    pages: {
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
    },
  },
  '2020': {
    url: AGREEMENT_2020_URL,
    pages: {
      agreement: {
        '': 1,
        '2': 8,
        '3': 9,
        '3.1': 9,
        '3.1.1': 9,
        '3.1.2': 9,
        '3.2': 10,
        '3.3': 11,
        '4': 12,
        '4.3': 13,
        '4.5': 13,
        '5': 14,
        '5.1': 14,
        '5.1.3': 15,
        '5.2': 15,
        '5.5': 16,
        '5.7': 17,
        '7.2': 19,
      },
      bakery: { '': 58, '1': 58, '2': 59, '3': 61, '4': 62, '5': 62 },
      appendixC: { '': 28, '5': 29, '5.3': 29 },
      appendixF: { '': 39, '1': 39, '2': 39, '3': 40, '4': 40, '5': 40, '5.1': 40, '5.2': 41, '6': 41, '7': 41, '8': 41, '9': 42, '10': 42, '11': 42, '12': 43 },
    },
    renumbered: { agreement: { '4.4': '4.5' } },
  },
  '2023': {
    url: AGREEMENT_2023_URL,
    pages: {
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
        '4.3': 13,
        '4.5': 14,
        '5': 15,
        '5.1': 15,
        '5.1.3': 15,
        '5.2': 16,
        '5.5': 16,
        '5.7': 17,
        '7.2': 19,
      },
      bakery: { '': 58, '1': 58, '2': 59, '3': 61, '4': 62, '5': 62 },
      appendixC: { '': 28, '5': 29, '5.3': 29 },
      appendixF: { '': 39, '1': 39, '2': 39, '3': 40, '4': 40, '5': 40, '5.1': 40, '5.2': 41, '6': 41, '7': 41, '8': 41, '9': 42, '10': 42, '11': 42, '12': 43 },
    },
    renumbered: { agreement: { '4.4': '4.5' } },
  },
};

/** The edition of the agreement in force on a date (the current one for a date after the last known). */
export const editionOn = (date?: string): Edition => (!date || date >= '2025-04-01' ? '2025' : date >= '2023-04-01' ? '2023' : '2020');

/** The years of the agreement edition in force on a date, as named on its cover ("2025–2027"). */
export const editionYears = (date?: string): string => ({ '2020': '2020–2023', '2023': '2023–2025', '2025': '2025–2027' })[editionOn(date)];

export interface Citation {
  source: Source;
  /** "5.1.3", "10" (of "§10–11"), or '' for the document as a whole; as numbered in the edition. */
  section: string;
  /** The page in the agreement PDF; none for the Sick Pay Act. */
  page?: number;
  href: string;
}

/** A section's page: the section's own, else the nearest enclosing one's. */
function pageOf(pages: Record<string, number>, section: string): number {
  for (let s = section; ; s = s.includes('.') ? s.slice(0, s.lastIndexOf('.')) : '') {
    if (pages[s] !== undefined) return pages[s];
  }
}

/** A citation of a section (numbered as in 2025) in a given edition of the agreement. */
export function cite(source: Source, section = '', edition: Edition = '2025'): Citation {
  if (source === 'sickPayAct') {
    const paragraph = section.split('.')[0];
    return { source, section, href: paragraph ? `${SICK_PAY_ACT_URL}#P${paragraph}` : SICK_PAY_ACT_URL };
  }
  const info = EDITIONS[edition];
  const own = info.renumbered?.[source]?.[section] ?? section;
  const page = pageOf(info.pages[source], own);
  return { source, section: own, page, href: `${info.url}#page=${page}` };
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

const hasSection = (source: Source, section: string) => source === 'sickPayAct' || EDITIONS['2025'].pages[source][section] !== undefined;

/**
 * A text split into plain parts and the citations in it: "Bilaga F §12",
 * "Tilläggsavtal Bagerier §3", "Sjuklönelagen 6 §", "§5.1.3". A bare "§"
 * belongs to the document named last in the text if that has the section
 * ("… Bilaga F … (§2)"), otherwise to the agreement itself.
 */
export function splitCitations(text: string, edition: Edition = '2025'): (string | { text: string; citation: Citation })[] {
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
    const citation = cite(source, section, edition);
    // A section numbered differently in this edition is shown with its own number.
    parts.push({ text: citation.section !== section && section ? linked.replace(section, citation.section) : linked, citation });
    at = m.index + linked.length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}
