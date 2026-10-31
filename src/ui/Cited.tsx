import { useApp } from '../app-context.ts';
import { splitCitations } from '../domain/sources.ts';
import type { Translate } from '../i18n.ts';

/**
 * A text with each rule it cites ("Bilaga F §5", "§3.1.2") linked to where it
 * can be read in full. The agreement opens at the section's page; the page
 * is also shown, for phones that open a PDF at its first page.
 */
export function Cited({ text, t: translate }: { text: string; t?: Translate }) {
  const app = useApp();
  const t = translate ?? app.t;
  return (
    <>
      {splitCitations(text).map((part, i) => {
        if (typeof part === 'string') return part;
        const { href, page } = part.citation;
        return (
          <a key={i} className="citation" href={href} target="_blank" rel="noopener noreferrer" title={page ? t('cite.agreement', { page }) : t('cite.law')}>
            {part.text}
            {page && page > 1 && <span className="citation-page">{`\u00a0${t('cite.page', { page })}`}</span>}
          </a>
        );
      })}
    </>
  );
}
