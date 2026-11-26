import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useLocale } from './locale.jsx';

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

export function HighlightAnnotation({ jobId, highlight, canAppend, onChange, onClose, onNote, onDeleteHighlight }) {
  const { t } = useLocale();
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
      save(text).catch(failure => setError(failure.message || t('annotationSaveFailed')));
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
    setStatus(saved.current ? t('noteSaved') : t('annotationCleared'));
    return Boolean(saved.current);
  }

  async function closePanel() {
    if (busy) return;
    try {
      if (textRef.current.trim() !== saved.current) await save(textRef.current);
    } catch (failure) {
      setError(failure.message || t('annotationSaveFailed'));
      return;
    }
    onClose();
  }

  async function removeAnnotation() {
    if (busy) return;
    if (!textRef.current.trim() && !saved.current) return;
    if (!confirm(t('deleteAnnotationConfirm'))) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api('jobs/' + jobId + '/highlights/' + highlight.id, {
        method: 'PATCH', json: { annotation: '' },
      });
      saved.current = '';
      textRef.current = '';
      setText('');
      onChange(updated);
      setStatus(t('annotationCleared'));
      onClose();
    } catch (failure) {
      setError(failure.message || t('annotationSaveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const kept = await save(textRef.current);
      if (!kept) {
        setStatus('');
        setError(t('annotationRequired'));
        return;
      }
      await api('jobs/' + jobId + '/highlights/' + highlight.id + '/note', { method: 'POST', json: {} });
      setStatus(t('addedToNote'));
      onNote?.();
    } catch (failure) {
      setError(failure.message || t('annotationNoteFailed'));
    } finally {
      setBusy(false);
    }
  }

  return <>
    {placement === 'sheet' && <button type="button" className="highlight-annotation-backdrop" aria-label={t('closeAnnotation')} onClick={closePanel}/>}
    <aside id="highlight-annotation" className="highlight-annotation" data-placement={placement}
      role={placement === 'sheet' ? 'dialog' : 'complementary'} aria-labelledby="highlight-annotation-title">
      {placement === 'sheet' && <div className="highlight-annotation-handle" aria-hidden="true"/>}
      <div className="highlight-annotation-header">
        <h3 id="highlight-annotation-title">{t('annotationTitle')}</h3>
        <button type="button" onClick={closePanel}>{t('close')}</button>
      </div>
      <p className="muted">{t('annotationHint')}</p>
      <p className="muted">{t('quoteExcerpt')}</p>
      <blockquote className="highlight-annotation-quote">{highlight.quote}</blockquote>
      <form onSubmit={confirm}>
        <label className="highlight-annotation-field">
          <textarea ref={area} aria-label={t('annotationTitle')} rows={placement === 'sheet' ? 5 : 8} maxLength={8000} value={text} disabled={busy}
            placeholder={t('annotationPlaceholder')} onChange={event => { setText(event.target.value); setStatus(''); setError(''); }}/>
        </label>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => onDeleteHighlight(highlight)}>{t('deleteHighlight')}</button>
          <button type="button" disabled={busy || (!text.trim() && !highlight.annotation?.text)} onClick={removeAnnotation}>{t('deleteAnnotation')}</button>
          <button type="button" disabled={busy} onClick={() => save(text).catch(failure => setError(failure.message || t('annotationSaveFailed')))}>{t('saveAnnotation')}</button>
          {canAppend && <button className="primary" disabled={busy || !text.trim()}>{t('confirmAddNote')}</button>}
        </div>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="message" role="status">{status}</p>}
    </aside>
  </>;
}
