// Real HLS staging with tiny files; only disk capacity and FFmpeg are simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const source = path.resolve(__dirname, '../src/native/hls-media.js');
const req = createRequire(source), MiB = 1024 * 1024, reserve = 512 * MiB;

function fixture(capacity) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-hls-space-'));
  const children = [], monitors = new Set();
  let external = 0, hold = false, afterManifest = null;
  const used = directory => fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const file = path.join(directory, entry.name);
    return sum + (entry.isDirectory() ? used(file) : fs.statSync(file).size);
  }, 0);
  const statfs = () => ({ bsize: 1, bavail: reserve + capacity - used(root) - external });
  const nativeFs = Object.assign({}, fs, { statfsSync: statfs });
  const promises = Object.assign({}, fs.promises, {
    statfs: async () => statfs(),
    async writeFile(file, ...args) {
      await fs.promises.writeFile(file, ...args);
      if (file.endsWith('.m3u8')) afterManifest?.();
    },
  });
  const spawn = (_executable, args) => {
    const child = new EventEmitter(); child.stderr = new EventEmitter();
    child.finish = code => {
      if (child.closed) return;
      child.closed = true;
      if (code === 0) fs.writeFileSync(args.at(-1), Buffer.alloc(1024));
      child.emit('close', code);
    };
    child.kill = () => { queueMicrotask(() => child.finish(143)); return true; };
    children.push(child);
    if (!hold) queueMicrotask(() => child.finish(0));
    return child;
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), {
    module, exports: module.exports, Buffer, URL, AbortController, console,
    setTimeout, clearTimeout, setInterval: fn => { monitors.add(fn); return fn; }, clearInterval: fn => monitors.delete(fn),
    require: name => name === 'node:fs' ? nativeFs : name === 'node:fs/promises' ? promises
      : name === 'node:child_process' ? { spawn } : req(name),
  }, { filename: source });
  const run = (name, bytes, options = {}) => module.exports.remuxHls({
    url: 'https://fixture.example/media.m3u8', output: path.join(root, name + '.mp4'), ffmpeg: '/fixture/ffmpeg',
    request: async url => ({ status: 200, headers: {}, url, data: Readable.from([url.endsWith('.m3u8')
      ? Buffer.from('#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\npart.ts\n#EXT-X-ENDLIST\n') : Buffer.alloc(bytes)]) }),
    ...options,
  });
  return { root, run, children, monitors, setExternal: value => external = value,
    hold: () => hold = true, afterManifest: fn => afterManifest = fn,
    close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
async function waitFor(test) {
  for (let i = 0; i < 200; i++) { if (test()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('fixture did not reach expected state');
}
const checks = [
  ['staging reserves space for the final output', async () => {
    const h = fixture(1.6 * MiB);
    try {
      await assert.rejects(h.run('large', MiB), /空间不足/);
      assert.equal(h.children.length, 0, 'insufficient output space must stop before FFmpeg');
      assert.deepEqual(fs.readdirSync(h.root), [], 'failed stage must clean its files');
    } finally { h.close(); }
  }],
  ['simultaneous jobs cannot spend the same output reservation', async () => {
    const h = fixture(4 * MiB); h.hold();
    const first = h.run('first', MiB / 2);
    try {
      await waitFor(() => h.children.length === 1);
      const second = h.run('second', MiB);
      // Old code incorrectly starts a second child; release it so the negative assertion can finish.
      const release = setInterval(() => h.children[1]?.finish(0), 5);
      try { await assert.rejects(second, /空间不足/); } finally { clearInterval(release); }
      assert.equal(h.children.length, 1);
    } finally { for (const child of h.children) child.finish(0); await first; h.close(); }
  }],
  ['available space is checked again immediately before FFmpeg', async () => {
    const h = fixture(8 * MiB);
    h.afterManifest(() => h.setExternal(7.8 * MiB));
    try { await assert.rejects(h.run('changed', MiB / 4), /空间不足/); assert.equal(h.children.length, 0); }
    finally { h.close(); }
  }],
  ['space loss during remux cancels the child and releases reservations', async () => {
    const h = fixture(4 * MiB); h.hold();
    const pending = h.run('running', MiB / 2);
    const rejected = assert.rejects(pending, /空间不足/);
    try {
      await waitFor(() => h.children.length === 1);
      assert.ok(h.monitors.size, 'remux must monitor remaining disk space');
      h.setExternal(3.5 * MiB);
      for (const monitor of h.monitors) monitor();
      await rejected;
      assert.deepEqual(fs.readdirSync(h.root), []);
      h.setExternal(0);
      const next = h.run('next', MiB / 2);
      await waitFor(() => h.children.length === 2); h.children[1].finish(0); await next;
    } finally {
      for (const child of h.children) child.finish(143);
      await rejected.catch(() => {}); h.close();
    }
  }],
];
(async () => {
  let failed = 0;
  for (const [name, check] of checks) {
    try { await check(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
  }
  process.exitCode = failed ? 1 : 0;
})();
