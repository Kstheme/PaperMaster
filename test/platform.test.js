import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
    if (prompt.includes('组件：graph')) {
      if (Array.isArray(body.input)) {
        assert.equal(body.input[0].content[1].type, 'input_image');
        seenImage = true;
        return new Response('', { status: 415 });
      }
      const node = { why: '说明作用', input: '一个点', operation: '计算坐标', output: '变换后的点' };
      return fixtureStream(url, { intro: '一个平面变换', focus: 'in', nodes: [
        { ...node, id: 'in', title: '输入', stage: 0 }, { ...node, id: 'out', title: '输出', stage: 1 },
      ], edges: [{ from: 'in', to: 'out', label: '点' }], sources: { main: 'table-1-1', ablation: 'table-2-1' } });
    }
    if (prompt.includes('组件：formula')) return fixtureStream(url, {
      title: '二维拉伸', latex: 'y=2x', objective: '观察伸缩关系', explanation: '变化量翻倍', prediction: '把横坐标加倍会发生什么？',
      module: 'in', inputs: [{ id: 'x', min: -2, max: 2, value: 1, step: .1, label: '横坐标' }],
      steps: [{ id: 'y', expr: ['mul', 'x', 2], label: '输出' }],
      outputs: ['y'], curve: { input: 'x', output: 'y' },
    });
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
  const original = await wait((await request('deep', { papers: [{ id: geometry.id }] })).id);
  const upgrade = await post('jobs/' + original.id + '/interactive', { sendImages: true }, 202);
  const ready = await wait(upgrade.id);
  assert.deepEqual(ready.references, original.references);
  assert.equal((await call('jobs/' + original.id)).interaction, undefined);
  assert.equal(ready.status, 'completed');
  assert.ok(ready.interaction.firstReady);
  assert.equal(ready.interaction.components.formula.status, 'ready');
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
  assert.match((await call('jobs/' + ready.id + '/note')).markdown, /教学演示[\s\S]+论文报告结果/);
  const observed = await post('jobs/' + ready.id + '/observation', { values: { x: 1.5 }, observation: '输出翻倍' });
  assert.match(observed.markdown, /输入：横坐标 = 1\.5[\s\S]+输出：输出 = 3[\s\S]+观察：输出翻倍/);
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

test('import targets accept only the supported public hosts', () => {
  assert.equal(arxivLink('https://arxiv.org/pdf/1706.03762v7.pdf').baseId, '1706.03762');
  assert.equal(githubLink('https://github.com/tensorflow/tensor2tensor.git'), 'https://github.com/tensorflow/tensor2tensor');
  assert.throws(() => arxivLink('https://arxiv.org.example/pdf/1706.03762'));
  assert.throws(() => githubLink('https://github.com@localhost/private/repo'));
});
