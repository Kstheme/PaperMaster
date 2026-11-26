import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowDownToLine, ArrowUpRight, BookOpen, Braces, ChevronRight, FileText, KeyRound, Layers3, Plus, Search, Sparkles } from 'lucide-react';
import { api, download, markdownBlob } from './api.js';
import { Markdown } from './markdown.jsx';
import { Reader } from './reader.jsx';
import { ReadingFigure, ReadingSources } from './interaction-reader.jsx';
import { Followups } from './reading-tools.jsx';
import { MethodWorkspace } from './method-workspace.jsx';
import { ConnectionPicker, EffortField, paperMatches, useAction, useCodexCatalog, useConnectionChoice } from './workbench-fields.jsx';
import { MotionTabsList, positionHighlight } from './interface-motion.jsx';
import { FirstReading, firstReadingSkipped, rememberFirstReading } from './first-reading.jsx';
import { figureChapter, figureKeys } from '../server/reading-figures.js';
import { LocaleProvider, translate, useLocale } from './locale.jsx';
import './style.css';
import './interaction.css';
import './motion.css';

const empty = { papers: [], jobs: [], connections: [], providers: {}, modes: {} };
const active = status => ['queued', 'running'].includes(status);
const stateLabels = { queued: '等待运行', running: '正在生成', completed: '已完成', failed: '生成失败', cancelled: '已停止', interrupted: '上次中断' };
const upcomingModes = new Set(['guided', 'compare', 'question']);
const incoming = new URLSearchParams(location.search);

function useLibrary() {
  const [library, setLibrary] = useState(empty);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    const result = await api('library');
    setLibrary(result);
    setReady(true);
    return result;
  }, []);
  useEffect(() => { reload().catch(err => setError(err.message)); }, [reload]);
  const setLanguage = useCallback(language => setLibrary(current => ({ ...current, language })), []);
  return { library, ready, error, setError, reload, setLanguage };
}

function ImportPaper({ onPaper, onError, isMain }) {
  const [run, busy] = useAction(onError);
  const { t } = useLocale();
  return <section className="panel import">
    {isMain ? <h1>{t('importHeading')}</h1> : <h2>{t('importHeading')}</h2>}
    <label htmlFor="local-pdf">{t('choosePdf')}</label>
    <input id="local-pdf" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={event => {
      const file = event.target.files[0];
      if (!file) return;
      run(async () => {
        const paper = await api('papers?name=' + encodeURIComponent(file.name), {
          method: 'POST', body: file, headers: { 'Content-Type': 'application/pdf' },
        });
        await onPaper(paper);
      });
      event.target.value = '';
    }}/>
    <form onSubmit={event => {
      event.preventDefault();
      const arxiv = new FormData(event.currentTarget).get('arxiv');
      run(async () => onPaper(await api('papers', { method: 'POST', json: { arxiv } })));
    }}>
      <label htmlFor="arxiv">{t('orArxiv')}</label>
      <div className="input-row"><input id="arxiv" name="arxiv" type="url" placeholder="https://arxiv.org/abs/…" required/>
        <button className="primary" disabled={busy}><Plus size={15}/>{t('importAction')}</button></div>
    </form>
    <p className="muted" role="status">{busy ? t('extracting') : t('pdfHint')}</p>
  </section>;
}

function CodexModelField({ catalog, value, onChange }) {
  return <label>Codex 模型
    {catalog.error ? <input name="model" value={value} onChange={event => onChange(event.target.value)}
      maxLength={180} placeholder="留空时沿用本机 Codex 配置"/>
      : <select name="model" value={value} onChange={event => onChange(event.target.value)}>
        <option value="">沿用本机 Codex 配置</option>
        {catalog.models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        {value && !catalog.models.some(item => item.id === value) && <option value={value}>{value}（已配置）</option>}
      </select>}
    {catalog.loading && <span role="status">正在读取 Codex 模型…</span>}
  </label>;
}

function ProviderForm({ library, catalog, onSaved }) {
  const [provider, setProvider] = useState('codex');
  const [codexModel, setCodexModel] = useState('');
  const [effort, setEffort] = useState('default');
  const [feedback, setFeedback] = useState('');
  const [run, busy] = useAction(setFeedback);
  const [keyMode, setKeyMode] = useState('key');
  const definition = library.providers[provider];
  return <section className="panel">
    <h2>模型连接</h2>
    <form className="settings-form" onSubmit={event => {
      event.preventDefault();
      const form = event.currentTarget;
      const config = Object.fromEntries(new FormData(form));
      if (config.provider === 'codex') config.model = config.model.trim();
      run(async () => {
        const connection = await api('connections', { method: 'POST', json: config });
        form.reset();
        setCodexModel('');
        setEffort('default');
        await onSaved(connection);
        setFeedback('已添加模型连接。');
      });
    }}>
      <label>接入方式<select name="provider" value={provider} onChange={event => setProvider(event.target.value)}>
        {Object.entries(library.providers).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
      </select></label>
      <label>连接名称<input name="label" placeholder={definition?.label}/></label>
      {provider === 'codex' ? <CodexModelField catalog={catalog} value={codexModel} onChange={setCodexModel}/>
        : <label>模型名<input name="model" required placeholder="输入服务商提供的模型标识"/></label>}
      {provider === 'codex' && <>
        <EffortField connection={{ provider, model: codexModel }} catalog={catalog} value={effort} onChange={setEffort} label="默认思考强度"/>
        <p className="muted">使用本机 Codex CLI。首次使用请安装 CLI 并运行 <code>codex login</code>。</p>
      </>}
      {provider === 'compatible' && <label>Base URL<input name="base" type="url" required placeholder="https://服务商/v1"/></label>}
      {provider !== 'codex' && <>
        <label>凭证来源<select value={keyMode} onChange={event => setKeyMode(event.target.value)}>
          <option value="key">本机系统凭证</option><option value="env">环境变量</option>
        </select></label>
        {keyMode === 'key'
          ? <label>API Key<input type="password" autoComplete="off" name="key" required/></label>
          : <label>环境变量名<input key={provider} name="env" defaultValue={definition?.env} required/></label>}
      </>}
      <div className="actions"><button className="primary" disabled={busy || !definition}>添加连接</button></div>
    </form>
    {feedback && <p role="status" className="message">{feedback}</p>}
  </section>;
}

function CodexModelEditor({ connection, catalog, onSaved, onError }) {
  const [model, setModel] = useState(connection.model || '');
  const [effort, setEffort] = useState(connection.effort || 'default');
  const [run, busy] = useAction(onError);
  return <form className="codex-model-editor" onSubmit={event => {
    event.preventDefault();
    run(async () => {
      const updated = await api(`connections/${connection.id}`, { method: 'PATCH', json: { model: model.trim(), effort } });
      await onSaved(updated);
    });
  }}>
    <CodexModelField catalog={catalog} value={model} onChange={setModel}/>
    <EffortField connection={{ ...connection, model }} catalog={catalog} value={effort} onChange={setEffort} label="默认思考强度"/>
    <button disabled={busy || (model.trim() === (connection.model || '') && effort === (connection.effort || 'default'))}>保存模型设置</button>
  </form>;
}

function Connections({ library, onSaved, onUpdated, onError }) {
  const [run, busy] = useAction(onError);
  const [probe, setProbe] = useState('');
  const [revision, setRevision] = useState(0);
  const catalog = useCodexCatalog(true, revision);
  return <>
    {catalog.error && <div className="actions catalog-error" role="status">
      <p className="muted">{catalog.error} 可以手动填写 Codex 模型名。</p>
      <button onClick={() => setRevision(value => value + 1)}>重新获取列表</button>
    </div>}
    <div className="two-panels">
      <ProviderForm library={library} catalog={catalog} onSaved={onSaved}/>
    <section className="panel">
      <h2>已添加的连接</h2>
      {library.connections.length === 0 && <p className="muted">添加一个连接后即可生成阅读内容。</p>}
      {library.connections.length > 0 && !library.defaultConnection &&
        <p className="muted">当前没有默认连接。下次生成前，请从现存连接里选择。</p>}
      <ul className="connection-list">{library.connections.map(connection => <li key={connection.id}>
        <div><strong>{connection.label}</strong> <small>{connection.id === library.defaultConnection ? '默认' : ''}</small><p className="muted">{connection.model || '本机配置模型'}</p></div>
        <div className="actions">
          <button disabled={busy} onClick={() => run(async () => {
            setProbe('正在检查 ' + connection.label + '…');
            try {
              const report = await api(`connections/${connection.id}/check`, { method: 'POST' });
              const limit = report.limits?.primary;
              setProbe(connection.label + (report.mode === 'chatgpt' ? `：ChatGPT 已登录${limit?.usedPercent != null ? `，当前窗口已用 ${limit.usedPercent}%` : '，用量未知'}` : '：模型已响应 ' + report.model));
            } catch (error) { setProbe(''); throw error; }
          })}>检查</button>
          <button disabled={busy || connection.id === library.defaultConnection} onClick={() => run(async () => {
            await api('connections/default', { method: 'PUT', json: { connectionId: connection.id } });
            await onSaved(connection);
          })}>设为默认</button>
          <button disabled={busy} onClick={() => {
            if (!confirm(`删除连接「${connection.label}」？排队或正在运行的任务会继续，结束后才能删除。已有阅读和模型出处会保留。`)) return;
            run(async () => {
              const wasDefault = connection.id === library.defaultConnection;
              await api(`connections/${connection.id}`, { method: 'DELETE' });
              setProbe(wasDefault ? '已删除默认连接。下次生成前请重新选择一个现存连接。' : '已删除该连接。');
              await onUpdated();
            });
          }}>删除</button>
        </div>
        {connection.provider === 'codex' && <CodexModelEditor key={connection.model} connection={connection}
          catalog={catalog} onSaved={onUpdated} onError={onError}/>}
      </li>)}</ul>
      <p className="muted" role="status">{probe}</p>
    </section>
    </div>
  </>;
}

function StartReading({ paper, library, connection, setConnection, onJob, onChanged, onError }) {
  const [mode, setMode] = useState('');
  const [version, setVersion] = useState(paper.versionId);
  const [focus, setFocus] = useState('');
  const [others, setOthers] = useState([]);
  const [repo, setRepo] = useState(null);
  const [interactive, setInteractive] = useState(true);
  const [sendImages, setSendImages] = useState(true);
  const [effort, setEffort] = useState('connection');
  const chosenConnection = library.connections.find(item => item.id === connection);
  const catalog = useCodexCatalog(Boolean(mode && chosenConnection?.provider === 'codex'));
  const [run, busy] = useAction(onError);
  const [repoRun, repoBusy] = useAction(onError);
  const { t } = useLocale();
  const connectionLabels = { label: t('connection'), placeholder: t('chooseConnection'), localModel: t('localModel') };
  const selectedVersion = paper.versions.some(item => item.id === version) ? version : paper.versionId;
  const canUseInteractive = ['skim', 'deep', 'guided', 'repo'].includes(mode);
  const selectedRepo = repo ?? paper.repos.at(-1)?.id ?? '';
  const addRepo = mode === 'repo' && (!selectedRepo || selectedRepo === 'new');
  const usedRepo = selectedRepo === 'new' ? '' : selectedRepo;
  return <>
    <section className="panel reading-launch">
      <h2>{t('chooseMode')}</h2>
      <div className="mode-grid">{Object.entries(library.modes).map(([key]) => {
        const upcoming = upcomingModes.has(key);
        return <button key={key} type="button" disabled={upcoming} aria-pressed={upcoming ? undefined : mode === key}
          className={upcoming ? undefined : 'pointer-highlight'} onPointerMove={upcoming ? undefined : positionHighlight}
          onClick={() => { setMode(key); setFocus(''); }}>
          <strong>{t('mode.' + key)}{!upcoming && <ArrowUpRight size={16} aria-hidden="true"/>}</strong>
          <span>{upcoming ? t('comingSoon') : t('blurb.' + key)}</span>
        </button>;
      })}</div>
      {mode && <form className="settings-form" onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        run(async () => {
          const papers = [{ id: paper.id, versionId: selectedVersion }];
          if (mode === 'compare') papers.push(...others.map(id => ({ id })));
          let repoId = usedRepo;
          if (addRepo) {
            const result = await api('papers/' + paper.id + '/repo', { method: 'POST',
              json: { url: form.get('repoUrl'), ref: form.get('repoRef') } });
            repoId = result.id;
            setRepo(repoId);
            await onChanged();
          }
          onJob(await api('jobs', { method: 'POST', json: { mode, papers, focus, repoId, connectionId: connection, effort,
            interactive: canUseInteractive && interactive, sendImages: canUseInteractive && interactive && sendImages } }));
        });
      }}>
        <div className="input-row">
          <ConnectionPicker library={library} value={connection} onChange={setConnection} {...connectionLabels}/>
          <label>{t('paperVersion')}<select value={selectedVersion} onChange={event => setVersion(event.target.value)}>{paper.versions.map(item =>
            <option key={item.id} value={item.id}>{item.arxivVersion || item.name} · {t('pageCount', { count: item.pages })}</option>)}</select></label>
        </div>
        <EffortField connection={chosenConnection} catalog={catalog} value={effort} onChange={setEffort} inherit localize label={t('effort')}/>
        {mode === 'compare' && <fieldset><legend>{t('compareLegend')}</legend>
          {library.papers.filter(item => item.id !== paper.id).map(item => <label className="check" key={item.id}>
            <input type="checkbox" checked={others.includes(item.id)} onChange={event => setOthers(current =>
              event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/>{item.title}</label>)}
          {library.papers.length < 2 && <p className="muted">{t('needSecondPaper')}</p>}
        </fieldset>}
        {mode === 'repo' && <fieldset className="repo-start">
          <legend>{t('repoLegend')}</legend>
          <label>{t('repoSnapshot')}<select value={addRepo ? 'new' : usedRepo} onChange={event => setRepo(event.target.value)} disabled={busy}>
            {paper.repos.map(item => <option key={item.id} value={item.id}>{item.url.split('/').slice(-2).join('/')} · {item.commit.slice(0, 8)}</option>)}
            <option value="new">{t('linkNewRepo')}</option>
          </select></label>
          {addRepo && <div className="input-row">
            <label>{t('repoUrl')}<input name="repoUrl" type="url" placeholder="https://github.com/owner/repo" required disabled={busy}/></label>
            <label>{t('repoRef')}<input name="repoRef" maxLength={120} placeholder={t('defaultBranch')} disabled={busy}/></label>
          </div>}
          <p className="muted">{t('repoHint')}</p>
        </fieldset>}
        {canUseInteractive && mode !== 'repo' && paper.repos.length > 0 && <label>{t('referenceRepo')}<select value={usedRepo} onChange={event => setRepo(event.target.value)}>
          <option value="">{t('paperOnly')}</option>{paper.repos.map(item =>
            <option key={item.id} value={item.id}>{item.url.split('/').at(-1)} · {item.commit.slice(0, 8)}</option>)}</select></label>}
        <label>{mode === 'question' ? t('yourQuestion') : t('focusOptional')}
          <textarea rows="2" value={focus} onChange={event => setFocus(event.target.value)} maxLength={4000} required={mode === 'question'}/>
        </label>
        {canUseInteractive && <div className="interactive-options">
          <label className="check"><input type="checkbox" checked={interactive} onChange={event => setInteractive(event.target.checked)}/>{t('interactiveFigures')}</label>
          {interactive && <ImagePreference checked={sendImages} onChange={setSendImages}/>}
        </div>}
        <div className="actions"><button className="primary" disabled={busy || repoBusy || !connection || (mode === 'compare' && others.length === 0)}>
          <Sparkles size={15}/>{busy && mode === 'repo' ? t('preparingReading') : t('startMode', { mode: t('mode.' + mode) })}</button></div>
      </form>}
    </section>
    {mode !== 'repo' && <details className="panel"><summary>{t('linkPublicRepo')}{paper.repos.length ? t('snapshotCount', { count: paper.repos.length }) : ''}</summary>
      <form className="settings-form" onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = Object.fromEntries(new FormData(form));
        repoRun(async () => {
          const result = await api(`papers/${paper.id}/repo`, { method: 'POST', json: data });
          setRepo(result.id);
          form.reset();
          await onChanged();
        });
      }}>
        <label>{t('repoHome')}<input name="url" required type="url" placeholder="https://github.com/owner/repo"/></label>
        <label>{t('repoRef')}<input name="ref" placeholder={t('defaultBranch')}/></label>
        <div className="actions"><button disabled={repoBusy}><Braces size={15}/>{repoBusy ? t('readingSnapshotBusy') : t('readingSnapshot')}</button></div>
      </form>
      {paper.repos.map(item => <p key={item.id} className="muted"><a href={item.url + '/tree/' + item.commit} target="_blank" rel="noreferrer">{item.url} · {item.commit.slice(0, 10)}</a></p>)}
    </details>}
  </>;
}

function ImagePreference({ checked, onChange }) {
  const { t } = useLocale();
  return <label className="check"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}/>
    {t('allowImages')}</label>;
}

function Note({ paper, jobs, onError, revisionSignal }) {
  const [text, setText] = useState('');
  const [version, setVersion] = useState(null);
  const [saved, setSaved] = useState('');
  const [message, setMessage] = useState('');
  const [selection, setSelection] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [candidate, setCandidate] = useState('');
  const [run, busy] = useAction(onError);
  const path = `papers/${paper.id}/note`;
  const snippets = jobs.filter(job => job.status === 'completed' && job.mode !== 'compare' && job.references[0]?.id === paper.id)
    .flatMap(job => job.sections.map(section => ({ value: job.id + ':' + section.key, label: section.title })));
  const load = useCallback(async () => {
    const note = await api(path);
    setText(note.markdown); setSaved(note.markdown); setVersion(note.revision);
  }, [path]);
  useEffect(() => { load().catch(error => onError(error.message)); }, [load, onError, revisionSignal]);
  return <section className="panel">
    <h2>主笔记</h2>
    <label htmlFor="note-text" className="muted">Markdown</label>
    <textarea id="note-text" className="note-editor" rows="16" value={text} disabled={version === null}
      onSelect={event => {
        const { selectionStart: start, selectionEnd: end } = event.target;
        if (start < end) setSelection({ start, end, target: event.target.value.slice(start, end) });
      }}
      onChange={event => { setText(event.target.value); setMessage(''); setSelection(null); setProposal(null); }}/>
    <div className="actions">
      <button className="primary" disabled={busy || text === saved || !version} onClick={() => run(async () => {
        const note = await api(path, { method: 'PUT', json: { markdown: text, revision: version } });
        setVersion(note.revision); setSaved(note.markdown); setMessage('已保存');
      })}>保存笔记</button>
      <button onClick={() => download(markdownBlob(text), paper.title + '.md')}><ArrowDownToLine size={15}/>导出 Markdown</button>
      <button disabled={busy} onClick={() => {
        if (text === saved || confirm('重新载入会丢弃当前未保存的编辑。是否继续？')) run(load);
      }}>重新载入</button>
      <span className="muted" role="status">{message || (text !== saved && '有未保存编辑')}</span>
    </div>
    {saved && <details className="note-render"><summary>查看已保存笔记与出处</summary><Markdown>{saved}</Markdown></details>}
    {snippets.length > 0 && <details className="replace">
      <summary>用阅读成果替换选中的笔记片段</summary>
      <p className="muted">在编辑框中选中要替换的文字，再选择一段已生成的小节。</p>
      <div className="actions"><select aria-label="替换来源" value={candidate} onChange={event => { setCandidate(event.target.value); setProposal(null); }}>
        <option value="">选择已生成小节</option>{snippets.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      <button disabled={!selection || !candidate || busy} onClick={() => run(async () => {
        const [jobId, key] = candidate.split(':');
        const result = await api('jobs/' + jobId);
        const snippet = result.sections.find(section => section.key === key);
        if (snippet?.markdown) setProposal({ ...selection, replacement: snippet.markdown });
      })}>预览替换</button></div>
      {proposal && <div className="proposal">
        <h3>原片段</h3><pre>{proposal.target}</pre>
        <h3>拟替换为</h3><Markdown>{proposal.replacement}</Markdown>
        <button onClick={() => {
          if (text.slice(proposal.start, proposal.end) !== proposal.target) return onError('选中的原片段已修改，请重新选择。');
          setText(text.slice(0, proposal.start) + proposal.replacement + text.slice(proposal.end));
          setProposal(null); setSelection(null); setMessage('已应用到编辑框，保存后写入主笔记。');
        }}>应用到编辑框</button>
      </div>}
    </details>}
  </section>;
}

const showSections = job => job.sections.filter(item => item.key !== 'questions');

function RepositoryPanel({ paperId, repoId, onError, panelId, onAsk, section }) {
  const [content, setContent] = useState(null);
  const [filename, setFilename] = useState('');
  useEffect(() => {
    let ignore = false;
    api(`papers/${paperId}/repo/${repoId}`).then(result => {
      if (!ignore) { setContent(result); setFilename(result.files[0]?.name || ''); }
    }).catch(error => { if (!ignore) onError(error.message); });
    return () => { ignore = true; };
  }, [paperId, repoId, onError]);
  if (!content) return null;
  const file = content.files.find(item => item.name === filename);
  const base = content.repo.url + '/blob/' + content.repo.commit + '/';
  return <details className="panel" id={panelId}>
    <summary><Braces size={14}/> 仓库总览</summary>
    <p className="muted">提交 {content.repo.commit.slice(0, 12)} · 展示本次读到的文件片段</p>
    <p><a href={content.repo.url + '/tree/' + content.repo.commit} target="_blank" rel="noreferrer">打开固定提交的目录与入口</a></p>
    {content.repo.sourceIndex?.length > 0 && <p className="muted">源码目录 · {[...new Set(content.repo.sourceIndex.map(name => name.includes('/') ? name.split('/')[0] + '/' : name))].slice(0, 12).join(' · ')}</p>}
    <label>文件<select value={filename} onChange={event => setFilename(event.target.value)}>
      {content.files.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
    </select></label>
    {file && <><a href={base + file.name.split('/').map(encodeURIComponent).join('/')} target="_blank" rel="noreferrer">查看 GitHub 文件</a>
      <pre key={file.name} className="file-code" onMouseUp={event => {
        const selection = window.getSelection();
        if (selection && event.currentTarget.contains(selection.anchorNode) && event.currentTarget.contains(selection.focusNode)) {
          event.currentTarget.dataset.selected = selection.toString();
        }
      }}>{file.content}</pre>
      {onAsk && section && <button onClick={event => {
        const selected = event.currentTarget.previousElementSibling.dataset.selected;
        onAsk({ section: section.key, title: section.title, repoId, file: file.name,
          text: [file.name, selected || file.content.slice(0, 1600)].join('\n') });
      }}>追问此代码摘录</button>}</>}
  </details>;
}

function JobView({ job, paper, library, onJob, onError, onNote }) {
  const [resumeConnection, setResumeConnection] = useConnectionChoice(library, job.connectionId);
  const [resumeEffort, setResumeEffort] = useState(job.effort || 'connection');
  const [followupsOpen, setFollowupsOpen] = useState(incoming.get('job') === job.id && incoming.has('thread'));
  const [intent, setIntent] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [sendImages, setSendImages] = useState(true);
  const [run, busy] = useAction(onError);
  const canResume = ['failed', 'cancelled', 'interrupted'].includes(job.status);
  const path = `jobs/${job.id}`;
  const isLesson = job.mode === 'guided' && job.status === 'completed';
  const visible = showSections(job);
  const figures = job.interaction ? Object.groupBy(figureKeys(job), key => figureChapter(job.mode, key)) : undefined;
  const canUpgrade = !active(job.status) && (job.mode === 'repo' ? (!job.repoWalkthroughVersion || !job.interaction)
    : ['skim', 'deep', 'guided'].includes(job.mode) && !(job.formatVersion >= 4));
  const repo = paper.repos.find(item => item.id === job.repoId);
  const resumeModel = library.connections.find(item => item.id === resumeConnection);
  const catalog = useCodexCatalog(canResume && resumeModel?.provider === 'codex');
  const { t } = useLocale();
  const connectionLabels = { label: t('connection'), placeholder: t('chooseConnection'), localModel: t('localModel') };
  const overviewId = 'repo-overview-' + job.id;
  const defaultRepo = repo || paper.repos.at(-1);
  const repositoryPanel = defaultRepo && job.mode !== 'compare' &&
    <RepositoryPanel paperId={paper.id} repoId={defaultRepo.id} onError={onError}
      panelId={overviewId} onAsk={openFollowup} section={visible[0]}/>;

  function openFollowup(position) {
    setIntent({ position });
    setFollowupsOpen(true);
    requestAnimationFrame(() => document.getElementById('followups-' + job.id)?.scrollIntoView({ block: 'start' }));
  }
  function append(section) {
    run(async () => {
      await api(`papers/${paper.id}/append`, { method: 'POST', json: { jobId: job.id, section } });
      setStatusMessage(t('addedToNote'));
      onNote();
    });
  }
  return <>
    <section className="run" aria-label={t('readingTask')}>
      <div className="run-info">
        <h2>{t('mode.' + job.mode)}</h2>
        <span className="status" data-status={job.status}>{t('status.' + job.status)}</span>
        {job.status !== 'completed' && <p className="muted">{t('sectionProgress', { done: job.completedSteps, total: job.planned.length })}</p>}
      </div>
      {active(job.status) && <div className="run-progress" role="status">
        <p className="muted">{job.onlyComponent ? t('retryingComponent') : job.planned[job.completedSteps]?.title && t('preparingSection', { title: job.planned[job.completedSteps].title })}</p>
        <progress value={job.completedSteps} max={job.planned.length} aria-label={t('generationProgress')}/>
      </div>}
      {job.error && <p className="error" role="alert">{job.error}</p>}
      <div className="actions">
        {active(job.status) && <button disabled={busy} onClick={() => run(async () => onJob(await api(path + '/stop', { method: 'POST' })))}>{t('stopGeneration')}</button>}
        {canResume && <>
          <ConnectionPicker library={library} value={resumeConnection} onChange={setResumeConnection} {...connectionLabels}/>
          <EffortField connection={resumeModel} catalog={catalog} value={resumeEffort} onChange={setResumeEffort} inherit localize label={t('effort')}/>
          <button className="primary" disabled={busy || !resumeConnection} onClick={() => run(async () =>
            onJob(await api(path + '/resume', { method: 'POST', json: { connectionId: resumeConnection, effort: resumeEffort } })))}>{t('resumeWithConnection')}</button>
        </>}
        {job.status === 'completed' && <>
          {job.mode !== 'compare' && <button disabled={busy} onClick={() => append()}>{t('addToMainNote')}</button>}
          <button disabled={busy} onClick={() => run(async () => {
            const { markdown } = await api(path + '/note');
            download(markdownBlob(markdown), job.mode === 'compare' ? t('comparisonFile') : paper.title + ' · ' + t('mode.' + job.mode) + '.md');
          })}><ArrowDownToLine size={15}/>{t('exportResult')}</button>
        </>}
        <span role="status" className="muted">{statusMessage}</span>
      </div>
    </section>
    {canUpgrade && <details className="panel upgrade-reading">
      <summary>{job.mode === 'repo' ? t('upgradeRepo') : t('upgradeInteractive')}</summary>
      <p className="muted">{t('upgradeHint')}</p>
      <ImagePreference checked={sendImages} onChange={setSendImages}/>
      <button className="primary" disabled={busy} onClick={() => run(async () => onJob(await api(path + '/interactive',
        { method: 'POST', json: { sendImages } })))}>{t('startGenerating')}</button>
    </details>}
    {!job.integratedRepo && repositoryPanel}
    {isLesson && <a className="exercise-link" href="#guided-exercise">{t('jumpExercise')}</a>}
    {visible.length > 0 && <Reader key={job.id} id={job.id} sections={visible} busy={busy} repo={repo}
      onTool={job.mode !== 'compare' ? openFollowup : undefined}
      figures={figures} renderFigure={(name, onTool) => <ReadingFigure name={name} job={job} repo={repo} busy={busy} onNote={onNote} onTool={onTool}
        onRetry={key => run(async () => onJob(await api(path + '/component/' + key, { method: 'POST' })))}/>}
      onNote={onNote} canAppendNote={job.status === 'completed' && job.mode !== 'compare'}
      onAppend={job.status === 'completed' && job.mode !== 'compare' ? append : null}/>}
    {job.integratedRepo && repositoryPanel}
    {followupsOpen && <Followups job={job} library={library} intent={intent}
      initialThread={incoming.get('job') === job.id ? incoming.get('thread') : undefined} onNote={onNote} onError={onError}/>}
    <ReadingSources job={job}/>
    {isLesson && <Exercise key={job.id} job={job} library={library} onError={onError}/>}
  </>;
}

function Exercise({ job, library, onError }) {
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [answer, setAnswer] = useState('');
  const [connection, setConnection] = useConnectionChoice(library, job.connectionId);
  const [effort, setEffort] = useState('connection');
  const model = library.connections.find(item => item.id === connection);
  const catalog = useCodexCatalog(model?.provider === 'codex');
  const [run, busy] = useAction(onError);
  const root = `jobs/${job.id}`;
  const reload = useCallback(async () => {
    const next = await api(root + '/exercise');
    setState(next);
    const pending = next.attempts.find(item => active(item.status) || ['interrupted', 'cancelled', 'failed'].includes(item.status));
    if (pending && pending.id === next.attempts[0]?.id) setAttempt(await api('jobs/' + pending.id));
    else if (next.attempts[0]?.feedback) { setFeedback(next.attempts[0].feedback); setAnswer(next.attempts[0].answer); }
  }, [root]);
  useEffect(() => { reload().catch(error => onError(error.message)); }, [reload, onError]);
  const attemptId = attempt?.id;
  const inFlight = active(attempt?.status);
  useEffect(() => {
    if (!attemptId || !inFlight) return;
    let ignore = false;
    let timer;
    const poll = async () => {
      try {
        const result = await api('jobs/' + attemptId);
        if (ignore) return;
        if (result.status === 'completed') {
          await reload();
          if (!ignore) { setFeedback(result.sections[0].markdown); setAnswer(result.sections[0].passed ? '' : result.answer); }
        }
        if (ignore) return;
        setAttempt(result);
        if (active(result.status)) timer = setTimeout(poll, 850);
      } catch (error) { if (!ignore) onError(error.message); }
    };
    timer = setTimeout(poll, 500);
    return () => { ignore = true; clearTimeout(timer); };
  }, [attemptId, inFlight, reload, onError]);
  if (!state) return <p className="muted" role="status">正在恢复题目…</p>;
  const stopped = attempt && ['failed', 'interrupted', 'cancelled'].includes(attempt.status);
  return <section className="panel exercise" id="guided-exercise">
    <div className="row-between"><h2>引导练习</h2><span className="muted">已验证 {state.passed} / {state.total} · 暂缓 {state.skipped}</span></div>
    {feedback && <div className="feedback"><strong>上一条反馈</strong><Markdown>{feedback}</Markdown></div>}
    {!state.question && <p>本轮练习已结束。</p>}
    {state.question && <>
      <p className="muted">{state.question.objective}</p>
      <Markdown>{state.question.prompt}</Markdown>
      {inFlight && <p className="muted" role="status">正在整理答题反馈…</p>}
      {stopped && <p className="error" role="alert">{attempt.error || stateLabels[attempt.status]}</p>}
      <form onSubmit={event => {
        event.preventDefault();
        run(async () => {
          setAttempt(await api(root + '/answer', { method: 'POST', json: { questionId: state.question.id, connectionId: connection, answer, effort } }));
        });
      }}>
        <label>你的推理<textarea rows="4" value={answer} onChange={event => setAnswer(event.target.value)} required maxLength={6000}/></label>
        <div className="actions">
          <ConnectionPicker library={library} value={connection} onChange={setConnection}/>
          <EffortField connection={model} catalog={catalog} value={effort} onChange={setEffort} inherit/>
          <button className="primary" disabled={inFlight || busy || !answer.trim() || !connection}>提交</button>
          {inFlight ? <button type="button" onClick={() => run(async () => setAttempt(await api(`jobs/${attemptId}/stop`, { method: 'POST' })))}>停止反馈</button> :
            <button type="button" disabled={busy} onClick={() => run(async () => {
              setState(await api(root + '/skip', { method: 'POST', json: { questionId: state.question.id } }));
              setAttempt(null); setAnswer(''); setFeedback('');
            })}>暂缓此题</button>}
          {stopped && <button type="button" disabled={busy || !connection} onClick={() => run(async () =>
            setAttempt(await api(`jobs/${attemptId}/resume`, { method: 'POST', json: { connectionId: connection, effort } })))}>续跑上次反馈</button>}
        </div>
      </form>
    </>}
  </section>;
}

function App() {
  const { library, ready, error, setError, reload, setLanguage } = useLibrary();
  const interfaceLanguage = library.language?.interface === 'en' ? 'en' : 'zh';
  const t = (key, vars) => translate(interfaceLanguage, key, vars);
  useEffect(() => { document.documentElement.lang = interfaceLanguage === 'en' ? 'en' : 'zh-CN'; }, [interfaceLanguage]);
  const [selected, setSelected] = useState(incoming.get('paper') || localStorage.getItem('papermaster.paper') || '');
  const [current, setCurrent] = useState(null);
  const [tab, setTab] = useState('read');
  const [query, setQuery] = useState('');
  const [connection, setConnection] = useState('');
  const [noteSignal, setNoteSignal] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [guide, setGuide] = useState('pending');
  const [guideStep, setGuideStep] = useState(0);
  const [run, busy] = useAction(setError);
  const guideCatalog = useCodexCatalog(guide === 'open');
  const paper = library.papers.find(item => item.id === selected);
  const foundPapers = library.papers.filter(item => paperMatches(item, query));
  const requestedPdf = incoming.get('paper') === selected && paper?.versions.find(item => item.id === incoming.get('pdf'));
  const visibleVersion = requestedPdf || (tab === 'result' && paper?.versions.find(item => item.id === current?.references[0]?.versionId))
    || paper?.versions.find(item => item.id === paper.versionId);
  const hasActive = active(current?.status);
  const jobId = current?.id;
  const onJob = useCallback(job => {
    setCurrent(job);
    localStorage.setItem('papermaster.job', job.id);
    setTab('result');
    reload().catch(error => setError(error.message));
  }, [reload, setError]);
  useEffect(() => {
    if (!ready || guide !== 'pending') return;
    const existing = library.papers.length > 0 || library.jobs.length > 0;
    setGuide(existing || firstReadingSkipped() ? 'workbench' : 'open');
  }, [ready, guide, library.papers.length, library.jobs.length]);
  useEffect(() => {
    if (!ready) return;
    const previous = incoming.get('job') || (!incoming.has('pdf') && localStorage.getItem('papermaster.job'));
    const job = library.jobs.find(item => item.id === previous && item.references[0]?.id === selected);
    if (job) {
      if (incoming.get('job') === job.id && incoming.get('chapter')) localStorage.setItem('papermaster.chapter.' + job.id, incoming.get('chapter'));
      api('jobs/' + job.id).then(onJob).catch(error => setError(error.message));
    }
    else if (!paper && library.papers.length) setSelected(library.papers[0].id);
  }, [ready]);
  useEffect(() => {
    if (ready) setConnection(value => library.connections.some(item => item.id === value) ? value : library.defaultConnection || '');
  }, [ready, library.defaultConnection, library.connections]);
  useEffect(() => {
    if (!jobId || !hasActive) return;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const job = await api('jobs/' + jobId);
        if (cancelled) return;
        setCurrent(job);
        if (active(job.status)) timer = setTimeout(poll, 800);
        else await reload();
      } catch (error) {
        if (!cancelled) { setError(error.message); timer = setTimeout(poll, 2000); }
      }
    };
    timer = setTimeout(poll, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, hasActive, reload, setError]);

  function select(id) {
    setSelected(id); setCurrent(null); setTab('read');
    localStorage.setItem('papermaster.paper', id);
    localStorage.removeItem('papermaster.job');
  }

  function skipGuide(nextTab) {
    rememberFirstReading();
    setGuide('workbench');
    if (typeof nextTab === 'string') setTab(nextTab);
  }

  function finishGuide(job) {
    setGuide('workbench');
    onJob(job);
  }

  return <LocaleProvider language={interfaceLanguage}><div className="workspace">
    <a className="skip-link" href="#paper-workspace">{t('skipToReading')}</a>
    <header className="topbar">
      <div className="brand"><span><BookOpen size={19} aria-hidden="true"/></span>PaperMaster</div>
      <nav className="actions topbar-actions" aria-label={t('workspaceTools')}>
        <LanguageSettings language={library.language} busy={busy} onError={setError} onChange={async patch => {
          setLanguage(await api('settings/language', { method: 'PUT', json: patch }));
        }}/>
        <button aria-pressed={guide !== 'open' && tab === 'methods'} onClick={() => guide === 'open' ? skipGuide('methods') : setTab(tab === 'methods' ? (current ? 'result' : 'read') : 'methods')}>
          <Layers3 size={16}/>{t('methodTables')}</button>
        <button aria-pressed={guide === 'open' ? guideStep === 1 : tab === 'connections'} aria-label={guide !== 'open' && tab === 'connections' ? t('backToReading') : t('modelConnection')}
          title={guide !== 'open' && tab === 'connections' ? t('backToReading') : t('modelConnection')}
          onClick={() => guide === 'open' ? setGuideStep(1) : setTab(tab === 'connections' ? (current ? 'result' : 'read') : 'connections')}>
          <KeyRound size={16}/><span className="topbar-label">{guide !== 'open' && tab === 'connections' ? t('backToReading') : t('modelConnection')}</span>
        </button>
        <button aria-label={t('backup')} title={t('backup')} disabled={busy}
          onClick={() => run(async () => download(await api('backup', { blob: true }), 'papermaster-backup.tar.gz'))}>
          <ArrowDownToLine size={16}/><span className="topbar-label">{t('backup')}</span></button>
        <button className="primary" aria-expanded={guide === 'open' ? guideStep === 0 : showImport || (ready && !paper && !['connections', 'methods'].includes(tab))}
          onClick={() => guide === 'open' ? setGuideStep(0) : setShowImport(value => !value)}><Plus size={16}/>{t('importPaper')}</button>
      </nav>
    </header>
    <aside className="rail" aria-labelledby="library-label">
      <div className="rail-content">
        <div className="rail-heading" id="library-label">{t('library')} <span>{library.papers.length}</span></div>
        <div className="library-search-field"><Search size={16} aria-hidden="true"/>
          <input className="library-search" aria-label={t('searchLibrary')} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('searchPlaceholder')}/>
        </div>
        <nav aria-label={t('paperLibraryNav')}>{foundPapers.map(item => <button key={item.id} aria-current={item.id === selected ? 'page' : undefined} onClick={() => select(item.id)}>
          <FileText size={15}/><span>{item.title}</span></button>)}</nav>
        {query.trim() && !foundPapers.length && <p className="rail-empty muted">{t('noMatch')}</p>}
      </div>
    </aside>
    <main id="paper-workspace" tabIndex={-1}>
      {error && <div className="error global" role="alert">{error}<button onClick={() => setError('')}>{t('close')}</button></div>}
      {guide === 'pending' && <p role="status">{t('loadingLibrary')}</p>}
      {guide === 'open' && <FirstReading step={guideStep} onStep={setGuideStep} paper={paper} connections={library.connections}
        onSkip={skipGuide}
        importPanel={<ImportPaper isMain={false} onError={setError} onPaper={async result => { await reload(); select(result.id); }}/>}
        connectPanel={<ProviderForm library={library} catalog={guideCatalog} onSaved={async item => { await reload(); setConnection(item.id); }}/>}
        readingPanel={<StartReading key={paper?.id} {...{ paper, library, connection, setConnection, onJob: finishGuide, onChanged: reload, onError: setError }}/>}/>}
      {guide === 'workbench' && <>
      {(showImport || (!paper && !['connections', 'methods'].includes(tab))) && <ImportPaper isMain={!paper && tab !== 'connections'} onError={setError} onPaper={async result => {
        await reload(); select(result.id); setShowImport(false);
      }}/>}
      {tab === 'connections' && <Connections library={library} onError={setError} onUpdated={reload}
        onSaved={async item => { await reload(); setConnection(item.id); }}/>}
      {tab === 'methods' && <MethodWorkspace library={library} defaultConnection={connection} onError={setError}/>}
      {paper && !['connections', 'methods'].includes(tab) && <>
        <header className="paper-header" data-compact={tab !== 'read'}>
          <div className="paper-heading">
            <div className="eyebrow"><BookOpen size={14} aria-hidden="true"/>{paper.arxivId ? 'arXiv ' + paper.arxivId : t('localPaper')}</div>
            <h1>{paper.title}</h1>
            {paper.authors && <p className="paper-authors">{paper.authors}</p>}
          </div>
          <PaperFacts paper={paper} version={visibleVersion}/>
          <div className="actions paper-actions">
            {visibleVersion?.url && <a href={visibleVersion.url} target="_blank" rel="noreferrer">{t('paperHome')} <ArrowUpRight size={14}/></a>}
            {visibleVersion && <button onClick={() => run(async () => download(await api(`papers/${paper.id}/pdf/${visibleVersion.id}`, { blob: true }), paper.title + '.pdf'))}>
              {t('downloadOriginal')}</button>}
            <details className="renamer"><summary>{t('editTitle')}</summary><form className="input-row" onSubmit={event => {
              event.preventDefault();
              const title = new FormData(event.currentTarget).get('title');
              run(async () => { await api(`papers/${paper.id}/title`, { method: 'PATCH', json: { title } }); await reload(); });
            }}><input name="title" aria-label={t('paperTitle')} defaultValue={paper.title} maxLength={255} required/><button>{t('save')}</button></form></details>
          </div>
        </header>
        {requestedPdf && <PinnedPdf paper={paper} version={requestedPdf} page={incoming.get('page')} onError={setError}/>}
        <Tabs.Root className="paper-workspace-tabs" value={tab} onValueChange={setTab}>
          <MotionTabsList className="tabs" value={tab} aria-label={t('paperWorkspace')}>
            <Tabs.Trigger value="read">{t('tabRead')}</Tabs.Trigger><Tabs.Trigger value="result" disabled={!current}>{t('tabResult')}</Tabs.Trigger>
            <Tabs.Trigger value="history">{t('tabHistory')}</Tabs.Trigger><Tabs.Trigger value="note">{t('tabNote')}</Tabs.Trigger>
          </MotionTabsList>
          <Tabs.Content value="read"><StartReading key={paper.id} {...{ paper, library, connection, setConnection, onJob, onChanged: reload, onError: setError }}/></Tabs.Content>
          <Tabs.Content value="result">{current && <JobView key={current.id} job={current} {...{ paper, library, onJob, onError: setError, onNote: () => setNoteSignal(value => value + 1) }}/>}</Tabs.Content>
          <Tabs.Content value="history"><section className="panel">
            <h2>{t('historyHeading')}</h2>
            {library.jobs.filter(item => item.references[0]?.id === paper.id).map(item => <button className="history" key={item.id}
              onClick={() => run(async () => onJob(await api('jobs/' + item.id)))}>
              <strong>{t('mode.' + item.mode)}{item.interactive && t('interactiveMark')}</strong><span>{t('status.' + item.status)} · {new Date(item.updated).toLocaleString()}</span><ChevronRight size={16}/>
            </button>)}
            {!library.jobs.some(item => item.references[0]?.id === paper.id) && <p className="muted">{t('historyEmpty')}</p>}
          </section></Tabs.Content>
          <Tabs.Content value="note"><Note key={paper.id} paper={paper} jobs={library.jobs} onError={setError} revisionSignal={noteSignal}/></Tabs.Content>
        </Tabs.Root>
      </>}
      </>}
    </main>
  </div></LocaleProvider>;
}

function PaperFacts({ paper, version }) {
  const { t } = useLocale();
  if (!version) return null;
  return <dl className="paper-facts" aria-label={t('paperFacts')}>
    <div><dt>{t('version')}</dt><dd title={version.arxivVersion || version.name}>{version.arxivVersion || version.name}</dd></div>
    <div><dt>{t('pages')}</dt><dd>{version.pages}</dd></div>
    <div><dt>{t('repoSnapshots')}</dt><dd>{paper.repos.length}</dd></div>
  </dl>;
}

function PinnedPdf({ paper, version, page, onError }) {
  const { t } = useLocale();
  const [href, setHref] = useState('');
  useEffect(() => {
    let source;
    const controller = new AbortController();
    api('papers/' + paper.id + '/pdf/' + version.id, { blob: true, signal: controller.signal }).then(blob => {
      if (controller.signal.aborted) return;
      source = URL.createObjectURL(blob);
      setHref(source + (/^[1-9]\d*$/.test(page || '') ? '#page=' + page : ''));
    }).catch(error => { if (!controller.signal.aborted) onError(error.message); });
    return () => {
      controller.abort();
      if (source) URL.revokeObjectURL(source);
    };
  }, [paper.id, version.id, page, onError]);
  return <section className="panel">
    <h2>{t('originalEvidence')}</h2>
    <p>{version.arxivVersion || version.name}{page && t('pageSuffix', { page })}</p>
    {href ? <a href={href} target="_blank" rel="noreferrer">{t('openPdf')}</a> : <p role="status">{t('loadingPdf')}</p>}
  </section>;
}

function LanguageSettings({ language, busy, onChange, onError }) {
  const { t } = useLocale();
  const [run, saving] = useAction(onError);
  const current = language || { interface: 'zh', generation: null };
  return <fieldset className="language-settings">
    <legend>{t('languageSettings')}</legend>
    <label>{t('interfaceLanguage')}
      <select aria-label={t('interfaceLanguage')} value={current.interface} disabled={busy || saving}
        onChange={event => run(() => onChange({ interface: event.target.value }))}>
        <option value="zh">中文</option>
        <option value="en">English</option>
      </select>
    </label>
    <label>{t('generationLanguage')}
      <select aria-label={t('generationLanguage')} value={current.generation || ''} disabled={busy || saving}
        onChange={event => run(() => onChange({ generation: event.target.value || null }))}>
        <option value="">{t('followInterface')}</option>
        <option value="zh">中文</option>
        <option value="en">English</option>
      </select>
    </label>
  </fieldset>;
}

createRoot(document.getElementById('root')).render(<App/>);
