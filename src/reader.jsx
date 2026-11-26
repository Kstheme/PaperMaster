import React, { lazy, Suspense, memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, ArrowRight, BookmarkPlus } from 'lucide-react';
import { Sample } from './illustrations.jsx';
import { Markdown } from './markdown.jsx';
import { api } from './api.js';
import { EffortInfo, EvidenceLinks } from './workbench-fields.jsx';
import { RepositoryReading } from './interaction-reader.jsx';
import { readingHighlightColors } from '../server/highlight-anchor.js';
import { paintReadingHighlights, selectionAnchor, selectionBox } from './reading-highlights.js';
import { readingFigureParts, splitReadingMarkdown } from '../server/reading-markdown.js';

const Softmax = lazy(() => import('./softmax.jsx'));

export function Reader({ id, sections, onAppend, busy, figures, renderFigure, onTool, repo }) {
  const storageKey = 'papermaster.chapter.' + id;
  const [selected, setSelected] = useState(() => localStorage.getItem(storageKey));
  const activeIndex = Math.max(0, sections.findIndex(item => item.key === selected));
  const active = sections[activeIndex];
  const heading = useRef(null);
  const article = useRef(null);
  const bodyRef = useRef(null);
  const saving = useRef(false);
  const [highlights, setHighlights] = useState([]);
  const [toolbar, setToolbar] = useState(null);
  const [highlightError, setHighlightError] = useState('');
  const incoming = new URLSearchParams(window.location.search);
  const initialStep = incoming.get('job') === id && incoming.get('chapter') === active.key ? incoming.get('step') : null;

  useEffect(() => {
    let ignore = false;
    api('jobs/' + id + '/highlights').then(items => {
      if (!ignore) setHighlights(items);
    }).catch(error => { if (!ignore) setHighlightError(error.message); });
    return () => { ignore = true; };
  }, [id]);

  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root) return undefined;
    paintReadingHighlights(root, highlights.filter(item => item.section === active.key));
    return () => paintReadingHighlights(root, []);
  }, [highlights, active.key, active.markdown]);

  useEffect(() => {
    const show = () => {
      if (saving.current) return;
      const anchor = selectionAnchor(bodyRef.current);
      const box = anchor && selectionBox();
      if (!anchor || !box) {
        setToolbar(current => current ? null : current);
        return;
      }
      setToolbar(current => current && current.anchor.start === anchor.start && current.anchor.end === anchor.end
        && current.anchor.quote === anchor.quote && current.top === box.top && current.left === box.left
        ? current : { anchor, ...box });
    };
    const onPointerUp = event => {
      if (event.target instanceof Element && event.target.closest('.reading-highlight-toolbar')) return;
      show();
    };
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('keyup', show);
    document.addEventListener('selectionchange', show);
    window.addEventListener('scroll', show, true);
    window.addEventListener('resize', show);
    return () => {
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('keyup', show);
      document.removeEventListener('selectionchange', show);
      window.removeEventListener('scroll', show, true);
      window.removeEventListener('resize', show);
    };
  }, [active.key]);

  async function chooseColor(color) {
    const anchor = toolbar?.anchor;
    if (!anchor || saving.current) return;
    saving.current = true;
    setHighlightError('');
    try {
      const saved = await api('jobs/' + id + '/highlights', {
        method: 'POST', json: { section: active.key, color, ...anchor },
      });
      setHighlights(items => items.some(item => item.id === saved.id) ? items : [...items, saved]);
      setToolbar(null);
      window.getSelection()?.removeAllRanges();
    } catch (error) {
      setHighlightError(error.message || '阅读高亮没有保存。');
    } finally {
      saving.current = false;
    }
  }

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
        {highlightError && <p className="error" role="alert">{highlightError}</p>}
        <Chapter item={active} figures={figures?.[active.key]} repo={repo} initialStep={initialStep} bodyRef={bodyRef} onTool={onTool ? openTool : undefined}
          renderFigure={name => renderFigure(name, onTool ? openTool : undefined)}/>
        {toolbar && <div className="reading-highlight-toolbar" role="toolbar" aria-label="阅读高亮" style={{ top: toolbar.top, left: toolbar.left }}
          onPointerDown={event => event.preventDefault()}>
          <span className="reading-highlight-label">阅读高亮</span>
          {readingHighlightColors.map(color => <button key={color.id} type="button" data-color={color.id} aria-label={color.label} title={color.label}
            onClick={() => chooseColor(color.id)}/>)}
        </div>}
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

const ChapterMarkdown = memo(function ChapterMarkdown({ children }) {
  return <Markdown chapter>{children}</Markdown>;
});

function Chapter({ item, figures, renderFigure, repo, onTool, initialStep, bodyRef }) {
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
    <div className="chapter-body" ref={bodyRef}>
      {readingFigureParts(before, keys).map((part, index) => part.key
        ? <React.Fragment key={part.key}>{part.key === item.repository?.key
          ? <RepositoryReading block={item.repository} repo={repo} onTool={onTool} initialStep={initialStep}/> : renderFigure(part.key)}</React.Fragment>
        : <ChapterMarkdown key={index}>{part.markdown}</ChapterMarkdown>)}
      {sample && softmax ? <Tabs.Root className="chapter-demo" defaultValue="formula">
        <Tabs.List className="demo-tabs" aria-label="交互示例">
          <Tabs.Trigger value="formula">公式演算</Tabs.Trigger>
          <Tabs.Trigger value="sample">样本追踪</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="formula"><Formula/></Tabs.Content>
        <Tabs.Content value="sample"><Sample steps={item.sample}/></Tabs.Content>
      </Tabs.Root> : sample ? <Sample steps={item.sample}/> : softmax ? <Formula/> : null}
      {after && readingFigureParts(after).map((part, index) => <ChapterMarkdown key={'after-' + index}>{part.markdown}</ChapterMarkdown>)}
    </div>
  </>;
}

function Formula() {
  return <Suspense fallback={<p className="visual-loading muted" role="status">正在加载公式演算…</p>}><Softmax/></Suspense>;
}
