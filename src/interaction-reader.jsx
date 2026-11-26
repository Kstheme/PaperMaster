import React, { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, Pause, Play, RotateCcw } from 'lucide-react';
import { api } from './api.js';
import { FormulaLab } from './formula-lab.jsx';
import { Markdown } from './markdown.jsx';
import { ReadingCard } from './reading-card.jsx';
import { EvidenceLinks } from './workbench-fields.jsx';
import { RepositoryWorkbench } from './repository-workbench.jsx';
import { useLocale } from './locale.jsx';

const working = job => ['queued', 'running'].includes(job.status);

export function ReadingFigure({ name, job, repo, onRetry, busy, onNote, onTool }) {
  const { t } = useLocale();
  const record = job.interaction.components[name];
  const data = record?.data;
  const source = record?.source ? <SourcePreview source={record.source} jobId={job.id}/> : null;
  const ask = () => onTool([data.title, data.latex, data.claim, record.source?.caption].filter(Boolean).join('\n'), { component: name });
  const figureName = t('figure.' + name);
  return <div className="chapter-figure">
    {!data ? <ComponentState name={name} record={record} job={job} onRetry={onRetry} canRetry={!busy && !working(job)}/>
      : name.startsWith('graph') ? <AnimatedGraph graph={data} name={figureName} repo={repo} onTool={onTool} evidence={source}/>
        : name.startsWith('formula') ? <FormulaLab demo={data} jobId={job.id} component={name} onNote={onNote} evidence={source}/>
          : <ExperimentTable table={data} name={figureName} evidence={source} onAsk={onTool && ask}/>}
    {record?.source && !data && <SourcePreview source={record.source} jobId={job.id}/>}
    {data && onTool && name.startsWith('formula') && <button className="figure-question" onClick={ask}>{t('askFigure')}</button>}
  </div>;
}

export function ReadingSources({ job }) {
  const { t } = useLocale();
  return job.interaction?.sources?.length > 0 && <details className="reading-sources">
    <summary>{t('sourceCatalog')}</summary>
    {job.interaction.sources.map(source => <SourcePreview key={source.id} source={source} jobId={job.id}/>)}
  </details>;
}

export function RepositoryReading({ block, repo, onTool, initialStep }) {
  const { t } = useLocale();
  const guide = block.walkthrough ?? block.graph;
  return <section className="repo-reading-block" aria-label={block.title}>
    {guide?.nodes.length ? <RepositoryWorkbench guide={guide} repo={repo} onTool={onTool} initialStep={initialStep}/>
      : <h3>{block.title}</h3>}
    <details open={!guide?.nodes.length} className="repo-reading-evidence">
      <summary>{t('implementationNotes')}</summary>
      <Markdown>{block.markdown}</Markdown>
      {block.evidence.length ? <EvidenceLinks items={block.evidence}/> : <p className="muted">{t('noImplementationEvidence')}</p>}
      <details><summary>{t('filesConsulted')}</summary><ul>{block.searched.map(file => <li key={file}><code>{file}</code></li>)}</ul></details>
    </details>
  </section>;
}

function ComponentState({ name, record, job, onRetry, canRetry }) {
  const { t } = useLocale();
  const figureName = t('figure.' + name);
  return <div className="component-state">
    <h3>{figureName}</h3>
    {record?.status === 'failed' ? <>
      <p>{record.error}</p>
      <button disabled={!canRetry} onClick={() => onRetry(name)}><RotateCcw size={15}/>{t('retryComponentNamed', { name: figureName })}</button>
    </> : <p role="status" className="muted">{working(job) ? t('preparingComponent') : t('componentMissing')}</p>}
  </div>;
}

function AnimatedGraph({ graph, name, repo, onTool, repository = false, evidence }) {
  const { t } = useLocale();
  const order = [...graph.nodes].sort((a, b) => a.stage - b.stage);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const current = order[index];
  const last = index === order.length - 1;
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (last) setPlaying(false);
      else setIndex(index + 1);
    }, 2400);
    return () => clearTimeout(timer);
  }, [playing, index, last]);
  function select(node) {
    setPlaying(false);
    setIndex(order.findIndex(item => item.id === node));
  }
  const implementation = current.evidence?.length ? <EvidenceLinks items={current.evidence}/> : repo && (current.code ? <a className="module-source" href={repo.url + '/blob/' + repo.commit + '/' +
    current.code.file.split('/').map(encodeURIComponent).join('/') + (current.code.line ? '#L' + current.code.line : '')} target="_blank" rel="noreferrer">
    {current.code.file}{current.code.symbol && ' · ' + current.code.symbol}</a>
    : <p className="muted">{t('repoUnconfirmed')}</p>);
  return <ReadingCard className="inline-flow" label={t('architectureCard')} kicker={graph.title ? name : t('architectureCard')} title={graph.title || name}
    intro={graph.intro && <Markdown>{graph.intro}</Markdown>}
    actions={<>
      <div className="reading-card-toolbar flow-controls">
        <div className="actions">
          <button type="button" onClick={() => {
            if (!playing && last) setIndex(0);
            setPlaying(!playing);
          }}>{playing ? <Pause size={15}/> : <Play size={15}/>} {playing ? t('pauseDemo') : t('playFlow')}</button>
          <button type="button" disabled={index === 0} onClick={() => select(order[index - 1].id)}>{t('previousStep')}</button>
          <button type="button" disabled={last} onClick={() => select(order[index + 1].id)}>{t('nextStep')}</button>
        </div>
        <span className="muted" aria-live={playing ? 'off' : 'polite'}>{index + 1} / {order.length} · {current.title}</span>
      </div>
      <FlowMap graph={graph} active={current} onSelect={select} playing={playing} repository={repository}/>
    </>}
    result={<div className="module-detail">
      <div><h4>{current.title}</h4><Markdown>{current.why}</Markdown></div>
      <dl>{[[t('inputLabel'), current.input], [t('operationLabel'), current.operation], [t('outputLabel'), current.output]].map(([label, value]) =>
        <div key={label}><dt>{label}</dt><dd><Markdown>{value}</Markdown></dd></div>)}</dl>
    </div>}
    evidence={<>
      {implementation}
      {current.snippet && <details key={current.id}><summary>{t('viewSnippet')}</summary><pre className="file-code">{current.snippet}</pre></details>}
      {evidence}
      {!implementation && !current.snippet && !evidence && <p className="muted">{t('noStepEvidence')}</p>}
    </>}
    save={onTool ? <div className="actions"><button type="button" onClick={() => onTool([current.title, current.operation].join('\n'),
      { repoId: repo?.id, file: current.evidence?.[0]?.file || current.code?.file })}>{t('askStep')}</button></div>
      : <p className="muted">{t('cannotAskStep')}</p>}/>;
}

function FlowMap({ graph, active, onSelect, playing, repository }) {
  const { t } = useLocale();
  const arrow = useId();
  const frame = useRef(null);
  const stages = [...new Set(graph.nodes.map(node => node.stage))].sort((a, b) => a - b);
  const lanes = stages.map(stage => graph.nodes.filter(node => node.stage === stage));
  const width = lanes.length * 178 + 16;
  const height = Math.max(...lanes.map(lane => lane.length)) * 84 + 24;
  const positions = new Map(lanes.flatMap((lane, col) => lane.map((node, row) =>
    [node.id, { x: col * 178 + 16, y: (height - lane.length * 84) / 2 + row * 84 + 12 }])));
  const incoming = graph.edges.filter(edge => edge.to === active?.id);
  const outgoing = graph.edges.filter(edge => edge.from === active?.id);
  const activeX = positions.get(active.id).x;
  useEffect(() => {
    const region = frame.current;
    if (activeX < region.scrollLeft || activeX + 138 > region.scrollLeft + region.clientWidth) {
      region.scrollLeft = activeX - 12;
    }
  }, [activeX]);
  return <>
    <div className="flow-frame" ref={frame} tabIndex={0} role="region" aria-label={repository ? t('repoFlowAria') : t('paperFlowAria')}>
      <div className="flow-canvas" style={{ width, height }}>
        <svg width={width} height={height} aria-hidden="true">
          <defs><marker id={arrow} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
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
            return <g key={index}><path d={path} fill="none" stroke={live ? 'var(--accent)' : 'var(--line-strong)'} strokeWidth={live ? 2.5 : 1.4}
              markerEnd={`url(#${arrow})`}><title>{edge.label}</title></path>
              {playing && edge.from === active?.id && <path className="animated-flow-edge" d={path} pathLength="100" fill="none"
                stroke="var(--signal)" strokeWidth="3.5" strokeDasharray="11 89"/>}</g>;
          })}
        </svg>
        {graph.nodes.map(node => {
          const point = positions.get(node.id);
          return <button key={node.id} title={node.title} className="flow-node" aria-pressed={node.id === active?.id}
            style={{ left: point.x, top: point.y }} onClick={() => onSelect(node.id)}><span>{node.title}</span></button>;
        })}
      </div>
    </div>
    <div className="flow-neighbors" aria-label={t('neighborModules')}>
      {[[incoming, repository ? t('previousRepoStep') : t('upstream'), 'from'], [outgoing, repository ? t('nextRepoStep') : t('downstream'), 'to']].map(([edges, label, field]) => edges.length > 0 &&
        <div className="actions" key={label}><span>{label}</span>{edges.map((edge, index) => <button key={index}
          onClick={() => onSelect(edge[field])}>{graph.nodes.find(node => node.id === edge[field]).title}
          {edge.label && <small>{edge.label}</small>}</button>)}</div>)}
    </div>
  </>;
}

function ExperimentTable({ table, name, evidence, onAsk }) {
  const { t } = useLocale();
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
  const blank = value => value ?? t('unconfirmed');
  return <ReadingCard className="experiment-table" label={t('experimentCard')} kicker={t('reportedResults', { name })} title={table.title}
    intro={<Markdown>{table.claim}</Markdown>}
    actions={<div className="actions experiment-controls">
      <label>{t('datasetOrTask')}<select value={dataset} onChange={event => { setDataset(event.target.value); setComparison([]); }}>
        <option value="">{t('allDatasets')}</option>{datasets.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>{t('compareMetric')}<select value={metric} onChange={event => setMetric(Number(event.target.value))}>
        {table.columns.map((item, index) => <option key={item.id} value={index}>{item.label}</option>)}</select></label>
      <label>{t('sortLabel')}<select value={sortable ? sort : 'original'} disabled={!sortable}
        title={sortable ? undefined : t('sortNeedsDataset')} onChange={event => setSort(event.target.value)}>
        <option value="original">{t('paperOrder')}</option><option value="desc">{t('sortDesc')}</option><option value="asc">{t('sortAsc')}</option></select></label>
    </div>}
    result={<>
      <div className="markdown-table experiment-scroll" tabIndex={0} role="region" aria-label={table.title}>
        <table><thead><tr><th scope="col">{t('comparison')}</th><th scope="col">{t('methodColumn')}</th><th scope="col">{t('datasetColumn')}</th><th scope="col">{t('experimentCondition')}</th>
          {table.columns.map(item => <th scope="col" key={item.id}>{item.label}{item.unit && ' (' + item.unit + ')'}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.index} data-selected={comparison.includes(row.index)}>
            <td><input type="checkbox" aria-label={t('compareRow', { method: row.method, dataset: row.dataset, condition: row.condition ? ' ' + row.condition : '' })}
              checked={comparison.includes(row.index)} onChange={event => setComparison(current => event.target.checked
                ? [...current.slice(-1), row.index] : current.filter(index => index !== row.index))}/></td>
            <th scope="row">{row.method}</th><td>{row.dataset}</td><td>{row.condition || '—'}</td>
            {row.values.map((item, index) => <td key={index} data-metric={index === metric}>{blank(item)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {chosen.length === 2 && <div className="experiment-compare" role="status">
        {chosen.map(row => <div key={row.index}><strong>{row.method}</strong><span>{row.condition || row.dataset}</span><b>{blank(row.values[metric])}</b></div>)}
        {difference !== null && <p>{t('metricDifference', { label: column.label, value: difference, unit: column.unit ? ' ' + column.unit : '' })}</p>}
        {difference === null && <p>{t('differenceNeedsData')}</p>}
      </div>}
      <details><summary>{t('comparisonLimits')}</summary><Markdown>{table.limitation}</Markdown></details>
      {table.omitted > 0 && <p className="muted">{t('omittedValues', { count: table.omitted })}</p>}
    </>}
    evidence={evidence || <p className="muted">{t('noComparisonEvidence')}</p>}
    save={onAsk ? <div className="actions"><button type="button" className="figure-question" onClick={onAsk}>{t('askFigure')}</button></div>
      : <p className="muted">{t('cannotAskComparison')}</p>}/>;
}

function SourcePreview({ source, jobId }) {
  const { t } = useLocale();
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
    <summary><BookOpen size={15}/>{t('sourceOriginal', { kind: source.type === 'table' ? t('sourceTable') : t('sourceFigure'), number: source.number, page: source.page })}</summary>
    {open && <div>
      <p>{source.caption}</p>
      {state.url ? <img src={state.url} alt={source.caption}/> : <p role="status" className="muted">{state.error || t('loadingLocalFigure')}</p>}
    </div>}
  </details>;
}
