import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMarkdown } from '../server/reading-markdown.js';
import 'katex/dist/katex.min.css';

export function Markdown({ children, chapter = false }) {
  const headings = chapter ? { h1: 'h3', h2: 'h3', h3: 'h3', h4: 'h4', h5: 'h4', h6: 'h4' } : {};
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[[rehypeKatex, { trust: false, strict: 'ignore' }]]} skipHtml
    components={{
      ...headings,
      table: ({ node, ...props }) => <div className="markdown-table" tabIndex={0} role="region" aria-label="数据表"><table {...props}/></div>,
      img: ({ alt }) => <span>{alt || '图像'}</span>,
      a: ({ href, children: label }) => /^(?:https?:\/\/|\/\?paper=[\da-f-]{36}&(?:job|pdf)=)/i.test(href ?? '')
        ? <a href={href} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label}</span>,
    }}>{normalizeMarkdown(children)}</ReactMarkdown></div>;
}
