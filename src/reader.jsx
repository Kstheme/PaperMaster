import React, { lazy, Suspense, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, ArrowRight, BookmarkPlus } from 'lucide-react';
import { Sample } from './illustrations.jsx';
import { Markdown } from './markdown.jsx';
import { splitReadingMarkdown } from '../server/reading-markdown.js';

const Softmax = lazy(() => import('./softmax.jsx'));

export function Reader({ id, sections, onAppend, busy }) {
  const storageKey = 'papermaster.chapter.' + id;
  const [selected, setSelected] = useState(() => localStorage.getItem(storageKey));
  const activeIndex = Math.max(0, sections.findIndex(item => item.key === selected));
  const active = sections[activeIndex];
  const heading = useRef(null);

  function select(key) {
    setSelected(key);
    localStorage.setItem(storageKey, key);
  }

  function turnPage(index) {
    select(sections[index].key);
    requestAnimationFrame(() => heading.current?.focus());
  }

  return <Tabs.Root className="reader" value={active.key} onValueChange={select} orientation="vertical" activationMode="manual">
    {sections.length > 1 && <nav className="reader-index" aria-label="阅读目录">
      <h3>阅读目录</h3>
      <Tabs.List className="chapter-tabs" aria-label="选择章节">
        {sections.map(item => <Tabs.Trigger key={item.key} value={item.key}>{item.title}</Tabs.Trigger>)}
      </Tabs.List>
    </nav>}
    <Tabs.Content key={active.key} value={active.key} className="reader-content" asChild>
      <article>
        <div className="chapter-header">
          <h2 ref={heading} tabIndex={-1}>{active.title}</h2>
          {onAppend && <button disabled={busy} onClick={() => onAppend(active.key)}><BookmarkPlus size={15}/>加入笔记</button>}
        </div>
        <Chapter item={active}/>
        {sections.length > 1 && <nav className="chapter-pagination" aria-label="相邻章节">
          {activeIndex > 0 && <button onClick={() => turnPage(activeIndex - 1)}><ArrowLeft size={15}/>{sections[activeIndex - 1].title}</button>}
          {activeIndex < sections.length - 1 && <button onClick={() => turnPage(activeIndex + 1)}>{sections[activeIndex + 1].title}<ArrowRight size={15}/></button>}
        </nav>}
      </article>
    </Tabs.Content>
  </Tabs.Root>;
}

function Chapter({ item }) {
  const sample = Boolean(item.sample?.length);
  const softmax = item.simulation === 'softmax';
  const { before, after } = splitReadingMarkdown(item.markdown, sample || softmax);
  return <>
    {item.summary && <div className="chapter-summary"><Markdown>{item.summary}</Markdown></div>}
    {!!item.takeaways?.length && <aside className="takeaways" aria-label="本章要点">
      <h3>本章要点</h3>
      <ul>{item.takeaways.map((point, index) => <li key={index}><Markdown>{point}</Markdown></li>)}</ul>
    </aside>}
    <div className="chapter-body">
      {before && <Markdown chapter>{before}</Markdown>}
      {sample && softmax ? <Tabs.Root className="chapter-demo" defaultValue="formula">
        <Tabs.List className="demo-tabs" aria-label="交互示例">
          <Tabs.Trigger value="formula">公式演算</Tabs.Trigger>
          <Tabs.Trigger value="sample">样本追踪</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="formula"><Formula/></Tabs.Content>
        <Tabs.Content value="sample"><Sample steps={item.sample}/></Tabs.Content>
      </Tabs.Root> : sample ? <Sample steps={item.sample}/> : softmax ? <Formula/> : null}
      {after && <Markdown chapter>{after}</Markdown>}
    </div>
  </>;
}

function Formula() {
  return <Suspense fallback={<p className="visual-loading muted" role="status">正在加载公式演算…</p>}><Softmax/></Suspense>;
}
