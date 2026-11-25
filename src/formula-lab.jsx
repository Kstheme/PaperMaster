import React, { useRef, useState } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import { solveDemo } from '../server/interaction-math.js';
import { api } from './api.js';
import { Markdown } from './markdown.jsx';

const number = value => Array.isArray(value) ? '[' + value.map(number).join(', ') + ']' : Number(value.toFixed(4)).toString();
const initial = demo => Object.fromEntries(demo.inputs.map(item => [item.id, item.value]));
const palette = Array.from({ length: 6 }, (_, i) => 'var(--chart-' + (i + 1) + ')');

export function FormulaLab({ demo, jobId, component, onNote }) {
  const [values, setValues] = useState(() => initial(demo));
  const [observe, setObserve] = useState(false);
  const [observation, setObservation] = useState('');
  const [save, setSave] = useState({});
  const [scenario, setScenario] = useState(null);
  let result, problem;
  try { result = solveDemo(demo, values); }
  catch (error) { problem = error.message; }
  const intermediate = demo.steps.filter(item => item.label && !demo.outputs.includes(item.id));
  const scenarios = demo.scenarios || [];
  function setInput(id, value) {
    setScenario(null);
    setValues(current => ({ ...current, [id]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    setSave({ busy: true });
    try {
      await api(`jobs/${jobId}/observation`, { method: 'POST', json: { component, values, observation: observation.trim() } });
      setObservation('');
      setObserve(false);
      setSave({ message: '已加入主笔记' });
      onNote();
    } catch (error) { setSave({ error: error.message }); }
  }
  return <section className="formula-lab" aria-label="公式演算">
    <div className="interaction-heading"><div><p className="eyebrow">教学演示</p><h3>{demo.title}</h3></div>
      <button onClick={() => { setValues(initial(demo)); setSave({}); setScenario(null); }}><RotateCcw size={15}/>恢复初始值</button></div>
    <Markdown>{demo.objective}</Markdown>
    <p className="prediction">{demo.prediction}</p>
    {scenarios.length > 0 && <div className="lab-scenarios">
      <div className="actions" aria-label="可试算的情景">{scenarios.map((item, index) => <button key={index} type="button"
        aria-pressed={scenario === index} onClick={() => { setScenario(index); setValues({ ...initial(demo), ...item.values }); }}>
        {item.label}</button>)}</div>
      {scenario !== null && <p role="status">{scenarios[scenario].observe}</p>}
    </div>}
    <div className="lab-stage">
      <div className="lab-visual">
        {demo.marks.length > 0 && <Geometry demo={demo} result={result} onDrag={delta => {
          setScenario(null); setValues(current => ({ ...current, ...delta }));
        }}/>}
        {result && <MiniCharts demo={demo} values={values} result={result}/>}
        {problem && <p role="status" className="error">{problem}</p>}
      </div>
      <div className="lab-inputs">
        {demo.inputs.map(input => <div className="lab-input" key={input.id}>
          <label>{input.label}<input aria-label={input.label} type="number" step="any" min={input.min} max={input.max}
            value={values[input.id] ?? ''} onChange={event => setInput(input.id, event.target.value === '' ? null : event.target.valueAsNumber)}/></label>
          <input aria-label={'调节' + input.label} type="range" min={input.min} max={input.max} step={input.step}
            value={values[input.id] ?? input.value} onChange={event => setInput(input.id, event.target.valueAsNumber)}/>
        </div>)}
      </div>
    </div>
    {result && <dl className="lab-results" aria-label="计算结果">{demo.outputs.map(id => <div key={id}>
      <dt>{demo.steps.find(item => item.id === id)?.label || id}</dt><dd><output>{number(result[id])}</output></dd>
    </div>)}</dl>}
    <details><summary>公式与符号</summary>
      <Markdown>{'$$\n' + demo.latex.replace(/^\$+|\$+$/g, '') + '\n$$'}</Markdown>
      <dl className="lab-results">{demo.inputs.map(item => <div key={item.id}><dt>{item.label}</dt><dd>{item.id}</dd></div>)}</dl>
    </details>
    {result && intermediate.length > 0 && <details><summary>查看中间计算结果</summary>
      <dl className="lab-results">{intermediate.map(item => <div key={item.id}><dt>{item.label}</dt><dd>{number(result[item.id])}</dd></div>)}</dl>
    </details>}
    <details><summary>理解输出如何变化</summary><Markdown>{demo.explanation}</Markdown></details>
    <div className="actions lab-note">
      <button disabled={!result || save.busy} onClick={() => { setObserve(value => !value); setSave({}); }}><Archive size={15}/>记录本次试算</button>
      {save.message && <p role="status">{save.message}</p>}
    </div>
    {observe && <form className="settings-form" onSubmit={submit}>
      <label>你的观察（可选）<textarea rows="2" maxLength={2500} value={observation} onChange={event => setObservation(event.target.value)}/></label>
      <div><button className="primary" disabled={!result || save.busy}>保存到主笔记</button></div>
      {save.error && <p className="error" role="alert">{save.error}</p>}
    </form>}
  </section>;
}

function Geometry({ demo, result, onDrag }) {
  const svg = useRef(null);
  const dragging = useRef(null);
  const extent = demo.domain;
  const range = 124;
  const origin = 146;
  const x = v => origin + range * v / extent;
  const y = v => origin - range * v / extent;
  function move(event) {
    if (!dragging.current || !svg.current?.getScreenCTM()) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.current.getScreenCTM().inverse());
    const [xId, yId] = dragging.current;
    const coordinate = (id, value) => {
      const input = demo.inputs.find(item => item.id === id);
      const rounded = Number((Math.round(value / input.step) * input.step).toPrecision(10));
      return Math.min(input.max, Math.max(input.min, rounded));
    };
    onDrag({ [xId]: coordinate(xId, (point.x - origin) * extent / range),
      [yId]: coordinate(yId, (origin - point.y) * extent / range) });
  }
  return <figure className="geometry">
    <svg ref={svg} viewBox="0 0 292 292" role="img" aria-label="二维演算图，数值也可通过旁边的输入框修改"
      onPointerMove={move} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}>
      <rect width="292" height="292" fill="var(--inset)"/>
      {[-1, -.75, -.5, -.25, 0, .25, .5, .75, 1].map(t => <g key={t} stroke={t === 0 ? 'var(--line-strong)' : 'var(--diagram-grid)'}>
        <path d={`M 22 ${y(t * extent)} H 270 M ${x(t * extent)} 22 V 270`}/></g>)}
      <g fill="var(--muted)" fontSize="10">
        <text x="24" y="285">{-extent}</text><text x="257" y="285">{extent}</text>
        <text x="3" y="22">{extent}</text><text x="3" y="270">{-extent}</text>
      </g>
      {result && demo.marks.map((mark, index) => {
        const point = result[mark.value];
        const color = palette[index % palette.length];
        if (!Array.isArray(point)) return null;
        if (mark.type === 'rectangle') {
          const [left, bottom, right, top] = point;
          if (right < left || top < bottom) return null;
          return <rect key={index} x={x(left)} y={y(top)} width={x(right) - x(left)} height={y(bottom) - y(top)}
            stroke={color} strokeWidth="2" fill={color} fillOpacity=".12"><title>{mark.label}</title></rect>;
        }
        const [px, py] = point;
        let segment = null;
        if (mark.type === 'vector') segment = [0, 0];
        if (mark.type === 'segment') segment = result[mark.to];
        return <g key={index} fill={color}>
          <title>{mark.label}</title>
          {segment && <line x1={x(segment[0])} y1={y(segment[1])} x2={x(px)} y2={y(py)} stroke={color} strokeWidth="2.2"/>}
          {mark.type !== 'segment' && <circle cx={x(px)} cy={y(py)} r={mark.drag ? 6 : 4} stroke="var(--inset)" strokeWidth="1.6"/>}
          {mark.label && mark.type !== 'segment' && <text x={x(px) + 8} y={y(py) - 7} fontSize="11">{mark.label}</text>}
          {mark.drag && <circle className="geometry-handle" cx={x(px)} cy={y(py)} r="14" fill="transparent" onPointerDown={event => {
            event.preventDefault();
            dragging.current = mark.drag;
            svg.current.setPointerCapture(event.pointerId);
          }}/>}
        </g>;
      })}
    </svg>
    <figcaption>{demo.marks.some(mark => mark.drag) ? '拖动图中的控制点，或直接输入坐标' : '调整数值以观察几何关系'}</figcaption>
    <ul className="plot-legend">{demo.marks.filter(mark => mark.label).map(mark => <li key={mark.type + mark.value + mark.label}>{mark.label}</li>)}</ul>
  </figure>;
}

function MiniCharts({ demo, values, result }) {
  const bars = demo.bars.flatMap(id => {
    const value = result[id];
    const name = demo.steps.find(item => item.id === id)?.label || id;
    return Array.isArray(value) ? value.map((item, index) => ({ name: name + ' ' + (index + 1), value: item }))
      : [{ name, value }];
  }).filter(item => Number.isFinite(item.value));
  const scale = Math.max(...bars.map(item => Math.abs(item.value)), 1);
  const input = demo.inputs.find(item => item.id === demo.curve?.input);
  let path = '', marker;
  if (input) {
    const sweep = Array.from({ length: 65 }, (_, index) => {
      try { return solveDemo(demo, { ...values, [input.id]: input.min + (input.max - input.min) * (index / 64) })[demo.curve.output]; }
      catch { return null; }
    });
    const valid = sweep.filter(Number.isFinite);
    if (valid.length) {
      const minimum = Math.min(...valid), delta = Math.max(Math.max(...valid) - minimum, .001);
      const ordinate = value => 108 - (value - minimum) / delta * 90;
      path = sweep.map((value, index) => Number.isFinite(value)
        ? `${Number.isFinite(sweep[index - 1]) ? 'L' : 'M'}${12 + index * 4} ${ordinate(value)}` : '').join(' ');
      marker = { x: 12 + 256 * (values[input.id] - input.min) / (input.max - input.min), y: ordinate(result[demo.curve.output]) };
    }
  }
  return <>
    {bars.length > 0 && <ul className="lab-bars">{bars.map((item, index) => <li key={index}>
      <span>{item.name}</span><i style={{ width: Math.abs(item.value) / scale * 100 + '%', background: palette[index % palette.length] }}/><output>{number(item.value)}</output>
    </li>)}</ul>}
    {!!path && <svg className="lab-curve" viewBox="0 0 280 120" role="img" aria-label={input.label + '变化时的输出曲线'}>
      <path d="M12 12 V108 H268" stroke="var(--line-strong)" fill="none"/>
      <path d={path} stroke="var(--chart-1)" strokeWidth="2" fill="none"/>
      {Number.isFinite(marker?.y) && <circle cx={marker.x} cy={marker.y} r="4" fill="var(--chart-2)"/>}
    </svg>}
  </>;
}
