// Real Player hooks and IPC calls, isolated from user data and network.
const assert = require('node:assert/strict');
const { mount } = require('./check-player-resume.cjs');
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node?.children?.map(text).join('') || '';

(async () => {
  const calls = [], pending = defer();
  const states = { 4: 'completed', 5: 'pending', 6: 'downloading', 10: 'failed' };
  const episodes = [10, 1, 7, 3, 9, 2, 4, 5, 6, 8].map(index => ({
    vid_index: index, vid: `v${index}`, status: states[index] || 'missing', locked: index === 8,
  }));
  const ui = mount({ props: { target: { seriesId: 'A', vidIndex: 3 } }, settings: { download_quality: '1080p' },
    apiOverrides: {
      getSeriesEpisodes: async () => ({ success: true, data: { series_id: 'A', episodes, total: 10 } }),
      downloadSingleEpisode: async (...args) => { calls.push(args); return calls.length === 1 ? pending.promise : { success: true, count: 1 }; },
    },
  });
  await ui.flush();
  const button = ui.button('下载后续未完成集');
  const batch = button.props.onClick();
  await button.props.onClick(); // Same render, before React disables the button.
  await ui.flush();
  assert.equal(calls.length, 1, 'rapid double click cannot enqueue a duplicate batch');
  assert.equal(ui.button('正在加入队列').props.disabled, true);
  ui.episode(1); await ui.flush();
  await ui.find(n => n.type === 'select' && n.props.value === '1080p').props.onChange({ target: { value: '720p' } });
  await ui.flush(); pending.resolve({ success: true, count: 1 }); await batch; await ui.flush();
  assert.deepEqual(calls, [['A', 7, '1080p'], ['A', 9, '1080p'], ['A', 10, '1080p']],
    'only unfinished episodes strictly after the clicked position, ordered numerically, with original quality');
  assert.match(text(ui.find(n => n.props.className === 'dm-toast dm-toast-success')), /新增 3 集/);
  ui.episode(10); await ui.flush(); await ui.button('下载后续未完成集').props.onClick(); await ui.flush();
  assert.equal(calls.length, 3, 'last episode never wraps back to the start');
  ui.unmount();
  console.log('PASS following-only downloads, completed/queued/locked exclusions, order, click guard and snapshot');

  const submitted = [];
  const partial = mount({ episodeCount: 4, apiOverrides: {
    downloadSingleEpisode: async (_sid, index) => {
      submitted.push(index);
      if (index === 2) throw new Error('测试写入失败');
      return { success: true, count: index === 3 ? 0 : 1 };
    },
  } });
  await partial.flush(); await partial.button('下载后续未完成集').props.onClick(); await partial.flush();
  assert.deepEqual(submitted, [2, 3, 4]);
  assert.equal(partial.button('下载后续未完成集').props.disabled, false);
  assert.match(text(partial.find(n => n.props.className === 'dm-toast dm-toast-success')), /2 集提交成功，1 集失败/);
  partial.unmount();
  console.log('PASS individual failure continues remaining episodes and unlocks the batch button');

  for (const mode of ['auto', undefined]) {
    const reason = '本集片源尺寸不满足所选清晰度（最高可用兼容片源 640×360）';
    const quality = mount({ props: { target: { seriesId: 'A', vidIndex: 1 } }, settings: { playback_decode_mode: mode, playback_quality: '1080p' },
      prepare: async () => ({ success: false, error: reason }),
      transcode: async p => p.quality === 'auto'
        ? { success: true, url: 'file:///available-h264.mp4', width: 640, height: 360 }
        : { success: false, error: reason },
    });
    await quality.flush(); await quality.flush();
    const alert = quality.find(n => n.props.role === 'alert');
    assert.equal(text(alert), reason, 'source failure must not gain an invented cache failure');
    assert.ok([...quality.prepares, ...quality.transcodes].every(p => p.quality === '1080p'), 'never silently downgrade');
    if (mode === undefined) {
      await quality.button('改用 App 最高可用画质').props.onClick(); await quality.flush();
      assert.equal(quality.transcodes.at(-1).quality, 'auto');
      assert.equal(quality.find(n => n.type === 'video').props.src, 'file:///available-h264.mp4');
      assert.equal(quality.settingsSaved.at(-1).playback_quality, 'auto');
    }
    quality.unmount();
  }
  console.log('PASS original source reason in automatic/H.264 modes; explicit user action can choose available App quality');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
