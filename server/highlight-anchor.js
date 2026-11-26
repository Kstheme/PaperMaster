export const readingHighlightColors = [
  { id: 'amber', label: '黄色' },
  { id: 'green', label: '绿色' },
  { id: 'blue', label: '蓝色' },
  { id: 'rose', label: '粉色' },
];

export const readingHighlightContext = 48;

// Locate a saved selection in rendered plain text. Offsets are a hint; the quote and its
// surrounding text still find the original passage when the same words occur more than once.
export function locateHighlight(text, anchor) {
  const quote = anchor?.quote;
  if (typeof text !== 'string' || typeof quote !== 'string' || !quote) return null;
  const prefix = typeof anchor.prefix === 'string' ? anchor.prefix : '';
  const suffix = typeof anchor.suffix === 'string' ? anchor.suffix : '';
  let best = null;
  let bestScore = 0;
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(quote, from);
    if (index < 0) break;
    const before = text.slice(Math.max(0, index - prefix.length), index);
    const after = text.slice(index + quote.length, index + quote.length + suffix.length);
    let score = 1;
    if (prefix && before.endsWith(prefix)) score += 8;
    if (suffix && after.startsWith(suffix)) score += 8;
    if (anchor.start === index && anchor.end === index + quote.length) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
    from = index + 1;
  }
  return best == null ? null : [best, best + quote.length];
}
