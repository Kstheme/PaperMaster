import React, { useEffect, useRef } from 'react';
import { BookOpen } from 'lucide-react';

const storageKey = 'papermaster.firstReading';
const steps = ['导入论文', '连接模型', '开始阅读'];

export function firstReadingSkipped() {
  try { return localStorage.getItem(storageKey) === 'skipped'; }
  catch { return false; }
}

export function rememberFirstReading() {
  try { localStorage.setItem(storageKey, 'skipped'); }
  catch { /* 本次打开仍然可以进入工作台。 */ }
}

export function FirstReading({ step, onStep, paper, connections, onSkip, importPanel, connectPanel, readingPanel }) {
  const connected = connections.length > 0;
  const progress = useRef(null);
  useEffect(() => {
    const paperId = paper?.id ?? '';
    const previous = progress.current;
    progress.current = { paperId, connected };
    if (!previous) return;
    if (paperId && paperId !== previous.paperId) onStep(connected ? 2 : 1);
    else if (connected && !previous.connected && paperId) onStep(2);
  }, [paper, connected, onStep]);

  return <section className="first-reading" aria-label="首次阅读引导">
    <div className="first-reading-lead">
      <p className="eyebrow"><BookOpen size={14} aria-hidden="true"/>首次阅读</p>
      <h1>从空论文库开始</h1>
      <p>先导入一篇自己的论文，再连接模型，然后开始第一篇阅读。跳过之后进入工作台，可以自行导入论文、连接模型和管理阅读记录。</p>
      <div className="actions"><button type="button" onClick={onSkip}>跳过引导</button></div>
    </div>
    <ol className="first-reading-steps">
      {steps.map((label, index) => <li key={label}>
        <button type="button" aria-current={step === index ? 'step' : undefined} onClick={() => onStep(index)}>
          <span aria-hidden="true">{index + 1}</span>{label}
        </button>
      </li>)}
    </ol>
    {step === 0 && <>
      {paper && <p className="first-reading-note" role="status">已导入「{paper.title}」。可以再导入一篇，或继续连接模型。</p>}
      {importPanel}
    </>}
    {step === 1 && <>
      {connected && <p className="first-reading-note" role="status">已连接 {connections.map(item => item.label).join('、')}。</p>}
      {paper && connected && <div className="actions"><button className="primary" type="button" onClick={() => onStep(2)}>开始阅读</button></div>}
      {!paper && <p className="first-reading-note">导入论文后即可开始阅读。模型可以现在连接。</p>}
      {connectPanel}
    </>}
    {step === 2 && <>
      {!paper && <section className="panel">
        <h2>开始阅读</h2>
        <p>请先导入一篇论文。</p>
        <div className="actions"><button type="button" onClick={() => onStep(0)}>返回导入论文</button></div>
      </section>}
      {paper && !connected && <p className="first-reading-note" role="status">连接模型后，才能开始这次阅读。</p>}
      {paper && connected && <p className="first-reading-note">选择一种阅读方式。开始后进入这篇论文的工作台，阅读记录和主笔记都留在这里。</p>}
      {paper && !connected && <div className="actions"><button type="button" onClick={() => onStep(1)}>返回连接模型</button></div>}
      {paper && readingPanel}
    </>}
  </section>;
}
