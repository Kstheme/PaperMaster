import React, { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Markdown } from './markdown.jsx';
import { ReadingCard } from './reading-card.jsx';
import { useLocale } from './locale.jsx';

export function Sample({ steps }) {
  const { t } = useLocale();
  const [position, setPosition] = useState(0);
  const step = steps[position] ?? steps[0];
  if (!step) return null;
  return <ReadingCard className="sample-trace engineering-card" label={t('sampleTrace')} kicker={t('teachingDemo')} title={step.title}
    actions={<div className="reading-card-toolbar">
      <div className="actions">
        <button type="button" disabled={position === 0} onClick={() => setPosition(position - 1)}><ArrowLeft size={14}/>{t('previousStep')}</button>
        <button type="button" disabled={position === steps.length - 1} onClick={() => setPosition(position + 1)}>{t('nextStep')}<ArrowRight size={14}/></button>
      </div>
      <span className="muted">{position + 1} / {steps.length}</span>
    </div>}
    result={<dl className="repository-fields">{[[t('inputLabel'), step.input], [t('operationLabel'), step.operation], [t('outputLabel'), step.output]].map(([label, text]) =>
      <div key={label}><dt>{label}</dt><dd><Markdown>{text}</Markdown></dd></div>)}</dl>}/>;
}
