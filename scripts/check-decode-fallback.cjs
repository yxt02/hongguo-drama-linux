// Player integration tests for automatic decode-failure repair (no real media).
// Linux distinguishes stalled decoding from a dark scene or an interrupted clock.
const assert = require('node:assert/strict');
const { mount } = require('./check-player-resume.cjs');

const source = ui => ui.find(n => n.type === 'video').props.src;

(async () => {
  let failures = 0;
  const test = async (name, fn) => {
    if (process.argv[2] && !name.includes(process.argv[2])) return;
    try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures++; console.error(`FAIL ${name}: ${e.stack}`); }
  };

  await test('a stalled decoder with an advancing clock falls back once', async () => {
    const ui = mount({ props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      prepare: async () => ({ success: true, url: 'hongguo-stream://black' }) });
    await ui.flush();
    ui.metadata();            // 播放起来后守卫开始采样
    ui.media.webkitDecodedFrameCount = 0;
    assert.equal(ui.transcodes.length, 0);
    for (let i = 0; i < 8; i++) {
      ui.media.currentTime = 1 + i * 0.9;
      if (!ui.decodeTick()) break; // 守卫命中后自行解除
      await ui.flush();
    }
    assert.equal(ui.transcodes.length, 1, 'decoder stall must trigger one auto transcode');
    assert.equal(ui.transcodes[0].vidIndex, 1);
    await ui.flush();
    assert.equal(source(ui), 'file:///mock-compat.mp4', 'playback must switch to the H.264 compat media');
    ui.unmount();
  });

  await test('dark scenes with advancing frames keep playing', async () => {
    const ui = mount({ props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } } });
    await ui.flush();
    ui.metadata();
    ui.setFrameLuma(0);
    for (let i = 0; i < 8; i++) {
      ui.media.currentTime = 1 + i * 0.9;
      ui.media.webkitDecodedFrameCount = i * 20;
      ui.decodeTick();
      await ui.flush();
    }
    assert.equal(ui.transcodes.length, 0, 'healthy picture must not be transcoded');
    ui.unmount();
  });

  await test('undecodable HEVC transcodes first instead of playing a black screen', async () => {
    const ui = mount({ props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      prepare: async () => ({ success: true, url: 'hongguo-stream://hevc', codec: 'bytevc1' }) });
    ui.setHevcAnswer('');     // 本机明确不支持 HEVC
    await ui.flush();
    assert.equal(ui.transcodes.length, 1, 'HEVC with no platform support must transcode before playing');
    assert.equal(ui.transcodes[0].vidIndex, 1);
    assert.equal(ui.prepares.length, 1);
    await ui.flush();
    assert.equal(source(ui), 'file:///mock-compat.mp4');
    ui.unmount();
  });

  await test('decodable HEVC still plays directly', async () => {
    const ui = mount({ props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      prepare: async () => ({ success: true, url: 'hongguo-stream://hevc', codec: 'hevc' }) });
    ui.setHevcAnswer('probably');
    await ui.flush();
    assert.equal(ui.transcodes.length, 0, 'supported HEVC must play as-is');
    assert.equal(source(ui), 'hongguo-stream://hevc');
    ui.unmount();
  });

  await test('H.264 sources play directly even when HEVC is unsupported', async () => {
    const ui = mount({ props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } },
      prepare: async () => ({ success: true, url: 'hongguo-stream://h264', codec: 'h264' }) });
    ui.setHevcAnswer('');
    await ui.flush();
    assert.equal(ui.transcodes.length, 0, 'H.264 must never take the HEVC fast-transcode path');
    assert.equal(source(ui), 'hongguo-stream://h264');
    ui.unmount();
  });

  await test('buffering, seeks and pause clear accumulated decoder-stall evidence', async () => {
    const ui = mount({ props: { target: { seriesId: 'A', vidIndex: 1 } } });
    await ui.flush(); ui.metadata();
    ui.media.webkitDecodedFrameCount = 4;
    for (const transition of ['waiting', 'seeking', 'paused']) {
      for (let i = 0; i < 5; i++) { ui.media.currentTime += 0.9; ui.decodeTick(); }
      const props = ui.find(n => n.type === 'video').props;
      if (transition === 'waiting') { ui.media.readyState = 2; props.onWaiting(); }
      if (transition === 'seeking') { ui.media.seeking = true; props.onSeeking(); }
      if (transition === 'paused') { ui.media.paused = true; props.onPause(); }
      for (let i = 0; i < 8; i++) { ui.media.currentTime += 0.9; ui.decodeTick(); }
      ui.media.readyState = 4; ui.media.seeking = false; ui.media.paused = false;
      await ui.flush();
      assert.equal(ui.transcodes.length, 0);
    }
    ui.unmount();
  });

  await test('decode watch stops when playback is reset', async () => {
    const ui = mount({ props: { target: { seriesId: 'A', vidIndex: 1, ts: 1 } } });
    await ui.flush();
    ui.metadata();
    assert.equal(ui.decodeTick(), true, 'watchdog must be armed while playing');
    ui.props.target = { seriesId: 'A', vidIndex: 2, ts: 2 }; // 换集触发 resetPlayback
    await ui.flush();
    assert.equal(ui.decodeTick(), false, 'watchdog must disarm when the media version changes');
    ui.unmount();
  });

  process.exitCode = failures ? 1 : 0;
})();
