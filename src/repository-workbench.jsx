import React, { useEffect, useId, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowUpRight, GitCommitHorizontal } from 'lucide-react';
import { EvidenceLinks } from './workbench-fields.jsx';
import { Markdown } from './markdown.jsx';
import { ReadingCard } from './reading-card.jsx';
import { MotionTabsList, positionHighlight } from './interface-motion.jsx';
import { useLocale } from './locale.jsx';

export function RepositoryWorkbench({ guide, repo, onTool, initialStep }) {
  const { t } = useLocale();
  const [view, setView] = useState('sample');
  const [selected, setSelected] = useState(initialStep ?? (guide.demo === 'angle' ? 'measure-angle' : guide.nodes[0].id));
  const [scenario, setScenario] = useState('reflex');
  const [angle, setAngle] = useState(285);
  const [guess, setGuess] = useState(null);
  const current = guide.nodes.find(node => node.id === selected) ?? guide.nodes[0];
  const canCompare = guide.nodes.some(node => node.concept || node.mapping);
  const quizStep = current.quiz ? current : guide.nodes.find(node => node.quiz);
  const canPractice = guide.demo === 'angle' || Boolean(quizStep);
  const answer = scenario === 'empty' ? null : angle > 180 ? 360 - angle : angle;

  function chooseScenario(next) {
    setScenario(next);
    setGuess(null);
    if (next !== 'empty') setAngle(next === 'reflex' ? 285 : 75);
  }

  function selectStep(id) {
    setSelected(id);
    setGuess(null);
  }

  const sample = guide.demo === 'angle' && <AngleSample angle={angle} answer={answer} scenario={scenario}
    onScenario={chooseScenario} onAngle={next => {
      setAngle(next);
      setScenario(next > 180 ? 'reflex' : 'normal');
      setGuess(null);
    }}/>;
  const formula = current.formula && <div className="repository-formula">{current.formula.split('\\quad').map((part, index) =>
    <Markdown key={index}>{'$' + part.trim() + '$'}</Markdown>)}</div>;
  const practiceStep = guide.demo === 'angle' ? guide.nodes.find(node => node.id === 'measure-angle') : quizStep;
  const evidenceStep = view === 'practice' ? practiceStep : current;
  const evidenceReady = view !== 'practice' || guess !== null;
  const evidenceItems = evidenceStep?.evidence || [];
  const showSnippet = Boolean(evidenceReady && evidenceStep?.snippet && view !== 'mapping');
  const followTarget = evidenceStep || current;
  const followCode = followTarget.evidence?.find(item => item.kind === 'code');
  const followup = onTool && <button type="button" onClick={() => onTool([followTarget.title, followTarget.operation].filter(Boolean).join('\n'),
    { repoId: repo?.id, file: followCode?.file, repositoryStep: followTarget.id })}>{t('askStep')}</button>;
  return <Tabs.Root value={view} onValueChange={setView}>
    <ReadingCard className="repository-workbench engineering-card" label={guide.title} kicker={t('repoSteps')} title={guide.title}
      intro={<div className="repository-card-intro">
        {guide.intro && <p>{guide.intro}</p>}
        {repo && <a className="repository-commit" href={repo.url + '/tree/' + repo.commit} target="_blank" rel="noreferrer"
          title={t('pinnedCommit', { commit: repo.commit })}><GitCommitHorizontal size={16} aria-hidden="true"/>{repo.commit.slice(0, 7)}<ArrowUpRight size={14} aria-hidden="true"/></a>}
      </div>}
      actions={<>
        <MotionTabsList className="repository-views" value={view} aria-label={t('readingViews')}>
          <Tabs.Trigger value="sample">{t('followSample')}</Tabs.Trigger>
          {canCompare && <Tabs.Trigger value="mapping">{t('formulaCode')}</Tabs.Trigger>}
          {canPractice && <Tabs.Trigger value="practice">{t('practiceFirst')}</Tabs.Trigger>}
        </MotionTabsList>
        {view !== 'practice' && <StepSelector nodes={guide.nodes} current={current} select={selectStep}/>}
      </>}
      result={<>
        <Tabs.Content value="sample" className="repository-view">
          {guide.sample && !sample && <p className="repository-caption repository-sample-description">{guide.sample}</p>}
          <div className={sample ? 'repository-pair' : undefined}>
            {sample}
            <div key={current.id} className="repository-pane repository-step-entry">
              <h4>{current.title}</h4>
              {current.concept && <p className="repository-caption">{current.concept}</p>}
              {formula}
              {current.why && <Markdown>{current.why}</Markdown>}
              <dl className="repository-fields">{[[t('inputLabel'), current.input], [t('processLabel'), current.operation], [t('outputLabel'), current.output]].filter(([, value]) => value)
                .map(([label, value]) => <div key={label}><dt>{label}</dt><dd><Markdown>{value}</Markdown></dd></div>)}</dl>
            </div>
          </div>
          {guide.reuse && <section className="repository-reuse"><h4>{t('reusablePractice')}</h4><Markdown>{guide.reuse}</Markdown></section>}
        </Tabs.Content>
        <Tabs.Content value="mapping" className="repository-view">
          <div key={current.id} className="repository-pane repository-step-entry">
            <div className="repository-comparison">
              <div><h4>{t('paperSide')}</h4>
                <p>{current.concept || t('formulaPending')}</p>
                {formula}
                {current.mapping && <Markdown>{current.mapping}</Markdown>}
              </div>
              <div><h4>{t('codeSide')}</h4>
                <Markdown>{current.operation}</Markdown>
                {current.snippet && <pre className="file-code">{current.snippet}</pre>}
              </div>
            </div>
          </div>
          {sample && <details className="repository-demo-details"><summary>{t('checkWithSample')}</summary>{sample}</details>}
        </Tabs.Content>
        {canPractice && <Tabs.Content value="practice" className="repository-view">
          <div className={guide.reuse ? 'repository-pair' : undefined}>
            {guide.demo === 'angle' ? <AngleQuiz angle={angle} scenario={scenario} answer={answer} guess={guess}
              onScenario={chooseScenario} onGuess={setGuess}/>
              : <div className="repository-pane">
                <p className="repository-caption">{t('teachingExercise', { title: quizStep.title })}</p>
                <h4>{quizStep.quiz.question}</h4>
                <QuizOptions options={[...quizStep.quiz.alternatives, quizStep.output].sort()} guess={guess} onGuess={setGuess}/>
                <div role="status">{guess !== null && <>
                  <p>{guess === quizStep.output ? t('predictionCorrect') : t('implementationReturns', { value: quizStep.output })}</p>
                  <Markdown>{quizStep.quiz.explanation}</Markdown>
                </>}</div>
              </div>}
            {guide.reuse && <section className="repository-pane"><h4>{t('reusablePractice')}</h4><Markdown>{guide.reuse}</Markdown></section>}
          </div>
        </Tabs.Content>}
      </>}
      evidence={evidenceReady ? <>
        {evidenceItems.length > 0 && <EvidenceLinks items={evidenceItems} compact/>}
        {showSnippet && <details key={evidenceStep.id}><summary>{t('viewStepSource')}</summary><pre className="file-code">{evidenceStep.snippet}</pre></details>}
        {evidenceItems.length === 0 && !showSnippet && <p className="muted">{t('noStepEvidence')}</p>}
      </> : <p className="muted">{t('evidenceAfterAnswer')}</p>}
      save={followup || <p className="muted">{t('cannotAskStep')}</p>}/>
  </Tabs.Root>;
}

function StepSelector({ nodes, current, select }) {
  const { t } = useLocale();
  return <nav className="repository-steps" aria-label={t('sampleSteps')}>
    {nodes.map((node, index) => <button key={node.id} type="button" aria-pressed={current.id === node.id}
      onClick={() => select(node.id)}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{node.title}</button>)}
  </nav>;
}

const scenarios = [['normal', 'scenarioNormal'], ['reflex', 'scenarioReflex'], ['empty', 'scenarioEmpty']];
function Scenarios({ current, choose }) {
  const { t } = useLocale();
  return <div className="repository-choices" aria-label={t('sampleConditions')}>
    {scenarios.map(([key, label]) => <button type="button" key={key} aria-pressed={current === key} onClick={() => choose(key)}>{t(label)}</button>)}
  </div>;
}

function AngleSample({ angle, answer, scenario, onScenario, onAngle }) {
  const { t } = useLocale();
  const id = useId();
  const canvas = useRef(null);
  useEffect(() => {
    const element = canvas.current;
    const draw = () => drawAngle(element, angle, answer);
    const resize = new ResizeObserver(draw);
    resize.observe(element);
    draw();
    return () => resize.disconnect();
  }, [angle, answer]);
  return <div className="repository-pane repository-sample">
    <div className="repository-readout"><div><h4>{t('teachingSample')}</h4><p>{t('simulatedReading')}</p></div>
      <output><span key={scenario} className="repository-readout-change">{answer === null ? t('scenarioEmpty') : answer + '°'}</span></output></div>
    <div className="repository-canvas-frame pointer-highlight" onPointerMove={positionHighlight}>
      <canvas ref={canvas} className="repository-canvas" role="img" aria-label={t('angleAria')}/>
    </div>
    <div className="repository-readout"><span>{t('engineAngle', { value: answer === null ? t('emptyReading') : angle + '°' })}</span>
      <span>{t('redrawRule', { value: answer === null ? t('notTriggered') : angle > 180 ? t('swapEnds') : t('originalOrder') })}</span></div>
    <label htmlFor={id}>{t('rotateRay')}</label>
    <input id={id} type="range" min="1" max="359" value={angle} disabled={answer === null}
      aria-valuetext={t('angleValue', { angle })} onChange={event => onAngle(Number(event.currentTarget.value))}/>
    <Scenarios current={scenario} choose={onScenario}/>
  </div>;
}

function drawAngle(canvas, angle, answer) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const scale = Math.min(window.devicePixelRatio, 2);
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  const theme = getComputedStyle(canvas);
  const color = token => theme.getPropertyValue(token).trim();
  ctx.fillStyle = color('--diagram-grid');
  for (let x = 12; x < width; x += 16) {
    for (let y = 12; y < height; y += 16) ctx.fillRect(x, y, 1, 1);
  }
  const x = width * 0.47, y = height * 0.5;
  const radius = Math.min(height * 0.33, width * 0.25);
  const radians = -angle * Math.PI / 180;
  ctx.font = '15px monospace';
  ctx.lineWidth = 2;
  ctx.strokeStyle = ctx.fillStyle = color('--accent');
  for (const [label, theta] of [['A', 0], ['C', radians]]) {
    const endX = x + radius * Math.cos(theta), endY = y + radius * Math.sin(theta);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.fillText(label, endX + 6, endY - 6);
  }
  if (answer !== null) {
    ctx.strokeStyle = color('--signal');
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.45, 0, radians, angle <= 180);
    ctx.stroke();
  }
  ctx.fillStyle = color('--text');
  ctx.fillText('B', x - 16, y + 16);
}

function QuizOptions({ options, guess, onGuess }) {
  return <div className="repository-choices">
    {options.map(value => <button key={value} type="button" aria-pressed={value === guess} onClick={() => onGuess(value)}>{value}</button>)}
  </div>;
}

function AngleQuiz({ angle, scenario, answer, guess, onScenario, onGuess }) {
  const { t } = useLocale();
  const expected = answer === null ? 'null' : answer + '°';
  const options = answer === null ? ['0°', 'null', '75°'] : [...new Set([angle + '°', expected, 'null'])];
  return <div className="repository-pane">
    <h4>{t('predictReturn')}</h4>
    <Scenarios current={scenario} choose={onScenario}/>
    <p>{answer === null ? t('noReadingQuestion') : t('angleQuestion', { angle })}</p>
    <QuizOptions options={options} guess={guess} onGuess={onGuess}/>
    <div role="status">{guess !== null && <>
      <p>{guess === expected ? t('predictionCorrect') : t('implementationReturns', { value: expected })}</p>
      <p>{answer === null ? t('emptySuccess') : angle > 180 ? t('reflexExplain') : t('directReading')}</p>
      <p className="repository-caption">{t('responseExcerpt')}</p>
      <pre>{JSON.stringify({ success: true, value: answer }, null, 2)}</pre>
    </>}</div>
  </div>;
}
