import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AppError, requiredText } from './errors.js';
import { codexGenerate, codexStatus } from './codex.js';

export const providers = {
  codex: { label: 'Codex 订阅' },
  openai: { label: 'OpenAI API', api: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
  compatible: { label: 'OpenAI 兼容端点', env: 'PAPERMASTER_COMPATIBLE_API_KEY' },
  claude: { label: 'Claude 原生 API', api: 'https://api.anthropic.com/v1', env: 'ANTHROPIC_API_KEY' },
  gemini: { label: 'Gemini 原生 API', api: 'https://generativelanguage.googleapis.com/v1beta', env: 'GEMINI_API_KEY' },
};

export function modelServices(library, vault, remoteFetch = fetch) {
  async function save(input) {
    const provider = requiredText(input.provider, '服务商', 40);
    if (!Object.hasOwn(providers, provider)) throw new AppError('未知的模型服务商。');
    const definition = providers[provider];
    const id = randomUUID();
    const label = input.label ? requiredText(input.label, '连接名称', 80) : definition.label;
    const model = provider === 'codex' && !input.model ? '' : requiredText(input.model, '模型名', 180);
    let base = definition.api;
    let credential;
    if (provider === 'compatible') {
      let url;
      try { url = new URL(requiredText(input.base, 'Base URL', 300)); } catch { throw new AppError('请输入有效的 Base URL。'); }
      if (url.username || url.password || url.search || url.hash ||
          !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
        throw new AppError('Base URL 必须使用 HTTPS。本机端点可使用 HTTP。');
      }
      base = url.href.replace(/\/+$/, '');
    }
    if (provider !== 'codex') {
      if (input.key) {
        const key = requiredText(input.key, 'API Key', 4096);
        if (/[^\x21-\x7e]/.test(key)) throw new AppError('API Key 含无效字符。');
        await vault.set(id, key);
        credential = 'vault';
      } else {
        const env = input.env || definition.env;
        if (typeof env !== 'string' || !/^[A-Z][A-Z0-9_]{2,99}$/.test(env) || !/API_KEY$/.test(env)) throw new AppError('请输入以 API_KEY 结尾的环境变量名。');
        credential = env;
      }
    }
    const connection = library.put('connections', { id, provider, label, model, base, credential });
    if (!library.get('settings', 'default')) library.put('settings', { id: 'default', connectionId: id });
    return connection;
  }

  async function generate(connection, prompt, { signal, onDelta, maxTokens = 3000, images = [] } = {}) {
    const timeout = AbortSignal.timeout(240_000);
    signal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    if (connection.provider === 'codex') return codexGenerate({ model: connection.model, prompt, signal, onDelta, images });
    const key = connection.credential === 'vault' ? await vault.get(connection.id) : process.env[connection.credential];
    if (!key) throw new AppError('此连接找不到 API Key。请检查本机凭证或环境变量。', 424, 'missing_key');
    const png = await Promise.all(images.map(path => readFile(path).then(contents => contents.toString('base64'))));
    const { path, body, headers, delta, done } = requestFor(connection.provider, connection.model, prompt, key, maxTokens, png);
    const url = connection.base + path;
    let response;
    try {
      response = await remoteFetch(url, { method: 'POST', signal, redirect: 'error',
        headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw new AppError('模型端点连接失败。请检查地址与网络。', 502, 'model_network');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new AppError('模型连接达到用量或速率限制。可稍后重试或手动切换。', 429, 'model_limit');
      if ([401, 403].includes(response.status)) throw new AppError('模型连接认证失败或无权使用该模型。', 424, 'model_auth');
      if (png.length && [400, 415, 422].includes(response.status)) {
        throw new AppError('连接未接受图片输入。', 422, 'model_image_input');
      }
      throw new AppError(`模型服务返回 HTTP ${response.status}。请检查模型名和端点。`, 502, 'model_response');
    }
    let text = '';
    let model = connection.model;
    let finished = false;
    for await (const event of sseEvents(response.body)) {
      if (event === '[DONE]') { finished = true; break; }
      let data;
      try { data = JSON.parse(event); } catch { throw new AppError('模型服务返回了无法识别的流式结果。', 502, 'model_stream'); }
      if (data.error || ['error', 'response.failed', 'response.incomplete'].includes(data.type)) {
        throw new AppError('模型服务未完成生成。请检查连接并重试。', 502, 'model_stream');
      }
      const part = delta(data);
      if (typeof part === 'string' && part) { text += part; onDelta?.(part); }
      model = data.response?.model || data.model || data.message?.model || data.modelVersion || model;
      if (done(data)) { finished = true; break; }
    }
    signal.throwIfAborted();
    if (!finished || !text.trim()) throw new AppError('模型回复为空或在完成前断开。', 502, 'model_stream');
    return { text, model };
  }

  return {
    save, generate,
    async check(connection, signal) {
      if (connection.provider === 'codex') return codexStatus(AbortSignal.timeout(25_000));
      const result = await generate(connection, 'Reply with exactly: OK', { signal, maxTokens: 256 });
      return { model: result.model, mode: 'api' };
    },
  };
}

function requestFor(provider, model, prompt, key, maxTokens, png) {
  const imageUrl = data => 'data:image/png;base64,' + data;
  if (provider === 'openai') return {
    path: '/responses', headers: { Authorization: 'Bearer ' + key },
    body: { model, input: png.length ? [{ role: 'user', content: [{ type: 'input_text', text: prompt },
      ...png.map(data => ({ type: 'input_image', image_url: imageUrl(data) }))] }] : prompt, stream: true, store: false, max_output_tokens: maxTokens },
    delta: data => data.type === 'response.output_text.delta' && data.delta,
    done: data => data.type === 'response.completed',
  };
  if (provider === 'claude') return {
    path: '/messages', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: { model, messages: [{ role: 'user', content: png.length ? [{ type: 'text', text: prompt },
      ...png.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }))] : prompt }],
      max_tokens: maxTokens, stream: true },
    delta: data => data.type === 'content_block_delta' && data.delta?.text,
    done: data => data.type === 'message_stop',
  };
  if (provider === 'gemini') return {
    path: '/models/' + encodeURIComponent(model.replace(/^models\//, '')) + ':streamGenerateContent?alt=sse',
    headers: { 'x-goog-api-key': key },
    body: { contents: [{ role: 'user', parts: [{ text: prompt }, ...png.map(data => ({ inlineData: { mimeType: 'image/png', data } }))] }],
      generationConfig: { maxOutputTokens: maxTokens } },
    delta: data => data.candidates?.[0]?.content?.parts?.filter(item => !item.thought).map(item => item.text || '').join(''),
    done: data => Boolean(data.candidates?.[0]?.finishReason),
  };
  return {
    path: '/chat/completions', headers: { Authorization: 'Bearer ' + key },
    body: { model, messages: [{ role: 'user', content: png.length ? [{ type: 'text', text: prompt },
      ...png.map(data => ({ type: 'image_url', image_url: { url: imageUrl(data) } }))] : prompt }], stream: true, max_tokens: maxTokens },
    delta: data => data.choices?.[0]?.delta?.content,
    done: data => Boolean(data.choices?.[0]?.finish_reason),
  };
}

export async function* sseEvents(body) {
  let buffer = '';
  let data = [];
  for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      else if (!line && data.length) { yield data.join('\n'); data = []; }
    }
    if (buffer.length > 1_000_000) throw new AppError('模型流式事件过大。', 502);
  }
  if (buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart());
  if (data.length) yield data.join('\n');
}
