// Opt-in live smoke: real providers/main IPC/media tools, isolated temporary app data.
// No captured device identity, URL or content key is printed or persisted by this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const exec = require('node:util').promisify(execFile);
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), file = path.join(root, 'main.js'), req = createRequire(file);

(async () => {
  const lateEpisodes = process.env.HONGGUO_LIVE_LATE === '1';
  const provider = req('./src/native/hongguo');
  let cases = process.env.HONGGUO_LIVE_CASES ? JSON.parse(process.env.HONGGUO_LIVE_CASES) : [
    { seriesId: '7516411117833292825', vid: '7516512118569454654', vidIndex: 4,
      quality: '1080p', source: 'app' },
  ];
  if (lateEpisodes && !process.env.HONGGUO_LIVE_CASES) {
    const seriesId = '7690112243203050521'; // Public fixture used in upstream's Linux 8.2 validation.
    const catalog = await provider.fetchEpisodeListFromWeb(seriesId, Date.now() + 12000);
    const rows = catalog.episodes.filter(ep => !ep.locked && ep.web_available === false && ep.vid_index >= 6);
    assert.ok(rows.length >= 2, 'Expected at least two later episodes outside the website preview range');
    cases = [rows[0], rows[Math.min(6, rows.length - 1)]].map(ep =>
      ({ seriesId, vid: ep.vid, vidIndex: ep.vid_index, quality: 'auto', source: 'app' }));
  }
  const compat = process.env.HONGGUO_LIVE_COMPAT === '1';
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hongguo-live-main-'));
  const handlers = {}, protocols = {}, app = new EventEmitter();
  const store = req('./src/store');
  const ffmpeg = path.join(root, 'build/ffmpeg/linux-x64/ffmpeg');
  const ffprobe = path.join(root, 'build/ffmpeg/linux-x64/ffprobe');
  Object.assign(app, { getVersion: () => 'live', getPath: name => name === 'downloads' ? path.join(temp, 'downloads') : temp,
    commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
  store.init(path.join(temp, 'data.json'));
  store.saveSettings({ root: path.join(temp, 'downloads'), proxy_mode: 'system' });
  const electron = { app, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    protocol: { registerSchemesAsPrivileged() {}, handle: (name, fn) => { protocols[name] = fn; } } };
  const context = vm.createContext({ require: name => name === 'electron' ? electron : req(name),
    __dirname: root, process, Buffer, URL, Response, Request, Headers, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} } });
  const decode = filePath => exec(ffmpeg, ['-v', 'error', '-i', filePath, '-t', '3', '-an', '-f', 'null', '-'],
    { timeout: 20000, maxBuffer: 65536 });
  try {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    context.registerLocalProtocol(); context.registerStreamProtocol();
    for (const [index, selected] of cases.entries()) {
      const quality = selected.quality || 'auto', requestId = `live-${index}`;
      const source = await provider.fetchPlayUrlSingle(selected.vid, selected.seriesId,
        { quality, force: true });
      console.log(JSON.stringify({ stage: 'source-health', passed: !!source.url,
        episode: selected.vidIndex, source: source.source || 'app', route: source.sourceProvider, width: source.width, height: source.height, codec: source.codec,
        failures: (source.sources || []).map(item => ({ source: item.source, code: item.code })) }));
      assert.ok(source.url, source.error || 'source-health failed');
      if (lateEpisodes) {
        assert.equal(source.sourceProvider, 'app-current');
        assert.ok(Math.min(source.width, source.height) >= 720, 'Expected an App HD source for the later episode');
      }
      const result = await handlers['prepare-online-play']({}, { ...selected, quality, disk: true, requestId });
      assert.ok(result.success, result.error);
      context.liveVid = selected.vid; context.liveQuality = quality;
      const entry = vm.runInContext('onlineCache.get(playbackCache.cacheKey(liveVid, liveQuality))', context);
      assert.equal(entry.mediaSource, selected.source || 'app');
      assert.ok(entry.width > 0 && entry.height > 0);
      if (lateEpisodes) assert.ok(Math.min(entry.width, entry.height) >= 720);
      if (quality !== 'auto') assert.ok(Math.min(entry.width, entry.height) >= parseInt(quality, 10));
      await decode(entry.filePath);
      const range = await protocols[new URL(result.url).protocol.slice(0, -1)](new Request(result.url, { headers: { Range: 'bytes=0-1023' } }));
      assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 1024);
      console.log(JSON.stringify({ passed: true, stage: 'prepared-media', source: entry.mediaSource,
        width: entry.width, height: entry.height, codec: entry.codec, bytes: entry.size, range: 206, decodedSeconds: 3 }));
      await handlers['release-online-play']({}, { streamId: result.streamId });
      context.clearOnlineCache();
      if (compat && (!lateEpisodes || index === 0)) {
        // Start from the same online entry point as a viewer with H.264 enabled.
        const converted = await handlers['transcode-for-playback']({}, { ...selected, quality, requestId: `live-compat-${index}` });
        assert.ok(converted.success, converted.error);
        const output = vm.runInContext(`mediaAccess.resolveLocal(${JSON.stringify(converted.url)})`, context);
        const probe = JSON.parse((await exec(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
          'stream=codec_name,width,height', '-of', 'json', output], { timeout: 10000 })).stdout).streams[0];
        assert.equal(probe.codec_name, 'h264'); assert.equal(probe.width, entry.width); assert.equal(probe.height, entry.height);
        await decode(output);
        const playback = await protocols['hongguo-local'](new Request(converted.url, { headers: { Range: 'bytes=0-1023' } }));
        assert.equal(playback.status, 206); assert.equal((await playback.arrayBuffer()).byteLength, 1024);
        console.log(JSON.stringify({ passed: true, stage: 'h264-playback', source: entry.mediaSource,
          width: probe.width, height: probe.height, codec: probe.codec_name, decodedSeconds: 3, range: 206 }));
      }
      const output = path.join(temp, `manual-${index}.mp4`);
      context.liveTask = { id: `live-task-${index}`, type: 'hongguo', status: 'pending', downloadQuality: quality,
        savePath: output, filename: `manual-${index}.mp4`, customDir: temp,
        hongguoInfo: { vid: selected.vid, vid_index: selected.vidIndex, series_id: selected.seriesId, series_title: 'live-check' } };
      vm.runInContext('downloadTasks = [liveTask]', context);
      await context.executeHongguoDownload(context.liveTask);
      assert.equal(context.liveTask.status, 'completed', context.liveTask.error);
      await decode(output);
      console.log(JSON.stringify({ passed: true, stage: 'manual-download', episode: selected.vidIndex,
        quality: context.liveTask.actualQuality, bytes: fs.statSync(output).size }));
    }
  } finally {
    context.clearOnlineCache?.();
    await fsp.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(JSON.stringify({ passed: false, error: error.message })); process.exitCode = 1; });
