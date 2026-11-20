import { readFile, stat } from 'node:fs/promises';
import { openPdf } from './import.js';
import { writeAtomic } from './library.js';

const captionPattern = /(?:^|\n)\s*(figure|fig\.|table|图|表)\s*([1-9]\d{0,2})\s*[:.：]\s*([^\n]{5,360})/gi;

export function sourcesIn(pages) {
  const sources = [];
  const seen = new Set();
  for (const [index, page] of pages.entries()) {
    for (const match of page.matchAll(captionPattern)) {
      const type = /^(table|表)$/i.test(match[1]) ? 'table' : 'figure';
      const id = `${type}-${match[2]}-${index + 1}`;
      if (seen.has(id)) continue;
      seen.add(id);
      sources.push({ id, type, page: index + 1, number: Number(match[2]), caption: match[3].trim() });
    }
  }
  return sources.slice(0, 60);
}

export const sourceAsset = (library, paper, version, source) =>
  library.path(paper.id, version.id + '.crop-v2-' + source.id + '.png');

function textLines(items, height) {
  const rows = new Map();
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const [x, y] = item.transform.slice(4);
    const top = height - y;
    const baseline = Math.round(top * 2) / 2;
    if (!rows.has(baseline)) rows.set(baseline, []);
    rows.get(baseline).push({ x, text: item.str });
  }
  return [...rows].sort(([a], [b]) => a - b).map(([top, pieces]) => {
    pieces.sort((a, b) => a.x - b.x);
    return { top, pieces, text: pieces.map(item => item.text.trim()).join(' ') };
  });
}

export async function prepareSource(library, material, source, signal) {
  const { paper, version, pages } = material;
  const fallback = { excerpt: pages[source.page - 1] || '', path: null };
  try {
    signal.throwIfAborted();
    const bytes = await readFile(library.path(paper.id, version.id + '.pdf'));
    const task = await openPdf(bytes);
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(source.page);
      const dimensions = page.getViewport({ scale: 1 });
      const { items } = await page.getTextContent();
      const lines = textLines(items, dimensions.height);
      const name = source.type === 'table' ? '(?:table|表)' : '(?:figure|fig\\.|图)';
      const label = new RegExp(`^${name}\\s*${source.number}\\s*[:.：]`, 'i');
      const locate = line => line.pieces.findIndex((_, index) =>
        label.test(line.pieces.slice(index, index + 4).map(piece => piece.text.trim()).join(' ')));
      const caption = lines.find(line => locate(line) >= 0);
      if (!caption) return fallback;

      // Keep the caption and nearby layout. A column-sized crop avoids mixing adjacent table rows.
      const left = caption.pieces[locate(caption)].x > dimensions.width * .48 ? dimensions.width * .47 : 0;
      const right = dimensions.width;
      const before = source.type === 'figure' ? 360 : 220;
      const top = Math.max(0, caption.top - before);
      const bottom = Math.min(dimensions.height, caption.top + (source.type === 'table' ? 245 : 50));
      const excerpt = lines.filter(line => line.top >= top && line.top <= bottom).map(line =>
        line.pieces.filter(piece => piece.x >= left && piece.x < right).map(piece => piece.text.trim()).join(' | ')).join('\n');
      const path = sourceAsset(library, paper, version, source);
      if (await stat(path).then(info => info.isFile(), () => false)) return { excerpt, path };
      try {
        const scale = Math.min(2, 1260 / (right - left));
        const viewport = page.getViewport({ scale });
        const factory = pdf.canvasFactory;
        const full = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const cropped = factory.create(Math.ceil((right - left) * scale), Math.ceil((bottom - top) * scale));
        try {
          await page.render({ canvas: full.canvas, canvasContext: full.context, viewport }).promise;
          signal.throwIfAborted();
          cropped.context.drawImage(full.canvas, -left * scale, -top * scale);
          await writeAtomic(path, cropped.canvas.toBuffer('image/png'));
          return { excerpt, path };
        } finally {
          factory.destroy(cropped);
          factory.destroy(full);
        }
      } catch {
        signal.throwIfAborted();
        return { excerpt, path: null };
      }
    } finally { await task.destroy().catch(() => {}); }
  } catch {
    signal.throwIfAborted();
    return fallback;
  }
}
