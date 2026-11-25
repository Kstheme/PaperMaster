import { AppError } from './errors.js';

export const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function modelObject(text) {
  try {
    const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Return a readable model error. */ }
  throw new AppError('模型没有返回有效的结构化结果，请重试。', 502, 'invalid_model_output');
}

export function relevantPages(pages, query, limit = 12) {
  const words = [...new Set((query.toLowerCase().match(/[a-z0-9_-]{3,}|[\p{Script=Han}]{2,4}/gu) ?? []))].slice(0, 80);
  return pages.map((text, index) => ({ page: index + 1, text: text.slice(0, 4500), score:
    words.reduce((total, word) => total + Number(text.toLowerCase().includes(word)), 0) }))
    .filter(item => item.text.trim())
    .sort((a, b) => b.score - a.score || a.page - b.page).slice(0, limit)
    .sort((a, b) => a.page - b.page).map(({ page, text }) => ({ page, text }));
}

export function paperIdentity({ paper, version }) {
  return { paperId: paper.id, versionId: version.id, title: paper.title,
    version: version.arxivVersion || version.name, url: version.url };
}

export function paperLocation(paper, page, label) {
  const locator = { kind: 'paper', ...paper, page, label };
  const pinned = paper.url && /v\d+$/.test(paper.url);
  const url = pinned ? (page ? paper.url.replace(/\/abs\//, '/pdf/') + '#page=' + page : paper.url) : undefined;
  return { ...locator, url };
}

export const repoSourceUrl = (repo, file, from, to = from) => repo.url + '/blob/' + repo.commit + '/' +
  file.split('/').map(encodeURIComponent).join('/') + (from ? `#L${from}${to !== from ? `-L${to}` : ''}` : '');

// Existing snapshots mix plain prefixes with labelled excerpt windows. Preserve each real line number.
export function numberedExcerpt(file) {
  if (file.lines) return file.lines;
  const lines = {};
  let index = 1;
  for (const line of file.content.split(/\r?\n/)) {
    const marker = line.match(/^\[原文件第 (\d+) 行起\]$/);
    if (marker) { index = Number(marker[1]); continue; }
    lines[index++] = line;
  }
  return lines;
}

export function codeLocation(repo, file, from, to = from) {
  return { kind: 'code', repo: repo.url, commit: repo.commit, file, from, to, url: repoSourceUrl(repo, file, from, to) };
}

const compact = text => text.trim().replace(/\s+/g, ' ').toLowerCase();

export function validateEvidence(raw, { material, pages, repo, files = [], saved = {} }) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).flatMap(item => {
    if (item?.kind === 'saved' && typeof item.id === 'string' && Object.hasOwn(saved, item.id)) return [saved[item.id]];
    if (typeof item?.quote !== 'string' || compact(item.quote).length < 6) return [];
    if (item.kind === 'paper') {
      const source = pages.find(page => page.page === item.page);
      if (!source || !compact(source.text).includes(compact(item.quote))) return [];
      const label = typeof item.label === 'string' && compact(source.text).includes(compact(item.label)) ? item.label.slice(0, 120) : undefined;
      return [paperLocation(paperIdentity(material), item.page, label)];
    }
    if (item.kind === 'code' && repo) {
      const file = files.find(file => file.name === item.file);
      const from = item.from;
      const to = item.to ?? from;
      if (!file || !Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from > 30) return [];
      const lines = numberedExcerpt(file);
      const quote = Array.from({ length: to - from + 1 }, (_, index) => lines[from + index]);
      if (quote.some(line => line === undefined) || !compact(quote.join('\n')).includes(compact(item.quote))) return [];
      return [codeLocation(repo, file.name, from, to)];
    }
    return [];
  });
}

export function evidenceLabel(item) {
  if (item.kind === 'code') return `${item.file} L${item.from}${item.to !== item.from ? '–' + item.to : ''} · ${item.commit}`;
  return `${item.title} · ${item.version}${item.page ? ' · 第 ' + item.page + ' 页' : ''}${item.label ? ' · ' + item.label : ''}`;
}

export function evidenceHref(item) {
  return item.url || '/?paper=' + encodeURIComponent(item.paperId) + '&pdf=' + encodeURIComponent(item.versionId) + (item.page ? '&page=' + item.page : '');
}

export function markdownText(text) {
  return String(text ?? '').replace(/[\\`*_{}\[\]<>#+|]/g, '\\$&');
}

export function evidenceMarkdown(item) {
  return `[${markdownText(evidenceLabel(item))}](<${evidenceHref(item)}>)`;
}
