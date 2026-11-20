import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, FlaskConical } from 'lucide-react';
import { Markdown } from './markdown.jsx';

export function Sample({ steps }) {
  const [position, setPosition] = useState(0);
  const step = steps[position] ?? steps[0];
  if (!step) return null;
  return <section className="visual">
    <div className="visual-title"><FlaskConical size={17}/><h3>教学样本追踪</h3><span>{position + 1} / {steps.length}</span></div>
    <div className="sample">
      <h4>{step.title}</h4>
      <div className="sample-columns">{[['输入', step.input], ['操作', step.operation], ['输出', step.output]].map(([label, text]) =>
        <div key={label}><strong>{label}</strong><Markdown>{text}</Markdown></div>)}</div>
      <div className="actions">
        <button disabled={position === 0} onClick={() => setPosition(position - 1)}><ArrowLeft size={14}/>上一步</button>
        <button disabled={position === steps.length - 1} onClick={() => setPosition(position + 1)}>下一步<ArrowRight size={14}/></button>
      </div>
    </div>
  </section>;
}
