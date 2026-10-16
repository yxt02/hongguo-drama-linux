// Offline UI behavior: bounded prefetch, quality changes, cancellation, and manual download preservation.
const assert = require('node:assert/strict');
const { mount } = require('./check-player-resume.cjs');
const target = n => ({ target: { seriesId: 'A', vidIndex: n, ts: 1 } });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
(async () => {
  const ui = mount({ episodeCount: 20, props: target(10), settings: { cache_next_episode: false, compat_mode: false, auto_delete_watched: true } });
  await ui.flush(); ui.metadata(); await ui.flush(); await ui.flush();
  assert.equal(ui.button('缓存下一集'), undefined);
  assert.equal(ui.button('看完自动删'), undefined);
  assert.equal(ui.button('兼容模式'), undefined);
  const prefetched = ui.prepares.filter(p => p.prefetch);
  assert.equal(prefetched.length, 10);
  assert.deepEqual(prefetched.map(p => p.vidIndex), [11, 12, 13, 14, 15, 9, 8, 7, 6, 5]);
  assert.ok(ui.prepares.every(p => p.disk && p.quality === 'auto'));
  assert.ok(ui.windows.every(w => w.episodes.length <= 11));
  assert.ok(prefetched.every(p => ui.releases.some(r => r.requestId === p.requestId)), 'finished prefetch must release its session');
  ui.find(n => n.type === 'video').props.onTimeUpdate({ currentTarget: ui.media }); await ui.flush();
  assert.equal(ui.prepares.filter(p => p.prefetch).length, 10, 'time events must not duplicate downloads');
  ui.episode(16); await ui.flush(); ui.metadata(); await ui.flush(); await ui.flush();
  assert.deepEqual(ui.windows.at(-1).episodes.map(e => e.vidIndex), [11,12,13,14,15,16,17,18,19,20]);
  ui.unmount();
  console.log('PASS window radius, future-first order, legacy setting migration and session release');

  const gates = new Map(); let active = 0, peak = 0;
  const bounded = mount({ episodeCount: 20, props: target(10), prepare: p => {
    if (!p.prefetch) return { success: true, url: 'hongguo-stream://foreground' };
    const gate = deferred(); gates.set(p.requestId, gate); active++; peak = Math.max(peak, active);
    return gate.promise.finally(() => active--);
  } });
  await bounded.flush(); bounded.metadata(); await bounded.flush();
  assert.equal(gates.size, 2); assert.equal(peak, 2);
  bounded.episode(1); await bounded.flush(); bounded.metadata(); await bounded.flush();
  assert.ok(bounded.releases.filter(r => gates.has(r.requestId)).length >= 2, 'jump must cancel out-of-window requests');
  for (const gate of gates.values()) gate.resolve({ success: false });
  await bounded.flush(); assert.equal(peak, 2, 'jump must not exceed two background workers');
  bounded.unmount(); for (const gate of gates.values()) gate.resolve({ success: false }); await bounded.flush();
  console.log('PASS bounded background concurrency and cancellation across distant episode jumps');

  const locked = mount({ episodeCount: 8, props: target(1), lockedIndexes: [2, 3] });
  await locked.flush(); locked.metadata(); await locked.flush();
  assert.ok(locked.prepares.filter(p => p.prefetch).every(p => ![2,3].includes(p.vidIndex)));
  locked.unmount();
  const local = mount({ local: true, episodeCount: 12, props: target(6) });
  await local.flush(); local.metadata(); await local.flush(); assert.equal(local.prepares.length, 0); local.unmount();
  console.log('PASS locked episodes and already downloaded originals are skipped');

  const quality = mount({ episodeCount: 3, props: target(1), settings: { playback_quality: '720p' } });
  await quality.flush(); quality.metadata(); quality.media.currentTime = 24; quality.media.pause(); await quality.flush();
  const selector = quality.find(n => n.type === 'select' && n.props.value === '720p');
  await selector.props.onChange({ target: { value: '1080p' } }); await quality.flush();
  assert.equal(quality.prepares.filter(p => !p.prefetch).at(-1).quality, '1080p');
  assert.equal(quality.settingsSaved.at(-1).playback_quality, '1080p');
  quality.metadata(); assert.equal(quality.media.currentTime, 24); assert.equal(quality.media.paused, true);
  quality.unmount();
  console.log('PASS changing quality updates playback, preserves position and persists the choice');
  const explicitLocal = mount({ local:true, props:target(1), settings:{playback_quality:'1080p'} });
  await explicitLocal.flush(); assert.equal(explicitLocal.prepares.filter(p=>!p.prefetch).at(-1).quality,'1080p','unverified local files must go through native resolution validation'); explicitLocal.unmount();
})().catch(error => { console.error(error); process.exitCode = 1; });
