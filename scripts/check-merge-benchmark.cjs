// Run explicitly: node scripts/check-merge-benchmark.cjs --old /path/old-main.js --report /path/report.json --real /path/003.mp4 /path/004.mp4
// Uses real main-process IPC, silent decode only. The original media is never changed.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const project = path.resolve(__dirname, '..'), current = path.join(project, 'main.js'), req = createRequire(current);
const argv = process.argv.slice(2), arg = name => argv[argv.indexOf(name) + 1];
if (!argv.includes('--old') || !argv.includes('--real')) {
  console.log('SKIP check-merge-benchmark: 需要 --old 旧 main.js 和 --real 两个片段路径');
  process.exit(0);
}
const files = argv.slice(argv.indexOf('--real') + 1);
assert.equal(files.length, 2, '只接受两个完整真实片段');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-merge-bench-'));
const { resolveFfmpegBinary } = require('./ffmpeg-bin.cjs');
const bin = name => resolveFfmpegBinary(name);
const run = (name, args) => execFileSync(bin(name), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 110000, maxBuffer: 2 * 1024 * 1024 });
const probe = file => JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]));
const originals = files.map(file => { const stat = fs.statSync(file); return [stat.size, stat.mtimeMs]; });
const rows = [];
async function checkMerge(label, source, media, compatible, mode = '') {
  const handlers = {}, app = new EventEmitter();
  Object.assign(app, { getVersion: () => 'test', getPath: () => root, commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
  let saved = [], settled;
  const finished = new Promise(resolve => { settled = resolve; });
  const electron = { app, ipcMain: { handle: (name, fn) => handlers[name] = fn }, protocol: { registerSchemesAsPrivileged() {} } };
  const store = { getSettings: () => ({}), saveMergeTasks: tasks => { saved = tasks; }, getMergeTasks: () => saved };
  const context = vm.createContext({ require: name => name === 'electron' ? electron : name === './src/store' ? store : req(name), __dirname: project, process,
    console: { log() {}, warn() {}, error() {} }, Buffer, URL, Response, Request, Headers, AbortController, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  context.resolveFfmpeg = bin;
  context.pickH264Encoder = async () => mode === 'fallback' ? 'unavailable_test_encoder' : process.env.MERGE_ENCODER || 'h264_videotoolbox';
  context.collectSeriesEpisodeFiles = () => ({ dir: root, ordered: media.map((file, i) => ({ path: file, vid_index: i + 1 })) });
  context.sendToRenderer = (event, data) => {
    if (mode === 'cancel' && event === 'merge-progress' && data.stage === 'preparing') handlers['cancel-merge']({}, data.id);
    if (event === 'merge-completed' || event === 'merge-failed') settled({ event, ...data });
  };
  const start = Date.now();
  const result = await handlers['merge-series']({}, 'fixture', label, { compatible });
  assert.equal(result.success, true, result.error);
  let timer;
  const done = await Promise.race([finished, new Promise(resolve => { timer = setTimeout(() => { handlers['cancel-merge']({}, result.id); resolve({ error: 'merge timeout' }); }, 110000); })]);
  clearTimeout(timer);
  const seconds = (Date.now() - start) / 1000;
  assert.ok(!fs.readdirSync(root).some(name => name.startsWith('.merge-')), 'temporary merge files remain');
  if (mode === 'cancel') {
    assert.equal(done.error, '已取消'); assert.equal(fs.existsSync(result.output), false);
    rows.push({ label, seconds, cancelled: true }); return;
  }
  assert.equal(done.event, 'merge-completed', done.error);
  const output = probe(result.output), duration = media.reduce((sum, file) => sum + Number(probe(file).format.duration), 0);
  assert.ok(Math.abs(Number(output.format.duration) - duration) < 0.5, 'duration mismatch');
  const decoded = run('ffmpeg', ['-v', 'error', '-xerror', '-i', result.output, '-progress', 'pipe:1', '-f', 'null', '-']);
  const frames = [...decoded.matchAll(/^frame=(\d+)/gm)].map(match => Number(match[1])).at(-1);
  const fpsText = output.streams.find(s => s.codec_type === 'video').r_frame_rate.split('/').map(Number);
  assert.ok(frames >= duration * fpsText[0] / fpsText[1] * 0.95, 'decoded frames missing');
  rows.push({ label, seconds, bytes: fs.statSync(result.output).size, duration: Number(output.format.duration), frames, method: saved[0]?.method || 'previous implementation', encoder: saved[0]?.encoder || (process.env.MERGE_ENCODER || 'h264_videotoolbox'), decoder: saved[0]?.decoder, phaseTimings: saved[0]?.phaseTimings });
  console.log(`${label}: ${seconds.toFixed(2)}s, ${(fs.statSync(result.output).size / 1048576).toFixed(2)} MiB, ${frames} frames, full silent decode passed`);
}
(async () => {
  // Same-codec compatible mode exposes needless re-encoding; mixed-codec mode exposes bitrate inflation and serial work.
  if (!argv.includes('--new-mixed-only')) {
    await checkMerge('old-same-compatible', arg('--old'), [files[0], files[0]], true);
    await checkMerge('new-same-compatible', current, [files[0], files[0]], true);
    await checkMerge('old-mixed', arg('--old'), files, false);
  }
  await checkMerge('new-mixed', current, files, false);
  for (let i = 0; i < files.length; i++) { const stat = fs.statSync(files[i]); assert.deepEqual([stat.size, stat.mtimeMs], originals[i], 'source file changed'); }
  const report = { encoder: process.env.MERGE_ENCODER || 'h264_videotoolbox', sourceBytes: originals.reduce((sum, pair) => sum + pair[0], 0), results: rows, sourceUnchanged: true, fullDecode: true };
  if (argv.includes('--report')) fs.writeFileSync(arg('--report'), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS benchmark: original media unchanged; outputs fully decoded without playback');
})().catch(error => { console.error('FAIL ' + (error.stderr ? String(error.stderr).slice(-1500) : error.stack)); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
