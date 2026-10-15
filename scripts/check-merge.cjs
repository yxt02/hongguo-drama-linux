// Silent black-frame regression through the real merge IPC. No GUI or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const source = path.resolve(__dirname, '../main.js'), req = createRequire(source);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-merge-'));
const { resolveFfmpegBinary } = require('./ffmpeg-bin.cjs');
const bin = name => resolveFfmpegBinary(name);
const run = (name, args) => execFileSync(bin(name), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 110000 });
const probe = file => JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
async function merge(label, files, compatible, mode = '') {
  const originals = files.map(file => { const stat = fs.statSync(file); return [stat.size, stat.mtimeMs]; });
  const handlers = {}, app = new EventEmitter();
  Object.assign(app, { getVersion: () => 'test', getPath: () => root, commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
  const electron = { app, ipcMain: { handle: (n, fn) => handlers[n] = fn }, protocol: { registerSchemesAsPrivileged() {} } };
  const context = vm.createContext({ require: name => name === 'electron' ? electron : name === './src/store' ? { getSettings: () => ({}), saveMergeTasks() {} } : req(name), __dirname: path.dirname(source), process, console: { log() {}, warn() {}, error() {} }, Buffer, URL, Response, Request, Headers, AbortController, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context);
  context.resolveFfmpeg = bin;
  context.pickH264Encoder = async () => mode === 'fallback' ? 'unavailable_test_encoder' : process.env.MERGE_ENCODER || 'libx264';
  context.collectSeriesEpisodeFiles = () => ({ dir: root, ordered: files.map((file, i) => ({ path: file, vid_index: i + 1 })) });
  let finish;
  const settled = new Promise(resolve => { finish = resolve; });
  context.sendToRenderer = (event, data) => {
    if (mode === 'cancel' && event === 'merge-progress') handlers['cancel-merge']({}, data.id);
    if (['merge-completed', 'merge-failed'].includes(event)) finish({ event, ...data });
  };
  const started = await handlers['merge-series']({}, 'fixture', label, { compatible });
  assert.equal(started.success, true, started.error);
  let timer;
  const result = await Promise.race([settled, new Promise(resolve => { timer = setTimeout(() => resolve({ error: 'merge did not settle' }), 110000); })]);
  clearTimeout(timer);
  for (let i = 0; i < files.length; i++) { const stat = fs.statSync(files[i]); assert.deepEqual([stat.size, stat.mtimeMs], originals[i], 'source file changed'); }
  assert.ok(!fs.readdirSync(root).some(file => file.startsWith('.merge-') || file.endsWith('.part') || file.endsWith('.ffconcat.txt')), 'temporary files remain');
  if (mode === 'cancel') {
    assert.equal(result.event, 'merge-failed'); assert.equal(result.error, '已取消');
    assert.equal(fs.existsSync(started.output), false, 'cancel published a partial output');
    console.log('PASS cancellation: child stopped, partial files removed, sources unchanged');
    return;
  }
  assert.equal(result.event, 'merge-completed', result.error);
  const info = probe(started.output);
  const expected = files.reduce((sum, file) => sum + Number(probe(file).format.duration), 0);
  assert.ok(Math.abs(Number(info.format.duration) - expected) < 0.4, 'lost episode duration');
  assert.equal(info.streams.find(s => s.codec_type === 'video').codec_name, 'h264');
  assert.equal(info.streams.find(s => s.codec_type === 'audio').codec_name, 'aac');
  // Decode all synthetic frames; real files only decode across their join, never play them.
  const seek = process.argv.includes('--real') ? ['-ss', String(Math.max(0, Number(probe(files[0]).format.duration) - 1)), '-t', '2'] : [];
  const decoded = run('ffmpeg', ['-v', 'error', '-xerror', ...seek, '-i', started.output, '-progress', 'pipe:1', '-f', 'null', '-']);
  const frames = [...decoded.matchAll(/^frame=(\d+)/gm)].map(match => Number(match[1]));
  assert.ok(frames.at(-1) >= 44, `lost video after codec boundary: decoded ${frames.at(-1)} frames, expected at least 44`);
  assert.ok(files.every(file => fs.existsSync(file)), 'source files were removed');
  console.log(`PASS ${label}: ${info.streams[0].codec_name}, ${Number(info.format.duration).toFixed(3)}s, silent decode`);
}
(async () => {
  let files;
  if (process.argv.includes('--real')) files = process.argv.slice(process.argv.indexOf('--real') + 1);
  else {
    files = ['h264', 'hevc'].map(codec => path.join(root, `${codec}.mp4`));
    for (let i = 0; i < files.length; i++) run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=24:d=1', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', '-c:v', i ? (process.platform === 'darwin' ? 'hevc_videotoolbox' : 'libx265') : 'libx264', ...(i && process.platform !== 'darwin' ? ['-x265-params', 'log-level=error:pools=1'] : []), '-pix_fmt', 'yuv420p', '-c:a', 'aac', files[i]]);
  }
  assert.equal(files.length, 2);
  if (process.argv.includes('--extras')) {
    await merge('hardware-fallback', files, true, 'fallback');
    await merge('cancel-normalization', files, true, 'cancel');
    return;
  }
  await merge('mixed-fast', files, false);
  if (!process.argv.includes('--real')) {
    await merge('mixed-compatible', files, true);
    await merge('same-codec-copy', [files[0], files[0]], false);
  }
})().catch(error => { console.error('FAIL ' + (error.stderr ? String(error.stderr).slice(-1200) : error.message)); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
