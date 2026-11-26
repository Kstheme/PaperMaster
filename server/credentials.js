import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { AppError } from './errors.js';
import { writeAtomic } from './library.js';

export function defaultDataDirectory() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'PaperMaster');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || homedir(), 'PaperMaster');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'papermaster');
}

function subprocess(command, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let result = '';
    const timer = setTimeout(() => child.kill(), 30_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.setEncoding('utf8').on('data', chunk => { result += chunk; });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(result.trim());
      else reject(new Error('System credentials command failed'));
    });
  });
}

const encode = value => Buffer.from(value, 'utf8').toString('base64');
const decode = value => Buffer.from(value, 'base64').toString('utf8');

function dpapi(operation, value) {
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $buf=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${operation}($buf, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))`;
  return subprocess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], value);
}

export function credentialVault(directory = join(defaultDataDirectory(), 'credentials')) {
  return {
    async set(id, value) {
      try {
        if (process.platform === 'win32') {
          await mkdir(directory, { recursive: true });
          await writeAtomic(join(directory, id), await dpapi('Protect', encode(value)));
        } else if (process.platform === 'darwin') {
          const account = JSON.stringify(userInfo().username);
          await subprocess('/usr/bin/security', ['-i'],
            `add-generic-password -U -a ${account} -s PaperMaster.${id} -w ${encode(value)}\nquit\n`);
          if (await this.get(id) !== value) throw new Error('Keychain entry was not saved');
        } else {
          throw new Error('No system credential store on this platform');
        }
      } catch {
        throw new AppError('系统凭证库无法保存 Key。可改用环境变量。', 424, 'credential_store');
      }
    },
    async get(id) {
      try {
        if (process.platform === 'win32') return decode(await dpapi('Unprotect', await readFile(join(directory, id), 'utf8')));
        if (process.platform === 'darwin') {
          return decode(await subprocess('/usr/bin/security', ['find-generic-password', '-a', userInfo().username, '-s', 'PaperMaster.' + id, '-w']));
        }
      } catch { /* Credential may belong to an installation that was migrated. */ }
      return undefined;
    },
    async delete(id) {
      try {
        if (process.platform === 'win32') await rm(join(directory, id), { force: true });
        else if (process.platform === 'darwin') {
          await subprocess('/usr/bin/security', ['delete-generic-password', '-a', userInfo().username, '-s', 'PaperMaster.' + id]);
        }
      } catch { /* Credential may already be gone. */ }
    },
  };
}
