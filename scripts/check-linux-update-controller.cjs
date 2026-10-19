const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { registerLinuxUpdates } = require('../src/native/linux-update-controller');
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hongguo-update-ipc-'));
  const handlers = {}, states = [], sender = {}, event = { sender };
  let latest = async () => ({ version: '1.74.2' }), job, quit = false;
  const engine = {
    detectBundle: () => temp,
    latest: (...args) => latest(...args),
    download: async (_release, _dir, { signal, progress }) => { signal.throwIfAborted(); progress({ phase: 'verifying', percent: 100 }); return 'archive'; },
    unpack: async () => temp,
  };
  await fs.writeFile(path.join(temp, 'linux-update.cjs'), '// bundled worker');
  registerLinuxUpdates({
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    app: { getPath: () => temp, quit: () => { quit = true; } }, version: '1.74.1',
    allowed: e => e.sender === sender, send: (_name, state) => states.push(state), engine,
    platform: 'linux', arch: 'x64', execPath: '/fake/electron',
    launch: (binary, args, options) => {
      assert.equal(binary, '/fake/electron'); assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
      assert.equal(args[1], '--job'); job = args[2];
      const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child;
    },
  });
  const ipc = name => handlers[name](event);
  try {
    assert.equal((await handlers['download-app-update']({ sender: {} })).success, false);
    assert.equal((await ipc('install-app-update')).success, false);
    assert.equal((await ipc('get-app-update-state')).supported, true);
    let reject, signal;
    latest = (_v, options) => { signal = options.signal; return new Promise((_r, fail) => { reject = fail; signal.addEventListener('abort', () => reject(signal.reason)); }); };
    const download = ipc('download-app-update');
    assert.equal((await ipc('download-app-update')).success, false, 'concurrent download blocked');
    await ipc('cancel-app-update'); assert.equal(signal.aborted, true); await download;
    assert.equal((await ipc('get-app-update-state')).phase, 'idle');
    latest = async () => { throw new Error('network unavailable'); };
    await ipc('download-app-update'); assert.equal((await ipc('get-app-update-state')).phase, 'error');
    latest = async () => ({ version: '1.74.2' });
    assert.equal((await ipc('download-app-update')).phase, 'ready');
    await ipc('cancel-app-update'); assert.equal((await ipc('get-app-update-state')).phase, 'idle');
    await ipc('download-app-update'); assert.equal((await ipc('install-app-update')).success, true);
    const data = JSON.parse(await fs.readFile(job, 'utf8'));
    assert.equal(data.target, temp); assert.equal(data.pid, process.pid); assert.equal(data.version, '1.74.2');
    assert.ok(data.restart); assert.equal((await ipc('cancel-app-update')).success, false);
    await new Promise(resolve => setTimeout(resolve, 300)); assert.equal(quit, true);
    assert.ok(states.some(s => s.phase === 'verifying'));
    await fs.rm(data.workdir, { recursive: true, force: true });
    console.log('PASS updater IPC: sender guard, prepare-before-install, concurrency, abort, retry, cancel cleanup, detached worker job, quit after spawn');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
