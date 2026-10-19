// DOM-free HTML helpers for plugins (the runner has no DOMParser). Good enough
// for the well-formed CMS output theatre sites produce, not for arbitrary HTML.

const NAMED: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  agrave: 'à',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  ouml: 'ö',
  uuml: 'ü',
  auml: 'ä',
  ccedil: 'ç',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, code: string) => {
    if (code[0] !== '#') return NAMED[code.toLowerCase()] ?? whole;
    const n =
      code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
  });
}

/** An HTML fragment's text, like textContent: tags dropped, entities decoded, whitespace collapsed. */
export function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** The text of every `<tag>…</tag>` in `html`, in order, skipping empty ones. Not for nested tags. */
export function textsOf(html: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  return Array.from(html.matchAll(pattern), (match) => textOf(match[1])).filter(Boolean);
}
