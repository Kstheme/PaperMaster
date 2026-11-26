import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const phoneQuery = '(max-width: 720px)';

function usePlacement() {
  const [phone, setPhone] = useState(() => window.matchMedia(phoneQuery).matches);
  useEffect(() => {
    const media = window.matchMedia(phoneQuery);
    const apply = () => setPhone(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return phone ? 'sheet' : 'sidebar';
}

export function HighlightAnnotation({ jobId, highlight, canAppend, onChange, onClose, onNote }) {
  const placement = usePlacement();
  const [text, setText] = useState(highlight.annotation?.text ?? '');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saved = useRef(highlight.annotation?.text ?? '');
  const textRef = useRef(text);
  const area = useRef(null);
  textRef.current = text;

  useEffect(() => { area.current?.focus(); }, []);

  useEffect(() => {
    if (text.trim() === saved.current) return undefined;
    const timer = setTimeout(() => {
      save(text).catch(failure => setError(failure.message || '高亮批注没有保存。'));
    }, 500);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') closePanel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [text]);

  async function save(value) {
    const body = value.trim();
    if (body === saved.current) return Boolean(body);
    const updated = await api('jobs/' + jobId + '/highlights/' + highlight.id, {
      method: 'PATCH', json: { annotation: body },
    });
    saved.current = updated.annotation?.text ?? '';
    onChange(updated);
    setError('');
    setStatus(saved.current ? '已保存' : '已清除批注');
    return Boolean(saved.current);
  }

  async function closePanel() {
    if (busy) return;
    try {
      if (textRef.current.trim() !== saved.current) await save(textRef.current);
    } catch (failure) {
      setError(failure.message || '高亮批注没有保存。');
      return;
    }
    onClose();
  }

  async function confirm(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const kept = await save(textRef.current);
      if (!kept) {
        setStatus('');
        setError('请先写下高亮批注。');
        return;
      }
      await api('jobs/' + jobId + '/highlights/' + highlight.id + '/note', { method: 'POST', json: {} });
      setStatus('已加入主笔记');
      onNote?.();
    } catch (failure) {
      setError(failure.message || '高亮批注没有加入主笔记。');
    } finally {
      setBusy(false);
    }
  }

  return <>
    {placement === 'sheet' && <button type="button" className="highlight-annotation-backdrop" aria-label="关闭高亮批注" onClick={closePanel}/>}
    <aside id="highlight-annotation" className="highlight-annotation" data-placement={placement}
      role={placement === 'sheet' ? 'dialog' : 'complementary'} aria-labelledby="highlight-annotation-title">
      {placement === 'sheet' && <div className="highlight-annotation-handle" aria-hidden="true"/>}
      <div className="highlight-annotation-header">
        <h3 id="highlight-annotation-title">高亮批注</h3>
        <button type="button" onClick={closePanel}>关闭</button>
      </div>
      <p className="muted">写在这处阅读高亮上，确认后才收入主笔记。</p>
      <p className="muted">原文摘录</p>
      <blockquote className="highlight-annotation-quote">{highlight.quote}</blockquote>
      <form onSubmit={confirm}>
        <label className="highlight-annotation-field">
          <textarea ref={area} aria-label="高亮批注" rows={placement === 'sheet' ? 5 : 8} maxLength={8000} value={text} disabled={busy}
            placeholder="对着这段原文写下批注" onChange={event => { setText(event.target.value); setStatus(''); setError(''); }}/>
        </label>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => save(text).catch(failure => setError(failure.message || '高亮批注没有保存。'))}>保存批注</button>
          {canAppend && <button className="primary" disabled={busy || !text.trim()}>确认加入主笔记</button>}
        </div>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="message" role="status">{status}</p>}
    </aside>
  </>;
}
