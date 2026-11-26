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
import { HighlightAnnotation } from './highlight-annotation.jsx';
import { readingFigureParts, splitReadingMarkdown } from '../server/reading-markdown.js';
import { useLocale } from './locale.jsx';

const Softmax = lazy(() => import('./softmax.jsx'));

export function Reader({ id, sections, onAppend, busy, figures, renderFigure, onTool, repo, onNote, canAppendNote = false }) {
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
  const [annotationId, setAnnotationId] = useState(null);
  const linkedHighlight = useRef(new URLSearchParams(window.location.search));
  const appliedLink = useRef(false);
  const scrolledAnnotation = useRef('');
  const incoming = linkedHighlight.current;
  const initialStep = incoming.get('job') === id && incoming.get('chapter') === active.key ? incoming.get('step') : null;
  const { t } = useLocale();

  useEffect(() => {
    let ignore = false;
    api('jobs/' + id + '/highlights').then(items => {
      if (!ignore) setHighlights(items);
    }).catch(error => { if (!ignore) setHighlightError(error.message); });
    return () => { ignore = true; };
  }, [id]);

  useEffect(() => {
    const linkedJob = incoming.get('job');
    const linkedId = linkedJob === id ? incoming.get('highlight') : '';
    if (!linkedId || appliedLink.current) return;
    const item = highlights.find(entry => entry.id === linkedId);
    if (!item) return;
    appliedLink.current = true;
    if (item.section !== active.key) {
      setSelected(item.section);
      localStorage.setItem(storageKey, item.section);
    }
    setAnnotationId(item.id);
  }, [highlights, active.key, id, incoming, storageKey]);

  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root) return undefined;
    paintReadingHighlights(root, highlights.filter(item => item.section === active.key));
    const token = (annotationId || '') + ':' + active.key;
    if (!annotationId) scrolledAnnotation.current = '';
    else if (scrolledAnnotation.current !== token) {
      const mark = root.querySelector(`mark.reading-highlight[data-highlight-id="${CSS.escape(annotationId)}"]`);
      if (mark) {
        mark.scrollIntoView({ block: 'nearest' });
        scrolledAnnotation.current = token;
      }
    }
    return () => paintReadingHighlights(root, []);
  }, [highlights, active.key, active.markdown, annotationId]);

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
    setAnnotationId(current => {
      const item = highlights.find(entry => entry.id === current);
      return item && item.section === key ? current : null;
    });
  }

  function rememberHighlight(saved) {
    setHighlights(items => items.map(item => item.id === saved.id ? saved : item));
  }

  function openHighlight(item) {
    if (!item || item.section !== active.key) return;
    setToolbar(null);
    window.getSelection()?.removeAllRanges();
    setAnnotationId(item.id);
  }

  function openFromMark(event) {
    const mark = event.target instanceof Element ? event.target.closest('mark.reading-highlight') : null;
    if (!mark || !article.current?.contains(mark)) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (event.type === 'click') {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
    } else event.preventDefault();
    const item = highlights.find(entry => entry.id === mark.dataset.highlightId);
    openHighlight(item);
  }

  async function startAnnotation() {
    const anchor = toolbar?.anchor;
    if (!anchor || saving.current) return;
    const existing = highlights.find(item => item.section === active.key && item.start === anchor.start
      && item.end === anchor.end && item.quote === anchor.quote);
    if (existing) {
      openHighlight(existing);
      return;
    }
    saving.current = true;
    setHighlightError('');
    try {
      const saved = await api('jobs/' + id + '/highlights', {
        method: 'POST', json: { section: active.key, color: 'amber', ...anchor },
      });
      setHighlights(items => items.some(item => item.id === saved.id) ? items : [...items, saved]);
      openHighlight(saved);
    } catch (error) {
      setHighlightError(error.message || '阅读高亮没有保存。');
    } finally {
      saving.current = false;
    }
  }

  function turnPage(index) {
    select(sections[index].key);
    requestAnimationFrame(() => heading.current?.focus());
  }

  const annotation = highlights.find(item => item.id === annotationId && item.section === active.key) || null;
  return <Tabs.Root className={['reader', figures ? 'reader-inline' : '', annotation ? 'reader-with-annotation' : ''].filter(Boolean).join(' ')} value={active.key} onValueChange={select} orientation="vertical" activationMode="manual">
    {sections.length > 1 && <nav className="reader-index" aria-label={t('readerIndex')}>
      <h3>{t('readerIndex')}</h3>
      <Tabs.List className="chapter-tabs" aria-label={t('chooseChapter')}>
        {sections.map(item => <Tabs.Trigger key={item.key} value={item.key}>{item.title}</Tabs.Trigger>)}
      </Tabs.List>
    </nav>}
    <Tabs.Content key={active.key} value={active.key} className="reader-content" asChild>
      <article ref={article} onClick={openFromMark} onKeyDown={openFromMark}>
        <div className="chapter-header">
          <div><h2 ref={heading} tabIndex={-1}>{active.title}</h2><EffortInfo entry={active} localize/>
            {active.model && <p className="muted">模型 · {active.model}</p>}</div>
          <div className="actions">
            {onTool && <button onMouseDown={event => event.preventDefault()} onClick={() => openTool()}>{t('askHere')}</button>}
            {onAppend && <button disabled={busy} onClick={() => onAppend(active.key)}><BookmarkPlus size={15}/>{t('addToNote')}</button>}
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
          <button type="button" className="reading-highlight-write" onClick={startAnnotation}>写批注</button>
        </div>}
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
    {annotation && <HighlightAnnotation key={annotation.id} jobId={id} highlight={annotation} canAppend={canAppendNote}
      onChange={rememberHighlight} onClose={() => setAnnotationId(null)} onNote={onNote}/>}
  </Tabs.Root>;
}

const ChapterMarkdown = memo(function ChapterMarkdown({ children }) {
  return <Markdown chapter>{children}</Markdown>;
});

function Chapter({ item, figures, renderFigure, repo, onTool, initialStep, bodyRef }) {
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
    <div className="chapter-body" ref={bodyRef}>
      {readingFigureParts(before, keys).map((part, index) => part.key
        ? <React.Fragment key={part.key}>{part.key === item.repository?.key
          ? <RepositoryReading block={item.repository} repo={repo} onTool={onTool} initialStep={initialStep}/> : renderFigure(part.key)}</React.Fragment>
        : <ChapterMarkdown key={index}>{part.markdown}</ChapterMarkdown>)}
      {sample && softmax ? <Tabs.Root className="chapter-demo" defaultValue="formula">
        <Tabs.List className="demo-tabs" aria-label={t('demoTabs')}>
          <Tabs.Trigger value="formula">{t('formulaDemo')}</Tabs.Trigger>
          <Tabs.Trigger value="sample">{t('sampleTrace')}</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="formula"><Formula/></Tabs.Content>
        <Tabs.Content value="sample"><Sample steps={item.sample}/></Tabs.Content>
      </Tabs.Root> : sample ? <Sample steps={item.sample}/> : softmax ? <Formula/> : null}
      {after && readingFigureParts(after).map((part, index) => <ChapterMarkdown key={'after-' + index}>{part.markdown}</ChapterMarkdown>)}
    </div>
  </>;
}

function Formula() {
  const { t } = useLocale();
  return <Suspense fallback={<p className="visual-loading muted" role="status">{t('loadingFormula')}</p>}><Softmax/></Suspense>;
}
