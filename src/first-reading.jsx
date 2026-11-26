import React, { useEffect, useRef } from 'react';
import { BookOpen } from 'lucide-react';
import { api } from './api.js';
import { useLocale } from './locale.jsx';

export function firstReadingSkipped(library) {
  return library?.firstReadingSkipped === true;
}

export function rememberFirstReading() {
  return api('settings/first-reading', { method: 'PUT', json: { skipped: true } });
}

export function FirstReading({ step, onStep, paper, connections, onSkip, importPanel, connectPanel, readingPanel }) {
  const { language, t } = useLocale();
  const connected = connections.length > 0;
  const progress = useRef(null);
  const steps = [t('importPaper'), t('guideConnect'), t('guideStart')];
  const labels = connections.map(item => item.label).join(language === 'en' ? ', ' : '、');
  useEffect(() => {
    const paperId = paper?.id ?? '';
    const previous = progress.current;
    progress.current = { paperId, connected };
    if (!previous) return;
    if (paperId && paperId !== previous.paperId) onStep(connected ? 2 : 1);
    else if (connected && !previous.connected && paperId) onStep(2);
  }, [paper, connected, onStep]);

  return <section className="first-reading" aria-label={t('guideLabel')}>
    <div className="first-reading-lead">
      <p className="eyebrow"><BookOpen size={14} aria-hidden="true"/>{t('guideEyebrow')}</p>
      <h1>{t('guideTitle')}</h1>
      <p>{t('guideLead')}</p>
      <div className="actions"><button type="button" onClick={onSkip}>{t('guideSkip')}</button></div>
    </div>
    <ol className="first-reading-steps">
      {steps.map((label, index) => <li key={index}>
        <button type="button" aria-current={step === index ? 'step' : undefined} onClick={() => onStep(index)}>
          <span aria-hidden="true">{index + 1}</span>{label}
        </button>
      </li>)}
    </ol>
    {step === 0 && <>
      {paper && <p className="first-reading-note" role="status">{t('guideImported', { title: paper.title })}</p>}
      {importPanel}
    </>}
    {step === 1 && <>
      {connected && <p className="first-reading-note" role="status">{t('guideConnected', { labels })}</p>}
      {paper && connected && <div className="actions"><button className="primary" type="button" onClick={() => onStep(2)}>{t('guideStart')}</button></div>}
      {!paper && <p className="first-reading-note">{t('guideNeedPaper')}</p>}
      {connectPanel}
    </>}
    {step === 2 && <>
      {!paper && <section className="panel">
        <h2>{t('guideStart')}</h2>
        <p>{t('guideImportFirst')}</p>
        <div className="actions"><button type="button" onClick={() => onStep(0)}>{t('guideBackImport')}</button></div>
      </section>}
      {paper && !connected && <p className="first-reading-note" role="status">{t('guideNeedModel')}</p>}
      {paper && connected && <p className="first-reading-note">{t('guideChoose')}</p>}
      {paper && !connected && <div className="actions"><button type="button" onClick={() => onStep(1)}>{t('guideBackConnect')}</button></div>}
      {paper && readingPanel}
    </>}
  </section>;
}
