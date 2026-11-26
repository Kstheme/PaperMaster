import React, { useEffect, useState } from 'react';
import { api, download } from './api.js';
import { groupMethodRecords } from './method-groups.js';
import { ConnectionPicker, EvidenceLinks, paperMatches, useAction } from './workbench-fields.jsx';
import { evidenceHref, paperLocation } from '../server/evidence.js';

const labels = { name: '方法名', problem: '解决的问题', pipeline: '方法流程', conditions: '适用条件' };
const states = { known: '已记录', pending: '待核实', unreported: '论文未说明', not_applicable: '不适用' };
const outcomes = { effective: '有效', no_improvement: '无明显改善', failure: '失败' };
const fields = Object.entries(labels);
const identify = paper => paper.title + ' · ' + paper.version;

export function MethodWorkspace({ library, defaultConnection, onError }) {
  const [list, setList] = useState([]);
  const [table, setTable] = useState(null);
  const [title, setTitle] = useState('');
  const [run, busy] = useAction(onError);
  useEffect(() => {
    let ignore = false;
    api('method-tables').then(items => {
      if (ignore) return;
      setList(items);
      if (items[0]) api('method-tables/' + items[0].id).then(value => { if (!ignore) setTable(value); }).catch(error => {
        if (!ignore) onError(error.message);
      });
    }).catch(error => { if (!ignore) onError(error.message); });
    return () => { ignore = true; };
  }, [onError]);
  function change(next) {
    setTable(next);
    setList(items => [{ id: next.id, title: next.title, count: next.rows.length }, ...items.filter(item => item.id !== next.id)]);
  }
  return <div className="method-workspace">
    <header className="paper-header"><h1>主题方法表</h1></header>
    <section className="panel method-switcher">
      {list.length > 0 && <label>打开方法表<select value={table?.id || ''} onChange={event => {
        const id = event.target.value;
        run(async () => setTable(await api('method-tables/' + id)));
      }} disabled={busy}>
        <option value="" disabled>选择一张方法表</option>
        {list.map(item => <option key={item.id} value={item.id}>{item.title} · {item.count} 条</option>)}
      </select></label>}
      <form className="input-row" onSubmit={event => {
        event.preventDefault();
        run(async () => {
          change(await api('method-tables', { method: 'POST', json: { title } }));
          setTitle('');
        });
      }}>
        <label>新研究主题<input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} required placeholder="例如：几何推理"/></label>
        <button className="primary" disabled={busy}>创建方法表</button>
      </form>
    </section>
    {table && <TableEditor key={table.id} table={table} onChange={change} {...{ library, defaultConnection, onError }}/>}
  </div>;
}

function TableEditor({ table, onChange, library, defaultConnection, onError }) {
  const [connection, setConnection] = useState(defaultConnection || library.defaultConnection);
  const [query, setQuery] = useState('');
  const [topicScope, setTopicScope] = useState('');
  const [selected, setSelected] = useState([]);
  const [draft, setDraft] = useState(null);
  const [choices, setChoices] = useState({});
  const [deliveries, setDeliveries] = useState([]);
  const [included, setIncluded] = useState({});
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [run, busy] = useAction(onError);
  const root = 'method-tables/' + table.id;
  useEffect(() => {
    let ignore = false;
    api(root + '/deliveries').then(items => { if (!ignore) setDeliveries(items); })
      .catch(error => { if (!ignore) onError(error.message); });
    return () => { ignore = true; };
  }, [root, onError]);

  function choose(candidate, changes) {
    setChoices(current => ({ ...current, [candidate.id]: { ...current[candidate.id], ...changes } }));
  }
  function requestCandidates(event) {
    event.preventDefault();
    run(async () => {
      const next = await api(root + '/candidates', { method: 'POST', json: { papers: selected, connectionId: connection, topicScope } });
      setChoices(Object.fromEntries(next.rows.map(row => {
        const match = table.rows.find(item => item.id === row.matchId);
        const suggested = Object.fromEntries(fields.filter(([key]) => !match?.fields[key].text && row.fields[key].text).map(([key]) => [key, 'adopt']));
        return [row.id, { included: true, targetId: row.matchId || '', relatedId: row.relatedId || '', fields: suggested, carry: [] }];
      })));
      setDraft(next);
      setMessage(next.rows.length ? '' : '所选论文中没有找到机制与前提匹配、且有可核查出处的元方法候选。');
    });
  }
  function updateTable(updated) {
    onChange(updated);
    setPreview(null);
  }
  function applyCandidates() {
    run(async () => {
      const items = Object.entries(choices).filter(([, item]) => item.included).map(([id, item]) => ({ ...item, id }));
      updateTable(await api(root + '/apply', { method: 'POST', json: { token: draft.token, items } }));
      setDraft(null);
      setSelected([]);
      setMessage('已应用所选候选行。');
    });
  }
  function previewDelivery() {
    run(async () => {
      const items = Object.entries(included).map(([id, includeIdea]) => ({ id, includeIdea }));
      const request = { items, revision: table.revision };
      const selected = await api(root + '/delivery-preview', { method: 'POST', json: request });
      setPreview({ ...selected, request, snapshotId: crypto.randomUUID() });
    });
  }
  function confirmDelivery() {
    run(async () => {
      const saved = await api(root + '/deliveries', { method: 'POST',
        json: { ...preview.request, snapshotId: preview.snapshotId, confirmed: true } });
      setDeliveries(items => [saved, ...items.filter(item => item.id !== saved.id)]);
      setPreview(null);
      setMessage('交付快照已生成，可以选择导出格式。');
    });
  }
  function exportDelivery(snapshot, format) {
    run(async () => {
      const file = await api(root + '/download/' + snapshot.id + '?format=' + format, { blob: true });
      download(file, table.title + '-' + snapshot.id.slice(0, 8) + (format === 'markdown' ? '.md' : '.json'));
    });
  }
  function toggleIncluded(row, checked) {
    setPreview(null);
    setIncluded(current => {
      const next = { ...current };
      if (checked) next[row.id] = false;
      else delete next[row.id];
      return next;
    });
  }
  function toggleIdea(row, checked) {
    setPreview(null);
    setIncluded({ ...included, [row.id]: checked });
  }
  function removeRow(row) {
    if (!confirm('从方法表删除「' + row.fields.name.text + '」？已确认的交付快照会保留。')) return;
    run(async () => {
      updateTable(await api(root + '/rows/' + row.id, { method: 'DELETE', json: { revision: table.revision } }));
      setIncluded(current => { const next = { ...current }; delete next[row.id]; return next; });
      setDraft(null);
      setMessage('已从当前方法表删除该方法。');
    });
  }
  function submitRow(row, data) {
    return run(async () => {
      updateTable(await api(root + '/rows/' + row.id, { method: 'PATCH', json: { ...data, revision: table.revision } }));
      setMessage('已保存方法行。');
      return true;
    });
  }

  return <>
    <section className="panel">
      <h2>{table.title}</h2>
      <form className="settings-form" onSubmit={requestCandidates}>
        <label>这次要解决的研究问题（可选）
          <textarea rows={2} maxLength={1200} value={topicScope} onChange={event => setTopicScope(event.target.value)}
            placeholder="例如：只找缩小几何搜索范围的方法，排除通用训练技巧和实验基线。"/></label>
        <div className="input-row">
          <label>查找论文<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="标题、arXiv ID 或链接"/></label>
          <ConnectionPicker library={library} value={connection} onChange={setConnection}/>
        </div>
        <fieldset><legend>选择论文版本</legend>
          <div className="method-paper-list">{library.papers.filter(paper => paperMatches(paper, query)).map(paper =>
            <div key={paper.id}>
              <strong>{paper.title}</strong>
              <div className="actions">{[...paper.versions].reverse().map(version => <label className="check" key={version.id}>
                <input type="checkbox" checked={selected.some(item => item.versionId === version.id)} onChange={event => {
                  const checked = event.target.checked;
                  setSelected(items => checked ? [...items, { id: paper.id, versionId: version.id }] : items.filter(item => item.versionId !== version.id));
                }}/>{version.arxivVersion || version.name}
              </label>)}</div>
            </div>)}</div>
        </fieldset>
        <div className="actions"><button className="primary" disabled={busy || !selected.length || selected.length > 12 || !connection}>
          {busy ? '正在处理…' : '生成候选行'}</button><span className="muted">已选 {selected.length} 个版本（最多 12 个）</span></div>
      </form>
    </section>

    {!!draft?.rows.length && <section className="panel">
      <h2>候选预览</h2>
      {draft.rows.map(candidate => <Candidate key={candidate.id} candidate={candidate} table={table} batch={draft.rows} choice={choices[candidate.id]}
        onChoice={updates => choose(candidate, updates)}/>)}
      <div className="actions"><button className="primary" disabled={busy || !Object.values(choices).some(choice => choice.included)}
        onClick={applyCandidates}>确认应用</button><button disabled={busy} onClick={() => setDraft(null)}>取消预览</button></div>
    </section>}

    <section className="panel">
      <div className="row-between">
        <h2>方法对照</h2>
        <button disabled={busy || Object.keys(included).length === 0} onClick={previewDelivery}>预览交付</button>
      </div>
      {!table.rows.length && <p className="muted">确认候选后，方法会出现在这里。</p>}
      {groupMethodRecords(table.rows).map((group, index) => group.kind === 'meta'
        ? <MetaMethodGroup key={group.key} group={group} headingId={'method-group-' + index} included={included} busy={busy}
          onToggleIncluded={toggleIncluded} onToggleIdea={toggleIdea} onRemove={removeRow} onSubmit={submitRow}/>
        : <LegacyMethodTable key="legacy" rows={group.rows} included={included} busy={busy}
          onToggleIncluded={toggleIncluded} onToggleIdea={toggleIdea} onRemove={removeRow} onSubmit={submitRow}/>)}
      {message && <p role="status" className="message">{message}</p>}
    </section>

    {preview && <section className="panel" aria-label="确认交付">
      <h2>确认交付 · {preview.rows.length} 条</h2>
      <p className="muted">笔记 Markdown 与 Auto Research JSON 都来自这次确认。确认之后再改方法表，这份快照保持不变。</p>
      {preview.rows.some(row => row.metaMethod && row.practice) && <p className="muted">
        这份快照提供具体做法、元方法、适用前提、结果和出处，供下游评估迁移。目标任务、结果预测和实验设计由下游完成。</p>}
      {preview.rows.map(row => <details key={row.id} open className="method-option">
        <summary>{row.fields.name.text} · {identify(row.paper)}{row.experiment ? ' · ' + (outcomes[row.experiment.outcome] || row.experiment.outcome) : ''}{row.effectCheck && !row.experiment ? ' · ' + row.effectCheck : ''}</summary>
        <MethodEvidence row={row}/>
        <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd><FieldValue field={row.fields[key]}/></dd></div>)}</dl>
        {row.idea && <p>迁移设想 · {row.idea}</p>}
      </details>)}
      <div className="actions"><button className="primary" disabled={busy} onClick={confirmDelivery}>确认交付</button>
        <button disabled={busy} onClick={() => setPreview(null)}>取消</button></div>
    </section>}

    {!!deliveries.length && <section className="panel">
      <h2>交付快照</h2>
      {deliveries.map(item => <div className="row-between snapshot" key={item.id}>
        <div><strong>{new Date(item.confirmedAt).toLocaleString()}</strong><p className="muted">{item.id.slice(0, 8)} · {item.count ?? item.rows.length} 条</p></div>
        <div className="actions"><button disabled={busy} onClick={() => exportDelivery(item, 'markdown')}>笔记导出</button>
          <button disabled={busy} onClick={() => exportDelivery(item, 'json')}>Auto Research 导出</button></div>
      </div>)}
    </section>}
  </>;
}

function MetaMethodGroup({ group, headingId, included, busy, onToggleIncluded, onToggleIdea, onRemove, onSubmit }) {
  return <section className="meta-method-group" aria-labelledby={headingId}>
    <h3 id={headingId}>元方法</h3>
    <dl className="meta-method-summary">
      <div><dt>结构性问题</dt><dd>{group.structuralProblem}</dd></div>
      <div><dt>作用机制</dt><dd>{group.mechanism}</dd></div>
    </dl>
    <div className="method-compare" role="region" tabIndex={0} aria-label={'元方法对照 · ' + group.mechanism}>
      <table>
        <thead><tr>
          <th scope="col">对照</th>
          {group.rows.map(row => <th key={row.id} scope="col">{row.fields.name.text}</th>)}
        </tr></thead>
        <tbody>
          <tr>
            <th scope="row">具体做法</th>
            {group.rows.map(row => <td key={row.id}>{row.practice ? <FieldValue field={row.practice}/> : <p className="muted">未记录</p>}</td>)}
          </tr>
          <tr>
            <th scope="row">适用前提</th>
            {group.rows.map(row => <td key={row.id}>{row.metaMethod.conditions ? <FieldValue field={row.metaMethod.conditions}/> : <p className="muted">未记录</p>}</td>)}
          </tr>
          <tr>
            <th scope="row">结果</th>
            {group.rows.map(row => <td key={row.id}><ResultCell row={row}/></td>)}
          </tr>
          <tr>
            <th scope="row">出处</th>
            {group.rows.map(row => <td key={row.id}>
              <a href={evidenceHref(paperLocation(row.paper))} target="_blank" rel="noreferrer">{identify(row.paper)}</a>
              {row.relatedId && <p className="muted">有可对照的旧版本</p>}
            </td>)}
          </tr>
          <tr>
            <th scope="row">迁移设想</th>
            {group.rows.map(row => <td key={row.id}>{row.idea && <><p>{row.idea}</p>{Object.hasOwn(included, row.id) && <label className="check">
              <input type="checkbox" checked={included[row.id]} onChange={event => onToggleIdea(row, event.target.checked)}/>一并交付</label>}</>}</td>)}
          </tr>
          <tr>
            <th scope="row">交付</th>
            {group.rows.map(row => <td key={row.id}>
              <label className="check"><input type="checkbox" aria-label={'交付 ' + row.fields.name.text} checked={Object.hasOwn(included, row.id)}
                onChange={event => onToggleIncluded(row, event.target.checked)}/>选入交付</label>
              <RowEditor row={row} disabled={busy} onRemove={() => onRemove(row)} onSubmit={data => onSubmit(row, data)}/>
            </td>)}
          </tr>
        </tbody>
      </table>
    </div>
  </section>;
}

function ResultCell({ row }) {
  if (row.experiment) return <>
    <p className="method-outcome" data-outcome={row.experiment.outcome}>{outcomes[row.experiment.outcome] || row.experiment.outcome}</p>
    <ExperimentReview experiment={row.experiment}/>
  </>;
  if (row.effectCheck) return <p className="method-unverified">{row.effectCheck}</p>;
  return <p className="muted">未记录结果</p>;
}

function LegacyMethodTable({ rows, included, busy, onToggleIncluded, onToggleIdea, onRemove, onSubmit }) {
  return <section className="meta-method-group" aria-label="尚未提炼元方法">
    <h3>尚未提炼元方法</h3>
    <p className="muted">这些记录只有原有字段，仍可查看、编辑和交付。</p>
    <div className="method-matrix" role="region" tabIndex={0} aria-label="尚未提炼元方法">
      <table>
        <thead><tr><th scope="col">交付</th><th scope="col">论文版本</th>{fields.map(([key, label]) => <th key={key} scope="col">{label}</th>)}
          <th scope="col">迁移设想</th><th scope="col">编辑</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <td><input type="checkbox" aria-label={'交付 ' + row.fields.name.text} checked={Object.hasOwn(included, row.id)}
            onChange={event => onToggleIncluded(row, event.target.checked)}/></td>
          <td><a href={evidenceHref(paperLocation(row.paper))} target="_blank" rel="noreferrer">{identify(row.paper)}</a>
            {row.relatedId && <p className="muted">有可对照的旧版本</p>}</td>
          {fields.map(([key]) => <td key={key}><FieldValue field={row.fields[key]}/></td>)}
          <td>{row.idea && <><p>{row.idea}</p>{Object.hasOwn(included, row.id) && <label className="check">
            <input type="checkbox" checked={included[row.id]} onChange={event => onToggleIdea(row, event.target.checked)}/>一并交付</label>}</>}</td>
          <td><RowEditor row={row} disabled={busy} onRemove={() => onRemove(row)} onSubmit={data => onSubmit(row, data)}/></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function MethodEvidence({ row }) {
  const meta = row.metaMethod;
  if (!meta?.structuralProblem || !meta.mechanism || !meta.conditions || !row.practice) return null;
  return <div className="method-fields">
    <section><h4>结构性问题</h4><FieldValue field={meta.structuralProblem}/></section>
    <section><h4>作用机制</h4><FieldValue field={meta.mechanism}/></section>
    <section><h4>适用前提</h4><FieldValue field={meta.conditions}/></section>
    <section><h4>具体做法</h4><FieldValue field={row.practice}/></section>
    {row.experiment && <section><h4>实验记录</h4><ExperimentReview experiment={row.experiment}/></section>}
    {row.effectCheck && !row.experiment && <section><h4>效果验证</h4><p>{row.effectCheck}</p></section>}
  </div>;
}

function ExperimentReview({ experiment }) {
  return <dl>
    <div><dt>指标</dt><dd><FieldValue field={experiment.metric}/></dd></div>
    <div><dt>对照</dt><dd><FieldValue field={experiment.comparison}/></dd></div>
    <div><dt>数据或条件</dt><dd><FieldValue field={experiment.data}/></dd></div>
    <div><dt>结果</dt><dd><FieldValue field={experiment.result}/></dd></div>
    <div><dt>结论</dt><dd>{outcomes[experiment.outcome] || experiment.outcome}</dd></div>
  </dl>;
}

function FieldValue({ field }) {
  return <>{field.text && <p className="method-cell-text">{field.text}</p>}
    {field.state !== 'known' && <small className="muted">{states[field.state]}</small>}
    <EvidenceLinks items={field.evidence}/></>;
}

function FieldEdit({ label, value, onChange, baseline }) {
  return <div className="method-field">
    <label>{label}<textarea rows={2} maxLength={1600} value={value.text} onChange={event => onChange({ ...value, text: event.target.value })}/></label>
    <label>证据状态<select value={value.state} onChange={event => onChange({ ...value, state: event.target.value })}>
      {Object.entries(states).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label>
    {!!baseline.evidence.length && value.text !== baseline.text && <label className="check">
      <input type="checkbox" checked={value.keepEvidence === true} onChange={event => onChange({ ...value, keepEvidence: event.target.checked })}/>
      我已核实，保留现有出处</label>}
  </div>;
}

function Candidate({ candidate, table, batch, choice, onChoice }) {
  const same = table.rows.filter(row => row.paper.paperId === candidate.paper.paperId && row.paper.versionId === candidate.paper.versionId);
  const versions = [...table.rows, ...batch.filter(row => !row.matchId)].filter(row => row.paper.paperId === candidate.paper.paperId &&
    row.paper.versionId !== candidate.paper.versionId);
  const target = same.find(row => row.id === choice.targetId);
  const related = versions.find(row => row.id === choice.relatedId);
  return <details className="method-option" open>
    <summary>{candidate.fields.name.text} · {identify(candidate.paper)} · {target ? '建议更新' : related ? '关联版本' : '新增候选'}</summary>
    <p>与本主题的关系 · {candidate.topicReason}</p>
    <EvidenceLinks items={candidate.topicEvidence}/>
    <MethodEvidence row={candidate}/>
    <label className="check"><input type="checkbox" checked={choice.included} onChange={event => onChoice({ included: event.target.checked })}/>应用此候选</label>
    {!!same.length && <label>更新到<select value={choice.targetId} onChange={event => onChoice({ targetId: event.target.value, fields: {} })}>
      <option value="">新增方法行</option>{same.map(row => <option key={row.id} value={row.id}>{row.fields.name.text}</option>)}</select></label>}
    {!target && !!versions.length && <label>与另一论文版本关联<select value={choice.relatedId} onChange={event => onChoice({ relatedId: event.target.value, carry: [] })}>
      <option value="">独立方法</option>{versions.map(row => <option key={row.id} value={row.id}>{row.fields.name.text} · {row.paper.version}</option>)}</select></label>}
    <div className="method-fields">{fields.map(([key, label]) => {
      const baseline = target?.fields[key];
      const change = choice.fields[key];
      return <section key={key}>
        <h4>{label}</h4>
        {baseline && <div className="field-diff"><div><small>当前</small><FieldValue field={baseline}/></div>
          <div><small>建议</small><FieldValue field={candidate.fields[key]}/></div></div>}
        {!baseline && <FieldValue field={candidate.fields[key]}/>}
        {baseline && <label>处理方式<select value={typeof change === 'object' ? 'edit' : change || 'keep'} onChange={event => {
          const value = event.target.value;
          onChoice({ fields: { ...choice.fields, [key]: value === 'edit' ? { ...baseline } : value } });
        }}><option value="keep">保留当前</option><option value="adopt">采用建议</option><option value="edit">手动改写</option></select></label>}
        {baseline && typeof change === 'object' && <FieldEdit label={'改写' + label} value={change} baseline={baseline}
          onChange={next => onChoice({ fields: { ...choice.fields, [key]: next } })}/>}
        {related && !target && table.rows.includes(related) && key !== 'name' && related.fields[key].text && <label className="check"><input type="checkbox"
          checked={choice.carry.includes(key)} onChange={event => onChoice({ carry: event.target.checked ? [...choice.carry, key] : choice.carry.filter(item => item !== key) })}/>
          带入旧版文字并标为待核实</label>}
      </section>;
    })}</div>
    {candidate.idea && <p>迁移设想 · {candidate.idea}</p>}
    {target && candidate.idea && <label className="check"><input type="checkbox" checked={choice.adoptIdea === true}
      onChange={event => onChoice({ adoptIdea: event.target.checked })}/>采用候选迁移设想</label>}
  </details>;
}

function RowEditor({ row, disabled, onSubmit, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  return <>
    <div className="actions">
      <button disabled={disabled} onClick={() => { setDraft({ fields: row.fields, idea: row.idea }); setEditing(true); }}>编辑</button>
      <button disabled={disabled} onClick={onRemove}>删除</button>
    </div>
    {editing && <form className="method-row-editor" onSubmit={async event => {
      event.preventDefault();
      if (await onSubmit(draft)) setEditing(false);
    }}>
      {fields.map(([key, label]) => <FieldEdit key={key} label={label} value={draft.fields[key]} baseline={row.fields[key]}
        onChange={value => setDraft({ ...draft, fields: { ...draft.fields, [key]: value } })}/>)}
      <label>迁移设想<textarea rows={2} maxLength={1200} value={draft.idea} onChange={event => setDraft({ ...draft, idea: event.target.value })}/></label>
      <div className="actions"><button className="primary" disabled={disabled}>保存</button>
        <button type="button" disabled={disabled} onClick={() => setEditing(false)}>取消</button></div>
    </form>}
  </>;
}
