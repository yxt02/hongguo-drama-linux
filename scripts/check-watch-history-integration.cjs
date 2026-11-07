// Real main-process IPC and persistence; no network, real notifications or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const file = path.resolve(__dirname, '../main.js');
const req = createRequire(file);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-history-'));
const dataFile = path.join(root, 'store.json');
const store = req('./src/store');
store.init(dataFile);
const sid = '1000001';
const series = (total = 3) => ({ series_id: sid, series_title: '春日来信', total,
  episodes: Array.from({ length: total }, (_, i) => ({ vid: `video${i + 1}`, vid_index: i + 1 })) });
const sequel = { series_id: '1000002', series_title: '春日来信第二季' };
const clone = value => JSON.parse(JSON.stringify(value));
const app = new EventEmitter();
Object.assign(app, { getVersion: () => 'test', getPath: () => root,
  commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
const handlers = {}, events = [], notifications = [];
let fetchDetail, search;
class Notification extends EventEmitter {
  static isSupported() { return true; }
  constructor(options) { super(); this.options = options; }
  show() { notifications.push(this); }
}
const electron = { app, Notification, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
  protocol: { registerSchemesAsPrivileged() {} } };
const native = { fetchEpisodeList: id => fetchDetail(id) };
const context = vm.createContext({ require: name => name === 'electron' ? electron
  : name === './src/native/hongguo' ? native : name === './src/store' ? store : req(name),
  __dirname: path.dirname(file), process, Buffer, URL, Response, Request, Headers, AbortController,
  setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} } });
vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
context.sendToRenderer = (name, payload) => events.push({ name, payload: clone(payload) });
context.runSearchSniff = keyword => search(keyword);
const ipc = (name, ...args) => handlers[name]({}, ...args);
const rows = async () => (await ipc('get-watch-history')).results;
function reset(settings = {}) {
  store.saveSettings({ root, watch_sequels_enabled: false, ...settings });
  store.saveSeries([series(), { ...series(), series_id: '1000003', series_title: '仅打开' }]);
  store.savePlayback({});
  context.loadSeriesRegistry();
  fetchDetail = async id => { assert.equal(id, sid); return series(); };
  search = async () => ({ success: true, results: [] });
  events.length = notifications.length = 0;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
let failures = 0;
async function check(name, fn) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  try { reset(); await fn(); console.log('PASS ' + name); }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + error.message); }
}
(async () => {
  await check('history IPC saves only watched entries and persists resume positions', async () => {
    assert.equal((await rows()).length, 0);
    assert.equal((await ipc('save-playback-position', sid, 2, 17.5)).success, true);
    assert.equal((await ipc('save-playback-position', 'missing', 1, 0)).success, false);
    assert.equal((await ipc('save-playback-position', sid, 2, Infinity)).success, false);
    assert.equal((await ipc('save-playback-position', sid, 0, 1)).success, false);
    store.init(dataFile);
    const position = await ipc('get-playback-position', sid);
    assert.equal(position.vid_index, 2);
    assert.equal(position.currentTime, 17.5);
    assert.equal(await ipc('get-playback-position', 'missing'), null);
    const history = await rows();
    assert.equal(history.length, 1);
    assert.equal(history[0].series_id, sid);
    assert.equal(history[0].vid_index, 2);
    assert.equal(history[0].currentTime, 17.5);
  });
  await check('legacy watched episode survives saving a different episode and a seek alone is unmarked', async () => {
    const previous = store.getPlayback();
    store.savePlayback({ [sid]: { vid_index: 2, currentTime: 17.5, watched: true, updatedAt: Date.now() } });
    assert.equal((await ipc('save-playback-position', sid, 1, 43, false)).success, true);
    let position = await ipc('get-playback-position', sid);
    assert.equal(position.currentTime, 43);
    assert.deepEqual(clone(position.watched_indexes), [2]);
    await ipc('save-playback-position', sid, 3, 1, true);
    position = await ipc('get-playback-position', sid);
    assert.deepEqual(clone(position.watched_indexes), [2, 3]);
    store.savePlayback(previous);
  });
  await check('manual refresh updates stored episodes and preserves acknowledged updates', async () => {
    store.saveSettings({ root, watch_updates_enabled: false, watch_sequels_enabled: true });
    await ipc('save-playback-position', sid, 2, 12);
    fetchDetail = async () => series(5);
    search = async () => ({ success: true, results: [sequel] });
    const result = await ipc('refresh-watch-history');
    assert.equal(result.success, true);
    assert.equal(result.checked, 1, 'manual refresh must work when background checks are disabled');
    assert.equal(result.failed, 0);
    assert.equal(store.getSeries().find(item => item.series_id === sid).episodes.length, 5);
    assert.equal((await rows())[0].unreadEpisodes, 2);
    assert.equal((await rows())[0].sequels[0].series_id, sequel.series_id);
    assert.equal((await rows())[0].hasUpdates, true);
    await ipc('save-playback-position', sid, 3, 24);
    assert.equal((await rows())[0].hasUpdates, true, 'regular position saves must retain the red dot');
    assert.equal((await ipc('acknowledge-watch-updates', sid)).success, true);
    store.init(dataFile);
    await ipc('refresh-watch-history');
    assert.equal((await rows())[0].hasUpdates, false);
    assert.equal((await rows())[0].unreadEpisodes, 0);
    fetchDetail = async () => series(6);
    await ipc('refresh-watch-history');
    assert.equal((await rows())[0].unreadEpisodes, 1);
    assert.ok(events.some(event => event.name === 'watch-history-updated'));
  });
  await check('refresh never rolls back a save or acknowledgement during network waits', async () => {
    store.saveSettings({ root, watch_sequels_enabled: true });
    await ipc('save-playback-position', sid, 1, 10);
    const detail = deferred(), searching = deferred(), candidates = deferred();
    fetchDetail = () => detail.promise;
    search = () => { searching.resolve(); return candidates.promise; };
    const refreshing = ipc('refresh-watch-history');
    await ipc('save-playback-position', sid, 2, 22);
    detail.resolve(series(5));
    await searching.promise;
    await ipc('save-playback-position', sid, 3, 39);
    await ipc('acknowledge-watch-updates', sid);
    const latest = clone(store.getPlayback()[sid]);
    candidates.resolve({ success: true, results: [sequel] });
    assert.equal((await refreshing).checked, 1);
    const position = await ipc('get-playback-position', sid);
    assert.equal(position.vid_index, latest.vid_index);
    assert.equal(position.currentTime, latest.currentTime);
    assert.equal(position.updatedAt, latest.updatedAt);
    assert.equal(position.acknowledgedTotal, latest.acknowledgedTotal);
    assert.equal(position.unreadEpisodes, 2);
    assert.equal(position.sequels[0].series_id, sequel.series_id);
  });
  await check('acknowledging an older snapshot leaves later discoveries unread', async () => {
    store.saveSettings({ root, watch_sequels_enabled: true });
    await ipc('save-playback-position', sid, 1, 10);
    fetchDetail = async () => series(5);
    search = async () => ({ success: true, results: [sequel] });
    await ipc('refresh-watch-history');
    const viewed = (await rows())[0];
    const laterSequel = { series_id: '1000004', series_title: '春日来信第三季' };
    fetchDetail = async () => series(6);
    search = async () => ({ success: true, results: [sequel, laterSequel] });
    await ipc('refresh-watch-history');
    await ipc('acknowledge-watch-updates', sid, {
      total: viewed.total, sequelIds: viewed.sequels.map(item => item.series_id),
    });
    store.init(dataFile);
    const record = await ipc('get-playback-position', sid);
    assert.equal(record.acknowledgedTotal, 5);
    assert.equal(record.unreadEpisodes, 1);
    assert.ok(record.seenSequelIds.includes(sequel.series_id));
    assert.ok(!record.seenSequelIds.includes(laterSequel.series_id));
    assert.equal((await rows())[0].hasUpdates, true);
  });
  await check('background refresh preserves a longer dismissed registry until explicit resume', async () => {
    await ipc('save-playback-position', sid, 2, 31);
    store.getSeries().forEach(item => { item.dismissed = true; });
    store.saveSeries(store.getSeries());
    fetchDetail = async () => series(2);
    assert.equal((await ipc('refresh-watch-history')).checked, 1);
    const saved = store.getSeries().find(item => item.series_id === sid);
    assert.equal(saved.episodes.length, 3, 'a truncated source response must not remove cached episodes');
    assert.equal(saved.dismissed, true, 'background refresh must not restore a removed series');
    assert.equal((await ipc('play-series', { seriesId: sid, vidIndex: 2, resume: true })).success, true);
    assert.equal(store.getSeries().find(item => item.series_id === sid).dismissed, false);
    assert.equal(store.getSeries().find(item => item.series_id === '1000003').dismissed, true);
    assert.equal(events.at(-1).payload.payload.seriesId, sid);
    assert.equal(events.at(-1).payload.payload.resume, true);
  });
  await check('failed or empty detail responses preserve records and episode registry', async () => {
    await ipc('save-playback-position', sid, 2, 31);
    const original = clone(store.getSeries());
    for (const fail of [async () => { throw Error('source unavailable'); }, async () => ({ episodes: [] })]) {
      fetchDetail = fail;
      const result = await ipc('refresh-watch-history');
      assert.equal(result.failed, 1);
      assert.equal(result.checked, 0);
      assert.deepEqual(clone(store.getSeries()), original);
      const history = await rows();
      assert.equal(history.length, 1);
      assert.equal(history[0].currentTime, 31);
      assert.ok(history[0].lastCheckError);
    }
  });
  await check('failed sequel search retains known sequels and still applies new episodes', async () => {
    store.saveSettings({ root, watch_sequels_enabled: true });
    await ipc('save-playback-position', sid, 1, 10);
    search = async () => ({ success: true, results: [sequel] });
    await ipc('refresh-watch-history');
    await ipc('acknowledge-watch-updates', sid);
    fetchDetail = async () => series(4);
    search = async () => ({ success: false, error: 'search unavailable' });
    const result = await ipc('refresh-watch-history');
    assert.equal(result.checked, 1);
    assert.equal(result.failed, 1);
    const record = await ipc('get-playback-position', sid);
    assert.equal(record.unreadEpisodes, 1);
    assert.equal(record.sequels[0].series_id, sequel.series_id);
    assert.ok(record.seenSequelIds.includes(sequel.series_id));
    assert.match(record.lastCheckError, /search unavailable/);
  });
  await check('notifications are opt-in and deduplicated for episodes and sequels', async () => {
    await ipc('save-playback-position', sid, 1, 10);
    fetchDetail = async () => series(4);
    await ipc('refresh-watch-history');
    assert.equal(notifications.length, 0, 'default must not notify');
    store.saveSettings({ root, watch_notifications_enabled: true, watch_sequels_enabled: true });
    await ipc('refresh-watch-history');
    assert.equal(notifications.length, 0, 'enabling notifications must not replay old discoveries');
    fetchDetail = async () => series(5);
    await ipc('refresh-watch-history');
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].options.body, /5/);
    await ipc('refresh-watch-history');
    assert.equal(notifications.length, 1);
    search = async () => ({ success: true, results: [sequel] });
    await ipc('refresh-watch-history');
    assert.equal(notifications.length, 2);
    await ipc('acknowledge-watch-updates', sid);
    await ipc('refresh-watch-history');
    assert.equal(notifications.length, 2);
    store.saveSettings({ root, watch_notifications_enabled: false, watch_sequels_enabled: false });
    fetchDetail = async () => series(6);
    await ipc('refresh-watch-history');
    assert.equal(notifications.length, 2);
    assert.equal((await rows())[0].sequels.length, 0);
  });
  await check('play-series IPC forwards an explicit resume payload', async () => {
    assert.equal((await ipc('play-series', { seriesId: sid, vidIndex: 2, resume: true })).success, true);
    assert.deepEqual(events.at(-1), { name: 'navigate', payload: {
      page: 'player', payload: { seriesId: sid, vidIndex: 2, resume: true } } });
    await ipc('play-series', { seriesId: sid, vidIndex: 2, resume: 'true' });
    assert.equal(events.at(-1).payload.payload.resume, false);
  });
  if (failures) process.exitCode = 1;
})().finally(() => fs.rmSync(root, { recursive: true, force: true }));
