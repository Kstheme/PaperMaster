export const components = {
  graph: '原创方法架构', graphDetail: '核心机制流程', formula: '公式演算一', formula2: '公式演算二',
  main: '主结果', ablation: '关键消融',
};

export function figureKeys(job) {
  if (!job.interaction) return [];
  if (job.mode === 'skim') return ['graph'];
  if (job.formatVersion < 4) return ['graph', 'formula', 'main', 'ablation'];
  return Object.keys(components);
}

export function figureChapter(mode, key) {
  if (mode === 'skim') return 'skim';
  if (key === 'graph') return 'overview';
  if (key === 'main' || key === 'ablation') return 'evidence';
  return 'mechanism';
}
