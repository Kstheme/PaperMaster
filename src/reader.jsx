import React, { lazy, Suspense, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, ArrowRight, BookmarkPlus } from 'lucide-react';
import { Sample } from './illustrations.jsx';
import { Markdown } from './markdown.jsx';
import { EffortInfo, EvidenceLinks } from './workbench-fields.jsx';
import { RepositoryReading } from './interaction-reader.jsx';
import { readingFigureParts, splitReadingMarkdown } from '../server/reading-markdown.js';

const Softmax = lazy(() => import('./softmax.jsx'));

export function Reader({ id, sections, onAppend, busy, figures, renderFigure, onTool, repo }) {
  const storageKey = 'papermaster.chapter.' + id;
  const [selected, setSelected] = useState(() => localStorage.getItem(storageKey));
  const activeIndex = Math.max(0, sections.findIndex(item => item.key === selected));
  const active = sections[activeIndex];
  const heading = useRef(null);
  const article = useRef(null);
  const incoming = new URLSearchParams(window.location.search);
  const initialStep = incoming.get('job') === id && incoming.get('chapter') === active.key ? incoming.get('step') : null;

  function openTool(text, context) {
    const selection = window.getSelection();
    const selected = selection && article.current?.contains(selection.anchorNode) && article.current.contains(selection.focusNode)
      ? selection.toString().trim() : '';
    onTool({ section: active.key, title: active.title, text: (text || selected || '').slice(0, 3500), ...context });
  }

  function select(key) {
    setSelected(key);
    localStorage.setItem(storageKey, key);
  }

  function turnPage(index) {
    select(sections[index].key);
    requestAnimationFrame(() => heading.current?.focus());
  }

  return <Tabs.Root className={figures ? 'reader reader-inline' : 'reader'} value={active.key} onValueChange={select} orientation="vertical" activationMode="manual">
    {sections.length > 1 && <nav className="reader-index" aria-label="阅读目录">
      <h3>阅读目录</h3>
      <Tabs.List className="chapter-tabs" aria-label="选择章节">
        {sections.map(item => <Tabs.Trigger key={item.key} value={item.key}>{item.title}</Tabs.Trigger>)}
      </Tabs.List>
    </nav>}
    <Tabs.Content key={active.key} value={active.key} className="reader-content" asChild>
      <article ref={article}>
        <div className="chapter-header">
          <div><h2 ref={heading} tabIndex={-1}>{active.title}</h2><EffortInfo entry={active}/></div>
          <div className="actions">
            {onTool && <button onMouseDown={event => event.preventDefault()} onClick={() => openTool()}>就此追问</button>}
            {onAppend && <button disabled={busy} onClick={() => onAppend(active.key)}><BookmarkPlus size={15}/>加入笔记</button>}
          </div>
        </div>
        <Chapter item={active} figures={figures?.[active.key]} repo={repo} initialStep={initialStep} onTool={onTool ? openTool : undefined}
          renderFigure={name => renderFigure(name, onTool ? openTool : undefined)}/>
        {active.searched && <aside className="repo-reading-evidence">
          <h3>本章证据</h3>
          {active.evidence?.length ? <EvidenceLinks items={active.evidence}/> : <p className="muted">暂无可定位的证据，涉及实现的结论待核实。</p>}
          <details><summary>查阅了哪些文件</summary><ul>{active.searched.map(file => <li key={file}><code>{file}</code></li>)}</ul></details>
        </aside>}
        {sections.length > 1 && <nav className="chapter-pagination" aria-label="相邻章节">
          {activeIndex > 0 && <button onClick={() => turnPage(activeIndex - 1)}><ArrowLeft size={15}/>{sections[activeIndex - 1].title}</button>}
          {activeIndex < sections.length - 1 && <button onClick={() => turnPage(activeIndex + 1)}>{sections[activeIndex + 1].title}<ArrowRight size={15}/></button>}
        </nav>}
      </article>
    </Tabs.Content>
  </Tabs.Root>;
}

function Chapter({ item, figures, renderFigure, repo, onTool, initialStep }) {
  const sample = !figures?.length && Boolean(item.sample?.length);
  const softmax = !figures?.length && item.simulation === 'softmax';
  const { before, after } = splitReadingMarkdown(item.markdown, sample || softmax);
  const keys = [...(figures || []), ...(item.repository ? [item.repository.key] : [])];
  return <>
    {item.summary && <div className="chapter-summary"><Markdown>{item.summary}</Markdown></div>}
    {!!item.takeaways?.length && <aside className="takeaways" aria-label="本章要点">
      <h3>本章要点</h3>
      <ul>{item.takeaways.map((point, index) => <li key={index}><Markdown>{point}</Markdown></li>)}</ul>
    </aside>}
    <div className="chapter-body">
      {readingFigureParts(before, keys).map((part, index) => part.key
        ? <React.Fragment key={part.key}>{part.key === item.repository?.key
          ? <RepositoryReading block={item.repository} repo={repo} onTool={onTool} initialStep={initialStep}/> : renderFigure(part.key)}</React.Fragment>
        : <Markdown chapter key={index}>{part.markdown}</Markdown>)}
      {sample && softmax ? <Tabs.Root className="chapter-demo" defaultValue="formula">
        <Tabs.List className="demo-tabs" aria-label="交互示例">
          <Tabs.Trigger value="formula">公式演算</Tabs.Trigger>
          <Tabs.Trigger value="sample">样本追踪</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="formula"><Formula/></Tabs.Content>
        <Tabs.Content value="sample"><Sample steps={item.sample}/></Tabs.Content>
      </Tabs.Root> : sample ? <Sample steps={item.sample}/> : softmax ? <Formula/> : null}
      {after && readingFigureParts(after).map((part, index) => <Markdown chapter key={index}>{part.markdown}</Markdown>)}
    </div>
  </>;
}

function Formula() {
  return <Suspense fallback={<p className="visual-loading muted" role="status">正在加载公式演算…</p>}><Softmax/></Suspense>;
}
