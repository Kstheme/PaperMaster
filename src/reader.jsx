import React, { lazy, Suspense, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, ArrowRight, BookmarkPlus } from 'lucide-react';
import { Sample } from './illustrations.jsx';
import { Markdown } from './markdown.jsx';
import { EffortInfo, EvidenceLinks } from './workbench-fields.jsx';
import { RepositoryReading } from './interaction-reader.jsx';
import { readingFigureParts, splitReadingMarkdown } from '../server/reading-markdown.js';
import { useLocale } from './locale.jsx';

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
  const { t } = useLocale();

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
    {sections.length > 1 && <nav className="reader-index" aria-label={t('readerIndex')}>
      <h3>{t('readerIndex')}</h3>
      <Tabs.List className="chapter-tabs" aria-label={t('chooseChapter')}>
        {sections.map(item => <Tabs.Trigger key={item.key} value={item.key}>{item.title}</Tabs.Trigger>)}
      </Tabs.List>
    </nav>}
    <Tabs.Content key={active.key} value={active.key} className="reader-content" asChild>
      <article ref={article}>
        <div className="chapter-header">
          <div><h2 ref={heading} tabIndex={-1}>{active.title}</h2><EffortInfo entry={active} localize/></div>
          <div className="actions">
            {onTool && <button onMouseDown={event => event.preventDefault()} onClick={() => openTool()}>{t('askHere')}</button>}
            {onAppend && <button disabled={busy} onClick={() => onAppend(active.key)}><BookmarkPlus size={15}/>{t('addToNote')}</button>}
          </div>
        </div>
        <Chapter item={active} figures={figures?.[active.key]} repo={repo} initialStep={initialStep} onTool={onTool ? openTool : undefined}
          renderFigure={name => renderFigure(name, onTool ? openTool : undefined)}/>
        {active.searched && <aside className="repo-reading-evidence">
          <h3>{t('chapterEvidence')}</h3>
          {active.evidence?.length ? <EvidenceLinks items={active.evidence}/> : <p className="muted">{t('noEvidence')}</p>}
          <details><summary>{t('filesConsulted')}</summary><ul>{active.searched.map(file => <li key={file}><code>{file}</code></li>)}</ul></details>
        </aside>}
        {sections.length > 1 && <nav className="chapter-pagination" aria-label={t('adjacentChapters')}>
          {activeIndex > 0 && <button onClick={() => turnPage(activeIndex - 1)}><ArrowLeft size={15}/>{sections[activeIndex - 1].title}</button>}
          {activeIndex < sections.length - 1 && <button onClick={() => turnPage(activeIndex + 1)}>{sections[activeIndex + 1].title}<ArrowRight size={15}/></button>}
        </nav>}
      </article>
    </Tabs.Content>
  </Tabs.Root>;
}

function Chapter({ item, figures, renderFigure, repo, onTool, initialStep }) {
  const { t } = useLocale();
  const sample = !figures?.length && Boolean(item.sample?.length);
  const softmax = !figures?.length && item.simulation === 'softmax';
  const { before, after } = splitReadingMarkdown(item.markdown, sample || softmax);
  const keys = [...(figures || []), ...(item.repository ? [item.repository.key] : [])];
  return <>
    {item.summary && <div className="chapter-summary"><Markdown>{item.summary}</Markdown></div>}
    {!!item.takeaways?.length && <aside className="takeaways" aria-label={t('takeaways')}>
      <h3>{t('takeaways')}</h3>
      <ul>{item.takeaways.map((point, index) => <li key={index}><Markdown>{point}</Markdown></li>)}</ul>
    </aside>}
    <div className="chapter-body">
      {readingFigureParts(before, keys).map((part, index) => part.key
        ? <React.Fragment key={part.key}>{part.key === item.repository?.key
          ? <RepositoryReading block={item.repository} repo={repo} onTool={onTool} initialStep={initialStep}/> : renderFigure(part.key)}</React.Fragment>
        : <Markdown chapter key={index}>{part.markdown}</Markdown>)}
      {sample && softmax ? <Tabs.Root className="chapter-demo" defaultValue="formula">
        <Tabs.List className="demo-tabs" aria-label={t('demoTabs')}>
          <Tabs.Trigger value="formula">{t('formulaDemo')}</Tabs.Trigger>
          <Tabs.Trigger value="sample">{t('sampleTrace')}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="formula"><Formula/></Tabs.Content>
        <Tabs.Content value="sample"><Sample steps={item.sample}/></Tabs.Content>
      </Tabs.Root> : sample ? <Sample steps={item.sample}/> : softmax ? <Formula/> : null}
      {after && readingFigureParts(after).map((part, index) => <Markdown chapter key={index}>{part.markdown}</Markdown>)}
    </div>
  </>;
}

function Formula() {
  const { t } = useLocale();
  return <Suspense fallback={<p className="visual-loading muted" role="status">{t('loadingFormula')}</p>}><Softmax/></Suspense>;
}
