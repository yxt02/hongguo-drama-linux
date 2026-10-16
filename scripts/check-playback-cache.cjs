// Real disk/streams and real main-process IPC, with isolated data and no network or GUI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createRequire } = require('node:module');
const policy = require('../src/native/playback-cache');
const source = path.resolve(__dirname, '../main.js'), req = createRequire(source);
const roots = [];
const tick = () => new Promise(r => setImmediate(r));
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function load(directory) {
  const root = directory || fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-window-'));
  if (!roots.includes(root)) roots.push(root);
  const handlers = {}, events = [], metrics = { transfers: 0, probes: 0, sources: [], hls: 0 };
  const app = new EventEmitter();
  Object.assign(app, { getPath: () => root, getVersion: () => 'test', commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
  const native = { fetchPlayUrlSingle: async (vid, sid, options) => { metrics.sources.push(options); return { vid, url: 'https://fixture.invalid/' + vid + '/' + options.quality, codec: 'hevc' }; } };
  const context = vm.createContext({ require: n => n === 'electron' ? { app, ipcMain: { handle: (n, f) => handlers[n] = f }, protocol: { registerSchemesAsPrivileged() {} } }
    : n === './src/native/hongguo' ? native : n === './src/store' ? {} : req(n), __dirname: path.dirname(source), process, Buffer, URL, Response, Request, Headers, AbortController, setTimeout, clearTimeout, console });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  context.resolveFfmpeg = () => '/fixture/ffprobe';
  context.probeVideoInfo = async (_probe, file) => {
    metrics.probes++; const data = fs.readFileSync(file);
    return data.length >= 4096 && data[0] === 1 ? { codec: 'hevc', w: data[1] === 7 ? 720 : 1080, h: data[1] === 7 ? 1280 : 1920, duration: 5 } : null;
  };
  const bytes = info => { const b = Buffer.alloc(4096, 1); if (info.url.endsWith('720p')) b[1] = 7; return b; };
  const response = info => { metrics.transfers++; return { headers: { 'content-length': '4096' }, data: Readable.from([bytes(info)]) }; };
  context.requestMedia = async info => response(info);
  context.prepareHlsFile = async (_info, output, { signal }) => { if (signal.aborted) throw new Error('cancelled'); metrics.hls++; fs.writeFileSync(output, Buffer.alloc(4096, 1)); };
  context.sendToRenderer = (name, payload) => events.push({ name, ...payload });
  return { root, handlers, context, metrics, response, run: code => vm.runInContext(code, context) };
}
const window = (h, index, quality = 'auto', sid = 'S') => h.handlers['set-playback-window']({}, { seriesId: sid, vidIndex: index, quality,
  episodes: Array.from({ length: 30 }, (_, i) => i + 1).filter(i => Math.abs(i - index) <= 5).map(i => ({ vid: 'v' + i, vidIndex: i })) });
const prepare = (h, index, quality = 'auto', extra = {}) => h.handlers['prepare-online-play']({}, { disk: true, vid: 'v' + index, seriesId: 'S', vidIndex: index, requestId: 'r-' + Math.random(), quality, ...extra });
const release = (h, result) => h.handlers['release-online-play']({}, { streamId: result.streamId });
module.exports = { load, roots };
if (require.main === module) (async () => {
  let failures = 0;
  const check = async (name, fn) => { try { await fn(); console.log('PASS ' + name); } catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.stack); } };
  await check('source and quality identify independent disk files; no complete video Buffer is retained', async () => {
    const h = load(); assert.equal(window(h, 10).success, true);
    const a = await prepare(h, 10); assert.equal(a.success, true); assert.equal(a.width, 1080); assert.equal(a.codec, 'hevc');
    const entry = h.run("onlineCache.get('disk:auto:v10')"); assert.equal(entry.buffer, undefined); assert.ok(fs.existsSync(entry.filePath));
    await release(h, a); assert.equal(window(h, 10, '720p').success, true);
    const b = await prepare(h, 10, '720p'); assert.equal(b.success, true); assert.equal(b.width, 720); assert.equal(h.metrics.transfers, 2);
    assert.ok(h.metrics.sources.every(o => o.preferQuality)); assert.equal(fs.existsSync(entry.filePath), false);
    await release(h, b); h.context.clearOnlineCache();
  });
  await check('shared preparation survives cancellation of one consumer', async () => {
    const h = load(), gate = defer(); window(h, 10);
    h.context.requestMedia = async info => { await gate.promise; return h.response(info); };
    const first = prepare(h, 10, 'auto', { requestId: 'old' }); const second = prepare(h, 10, 'auto', { requestId: 'new' });
    await tick(); await h.handlers['release-online-play']({}, { requestId: 'old' }); gate.resolve();
    const a = await first, b = await second;
    assert.equal(a.success, false); assert.equal(b.success, true); assert.equal(h.metrics.transfers, 1);
    await release(h, b); h.context.clearOnlineCache();
  });
  await check('window pruning removes old originals and compatibility copies but preserves current readers and manual downloads', async () => {
    const h = load(); window(h, 10); const first = await prepare(h, 5), kept = await prepare(h, 10);
    const old = h.run("onlineCache.get('disk:auto:v5')"), current = h.run("onlineCache.get('disk:auto:v10')");
    const manual = path.join(h.root, 'manual.mp4'); fs.writeFileSync(manual, 'manual');
    const compat = h.context.compatPathFor('S', 5); fs.writeFileSync(compat, Buffer.alloc(4096));
    fs.writeFileSync(compat + '.json', JSON.stringify({ vid: 'v5', seriesId: 'S', vidIndex: 5, quality: 'auto' }));
    window(h, 15);
    assert.equal(h.run("onlineCache.has('disk:auto:v5')"), false); assert.equal(fs.existsSync(old.filePath), true, 'reader still owns the old file');
    assert.equal(fs.existsSync(current.filePath), true); assert.equal(fs.existsSync(compat), false); assert.equal(fs.readFileSync(manual, 'utf8'), 'manual');
    await release(h, first); assert.equal(fs.existsSync(old.filePath), false); await release(h, kept); h.context.clearOnlineCache();
  });
  await check('complete files survive restart and are probed before reuse without another transfer', async () => {
    const h = load(); window(h, 10); const first = await prepare(h, 10); await release(h, first);
    const restarted = load(h.root); window(restarted, 10); const next = await prepare(restarted, 10);
    assert.equal(next.success, true); assert.equal(next.cached, true); assert.equal(restarted.metrics.transfers, 0); assert.equal(restarted.metrics.probes, 1);
    await release(restarted, next); restarted.context.clearOnlineCache();
  });
  await check('same-size corrupt cache is rejected after restart and repaired', async () => {
    const h = load(); window(h, 10); const a = await prepare(h, 10); await release(h, a);
    const entry = h.run("onlineCache.get('disk:auto:v10')"); fs.writeFileSync(entry.filePath, Buffer.alloc(4096));
    const restarted = load(h.root); window(restarted, 10); const repaired = await prepare(restarted, 10);
    assert.equal(repaired.success, true); assert.equal(repaired.cached, false); assert.equal(restarted.metrics.transfers, 1);
    await release(restarted, repaired); restarted.context.clearOnlineCache();
  });
  await check('distant jump cancels pending work and leaves no partial disk file', async () => {
    const h = load(), gate = defer(); window(h, 10);
    h.context.requestMedia = async info => { await gate.promise; return h.response(info); };
    const pending = prepare(h, 10); await tick(); window(h, 25); gate.resolve(); const result = await pending;
    assert.equal(result.success, false); assert.equal(h.run('onlinePreparing.size'), 0);
    assert.deepEqual(fs.readdirSync(h.context.playbackCacheDir()), []);
    assert.equal((await prepare(h, 10)).success, false, 'out-of-window request must not fetch media');
  });
  await check('HLS from any provider uses disk preparation, including forced rebuild inputs', async () => {
    const h = load(); const signal = new AbortController().signal;
    for (const vid of ['xifan:v', 'hema:v', 'custom:id:v', '123']) {
      const entry = await h.context.prepareDiskEpisode(vid, 'S', '1080p', { vid, url: 'https://fixture.invalid/index.m3u8', format: 'hls' }, signal);
      assert.equal(entry.width, 1080); assert.equal(entry.buffer, undefined); h.context.disposeOnlineDisk(entry);
    }
    assert.equal(h.metrics.hls, 4);
  });
  await check('explicit quality rejects a lower resolution before cache publication', async () => {
    const h = load(); window(h, 10, '1080p'); const response = h.response;
    h.context.requestMedia = async info => response({ ...info, url: 'https://fixture.invalid/720p' });
    const result = await prepare(h, 10, '1080p'); assert.equal(result.success, false); assert.match(result.error, /清晰度/);
    assert.equal(h.run('onlineCache.size'), 0); assert.deepEqual(fs.readdirSync(h.context.playbackCacheDir()), []);
  });
  await check('explicit quality reuses a verified manual original without network or deletion', async () => {
    const h = load(); const original = path.join(h.root, 'manual-original.mp4'); fs.writeFileSync(original, Buffer.alloc(4096, 1));
    h.context.manualFile = original; h.run("downloadTasks = [{status:'completed',savePath:manualFile,hongguoInfo:{vid:'v10',series_id:'S',vid_index:10}}]");
    window(h, 10, '1080p'); const result = await prepare(h, 10, '1080p');
    assert.equal(result.success, true); assert.equal(h.metrics.transfers, 0); assert.equal(h.metrics.sources.length, 0);
    assert.equal(fs.existsSync(original), true); await release(h,result); h.context.clearOnlineCache(); assert.equal(fs.existsSync(original),true);
  });
  await check('a lower-resolution manual original cannot silently satisfy explicit playback quality', async () => {
    const h=load(), original=path.join(h.root,'manual-low.mp4'), bytes=Buffer.alloc(4096,1);bytes[1]=7;fs.writeFileSync(original,bytes);
    h.context.manualFile=original;h.run("downloadTasks=[{status:'completed',savePath:manualFile,hongguoInfo:{vid:'v10',series_id:'S',vid_index:10}}]");
    window(h,10,'1080p');const result=await prepare(h,10,'1080p');assert.equal(result.success,true);assert.equal(result.width,1080);assert.equal(h.metrics.transfers,1);
    await release(h,result);h.context.clearOnlineCache();assert.equal(fs.readFileSync(original)[1],7);
  });
  await check('window validation rejects oversized, duplicate and invalid episode descriptors', () => {
    assert.throws(() => policy.windowEntries({ seriesId: 'S', vidIndex: 1, episodes: [{vid:'a',vidIndex:1},{vid:'b',vidIndex:1}] }));
    assert.throws(() => policy.windowEntries({ seriesId: 'S', vidIndex: -1, episodes: [] }));
    assert.throws(() => policy.windowEntries({ seriesId: 'S', vidIndex: 1, quality: '4k', episodes: [] }));
  });
  process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => roots.forEach(root => fs.rmSync(root, {recursive:true,force:true})));
