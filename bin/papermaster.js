#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { open, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { defaultDataDirectory } from '../server/credentials.js';
import { createApp } from '../server/http.js';

const args = process.argv.slice(2);
let directory = defaultDataDirectory();
let port = 43947;
let shouldOpen = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('papermaster [--data-dir <directory>] [--port <port>] [--no-open]');
    console.log('默认端口 43947；端口设为 0 可自动选择可用端口。');
    process.exit(0);
  } else if (args[i] === '--data-dir' && args[i + 1]) directory = resolve(args[++i]);
  else if (args[i] === '--port' && /^\d+$/.test(args[i + 1] || '')) port = Number(args[++i]);
  else if (args[i] === '--no-open') shouldOpen = false;
  else { console.error('无效选项。运行 papermaster --help。'); process.exit(1); }
}
if (port > 65535) { console.error('端口超出范围。'); process.exit(1); }

await mkdir(directory, { recursive: true, mode: 0o700 });
const lock = join(directory, '.papermaster.lock');
let ownsLock = false;
let app;
try {
  let lockFile;
  try { lockFile = await open(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = Number(await readFile(lock, 'utf8'));
    if (!Number.isInteger(existing) || existing < 1) throw new Error('此论文库正在启动或锁文件异常。');
    try {
      process.kill(existing, 0);
      throw new Error('此论文库已在运行。可打开先前的窗口，或通过 --data-dir 选择另一论文库。');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    await rm(lock);
    lockFile = await open(lock, 'wx', 0o600);
  }
  ownsLock = true;
  try { await lockFile.writeFile(String(process.pid)); } finally { await lockFile.close(); }
  app = await createApp({ directory, port });
  console.log(`PaperMaster  ${app.url}`);
  console.log(`论文库  ${directory}`);
  if (shouldOpen) {
    const [command, args] = process.platform === 'win32' ? ['explorer.exe', [app.url]]
      : process.platform === 'darwin' ? ['open', [app.url]] : ['xdg-open', [app.url]];
    const opener = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
    opener.on('error', () => console.log('请在浏览器中打开上面的地址。'));
    opener.unref();
  }
} catch (error) {
  if (ownsLock) await rm(lock, { force: true });
  console.error('PaperMaster 无法启动：' + error.message);
  process.exit(1);
}

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { await app.close(); }
  finally { await rm(lock, { force: true }); }
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
