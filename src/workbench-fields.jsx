import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { evidenceHref, evidenceLabel } from '../server/evidence.js';

export function useAction(onError) {
  const [busy, setBusy] = useState(false);
  async function run(fn) {
    setBusy(true);
    onError('');
    try { return await fn(); }
    catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }
  return [run, busy];
}

export function ConnectionPicker({ library, value, onChange }) {
  return <label>使用连接<select value={value || ''} onChange={event => onChange(event.target.value)} required>
    <option value="" disabled>选择模型连接</option>
    {library.connections.map(item => <option key={item.id} value={item.id}>{item.label} · {item.model || '本机默认模型'}</option>)}
  </select></label>;
}

export function useCodexCatalog(enabled, revision = 0) {
  const [catalog, setCatalog] = useState({ models: [], loading: enabled });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setCatalog({ models: [], loading: true });
    api('connections/codex/models' + (revision ? '?refresh' : ''), { signal: controller.signal })
      .then(({ models }) => {
        if (!controller.signal.aborted) setCatalog(models.length ? { models } : { models, error: 'Codex 没有返回可选模型。' });
      })
      .catch(error => {
        if (!controller.signal.aborted) setCatalog({ models: [], error: error.message });
      });
    return () => controller.abort();
  }, [enabled, revision]);
  return catalog;
}

const effortNames = { default: '沿用模型默认', minimal: '最少', low: '低', medium: '中', high: '高',
  xhigh: '超高', max: '最大', ultra: '极高', none: '无' };
const effortName = value => effortNames[value] || value;

export function EffortField({ connection, catalog, value, onChange, inherit, label = '思考强度' }) {
  if (!connection) return null;
  const codex = connection.provider === 'codex';
  if (!codex && ['connection', 'default', undefined].includes(value)) return null;
  const model = codex && (connection.model ? catalog.models.find(item => item.id === connection.model) : catalog.models.find(item => item.isDefault));
  const supported = model?.efforts || [];
  const selected = value || 'default';
  const unavailable = !['connection', 'default', ...supported].includes(selected);
  return <label>{label}<select name="effort" value={selected} onChange={event => onChange(event.target.value)}>
    {inherit && <option value="connection">沿用连接设置{connection.effort ? ' · ' + effortName(connection.effort) : ''}</option>}
    <option value="default">沿用模型默认{model?.defaultEffort ? ' · ' + effortName(model.defaultEffort) : ''}</option>
    {unavailable && <option value={selected} disabled>{effortName(selected)}（{catalog.loading ? '正在核查' : '当前不可用'}）</option>}
    {supported.map(item => <option key={item} value={item}>{effortName(item)} · {item}</option>)}
  </select>{unavailable && !catalog.loading && <span className="muted">请改选此模型支持的设置。</span>}</label>;
}

export function EffortInfo({ entry, showMissing = true }) {
  if (!entry.effort && !showMissing) return null;
  return <small className="muted">思考强度 · {entry.effort ? effortName(entry.effort) : '未记录'}
    {entry.effectiveEffort && '（生效 · ' + effortName(entry.effectiveEffort) + '）'}</small>;
}

export function EvidenceLinks({ items = [], compact = false }) {
  if (!items.length) return null;
  return <ul className="evidence-links">{items.map((source, index) =>
    <li key={evidenceHref(source) + index}><a href={evidenceHref(source)} target="_blank" rel="noreferrer"
      title={compact ? evidenceLabel(source) : undefined}>
      {compact ? source.kind === 'code'
        ? source.file.split('/').at(-1) + ' · L' + source.from + (source.to !== source.from ? '–' + source.to : '')
        : (source.page ? '论文 · 第 ' + source.page + ' 页' : '论文版本')
        : evidenceLabel(source)}
    </a></li>)}</ul>;
}

export function paperMatches(paper, query) {
  const target = query.trim().normalize('NFKC').toLowerCase();
  if (!target || paper.title.normalize('NFKC').toLowerCase().includes(target)) return true;
  const arxiv = target.match(/^(?:https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf|html)\/|arxiv:\s*)?((?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7}))(?:v\d+)?(?:\.pdf)?(?:[?#].*)?\/?$/);
  return Boolean((arxiv && paper.arxivId?.toLowerCase() === arxiv[1]) ||
    paper.versions.some(version => version.url?.toLowerCase().includes(target)));
}
