import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { create } from 'tar';
import { openLibrary, writeAtomic } from './library.js';
import { credentialVault } from './credentials.js';
import { AppError, requiredText } from './errors.js';
import { attachRepository, importPaper, loadPaper, PDF_LIMIT } from './import.js';
import { connectionInUse, createReadingService, modes } from './reading.js';
import { readingFigureParts, splitReadingMarkdown } from './reading-markdown.js';
import { components, figureChapter, figureKeys } from './reading-figures.js';
import { solveDemo } from './interaction-math.js';
import { prepareSource } from './interaction-source.js';
import { modelServices, providers } from './providers.js';
import { evidenceMarkdown, markdownText, uuid as idPattern } from './evidence.js';
import { followupService } from './followups.js';
import { highlightService } from './highlights.js';
import { deliveryMarkdown, methodTables } from './method-tables.js';
import { traceRepository } from './repository-reading.js';
import { readingRepositoryBlock } from './draw2think-reading.js';
import { readLanguage, saveLanguage } from './language.js';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};
export async function createApp({ directory, port = 0, remoteFetch, vault = credentialVault(), codex }) {
  const library = await openLibrary(directory);
  const models = modelServices(library, vault, remoteFetch, codex);
  const reader = createReadingService(library, models);
  const followups = followupService(library, models);
  const highlights = highlightService(library);
  const tables = methodTables(library, models, readNote);
  const shutdown = new AbortController();
  const session = randomBytes(32).toString('hex');
  let mutation = Promise.resolve();
  function serialized(action) {
    const work = mutation.then(action);
    mutation = work.catch(() => {});
    return work;
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
    try {
      const address = server.address();
      if (!address || req.headers.host !== `127.0.0.1:${address.port}`) throw new AppError('请使用应用生成的本机地址。', 403);
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new AppError('不允许跨站访问论文库。', 403);
      const url = new URL(req.url, 'http://' + req.headers.host);
      if (!url.pathname.startsWith('/api/')) return await serveStatic(url, req, res);
      res.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/api/session' && req.method === 'GET') {
        return json(res, { token: session });
      }
      if (req.headers['x-papermaster-session'] !== session) throw new AppError('请刷新页面以恢复本地会话。', 403);
      await route(req, res, url, { library, reader, models, tables, followups, highlights, serialized, signal: shutdown.signal });
    } catch (error) {
      if (res.headersSent || res.destroyed) { if (!res.writableEnded) res.destroy(); return; }
      if (error instanceof AppError) json(res, { error: error.message, code: error.code }, error.status);
      else {
        console.error('PaperMaster request failed:', error.code || error.name);
        json(res, { error: '本地服务无法完成请求。', code: 'internal' }, 500);
      }
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
  } catch (error) { await reader.close(); library.close(); throw error; }
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      const closed = new Promise(resolve => server.close(resolve));
      shutdown.abort();
      await reader.close();
      await closed;
      await mutation;
      library.close();
    },
  };
}

async function route(req, res, url, { library, reader, models, followups, highlights, tables, serialized, signal }) {
  const parts = url.pathname.slice('/api/'.length).split('/');
  const [resource, id, action, member] = parts;
  const method = req.method;
  const get = (table, key) => {
    const value = idPattern.test(key ?? '') && library.get(table, key);
    if (!value) throw new AppError('请求的记录不存在。', 404);
    return value;
  };
  if (resource === 'library' && method === 'GET') {
    return json(res, { papers: library.all('papers'), connections: library.all('connections'),
      defaultConnection: library.get('settings', 'default')?.connectionId,
      jobs: library.all('jobs').filter(job => job.mode !== 'feedback').map(({ id, references, mode, status, updated, sections, interaction }) => ({
        id, references, mode, status, updated, interactive: Boolean(interaction),
        sections: sections.filter(item => item.markdown).map(({ key, title }) => ({ key, title })),
      })),
      providers, language: readLanguage(library),
      modes: Object.fromEntries(Object.entries(modes).filter(([key]) => key !== 'feedback').map(([key, item]) => [key, item.label])) });
  }
  if (resource === 'method-tables') {
    if (!id && method === 'GET') return json(res, tables.list());
    if (!id && method === 'POST') return json(res, tables.create(await body(req)), 201);
    if (id && !action && method === 'GET') return json(res, tables.get(id));
    if (id && action === 'candidates' && method === 'POST') return json(res, await tables.preview(id, await body(req), signal));
    if (id && action === 'apply' && method === 'POST') return json(res, tables.apply(id, await body(req)));
    if (id && action === 'rows' && member && method === 'PATCH') return json(res, tables.edit(id, member, await body(req)));
    if (id && action === 'rows' && member && method === 'DELETE') return json(res, tables.remove(id, member, await body(req)));
    if (id && action === 'deliveries' && method === 'GET') return json(res, tables.deliveries(tables.get(id).id));
    if (id && action === 'delivery-preview' && method === 'POST') {
      const input = await body(req);
      const table = tables.get(id);
      return json(res, { topic: table.title, rows: tables.selectedDelivery(table, input) });
    }
    if (id && action === 'deliveries' && method === 'POST') return json(res, tables.deliver(id, await body(req)), 201);
    if (id && member && action === 'download' && method === 'GET') {
      const snapshot = get('deliveries', member);
      if (snapshot.tableId !== id) throw new AppError('交付快照不存在。', 404);
      if (url.searchParams.get('format') === 'markdown') {
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
        return res.end(deliveryMarkdown(snapshot));
      }
      return json(res, snapshot);
    }
  }
  if (resource === 'papers' && method === 'POST' && !id) {
    if (req.headers['content-type']?.startsWith('application/pdf')) {
      const bytes = await readBody(req, PDF_LIMIT);
      const sourceName = basename((url.searchParams.get('name') || '导入论文.pdf').replaceAll('\\', '/')).slice(0, 255);
      return json(res, await serialized(() => importPaper(library, { bytes, sourceName, title: url.searchParams.get('title')?.slice(0, 255) })), 201);
    }
    const input = await body(req);
    const arxiv = requiredText(input.arxiv, 'arXiv 链接', 300);
    const title = input.title && requiredText(input.title, '论文标题', 255);
    return json(res, await serialized(() => importPaper(library, { arxiv, title })), 201);
  }
  if (resource === 'papers' && id) {
    const paper = get('papers', id);
    if (action === 'repo' && method === 'POST') {
      const input = await body(req);
      return json(res, await attachRepository(library, paper, input), 201);
    }
    if (action === 'repo' && member && method === 'GET') {
      const repo = paper.repos.find(item => item.id === member);
      if (!repo) throw new AppError('仓库快照不存在。', 404);
      const files = JSON.parse(await readFile(library.path(paper.id, repo.id + '.repo.json'), 'utf8'));
      return json(res, { repo, files });
    }
    if (action === 'title' && method === 'PATCH') {
      const input = await body(req);
      return json(res, await serialized(() => library.put('papers', { ...get('papers', id), title: requiredText(input.title, '论文标题', 255) })));
    }
    if (action === 'pdf' && method === 'GET') {
      const version = paper.versions.find(item => item.id === (member || paper.versionId));
      if (!version) throw new AppError('论文版本不存在。', 404);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', contentDisposition('inline', version.name));
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      return pipeline(createReadStream(library.path(id, version.id + '.pdf')), res);
    }
    if (action === 'note' && method === 'GET') return json(res, await readNote(library, id));
    if (action === 'note' && method === 'PUT') {
      const input = await body(req);
      const markdown = typeof input.markdown === 'string' && input.markdown.length <= 300_000 ? input.markdown : null;
      if (markdown === null) throw new AppError('Markdown 笔记超过大小限制。');
      return json(res, await serialized(async () => {
        const note = await readNote(library, id);
        if (input.revision !== note.revision) throw new AppError('原笔记已经变更，请重新打开后合并编辑。', 409, 'note_conflict');
        await writeAtomic(library.path(id, 'note.md'), markdown);
        return readNote(library, id);
      }));
    }
    if (action === 'append' && method === 'POST') {
      const input = await body(req);
      const job = get('jobs', input.jobId);
      if (job.mode === 'compare' || job.references[0].id !== id || job.status !== 'completed') throw new AppError('仅可合并此论文已完成的单篇成果。');
      const section = input.section;
      if (section && !job.sections.some(item => item.key === section && item.markdown)) throw new AppError('找不到可加入笔记的小节。');
      const passage = exportJob(library, job, section, false);
      const marker = `<!-- papermaster:${job.id}:${section || 'all'} -->`;
      return json(res, await serialized(() => appendNote(library, id, marker, passage)));
    }
  }
  if (resource === 'settings' && id === 'language' && !action && method === 'PUT') {
    return json(res, saveLanguage(library, await body(req)));
  }
  if (resource === 'connections') {
    if (!id && method === 'POST') return json(res, await models.save(await body(req)), 201);
    if (id === 'codex' && action === 'models' && !member && method === 'GET') {
      return json(res, { models: await models.listCodexModels(url.searchParams.has('refresh')) });
    }
    if (id === 'default' && method === 'PUT') {
      const connection = get('connections', (await body(req)).connectionId);
      return json(res, library.put('settings', { id: 'default', connectionId: connection.id }));
    }
    if (id && action === 'check' && method === 'POST') {
      return json(res, await models.check(get('connections', id), AbortSignal.timeout(60_000)));
    }
    if (id && !action && method === 'DELETE') {
      return json(res, await serialized(() => {
        const connection = get('connections', id);
        if (connectionInUse(library.all('jobs'), connection.id)) {
          throw new AppError('此连接还有排队或正在运行的任务，请等任务结束后再删除。', 409, 'connection_in_use');
        }
        return models.remove(connection.id);
      }));
    }
    if (id && !action && method === 'PATCH') {
      const { model, effort } = await body(req);
      return json(res, await serialized(async () => {
        const connection = get('connections', id);
        if (connection.provider !== 'codex') throw new AppError('此入口仅用于切换 Codex 模型。');
        const nextModel = model === '' ? '' : requiredText(model, '模型名', 180);
        const next = { ...connection, model: nextModel };
        return library.put('connections', { ...next, effort: await models.resolveEffort(next, effort) });
      }));
    }
  }
  if (resource === 'jobs') {
    if (!id && method === 'POST') {
      const input = await body(req);
      return json(res, await serialized(() => reader.start(input)), 202);
    }
    if (id) {
      const job = get('jobs', id);
      if (!action && method === 'GET') return json(res, reader.present(job));
      if (action === 'followups' && !member && method === 'GET') return json(res, followups.list(id));
      if (action === 'followups' && member && method === 'DELETE') return json(res, followups.remove(id, member));
      if (action === 'followups' && !member && method === 'POST') {
        return json(res, await followups.ask(job, await body(req), signal));
      }
      if (action === 'highlights' && !member && method === 'GET') return json(res, highlights.list(id));
      if (action === 'highlights' && !member && method === 'POST') {
        return json(res, highlights.create(job, await body(req)), 201);
      }
      if (action === 'highlights' && member && method === 'PATCH') {
        if (!idPattern.test(member)) throw new AppError('阅读高亮不属于这份阅读记录。', 404);
        const input = await body(req);
        return json(res, await serialized(() => highlights.saveAnnotation(job, member, input)));
      }
      if (action === 'highlights' && member && parts[4] === 'note' && !parts[5] && method === 'POST') {
        if (!idPattern.test(member)) throw new AppError('阅读高亮不属于这份阅读记录。', 404);
        await body(req);
        return json(res, await serialized(() => {
          const passage = highlights.annotationPassage(job, member);
          return replaceMarkedNote(library, job.references[0].id, '<!-- papermaster:highlight:' + member + ' -->', passage);
        }));
      }
      if (action === 'followup-note' && member && method === 'POST') {
        const input = await body(req);
        if (!idPattern.test(input.saveId || '')) throw new AppError('笔记保存标识无效。');
        const passage = followups.note(job, member, input);
        return json(res, await serialized(() => appendNote(library, job.references[0].id,
          '<!-- papermaster:followup:' + input.saveId + ' -->', passage)));
      }
      if (action === 'repo-trace' && !member && method === 'GET') {
        return json(res, library.all('repoTraces').find(item => item.jobId === id) || null);
      }
      if (action === 'repo-trace' && !member && method === 'POST') {
        if (job.references.length !== 1 || !job.sections.some(section => section.markdown)) throw new AppError('请打开一份单篇论文阅读结果。');
        const result = await traceRepository({ library, models, job, input: await body(req), signal });
        signal.throwIfAborted();
        return json(res, library.put('repoTraces', { ...result, id: randomUUID(), jobId: id }));
      }
      if (action === 'repo-note' && member && method === 'POST') {
        const trace = get('repoTraces', member);
        const input = await body(req);
        const step = trace.jobId === id && trace.paths[input.pathIndex]?.steps[input.stepIndex];
        if (!step) throw new AppError('找不到核实过的仓库步骤。', 404);
        const observation = input.observation ? requiredText(input.observation, '观察', 6000) : '';
        const passage = ['### 仓库精读 · ' + markdownText(step.symbol), '论文步骤 · ' + markdownText(trace.focus),
          '实现 · ' + evidenceMarkdown(step.definition), ...(step.call ? ['调用 · ' + evidenceMarkdown(step.call)] : []),
          ...(observation ? ['读者观察 · ' + observation] : [])].join('\n\n');
        return json(res, await serialized(() => appendNote(library, job.references[0].id,
          '<!-- papermaster:repo:' + trace.id + ':' + input.pathIndex + ':' + input.stepIndex + ' -->', passage)));
      }
      if (action === 'stop' && method === 'POST') return json(res, reader.stop(id));
      if (action === 'resume' && method === 'POST') {
        const input = await body(req);
        return json(res, await serialized(() => reader.retry(id, input.connectionId, input.effort)), 202);
      }
      if (action === 'interactive' && !member && method === 'POST') {
        const input = await body(req);
        return json(res, await serialized(() => reader.upgrade(id, input)), 202);
      }
      if (action === 'component' && member && method === 'POST') return json(res, reader.retryComponent(id, member), 202);
      if (action === 'asset' && member && method === 'GET') {
        const source = job.interaction?.sources?.find(item => item.id === member);
        if (!source) throw new AppError('原图表不存在。', 404);
        const reference = job.references[0];
        const material = await loadPaper(library, reference.id, reference.versionId);
        const asset = await prepareSource(library, material, source, AbortSignal.timeout(15_000));
        if (!asset.path) throw new AppError('暂时无法裁切此图表，可下载原论文查看。', 422);
        res.setHeader('Content-Type', 'image/png');
        return pipeline(createReadStream(asset.path), res);
      }
      if (action === 'observation' && method === 'POST') {
        const input = await body(req);
        const component = input.component ?? 'formula';
        const demo = ['formula', 'formula2'].includes(component) && job.interaction?.components[component]?.data;
        if (!demo) throw new AppError('找不到可保存的公式演示。', 404);
        if (!input.values || Array.isArray(input.values) || typeof input.values !== 'object' ||
          !demo.inputs.every(item => Number.isFinite(input.values[item.id]))) throw new AppError('试算输入不完整。');
        let calculated;
        try { calculated = solveDemo(demo, input.values); }
        catch (error) { throw new AppError(error.message); }
        const observation = input.observation ? requiredText(input.observation, '观察', 2500) : '';
        const fields = items => items.map(item => `${item.label || item.id} = ${JSON.stringify(calculated[item.id])}`).join('；');
        const passage = ['### 教学演示 · ' + demo.title, '输入：' + fields(demo.inputs),
          '输出：' + fields(demo.outputs.map(key => demo.steps.find(item => item.id === key))),
          ...(observation ? ['观察：' + observation] : [])].join('\n\n');
        const paperId = job.references[0].id;
        return json(res, await serialized(async () => {
          const note = await readNote(library, paperId);
          const contents = note.markdown.trimEnd() + '\n\n' + passage + '\n';
          if (contents.length > 300_000) throw new AppError('笔记超过大小限制。可先导出已有内容。');
          await writeAtomic(library.path(paperId, 'note.md'), contents);
          return readNote(library, paperId);
        }));
      }
      if (action === 'exercise' && method === 'GET') return json(res, reader.nextExercise(id));
      if (action === 'answer' && method === 'POST') {
        const input = await body(req);
        return json(res, await serialized(() => reader.answer(id, input)), 202);
      }
      if (action === 'skip' && method === 'POST') return json(res, reader.skip(id, (await body(req)).questionId));
      if (action === 'note' && method === 'GET' && job.status === 'completed') {
        return json(res, { markdown: exportJob(library, job) });
      }
    }
  }
  if (resource === 'backup' && method === 'GET') {
    return serialized(() => backup(library, res));
  }
  throw new AppError('接口不存在。', 404);
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function serveStatic(url, req, res) {
  if (req.method !== 'GET') throw new AppError('接口不存在。', 404);
  const path = resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!path.startsWith(dist.endsWith(sep) ? dist : dist + sep)) throw new AppError('文件不存在。', 404);
  if (!await stat(path).then(item => item.isFile()).catch(() => false)) {
    throw new AppError(path.endsWith('index.html') ? '缺少构建产物，请执行 npm run build。' : '文件不存在。', 404);
  }
  res.setHeader('Content-Type', contentTypes[extname(path)] || 'application/octet-stream');
  await pipeline(createReadStream(path), res);
}

async function readBody(req, limit) {
  let received = 0;
  const parts = [];
  for await (const data of req.iterator({ destroyOnReturn: false })) {
    received += data.length;
    if (received > limit) {
      req.resume();
      throw new AppError('上传内容超过大小限制。', 413);
    }
    parts.push(data);
  }
  return Buffer.concat(parts);
}

async function body(req) {
  const bytes = await readBody(req, 2 * 1024 * 1024);
  try {
    const value = JSON.parse(bytes);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AppError('请求 JSON 无效。'); }
}

function contentDisposition(mode, name) {
  return `${mode}; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`;
}

async function readNote(library, id) {
  const markdown = await readFile(library.path(id, 'note.md'), 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    const paper = library.get('papers', id);
    const version = paper?.versions.find(item => item.id === paper.versionId);
    return paper && version ? `# ${paper.title}\n\n- 论文版本：${version.arxivVersion || version.name}${version.url ? '\n- 论文入口：' + version.url : ''}\n` : '';
  });
  return { markdown, revision: createHash('sha256').update(markdown).digest('hex') };
}

async function appendNote(library, id, marker, passage) {
  const note = await readNote(library, id);
  if (!note.markdown.includes(marker)) {
    const contents = note.markdown.trimEnd() + '\n\n' + marker + '\n\n' + passage;
    if (contents.length > 300_000) throw new AppError('笔记超过大小限制。可先导出已有内容。');
    await writeAtomic(library.path(id, 'note.md'), contents);
  }
  return readNote(library, id);
}

async function replaceMarkedNote(library, id, marker, passage) {
  const note = await readNote(library, id);
  const block = marker + '\n\n' + passage;
  const start = note.markdown.indexOf(marker);
  let contents;
  if (start < 0) contents = note.markdown.trimEnd() + '\n\n' + block + '\n';
  else {
    const next = note.markdown.indexOf('\n<!-- papermaster:', start + marker.length);
    const end = next < 0 ? note.markdown.length : next;
    const suffix = note.markdown.slice(end);
    contents = note.markdown.slice(0, start) + block + (suffix ? (suffix.startsWith('\n') ? suffix : '\n' + suffix) : '\n');
  }
  if (contents.length > 300_000) throw new AppError('笔记超过大小限制。可先导出已有内容。');
  if (contents !== note.markdown) await writeAtomic(library.path(id, 'note.md'), contents);
  return readNote(library, id);
}

function exportJob(library, job, key, title = true) {
  const papers = job.references.map(ref => {
    const paper = library.get('papers', ref.id);
    return { paper, version: paper.versions.find(item => item.id === ref.versionId) };
  });
  const identity = papers.map(({paper, version}) => `- ${paper.title} (${version.arxivVersion || version.name})${version.url ? ' ' + version.url : ''}`);
  const repo = papers[0].paper.repos.find(item => item.id === job.repoId);
  const parts = [
    title ? `# ${modes[job.mode].label} · ${papers.map(({paper}) => paper.title).join(' / ')}` : `## ${modes[job.mode].label}`,
    ...identity,
    ...(repo ? [`仓库：${repo.url}/tree/${repo.commit}`] : []),
  ];
  function describeFigure(name) {
    const record = job.interaction.components[name];
    const data = record?.data;
    if (!data) return ['#### ' + components[name] + ' · 待补齐', record?.error || '尚未生成'];
    if (name.startsWith('graph')) {
      return ['#### ' + (data.title || components[name]), data.intro, ...data.nodes.map(node =>
        `- **${node.title}**：${node.why} 输入 ${node.input}，输出 ${node.output}。` +
        (node.code ? ` 实现：\`${node.code.file}\`${node.code.symbol ? ' · ' + node.code.symbol : ''}。` : ''))];
    }
    if (name.startsWith('formula')) return ['#### ' + data.title + ' · 教学演示', '$$\n' + data.latex + '\n$$', data.objective, data.explanation];
    const cell = value => String(value ?? '未确认').replaceAll('|', '\\|').replace(/\s*\n\s*/g, ' ');
    const columns = ['方法', '数据集', '条件', ...data.columns.map(item => item.label + (item.unit ? ' (' + item.unit + ')' : ''))];
    const grid = [columns, columns.map(() => '---'), ...data.rows.map(row => [row.method, row.dataset, row.condition, ...row.values])]
      .map(row => '| ' + row.map(cell).join(' | ') + ' |').join('\n');
    return ['#### ' + components[name] + ' · 论文报告结果', data.title, data.claim, grid, data.limitation];
  }
  for (const section of job.sections.filter(item => item.markdown && (!key || key === item.key))) {
    const takeaways = section.takeaways?.map(item => '- ' + item.replace(/\s*\n\s*/g, ' ')).join('\n');
    const keys = figureKeys(job).filter(name => figureChapter(job.mode, name) === section.key);
    if (section.repository) keys.push(section.repository.key);
    const body = readingFigureParts(splitReadingMarkdown(section.markdown, false).before, keys)
      .flatMap(part => {
        const block = readingRepositoryBlock(section, papers[0].paper, papers[0].version, repo);
        if (part.key && part.key === block?.key) {
          const guide = block.walkthrough ?? block.graph;
          return ['#### ' + (guide?.title || block.title), guide?.sample, block.markdown, ...(guide?.nodes || []).map(node =>
            '- **' + markdownText(node.title) + '** · ' + [node.concept, node.operation, node.mapping]
              .filter(Boolean).map(markdownText).join('。') + ' ' + node.evidence.map(evidenceMarkdown).join('、')),
            guide?.reuse && '可复用做法 · ' + guide.reuse];
        }
        return part.key ? describeFigure(part.key) : [part.markdown];
      });
    parts.push(`### ${section.title}`, ...[section.summary, takeaways, ...body]
      .filter(Boolean), ...(section.model ? [`模型：${section.model}`] : []));
    if (section.evidence?.length) parts.push('本章证据\n\n' + section.evidence.map(source => '- ' + evidenceMarkdown(source)).join('\n'));
    if (section.searched) parts.push('已查阅文件：' + section.searched.map(markdownText).join('、'));
  }
  if (!key && job.mode === 'guided') {
    const items = job.sections.find(item => item.key === 'questions')?.questions || [];
    const completed = new Set(library.all('jobs').filter(attempt => attempt.parentId === job.id &&
      attempt.status === 'completed' && attempt.sections[0]?.passed).map(attempt => attempt.question.id));
    parts.push('### 练习状态', ...items.map(item => `- ${completed.has(item.id) ? '已验证' : '尚未验证'} · ${item.objective}`));
  }
  return parts.join('\n\n') + '\n';
}

async function backup(library, res) {
  const directory = await mkdtemp(join(tmpdir(), 'papermaster-backup-'));
  try {
    await writeFile(join(directory, 'library.sqlite'), await library.snapshot());
    await cp(library.files, join(directory, 'papers'), { recursive: true, filter: name => !name.endsWith('.tmp') });
    const archive = join(directory, 'backup.tar.gz');
    await create({ cwd: directory, file: archive, gzip: true, portable: true }, ['library.sqlite', 'papers']);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="papermaster-backup.tar.gz"');
    await pipeline(createReadStream(archive), res);
  } finally { await rm(directory, { force: true, recursive: true, maxRetries: 3 }); }
}
