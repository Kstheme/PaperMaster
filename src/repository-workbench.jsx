import React, { useEffect, useId, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowUpRight, GitCommitHorizontal } from 'lucide-react';
import { EvidenceLinks } from './workbench-fields.jsx';
import { Markdown } from './markdown.jsx';
import { MotionTabsList, positionHighlight } from './interface-motion.jsx';

export function RepositoryWorkbench({ guide, repo, onTool, initialStep }) {
  const [view, setView] = useState('sample');
  const [selected, setSelected] = useState(initialStep ?? (guide.demo === 'angle' ? 'measure-angle' : guide.nodes[0].id));
  const [scenario, setScenario] = useState('reflex');
  const [angle, setAngle] = useState(285);
  const [guess, setGuess] = useState(null);
  const current = guide.nodes.find(node => node.id === selected) ?? guide.nodes[0];
  const code = current.evidence.find(item => item.kind === 'code');
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
  const followup = onTool && <button type="button" onClick={() => onTool([current.title, current.operation].join('\n'),
    { repoId: repo?.id, file: code?.file, repositoryStep: current.id })}>追问此步骤</button>;
  const formula = current.formula && <div className="repository-formula">{current.formula.split('\\quad').map((part, index) =>
    <Markdown key={index}>{'$' + part.trim() + '$'}</Markdown>)}</div>;
  const sourceDetails = <div className="repository-sources">
    <EvidenceLinks items={current.evidence} compact/>
    {followup}
  </div>;
  return <section className="repository-workbench" aria-label={guide.title}>
    <header className="repository-workbench-header">
      <div><h3>{guide.title}</h3>{guide.intro && <p>{guide.intro}</p>}</div>
      {repo && <a className="repository-commit" href={repo.url + '/tree/' + repo.commit} target="_blank" rel="noreferrer"
        title={'固定提交 ' + repo.commit}><GitCommitHorizontal size={16} aria-hidden="true"/>{repo.commit.slice(0, 7)}<ArrowUpRight size={14} aria-hidden="true"/></a>}
    </header>
    <Tabs.Root value={view} onValueChange={setView} className="repository-workbench-body">
      <MotionTabsList className="repository-views" value={view} aria-label="精读方式">
        <Tabs.Trigger value="sample">沿样本走</Tabs.Trigger>
        {canCompare && <Tabs.Trigger value="mapping">公式与代码对照</Tabs.Trigger>}
        {canPractice && <Tabs.Trigger value="practice">先做验证题</Tabs.Trigger>}
      </MotionTabsList>
      <Tabs.Content value="sample" className="repository-view">
        <StepSelector nodes={guide.nodes} current={current} select={selectStep}/>
        {guide.sample && !sample && <p className="repository-caption repository-sample-description">{guide.sample}</p>}
        <div className={sample ? 'repository-pair' : undefined}>
          {sample}
          <div key={current.id} className="repository-pane repository-step-entry">
            <h4>{current.title}</h4>
            {current.concept && <p className="repository-caption">{current.concept}</p>}
            {formula}
            {current.why && <Markdown>{current.why}</Markdown>}
            <dl className="repository-fields">{[['输入', current.input], ['处理', current.operation], ['输出', current.output]].filter(([, value]) => value)
              .map(([label, value]) => <div key={label}><dt>{label}</dt><dd><Markdown>{value}</Markdown></dd></div>)}</dl>
            {current.snippet && <details key={current.id}><summary>查看这一步的源码</summary><pre className="file-code">{current.snippet}</pre></details>}
            {sourceDetails}
          </div>
        </div>
        {guide.reuse && <section className="repository-reuse"><h4>可复用做法</h4><Markdown>{guide.reuse}</Markdown></section>}
      </Tabs.Content>
      <Tabs.Content value="mapping" className="repository-view">
        <StepSelector nodes={guide.nodes} current={current} select={selectStep}/>
        <div key={current.id} className="repository-pane repository-step-entry">
          <div className="repository-comparison">
            <div><h4>论文</h4>
              <p>{current.concept || '对应公式或图表待核实'}</p>
              {formula}
              {current.mapping && <Markdown>{current.mapping}</Markdown>}
            </div>
            <div><h4>代码实现</h4>
              <Markdown>{current.operation}</Markdown>
              {current.snippet && <pre className="file-code">{current.snippet}</pre>}
            </div>
          </div>
          {sourceDetails}
        </div>
        {sample && <details className="repository-demo-details"><summary>用同一个教学样本核对</summary>{sample}</details>}
      </Tabs.Content>
      {canPractice && <Tabs.Content value="practice" className="repository-view">
        <div className={guide.reuse ? 'repository-pair' : undefined}>
          {guide.demo === 'angle' ? <AngleQuiz angle={angle} scenario={scenario} answer={answer} guess={guess}
            onScenario={chooseScenario} onGuess={setGuess} step={guide.nodes.find(node => node.id === 'measure-angle')}/>
            : <div className="repository-pane">
              <p className="repository-caption">教学练习 · {quizStep.title}</p>
              <h4>{quizStep.quiz.question}</h4>
              <QuizOptions options={[...quizStep.quiz.alternatives, quizStep.output].sort()} guess={guess} onGuess={setGuess}/>
              <div role="status">{guess !== null && <>
                <p>{guess === quizStep.output ? '预测正确' : '实现返回：' + quizStep.output}</p>
                <Markdown>{quizStep.quiz.explanation}</Markdown><EvidenceLinks items={quizStep.evidence}/>
              </>}</div>
            </div>}
          {guide.reuse && <section className="repository-pane"><h4>可复用做法</h4><Markdown>{guide.reuse}</Markdown></section>}
        </div>
      </Tabs.Content>}
    </Tabs.Root>
  </section>;
}

function StepSelector({ nodes, current, select }) {
  return <nav className="repository-steps" aria-label="样本步骤">
    {nodes.map((node, index) => <button key={node.id} type="button" aria-pressed={current.id === node.id}
      onClick={() => select(node.id)}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{node.title}</button>)}
  </nav>;
}

const scenarios = [['normal', '常规角'], ['reflex', '反角'], ['empty', '无读数']];
function Scenarios({ current, choose }) {
  return <div className="repository-choices" aria-label="教学样本条件">
    {scenarios.map(([key, label]) => <button type="button" key={key} aria-pressed={current === key} onClick={() => choose(key)}>{label}</button>)}
  </div>;
}

function AngleSample({ angle, answer, scenario, onScenario, onAngle }) {
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
    <div className="repository-readout"><div><h4>教学样本 · ∠ABC</h4><p>模拟读数</p></div>
      <output><span key={scenario} className="repository-readout-change">{answer === null ? '无读数' : answer + '°'}</span></output></div>
    <div className="repository-canvas-frame pointer-highlight" onPointerMove={positionHighlight}>
      <canvas ref={canvas} className="repository-canvas" role="img" aria-label="量角示意，以 B 为顶点的 BA 和 BC 两条射线"/>
    </div>
    <div className="repository-readout"><span>引擎角度 · {answer === null ? '空' : angle + '°'}</span>
      <span>重绘 · {answer === null ? '未触发' : angle > 180 ? '交换 A 与 C' : '沿原顺序'}</span></div>
    <label htmlFor={id}>旋转射线 BC</label>
    <input id={id} type="range" min="1" max="359" value={angle} disabled={answer === null}
      aria-valuetext={angle + ' 度'} onChange={event => onAngle(Number(event.currentTarget.value))}/>
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

function AngleQuiz({ angle, scenario, answer, guess, onScenario, onGuess, step }) {
  const expected = answer === null ? 'null' : answer + '°';
  const options = answer === null ? ['0°', 'null', '75°'] : [...new Set([angle + '°', expected, 'null'])];
  return <div className="repository-pane">
    <h4>先预测工具会返回什么</h4>
    <Scenarios current={scenario} choose={onScenario}/>
    <p>{answer === null ? '命令成功，但引擎没给读数。模型收到什么值？' : '画布给出 ' + angle + '°，模型最终收到多少度？'}</p>
    <QuizOptions options={options} guess={guess} onGuess={onGuess}/>
    <div role="status">{guess !== null && <>
      <p>{guess === expected ? '预测正确' : '实现返回：' + expected}</p>
      <p>{answer === null ? '调用可以成功并携带空读数。' : angle > 180 ? '执行器用 360° 减去反角，并交换端点重画。' : '执行器直接返回转成度数的读数。'}</p>
      <p className="repository-caption">回包节选 · 教学模拟</p>
      <pre>{JSON.stringify({ success: true, value: answer }, null, 2)}</pre>
      <EvidenceLinks items={step.evidence}/>
    </>}</div>
  </div>;
}
