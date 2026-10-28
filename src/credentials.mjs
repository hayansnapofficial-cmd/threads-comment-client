import {homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {mkdir, readFile, writeFile, rename, unlink, lstat, chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function credentialPath(platform = process.platform, env = process.env) {
  const base = platform === 'win32' ? env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local') : env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(base, 'threads-comment-client', platform === 'win32' ? 'session.dpapi' : 'session.json');
}
async function privateDirectory(directory) {
  await mkdir(directory, {recursive: true, mode: 0o700});
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('Unsafe credential directory');
  await chmod(directory, 0o700);
}
function dpapi(mode, path, value) {
  const helper = fileURLToPath(new URL('./credentials.ps1', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Mode', mode, '-Path', path], {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    const chunks = []; let bytes = 0; let failed = false;
    const timer = setTimeout(() => { failed = true; child.kill(); }, 15_000); timer.unref();
    child.on('error', () => { clearTimeout(timer); reject(new Error('Credential storage unavailable')); });
    child.stdout.on('data', data => { bytes += data.length; if (bytes > 16_384) { failed = true; child.kill(); } else chunks.push(data); });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('close', code => { clearTimeout(timer); if (failed || code !== 0) reject(new Error('Credential storage unavailable')); else resolve(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim()); });
    child.stdin.end(value === undefined ? '' : JSON.stringify(value));
  });
}
export function createCredentialStore({path = credentialPath(), platform = process.platform} = {}) {
  return {
    async read() {
      if (platform === 'win32') { const text = await dpapi('read', path); return text ? JSON.parse(text) : null; }
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid()) || info.size > 16_384) throw new Error('Unsafe credential file');
        return JSON.parse(await readFile(path, 'utf8'));
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async write(value) {
      if (platform === 'win32') { await dpapi('write', path, value); return; }
      await privateDirectory(dirname(path));
      const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
      try { await writeFile(temporary, JSON.stringify(value), {mode: 0o600, flag: 'wx'}); await rename(temporary, path); }
      finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    },
    async remove() {
      if (platform === 'win32') { await dpapi('remove', path); return; }
      await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    },
  };
}
