import React, { useEffect, useState } from 'react';
import { api, download } from './api.js';
import { useLocale } from './locale.jsx';
import { ConnectionPicker, EvidenceLinks, paperMatches, useAction } from './workbench-fields.jsx';
import { evidenceHref, paperLocation } from '../server/evidence.js';

const fieldKeys = ['name', 'problem', 'pipeline', 'conditions'];
const identify = paper => paper.title + ' · ' + paper.version;
const storedUnverifiedEffect = '原论文未验证效果';

function useMethodText() {
  const { t } = useLocale();
  const labels = {
    name: t('methodName'),
    problem: t('methodProblem'),
    pipeline: t('methodPipeline'),
    conditions: t('methodConditions'),
  };
  const states = {
    known: t('stateKnown'),
    pending: t('statePending'),
    unreported: t('stateUnreported'),
    not_applicable: t('stateNotApplicable'),
  };
  const outcomes = {
    effective: t('outcomeEffective'),
    no_improvement: t('outcomeNoImprovement'),
    failure: t('outcomeFailure'),
  };
  return { t, labels, states, outcomes, fields: fieldKeys.map(key => [key, labels[key]]) };
}

export function MethodWorkspace({ library, defaultConnection, onError }) {
  const [list, setList] = useState([]);
  const [table, setTable] = useState(null);
  const [title, setTitle] = useState('');
  const [run, busy] = useAction(onError);
  const { t } = useLocale();
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
    <header className="paper-header"><h1>{t('methodTables')}</h1></header>
    <section className="panel method-switcher">
      {list.length > 0 && <label>{t('methodOpen')}<select value={table?.id || ''} onChange={event => {
        const id = event.target.value;
        run(async () => setTable(await api('method-tables/' + id)));
      }} disabled={busy}>
        <option value="" disabled>{t('methodChoose')}</option>
        {list.map(item => <option key={item.id} value={item.id}>{item.title} · {t('methodCount', { count: item.count })}</option>)}
      </select></label>}
      <form className="input-row" onSubmit={event => {
        event.preventDefault();
        run(async () => {
          change(await api('method-tables', { method: 'POST', json: { title } }));
          setTitle('');
        });
      }}>
        <label>{t('newTopic')}<input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} required placeholder={t('topicPlaceholder')}/></label>
        <button className="primary" disabled={busy}>{t('createMethodTable')}</button>
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
  const { t, fields } = useMethodText();
  const connectionLabels = { label: t('connection'), placeholder: t('chooseConnection'), localModel: t('localModel') };
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
        const suggested = Object.fromEntries(fieldKeys.filter(key => !match?.fields[key].text && row.fields[key].text).map(key => [key, 'adopt']));
        return [row.id, { included: true, targetId: row.matchId || '', relatedId: row.relatedId || '', fields: suggested, carry: [] }];
      })));
      setDraft(next);
      setMessage(next.rows.length ? '' : 'methodNone');
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
      setMessage('methodApplied');
    });
  }
  function previewDelivery() {
    run(async () => {
      const items = Object.entries(included).map(([id, includeIdea]) => ({ id, includeIdea }));
      const request = { items, revision: table.revision };
      const selectedRows = await api(root + '/delivery-preview', { method: 'POST', json: request });
      setPreview({ ...selectedRows, request, snapshotId: crypto.randomUUID() });
    });
  }
  function confirmDelivery() {
    run(async () => {
      const saved = await api(root + '/deliveries', { method: 'POST',
        json: { ...preview.request, snapshotId: preview.snapshotId, confirmed: true } });
      setDeliveries(items => [saved, ...items.filter(item => item.id !== saved.id)]);
      setPreview(null);
      setMessage('methodDelivered');
    });
  }
  function exportDelivery(snapshot, format) {
    run(async () => {
      const file = await api(root + '/download/' + snapshot.id + '?format=' + format, { blob: true });
      download(file, table.title + '-' + snapshot.id.slice(0, 8) + (format === 'markdown' ? '.md' : '.json'));
    });
  }

  return <>
    <section className="panel">
      <h2>{table.title}</h2>
      <form className="settings-form" onSubmit={requestCandidates}>
        <label>{t('topicQuestion')}
          <textarea rows={2} maxLength={1200} value={topicScope} onChange={event => setTopicScope(event.target.value)}
            placeholder={t('topicQuestionPlaceholder')}/></label>
        <div className="input-row">
          <label>{t('findPaper')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('findPaperPlaceholder')}/></label>
          <ConnectionPicker library={library} value={connection} onChange={setConnection} {...connectionLabels}/>
        </div>
        <fieldset><legend>{t('chooseVersions')}</legend>
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
          {busy ? t('methodBusy') : t('generateCandidates')}</button><span className="muted">{t('versionsSelected', { count: selected.length })}</span></div>
      </form>
    </section>

    {!!draft?.rows.length && <section className="panel">
      <h2>{t('candidatePreview')}</h2>
      {draft.rows.map(candidate => <Candidate key={candidate.id} candidate={candidate} table={table} batch={draft.rows} choice={choices[candidate.id]}
        onChoice={updates => choose(candidate, updates)}/>)}
      <div className="actions"><button className="primary" disabled={busy || !Object.values(choices).some(choice => choice.included)}
        onClick={applyCandidates}>{t('confirmApply')}</button><button disabled={busy} onClick={() => setDraft(null)}>{t('cancelPreview')}</button></div>
    </section>}

    <section className="panel">
      <div className="row-between">
        <h2>{t('methodComparison')}</h2>
        <button disabled={busy || Object.keys(included).length === 0} onClick={previewDelivery}>{t('previewDelivery')}</button>
      </div>
      {!table.rows.length && <p className="muted">{t('methodsAppearHere')}</p>}
      {!!table.rows.length && <div className="method-matrix" role="region" tabIndex={0} aria-label={t('methodMatrix')}>
        <table>
          <thead><tr><th scope="col">{t('deliver')}</th><th scope="col">{t('paperVersionColumn')}</th>{fields.map(([key, label]) => <th key={key} scope="col">{label}</th>)}
            <th scope="col">{t('transferIdea')}</th><th scope="col">{t('editColumn')}</th></tr></thead>
          <tbody>{table.rows.map(row => <React.Fragment key={row.id}>
          <tr>
            <td><input type="checkbox" aria-label={t('deliverNamed', { name: row.fields.name.text })} checked={Object.hasOwn(included, row.id)} onChange={event => {
              setPreview(null);
              const checked = event.target.checked;
              setIncluded(current => {
                const next = { ...current };
                if (checked) next[row.id] = false;
                else delete next[row.id];
                return next;
              });
            }}/></td>
            <td><a href={evidenceHref(paperLocation(row.paper))} target="_blank" rel="noreferrer">{identify(row.paper)}</a>
              {row.relatedId && <p className="muted">{t('relatedVersion')}</p>}</td>
            {fields.map(([key]) => <td key={key}><FieldValue field={row.fields[key]}/></td>)}
            <td>{row.idea && <><p>{row.idea}</p>{Object.hasOwn(included, row.id) && <label className="check">
              <input type="checkbox" checked={included[row.id]} onChange={event => {
                setPreview(null);
                setIncluded({ ...included, [row.id]: event.target.checked });
              }}/>{t('includeIdea')}</label>}</>}</td>
            <td><RowEditor row={row} disabled={busy} onRemove={() => {
              if (!confirm(t('methodDeleteConfirm', { name: row.fields.name.text }))) return;
              run(async () => {
                updateTable(await api(root + '/rows/' + row.id, { method: 'DELETE', json: { revision: table.revision } }));
                setIncluded(current => { const next = { ...current }; delete next[row.id]; return next; });
                setDraft(null);
                setMessage('methodDeleted');
              });
            }} onSubmit={data => run(async () => {
              updateTable(await api(root + '/rows/' + row.id, { method: 'PATCH', json: { ...data, revision: table.revision } }));
              setMessage('methodRowSaved');
              return true;
            })}/></td>
          </tr>
          {row.metaMethod && <tr><td colSpan={8}><MethodEvidence row={row}/></td></tr>}
          </React.Fragment>)}</tbody>
        </table>
      </div>}
      {message && <p role="status" className="message">{t(message)}</p>}
    </section>

    {preview && <section className="panel">
      <h2>{t('confirmDeliveryCount', { count: preview.rows.length })}</h2>
      {preview.rows.map(row => <details key={row.id} open className="method-option">
        <summary>{row.fields.name.text} · {identify(row.paper)}</summary>
        <dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd><FieldValue field={row.fields[key]}/></dd></div>)}</dl>
        {row.idea && <p>{t('ideaLine', { idea: row.idea })}</p>}
      </details>)}
      <div className="actions"><button className="primary" disabled={busy} onClick={confirmDelivery}>{t('confirmDelivery')}</button>
        <button disabled={busy} onClick={() => setPreview(null)}>{t('cancel')}</button></div>
    </section>}

    {!!deliveries.length && <section className="panel">
      <h2>{t('deliverySnapshots')}</h2>
      {deliveries.map(item => <div className="row-between snapshot" key={item.id}>
        <div><strong>{new Date(item.confirmedAt).toLocaleString()}</strong><p className="muted">{item.id.slice(0, 8)} · {t('methodCount', { count: item.count ?? item.rows.length })}</p></div>
        <div className="actions"><button disabled={busy} onClick={() => exportDelivery(item, 'markdown')}>{t('exportNote')}</button>
          <button disabled={busy} onClick={() => exportDelivery(item, 'json')}>{t('exportAutoResearch')}</button></div>
      </div>)}
    </section>}
  </>;
}

function MethodEvidence({ row }) {
  const { t } = useLocale();
  const meta = row.metaMethod;
  if (!meta?.structuralProblem || !meta.mechanism || !meta.conditions || !row.practice) return null;
  const effect = row.effectCheck === storedUnverifiedEffect ? t('unverifiedEffect') : row.effectCheck;
  return <div className="method-fields">
    <section><h4>{t('structuralProblem')}</h4><FieldValue field={meta.structuralProblem}/></section>
    <section><h4>{t('mechanismLabel')}</h4><FieldValue field={meta.mechanism}/></section>
    <section><h4>{t('conditionsLabel')}</h4><FieldValue field={meta.conditions}/></section>
    <section><h4>{t('concretePractice')}</h4><FieldValue field={row.practice}/></section>
    {row.experiment && <section><h4>{t('experimentRecord')}</h4><ExperimentReview experiment={row.experiment}/></section>}
    {row.effectCheck && !row.experiment && <section><h4>{t('effectCheck')}</h4><p>{effect}</p></section>}
  </div>;
}

function ExperimentReview({ experiment }) {
  const { t, outcomes } = useMethodText();
  return <dl>
    <div><dt>{t('metric')}</dt><dd><FieldValue field={experiment.metric}/></dd></div>
    <div><dt>{t('comparison')}</dt><dd><FieldValue field={experiment.comparison}/></dd></div>
    <div><dt>{t('dataOrConditions')}</dt><dd><FieldValue field={experiment.data}/></dd></div>
    <div><dt>{t('resultLabel')}</dt><dd><FieldValue field={experiment.result}/></dd></div>
    <div><dt>{t('outcome')}</dt><dd>{outcomes[experiment.outcome] || experiment.outcome}</dd></div>
  </dl>;
}

function FieldValue({ field }) {
  const { states } = useMethodText();
  return <>{field.text && <p className="method-cell-text">{field.text}</p>}
    {field.state !== 'known' && <small className="muted">{states[field.state]}</small>}
    <EvidenceLinks items={field.evidence}/></>;
}

function FieldEdit({ label, value, onChange, baseline }) {
  const { t, states } = useMethodText();
  return <div className="method-field">
    <label>{label}<textarea rows={2} maxLength={1600} value={value.text} onChange={event => onChange({ ...value, text: event.target.value })}/></label>
    <label>{t('evidenceState')}<select value={value.state} onChange={event => onChange({ ...value, state: event.target.value })}>
      {Object.entries(states).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select></label>
    {!!baseline.evidence.length && value.text !== baseline.text && <label className="check">
      <input type="checkbox" checked={value.keepEvidence === true} onChange={event => onChange({ ...value, keepEvidence: event.target.checked })}/>
      {t('keepExistingSources')}</label>}
  </div>;
}

function Candidate({ candidate, table, batch, choice, onChoice }) {
  const { t, fields } = useMethodText();
  const same = table.rows.filter(row => row.paper.paperId === candidate.paper.paperId && row.paper.versionId === candidate.paper.versionId);
  const versions = [...table.rows, ...batch.filter(row => !row.matchId)].filter(row => row.paper.paperId === candidate.paper.paperId &&
    row.paper.versionId !== candidate.paper.versionId);
  const target = same.find(row => row.id === choice.targetId);
  const related = versions.find(row => row.id === choice.relatedId);
  return <details className="method-option" open>
    <summary>{candidate.fields.name.text} · {identify(candidate.paper)} · {target ? t('methodSuggestUpdate') : related ? t('methodRelatedVersion') : t('methodNewCandidate')}</summary>
    <p>{t('topicRelation', { reason: candidate.topicReason })}</p>
    <EvidenceLinks items={candidate.topicEvidence}/>
    <MethodEvidence row={candidate}/>
    <label className="check"><input type="checkbox" checked={choice.included} onChange={event => onChoice({ included: event.target.checked })}/>{t('applyCandidate')}</label>
    {!!same.length && <label>{t('updateInto')}<select value={choice.targetId} onChange={event => onChoice({ targetId: event.target.value, fields: {} })}>
      <option value="">{t('newMethodRow')}</option>{same.map(row => <option key={row.id} value={row.id}>{row.fields.name.text}</option>)}</select></label>}
    {!target && !!versions.length && <label>{t('linkVersion')}<select value={choice.relatedId} onChange={event => onChoice({ relatedId: event.target.value, carry: [] })}>
      <option value="">{t('independentMethod')}</option>{versions.map(row => <option key={row.id} value={row.id}>{row.fields.name.text} · {row.paper.version}</option>)}</select></label>}
    <div className="method-fields">{fields.map(([key, label]) => {
      const baseline = target?.fields[key];
      const change = choice.fields[key];
      return <section key={key}>
        <h4>{label}</h4>
        {baseline && <div className="field-diff"><div><small>{t('currentValue')}</small><FieldValue field={baseline}/></div>
          <div><small>{t('suggestedValue')}</small><FieldValue field={candidate.fields[key]}/></div></div>}
        {!baseline && <FieldValue field={candidate.fields[key]}/>}
        {baseline && <label>{t('changeAction')}<select value={typeof change === 'object' ? 'edit' : change || 'keep'} onChange={event => {
          const value = event.target.value;
          onChoice({ fields: { ...choice.fields, [key]: value === 'edit' ? { ...baseline } : value } });
        }}><option value="keep">{t('keepCurrent')}</option><option value="adopt">{t('adoptSuggestion')}</option><option value="edit">{t('editManually')}</option></select></label>}
        {baseline && typeof change === 'object' && <FieldEdit label={t('rewriteField', { label })} value={change} baseline={baseline}
          onChange={next => onChoice({ fields: { ...choice.fields, [key]: next } })}/>}
        {related && !target && table.rows.includes(related) && key !== 'name' && related.fields[key].text && <label className="check"><input type="checkbox"
          checked={choice.carry.includes(key)} onChange={event => onChoice({ carry: event.target.checked ? [...choice.carry, key] : choice.carry.filter(item => item !== key) })}/>
          {t('carryPending')}</label>}
      </section>;
    })}</div>
    {candidate.idea && <p>{t('ideaLine', { idea: candidate.idea })}</p>}
    {target && candidate.idea && <label className="check"><input type="checkbox" checked={choice.adoptIdea === true}
      onChange={event => onChoice({ adoptIdea: event.target.checked })}/>{t('adoptTransferIdea')}</label>}
  </details>;
}

function RowEditor({ row, disabled, onSubmit, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const { t, fields } = useMethodText();
  return <>
    <div className="actions">
      <button disabled={disabled} onClick={() => { setDraft({ fields: row.fields, idea: row.idea }); setEditing(true); }}>{t('edit')}</button>
      <button disabled={disabled} onClick={onRemove}>{t('delete')}</button>
    </div>
    {editing && <form className="method-row-editor" onSubmit={async event => {
      event.preventDefault();
      if (await onSubmit(draft)) setEditing(false);
    }}>
      {fields.map(([key, label]) => <FieldEdit key={key} label={label} value={draft.fields[key]} baseline={row.fields[key]}
        onChange={value => setDraft({ ...draft, fields: { ...draft.fields, [key]: value } })}/>)}
      <label>{t('transferIdea')}<textarea rows={2} maxLength={1200} value={draft.idea} onChange={event => setDraft({ ...draft, idea: event.target.value })}/></label>
      <div className="actions"><button className="primary" disabled={disabled}>{t('save')}</button>
        <button type="button" disabled={disabled} onClick={() => setEditing(false)}>{t('cancel')}</button></div>
    </form>}
  </>;
}
