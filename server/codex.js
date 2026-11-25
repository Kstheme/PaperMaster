import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { AppError } from './errors.js';

export async function codexSession(operation, signal) {
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'papermaster-codex-'));
  const executable = process.env.PAPERMASTER_CODEX_PATH || 'codex';
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd: directory, windowsHide: true });
  child.stderr.resume();
  child.stdin.on('error', () => {});
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  const listeners = new Set();
  let sequence = 0;
  let failure;
  const end = error => {
    failure ||= error;
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
    for (const listener of listeners) listener({ failure });
  };
  const abort = () => end(signal.reason);
  child.once('error', () => end(new AppError('未找到 Codex CLI。请安装并完成 codex login。', 424, 'codex_missing')));
  const exit = new Promise(resolve => child.once('close', () => {
    end(new AppError('Codex 连接已关闭。', 502, 'codex_closed'));
    resolve();
  }));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const send = message => child.stdin.write(JSON.stringify(message) + '\n');
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.method && message.id !== undefined) {
      // Reading tasks never delegate tools or approve actions.
      send({ id: message.id, error: { code: -32601, message: 'No client actions in paper reading' } });
      return;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new AppError('Codex 请求失败：' + String(message.error.message || '').slice(0, 250), 502, 'codex_request'));
      else request.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  const request = (method, params) => {
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      send({ id, method, ...(params ? { params } : {}) });
    });
  };
  try {
    await request('initialize', { clientInfo: { name: 'papermaster', title: 'PaperMaster', version: '0.1.0' } });
    send({ method: 'initialized' });
    const account = await request('account/read', { refreshToken: false });
    if (account.account?.type !== 'chatgpt') throw new AppError('Codex 未使用 ChatGPT 登录。请运行 codex login 后重试。', 424, 'codex_login');
    return await operation({ request, listeners, directory, account: account.account, interrupt: params => send({ id: ++sequence, method: 'turn/interrupt', params }) });
  } finally {
    signal?.removeEventListener('abort', abort);
    child.stdin.end();
    child.kill();
    await exit;
    lines.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

export function codexStatus(signal) {
  return codexSession(async ({ request, account }) => {
    const result = await request('account/rateLimits/read').catch(() => null);
    return { mode: 'chatgpt', plan: account.planType, limits: result?.rateLimits ?? null };
  }, signal);
}

export async function codexModels(signal) {
  try {
    return await codexSession(async ({ request }) => {
      const models = new Map();
      const cursors = new Set();
      let cursor;
      do {
        const page = await request('model/list', { includeHidden: false, limit: 50, ...(cursor && { cursor }) });
        for (const entry of page.data) {
          if (!entry.hidden && entry.model && !models.has(entry.model)) {
            models.set(entry.model, { id: entry.model, label: entry.displayName || entry.model, isDefault: entry.isDefault === true,
              efforts: (entry.supportedReasoningEfforts || []).map(item => item.reasoningEffort), defaultEffort: entry.defaultReasoningEffort });
          }
        }
        cursor = page.nextCursor;
        if (cursors.has(cursor)) throw new AppError('Codex 返回了重复的模型列表分页。', 502, 'codex_models');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return [...models.values()];
    }, signal);
  } catch (error) {
    if (signal?.aborted && signal.reason?.name === 'TimeoutError') {
      throw new AppError('获取 Codex 模型列表超时。请稍后重试。', 504, 'codex_models_timeout');
    }
    throw error;
  }
}

export function codexGenerate({ model, prompt, signal, onDelta, images = [], effort }) {
  return codexSession(async ({ request, listeners, directory, interrupt }) => {
    const response = await request('thread/start', {
      cwd: directory, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only',
      ...(model ? { model } : {}),
    });
    const threadId = response.thread.id;
    let turnId;
    const messages = new Map();
    const onAbort = () => { if (turnId) interrupt({ threadId, turnId }); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await new Promise((resolve, reject) => {
        listeners.add(event => {
          if (event.failure) return reject(event.failure);
          const data = event.params;
          if (!data || data.threadId !== threadId) return;
          if (event.method === 'item/agentMessage/delta') {
            messages.set(data.itemId, (messages.get(data.itemId) || '') + data.delta);
            onDelta?.(data.delta);
          } else if (event.method === 'item/completed' && data.item?.type === 'agentMessage') {
            messages.set(data.item.id, data.item.text);
          } else if (event.method === 'item/started' && ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'].includes(data.item?.type)) {
            onAbort();
            reject(new AppError('论文阅读任务尝试调用外部工具，已停止。', 502, 'codex_unexpected_tool'));
          } else if (event.method === 'turn/completed') {
            if (data.turn.status === 'completed') resolve({ text: [...messages.values()].at(-1) || '', model: response.model || model || '',
              ...(!effort && response.reasoningEffort && { effectiveEffort: response.reasoningEffort }) });
            else reject(new AppError('Codex 未完成请求：' + (data.turn.error?.message ?? data.turn.status), 502, 'codex_turn'));
          }
        });
        request('turn/start', {
          threadId, input: [{ type: 'text', text: prompt }, ...images.map(path => ({ type: 'localImage', path }))], approvalPolicy: 'never',
          ...(effort && { effort }),
        }).then(result => { turnId = result.turn.id; if (signal?.aborted) onAbort(); }, reject);
      });
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }, signal);
}
