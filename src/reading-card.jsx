import React, { useId } from 'react';

// Shared deep-reading card. Slot order: title, actions, result, evidence, save.
function Region({ label, className, children }) {
  const id = useId();
  return <div className={'reading-card-region ' + className} role="region" aria-labelledby={id}>
    <h4 id={id} className="reading-card-label">{label}</h4>
    {children}
  </div>;
}

export function ReadingCard({
  className = '',
  label,
  kicker,
  title,
  intro,
  actions,
  actionsLabel = '操作',
  children,
  result,
  resultLabel = '结果',
  evidence,
  evidenceLabel = '原始证据',
  save,
  saveLabel = '保存',
}) {
  return <section className={['reading-card', className].filter(Boolean).join(' ')} aria-label={label || title}>
    <header className="reading-card-header">
      {kicker && <p className="eyebrow">{kicker}</p>}
      <h3>{title}</h3>
      {intro}
    </header>
    {actions != null && <Region className="reading-card-actions" label={actionsLabel}>{actions}</Region>}
    {children != null && <div className="reading-card-body">{children}</div>}
    {result != null && <Region className="reading-card-result" label={resultLabel}>{result}</Region>}
    {evidence != null && <Region className="reading-card-evidence" label={evidenceLabel}>{evidence}</Region>}
    {save != null && <Region className="reading-card-save" label={saveLabel}>{save}</Region>}
  </section>;
}
