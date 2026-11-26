import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/http.js';
import { openLibrary } from '../server/library.js';
import { arxivLink, githubLink } from '../server/import.js';

// Build a minimal text PDF (or a page containing only a graphic) without committing fixtures.
function pdf(title, text) {
  const stream = text ? 'BT /F1 8 Tf 18 TL 40 700 Td ' + text.split('\n').map(line => `(${line}) Tj`).join(' T* ') + ' ET'
    : '80 80 250 250 re S';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Title (${title}) >>`,
  ];
  let value = '%PDF-1.4\n';
  const offsets = objects.map((item, index) => {
    const offset = value.length;
    value += `${index + 1} 0 obj\n${item}\nendobj\n`;
    return String(offset).padStart(10, '0') + ' 00000 n \n';
  });
  const xref = value.length;
  value += `xref\n0 7\n0000000000 65535 f \n${offsets.join('')}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(value);
}

function fixtureStream(url, data) {
  const piece = JSON.stringify(data);
  let events;
  if (url.endsWith('/responses')) {
    events = [{ type: 'response.output_text.delta', delta: piece }, { type: 'response.completed', response: { model: 'fixture-openai' } }];
  } else if (url.endsWith('/messages')) {
    events = [{ type: 'content_block_delta', delta: { text: piece } }, { type: 'message_stop' }];
  } else if (url.includes('streamGenerateContent')) {
    events = [{ candidates: [{ content: { parts: [{ text: piece }] }, finishReason: 'STOP' }] }];
  } else {
    events = [{ model: 'fixture-compatible', choices: [{ delta: { content: piece }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] }];
  }
  return new Response(events.map(x => 'data: ' + JSON.stringify(x) + '\r\n\r\n').join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('confirmed reading decisions flow from a pinned source to a matching immutable export', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'papermaster-method-test-'));
  let app;
  t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true, maxRetries: 3 }); });
  let attempt = 0;
  let repositoryGenerations = 0;
  const efforts = [];
  const quote = 'The candidate routine evaluates bounded inputs';
  const codex = {
    models: async () => [
      { id: 'full', label: 'Full', efforts: ['low', 'high'], defaultEffort: 'low', isDefault: true },
      { id: 'small', label: 'Small', efforts: ['low'], defaultEffort: 'low' },
    ],
    async generate({ model, prompt, effort }) {
      efforts.push({ model, effort });
      const content = JSON.parse(prompt.split('\n\n').at(-1));
      let output = { markdown: '阅读段落：候选流程' };
      if (prompt.startsWith('任务：PaperMaster 阅读追问')) {
        if (content.question === '第二问') assert.equal(content.history[0].question, '第一问');
        if (content.question === '候选步骤怎样实现？') {
          assert.equal(content.readingStep.title, '调用候选生成');
          assert.match(content.code.find(file => file.name === 'src/infer.py').lines[2], /return generate/);
        }
        output = { answer: '解释：使用有界输入。\n\n第二段：不要加入笔记。',
          evidence: [{ kind: 'paper', page: 1, quote }, { kind: 'paper', page: 2, quote }] };
      } else if (prompt.startsWith('任务：PaperMaster 仓库精读')) {
        assert.equal(content.commit, 'a'.repeat(40));
        output = { paths: [{ kind: 'inference', sample: '点 P', steps: [
          { file: 'src/infer.py', line: 1, symbol: 'infer', callLine: 2, operation: '调用 generate' },
          { file: 'src/infer.py', line: 4, symbol: 'generate', output: '候选集合' },
          { file: 'src/infer.py', line: 99, symbol: 'invented' },
        ] }, { kind: 'training', steps: [{ file: 'README.md', line: 1, symbol: 'train' }] }], clues: 'README 提到训练' };
      } else if (prompt.startsWith('任务：PaperMaster 主题方法表提炼')) {
        const saved = Object.keys(content.savedCode)[0];
        output = { rows: [{
          relevance: { kind: 'direct', reason: '用几何候选生成限定几何推理的搜索范围', evidence: [{ kind: 'paper', page: 1, quote }] },
          metaMethod: {
            structuralProblem: { text: '几何搜索范围需要先被限定', state: 'known' },
            mechanism: { text: '先生成有界候选再筛选', state: 'known' },
            conditions: { text: '输入有界且候选可以被核验', state: 'known' },
          },
          practice: { text: '几何例子中的有界候选生成', state: 'known', evidence: [{ kind: 'paper', page: 1, quote }] },
          experiment: {
            metric: { text: '分数', state: 'known' },
            comparison: { text: 'Method A 对照 Method B', state: 'known' },
            data: { text: 'Table 1 主实验', state: 'known' },
            result: { text: 'Method A 得 21 分', state: 'known', evidence: [{ kind: 'paper', page: 1, quote }] },
            outcome: 'effective',
          },
          fields: {
            name: { text: '有界候选生成', state: 'known' },
            problem: { text: '如何找出候选', state: 'known' },
            pipeline: { text: '点 → 生成 → 候选', state: 'known', evidence: saved ?
              [{ kind: 'saved', id: saved }] : [{ kind: 'paper', page: 1, quote }] },
            conditions: { text: '模型提议条件', state: 'known', evidence: [{ kind: 'paper', page: 1, quote }] },
          },
          idea: '迁移到新任务',
        }, { relevance: { kind: 'background', reason: '通用训练背景' },
          fields: { name: { text: '通用日志格式', state: 'known' } } },
        { relevance: { kind: 'direct', reason: '关于训练运行', evidence: [{ kind: 'paper', page: 1, quote }] },
          fields: { name: { text: '通用设备管理', state: 'known' } } }] };
      } else if (prompt.startsWith('任务：PaperMaster 主题相关性复核')) {
        output = { decisions: content.items.map(item => ({ id: item.id, direct: item.name === '有界候选生成' &&
          content.topic.scope !== '只看蛋白质结构预测' })) };
      } else if (prompt.startsWith('任务：PaperMaster 仓库工程精读')) {
        repositoryGenerations += 1;
        assert.equal(content.repository.commit, 'a'.repeat(40));
        assert.ok(content.repository.files.some(file => file.name === 'src/infer.py'));
        output = { sample: '教学样本：点 P', sections: Object.fromEntries(['repoArchitecture', 'repoData', 'repoEngineering'].map(key => [key, {
          markdown: '从仓库源码核查工程实现', reuse: '保留输入点与生成的候选', evidence: [{ kind: 'code', file: 'src/infer.py', from: 2, quote: 'return generate(x)' }],
          steps: [{ title: '调用候选生成', why: '接入核心实现', input: '点', operation: '调用 generate', output: '候选',
            concept: '有界候选过程', mapping: '输入点由 infer 传给 generate',
            quiz: { question: '输出什么？', alternatives: ['原始句子', '空值'], explanation: 'generate 返回候选' },
            evidence: [{ kind: 'paper', page: 1, quote }, { kind: 'code', file: 'src/infer.py', from: 2, quote: 'return generate(x)' }] },
          { title: '虚构步骤', operation: '未知过程', evidence: [{ kind: 'code', file: 'src/infer.py', from: 99, quote: 'missing()' }] }],
        }])) };
      } else if (/组件：graph(?:Detail)? ·/.test(prompt)) {
        const node = { why: '说明作用', input: '一个点', operation: '生成候选', output: '候选集合' };
        output = { title: '论文架构', intro: '论文方法', focus: 'in', nodes: [
          { ...node, id: 'in', title: '输入', stage: 0, code: { file: 'src/infer.py', symbol: 'infer' } },
          { ...node, id: 'out', title: '输出', stage: 1 },
        ], edges: [{ from: 'in', to: 'out', label: '候选' }] };
      } else if (/组件：formula2? ·/.test(prompt)) {
        const multiplier = prompt.includes('组件：formula2') ? 3 : 2;
        output = { title: '公式演算', latex: 'y=' + multiplier + 'x', objective: '理解输入输出', explanation: '按比例计算',
          prediction: '将输入翻倍', module: 'in', inputs: [{ id: 'x', label: '横坐标', min: -2, max: 2, value: 1, step: 0.1 }],
          steps: [{ id: 'y', label: '输出', expr: ['mul', 'x', multiplier] }], outputs: ['y'], curve: { input: 'x', output: 'y' } };
      } else if (/组件：(main|ablation) ·/.test(prompt)) {
        const labels = prompt.includes('组件：ablation') ? ['Full setup', 'Without filter'] : ['Method A', 'Method B'];
        output = { title: '实验对照', claim: '解释实验趋势', limitation: '仅限给定样本',
          columns: [{ id: 'score', label: '分数' }], rows: labels.map((method, index) => ({
            line: Number(content.layout.split('\n').find(line => line.includes(method)).split(':')[0]),
            method, dataset: '样例', values: [index ? 42 : 21],
          })) };
      } else if (prompt.includes('当前阅读方式：关联仓库精读')) {
        assert.ok(content.implementation?.length, '论文正文生成前要有工程证据');
        output = { markdown: ['论文步骤如何落到仓库实现。', ...(content.figures || []).map(item => item.marker)].join('\n\n') };
      } else if (prompt.includes('当前小节：机制、公式与样本') || prompt.includes('当前小节：方法与关键公式')) {
        if (!attempt++) {
          const error = new Error('fixture interruption');
          error.code = 'fixture_failure';
          throw error;
        }
      }
      return { text: JSON.stringify(output), model, ...(!effort && { effectiveEffort: 'low' }) };
    },
  };
  async function start() {
    app = await createApp({ directory, codex });
    return (await (await fetch(app.url + '/api/session')).json()).token;
  }
  let token = await start();
  async function call(path, input, status = 200, method = input === undefined ? 'GET' : 'POST') {
    const response = await fetch(app.url + '/api/' + path, { method,
      headers: { 'X-PaperMaster-Session': token, ...(input !== undefined && { 'content-type': 'application/json' }) },
      ...(input !== undefined && { body: JSON.stringify(input) }) });
    const result = response.headers.get('content-type').includes('json') ? await response.json() : await response.text();
    assert.equal(response.status, status, path + ' ' + JSON.stringify(result));
    return result;
  }
  async function poll(id) {
    for (let index = 0; index < 80; index += 1) {
      const job = await call('jobs/' + id);
      if (!['queued', 'running'].includes(job.status)) return job;
      await delay(25);
    }
    throw new Error('Job did not finish');
  }
  const uploaded = await fetch(app.url + '/api/papers?name=v1.pdf', { method: 'POST',
    headers: { 'X-PaperMaster-Session': token, 'content-type': 'application/pdf' },
    body: pdf('Candidates', [quote + ' for an example geometry method.',
      'The paper specifies required parameters and explains how to generate the candidate set.',
      'Table 1: Main experiment results', 'Method A 21', 'Method B 42',
      'Table 2: Ablation experiment results', 'Full setup 21', 'Without filter 42',
    ].join('\n')) });
  assert.equal(uploaded.status, 201);
  const paper = await uploaded.json();
  const version1 = paper.versions[0];
  const version2 = { ...version1, id: randomUUID(), name: 'v2.pdf' };
  const repo = { id: randomUUID(), url: 'https://github.com/example/paper', commit: 'a'.repeat(40), files: ['README.md', 'src/infer.py'],
    inventoryVersion: 2, sourceIndex: [] };
  const library = await openLibrary(directory);
  try {
    library.put('papers', { ...paper, versionId: version2.id, versions: [version1, version2], repos: [repo] });
    await writeFile(library.path(paper.id, version2.id + '.json'), JSON.stringify([quote + ' in the revised version.']));
    await writeFile(library.path(paper.id, repo.id + '.repo.json'), JSON.stringify([
      { name: 'README.md', content: 'def train(): example' },
      { name: 'src/infer.py', content: 'def infer(x):\n    return generate(x)\n\ndef generate(x):\n    return [x]' },
    ]));
  } finally { library.close(); }

  const full = await call('connections', { provider: 'codex', model: 'full', effort: 'high' }, 201);
  const small = await call('connections', { provider: 'codex', model: 'small' }, 201);
  const refs = [{ id: paper.id, versionId: version1.id }];
  const created = await call('jobs', { mode: 'deep', papers: refs, connectionId: full.id, repoId: repo.id }, 202);
  const interrupted = await poll(created.id);
  assert.equal(interrupted.status, 'failed');
  assert.equal(interrupted.sections[0].effort, 'high');
  const jobPath = 'jobs/' + created.id;
  const blocked = await call(jobPath + '/resume', { connectionId: small.id }, 422);
  assert.equal(blocked.code, 'unsupported_effort');
  await call(jobPath + '/resume', { connectionId: small.id, effort: 'default' }, 202);
  const completed = await poll(created.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.sections[0].effort, 'high');
  assert.equal(completed.sections[1].effort, 'default');
  assert.equal(completed.sections[1].effectiveEffort, 'low');
  assert.ok(efforts.some(item => item.model === 'full' && item.effort === 'high'));

  const threadId = randomUUID();
  const first = await call(jobPath + '/followups', { threadId, turnId: randomUUID(), question: '第一问',
    connectionId: full.id, effort: 'low', position: { section: 'overview', text: '候选流程' } });
  assert.equal(first.turns[0].effort, 'low');
  assert.equal(first.turns[0].evidence.length, 1);
  assert.equal(first.turns[0].evidence[0].versionId, version1.id);
  await call(jobPath + '/followups', { threadId, turnId: randomUUID(), question: '第二问', connectionId: full.id });
  const save = { turnId: first.turns[0].id, text: '解释：使用有界输入。', observation: '迁移到新任务', kind: 'idea', saveId: randomUUID() };
  const note = await call(jobPath + '/followup-note/' + threadId, save);
  assert.match(note.markdown, /提问位置 · 论文速览/);
  assert.match(note.markdown, /迁移到新任务/);
  assert.doesNotMatch(note.markdown, /不要加入笔记/);
  assert.equal((await call(jobPath + '/followup-note/' + threadId, save)).revision, note.revision);

  const trace = await call(jobPath + '/repo-trace', { focus: '候选生成', connectionId: full.id, repoId: repo.id });
  assert.equal(trace.paths.length, 1);
  assert.deepEqual(trace.paths[0].steps.map(step => step.symbol), ['infer', 'generate']);
  assert.equal(trace.paths[0].partial, true);
  assert.match(trace.paths[0].steps[0].call.url, /#L2$/);
  await call(jobPath + '/repo-note/' + trace.id, { pathIndex: 0, stepIndex: 0 });

  const table = await call('method-tables', { title: '几何推理' }, 201);
  const root = 'method-tables/' + table.id;
  const preview = papers => call(root + '/candidates', { connectionId: full.id, papers });
  let draft = await preview(refs);
  assert.deepEqual(draft.rows.map(candidate => candidate.fields.name.text), ['有界候选生成'], '通用背景方法不能进入主题候选');
  const firstCandidate = draft.rows[0];
  assert.equal(firstCandidate.fields.pipeline.evidence[0].kind, 'code');
  assert.equal(firstCandidate.idea, '迁移到新任务');
  const one = await call(root + '/apply', { token: draft.token, items: [{ id: firstCandidate.id }] });
  const row = one.rows[0];
  assert.equal(row.metaMethod.mechanism.text, '先生成有界候选再筛选');
  assert.equal(row.practice.text, '几何例子中的有界候选生成');
  assert.equal(row.experiment.outcome, 'effective');
  assert.equal(row.topicReason, undefined);
  const edited = await call(root + '/rows/' + row.id, { revision: one.revision,
    fields: { conditions: { text: '手工确认条件', state: 'known' } } }, 200, 'PATCH');
  const snapshotId = randomUUID();
  const delivery = { revision: edited.revision, items: [{ id: row.id, includeIdea: false }] };
  const preflight = await call(root + '/delivery-preview', delivery);
  assert.equal(preflight.rows[0].idea, undefined);
  const confirmed = await call(root + '/deliveries', { ...delivery, snapshotId, confirmed: true }, 201);
  assert.equal(confirmed.rows.length, 1);
  assert.equal(confirmed.rows[0].idea, undefined);

  draft = await preview([...refs, { id: paper.id, versionId: version2.id }]);
  const [v1, v2] = draft.rows;
  assert.equal(v1.matchId, row.id);
  assert.equal(v2.relatedId, row.id);
  assert.equal(v2.idea, '');
  const after = await call(root + '/apply', { token: draft.token, items: [
    { id: v1.id, targetId: row.id, fields: { pipeline: 'adopt' } }, { id: v2.id, relatedId: row.id, carry: ['conditions'] },
  ] });
  assert.equal(after.rows.length, 2);
  assert.equal(after.rows[0].fields.conditions.text, '手工确认条件');
  assert.equal(after.rows[1].fields.conditions.state, 'pending');
  assert.deepEqual(after.rows[1].fields.conditions.evidence, []);
  await call(root + '/rows/' + row.id, { revision: after.revision,
    fields: { conditions: { text: '编辑后的条件', state: 'known' } } }, 200, 'PATCH');

  await app.close();
  app = undefined;
  token = await start();
  const stored = await call(jobPath + '/followups');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, threadId);
  assert.deepEqual(stored[0].turns.map(turn => turn.question), ['第一问', '第二问']);
  assert.match(stored[0].turns[0].answer, /解释：使用有界输入/);
  await call(jobPath + '/followups/' + threadId, undefined, 200, 'DELETE');
  assert.deepEqual(await call(jobPath + '/followups'), []);
  await app.close();
  app = undefined;
  token = await start();
  assert.deepEqual(await call(jobPath + '/followups'), [], '删除后刷新不再列出这段追问');
  const kept = await call('papers/' + paper.id + '/note');
  assert.match(kept.markdown, /解释：使用有界输入/);
  assert.doesNotMatch(kept.markdown, /不要加入笔记/);
  const repoReading = await call('jobs', { mode: 'repo', papers: refs, connectionId: full.id, repoId: repo.id }, 202);
  const combined = await poll(repoReading.id);
  assert.equal(combined.status, 'completed');
  assert.ok(combined.sections.some(section => section.key === 'mechanism'));
  for (const [chapter, figure] of [['overview', 'repoArchitecture'], ['mechanism', 'repoData'], ['evidence', 'repoEngineering']]) {
    const section = combined.sections.find(item => item.key === chapter);
    assert.equal(section.repository.key, figure);
    assert.equal(section.repository.evidence[0].commit, repo.commit);
    assert.deepEqual(section.repository.graph.nodes.map(node => node.title), ['调用候选生成']);
    assert.equal(section.repository.graph.sample, '教学样本：点 P');
    assert.equal(section.repository.graph.nodes[0].concept, '有界候选过程');
    assert.match(section.repository.graph.nodes[0].snippet, /return generate/);
    assert.equal(section.repository.graph.nodes[0].quiz.question, '输出什么？');
    assert.match(section.markdown, new RegExp('FIGURE:' + figure));
  }
  assert.equal(combined.sections.length, 6);
  assert.deepEqual(Object.keys(combined.interaction.components), ['graph', 'graphDetail', 'formula', 'formula2', 'main', 'ablation']);
  assert.equal(combined.interaction.components.graph.data.nodes[0].code.line, 1);
  for (const key of ['formula', 'formula2', 'main', 'ablation']) {
    assert.equal(combined.interaction.components[key].status, 'ready', combined.interaction.components[key].error);
  }
  assert.equal(repositoryGenerations, 1, '各章复用同一批仓库材料');
  const repoNote = await call('jobs/' + repoReading.id + '/note');
  assert.match(repoNote.markdown, /本章证据/);
  assert.match(repoNote.markdown, /可复用做法 · 保留输入点与生成的候选/);
  const stepThread = await call('jobs/' + repoReading.id + '/followups', {
    threadId: randomUUID(), turnId: randomUUID(), question: '候选步骤怎样实现？',
    position: { section: 'mechanism', repositoryStep: 'step0', text: '调用候选生成' },
  });
  assert.equal(stepThread.origin.repositoryStep, 'step0');
  assert.equal(stepThread.origin.repoId, repo.id);
  assert.equal(stepThread.origin.page, 1);
  const unrelated = await call(root + '/candidates', { connectionId: full.id, papers: refs, topicScope: '只看蛋白质结构预测' });
  assert.deepEqual(unrelated.rows, []);
  const jsonExport = await call(root + '/download/' + snapshotId);
  const markdown = await call(root + '/download/' + snapshotId + '?format=markdown');
  assert.deepEqual(jsonExport, confirmed);
  assert.equal(jsonExport.rows[0].practice.text, '几何例子中的有界候选生成');
  assert.equal(jsonExport.rows[0].metaMethod.mechanism.text, '先生成有界候选再筛选');
  assert.equal(jsonExport.rows[0].metaMethod.conditions.text, '输入有界且候选可以被核验');
  assert.equal(jsonExport.rows[0].experiment.result.text, 'Method A 得 21 分');
  assert.equal(jsonExport.rows[0].experiment.result.evidence[0].page, 1);
  assert.equal(jsonExport.rows[0].experiment.outcome, 'effective');
  assert.equal(jsonExport.targetTask, undefined);
  assert.equal(jsonExport.prediction, undefined);
  assert.match(markdown, /手工确认条件/);
  assert.match(markdown, /src\/infer\.py/);
  assert.match(markdown, /几何例子中的有界候选生成/);
  assert.match(markdown, /先生成有界候选再筛选/);
  assert.match(markdown, /输入有界且候选可以被核验/);
  assert.match(markdown, /Method A 得 21 分/);
  assert.match(markdown, /供下游评估迁移/);
  assert.match(markdown, new RegExp(snapshotId));
  assert.doesNotMatch(markdown, /编辑后的条件|迁移到新任务/);
});

test('local library, four API protocols, reading, retries, exercise recovery and backup', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'papermaster-test-'));
  let app;
  t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true, maxRetries: 3 }); });
  const credentials = new Map();
  const vault = { async set(id, key) { credentials.set(id, key); }, async get(id) { return credentials.get(id); } };
  const received = [];
  let failEvidence = true;
  let failComponent = true;
  let seenImage = false;
  const remoteFetch = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.match(Object.values(options.headers).join(' '), /fixture-key/);
    const body = JSON.parse(options.body);
    const prompt = (Array.isArray(body.input) ? body.input[0].content[0].text : body.input) ||
      body.messages?.[0].content || body.contents[0].parts[0].text;
    received.push({ url, prompt });
    if (prompt.includes('"focus":"取消测试"')) {
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
    if (prompt === 'Reply with exactly: OK') return fixtureStream(url, { markdown: 'OK' });
    if (prompt.includes('当前小节：实验与证据边界') && failEvidence) {
      failEvidence = false;
      return new Response('', { status: 429 });
    }
    if (prompt.includes('当前小节：推理练习')) {
      return fixtureStream(url, { questions: [{ objective: '了解归一化', prompt: '为什么分母会改变？', rubric: '说明共享分母' }] });
    }
    if (prompt.includes('当前小节：反馈与补讲')) {
      const passed = prompt.includes('"answer":"所有项共享分母"');
      return fixtureStream(url, { passed, markdown: passed ? '已解释共享分母。' : '先考虑所有项是否共享分母。' });
    }
    if (/组件：graph(?:Detail)? ·/.test(prompt)) {
      if (Array.isArray(body.input)) {
        assert.equal(body.input[0].content[1].type, 'input_image');
        seenImage = true;
        return new Response('', { status: 415 });
      }
      const node = { why: '说明作用', input: '一个点', operation: '计算坐标', output: '变换后的点' };
      return fixtureStream(url, { title: prompt.includes('组件：graphDetail') ? '局部数据流' : '原创变换架构',
        intro: '一个平面变换', focus: 'in', nodes: [
        { ...node, id: 'in', title: '输入', stage: 0, code: { file: 'src/model.js', symbol: 'transform' } },
        { ...node, id: 'out', title: '输出', stage: 1, code: { file: 'invented.js' } },
      ], edges: [{ from: 'in', to: 'out', label: '点' }], sources: { main: 'table-1-1', ablation: 'table-2-1' } });
    }
    if (/组件：formula2? ·/.test(prompt)) {
      const second = prompt.includes('组件：formula2');
      return fixtureStream(url, {
        title: second ? '平方映射' : '二维拉伸', latex: second ? 'y=x^2' : 'y=2x',
        objective: '观察输入输出关系', explanation: '通过运算得到输出', prediction: '把横坐标加倍会发生什么？',
        module: 'in', inputs: [{ id: 'x', min: -2, max: 2, value: 1, step: .1, label: '横坐标' }],
        steps: [{ id: 'y', expr: second ? ['mul', 'x', 'x'] : ['mul', 'x', 2], label: '输出' }],
        outputs: ['y'], curve: { input: 'x', output: 'y' },
        scenarios: [{ label: '移到坐标原点', observe: '输出回到零。', values: { x: 0 } },
          { label: '超出范围', observe: '这个场景不会被保留。', values: { x: 300 } }],
      });
    }
    if (prompt.includes('组件：main') || prompt.includes('组件：ablation')) {
      if (prompt.includes('组件：ablation') && failComponent) {
        failComponent = false;
        return fixtureStream(url, { unavailable: '暂时看不清表格' });
      }
      const { layout } = JSON.parse(prompt.split('\n\n').at(-1));
      const line = name => Number(layout.split('\n').find(text => text.includes(name)).split(':')[0]);
      return fixtureStream(url, { title: '实验结果', claim: '所选实验能支持提升', limitation: '限于当前数据集',
        columns: [{ id: 'score', label: '分数' }, { id: 'unchecked', label: '待核对' }], rows: [
          { line: line('Method A'), method: 'Method A', dataset: '样例', values: [21, 999] },
          { line: line('Method B'), method: 'Method B', dataset: '样例', values: [42, null] },
        ] });
    }
    if (prompt.includes('[[FIGURE:')) {
      const { figures } = JSON.parse(prompt.split('\n\n').at(-1));
      return fixtureStream(url, { markdown: '### 正文\n\n阅读前导\n\n' +
        figures.map(item => item.marker + '\n\n图后说明').join('\n\n') });
    }
    const sample = [{ title: '取值', input: '2', operation: '加 1', output: '3' }, { title: '汇总', input: '3', operation: '取值', output: '3' }];
    return fixtureStream(url, {
      summary: '核心结论', takeaways: ['核对关键对照', '明确适用边界'],
      ...(prompt.includes('当前小节：方法与关键公式')
        ? { markdown: '###关键运算\n\n上文\n\n[[PAPERMASTER_DEMO]]\n\n下文', sample, simulation: 'softmax' }
        : { markdown: '阅读结果' }),
    });
  };
  let token;
  async function start() {
    app = await createApp({ directory, vault, remoteFetch });
    token = (await (await fetch(app.url + '/api/session')).json()).token;
  }
  await start();
  const call = async (path, options = {}, expected = 200) => {
    const response = await fetch(app.url + '/api/' + path, {
      method: options.method || 'GET',
      headers: { 'x-papermaster-session': token, ...(options.json ? { 'content-type': 'application/json' } : options.headers) },
      body: options.json ? JSON.stringify(options.json) : options.body,
    });
    const value = response.headers.get('content-type').includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, expected, path + ': ' + JSON.stringify(value).slice(0, 400));
    return value;
  };
  const post = (path, json, status) => call(path, { method: 'POST', json }, status ?? 200);
  const upload = (title, bytes, status = 201) => call('papers?name=' + title + '.pdf',
    { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: bytes }, status);
  const wait = async id => {
    for (let i = 0; i < 80; i++) {
      const job = await call('jobs/' + id);
      if (!['queued', 'running'].includes(job.status)) return job;
      await delay(30);
    }
    throw new Error('Job never finished');
  };
  assert.equal((await fetch(app.url + '/api/library')).status, 403);
  assert.equal((await upload('scan', pdf('Scan'), 422)).code, 'no_text_pdf');
  assert.equal(received.length, 0);
  const text = 'This article describes algorithms experiments and an attention mechanism using evaluated methods and assumptions.';
  const primary = await upload('primary', pdf('Primary paper', text));
  const secondary = await upload('second', pdf('Reference paper', text + ' Different data.'));
  assert.equal((await upload('copy', pdf('Primary paper', text))).id, primary.id);
  assert.equal(primary.title, 'Primary paper');
  const links = {};
  for (const provider of ['openai', 'compatible', 'claude', 'gemini']) {
    links[provider] = await post('connections', { provider, model: 'fixture', key: 'fixture-key',
      ...(provider === 'compatible' ? { base: 'https://compatible.example/v1' } : {}) }, 201);
    assert.equal(links[provider].credential, 'vault');
    assert.equal(JSON.stringify(links[provider]).includes('fixture-key'), false);
    assert.ok((await post('connections/' + links[provider].id + '/check', {})).model);
  }
  const codex = await post('connections', { provider: 'codex' }, 201);
  const changeModel = (id, model, status = 200) => call('connections/' + id, {
    method: 'PATCH', json: { model },
  }, status);
  assert.equal(codex.model, '');
  await changeModel(links.openai.id, 'fixture-codex', 400);
  await changeModel(codex.id, 42, 400);
  assert.equal((await changeModel(codex.id, 'fixture-codex')).model, 'fixture-codex');
  assert.equal((await changeModel(codex.id, '')).model, '');
  await changeModel(codex.id, 'fixture-codex');
  assert.equal((await call('library')).defaultConnection, links.openai.id);
  const request = (mode, extra = {}) => post('jobs', {
    mode, papers: [{ id: primary.id }], connectionId: links.openai.id, ...extra,
  }, 202);
  const deep = await request('deep');
  const failure = await wait(deep.id);
  assert.equal(failure.errorCode, 'model_limit');
  assert.equal(failure.sections.length, 3);
  assert.equal(failure.sections[1].simulation, 'softmax');
  await post('jobs/' + deep.id + '/resume', { connectionId: links.claude.id }, 202);
  const finished = await wait(deep.id);
  assert.equal(finished.status, 'completed');
  assert.deepEqual(finished.sections.map(item => item.key), ['overview', 'mechanism', 'innovation', 'evidence', 'limitations', 'research']);
  assert.deepEqual(finished.sections.map(item => item.connectionId), [...Array(3).fill(links.openai.id), ...Array(3).fill(links.claude.id)]);
  assert.equal(finished.sections[1].summary, '核心结论');
  assert.equal(finished.sections[1].takeaways.length, 2);
  assert.equal(finished.sections.filter(item => item.simulation).length, 1);
  const exported = (await call('jobs/' + deep.id + '/note')).markdown;
  assert.match(exported, /### 关键运算/);
  assert.match(exported, /局限与未解决问题/);
  assert.doesNotMatch(exported, /PAPERMASTER_DEMO/);
  const lesson = await request('guided', { connectionId: links.gemini.id });
  assert.equal((await wait(lesson.id)).sections[0].connectionId, links.openai.id);
  const route = 'jobs/' + lesson.id;
  const initial = await call(route + '/exercise');
  const first = await post(route + '/answer', { questionId: initial.question.id, connectionId: links.compatible.id, answer: 'I do not know' }, 202);
  assert.equal((await wait(first.id)).sections[0].passed, false);
  await app.close();
  app = undefined;
  await start();
  assert.equal((await call('library')).connections.find(item => item.id === codex.id).model, 'fixture-codex');
  const after = await call(route + '/exercise');
  assert.equal(after.question.id, initial.question.id);
  assert.match(after.attempts[0].feedback, /分母/);
  const second = await post(route + '/answer', { questionId: initial.question.id, connectionId: links.gemini.id, answer: '所有项共享分母' }, 202);
  assert.equal((await wait(second.id)).sections[0].passed, true);
  assert.equal((await call(route + '/exercise')).passed, 1);
  for (const mode of ['skim', 'compare', 'question']) {
    const job = await request(mode, mode === 'compare' ? { papers: [{ id: primary.id }, { id: secondary.id }] }
      : mode === 'question' ? { focus: 'softmax' } : {});
    assert.equal((await wait(job.id)).status, 'completed');
  }
  const longRun = await request('skim', { focus: '取消测试' });
  for (let i = 0; i < 60 && !received.some(item => item.prompt.includes('"focus":"取消测试"')); i++) await delay(30);
  assert.ok(received.some(item => item.prompt.includes('"focus":"取消测试"')));
  assert.equal((await post('jobs/' + longRun.id + '/stop', {})).status, 'cancelled');
  assert.equal((await wait(longRun.id)).sections.length, 0);
  const notePath = 'papers/' + primary.id + '/note';
  const note = await call(notePath);
  await call(notePath, { method: 'PUT', json: { ...note, markdown: '用户意见' } });
  await call(notePath, { method: 'PUT', json: { ...note, markdown: '过期编辑' } }, 409);
  const appended = await post('papers/' + primary.id + '/append', { jobId: lesson.id });
  assert.match(appended.markdown, /用户意见[\s\S]+已验证/);
  assert.equal((await post('papers/' + primary.id + '/append', { jobId: lesson.id })).markdown, appended.markdown);
  const backup = await call('backup');
  assert.equal(backup.subarray(0, 2).toString('hex'), '1f8b');

  const geometry = await upload('geometry', pdf('Geometry fixture', [
    text, 'Figure 1: A geometric pipeline', 'Table 1: Main experiment results',
    'Method A 21', 'Method B 42', 'Table 2: Ablation experiment results',
  ].join('\n')));
  const local = await openLibrary(directory);
  const repo = { id: 'fixture-repo', url: 'https://github.com/example/geometry', commit: '1234567890abcdef' };
  local.put('papers', { ...geometry, repos: [repo] });
  await writeFile(local.path(geometry.id, repo.id + '.repo.json'), JSON.stringify([{ name: 'src/model.js', content: 'function transform(point) {}' }]));
  local.close();
  const skim = await wait((await request('skim', { papers: [{ id: geometry.id }], interactive: true })).id);
  assert.equal(skim.repoId, repo.id);
  assert.deepEqual(Object.keys(skim.interaction.components), ['graph']);
  assert.deepEqual(skim.interaction.components.graph.data.nodes.map(item => item.code), [{ file: 'src/model.js', symbol: 'transform', line: 1 }, undefined]);
  assert.match(received.findLast(item => item.prompt.includes('组件：graph ·')).prompt, /function transform/);
  const original = await wait((await request('deep', { papers: [{ id: geometry.id }] })).id);
  const upgrade = await post('jobs/' + original.id + '/interactive', { sendImages: true }, 202);
  const ready = await wait(upgrade.id);
  assert.deepEqual(ready.references, original.references);
  assert.equal((await call('jobs/' + original.id)).interaction, undefined);
  assert.equal(ready.status, 'completed');
  assert.ok(ready.interaction.firstReady);
  assert.equal(ready.interaction.components.formula.status, 'ready');
  assert.equal(ready.interaction.components.formula2.status, 'ready');
  assert.equal(ready.interaction.components.graphDetail.status, 'ready');
  assert.equal(ready.interaction.components.graphDetail.data.nodes[0].code?.file, 'src/model.js');
  assert.equal(ready.interaction.components.formula2.data.scenarios.length, 1);
  assert.equal(ready.interaction.components.main.status, 'ready');
  assert.deepEqual(ready.interaction.components.main.data.rows[0].values, [21, null]);
  assert.equal(ready.interaction.components.main.data.omitted, 1);
  assert.equal(ready.interaction.components.ablation.status, 'failed');
  assert.ok(seenImage);
  const png = await call('jobs/' + ready.id + '/asset/figure-1-1');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const requestsBeforeRetry = received.length;
  await post('jobs/' + ready.id + '/component/ablation', {}, 202);
  const retried = await wait(ready.id);
  assert.equal(retried.interaction.components.ablation.status, 'ready');
  assert.equal(received.length, requestsBeforeRetry + 1);
  assert.deepEqual(retried.sections, ready.sections);
  const illustratedNote = (await call('jobs/' + ready.id + '/note')).markdown;
  assert.match(illustratedNote, /阅读前导[\s\S]+原创变换架构[\s\S]+图后说明/);
  assert.match(illustratedNote, /二维拉伸[\s\S]+平方映射[\s\S]+论文报告结果/);
  assert.doesNotMatch(illustratedNote, /\[\[FIGURE:/);
  const observed = await post('jobs/' + ready.id + '/observation', { values: { x: 1.5 }, observation: '输出翻倍' });
  assert.match(observed.markdown, /输入：横坐标 = 1\.5[\s\S]+输出：输出 = 3[\s\S]+观察：输出翻倍/);
  assert.match((await post('jobs/' + ready.id + '/observation', { component: 'formula2', values: { x: 1.5 } })).markdown,
    /教学演示 · 平方映射[\s\S]+输出 = 2\.25/);
  const guidedInteractive = await wait((await request('guided', { papers: [{ id: geometry.id }], interactive: true })).id);
  assert.equal(guidedInteractive.interaction.sendImages, false);
  assert.equal(guidedInteractive.interaction.components.formula.status, 'ready');
  assert.equal((await call('jobs/' + guidedInteractive.id + '/exercise')).question.prompt, '为什么分母会改变？');
});

test('startup recovers an active job as interrupted', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'papermaster-recover-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3 }));
  const library = await openLibrary(directory);
  const id = '00000000-0000-0000-0000-000000000001';
  library.put('jobs', { id, mode: 'deep', status: 'running', sections: [{ key: 'overview', markdown: '已保存' }] });
  library.close();
  const app = await createApp({ directory });
  try {
    const { token } = await (await fetch(app.url + '/api/session')).json();
    const job = await (await fetch(app.url + '/api/jobs/' + id, { headers: { 'x-papermaster-session': token } })).json();
    assert.equal(job.status, 'interrupted');
    assert.equal(job.planned.length, 4);
    assert.equal(job.sections[0].markdown, '已保存');
  } finally { await app.close(); }
});

test('meta-method candidates keep one evidence record for each practice', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'papermaster-meta-method-'));
  let app;
  t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true, maxRetries: 3 }); });
  const prompts = [];
  const mechanism = '先用局部约束生成有界候选，再做廉价验证';
  const conditions = '候选可由局部约束枚举，且逐个验证的代价低';
  const structuralProblem = '组合搜索空间过大，穷举不可行';
  const codex = {
    models: async () => [{ id: 'full', label: 'Full', efforts: ['low'], defaultEffort: 'low', isDefault: true }],
    async generate({ model, prompt }) {
      prompts.push(prompt);
      const content = JSON.parse(prompt.split('\n\n').at(-1));
      const page = content.pages?.map(item => item.text).join('\n') || '';
      let output = { rows: [] };
      if (prompt.startsWith('任务：PaperMaster 主题方法表提炼')) {
        if (page.includes('insufficient material')) output = { rows: [] };
        else if (page.includes('KEYWORD OVERLAP ONLY')) output = { rows: [practiceRow({
          name: '标题关键词索引', practice: '只按标题关键词收集论文',
          quote: 'Keyword overlap does not share a mechanism with the topic.',
          mechanism: '按标题关键词检索论文', conditions: '只要标题共享关键词',
        })] };
        else if (page.includes('UNSOURCED CLAIM')) output = { rows: [practiceRow({
          name: '缺少出处的做法', practice: '声称使用了有界候选但正文没有这句话',
          quote: 'not written in this paper', mechanism, conditions,
        })] };
        else if (page.includes('GRASP GENERATION')) output = { rows: [practiceRow({
          name: '有界抓取生成', practice: '机械臂先生成有界抓取候选再排序',
          quote: 'Grasp generation proposes a bounded set and then ranks it.',
          mechanism, conditions, outcome: 'effective',
          result: '成功率从 21 升到 42', resultQuote: 'Success rate rises from 21 to 42 against exhaustive search.',
        })] };
        else if (page.includes('CONTACT RANKING')) output = { rows: [
          practiceRow({
            name: '接触排序无明显改善', practice: '蛋白质接触图沿用有界候选后与更强基线持平',
            quote: 'No clear gain remains after the stronger baseline.',
            mechanism, conditions, outcome: 'no_improvement',
            result: '与更强基线相比没有明显提升', resultQuote: 'No clear gain remains after the stronger baseline.',
          }),
          practiceRow({
            name: '接触条件失败', practice: '放宽局部约束后有界候选验证失败',
            quote: 'The altered condition fails and lowers the contact score.',
            mechanism, conditions, outcome: 'failure',
            result: '放松约束后接触分数下降', resultQuote: 'The altered condition fails and lowers the contact score.',
          }),
        ] };
        else if (page.includes('UNMEASURED MECHANISM')) output = { rows: [practiceRow({
          name: '未测量的有界提议', practice: '只解释有界提议如何缩小搜索',
          quote: 'The mechanism explains bounded proposal without a measured effect.',
          mechanism, conditions,
        })] };
      } else if (prompt.startsWith('任务：PaperMaster 主题相关性复核')) {
        output = { decisions: content.items.map(item => ({ id: item.id, direct: item.mechanism === mechanism && item.conditions === conditions &&
          item.structuralProblem === structuralProblem })) };
      }
      return { text: JSON.stringify(output), model };
    },
  };
  function practiceRow({ name, practice, quote, mechanism: methodMechanism, conditions: methodConditions, outcome, result, resultQuote }) {
    const source = text => [{ kind: 'paper', page: 1, quote: text }];
    return {
      relevance: { kind: 'direct', reason: '结构性问题、作用机制和适用前提与主题匹配', evidence: source(quote) },
      metaMethod: {
        structuralProblem: { text: structuralProblem, state: 'known' },
        mechanism: { text: methodMechanism, state: 'known' },
        conditions: { text: methodConditions, state: 'known' },
      },
      practice: { text: practice, state: 'known', evidence: source(quote) },
      ...(outcome ? { experiment: {
        metric: { text: '成功率', state: 'known' },
        comparison: { text: '对照无界穷举或更强基线', state: 'known' },
        data: { text: '固定预算的合成数据', state: 'known' },
        result: { text: result, state: 'known', evidence: source(resultQuote) },
        outcome,
      } } : { experiment: null }),
      fields: {
        name: { text: name, state: 'known' },
        problem: { text: structuralProblem, state: 'known' },
        pipeline: { text: methodMechanism, state: 'known' },
        conditions: { text: methodConditions, state: 'known' },
      },
    };
  }
  app = await createApp({ directory, codex });
  const { token } = await (await fetch(app.url + '/api/session')).json();
  async function call(path, input, status = 200, method = input === undefined ? 'GET' : 'POST') {
    const response = await fetch(app.url + '/api/' + path, { method,
      headers: { 'X-PaperMaster-Session': token, ...(input !== undefined && { 'content-type': 'application/json' }) },
      ...(input !== undefined && { body: JSON.stringify(input) }) });
    const result = response.headers.get('content-type').includes('json') ? await response.json() : await response.text();
    assert.equal(response.status, status, path + ' ' + JSON.stringify(result));
    return result;
  }
  async function upload(name, title, ...sentences) {
    const text = [...sentences, 'Method details continue in the appendix with additional constraints and parameters for the reported procedure.'].join('\n');
    const response = await fetch(app.url + '/api/papers?name=' + name, { method: 'POST',
      headers: { 'X-PaperMaster-Session': token, 'content-type': 'application/pdf' }, body: pdf(title, text) });
    assert.equal(response.status, 201, title);
    const paper = await response.json();
    assert.equal(paper.title, title);
    return paper;
  }
  const grasp = await upload('grasp.pdf', 'Robot Grasp',
    'GRASP GENERATION',
    'Bounded candidates reduce search before any domain score.',
    'Local constraints enumerate candidates and the check stays cheap.',
    'Grasp generation proposes a bounded set and then ranks it.',
    'Success rate rises from 21 to 42 against exhaustive search.');
  const keyword = await upload('keyword.pdf', 'Keyword Index',
    'KEYWORD OVERLAP ONLY',
    'Keyword overlap does not share a mechanism with the topic.',
    'The title keyword index only lists matching words.');
  const insufficient = await upload('empty.pdf', 'Insufficient Note',
    'This paper has insufficient material for a method claim today.');
  const unsourced = await upload('unsourced.pdf', 'Unsourced Claim',
    'UNSOURCED CLAIM',
    'The structural account is present in the source note.');
  const protein = await upload('protein.pdf', 'Protein Contacts',
    'CONTACT RANKING',
    'Contact ranking keeps the same bounded proposal mechanism.',
    'No clear gain remains after the stronger baseline.',
    'The altered condition fails and lowers the contact score.');
  const theory = await upload('theory.pdf', 'Theory Sketch',
    'UNMEASURED MECHANISM',
    'The mechanism explains bounded proposal without a measured effect.',
    'Conditions require enumerable local constraints.');
  const table = await call('method-tables', { title: '有界搜索' }, 201);
  const root = 'method-tables/' + table.id;
  const oldId = randomUUID();
  const snapshotId = randomUUID();
  const version = grasp.versions[0];
  const oldRow = {
    id: oldId,
    paper: { paperId: grasp.id, versionId: version.id, title: grasp.title, version: version.name },
    fields: {
      name: { text: '旧方法', state: 'known', evidence: [] },
      problem: { text: '旧问题', state: 'known', evidence: [] },
      pipeline: { text: '旧流程', state: 'known', evidence: [] },
      conditions: { text: '旧条件', state: 'known', evidence: [] },
    },
    idea: '旧设想',
  };
  const library = await openLibrary(directory);
  try {
    library.put('methodTables', { ...table, rows: [oldRow] });
    library.put('deliveries', { id: snapshotId, tableId: table.id, schemaVersion: 1, topic: table.title,
      confirmedAt: '2020-01-01T00:00:00.000Z', rows: [{ id: oldRow.id, paper: oldRow.paper, fields: oldRow.fields, idea: oldRow.idea }] });
  } finally { library.close(); }
  const ref = paper => ({ id: paper.id, versionId: paper.versions[0].id });
  const topicScope = '缩小组合搜索空间。机制是先用局部约束生成有界候选，再做廉价验证。前提是候选可被局部约束枚举且验证代价低。不限应用领域。';
  const connection = await call('connections', { provider: 'codex', model: 'full' }, 201);
  const draft = await call(root + '/candidates', { connectionId: connection.id, papers: [grasp, keyword, protein, theory].map(ref), topicScope });
  assert.match(prompts.find(item => item.startsWith('任务：PaperMaster 主题方法表提炼')), /元方法/);
  assert.match(prompts.find(item => item.startsWith('任务：PaperMaster 主题方法表提炼')), /结构性问题/);
  assert.match(prompts.find(item => item.startsWith('任务：PaperMaster 主题方法表提炼')), /跨领域/);
  assert.match(prompts.find(item => item.startsWith('任务：PaperMaster 主题方法表提炼')), /仅共享关键词/);
  assert.match(prompts.find(item => item.startsWith('任务：PaperMaster 主题方法表提炼')), /原论文未验证效果/);
  const reviewPrompt = prompts.find(item => item.startsWith('任务：PaperMaster 主题相关性复核'));
  assert.match(reviewPrompt, /作用机制和适用前提/);
  assert.match(reviewPrompt, /另一个领域/);
  assert.match(reviewPrompt, /仅共享关键词/);
  assert.match(reviewPrompt, /按标题关键词检索论文/);
  assert.match(reviewPrompt, /Robot Grasp/);
  assert.deepEqual(draft.rows.map(row => row.fields.name.text).sort(), ['有界抓取生成', '接触排序无明显改善', '接触条件失败', '未测量的有界提议'].sort());
  assert.equal(draft.rows.some(row => row.fields.name.text === '标题关键词索引'), false);
  const graspCandidate = draft.rows.find(row => row.paper.title === 'Robot Grasp');
  assert.equal(graspCandidate.metaMethod.structuralProblem.text, structuralProblem);
  assert.equal(graspCandidate.metaMethod.mechanism.text, mechanism);
  assert.equal(graspCandidate.metaMethod.conditions.text, conditions);
  assert.equal(graspCandidate.practice.evidence[0].kind, 'paper');
  assert.equal(graspCandidate.practice.evidence[0].page, 1);
  assert.equal(graspCandidate.experiment.outcome, 'effective');
  assert.equal(graspCandidate.experiment.metric.text, '成功率');
  assert.equal(graspCandidate.experiment.comparison.text, '对照无界穷举或更强基线');
  assert.equal(graspCandidate.experiment.data.text, '固定预算的合成数据');
  assert.equal(graspCandidate.experiment.result.evidence[0].page, 1);
  const proteinCandidates = draft.rows.filter(row => row.paper.title === 'Protein Contacts');
  assert.equal(proteinCandidates.length, 2);
  assert.equal(new Set(proteinCandidates.map(row => row.id)).size, 2);
  assert.notEqual(proteinCandidates[0].practice.text, proteinCandidates[1].practice.text);
  assert.deepEqual(proteinCandidates.map(row => row.experiment.outcome).sort(), ['failure', 'no_improvement']);
  assert.equal(proteinCandidates[0].metaMethod.mechanism.text, proteinCandidates[1].metaMethod.mechanism.text);
  const unmeasured = draft.rows.find(row => row.paper.title === 'Theory Sketch');
  assert.equal(unmeasured.effectCheck, '原论文未验证效果');
  assert.equal(unmeasured.experiment, undefined);
  const applied = await call(root + '/apply', { token: draft.token, items: draft.rows.map(row => ({ id: row.id })) });
  const saved = await call(root);
  assert.equal(saved.revision, applied.revision);
  assert.equal(saved.rows.length, 5);
  const legacy = saved.rows.find(row => row.id === oldId);
  assert.equal(legacy.fields.problem.text, '旧问题');
  assert.equal(legacy.fields.pipeline.text, '旧流程');
  assert.equal(legacy.fields.conditions.text, '旧条件');
  assert.equal(legacy.idea, '旧设想');
  assert.equal(legacy.metaMethod, undefined);
  const storedGrasp = saved.rows.find(row => row.id === graspCandidate.id);
  assert.equal(storedGrasp.topicReason, undefined);
  assert.deepEqual(storedGrasp.metaMethod, graspCandidate.metaMethod);
  assert.deepEqual(storedGrasp.practice, graspCandidate.practice);
  assert.deepEqual(storedGrasp.experiment, graspCandidate.experiment);
  const storedProtein = saved.rows.filter(row => row.paper.title === 'Protein Contacts');
  assert.deepEqual(storedProtein.map(row => row.practice.text).sort(), proteinCandidates.map(row => row.practice.text).sort());
  assert.equal(saved.rows.find(row => row.id === unmeasured.id).effectCheck, '原论文未验证效果');
  const patched = await call(root + '/rows/' + oldId, { revision: saved.revision,
    fields: { conditions: { text: '旧条件仍可改', state: 'known' } } }, 200, 'PATCH');
  assert.equal(patched.rows.find(row => row.id === oldId).fields.conditions.text, '旧条件仍可改');
  assert.equal(patched.rows.find(row => row.id === oldId).metaMethod, undefined);
  assert.equal(patched.rows.find(row => row.id === storedGrasp.id).metaMethod.mechanism.text, mechanism);
  const markdown = await call(root + '/download/' + snapshotId + '?format=markdown');
  const snapshot = await call(root + '/download/' + snapshotId);
  assert.match(markdown, /旧方法/);
  assert.match(markdown, /旧条件/);
  assert.doesNotMatch(markdown, /旧条件仍可改|有界抓取生成/);
  assert.doesNotMatch(markdown, /元方法|具体做法|供下游评估迁移/);
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].fields.conditions.text, '旧条件');
  assert.equal(snapshot.rows[0].metaMethod, undefined);
  assert.equal(snapshot.schemaVersion, 1);
  const evidenceRows = patched.rows.filter(row => row.metaMethod);
  const selection = { revision: patched.revision, items: evidenceRows.map(row => ({ id: row.id, includeIdea: false })) };
  const evidencePreview = await call(root + '/delivery-preview', selection);
  assert.equal(evidencePreview.rows.length, 4);
  assert.deepEqual(evidencePreview.rows.map(row => row.id), evidenceRows.map(row => row.id));
  const previewGrasp = evidencePreview.rows.find(row => row.id === storedGrasp.id);
  assert.equal(previewGrasp.practice.text, '机械臂先生成有界抓取候选再排序');
  assert.equal(previewGrasp.practice.evidence[0].page, 1);
  assert.equal(previewGrasp.practice.evidence[0].title, 'Robot Grasp');
  assert.equal(previewGrasp.metaMethod.conditions.text, conditions);
  assert.equal(previewGrasp.experiment.metric.text, '成功率');
  assert.equal(previewGrasp.experiment.comparison.text, '对照无界穷举或更强基线');
  assert.equal(previewGrasp.experiment.data.text, '固定预算的合成数据');
  assert.equal(previewGrasp.experiment.result.evidence[0].page, 1);
  assert.equal(previewGrasp.topicReason, undefined);
  assert.equal(previewGrasp.matchId, undefined);
  const previewProtein = evidencePreview.rows.filter(row => row.paper.title === 'Protein Contacts');
  assert.deepEqual(previewProtein.map(row => row.experiment.outcome).sort(), ['failure', 'no_improvement']);
  const previewTheory = evidencePreview.rows.find(row => row.id === unmeasured.id);
  assert.equal(previewTheory.effectCheck, '原论文未验证效果');
  assert.equal(previewTheory.experiment, undefined);
  const evidenceSnapshotId = randomUUID();
  const evidenceConfirmed = await call(root + '/deliveries', { ...selection, snapshotId: evidenceSnapshotId, confirmed: true }, 201);
  assert.deepEqual(evidenceConfirmed.rows, evidencePreview.rows);
  assert.equal(evidenceConfirmed.schemaVersion, 1);
  const revised = await call(root + '/rows/' + storedGrasp.id, { revision: patched.revision,
    fields: { conditions: { text: '确认后改写的前提', state: 'known' } } }, 200, 'PATCH');
  assert.equal(revised.rows.find(row => row.id === storedGrasp.id).fields.conditions.text, '确认后改写的前提');
  const evidenceJson = await call(root + '/download/' + evidenceSnapshotId);
  const evidenceMarkdown = await call(root + '/download/' + evidenceSnapshotId + '?format=markdown');
  assert.deepEqual(evidenceJson, evidenceConfirmed);
  assert.equal(evidenceJson.rows.find(row => row.id === storedGrasp.id).fields.conditions.text, conditions);
  assert.equal(evidenceJson.rows.find(row => row.id === storedGrasp.id).practice.evidence[0].title, 'Robot Grasp');
  assert.equal(evidenceJson.rows.find(row => row.id === unmeasured.id).effectCheck, '原论文未验证效果');
  assert.equal(evidenceJson.targetTask, undefined);
  assert.equal(evidenceJson.prediction, undefined);
  assert.equal(evidenceJson.rows.every(row => row.targetTask === undefined && row.prediction === undefined), true);
  assert.match(evidenceMarkdown, /机械臂先生成有界抓取候选再排序/);
  assert.match(evidenceMarkdown, /先用局部约束生成有界候选，再做廉价验证/);
  assert.match(evidenceMarkdown, /候选可由局部约束枚举，且逐个验证的代价低/);
  assert.match(evidenceMarkdown, /成功率从 21 升到 42/);
  assert.match(evidenceMarkdown, /Robot Grasp · grasp\.pdf · 第 1 页/);
  assert.match(evidenceMarkdown, /无明显改善/);
  assert.match(evidenceMarkdown, /失败/);
  assert.match(evidenceMarkdown, /原论文未验证效果/);
  assert.match(evidenceMarkdown, /供下游评估迁移/);
  assert.match(evidenceMarkdown, /由下游完成/);
  assert.match(evidenceMarkdown, new RegExp(evidenceSnapshotId));
  assert.doesNotMatch(evidenceMarkdown, /确认后改写的前提/);
  const preservedMarkdown = await call(root + '/download/' + snapshotId + '?format=markdown');
  const preserved = await call(root + '/download/' + snapshotId);
  assert.equal(preservedMarkdown, markdown);
  assert.deepEqual(preserved, snapshot);
  const legacySelection = { revision: revised.revision, items: [{ id: oldId, includeIdea: true }] };
  const legacyPreview = await call(root + '/delivery-preview', legacySelection);
  assert.equal(legacyPreview.rows[0].metaMethod, undefined);
  assert.equal(legacyPreview.rows[0].practice, undefined);
  assert.equal(legacyPreview.rows[0].idea, '旧设想');
  assert.equal(legacyPreview.rows[0].fields.conditions.text, '旧条件仍可改');
  const legacySnapshotId = randomUUID();
  const legacyConfirmed = await call(root + '/deliveries', { ...legacySelection, snapshotId: legacySnapshotId, confirmed: true }, 201);
  const legacyMarkdown = await call(root + '/download/' + legacySnapshotId + '?format=markdown');
  const legacyJson = await call(root + '/download/' + legacySnapshotId);
  assert.deepEqual(legacyJson, legacyConfirmed);
  assert.match(legacyMarkdown, /旧条件仍可改/);
  assert.match(legacyMarkdown, /旧设想/);
  assert.doesNotMatch(legacyMarkdown, /元方法|具体做法|供下游评估迁移|有界抓取生成/);
  assert.equal(legacyJson.rows[0].metaMethod, undefined);
  assert.equal(legacyJson.schemaVersion, 1);
  const empty = await call(root + '/candidates', { connectionId: connection.id, papers: [ref(insufficient)], topicScope });
  assert.deepEqual(empty.rows, []);
  const missing = await call(root + '/candidates', { connectionId: connection.id, papers: [ref(unsourced)], topicScope });
  assert.deepEqual(missing.rows, []);
});

test('import targets accept only the supported public hosts', () => {
  assert.equal(arxivLink('https://arxiv.org/pdf/1706.03762v7.pdf').baseId, '1706.03762');
  assert.equal(githubLink('https://github.com/tensorflow/tensor2tensor.git'), 'https://github.com/tensorflow/tensor2tensor');
  assert.throws(() => arxivLink('https://arxiv.org.example/pdf/1706.03762'));
  assert.throws(() => githubLink('https://github.com@localhost/private/repo'));
});
