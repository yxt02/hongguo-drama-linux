const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const updater = require('./linux-update');

// No filesystem mutations until the user explicitly requests a download/install.
function registerLinuxUpdates({ ipcMain, app, version, allowed, send, request,
  platform = process.platform, arch = process.arch, execPath = process.execPath,
  engine = updater, launch = spawn }) {
  let state = { phase: 'idle', percent: 0 }, prepared = null, controller = null;
  const target = () => platform === 'linux' && arch === 'x64' ? engine.detectBundle(execPath) : null;
  const snapshot = () => ({ ...state, version, supported: !!target(), linux: platform === 'linux' });
  let restored = false;
  const restoreResult = () => {
    if (restored) return; restored = true;
    try {
      const result = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'last-app-update.json'), 'utf8'));
      if (result.success && result.version === version) state = { ...state, phase: 'updated' };
      else if (!result.success) state = { ...state, phase: 'error', error: '上次安装失败，已保留旧版：' + result.error };
    } catch (_) { /* First run, no previous installation result. */ }
  };
  const update = patch => { state = { ...state, ...patch }; send('app-update-state', snapshot()); };
  const cleanup = async () => { if (prepared) await fsp.rm(prepared.workdir, { recursive: true, force: true }); prepared = null; };
  ipcMain.handle('get-app-update-state', event => {
    if (!allowed(event)) return { supported: false };
    restoreResult(); return snapshot();
  });
  ipcMain.handle('download-app-update', async event => {
    if (!allowed(event) || !target()) return { success: false, error: '当前安装方式不支持快捷更新，请下载 Linux 压缩包' };
    if (controller || state.phase === 'installing') return { success: false, error: '更新正在进行' };
    if (prepared) return { success: true, ...snapshot() };
    const destination = target(); controller = new AbortController(); const signal = controller.signal;
    let workdir;
    try {
      update({ phase: 'checking', error: '', percent: 0, nextVersion: null });
      const release = await engine.latest(version, { request, signal });
      if (!release) { update({ phase: 'current' }); return { success: true, ...snapshot() }; }
      update({ phase: 'downloading', nextVersion: release.version });
      workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hongguo-update-'));
      const archive = await engine.download(release, workdir, { request, signal, progress: update });
      const root = await engine.unpack(archive, workdir, release.version, { signal });
      signal.throwIfAborted();
      prepared = { root, workdir, version: release.version, target: destination };
      update({ phase: 'ready', percent: 100 }); return { success: true, ...snapshot() };
    } catch (error) {
      if (workdir) await fsp.rm(workdir, { recursive: true, force: true });
      update({ phase: signal.aborted ? 'idle' : 'error', error: signal.aborted ? '' : error.message, percent: 0 });
      return { success: false, error: signal.aborted ? '已取消更新' : error.message };
    } finally { controller = null; }
  });
  ipcMain.handle('cancel-app-update', async event => {
    if (!allowed(event) || state.phase === 'installing') return { success: false };
    if (controller) controller.abort();
    else { await cleanup(); update({ phase: 'idle', error: '', percent: 0, nextVersion: null }); }
    return { success: true };
  });
  ipcMain.handle('install-app-update', async event => {
    if (!allowed(event) || !prepared || controller || state.phase !== 'ready') return { success: false, error: '请先下载并校验新版' };
    update({ phase: 'installing', error: '' });
    let log;
    try {
      // The worker is copied outside the directory it will rename. Electron supplies Node;
      // a system Node.js installation is not required.
      const worker = path.join(prepared.workdir, 'worker.cjs'), job = path.join(prepared.workdir, 'job.json');
      await fsp.copyFile(path.join(prepared.target, 'linux-update.cjs'), worker);
      await fsp.writeFile(job, JSON.stringify({ ...prepared, pid: process.pid, restart: true, resultFile: path.join(app.getPath('userData'), 'last-app-update.json') }), { mode: 0o600 });
      log = fs.openSync(path.join(prepared.workdir, 'install.log'), 'a', 0o600);
      const child = launch(execPath, [worker, '--job', job], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref(); setTimeout(() => app.quit(), 250);
      return { success: true };
    } catch (error) { update({ phase: 'ready', error: error.message }); return { success: false, error: error.message }; }
    finally { if (log !== undefined) fs.closeSync(log); }
  });
}
module.exports = { registerLinuxUpdates };
