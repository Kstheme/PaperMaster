import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Markdown } from './markdown.jsx';
import { ConnectionPicker, EffortField, EffortInfo, EvidenceLinks, useAction, useCodexCatalog } from './workbench-fields.jsx';

export function Followups({ job, library, intent, initialThread, onNote, onError }) {
  const [threads, setThreads] = useState([]);
  const [threadId, selectThread] = useState(initialThread || '');
  const [question, setQuestion] = useState('');
  const [connection, setConnection] = useState(job.connectionId);
  const [effort, setEffort] = useState('connection');
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState('');
  const [run, busy] = useAction(onError);
  const pending = useRef(null);
  const panel = useRef(null);
  const chosen = library.connections.find(item => item.id === connection);
  const catalog = useCodexCatalog(chosen?.provider === 'codex');
  const path = 'jobs/' + job.id;
  const thread = threads.find(item => item.id === threadId);
  const position = intent?.position || thread?.turns.at(-1)?.position;
  useEffect(() => {
    let ignore = false;
    api(path + '/followups').then(items => {
      if (ignore) return;
      setThreads(items);
      selectThread(current => items.some(item => item.id === current) ? current : '');
    })
      .catch(error => { if (!ignore) onError(error.message); });
    return () => { ignore = true; };
  }, [path, onError]);
  useEffect(() => { if (intent && panel.current) panel.current.open = true; }, [intent]);

  function ask(event) {
    event.preventDefault();
    const text = question.trim();
    if (!text || (!position && !thread)) return;
    if (pending.current?.question !== text || pending.current.selected !== threadId) {
      pending.current = { question: text, selected: threadId, threadId: threadId || crypto.randomUUID(), turnId: crypto.randomUUID() };
    }
    const { selected, ...request } = pending.current;
    run(async () => {
      const next = await api(path + '/followups', { method: 'POST', json: { ...request, position, connectionId: connection, effort } });
      setThreads(current => [next, ...current.filter(item => item.id !== next.id)]);
      selectThread(next.id);
      setQuestion('');
      setEffort('connection');
      pending.current = null;
    });
  }

  function startDraft(turn, container, chosenThread) {
    const selection = window.getSelection();
    const text = selection && container.contains(selection.anchorNode) && container.contains(selection.focusNode) ? selection.toString().trim() : '';
    setDraft({ thread: chosenThread.id, turn: turn.id, text: (text || turn.answer).slice(0, 12000), observation: '', kind: 'observation',
      evidence: turn.evidence.map((_, index) => index), sources: turn.evidence, position: turn.position, saveId: crypto.randomUUID() });
    setMessage('');
  }

  function deleteThread() {
    if (!thread || !confirm('删除这段追问对话？已保存到主笔记的摘录会保留。')) return;
    run(async () => {
      await api(path + '/followups/' + thread.id, { method: 'DELETE' });
      setThreads(current => current.filter(item => item.id !== thread.id));
      selectThread('');
      setQuestion('');
      setDraft(null);
      pending.current = null;
      setMessage('已删除这段追问。');
    });
  }

  return <details className="panel workspace-tool" id={'followups-' + job.id} ref={panel} open>
    <summary>阅读追问</summary>
    <div className="actions followup-actions">
      <button type="button" onClick={() => { selectThread(''); setQuestion(''); setDraft(null); setMessage(''); }} disabled={busy}>新开问题</button>
      {thread && <button type="button" onClick={deleteThread} disabled={busy}>删除此追问</button>}
      <button type="button" onClick={() => { panel.current.open = false; panel.current.querySelector('summary').focus(); }}>折叠追问</button>
    </div>
    {threads.length > 0 && <label>追问记录<select value={threadId} onChange={event => { selectThread(event.target.value); setDraft(null); }} disabled={busy}>
      <option value="">新问题</option>
      {threads.map(item => <option key={item.id} value={item.id}>{item.origin.title} · {item.turns[0].question.slice(0, 50)}</option>)}
    </select></label>}
    {thread?.turns.map(turn => <Turn key={turn.id} turn={turn} onDraft={container => startDraft(turn, container, thread)}/>)}
    {position && <div className="reading-context"><small>当前提问位置 · {position.title}</small>
      {position.text && <blockquote>{position.text}</blockquote>}</div>}
    <form className="settings-form" onSubmit={ask}>
      <label>追问<textarea rows={3} value={question} onChange={event => setQuestion(event.target.value)} required maxLength={4000}
        placeholder="这个公式的假设是什么？"/></label>
      <div className="input-row"><ConnectionPicker library={library} value={connection} onChange={setConnection}/>
        <EffortField connection={chosen} catalog={catalog} value={effort} onChange={setEffort} inherit/></div>
      <div className="actions"><button className="primary" disabled={busy || !connection || (!position && !thread)}>
        {busy ? '正在生成或保存…' : '发送追问'}</button></div>
    </form>
    {draft && <form className="settings-form note-preview" onSubmit={event => {
      event.preventDefault();
      run(async () => {
        await api(path + '/followup-note/' + draft.thread, { method: 'POST',
          json: { turnId: draft.turn, text: draft.text, observation: draft.observation, kind: draft.kind, evidence: draft.evidence, saveId: draft.saveId } });
        setDraft(null);
        setMessage('已加入主笔记');
        onNote();
      });
    }}>
      <h3>保存到主笔记</h3>
      <p className="muted">提问位置 · {draft.position.title}</p>
      <label>保存内容<textarea rows={5} value={draft.text} maxLength={12000} required onChange={event => setDraft({ ...draft, text: event.target.value })}/></label>
      {!!draft.sources.length && <fieldset><legend>保留的证据</legend>{draft.sources.map((item, index) =>
        <div className="input-row" key={index}><input type="checkbox" aria-label={'保留证据 ' + (index + 1)} checked={draft.evidence.includes(index)}
          onChange={event => setDraft({ ...draft, evidence: event.target.checked ? [...draft.evidence, index] : draft.evidence.filter(value => value !== index) })}/>
        <EvidenceLinks items={[item]}/></div>)}</fieldset>}
      {!draft.evidence.length && <p className="muted">证据状态 · 待核实</p>}
      <label>读者补充<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}>
        <option value="observation">读者观察</option><option value="idea">迁移设想</option>
      </select></label>
      <textarea aria-label="补充内容" rows={2} maxLength={6000} value={draft.observation} onChange={event => setDraft({ ...draft, observation: event.target.value })}/>
      <div className="actions"><button className="primary" disabled={busy}>确认保存</button>
        <button type="button" disabled={busy} onClick={() => setDraft(null)}>取消</button></div>
    </form>}
    {message && <p role="status" className="message">{message}</p>}
  </details>;
}

function Turn({ turn, onDraft }) {
  const answer = useRef(null);
  return <details className="followup-turn" open>
    <summary>{turn.question}</summary><p className="muted">{turn.position.title} · {turn.model}</p>
    <div ref={answer}><Markdown>{turn.answer}</Markdown></div>
    <EvidenceLinks items={turn.evidence}/>
    {!turn.evidence.length && <p className="muted">原始证据 · 待核实</p>}
    <div className="row-between"><EffortInfo entry={turn}/>
      <button onMouseDown={event => event.preventDefault()} onClick={() => onDraft(answer.current)}>摘入主笔记</button></div>
  </details>;
}
