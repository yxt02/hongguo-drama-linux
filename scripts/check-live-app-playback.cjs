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

const knownEpisode = { seriesId: '7516411117833292825', vid: '7516512118569454654', vidIndex: 4,
  quality: '1080p', source: 'app' };

(async () => {
  const lateEpisodes = process.env.HONGGUO_LIVE_LATE === '1';
  const provider = req('./src/native/hongguo');
  let cases = process.env.HONGGUO_LIVE_CASES ? JSON.parse(process.env.HONGGUO_LIVE_CASES) : [knownEpisode];
  if (lateEpisodes && !process.env.HONGGUO_LIVE_CASES) {
    const series = [
      { seriesId: '7690112243203050521', episodeNumbers: [6, 12], quality: 'auto' },
      { seriesId: '7516411117833292825', episodeNumbers: [6], quality: '1080p' },
    ];
    // A known numeric ID isolates App playback from any upstream catalogue change.
    const fixed = async () => {
      const source = await provider.fetchPlayUrlSingle(knownEpisode.vid, knownEpisode.seriesId,
        { quality: knownEpisode.quality, force: true });
      const passed = source.source === 'app' && !!source.url && Math.min(source.width, source.height) >= 1080;
      console.log(JSON.stringify({ stage: 'fixed-episode-source', passed, series: knownEpisode.seriesId,
        episode: knownEpisode.vidIndex, route: source.sourceProvider, attempts: source.attempts || [] }));
      assert.ok(passed, source.error || 'Fixed episode has no App 1080p source');
    };
    const results = await Promise.allSettled([fixed(), ...series.map(async ({ seriesId, episodeNumbers, quality }) => {
      try {
        const catalog = await provider.fetchEpisodeList(seriesId, { deadline: Date.now() + 24000, force: true });
        assert.equal(catalog.source, 'app', 'Expected the App detail endpoint to recover the directory');
        assert.ok(catalog.total > 12);
        assert.ok(catalog.episodes.every((ep, index) => /^\d+$/.test(ep.vid) && ep.vid_index === index + 1));
        const selected = episodeNumbers.map(number => {
          const ep = catalog.episodes[number - 1];
          assert.ok(ep && !ep.locked, `Episode ${number} is not available in the App directory`);
          return { seriesId, vid: ep.vid, vidIndex: ep.vid_index, contentType: ep.content_type, quality, source: 'app' };
        });
        console.log(JSON.stringify({ stage: 'episode-directory', passed: true, series: seriesId, total: catalog.total }));
        return selected;
      } catch (error) {
        console.log(JSON.stringify({ stage: 'episode-directory', passed: false, series: seriesId, error: error.message }));
        throw error;
      }
    })]);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
    assert.equal(errors.length, 0, errors.join('；'));
    cases = results.slice(1).flatMap(result => result.value);
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
      const sample = { series: selected.seriesId, episode: selected.vidIndex, requestedQuality: quality };
      const source = await provider.fetchPlayUrlSingle(selected.vid, selected.seriesId,
        { quality, force: true, contentType: selected.contentType });
      console.log(JSON.stringify({ stage: 'source-health', passed: !!source.url,
        ...sample, source: source.source || 'app', route: source.sourceProvider, width: source.width, height: source.height, codec: source.codec,
        attempts: source.attempts || [], failures: (source.sources || []).map(item => ({ source: item.source, code: item.code })) }));
      assert.ok(source.url, source.error || 'source-health failed');
      if (lateEpisodes) {
        assert.equal(source.source, 'app');
        assert.ok(['app-current', 'app-player', 'app-legacy'].includes(source.sourceProvider));
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
      console.log(JSON.stringify({ passed: true, stage: 'prepared-media', ...sample, source: entry.mediaSource,
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
        console.log(JSON.stringify({ passed: true, stage: 'h264-playback', ...sample, source: entry.mediaSource,
          width: probe.width, height: probe.height, codec: probe.codec_name, decodedSeconds: 3, range: 206 }));
      }
      const output = path.join(temp, `manual-${index}.mp4`);
      context.liveTask = { id: `live-task-${index}`, type: 'hongguo', status: 'pending', downloadQuality: quality,
        savePath: output, filename: `manual-${index}.mp4`, customDir: temp,
        hongguoInfo: { vid: selected.vid, vid_index: selected.vidIndex, series_id: selected.seriesId,
          series_title: 'live-check', content_type: selected.contentType } };
      vm.runInContext('downloadTasks = [liveTask]', context);
      await context.executeHongguoDownload(context.liveTask);
      assert.equal(context.liveTask.status, 'completed', context.liveTask.error);
      await decode(output);
      if (lateEpisodes) assert.ok(parseInt(context.liveTask.actualQuality, 10) >= 720);
      console.log(JSON.stringify({ passed: true, stage: 'manual-download', ...sample,
        quality: context.liveTask.actualQuality, bytes: fs.statSync(output).size }));
    }
  } finally {
    context.clearOnlineCache?.();
    await fsp.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(JSON.stringify({ passed: false, error: error.message })); process.exitCode = 1; });
