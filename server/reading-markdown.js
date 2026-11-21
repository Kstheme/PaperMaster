const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const demoMarker = /^\s*\[\[PAPERMASTER_DEMO\]\]\s*$/;
const figureMarker = /^ {0,3}\[\[FIGURE:([a-zA-Z0-9]+)\]\][ \t]*$/;

export function normalizeMarkdown(value) {
  let body = String(value ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!body.includes('\n') && (/\\n(?:\\n|[#>*+-]|\d+[.)])/.test(body) || /^#{1,6}[^\\]*\\n(?=\P{ASCII})/u.test(body))) {
    body = body.replace(/\\n\\n/g, '\n\n').replace(/\\n(?=$|[^a-zA-Z])/g, '\n');
  }
  const wrapper = body.trim().match(/^(\x60{3,}|~{3,})\s*(?:markdown|md)\s*\n([\s\S]*?)\n\1\s*$/i);
  if (wrapper) body = wrapper[2];
  const output = [];
  let open;
  let math = false;
  const lines = body.split('\n');
  for (const [index, raw] of lines.entries()) {
    const run = raw.match(fence);
    if (open) {
      output.push(raw);
      if (run && run[1][0] === open[0] && run[1].length >= open.length && !run[2].trim()) open = null;
      continue;
    }
    if (!math && run) { open = run[1]; output.push(raw); continue; }
    if (demoMarker.test(raw) && !math) { output.push('', '[[PAPERMASTER_DEMO]]', ''); continue; }
    let line = raw;
    if (/^\s*(?:\\\[|\\\]|\$\$)\s*$/.test(line)) {
      math = !math;
      if (math && output.at(-1)?.trim()) output.push('');
      output.push('$$');
      if (!math && lines[index + 1]?.trim()) output.push('');
      continue;
    }
    if (math || /^(?: {4}|\t)\S/.test(line)) { output.push(line); continue; }
    const oneLineMath = line.match(/^\s*\$\$(.+)\$\$\s*$/);
    if (oneLineMath) { output.push('', '$$', oneLineMath[1].trim(), '$$', ''); continue; }
    line = line.replace(/^( {0,3})(#{1,6})(?=[^\s#])/, '$1$2 ')
      .replace(/^\s*<(h[1-6])\b[^>]*>([^<>]+)<\/\1>\s*$/i, (_, tag, title) => '#'.repeat(Number(tag[1])) + ' ' + title)
      .replace(/^\s*<p\b[^>]*>([^<>]+)<\/p>\s*$/i, '$1');
    // Convert only delimiters in prose, preserving inline examples and fenced code.
    line = line.split(/(`+[^\n]*?`+)/).map((part, i) => i % 2 ? part
      : part.replace(/\\\((.+?)\\\)/g, (_, inner) => '$' + inner + '$')
        .replace(/\\\[(.+?)\\\]/g, (_, inner) => '\n$$\n' + inner + '\n$$\n')).join('');
    if (/^ {0,3}#{1,6}\s/.test(line)) {
      if (output.at(-1)?.trim()) output.push('');
      output.push(line);
      if (lines[index + 1]?.trim()) output.push('');
    } else output.push(line);
  }
  return output.join('\n').trim();
}

export function splitReadingMarkdown(value, hasDemo) {
  const lines = normalizeMarkdown(value).split('\n');
  let code;
  let math = false;
  let firstHeading = -1;
  let nextHeading = -1;
  let firstFormulaEnd = -1;
  const markers = new Set();
  for (const [i, line] of lines.entries()) {
    const run = line.match(fence);
    if (code) {
      if (run && run[1][0] === code[0] && run[1].length >= code.length && !run[2].trim()) code = null;
      continue;
    }
    if (!math && run) { code = run[1]; continue; }
    if (line.trim() === '$$') {
      math = !math;
      if (!math && firstFormulaEnd < 0) firstFormulaEnd = i + 1;
      continue;
    }
    if (math) continue;
    if (demoMarker.test(line)) { markers.add(i); continue; }
    if (/^ {0,3}#{1,6}\s/.test(line)) {
      if (firstHeading < 0) firstHeading = i;
      else if (nextHeading < 0) nextHeading = i;
    }
  }
  const position = !hasDemo ? lines.length : markers.values().next().value ??
    (firstFormulaEnd > 0 ? firstFormulaEnd : nextHeading > 0 ? nextHeading : lines.length);
  return {
    before: lines.filter((_, index) => index < position && !markers.has(index)).join('\n').trim(),
    after: lines.filter((_, index) => index >= position && !markers.has(index)).join('\n').trim(),
  };
}

export function readingFigureParts(value, keys = []) {
  const parts = [];
  const remaining = new Set(keys);
  let lines = [];
  let code;
  let math = false;
  function flush() {
    const markdown = lines.join('\n').trim();
    if (markdown) parts.push({ markdown });
    lines = [];
  }
  for (const line of normalizeMarkdown(value).split('\n')) {
    const run = line.match(fence);
    if (code) {
      if (run?.[1][0] === code[0] && run[1].length >= code.length && !run[2].trim()) code = undefined;
    } else if (!math && run) code = run[1];
    else if (line.trim() === '$$') math = !math;
    else if (!math) {
      const marker = line.match(figureMarker);
      if (marker) {
        if (remaining.delete(marker[1])) {
          flush();
          parts.push({ key: marker[1] });
        }
        continue;
      }
    }
    lines.push(line);
  }
  flush();
  for (const key of remaining) parts.push({ key });
  return parts;
}
