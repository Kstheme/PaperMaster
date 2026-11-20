let session;

export async function api(path, { method = 'GET', json, body, headers, blob, signal } = {}) {
  const getSession = async () => {
    const response = await fetch('/api/session');
    if (!response.ok) throw new Error('无法连接本地服务。');
    return (await response.json()).token;
  };
  if (!session) session = getSession().catch(error => { session = null; throw error; });
  const response = await fetch('/api/' + path, {
    method, headers: { 'X-PaperMaster-Session': await session, ...(json !== undefined && { 'Content-Type': 'application/json' }), ...headers },
    body: json !== undefined ? JSON.stringify(json) : body, signal,
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    if (response.status === 403) session = null;
    throw Object.assign(new Error(details?.error || '本地服务请求失败。'), { code: details?.code });
  }
  return blob ? response.blob() : response.json();
}

export function download(blob, name) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = name.replace(/[\\/:*?"<>|]/g, '-');
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 3000);
}

export const markdownBlob = value => new Blob([value], { type: 'text/markdown;charset=utf-8' });
