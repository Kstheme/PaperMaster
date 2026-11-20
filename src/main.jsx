import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowDownToLine, ArrowUpRight, BookOpen, Braces, ChevronRight, FileText, KeyRound, Layers3, Plus, Sparkles } from 'lucide-react';
import { api, download, markdownBlob } from './api.js';
import { Markdown } from './markdown.jsx';
import { Reader } from './reader.jsx';
import { InteractiveReader } from './interaction-reader.jsx';
import './style.css';
import './interaction.css';

const empty = { papers: [], jobs: [], connections: [], providers: {}, modes: {} };
const active = status => ['queued', 'running'].includes(status);
const stateLabels = { queued: '等待运行', running: '正在生成', completed: '已完成', failed: '生成失败', cancelled: '已停止', interrupted: '上次中断' };
const readingLabels = { skim: '快速理解问题、方法和主要结论', deep: '完整阅读方法、公式、实验和局限',
  guided: '在阅读中逐步回答问题并获得反馈', repo: '把论文中的方法和实际代码对起来',
  compare: '围绕一个问题比较两篇或更多论文', question: '聚焦一个公式、图表或技术疑问' };

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
  return { library, ready, error, setError, reload };
}

function useAction(onError) {
  const [busy, setBusy] = useState(false);
  async function run(fn) {
    setBusy(true);
    onError('');
    try { return await fn(); }
    catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }
  return [run, busy];
}

function ImportPaper({ onPaper, onError, isMain }) {
  const [run, busy] = useAction(onError);
  return <section className="panel import">
    {isMain ? <h1>导入论文</h1> : <h2>导入论文</h2>}
    <label htmlFor="local-pdf">选择本地 PDF</label>
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
      <label htmlFor="arxiv">或粘贴 arXiv 链接</label>
      <div className="input-row"><input id="arxiv" name="arxiv" type="url" placeholder="https://arxiv.org/abs/…" required/>
        <button className="primary" disabled={busy}><Plus size={15}/>导入</button></div>
    </form>
    <p className="muted" role="status">{busy ? '正在提取论文正文…' : '支持可提取正文的 PDF。'}</p>
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
      {provider === 'codex' && <p className="muted">使用本机 Codex CLI。首次使用请安装 CLI 并运行 <code>codex login</code>。</p>}
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
  const [run, busy] = useAction(onError);
  return <form className="codex-model-editor" onSubmit={event => {
    event.preventDefault();
    run(async () => {
      const updated = await api(`connections/${connection.id}`, { method: 'PATCH', json: { model: model.trim() } });
      await onSaved(updated);
    });
  }}>
    <CodexModelField catalog={catalog} value={model} onChange={setModel}/>
    <button disabled={busy || model.trim() === (connection.model || '')}>保存模型</button>
  </form>;
}

function Connections({ library, onSaved, onUpdated, onError }) {
  const [run, busy] = useAction(onError);
  const [probe, setProbe] = useState('');
  const [catalog, setCatalog] = useState({ models: [], loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog({ models: [], loading: true });
    api('connections/codex/models', { signal: controller.signal })
      .then(({ models }) => {
        if (!controller.signal.aborted) setCatalog(models.length ? { models } : { models, error: 'Codex 没有返回可选模型。' });
      })
      .catch(error => {
        if (!controller.signal.aborted) setCatalog({ models: [], error: error.message });
      });
    return () => controller.abort();
  }, [revision]);
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
        </div>
        {connection.provider === 'codex' && <CodexModelEditor key={connection.model} connection={connection}
          catalog={catalog} onSaved={onUpdated} onError={onError}/>}
      </li>)}</ul>
      <p className="muted" role="status">{probe}</p>
    </section>
    </div>
  </>;
}

function ConnectionPicker({ library, value, onChange }) {
  return <label>使用连接<select value={value || ''} onChange={event => onChange(event.target.value)} required>
    <option value="" disabled>选择模型连接</option>
    {library.connections.map(item => <option key={item.id} value={item.id}>{item.label} · {item.model || '本机默认模型'}</option>)}
  </select></label>;
}

function StartReading({ paper, library, connection, setConnection, onJob, onChanged, onError }) {
  const [mode, setMode] = useState('');
  const [version, setVersion] = useState(paper.versionId);
  const [focus, setFocus] = useState('');
  const [others, setOthers] = useState([]);
  const [repo, setRepo] = useState('');
  const [interactive, setInteractive] = useState(true);
  const [sendImages, setSendImages] = useState(true);
  const [run, busy] = useAction(onError);
  const [repoRun, repoBusy] = useAction(onError);
  const selectedVersion = paper.versions.some(item => item.id === version) ? version : paper.versionId;
  const canUseInteractive = mode === 'deep' || mode === 'guided';
  return <>
    <section className="panel">
      <h2>选择阅读方式</h2>
      <div className="mode-grid">{Object.entries(library.modes).map(([key, label]) => <button key={key} aria-pressed={mode === key}
        onClick={() => { setMode(key); setFocus(''); }}>
        <strong>{label}</strong><span>{readingLabels[key]}</span>
      </button>)}</div>
      {mode && <form className="settings-form" onSubmit={event => {
        event.preventDefault();
        run(async () => {
          const papers = [{ id: paper.id, versionId: selectedVersion }];
          if (mode === 'compare') papers.push(...others.map(id => ({ id })));
          onJob(await api('jobs', { method: 'POST', json: { mode, papers, focus, repoId: repo, connectionId: connection,
            interactive: canUseInteractive && interactive, sendImages: canUseInteractive && interactive && sendImages } }));
        });
      }}>
        <div className="input-row">
          <ConnectionPicker library={library} value={connection} onChange={setConnection}/>
          <label>论文版本<select value={selectedVersion} onChange={event => setVersion(event.target.value)}>{paper.versions.map(item =>
            <option key={item.id} value={item.id}>{item.arxivVersion || item.name} · {item.pages} 页</option>)}</select></label>
        </div>
        {mode === 'compare' && <fieldset><legend>选择对照论文</legend>
          {library.papers.filter(item => item.id !== paper.id).map(item => <label className="check" key={item.id}>
            <input type="checkbox" checked={others.includes(item.id)} onChange={event => setOthers(current =>
              event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/>{item.title}</label>)}
          {library.papers.length < 2 && <p className="muted">请先导入第二篇论文。</p>}
        </fieldset>}
        {mode === 'repo' && <label>仓库快照<select value={repo || paper.repos.at(-1)?.id || ''} onChange={event => setRepo(event.target.value)} required>
          {!paper.repos.length && <option value="">请先关联公开仓库</option>}
          {paper.repos.map(item => <option key={item.id} value={item.id}>{item.url.split('/').at(-1)} · {item.commit.slice(0, 8)}</option>)}
        </select></label>}
        <label>{mode === 'question' ? '你的问题' : '阅读重点（可选）'}
          <textarea rows="2" value={focus} onChange={event => setFocus(event.target.value)} maxLength={4000} required={mode === 'question'}/>
        </label>
        {canUseInteractive && <div className="interactive-options">
          <label className="check"><input type="checkbox" checked={interactive} onChange={event => setInteractive(event.target.checked)}/>使用交互精读</label>
          {interactive && <ImagePreference checked={sendImages} onChange={setSendImages}/>}
        </div>}
        <div className="actions"><button className="primary" disabled={busy || !connection || (mode === 'compare' && others.length === 0)}>
          <Sparkles size={15}/>开始{library.modes[mode]}</button></div>
      </form>}
    </section>
    <details className="panel"><summary>关联公开 GitHub 仓库 {paper.repos.length ? `· ${paper.repos.length} 个快照` : ''}</summary>
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
        <label>仓库主页<input name="url" required type="url" placeholder="https://github.com/owner/repo"/></label>
        <label>分支、标签或提交（可选）<input name="ref" placeholder="默认分支"/></label>
        <div className="actions"><button disabled={repoBusy}><Braces size={15}/>{repoBusy ? '读取中…' : '读取静态快照'}</button></div>
      </form>
      {paper.repos.map(item => <p key={item.id} className="muted"><a href={item.url + '/tree/' + item.commit} target="_blank" rel="noreferrer">{item.url} · {item.commit.slice(0, 10)}</a></p>)}
    </details>
  </>;
}

function ImagePreference({ checked, onChange }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)}/>
    允许将少量核心图表裁片发送给所选模型。关闭后只向模型发送提取的文字与数据。</label>;
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

function RepositoryPanel({ paperId, repoId, onError }) {
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
  return <details className="panel">
    <summary><Braces size={14}/> 已读取的仓库摘录</summary>
    <p className="muted">提交 {content.repo.commit.slice(0, 12)} · 展示本次读到的文件片段</p>
    <label>文件<select value={filename} onChange={event => setFilename(event.target.value)}>
      {content.files.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
    </select></label>
    {file && <><a href={base + file.name.split('/').map(encodeURIComponent).join('/')} target="_blank" rel="noreferrer">查看 GitHub 文件</a>
      <pre className="file-code">{file.content}</pre></>}
  </details>;
}

function JobView({ job, paper, library, onJob, onError, onNote }) {
  const [resumeConnection, setResumeConnection] = useState(job.connectionId);
  const [statusMessage, setStatusMessage] = useState('');
  const [sendImages, setSendImages] = useState(true);
  const [run, busy] = useAction(onError);
  const canResume = ['failed', 'cancelled', 'interrupted'].includes(job.status);
  const path = `jobs/${job.id}`;
  const isLesson = job.mode === 'guided' && job.status === 'completed';
  const visible = showSections(job);
  const hasInteractive = Boolean(job.interaction);
  const canUpgrade = ['deep', 'guided'].includes(job.mode) && !hasInteractive && !active(job.status);
  function append(section) {
    run(async () => {
      await api(`papers/${paper.id}/append`, { method: 'POST', json: { jobId: job.id, section } });
      setStatusMessage('已加入主笔记');
      onNote();
    });
  }
  return <>
    <section className="run" aria-label="阅读任务">
      <div className="run-info">
        <h2>{library.modes[job.mode]}</h2>
        <span className="status" data-status={job.status}>{stateLabels[job.status]}</span>
        {job.status !== 'completed' && <p className="muted">{job.completedSteps} / {job.planned.length} 小节</p>}
      </div>
      {active(job.status) && <div className="run-progress" role="status">
        <p className="muted">{job.onlyComponent ? '正在重试组件' : job.planned[job.completedSteps]?.title && '正在准备 · ' + job.planned[job.completedSteps].title}</p>
        <progress value={job.completedSteps} max={job.planned.length} aria-label="生成进度"/>
      </div>}
      {job.error && <p className="error" role="alert">{job.error}</p>}
      <div className="actions">
        {active(job.status) && <button disabled={busy} onClick={() => run(async () => onJob(await api(path + '/stop', { method: 'POST' })))}>停止生成</button>}
        {canResume && <>
          <ConnectionPicker library={library} value={resumeConnection} onChange={setResumeConnection}/>
          <button className="primary" disabled={busy || !resumeConnection} onClick={() => run(async () =>
            onJob(await api(path + '/resume', { method: 'POST', json: { connectionId: resumeConnection } })))}>用所选连接续跑</button>
        </>}
        {job.status === 'completed' && <>
          {job.mode !== 'compare' && <button disabled={busy} onClick={() => append()}>加入主笔记</button>}
          <button disabled={busy} onClick={() => run(async () => {
            const { markdown } = await api(path + '/note');
            download(markdownBlob(markdown), job.mode === 'compare' ? '论文比较.md' : paper.title + ' · ' + library.modes[job.mode] + '.md');
          })}><ArrowDownToLine size={15}/>导出本次成果</button>
        </>}
        <span role="status" className="muted">{statusMessage}</span>
      </div>
    </section>
    {canUpgrade && <details className="panel upgrade-reading">
      <summary>生成交互版</summary>
      <p className="muted">使用同一论文版本创建一份新记录，原精读与主笔记会保留。</p>
      <ImagePreference checked={sendImages} onChange={setSendImages}/>
      <button className="primary" disabled={busy} onClick={() => run(async () => onJob(await api(path + '/interactive',
        { method: 'POST', json: { sendImages } })))}>开始生成交互版</button>
    </details>}
    {job.mode === 'repo' && job.repoId && <RepositoryPanel paperId={paper.id} repoId={job.repoId} onError={onError}/>}
    {isLesson && <a className="exercise-link" href="#guided-exercise">跳到引导练习</a>}
    {hasInteractive && <InteractiveReader job={job} busy={busy} onNote={onNote}
      onRetry={key => run(async () => onJob(await api(path + '/component/' + key, { method: 'POST' })))}/>}
    {visible.length > 0 && (hasInteractive ? <details className="reading-transcript">
      <summary>查看各章详细解释</summary>
      <Reader key={job.id} id={job.id} sections={visible} busy={busy}
        onAppend={job.status === 'completed' ? append : null}/>
    </details> : <Reader key={job.id} id={job.id} sections={visible} busy={busy}
      onAppend={job.status === 'completed' && job.mode !== 'compare' ? append : null}/>)}
    {isLesson && <Exercise key={job.id} job={job} library={library} onError={onError}/>}
  </>;
}

function Exercise({ job, library, onError }) {
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [answer, setAnswer] = useState('');
  const [connection, setConnection] = useState(job.connectionId);
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
          setAttempt(await api(root + '/answer', { method: 'POST', json: { questionId: state.question.id, connectionId: connection, answer } }));
        });
      }}>
        <label>你的推理<textarea rows="4" value={answer} onChange={event => setAnswer(event.target.value)} required maxLength={6000}/></label>
        <div className="actions">
          <ConnectionPicker library={library} value={connection} onChange={setConnection}/>
          <button className="primary" disabled={inFlight || busy || !answer.trim() || !connection}>提交</button>
          {inFlight ? <button type="button" onClick={() => run(async () => setAttempt(await api(`jobs/${attemptId}/stop`, { method: 'POST' })))}>停止反馈</button> :
            <button type="button" disabled={busy} onClick={() => run(async () => {
              setState(await api(root + '/skip', { method: 'POST', json: { questionId: state.question.id } }));
              setAttempt(null); setAnswer(''); setFeedback('');
            })}>暂缓此题</button>}
          {stopped && <button type="button" disabled={busy || !connection} onClick={() => run(async () =>
            setAttempt(await api(`jobs/${attemptId}/resume`, { method: 'POST', json: { connectionId: connection } })))}>续跑上次反馈</button>}
        </div>
      </form>
    </>}
  </section>;
}

function App() {
  const { library, ready, error, setError, reload } = useLibrary();
  const [selected, setSelected] = useState(localStorage.getItem('papermaster.paper') || '');
  const [current, setCurrent] = useState(null);
  const [tab, setTab] = useState('read');
  const [connection, setConnection] = useState('');
  const [noteSignal, setNoteSignal] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [run, busy] = useAction(setError);
  const paper = library.papers.find(item => item.id === selected);
  const hasActive = active(current?.status);
  const jobId = current?.id;
  const onJob = useCallback(job => {
    setCurrent(job);
    localStorage.setItem('papermaster.job', job.id);
    setTab('result');
    reload().catch(error => setError(error.message));
  }, [reload, setError]);
  useEffect(() => {
    if (!ready) return;
    const previous = localStorage.getItem('papermaster.job');
    const job = library.jobs.find(item => item.id === previous && item.references[0]?.id === selected);
    if (job) api('jobs/' + job.id).then(onJob).catch(error => setError(error.message));
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

  return <div className="workspace">
    <a className="skip-link" href="#paper-workspace">跳到阅读区</a>
    <header className="topbar">
      <div className="brand"><span><Layers3 size={20}/></span>PaperMaster</div>
      <div className="actions">
        <button aria-label={tab === 'connections' ? '返回阅读' : '模型连接'}
          title={tab === 'connections' ? '返回阅读' : '模型连接'}
          onClick={() => setTab(tab === 'connections' ? (current ? 'result' : 'read') : 'connections')}>
          <KeyRound size={16}/><span className="topbar-label">{tab === 'connections' ? '返回阅读' : '模型连接'}</span>
        </button>
        <button aria-label="备份" title="备份" disabled={busy}
          onClick={() => run(async () => download(await api('backup', { blob: true }), 'papermaster-backup.tar.gz'))}>
          <ArrowDownToLine size={16}/><span className="topbar-label">备份</span></button>
        <button className="primary" onClick={() => setShowImport(value => !value)}><Plus size={16}/>导入论文</button>
      </div>
    </header>
    <aside className="rail" aria-labelledby="library-label">
      <div className="rail-heading" id="library-label">本地论文库 <span>{library.papers.length}</span></div>
      <nav aria-label="论文库">{library.papers.map(item => <button key={item.id} aria-current={item.id === selected ? 'page' : undefined} onClick={() => select(item.id)}>
        <FileText size={15}/><span>{item.title}</span></button>)}</nav>
    </aside>
    <main id="paper-workspace" tabIndex={-1}>
      {error && <div className="error global" role="alert">{error}<button onClick={() => setError('')}>关闭</button></div>}
      {(showImport || (ready && !paper && tab !== 'connections')) && <ImportPaper isMain={!paper && tab !== 'connections'} onError={setError} onPaper={async result => {
        await reload(); select(result.id); setShowImport(false);
      }}/>}
      {!ready && <p role="status">正在加载论文库…</p>}
      {tab === 'connections' && <Connections library={library} onError={setError} onUpdated={reload}
        onSaved={async item => { await reload(); setConnection(item.id); }}/>}
      {paper && tab !== 'connections' && <>
        <header className="paper-header">
          <div className="eyebrow"><BookOpen size={14}/>{paper.arxivId ? 'arXiv ' + paper.arxivId : '本地论文'}</div>
          <h1>{paper.title}</h1>
          <p className="muted">{paper.authors}</p>
          <div className="actions">
            {paper.versions.at(-1)?.url && <a href={paper.versions.at(-1).url} target="_blank" rel="noreferrer">论文主页 <ArrowUpRight size={14}/></a>}
            <button onClick={() => run(async () => download(await api(`papers/${paper.id}/pdf`, { blob: true }), paper.title + '.pdf'))}>下载原件</button>
            <details className="renamer"><summary>修改标题</summary><form className="input-row" onSubmit={event => {
              event.preventDefault();
              const title = new FormData(event.currentTarget).get('title');
              run(async () => { await api(`papers/${paper.id}/title`, { method: 'PATCH', json: { title } }); await reload(); });
            }}><input name="title" aria-label="论文标题" defaultValue={paper.title} maxLength={255} required/><button>保存</button></form></details>
          </div>
        </header>
        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List className="tabs" aria-label="论文工作区">
            <Tabs.Trigger value="read">阅读</Tabs.Trigger><Tabs.Trigger value="result" disabled={!current}>当前任务</Tabs.Trigger>
            <Tabs.Trigger value="history">阅读记录</Tabs.Trigger><Tabs.Trigger value="note">主笔记</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="read"><StartReading key={paper.id} {...{ paper, library, connection, setConnection, onJob, onChanged: reload, onError: setError }}/></Tabs.Content>
          <Tabs.Content value="result">{current && <JobView key={current.id} job={current} {...{ paper, library, onJob, onError: setError, onNote: () => setNoteSignal(value => value + 1) }}/>}</Tabs.Content>
          <Tabs.Content value="history"><section className="panel">
            <h2>阅读记录</h2>
            {library.jobs.filter(item => item.references[0]?.id === paper.id).map(item => <button className="history" key={item.id}
              onClick={() => run(async () => onJob(await api('jobs/' + item.id)))}>
              <strong>{library.modes[item.mode]}{item.interactive && ' · 交互版'}</strong><span>{stateLabels[item.status]} · {new Date(item.updated).toLocaleString()}</span><ChevronRight size={16}/>
            </button>)}
            {!library.jobs.some(item => item.references[0]?.id === paper.id) && <p className="muted">该论文还没有阅读记录。</p>}
          </section></Tabs.Content>
          <Tabs.Content value="note"><Note key={paper.id} paper={paper} jobs={library.jobs} onError={setError} revisionSignal={noteSignal}/></Tabs.Content>
        </Tabs.Root>
      </>}
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
