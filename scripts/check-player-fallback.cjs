// In-memory Player behavior only; no real media, network, or user files.
const assert = require('node:assert/strict');
const { mount } = require('./check-player-resume.cjs');
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const source = ui => ui.find(n => n.type === 'video').props.src;
const alert = ui => ui.find(n => n.props.role === 'alert');
const poll = async ui => { await [...ui.timers.values()].find(t => t.delay === 2000).fn(); await ui.flush(); };
function fixture({ prepare, transcode, enqueue, quality = 'auto', initial = 'missing' } = {}) {
  const states = new Map([['A:1', initial]]), downloads = [], stops = [];
  const props = { target: { seriesId: 'A', vidIndex: 1, ts: 1 } };
  const ui = mount({ props, transcode, prepare: prepare || (async () => ({ success: false, error: '本集取源失败' })),
    settings: { download_quality: quality, cache_next_episode: false },
    apiOverrides: {
      getSeriesList: async () => [{ series_id: 'A' }, { series_id: 'B' }],
      getSeriesEpisodes: async sid => ({ success: true, data: { series_id: sid, total: 2,
        episodes: [1, 2].map(index => { const status = states.get(`${sid}:${index}`) || 'missing'; return {
          vid: `${sid}-${index}`, vid_index: index, status, taskId: status === 'missing' ? null : `task-${sid}-${index}`,
          ...(status === 'completed' ? { fileUrl: `file:///${sid}-${index}.mp4`, savePath: `/${sid}-${index}.mp4` } : {}),
        }; }),
      } }),
      downloadSingleEpisode: async (sid, index, quality) => {
        downloads.push({ sid, index, quality });
        if (enqueue) return enqueue(sid, index, quality);
        const existed = ['pending', 'downloading'].includes(states.get(`${sid}:${index}`));
        states.set(`${sid}:${index}`, 'pending'); return { success: true, count: existed ? 0 : 1 };
      },
      stopDownload: async id => { stops.push(id); return { success: true }; },
    },
  });
  return { ui, states, downloads, stops };
}

(async () => {
  let failures = 0;
  const test = async (name, fn) => { try { await fn(); console.log('PASS ' + name); } catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.stack); } };
  const startPrefetch = async f => {
    await f.ui.flush(); f.ui.metadata();
    const video = f.ui.find(n => n.type === 'video');
    video.props.onPlaying({ currentTarget: f.ui.media });
    video.props.onTimeUpdate({ currentTarget: f.ui.media });
    await f.ui.flush();
  };
  await test('switching to a prefetch that exhausted recovery shows the failure instead of re-fetching', async () => {
    const pending = defer();
    const f = fixture({ prepare: p => p.prefetch ? pending.promise : { success: true, url: 'hongguo-stream://' + p.vid } });
    await startPrefetch(f);
    assert.equal(f.ui.prepares.filter(p => p.prefetch).length, 1, '下一集预取已启动');
    f.ui.episode(2); await f.ui.flush();
    pending.resolve({ success: false, exhausted: true, error: '本集取源失败：App：播放接口返回空响应（会话快速更新仍在冷却，约 40 秒后可再试），请稍后重试。' });
    await f.ui.flush();
    assert.equal(f.ui.prepares.filter(p => p.vid === 'A-2').length, 1, '已耗尽恢复次数的预取不得立即重发取源');
    assert.match(String(alert(f.ui).children[0]), /空响应（会话快速更新仍在冷却/);
    await f.ui.button('重试本集').props.onClick(); await f.ui.flush();
    assert.equal(f.ui.prepares.filter(p => p.vid === 'A-2').length, 2, '手动重试仍会发起新一轮');
    f.ui.unmount();
  });
  await test('a promoted prefetch with a transient failure still retries in the foreground', async () => {
    const pending = defer();
    const f = fixture({ prepare: p => p.prefetch ? pending.promise : { success: true, url: 'hongguo-stream://' + p.vid } });
    await startPrefetch(f);
    f.ui.episode(2); await f.ui.flush();
    pending.resolve({ success: false, error: '网络连接失败' });
    await f.ui.flush();
    assert.equal(f.ui.prepares.filter(p => p.vid === 'A-2').length, 2, '非终态失败仍由前台补取一次');
    assert.equal(source(f.ui), 'hongguo-stream://A-2');
    f.ui.unmount();
  });
  await test('failed preparation chooses an independently completed manual download', async () => {
    const pending = defer(), f = fixture({ prepare: () => pending.promise }); await f.ui.flush();
    f.states.set('A:1', 'completed'); pending.resolve({ success: false, error: '缓存准备失败' }); await f.ui.flush();
    assert.equal(source(f.ui), 'file:///A-1.mp4'); assert.equal(f.downloads.length, 0); f.ui.unmount();
  });
  await test('failed cache never creates a permanent download or loops', async () => {
    const f = fixture(); await f.ui.flush(); assert(alert(f.ui)); assert.equal(f.downloads.length, 0);
    await poll(f.ui); await poll(f.ui); assert.equal(f.ui.prepares.length, 1); assert.equal(f.downloads.length, 0);
    await f.ui.button('重试本集').props.onClick(); await f.ui.flush();
    assert.equal(f.ui.prepares.length, 2); assert.equal(f.downloads.length, 0); f.ui.unmount();
  });
  await test('independent local completion clears the cache error and resumes playback', async () => {
    const f = fixture(); await f.ui.flush(); f.states.set('A:1', 'completed'); await poll(f.ui);
    assert.equal(source(f.ui), 'file:///A-1.mp4'); assert.equal(alert(f.ui), undefined); f.ui.unmount();
  });
  await test('retry chooses a refreshed local file without another network transfer', async () => {
    const f = fixture(); await f.ui.flush(); f.states.set('A:1', 'completed');
    await f.ui.button('重试本集').props.onClick(); await f.ui.flush();
    assert.equal(source(f.ui), 'file:///A-1.mp4'); assert.equal(f.ui.prepares.length, 1); f.ui.unmount();
  });
  for (const action of ['episode', 'series']) await test('late failed preparation cannot override ' + action, async () => {
    const pending = defer(), f = fixture({ prepare: p => p.vid === 'A-1' ? pending.promise : { success: true, url: 'hongguo-stream://' + p.vid } });
    await f.ui.flush();
    if (action === 'episode') f.ui.episode(2); else f.ui.props.target = { seriesId: 'B', vidIndex: 1, ts: 2 };
    await f.ui.flush(); const before = source(f.ui);
    pending.resolve({ success: false, error: 'late failure' }); await f.ui.flush();
    assert.equal(source(f.ui), before); assert.equal(f.downloads.length, 0); f.ui.unmount();
  });
  for (const code of [2, 4]) await test('exhausted error ' + code + ' preserves paused position for independent local completion', async () => {
    const f = fixture({ prepare: () => ({ success: true, url: 'hongguo-stream://current' }) });
    await f.ui.flush(); f.ui.metadata(); f.ui.media.currentTime = 29; f.ui.media.pause();
    f.ui.error(code); await f.ui.flush(); f.ui.metadata(); f.ui.error(code); await f.ui.flush();
    assert.equal(f.downloads.length, 0); assert(alert(f.ui));
    f.states.set('A:1', 'completed'); await poll(f.ui); f.ui.metadata();
    assert.equal(source(f.ui), 'file:///A-1.mp4'); assert.equal(f.ui.media.currentTime, 29); assert.equal(f.ui.media.paused, true); f.ui.unmount();
  });
  await test('known broken local media is not selected again after cache preparation fails', async () => {
    const f = fixture({ initial: 'completed' }); await f.ui.flush(); f.ui.metadata(); f.ui.media.currentTime = 18;
    f.ui.error(2); await f.ui.flush(); await poll(f.ui); assert(alert(f.ui));
    const before = f.ui.prepares.filter(p => !p.prefetch).length;
    await f.ui.button('重试本集').props.onClick(); await f.ui.flush();
    assert.equal(f.ui.prepares.filter(p => !p.prefetch).length, before + 1); assert.equal(f.downloads.length, 0); f.ui.unmount();
  });
  process.exitCode = failures ? 1 : 0;
})();
