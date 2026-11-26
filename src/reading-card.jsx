import React, { useId } from 'react';
import { useLocale } from './locale.jsx';

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
  actionsLabel,
  result,
  resultLabel,
  evidence,
  evidenceLabel,
  save,
  saveLabel,
}) {
  const { t } = useLocale();
  return <section className={['reading-card', className].filter(Boolean).join(' ')} aria-label={label || title}>
    <header className="reading-card-header">
      {kicker && <p className="eyebrow">{kicker}</p>}
      <h3>{title}</h3>
      {intro}
    </header>
    {actions != null && <Region className="reading-card-actions" label={actionsLabel || t('cardActions')}>{actions}</Region>}
    {result != null && <Region className="reading-card-result" label={resultLabel || t('resultLabel')}>{result}</Region>}
    {evidence != null && <Region className="reading-card-evidence" label={evidenceLabel || t('cardEvidence')}>{evidence}</Region>}
    {save != null && <Region className="reading-card-save" label={saveLabel || t('save')}>{save}</Region>}
  </section>;
}
