import { locateHighlight, readingHighlightColors, readingHighlightContext } from '../server/highlight-anchor.js';

const colors = new Set(readingHighlightColors.map(item => item.id));

function markdownTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.parentElement?.closest('.markdown')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function offsetOf(nodes, target, inner) {
  let cursor = 0;
  for (const node of nodes) {
    if (node === target) return cursor + inner;
    cursor += node.nodeValue.length;
  }
  return null;
}

function markdownTextIn(root, nodes, edge) {
  const allowed = new Set(nodes);
  const found = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current;
  while ((current = walker.nextNode())) {
    if (allowed.has(current) && current.nodeValue) found.push(current);
  }
  if (!found.length) return null;
  return edge === 'start' ? found[0] : found.at(-1);
}

function boundaryOffset(nodes, container, offset, edge) {
  if (container.nodeType === Node.TEXT_NODE) {
    if (!nodes.includes(container)) return null;
    return offsetOf(nodes, container, offset);
  }
  if (container.nodeType !== Node.ELEMENT_NODE) return null;
  const child = container.childNodes[edge === 'start' ? offset : offset - 1];
  const text = child && markdownTextIn(child, nodes, edge === 'start' ? 'start' : 'end');
  if (!text) return null;
  return offsetOf(nodes, text, edge === 'start' ? 0 : text.nodeValue.length);
}

export function selectionAnchor(root) {
  const selection = window.getSelection();
  if (!root || !selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const nodes = markdownTextNodes(root);
  if (!nodes.length) return null;
  const start = boundaryOffset(nodes, range.startContainer, range.startOffset, 'start');
  const end = boundaryOffset(nodes, range.endContainer, range.endOffset, 'end');
  if (start == null || end == null || end <= start) return null;
  const text = nodes.map(node => node.nodeValue).join('');
  const quote = text.slice(start, end);
  if (!quote.trim() || quote.length > 4000) return null;
  return {
    quote,
    prefix: text.slice(Math.max(0, start - readingHighlightContext), start),
    suffix: text.slice(end, end + readingHighlightContext),
    start,
    end,
  };
}

export function selectionBox() {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return null;
  const width = 228;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const top = rect.top > 52 ? rect.top - 42 : Math.min(rect.bottom + 8, window.innerHeight - 48);
  return { top, left };
}

export function clearReadingHighlights(root) {
  if (!root) return;
  for (const mark of [...root.querySelectorAll('mark.reading-highlight')]) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
  }
  for (const block of root.querySelectorAll('.markdown')) block.normalize();
}

export function paintReadingHighlights(root, highlights) {
  clearReadingHighlights(root);
  if (!root || !highlights?.length) return;
  const ordered = [...highlights].filter(item => colors.has(item.color))
    .sort((a, b) => b.start - a.start || b.end - a.end);
  for (const item of ordered) {
    const nodes = markdownTextNodes(root);
    const span = locateHighlight(nodes.map(node => node.nodeValue).join(''), item);
    if (span) wrapSpan(nodes, span[0], span[1], item);
  }
}

function wrapSpan(nodes, start, end, highlight) {
  let offset = 0;
  const parts = [];
  for (const node of nodes) {
    const length = node.nodeValue.length;
    const nodeStart = offset;
    const nodeEnd = offset + length;
    offset = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const cutStart = Math.max(start, nodeStart) - nodeStart;
    const cutEnd = Math.min(end, nodeEnd) - nodeStart;
    let text = node;
    if (cutStart > 0) text = text.splitText(cutStart);
    if (cutEnd - cutStart < text.nodeValue.length) text.splitText(cutEnd - cutStart);
    parts.push(text);
  }
  for (const part of parts) {
    const mark = document.createElement('mark');
    mark.className = 'reading-highlight';
    mark.dataset.highlightId = highlight.id;
    mark.dataset.color = highlight.color;
    mark.title = '阅读高亮';
    part.before(mark);
    mark.append(part);
  }
}
