import { randomUUID } from 'node:crypto';
import { AppError, requiredText } from './errors.js';
import { markdownText } from './evidence.js';
import { readingHighlightColors } from './highlight-anchor.js';

const colors = new Set(readingHighlightColors.map(item => item.id));
const limit = 200;
const annotationLimit = 8000;

export function highlightService(library) {
  function list(jobId) {
    return library.all('highlights').filter(item => item.jobId === jobId)
      .sort((a, b) => a.section.localeCompare(b.section) || a.start - b.start || a.created.localeCompare(b.created));
  }

  function create(job, input) {
    const section = Array.isArray(job.sections) && job.sections.find(item => item.key === input.section && item.markdown);
    if (!section) throw new AppError('阅读高亮不属于这份阅读记录。');
    if (!colors.has(input.color)) throw new AppError('请选择高亮颜色。');
    const quote = passage(input.quote, '选区文字', 4000);
    const prefix = context(input.prefix);
    const suffix = context(input.suffix);
    const start = input.start;
    const end = input.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end - start !== quote.length || end > 200_000) {
      throw new AppError('选区位置无效。');
    }
    if (!sectionContains(section.markdown, quote)) throw new AppError('选区不在当前阅读正文中。');
    const saved = list(job.id);
    const existing = saved.find(item => item.section === section.key && item.color === input.color
      && item.start === start && item.end === end && item.quote === quote);
    if (existing) return existing;
    if (saved.length >= limit) throw new AppError('这份阅读记录的阅读高亮已达到保存上限。');
    return library.put('highlights', {
      id: randomUUID(), jobId: job.id, section: section.key, color: input.color,
      quote, prefix, suffix, start, end, created: new Date().toISOString(),
    });
  }

  function saveAnnotation(job, highlightId, input) {
    const current = owned(job, highlightId);
    if (!Object.hasOwn(input, 'annotation')) throw new AppError('请写下高亮批注。');
    const text = annotationText(input.annotation);
    const next = { ...current };
    if (!text) delete next.annotation;
    else next.annotation = { text, updated: new Date().toISOString() };
    return library.put('highlights', next);
  }

  function remove(job, highlightId) {
    owned(job, highlightId);
    library.remove('highlights', highlightId);
    return { id: highlightId };
  }

  function annotationPassage(job, highlightId) {
    const current = owned(job, highlightId);
    const paperId = job.references?.[0]?.id;
    if (job.mode === 'compare' || job.references?.length !== 1 || !paperId || job.status !== 'completed') {
      throw new AppError('仅可把高亮批注加入这篇论文已完成的主笔记。');
    }
    const text = current.annotation?.text;
    if (typeof text !== 'string' || !text.trim()) throw new AppError('请先写下高亮批注。');
    const section = Array.isArray(job.sections) && job.sections.find(item => item.key === current.section);
    const query = new URLSearchParams({
      paper: paperId, job: job.id, chapter: current.section, highlight: current.id,
    });
    const source = '[阅读位置 · ' + markdownText(section?.title || '原文') + '](/?' + query + ')';
    const quotation = markdownText(current.quote).split('\n').map(line => '> ' + line).join('\n');
    return ['### 高亮批注', source, quotation, text].join('\n\n');
  }

  function owned(job, highlightId) {
    const current = library.get('highlights', highlightId);
    if (!current || current.jobId !== job.id) throw new AppError('阅读高亮不属于这份阅读记录。', 404);
    return current;
  }

  return { list, create, saveAnnotation, remove, annotationPassage };
}

function passage(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AppError(`${label}需要 1–${max} 个字符。`);
  return value;
}

function context(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 80) throw new AppError('选区上下文无效。');
  return value;
}

function annotationText(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') throw new AppError(`高亮批注需要 1–${annotationLimit} 个字符。`);
  if (!value.trim()) return '';
  return requiredText(value, '高亮批注', annotationLimit);
}

function sectionContains(markdown, quote) {
  const compact = value => value.replace(/\s+/gu, '');
  return compact(markdown).includes(compact(quote));
}
