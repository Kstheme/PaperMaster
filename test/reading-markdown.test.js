import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMarkdown, readingFigureParts, splitReadingMarkdown } from '../server/reading-markdown.js';

test('places each requested figure once and leaves fenced examples intact', () => {
  const input = '前文\n\n[[FIGURE:graph]]\n\n中段\n\n```text\n[[FIGURE:formula]]\n```\n\n[[FIGURE:graph]]\n\n[[FIGURE:unknown]]\n\n后文';
  assert.deepEqual(readingFigureParts(input, ['graph', 'formula']), [
    { markdown: '前文' }, { key: 'graph' },
    { markdown: '中段\n\n```text\n[[FIGURE:formula]]\n```\n\n\n\n后文' }, { key: 'formula' },
  ]);
});

test('normalizes model wrappers, titles, and math while preserving code and GFM tables', () => {
  const input = ['````markdown', '###公式', '用 \\(x\\) 计算，保留 `\\(literal\\)`。',
    '<h4>原始标题</h4>', '\\[', 'a + b', '\\]', '', '|指标|结果|', '|---|---|', '|F1|0.9|', '',
    '```python', '###no-change', '```', '````'].join('\n');
  const out = normalizeMarkdown(input);
  assert.match(out, /^### 公式\n/);
  assert.ok(out.includes('用 $x$ 计算，保留 `\\(literal\\)`。'));
  assert.ok(out.includes('#### 原始标题'));
  assert.ok(out.includes('$$\na + b\n$$'));
  assert.ok(out.includes('|---|---|\n|F1|0.9|'));
  assert.ok(out.includes('```python\n###no-change\n```'));
  assert.equal(normalizeMarkdown(String.raw`###标题\n\n正文`), '### 标题\n\n正文');
  assert.equal(normalizeMarkdown(String.raw`###标题\n正文`), '### 标题\n\n正文');
  assert.equal(normalizeMarkdown(out), out);
});

test('places a demo next to its formula and removes only prose markers', () => {
  const item = ['```text', '[[PAPERMASTER_DEMO]]', '```', '', '###公式', '$$', 'a+b', '$$',
    '[[PAPERMASTER_DEMO]]', '###下一段', '解释', '[[PAPERMASTER_DEMO]]'].join('\n');
  const {before, after} = splitReadingMarkdown(item, true);
  assert.match(before, /a\+b\n\$\$$/);
  assert.match(before, /```text\n\[\[PAPERMASTER_DEMO\]\]/);
  assert.equal(after, '### 下一段\n\n解释');
  assert.equal(splitReadingMarkdown(item, false).after, '');
  const fallback = splitReadingMarkdown('### 公式\n\n$$\nx\n$$\n\n解释', true);
  assert.equal(fallback.after, '解释');
});
