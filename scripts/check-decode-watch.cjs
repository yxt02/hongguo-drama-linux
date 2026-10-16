// Unit tests for the playback decode guard (no DOM, media, or network).
// Covers the "black screen with sound" auto-repair logic: the reason the
// default decode path used to require a manual switch to H.264.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const source = transformSync(fs.readFileSync(path.join(__dirname, '../src/decodeWatch.js'), 'utf8'), { loader: 'js', format: 'cjs' }).code;
const mod = { exports: {} };
vm.runInNewContext(source, { module: mod, exports: mod.exports });
const {
  BLACK_SAMPLES_TO_FAIL, NO_PIC_SAMPLES_TO_FAIL, MIN_ADVANCE_SECONDS,
  createDecodeGuard, createFrameSampler, isHevcCodec, probeHevcSupport, shouldTranscodeFirst,
} = mod.exports;

// 32x18 RGBA canvas whose every pixel carries the given luma value.
const flatDoc = (luma, { readThrows = false, noCanvas = false } = {}) => ({
  createElement: (tag) => {
    if (tag !== 'canvas' || noCanvas) return { getContext: () => null };
    return {
      width: 0, height: 0,
      getContext: () => ({
        drawImage() {},
        getImageData: () => {
          if (readThrows) throw new Error('tainted canvas');
          const data = new Uint8ClampedArray(32 * 18 * 4);
          data.fill(Math.max(0, Math.min(255, Math.round(luma))));
          return { data };
        },
      }),
    };
  },
});

(async () => {
  let failures = 0;
  const test = async (name, fn) => {
    if (process.argv[2] && !name.includes(process.argv[2])) return;
    try { await fn(); console.log(`PASS ${name}`); } catch (e) { failures++; console.error(`FAIL ${name}: ${e.stack}`); }
  };

  await test('codec family classifies HEVC spellings only', () => {
    for (const codec of ['hevc', 'HEVC', 'h265', 'hvc1', 'hev1', 'bytevc1', 'h265_hvc1']) {
      assert.equal(isHevcCodec(codec), true, codec);
    }
    for (const codec of ['h264', 'avc', 'avc1', '', undefined, null, 'vp9']) {
      assert.equal(isHevcCodec(codec), false, String(codec));
    }
  });

  await test('platform probe reports canPlayType and MediaSource answers', () => {
    assert.equal(probeHevcSupport(() => ({ canPlayType: () => 'probably' }), null), 'probably');
    assert.equal(probeHevcSupport(() => ({ canPlayType: () => 'maybe' }), null), 'maybe');
    assert.equal(probeHevcSupport(() => ({ canPlayType: () => '' }), null), 'no');
    assert.equal(probeHevcSupport(() => { throw new Error('boom'); }, null), 'unknown');
    assert.equal(probeHevcSupport(null, null), 'unknown');
    assert.equal(probeHevcSupport(() => ({ canPlayType: () => '' }), { isTypeSupported: t => t.includes('hev1') }), 'probably');
    assert.equal(probeHevcSupport(() => ({ canPlayType: () => '' }), { isTypeSupported: () => false }), 'no');
  });

  await test('transcode-first triggers only for undecodable HEVC', () => {
    assert.equal(shouldTranscodeFirst('bytevc1', 'no'), true);
    assert.equal(shouldTranscodeFirst('hevc', 'no'), true);
    assert.equal(shouldTranscodeFirst('hevc', 'probably'), false);
    assert.equal(shouldTranscodeFirst('hevc', 'unknown'), false);
    assert.equal(shouldTranscodeFirst('h264', 'no'), false);
    assert.equal(shouldTranscodeFirst('', 'no'), false);
  });

  await test('frame sampler measures average luminance of the video frame', () => {
    assert.equal(createFrameSampler(flatDoc(0)).sample({}), 0);
    assert.equal(createFrameSampler(flatDoc(255)).sample({}), 255);
    assert.equal(createFrameSampler(flatDoc(10)).sample({}), 10);
  });

  await test('frame sampler returns null when the canvas is unusable', () => {
    assert.equal(createFrameSampler(flatDoc(10, { readThrows: true })).sample({}), null);
    assert.equal(createFrameSampler(flatDoc(10, { noCanvas: true })).sample({}), null);
    assert.equal(createFrameSampler({ createElement: () => { throw new Error('no dom'); } }).sample({}), null);
  });

  await test('no-picture for three samples past 0.3s fails decoding', () => {
    const guard = createDecodeGuard();
    assert.equal(guard.push({ currentTime: 0.4, paused: false, videoWidth: 0, luma: null }), 'watch');
    assert.equal(guard.push({ currentTime: 0.7, paused: false, videoWidth: 0, luma: null }), 'watch');
    assert.equal(guard.push({ currentTime: 1.0, paused: false, videoWidth: 0, luma: null }), 'fail-no-picture');
    assert.equal(guard.verdict, 'fail-no-picture');
  });

  await test('no-picture before 0.3s of playback never fails', () => {
    const guard = createDecodeGuard();
    for (let i = 0; i < NO_PIC_SAMPLES_TO_FAIL + 3; i++) {
      assert.equal(guard.push({ currentTime: 0.25, paused: false, videoWidth: 0, luma: null }), 'watch');
    }
    assert.equal(guard.verdict, null);
  });

  await test('black screen with sound over sustained playback fails decoding', () => {
    const guard = createDecodeGuard();
    const sample = (time, audioBytes) => ({ currentTime: time, paused: false, videoWidth: 720, luma: 0, videoDecodedBytes: 100, audioDecodedBytes: audioBytes });
    let verdict = 'watch';
    for (let i = 0; i < BLACK_SAMPLES_TO_FAIL; i++) {
      verdict = guard.push(sample(1 + i * 0.9, 1000 + i * 500));
    }
    assert.equal(verdict, 'fail-black-screen');
  });

  await test('black frames with frozen audio counters are treated as stalled, not black-screen', () => {
    const guard = createDecodeGuard();
    const sample = (time) => ({ currentTime: time, paused: false, videoWidth: 720, luma: 0, videoDecodedBytes: 100, audioDecodedBytes: 0 });
    for (let i = 0; i < BLACK_SAMPLES_TO_FAIL + 2; i++) {
      assert.equal(guard.push(sample(1 + i * 0.9)), 'watch');
    }
    assert.equal(guard.verdict, null);
  });

  await test('black frames without audio counters still fail once playback advances', () => {
    const guard = createDecodeGuard();
    let verdict = 'watch';
    for (let i = 0; i < BLACK_SAMPLES_TO_FAIL; i++) {
      verdict = guard.push({ currentTime: 1 + i * 0.9, paused: false, videoWidth: 720, luma: 0 });
    }
    assert.equal(verdict, 'fail-black-screen');
  });

  await test('black frames without playback advance never fail (frozen frame)', () => {
    const guard = createDecodeGuard();
    for (let i = 0; i < BLACK_SAMPLES_TO_FAIL + 2; i++) {
      assert.equal(guard.push({ currentTime: 2, paused: false, videoWidth: 720, luma: 0 }), 'watch');
    }
    assert.equal(guard.verdict, null);
  });

  await test('a visible frame disables color-only detection but keeps monitoring', () => {
    const guard = createDecodeGuard();
    assert.equal(guard.push({ currentTime: 1, paused: false, videoWidth: 720, luma: 40 }), 'healthy');
    for (let i = 0; i < BLACK_SAMPLES_TO_FAIL + 2; i++) {
      assert.equal(guard.push({ currentTime: 1.5 + i * 0.9, paused: false, videoWidth: 720, luma: 0 }), 'watch');
    }
  });

  await test('a visible frame reports health without ending the watch', () => {
    const guard = createDecodeGuard();
    const push = (time, luma) => guard.push({ currentTime: time, paused: false, videoWidth: 720, luma, audioDecodedBytes: 100 + time * 10 });
    assert.equal(push(1, 0), 'watch');
    assert.equal(push(1.9, 0), 'watch');
    assert.equal(push(2.8, 5), 'healthy', 'anything above pure black means the decoder produces picture');
    assert.equal(guard.verdict, null);
  });

  await test('a later frozen picture with advancing audio is detected after healthy playback', () => {
    const guard = createDecodeGuard();
    assert.equal(guard.push({ currentTime: 1, paused: false, videoWidth: 720, luma: 60, videoDecodedBytes: 100, audioDecodedBytes: 100 }), 'healthy');
    let verdict;
    for (let i = 1; i <= BLACK_SAMPLES_TO_FAIL; i++) verdict = guard.push({ currentTime: 1 + i * 0.9,
      paused: false, videoWidth: 720, luma: 60, videoDecodedBytes: 100, audioDecodedBytes: 100 + i * 10 });
    assert.equal(verdict, 'fail-no-picture');
  });
  await test('normal dark scenes with advancing video counters do not trigger repair', () => {
    const guard = createDecodeGuard();
    guard.push({ currentTime: 1, paused: false, videoWidth: 720, luma: 60, videoDecodedBytes: 100, audioDecodedBytes: 100 });
    for (let i = 1; i <= 20; i++) assert.equal(guard.push({ currentTime: 1 + i * 0.9, paused: false,
      videoWidth: 720, luma: 0, videoDecodedBytes: 100 + i * 20, audioDecodedBytes: 100 + i * 10 }), 'watch');
  });

  await test('paused samples are ignored entirely', () => {
    const guard = createDecodeGuard();
    for (let i = 0; i < BLACK_SAMPLES_TO_FAIL + 2; i++) {
      assert.equal(guard.push({ currentTime: 1 + i, paused: true, videoWidth: 0, luma: 0 }), 'watch');
    }
    assert.equal(guard.verdict, null);
  });

  await test('missing or invalid samples are ignored', () => {
    const guard = createDecodeGuard();
    assert.equal(guard.push(null), 'watch');
    assert.equal(guard.push({ currentTime: 1 }), 'watch');
    assert.equal(guard.push({ currentTime: 'x', paused: false, videoWidth: 720, luma: 0 }), 'watch');
  });

  await test('video bytes stuck at zero while audio decodes fails as no-picture', () => {
    const guard = createDecodeGuard();
    const sample = (time) => ({ currentTime: time, paused: false, videoWidth: 720, luma: null, videoDecodedBytes: 0, audioDecodedBytes: 5000 });
    assert.equal(guard.push(sample(0.3)), 'watch', 'too early to judge');
    assert.equal(guard.push(sample(0.8)), 'watch');
    assert.equal(guard.push(sample(1.3)), 'watch');
    assert.equal(guard.push(sample(1.8)), 'fail-no-picture');
  });

  await test('black probing can be disabled for known-compatible codecs', () => {
    const guard = createDecodeGuard({ blackProbeEnabled: false });
    let verdict = 'watch';
    for (let i = 0; i < BLACK_SAMPLES_TO_FAIL + 2; i++) {
      verdict = guard.push({ currentTime: 1 + i * 0.9, paused: false, videoWidth: 720, luma: 0, audioDecodedBytes: 100 + i });
    }
    assert.equal(verdict, 'watch');
    assert.equal(guard.verdict, null);
    // 无画面判定仍然生效
    assert.equal(guard.push({ currentTime: 3, paused: false, videoWidth: 0, luma: 0 }), 'watch');
    assert.equal(guard.push({ currentTime: 3.5, paused: false, videoWidth: 0, luma: 0 }), 'watch');
    assert.equal(guard.push({ currentTime: 4, paused: false, videoWidth: 0, luma: 0 }), 'fail-no-picture');
  });

  await test('black streak must span the minimum playback advance', () => {
    const guard = createDecodeGuard();
    let verdict = 'watch';
    // 6 次纯黑采样但播放时间只推进 < MIN_ADVANCE_SECONDS
    for (let i = 0; i < BLACK_SAMPLES_TO_FAIL; i++) {
      verdict = guard.push({ currentTime: 1 + i * (MIN_ADVANCE_SECONDS / BLACK_SAMPLES_TO_FAIL) * 0.5, paused: false, videoWidth: 720, luma: 0 });
    }
    assert.equal(verdict, 'watch', 'streak too short in playback time must not fail');
    assert.equal(guard.verdict, null);
  });

  process.exitCode = failures ? 1 : 0;
})();
