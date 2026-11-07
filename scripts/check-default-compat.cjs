const assert = require('node:assert/strict');
const { mount } = require('./check-player-resume.cjs');
const target = { target: { seriesId: 'A', vidIndex: 1 } };

(async () => {
  const automatic = mount({ settings: { playback_decode_mode: undefined }, props: target });
  await automatic.flush();
  assert.equal(automatic.transcodes.length, 0);
  assert.equal(automatic.prepares.length, 1);
  assert.ok(automatic.button('本剧：自动解码'));
  automatic.unmount();

  const local = mount({ local: true, settings: { playback_decode_mode: undefined } });
  await local.flush();
  assert.equal(local.transcodes.length, 0);
  assert.equal(local.find(n => n.type === 'video').props.src, 'file:///mock-1.mp4');
  local.unmount();

  let readSettings;
  const settings = new Promise(resolve => { readSettings = resolve; });
  const storage = new Map(), savedMode = mount({ storage, local: true, props: target,
    apiOverrides: { getSettings: () => settings } });
  await savedMode.flush();
  assert.equal(savedMode.transcodes.length, 0);
  assert.equal(savedMode.find(n => n.type === 'video').props.src, undefined, 'wait for settings before loading the first source');
  readSettings({ playback_decode_mode: 'h264' });
  await savedMode.flush();
  assert.equal(savedMode.transcodes.length, 1, 'explicit global H.264 governs first playback');
  savedMode.button('本剧：兼容解码').props.onClick();
  savedMode.unmount();

  const restored = mount({ storage, settings: { playback_decode_mode: 'h264' }, props: target });
  await restored.flush();
  assert.equal(restored.transcodes.length, 0, 'explicit series auto overrides global H.264 after restart');
  restored.unmount();

  const h264 = mount({ settings: { playback_decode_mode: 'h264' }, props: target,
    prepare: () => ({ success: true, url: 'hongguo-stream://h264', codec: 'h264', directH264: true }) });
  await h264.flush();
  assert.equal(h264.transcodes.length, 0, 'validated H.264 is reused even in compatibility mode');
  assert.equal(h264.find(n => n.type === 'video').props.src, 'hongguo-stream://h264');
  h264.metadata(); h264.media.currentTime = 16; h264.media.pause(); h264.error(3);
  await h264.flush(); h264.metadata();
  assert.equal(h264.transcodes[0].reason, 'decode-error');
  assert.equal(h264.media.currentTime, 16);
  assert.equal(h264.media.paused, true);
  h264.unmount();

  const otherPlatform = mount({ settings: { playback_decode_mode: undefined }, props: target,
    apiOverrides: { platform: 'win32' } });
  await otherPlatform.flush();
  assert.equal(otherPlatform.transcodes.length, 1);
  assert.equal(otherPlatform.prepares.length, 0);
  otherPlatform.unmount();
  console.log('PASS Linux default direct playback, saved settings, per-series override, validated H.264 and non-Linux default');
})().catch(e => { console.error(e); process.exitCode = 1; });
