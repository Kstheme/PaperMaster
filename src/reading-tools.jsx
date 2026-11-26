import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Markdown } from './markdown.jsx';
import { useLocale } from './locale.jsx';
import { ConnectionPicker, EffortField, EffortInfo, EvidenceLinks, useAction, useCodexCatalog, useConnectionChoice } from './workbench-fields.jsx';

export function Followups({ job, library, intent, initialThread, onNote, onError }) {
  const [threads, setThreads] = useState([]);
  const [threadId, selectThread] = useState(initialThread || '');
  const [question, setQuestion] = useState('');
  const [connection, setConnection] = useConnectionChoice(library, job.connectionId);
  const [effort, setEffort] = useState('connection');
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState('');
  const [run, busy] = useAction(onError);
  const pending = useRef(null);
  const panel = useRef(null);
  const chosen = library.connections.find(item => item.id === connection);
  const catalog = useCodexCatalog(chosen?.provider === 'codex');
  const { t } = useLocale();
  const connectionLabels = { label: t('connection'), placeholder: t('chooseConnection'), localModel: t('localModel') };
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
    if (!thread || !confirm(t('deleteFollowupConfirm'))) return;
    run(async () => {
      await api(path + '/followups/' + thread.id, { method: 'DELETE' });
      setThreads(current => current.filter(item => item.id !== thread.id));
      selectThread('');
      setQuestion('');
      setDraft(null);
      pending.current = null;
      setMessage('followupDeleted');
    });
  }

  return <details className="panel workspace-tool" id={'followups-' + job.id} ref={panel} open>
    <summary>{t('followups')}</summary>
    <div className="actions followup-actions">
      <button type="button" onClick={() => { selectThread(''); setQuestion(''); setDraft(null); setMessage(''); }} disabled={busy}>{t('newFollowup')}</button>
      {thread && <button type="button" onClick={deleteThread} disabled={busy}>{t('deleteFollowup')}</button>}
      <button type="button" onClick={() => { panel.current.open = false; panel.current.querySelector('summary').focus(); }}>{t('collapseFollowup')}</button>
    </div>
    {threads.length > 0 && <label>{t('followupHistory')}<select value={threadId} onChange={event => { selectThread(event.target.value); setDraft(null); }} disabled={busy}>
      <option value="">{t('newQuestionOption')}</option>
      {threads.map(item => <option key={item.id} value={item.id}>{item.origin.title} · {item.turns[0].question.slice(0, 50)}</option>)}
    </select></label>}
    {thread?.turns.map(turn => <Turn key={turn.id} turn={turn} onDraft={container => startDraft(turn, container, thread)}/>)}
    {position && <div className="reading-context"><small>{t('currentPosition', { title: position.title })}</small>
      {position.text && <blockquote>{position.text}</blockquote>}</div>}
    <form className="settings-form" onSubmit={ask}>
      <label>{t('followupQuestion')}<textarea rows={3} value={question} onChange={event => setQuestion(event.target.value)} required maxLength={4000}
        placeholder={t('followupPlaceholder')}/></label>
      <div className="input-row"><ConnectionPicker library={library} value={connection} onChange={setConnection} {...connectionLabels}/>
        <EffortField connection={chosen} catalog={catalog} value={effort} onChange={setEffort} inherit localize label={t('effort')}/></div>
      <div className="actions"><button className="primary" disabled={busy || !connection || (!position && !thread)}>
        {busy ? t('followupBusy') : t('sendFollowup')}</button></div>
    </form>
    {draft && <form className="settings-form note-preview" onSubmit={event => {
      event.preventDefault();
      run(async () => {
        await api(path + '/followup-note/' + draft.thread, { method: 'POST',
          json: { turnId: draft.turn, text: draft.text, observation: draft.observation, kind: draft.kind, evidence: draft.evidence, saveId: draft.saveId } });
        setDraft(null);
        setMessage('addedToNote');
        onNote();
      });
    }}>
      <h3>{t('saveToMainNote')}</h3>
      <p className="muted">{t('questionPosition', { title: draft.position.title })}</p>
      <label>{t('contentToSave')}<textarea rows={5} value={draft.text} maxLength={12000} required onChange={event => setDraft({ ...draft, text: event.target.value })}/></label>
      {!!draft.sources.length && <fieldset><legend>{t('keptEvidence')}</legend>{draft.sources.map((item, index) =>
        <div className="input-row" key={index}><input type="checkbox" aria-label={t('keepEvidenceN', { index: index + 1 })} checked={draft.evidence.includes(index)}
          onChange={event => setDraft({ ...draft, evidence: event.target.checked ? [...draft.evidence, index] : draft.evidence.filter(value => value !== index) })}/>
        <EvidenceLinks items={[item]}/></div>)}</fieldset>}
      {!draft.evidence.length && <p className="muted">{t('evidencePending')}</p>}
      <label>{t('readerAddition')}<select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}>
        <option value="observation">{t('readerObservation')}</option><option value="idea">{t('transferIdea')}</option>
      </select></label>
      <textarea aria-label={t('additionContent')} rows={2} maxLength={6000} value={draft.observation} onChange={event => setDraft({ ...draft, observation: event.target.value })}/>
      <div className="actions"><button className="primary" disabled={busy}>{t('confirmSave')}</button>
        <button type="button" disabled={busy} onClick={() => setDraft(null)}>{t('cancel')}</button></div>
    </form>}
    {message && <p role="status" className="message">{t(message)}</p>}
  </details>;
}

function Turn({ turn, onDraft }) {
  const { t } = useLocale();
  const answer = useRef(null);
  return <details className="followup-turn" open>
    <summary>{turn.question}</summary><p className="muted">{turn.position.title} · {turn.model}</p>
    <div ref={answer}><Markdown>{turn.answer}</Markdown></div>
    <EvidenceLinks items={turn.evidence}/>
    {!turn.evidence.length && <p className="muted">{t('originalEvidencePending')}</p>}
    <div className="row-between"><EffortInfo entry={turn} localize/>
      <button onMouseDown={event => event.preventDefault()} onClick={() => onDraft(answer.current)}>{t('excerptToNote')}</button></div>
  </details>;
}
