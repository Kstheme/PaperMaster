import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { AppError, requiredText } from './errors.js';
import { writeAtomic } from './library.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
export const PDF_LIMIT = 64 * 1024 * 1024;

export function arxivLink(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new AppError('请输入有效的 arXiv 链接。'); }
  const form = /^\/(?:abs|pdf|html)\/((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?)(?:\.pdf)?\/?$/i;
  const match = url.pathname.match(form);
  if (!match || url.protocol !== 'https:' || !['arxiv.org', 'export.arxiv.org'].includes(url.hostname) || url.port || url.username || url.password) {
    throw new AppError('首版支持 https://arxiv.org/abs/… 或对应 PDF 链接。');
  }
  const fullId = match[1];
  return { fullId, baseId: fullId.replace(/v\d+$/, ''), url: 'https://arxiv.org/abs/' + fullId, pdf: 'https://arxiv.org/pdf/' + fullId };
}

export function githubLink(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new AppError('请输入公开 GitHub 仓库的主页链接。'); }
  const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)\/?$/);
  if (!match || match.slice(1).some(part => part === '.' || part === '..') || url.protocol !== 'https:' ||
      url.hostname !== 'github.com' || url.port || url.username || url.password) {
    throw new AppError('请输入公开 GitHub 仓库的主页链接。');
  }
  return 'https://github.com/' + match[1] + '/' + match[2].replace(/\.git$/, '');
}

async function fetchPdf(paper) {
  const response = await fetch(paper.pdf, { redirect: 'error', signal: AbortSignal.timeout(75_000) })
    .catch(() => { throw new AppError('无法连接 arXiv，可下载 PDF 后手动导入。', 502, 'arxiv_unavailable'); });
  if (!response.ok) throw new AppError('arXiv 未返回 PDF，可下载后手动导入。', 502, 'arxiv_unavailable');
  const parts = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > PDF_LIMIT) throw new AppError('PDF 超出 64 MB。', 413);
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

async function fetchArxivMetadata(paper) {
  try {
    const result = await fetch(paper.url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!result.ok) return {};
    const document = (await result.text()).slice(0, 900_000);
    const metadata = name => [...document.matchAll(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]+)"`, 'gi'))]
      .map(match => match[1].replace(/&(amp|quot|lt|gt|#39);/g, (_, entity) =>
        ({amp: '&', quot: '"', lt: '<', gt: '>', '#39': "'"})[entity]).trim());
    return { title: metadata('citation_title')[0], authors: metadata('citation_author').join(', ') };
  } catch { return {}; }
}

export async function openPdf(bytes) {
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new AppError('文件不是 PDF。');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageRoot = join(require.resolve('pdfjs-dist/package.json'), '..');
  return getDocument({
    data: Uint8Array.from(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl: join(packageRoot, 'standard_fonts') + '/',
    cMapUrl: join(packageRoot, 'cmaps') + '/',
    cMapPacked: true,
  });
}

export async function extractPdf(bytes) {
  const task = await openPdf(bytes);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 350) throw new AppError('首版单篇论文最多支持 350 页。');
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const { items } = await page.getTextContent();
      let text = '';
      let lastY;
      for (const item of items) {
        if (!('str' in item)) continue;
        const y = item.transform?.[5];
        const separator = text && !text.endsWith('\n') ? (lastY !== undefined && Math.abs(y - lastY) > 2 ? '\n' : ' ') : '';
        text += separator + item.str + (item.hasEOL ? '\n' : '');
        lastY = y;
      }
      pages.push(text.trim());
      page.cleanup();
    }
    const { info } = await pdf.getMetadata().catch(() => ({ info: {} }));
    const substantivePages = pages.filter(page => page.replace(/[^\p{L}\p{N}]/gu, '').length >= 80).length;
    if (substantivePages === 0 || (pages.length > 2 && substantivePages / pages.length < .3)) {
      throw new AppError('该 PDF 缺少可提取的论文正文。请导入文字版 PDF。', 422, 'no_text_pdf');
    }
    const arxivId = pages.slice(0, 2).join('\n').match(/arXiv:\s*((?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?)/i)?.[1];
    const firstHeading = pages[0].split('\n').map(line => line.trim()).find(line =>
      line.length >= 12 && line.length <= 180 && /\p{L}{3}/u.test(line) &&
      !/arxiv:|preprint|proceedings|copyright|^provided proper attribution|^published as|^permission|^equal contribution/i.test(line));
    return { pages, title: String(info.Title || '').trim() || firstHeading, authors: String(info.Author || '').trim(), arxivId };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('无法读取 PDF。请检查文件是否损坏或加密。', 422, 'pdf_unreadable');
  } finally {
    await task.destroy().catch(() => {});
  }
}

export async function importPaper(library, { bytes, sourceName, arxiv, title }) {
  let reference = arxiv ? arxivLink(arxiv) : null;
  const content = bytes ?? await fetchPdf(reference);
  const hash = createHash('sha256').update(content).digest('hex');
  const papers = library.all('papers');
  const duplicate = papers.find(entry => entry.versions.some(version => version.hash === hash));
  if (duplicate) {
    if (reference && !duplicate.arxivId) {
      const version = duplicate.versions.find(item => item.hash === hash);
      return library.put('papers', { ...duplicate, arxivId: reference.baseId,
        versions: duplicate.versions.map(item => item.id === version.id ? { ...item, url: reference.url, arxivVersion: reference.fullId } : item) });
    }
    return duplicate;
  }
  const extracted = await extractPdf(content);
  if (extracted.arxivId && (!reference || (reference.baseId === extracted.arxivId.replace(/v\d+$/i, '') &&
    (!/v\d+$/i.test(reference.fullId) || /v\d+$/i.test(extracted.arxivId))))) {
    reference = arxivLink('https://arxiv.org/abs/' + extracted.arxivId);
  }
  const existing = reference && papers.find(entry => entry.arxivId === reference.baseId);
  const identity = arxiv && reference ? await fetchArxivMetadata(reference) : {};
  const id = existing?.id || randomUUID();
  const version = {
    id: randomUUID(), hash, url: reference?.url, arxivVersion: reference?.fullId, pages: extracted.pages.length,
    name: sourceName || reference?.fullId + '.pdf', date: new Date().toISOString(),
  };
  await mkdir(join(library.files, id), { recursive: true });
  await writeAtomic(library.path(id, version.id + '.pdf'), content);
  await writeAtomic(library.path(id, version.id + '.json'), JSON.stringify(extracted.pages));
  return library.put('papers', {
    id, arxivId: reference?.baseId, title: title?.trim() || existing?.title || identity.title || extracted.title || sourceName?.replace(/\.pdf$/i, '') || reference?.fullId || '导入论文',
    authors: identity.authors || extracted.authors || existing?.authors || '',
    versions: [...(existing?.versions || []), version], versionId: version.id,
    repos: existing?.repos ?? [],
  });
}

const codeFile = /(?:^|\/)(?:readme[^/]*|[^/]+\.(?:py|ts|tsx|js|rs|go|cpp|c|h|java|ipynb))$/i;
const engineeringFile = /(?:^|\/)(?:readme[^/]*|makefile|dockerfile[^/]*|[^/]+\.(?:py|ts|tsx|js|jsx|rs|go|cpp|c|h|java|sh|sql|yaml|yml|toml|md))$/i;
const excludedPath = /(^|\/)(?:vendor|node_modules|third_party|dist|build)\//i;

async function repositoryTree(git, commit) {
  return (await git('ls-tree', '-r', '-z', '--name-only', commit)).stdout.split('\0').filter(Boolean);
}

function codeExcerpt(content) {
  const lines = content.split(/\r?\n/);
  const candidates = lines.flatMap((line, index) => /^\s*(?:async\s+)?(?:def|class|function|func)\s+(?:\w*(?:attention|transformer|forward|encode|decode|train|infer)\w*)/i.test(line) ? [index] : []);
  if (!candidates.length) return content.slice(0, 8000);
  const tops = candidates.sort((a, b) => Number(!/dot_product|multihead|scaled_dot|\bforward\b/i.test(lines[a])) -
    Number(!/dot_product|multihead|scaled_dot|\bforward\b/i.test(lines[b])) || a - b).slice(0, 3).sort((a,b) => a-b);
  const excerpts = [lines.slice(0, 14).join('\n')];
  for (const start of tops) {
    excerpts.push(`[原文件第 ${start + 1} 行起]\n` + lines.slice(start, start + 28).join('\n'));
  }
  return excerpts.join('\n\n').slice(0, 8000);
}

async function withRepository(url, ref, action, signal) {
  const directory = await mkdtemp(join(tmpdir(), 'papermaster-repo-'));
  const git = (...args) => exec('git', ['-c', 'credential.helper=', '-c', 'protocol.file.allow=never', ...args], {
    cwd: directory, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
    timeout: 60_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, signal,
  });
  try {
    await git('init', '--bare', '--quiet');
    await git('remote', 'add', 'origin', url + '.git');
    await git('config', 'remote.origin.promisor', 'true');
    await git('config', 'remote.origin.partialclonefilter', 'blob:none');
    await git('fetch', '--depth=1', '--no-tags', '--filter=blob:none', 'origin', ref || 'HEAD');
    const commit = (await git('rev-parse', 'FETCH_HEAD')).stdout.trim();
    return await action(git, commit);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error.code === 'ENOENT') throw new AppError('仓库对照需要本机安装 Git。', 424, 'git_missing');
    throw new AppError('无法读取该公开仓库及版本，请检查网址、版本和网络。', 502, 'repo_unavailable');
  } finally { await rm(directory, { force: true, recursive: true, maxRetries: 3 }); }
}

export async function attachRepository(library, paper, input) {
  const url = githubLink(requiredText(input.url, '仓库地址', 250));
  const ref = input.ref ? requiredText(input.ref, '仓库分支或标签', 120) : '';
  if (ref && (!/^[\w./-]+$/.test(ref) || ref.startsWith('-') || ref.includes('..'))) throw new AppError('仓库版本应是分支、标签或提交 SHA。');
  return withRepository(url, ref, async (git, commit) => {
    const tree = await repositoryTree(git, commit);
    const candidates = tree.filter(name => codeFile.test(name) && !excludedPath.test(name) && !/(^|\/)(?:test[s]?|docs?)\//i.test(name));
    const sourceIndex = tree.filter(name => engineeringFile.test(name) && !excludedPath.test(name)).slice(0, 4000);
    const rank = name => /^readme/i.test(name) ? 0 : /(?:^|\/)(?:common_attention|attention|transformer)\./i.test(name) ? 1
      : /attent|transform|model|core|algorithm|main/i.test(name) ? 2 : /train|inference|evaluate/i.test(name) ? 3 : 4;
    const selected = candidates.sort((a, b) => rank(a) - rank(b) || a.length - b.length).slice(0, 9);
    const existing = paper.repos.find(item => item.url === url && item.commit === commit);
    if (existing) {
      const latest = library.get('papers', paper.id);
      const indexed = { ...existing, sourceIndex, inventoryVersion: 2 };
      library.put('papers', { ...latest, repos: latest.repos.map(item => item.id === existing.id ? indexed : item) });
      return indexed;
    }
    const excerpts = [];
    for (const name of selected) {
      const content = await git('show', commit + ':' + name).then(result => codeExcerpt(result.stdout)).catch(() => '');
      if (content.trim()) excerpts.push({ name, content });
    }
    if (!excerpts.length) throw new AppError('仓库未提供可读取的源文件。', 422, 'repo_empty');
    const repo = { id: randomUUID(), url, commit, ref: ref || 'HEAD', files: excerpts.map(x => x.name), sourceIndex, inventoryVersion: 2 };
    await writeAtomic(library.path(paper.id, repo.id + '.repo.json'), JSON.stringify(excerpts));
    const latest = library.get('papers', paper.id);
    const same = latest.repos.find(item => item.url === repo.url && item.commit === repo.commit);
    if (same) {
      await rm(library.path(paper.id, repo.id + '.repo.json'), { force: true });
      return same;
    }
    library.put('papers', { ...latest, repos: [...latest.repos, repo] });
    return repo;
  });
}

export async function readRepositorySources(repo, names, signal, maxChars = 42_000) {
  if (Array.isArray(names) && !names.length) return [];
  return withRepository(githubLink(repo.url), repo.commit, async (git, commit) => {
    if (commit !== repo.commit) throw new AppError('仓库提交与阅读记录不一致。', 409, 'repo_version');
    const targets = typeof names === 'function' ? names((await repositoryTree(git, commit))
      .filter(name => engineeringFile.test(name) && !excludedPath.test(name))) : names;
    const files = [];
    for (const name of targets) {
      signal?.throwIfAborted();
      const content = await git('show', commit + ':' + name).then(({ stdout }) =>
        stdout.length > maxChars ? stdout.slice(0, stdout.lastIndexOf('\n', maxChars) + 1) : stdout).catch(() => '');
      if (content.trim()) files.push({ name, lines: Object.fromEntries(content.split(/\r?\n/).map((line, index) => [index + 1, line])) });
    }
    return files;
  }, signal);
}

export async function loadPaper(library, paperId, versionId) {
  const paper = library.get('papers', paperId);
  const version = paper?.versions.find(item => item.id === (versionId ?? paper.versionId));
  if (!version) throw new AppError('论文或版本不存在。', 404);
  const pages = JSON.parse(await readFile(library.path(paper.id, version.id + '.json'), 'utf8'));
  return { paper, version, pages };
}
