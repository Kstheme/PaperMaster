import React, { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, GitFork, Image, RotateCcw, Table2 } from 'lucide-react';
import { api } from './api.js';
import { FormulaLab } from './formula-lab.jsx';
import { Markdown } from './markdown.jsx';

const names = { graph: '论文架构', formula: '关键公式', main: '主结果', ablation: '关键消融' };
const working = job => ['queued', 'running'].includes(job.status);

export function InteractiveReader({ job, onRetry, busy, onNote }) {
  const [view, setView] = useState('map');
  const [selected, setSelected] = useState(null);
  const data = job.interaction;
  const records = data.components;
  const graph = records.graph?.data;
  const demo = records.formula?.data;
  const active = graph?.nodes.find(node => node.id === selected) ?? graph?.nodes.find(node => node.id === graph.focus);
  const failures = Object.keys(names).filter(key => records[key]?.status === 'failed');
  const canRetry = !busy && !working(job);
  const badge = key => <ComponentState key={key} name={key} record={records[key]} job={job} onRetry={onRetry} canRetry={canRetry}/>;
  return <section className="interactive-workspace" aria-label="交互精读">
    <header className="interactive-heading">
      <h2>交互精读</h2>
      <div className="actions interactive-views" aria-label="精读视图">
        {[['map', '论文架构', GitFork], ['evidence', '实验对照', Table2], ['sources', '原图表', Image]].map(([id, label, Icon]) =>
          <button key={id} aria-pressed={view === id} onClick={() => setView(id)}><Icon size={15}/>{label}</button>)}
      </div>
    </header>
    <ul className="component-progress" aria-label="交互组件进度">{Object.entries(names).map(([key, label]) => {
      const status = records[key]?.status;
      return <li key={key} data-state={status || 'pending'}>{label} <span>{
        status === 'ready' ? '已就绪' : status === 'failed' ? '待补齐' : status === 'running' && working(job) ? '生成中' : '等待中'
      }</span></li>;
    })}</ul>
    {view === 'map' && <>
      {graph ? <>
        <FlowMap graph={graph} active={active} onSelect={setSelected}/>
        {active && <div className="module-detail">
          <div><p className="eyebrow">当前模块</p><h3>{active.title}</h3><Markdown>{active.why}</Markdown></div>
          <dl>{[['输入', active.input], ['操作', active.operation], ['输出', active.output]].map(([label, value]) =>
            <div key={label}><dt>{label}</dt><dd><Markdown>{value}</Markdown></dd></div>)}</dl>
        </div>}
        <details className="interaction-overview"><summary>方法总览</summary><Markdown>{graph.intro}</Markdown></details>
        {demo && active?.id === demo.module
          ? <FormulaLab key={demo.title} demo={demo} jobId={job.id} onNote={onNote}/>
          : demo && <button onClick={() => setSelected(demo.module)}>进入公式演算 <ArrowRight size={15}/></button>}
        {!demo && badge('formula')}
      </> : badge('graph')}
      {records.graph?.source && <SourcePreview source={records.graph.source} jobId={job.id}/>}
    </>}
    {view === 'evidence' && <div className="experiment-stack">
      {['main', 'ablation'].map(key => <div key={key}>
        {records[key]?.data ? <ExperimentTable table={records[key].data} name={names[key]}/> : badge(key)}
        {records[key]?.source && <SourcePreview source={records[key].source} jobId={job.id}/>}
      </div>)}
    </div>}
    {view === 'sources' && <div className="source-list">
      {data.sources?.length ? data.sources.map(source => <SourcePreview key={source.id} source={source} jobId={job.id}/>)
        : <p className="muted">当前没有可定位的图表标题。原论文可在论文主页下载。</p>}
    </div>}
    {job.status === 'completed' && failures.length > 0 && <p className="muted interaction-missing">
      待补齐：{failures.map(key => names[key]).join('、')}。可以在对应视图中重试。
    </p>}
  </section>;
}

function ComponentState({ name, record, job, onRetry, canRetry }) {
  const fallback = name === 'formula' && job.sections.find(item => item.key === 'mechanism')?.markdown;
  return <div className="component-state">
    <h3>{names[name]}</h3>
    {record?.status === 'failed' ? <>
      <p>{record.error}</p>
      <button disabled={!canRetry} onClick={() => onRetry(name)}><RotateCcw size={15}/>重试{names[name]}</button>
      {fallback && <details><summary>查看分步解释</summary><Markdown>{fallback}</Markdown></details>}
    </> : <p role="status" className="muted">{working(job) ? '正在准备此组件。' : '此组件尚未生成。可继续生成任务。'}</p>}
  </div>;
}

function FlowMap({ graph, active, onSelect }) {
  const stages = [...new Set(graph.nodes.map(node => node.stage))].sort((a, b) => a - b);
  const lanes = stages.map(stage => graph.nodes.filter(node => node.stage === stage));
  const width = lanes.length * 178 + 16;
  const height = Math.max(...lanes.map(lane => lane.length)) * 84 + 24;
  const positions = new Map(lanes.flatMap((lane, col) => lane.map((node, row) =>
    [node.id, { x: col * 178 + 16, y: (height - lane.length * 84) / 2 + row * 84 + 12 }])));
  const incoming = graph.edges.filter(edge => edge.to === active?.id);
  const outgoing = graph.edges.filter(edge => edge.from === active?.id);
  return <>
    <div className="flow-frame" tabIndex={0} role="region" aria-label="论文架构图，可横向滚动">
      <div className="flow-canvas" style={{ width, height }}>
        <svg width={width} height={height} aria-hidden="true">
          <defs><marker id="end-flow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0 0 L7 3.5 L0 7 Z" fill="context-stroke"/>
          </marker></defs>
          {graph.edges.map((edge, index) => {
            const a = positions.get(edge.from), b = positions.get(edge.to);
            const live = edge.from === active?.id || edge.to === active?.id;
            let path;
            if (a.x === b.x) {
              const sign = Math.sign(b.y - a.y);
              path = `M${a.x + 69} ${a.y + (sign > 0 ? 54 : 0)} V${b.y + (sign > 0 ? 0 : 54)}`;
            } else {
              const leftToRight = b.x > a.x;
              const start = a.x + (leftToRight ? 138 : 0);
              const end = b.x + (leftToRight ? 0 : 138);
              const midpoint = (start + end) / 2;
              path = `M${start} ${a.y + 27} C${midpoint} ${a.y + 27} ${midpoint} ${b.y + 27} ${end} ${b.y + 27}`;
            }
            return <path key={index} d={path} fill="none" stroke={live ? '#336c5f' : '#9ba9a0'} strokeWidth={live ? 2.5 : 1.4}
              markerEnd="url(#end-flow)"><title>{edge.label}</title></path>;
          })}
        </svg>
        {graph.nodes.map(node => {
          const point = positions.get(node.id);
          return <button key={node.id} title={node.title} className="flow-node" aria-pressed={node.id === active?.id}
            style={{ left: point.x, top: point.y }} onClick={() => onSelect(node.id)}><span>{node.title}</span></button>;
        })}
      </div>
    </div>
    <div className="flow-neighbors" aria-label="切换到相邻模块">
      {[[incoming, '上游', 'from'], [outgoing, '下游', 'to']].map(([edges, label, field]) => edges.length > 0 &&
        <div className="actions" key={label}><span>{label}</span>{edges.map((edge, index) => <button key={index}
          onClick={() => onSelect(edge[field])}>{graph.nodes.find(node => node.id === edge[field]).title}
          {edge.label && <small>{edge.label}</small>}</button>)}</div>)}
    </div>
  </>;
}

function ExperimentTable({ table, name }) {
  const [dataset, setDataset] = useState('');
  const [metric, setMetric] = useState(0);
  const [sort, setSort] = useState('original');
  const [comparison, setComparison] = useState([]);
  const datasets = [...new Set(table.rows.map(row => row.dataset))];
  const indexed = table.rows.map((row, index) => ({ ...row, index }));
  const rows = indexed.filter(row => !dataset || row.dataset === dataset);
  const sortable = Boolean(dataset) || datasets.length === 1;
  if (sortable && sort !== 'original') rows.sort((a, b) => {
    const av = a.values[metric], bv = b.values[metric];
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    return (sort === 'asc' ? 1 : -1) * (av - bv);
  });
  const column = table.columns[metric] || table.columns[0];
  const chosen = comparison.map(index => indexed[index]).filter(row => rows.includes(row));
  const difference = chosen.length === 2 && chosen[0].dataset === chosen[1].dataset &&
    chosen.every(row => row.values[metric] !== null)
    ? Number((chosen[1].values[metric] - chosen[0].values[metric]).toFixed(8)) : null;
  return <section className="experiment-table">
    <p className="eyebrow">{name} · 论文报告结果</p><h3>{table.title}</h3><Markdown>{table.claim}</Markdown>
    <div className="actions experiment-controls">
      <label>数据集或任务<select value={dataset} onChange={event => { setDataset(event.target.value); setComparison([]); }}>
        <option value="">全部</option>{datasets.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>比较指标<select value={metric} onChange={event => setMetric(Number(event.target.value))}>
        {table.columns.map((item, index) => <option key={item.id} value={index}>{item.label}</option>)}</select></label>
      <label>排序<select value={sortable ? sort : 'original'} disabled={!sortable}
        title={sortable ? undefined : '选择同一数据集后可按数值排序'} onChange={event => setSort(event.target.value)}>
        <option value="original">论文顺序</option><option value="desc">数值从高到低</option><option value="asc">数值从低到高</option></select></label>
    </div>
    <div className="markdown-table experiment-scroll" tabIndex={0} role="region" aria-label={table.title}>
      <table><thead><tr><th scope="col">对照</th><th scope="col">方法</th><th scope="col">数据集</th><th scope="col">实验条件</th>
        {table.columns.map(item => <th scope="col" key={item.id}>{item.label}{item.unit && ' (' + item.unit + ')'}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.index} data-selected={comparison.includes(row.index)}>
          <td><input type="checkbox" aria-label={'比较 ' + row.method + ' ' + row.dataset + (row.condition ? ' ' + row.condition : '')}
            checked={comparison.includes(row.index)} onChange={event => setComparison(current => event.target.checked
              ? [...current.slice(-1), row.index] : current.filter(index => index !== row.index))}/></td>
          <th scope="row">{row.method}</th><td>{row.dataset}</td><td>{row.condition || '—'}</td>
          {row.values.map((item, index) => <td key={index} data-metric={index === metric}>{item ?? '未确认'}</td>)}</tr>)}</tbody>
      </table>
    </div>
    {chosen.length === 2 && <div className="experiment-compare" role="status">
      {chosen.map(row => <div key={row.index}><strong>{row.method}</strong><span>{row.condition || row.dataset}</span><b>{row.values[metric] ?? '未确认'}</b></div>)}
      {difference !== null && <p>{column.label} 差值（第二项 − 第一项）：{difference}{column.unit && ' ' + column.unit}</p>}
      {difference === null && <p>同一数据集且数值完整时可计算差值。</p>}
    </div>}
    <details><summary>比较条件与局限</summary><Markdown>{table.limitation}</Markdown></details>
    {table.omitted > 0 && <p className="muted">{table.omitted} 个提取值无法从原表文字核对，已省略。</p>}
  </section>;
}

function SourcePreview({ source, jobId }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({});
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let url;
    setState({});
    api(`jobs/${jobId}/asset/${source.id}`, { blob: true, signal: controller.signal }).then(blob => {
      if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setState({ url }); }
    }).catch(error => { if (!controller.signal.aborted) setState({ error: error.message }); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [open, source.id, jobId]);
  return <details className="source-preview" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><BookOpen size={15}/>原{source.type === 'table' ? '表' : '图'} {source.number} · PDF 第 {source.page} 页</summary>
    {open && <div>
      <p>{source.caption}</p>
      {state.url ? <img src={state.url} alt={source.caption}/> : <p role="status" className="muted">{state.error || '正在读取本地图表…'}</p>}
    </div>}
  </details>;
}
