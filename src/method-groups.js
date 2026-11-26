import { normalizeKey } from '../server/normalize-key.js';

function metaText(value) {
  return typeof value?.text === 'string' ? value.text : '';
}

// Records that share a structural problem and mechanism are one meta-method.
// Conditions, practice, and results stay on each paper so different outcomes can be compared.
export function groupMethodRecords(rows) {
  const groups = [];
  const byKey = new Map();
  const legacy = { key: 'legacy', kind: 'legacy', structuralProblem: '', mechanism: '', rows: [] };
  for (const row of rows) {
    const structuralProblem = metaText(row?.metaMethod?.structuralProblem);
    const mechanism = metaText(row?.metaMethod?.mechanism);
    if (!structuralProblem.trim() || !mechanism.trim()) {
      legacy.rows.push(row);
      continue;
    }
    const key = normalizeKey(structuralProblem) + '\n' + normalizeKey(mechanism);
    let group = byKey.get(key);
    if (!group) {
      group = { key, kind: 'meta', structuralProblem: structuralProblem.trim(), mechanism: mechanism.trim(), rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  if (legacy.rows.length) groups.push(legacy);
  return groups;
}
