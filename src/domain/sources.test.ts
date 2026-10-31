import { describe, expect, it } from 'vitest';
import { DICTIONARIES, type TextKey } from '../i18n.ts';
import { AGREEMENT_URL, splitCitations, type Source } from './sources.ts';

const cited = (text: string) =>
  splitCitations(text).flatMap((p) => (typeof p === 'string' ? [] : [[p.text, p.citation.source, p.citation.page ?? p.citation.href] as const]));

describe('links to the rules cited', () => {
  it('finds each document and section, in every language', () => {
    expect(cited('Tilläggsavtal Bagerier §1. Bilaga F §12, Bilaga C §5.3 och Sjuklönelagen 6 § (Livsmedelsavtalet §5.2).')).toEqual([
      ['Tilläggsavtal Bagerier §1', 'bakery', 58],
      ['Bilaga F §12', 'appendixF', 43],
      ['Bilaga C §5.3', 'appendixC', 29],
      ['Sjuklönelagen 6 §', 'sickPayAct', expect.stringMatching(/#P6$/)],
      ['Livsmedelsavtalet §5.2', 'agreement', 16],
    ]);
    expect(cited('Appendix F §10–11 and Bakery supplement §4; Sick Pay Act §6')).toEqual([
      ['Appendix F §10–11', 'appendixF', 42],
      ['Bakery supplement §4', 'bakery', 62],
      ['Sick Pay Act §6', 'sickPayAct', expect.stringMatching(/#P6$/)],
    ]);
    expect(cited('Załącznik F §8 i układ §5.7')).toEqual([
      ['Załącznik F §8', 'appendixF', 41],
      ['układ §5.7', 'agreement', 17],
    ]);
    expect(cited('ضمیمهٔ نانوایی §2 و قرارداد §4.4')).toEqual([
      ['ضمیمهٔ نانوایی §2', 'bakery', 59],
      ['قرارداد §4.4', 'agreement', 14],
    ]);
  });

  it('gives a bare section to the document named before it, when that has it', () => {
    // Bilaga F §2: an employment starting during the month.
    expect(cited('Bilaga F, riktlinjer … högst fem arbetsdagar (§2).')).toEqual([
      ['Bilaga F', 'appendixF', 39],
      ['§2', 'appendixF', 39],
    ]);
    // The bakery supplement has no §3.1.2: that is the agreement's.
    expect(cited('Tilläggsavtal Bagerier §4. Utan schema … (§3.1.2)')).toEqual([
      ['Tilläggsavtal Bagerier §4', 'bakery', 62],
      ['§3.1.2', 'agreement', 9],
    ]);
  });

  it('leaves ordinary words alone and links only the names', () => {
    expect(cited('the agreement’s minimum')).toEqual([]);
    expect(cited('Livsmedelsavtalet 2025–2027 med Tilläggsavtal för Bageriföretag')).toEqual([
      ['Livsmedelsavtalet', 'agreement', 1],
      ['Tilläggsavtal för Bageriföretag', 'bakery', 58],
    ]);
    const parts = splitCitations('Se Bilaga F:s regel.');
    expect(parts.map((p) => (typeof p === 'string' ? p : `[${p.text}]`)).join('')).toBe('Se [Bilaga F]:s regel.');
    expect(splitCitations('Inget här.')).toEqual(['Inget här.']);
  });

  it('links every section cited anywhere in the app, to a page of the agreement or the Sick Pay Act', () => {
    const unlinked: string[] = [];
    const sources = new Set<Source>();
    for (const [lang, dictionary] of Object.entries(DICTIONARIES)) {
      for (const [key, text] of Object.entries(dictionary) as [TextKey, string][]) {
        const parts = splitCitations(text);
        expect(parts.map((p) => (typeof p === 'string' ? p : p.text)).join('')).toBe(text);
        for (const p of parts) {
          if (typeof p === 'string') {
            if (p.includes('§')) unlinked.push(`${lang} ${key}: ${p}`);
          } else {
            sources.add(p.citation.source);
            if (p.citation.source !== 'sickPayAct') expect(p.citation.href).toMatch(new RegExp(`^${AGREEMENT_URL.replace(/[.]/g, '\\.')}#page=\\d+$`));
          }
        }
      }
    }
    expect(unlinked).toEqual([]);
    expect([...sources].sort()).toEqual(['agreement', 'appendixC', 'appendixF', 'bakery', 'sickPayAct']);
  });
});
