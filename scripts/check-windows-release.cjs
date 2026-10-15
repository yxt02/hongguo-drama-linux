// Run the single-file portable EXE on disposable Windows CI with an isolated profile and CC0 footage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const pkg = require('../package.json');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist/windows-verification');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-windows-'));
const packaged = path.join(root, 'dist/win-unpacked');
const profile = path.join(temp, 'profile');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(profile);
const result = { version: pkg.version, hostPlatform: process.platform, hostArch: process.arch, signed: false, checks: [] };
let child, socket, seq = 0;
const pending = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function pe64(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.toString('ascii', 0, 2), 'MZ');
  const pe = data.readUInt32LE(0x3c);
  assert.equal(data.readUInt32LE(pe), 0x4550);
  assert.equal(data.readUInt16LE(pe + 4), 0x8664, path.basename(file));
}
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const reply = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  assert(!reply.exceptionDetails, JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}
async function clickControl(label) {
  const point = await evaluate(`(async () => {
    const button = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)});
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await new Promise(requestAnimationFrame);
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function keyHandoff(key, code, expectedSource) {
  assert(await evaluate('!document.querySelector("video").paused && getComputedStyle(document.querySelector(".player-controls")).opacity === "0"'), 'Key handoff must begin during hidden-controls playback');
  await evaluate(`(() => {
    const video = document.querySelector('video');
    const originalSource = video.currentSrc;
    window.__keyHandoff = { key: ${JSON.stringify(key)}, trusted: false, ended: false, sourceChanged: false, nextPlaying: false, frames: 0, visibleFrames: 0, fullscreenLost: false };
    const result = window.__keyHandoff;
    const keydown = event => { if (event.key === result.key) result.trusted = event.isTrusted; };
    const ended = () => { result.ended = true; };
    window.addEventListener('keydown', keydown, true);
    video.addEventListener('ended', ended);
    window.__keyHandoffDone = (async () => {
      const deadline = performance.now() + 8000;
      try {
        while (performance.now() < deadline) {
          await new Promise(requestAnimationFrame);
          result.frames++;
          const controls = getComputedStyle(document.querySelector('.player-controls'));
          if (Number(controls.opacity) > 0 || controls.pointerEvents !== 'none') result.visibleFrames++;
          if (document.fullscreenElement !== document.querySelector('.player-stage')) result.fullscreenLost = true;
          result.sourceChanged ||= !!video.currentSrc && video.currentSrc !== originalSource;
          result.nextPlaying = result.sourceChanged && !video.paused && video.readyState >= 2 && video.currentTime > 0.7;
          if (result.nextPlaying) break;
        }
        result.source = video.currentSrc;
        return result;
      } finally {
        window.removeEventListener('keydown', keydown, true);
        video.removeEventListener('ended', ended);
      }
    })();
    return true;
  })()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  const state = await evaluate('window.__keyHandoffDone');
  assert(state.trusted && !state.ended && state.sourceChanged && state.nextPlaying, 'Real shortcut must switch without natural ended: ' + JSON.stringify(state));
  assert(state.frames > 0 && state.visibleFrames === 0 && !state.fullscreenLost, 'Shortcut must retain hidden controls/fullscreen every sampled frame: ' + JSON.stringify(state));
  if (expectedSource) assert.equal(state.source, expectedSource, key + ' must select the expected episode');
  return state;
}
(async () => {
  if (process.platform !== 'win32') {
    console.log('SKIP check-windows-release: 需要 Windows x64 与已构建的便携版 EXE');
    return;
  }
  assert.equal(process.platform, 'win32');
  assert.equal(process.arch, 'x64');
  const portable = path.join(root, `dist/${pkg.build.productName}-${pkg.version}-便携版.exe`);
  result.authenticode = execFileSync('pwsh.exe', ['-NoProfile', '-Command', '(Get-AuthenticodeSignature -LiteralPath $env:HONGGUO_VERIFY_EXE).Status.ToString()'], { encoding: 'utf8', env: { ...process.env, HONGGUO_VERIFY_EXE: portable } }).trim();
  assert.equal(result.authenticode, 'NotSigned');
  const exe = path.join(packaged, pkg.build.productName + '.exe');
  const ffmpeg = path.join(packaged, 'resources/bin/ffmpeg.exe');
  const ffprobe = path.join(packaged, 'resources/bin/ffprobe.exe');
  for (const file of [exe, ffmpeg, ffprobe]) pe64(file);
  result.checks.push('Portable payload: Electron/FFmpeg/FFprobe are PE x64');
  for (const file of ['LICENSE.txt', 'NOTICE.txt', 'THIRD-PARTY-NOTICES.md', 'LICENSE.electron.txt', 'LICENSES.chromium.html', 'resources/bin/WINDOWS-NOTICE.txt', 'resources/bin/WINDOWS-X264-LICENSE.txt', 'resources/bin/WINDOWS-MINGW-LICENSE.txt', 'resources/bin/WINDOWS-GCC-LICENSE.txt', 'resources/bin/COPYING.GPLv3']) assert(fs.statSync(path.join(packaged, file)).size > 20, file);
  result.checks.push('Application, Electron, Chromium, FFmpeg and x264 notices present');
  result.ffmpeg = execFileSync(ffmpeg, ['-version'], { encoding: 'utf8', windowsHide: true }).split('\n')[0];
  const mediaDir = path.join(temp, 'media');
  fs.mkdirSync(mediaDir);
  const sample = path.join(mediaDir, 'windows-sample.mp4');
  const response = await fetch('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');
  assert(response.ok, 'CC0 fixture download failed');
  const flower = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash('sha256').update(flower).digest('hex'), '0cd83d944a6ca7822b4a8306cecc60a36e859b041f6702c6a1ad9ead78924451');
  const original = path.join(mediaDir, 'flower-original.mp4'); fs.writeFileSync(original, flower);
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-stream_loop', '2', '-i', original, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-map', '0:v:0', '-map', '1:a:0', '-t', '15', '-vf', 'scale=640:360', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sample], { timeout: 30000, windowsHide: true });
  const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', sample], { encoding: 'utf8', windowsHide: true }));
  assert(probe.streams.some(s => s.codec_name === 'h264'));
  assert(probe.streams.some(s => s.codec_name === 'aac'));
  result.checks.push('Bundled FFmpeg encodes H.264/AAC; FFprobe reads output');
  const sid = 'windows-smoke';
  const secondSample = path.join(mediaDir, 'windows-sample-2.mp4');
  fs.copyFileSync(sample, secondSample);
  const fixtureEpisodes = [sample, secondSample].map((savePath, index) => ({ id: `fixture-${index + 1}`, status: 'completed', savePath, hongguoInfo: { series_id: sid, series_title: 'Windows verification', vid: `fixture-${index + 1}`, vid_index: index + 1 } }));
  fs.writeFileSync(path.join(profile, 'data.json'), JSON.stringify({ settings: { root: mediaDir, watch_updates_enabled: false, watch_sequels_enabled: false }, tasks: fixtureEpisodes, series: [{ series_id: sid, series_title: 'Windows verification', episodes: fixtureEpisodes.map(task => ({ ...task.hongguoInfo, title: 'CC0 flower footage' })) }] }));
  child = spawn(portable, ['--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9439', '--autoplay-policy=no-user-gesture-required'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 150; i++) {
    try { target = (await (await fetch('http://127.0.0.1:9439/json')).json()).find(t => t.type === 'page' && t.url.startsWith('file:')); } catch {}
    if (target) break;
    await delay(200);
  }
  assert(target, 'Packaged application did not open its renderer');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const call = pending.get(message.id); pending.delete(message.id);
    if (call) message.error ? call.reject(new Error(JSON.stringify(message.error))) : call.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  for (let i = 0; i < 50; i++) {
    if (await evaluate('Boolean(window.electronAPI && document.querySelector("#root")?.children.length)')) break;
    await delay(100);
  }
  const info = await evaluate('window.electronAPI.getAppInfo()');
  assert.equal(info.version, pkg.version); assert.equal(info.platform, 'win32');
  const settings = await evaluate('window.electronAPI.getSettings()');
  assert.equal(settings.root, mediaDir, 'Temporary profile must isolate all user state');
  assert(await evaluate('document.querySelector("#root").children.length > 0'));
  const media = await evaluate('window.electronAPI.getFfmpegStatus()');
  assert(media.available);
  const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(hash(media.ffmpeg), hash(ffmpeg)); assert.equal(hash(media.ffprobe), hash(ffprobe));
  assert.notEqual(media.ffmpeg, ffmpeg, 'Must run the self-extracted portable EXE, not win-unpacked');
  result.checks.push('Single-file portable EXE opens; matching version; isolated profile; extracted media matches payload');
  const qualityUi = await evaluate(`(async () => {
    const waitFor = async (check) => {
      for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); }
      throw new Error('Download quality settings UI did not reach the expected state');
    };
    [...document.querySelectorAll('.sidebar-item')].find(b => b.textContent.trim() === '设置').click();
    await waitFor(() => document.querySelector('#default-download-quality'));
    const select = document.querySelector('#default-download-quality');
    const initial = select.value;
    const options = [...select.options].map(o => ({ value: o.value, label: o.textContent }));
    select.value = '1080p'; select.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.querySelector('.settings-footer [role="status"]'));
    document.querySelector('.settings-footer button').click();
    await waitFor(() => document.querySelector('.settings-footer button').textContent.includes('已保存'));
    const saved = (await window.electronAPI.getSettings()).download_quality;
    return { initial, options, saved };
  })()`);
  assert.deepEqual(qualityUi, { initial: 'auto', options: [
    { value: 'auto', label: '自动（兼容优先）' }, { value: '1080p', label: '1080P' }, { value: '720p', label: '720P' },
  ], saved: '1080p' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'data.json'), 'utf8')).settings.download_quality, '1080p');
  const qualityScreenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, 'portable-windows-download-quality.png'), Buffer.from(qualityScreenshot.data, 'base64'));
  assert.equal((await evaluate(`(async () => {
    const current = await window.electronAPI.getSettings();
    return window.electronAPI.saveSettings({ ...current, download_quality: 'auto' });
  })()`)).success, true);
  result.downloadQuality = { ...qualityUi, persistedToIsolatedProfile: true, restoredDefault: 'auto', realPlatformDownloadTested: false };
  result.checks.push('Actual single-file EXE: download quality settings offer auto/1080p/720p; UI saves 1080p to isolated profile; default restored without platform download');
  assert.equal((await evaluate('window.electronAPI.setWindowLayout("portrait")')).success, true);
  assert.equal(await evaluate('window.electronAPI.getWindowLayout()'), 'portrait');
  assert.equal(await evaluate('window.electronAPI.setAlwaysOnTop(true)'), true);
  assert.equal(await evaluate('window.electronAPI.setAlwaysOnTop(false)'), false);
  assert((await evaluate('window.electronAPI.setEpisodePanelOpen(true)')) >= 0);
  await evaluate('window.electronAPI.setEpisodePanelOpen(false)');
  assert.equal((await evaluate('window.electronAPI.setWindowLayout("landscape")')).success, true);
  result.checks.push('Portrait/landscape, always-on-top and integrated episode panel');
  const episodes = await evaluate(`window.electronAPI.getSeriesEpisodes(${JSON.stringify(sid)})`);
  assert(episodes.success && episodes.data.episodes[0].fileUrl);
  for (const episode of episodes.data.episodes) {
    assert.match(episode.fileUrl, /^hongguo-local:\/\/f\/[0-9a-f-]{36}$/i, 'IPC must issue opaque media capabilities');
  }
  const rangeRead = await evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(episodes.data.episodes[0].fileUrl)}, { headers: { Range: 'bytes=0-31' } });
    return { status: response.status, length: (await response.arrayBuffer()).byteLength };
  })()`);
  assert.deepEqual(rangeRead, { status: 206, length: 32 }, 'Packaged renderer must read media Range through CORS using the IPC-issued URL');
  result.mediaCapability = { opaque: true, rendererRangeRead: rangeRead };
  assert.equal((await evaluate(`window.electronAPI.playSeries({seriesId:${JSON.stringify(sid)}, vidIndex:1})`)).success, true);
  const played = await evaluate(`(async () => {
    let v;
    for (let i=0; i<100; i++) { v=document.querySelector('video'); if(v?.readyState>=2) break; await new Promise(r=>setTimeout(r,100)); }
    if(!v || v.readyState<2) throw new Error('Player did not load local episode'); v.muted=true;
    if(v.paused) document.querySelector('[aria-label="播放"]').click();
    await new Promise(r => setTimeout(r, 1200));
    return { time: v.currentTime, width: v.videoWidth, height: v.videoHeight, error: v.error?.message };
  })()`);
  assert(played.time > 0.5 && played.width === 640 && played.height === 360, JSON.stringify(played));
  result.playback = played;
  const canvasRead = await evaluate(`(() => {
    const video = document.querySelector('video');
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext('2d'); context.drawImage(video, 0, 0, 2, 2);
    return { crossOrigin: video.crossOrigin, bytes: context.getImageData(0, 0, 2, 2).data.length };
  })()`);
  assert.deepEqual(canvasRead, { crossOrigin: 'anonymous', bytes: 16 }, 'CORS video must remain origin-clean for visual enhancements');
  result.mediaCapability.originCleanCanvas = true;
  const paused = await evaluate(`(async () => { document.querySelector('[aria-label="暂停"]').click(); await new Promise(r=>setTimeout(r,100)); return document.querySelector('video').paused; })()`);
  assert.equal(paused, true);
  result.checks.push('Actual application player plays CC0 flower H.264/AAC through local protocol; pause control works');
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, 'portable-windows-playback.png'), Buffer.from(screenshot.data, 'base64'));
  await clickControl('全屏');
  await delay(500);
  assert(await evaluate('document.fullscreenElement === document.querySelector(".player-stage")'), 'Player must enter native fullscreen');
  await clickControl('播放');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100, y: 100 });
  await delay(2400);
  const hidden = await evaluate('getComputedStyle(document.querySelector(".player-controls")).opacity === "0" && getComputedStyle(document.querySelector(".player-controls")).pointerEvents === "none" && !document.querySelector("video").paused');
  assert(hidden, 'Fullscreen playback must hide idle controls');
  const fullscreenScreenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, 'portable-windows-fullscreen-hidden.png'), Buffer.from(fullscreenScreenshot.data, 'base64'));
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 120, y: 120 });
  await delay(250);
  assert(await evaluate('getComputedStyle(document.querySelector(".player-controls")).opacity === "1"'), 'Pointer movement must restore fullscreen controls');
  await clickControl('暂停');
  await delay(2400);
  assert(await evaluate('document.querySelector("video").paused && getComputedStyle(document.querySelector(".player-controls")).opacity === "1"'), 'Paused fullscreen controls must stay visible');
  await clickControl('播放');
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100, y: 100 });
  await delay(2400);
  assert(await evaluate('getComputedStyle(document.querySelector(".player-controls")).opacity === "0"'), 'Resumed fullscreen playback must hide idle controls again');
  const firstSource = await evaluate('document.querySelector("video").currentSrc');
  result.shortcutHandoffs = [];
  const down = await keyHandoff('ArrowDown', 'ArrowDown');
  result.shortcutHandoffs.push(down);
  result.shortcutHandoffs.push(await keyHandoff('ArrowUp', 'ArrowUp', firstSource));
  await evaluate(`(() => {
    localStorage.setItem('hongguo:preview:playback-shortcuts:v1', JSON.stringify({ play: 'space', backward: 'arrowleft', forward: 'arrowright', previous: 'k', next: 'j', autoNext: 'a', slower: 's', faster: 'd', fullscreen: 'f' }));
    window.dispatchEvent(new Event('hongguo:playback-shortcuts-changed'));
    return true;
  })()`);
  await delay(100);
  result.shortcutHandoffs.push(await keyHandoff('j', 'KeyJ', down.source));
  result.shortcutHandoffs.push(await keyHandoff('k', 'KeyK', firstSource));
  await evaluate(`(() => {
    localStorage.removeItem('hongguo:preview:playback-shortcuts:v1');
    window.dispatchEvent(new Event('hongguo:playback-shortcuts-changed'));
    return true;
  })()`);
  result.shortcutHandoffs.push(await keyHandoff('ArrowDown', 'ArrowDown', down.source));
  result.shortcutHandoffs.push(await keyHandoff('ArrowUp', 'ArrowUp', firstSource));
  const shortcutScreenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, 'portable-windows-shortcut-hidden.png'), Buffer.from(shortcutScreenshot.data, 'base64'));
  result.checks.push('Actual single-file EXE: trusted default ArrowDown/ArrowUp and custom J/K switch episodes without ended; expected episode returns; every sampled frame retains hidden controls and fullscreen');
  const automaticHandoff = await evaluate(`(async () => {
    const video = document.querySelector('video');
    const originalSource = video.currentSrc;
    const result = { ended: false, sourceChanged: false, nextPlaying: false, frames: 0, visibleFrames: 0, fullscreenLost: false };
    const ended = () => { result.ended = true; };
    video.addEventListener('ended', ended, { once: true });
    // Seeking near the end lets the real media ended event drive Player's automatic next-episode path.
    video.currentTime = video.duration - 0.3;
    const deadline = performance.now() + 8000;
    try {
      while (performance.now() < deadline) {
        await new Promise(requestAnimationFrame);
        result.frames++;
        const controls = getComputedStyle(document.querySelector('.player-controls'));
        if (Number(controls.opacity) > 0 || controls.pointerEvents !== 'none') result.visibleFrames++;
        if (document.fullscreenElement !== document.querySelector('.player-stage')) result.fullscreenLost = true;
        result.sourceChanged ||= !!video.currentSrc && video.currentSrc !== originalSource;
        result.nextPlaying = result.sourceChanged && !video.paused && video.readyState >= 2 && video.currentTime > 0.7;
        if (result.nextPlaying) break;
      }
      result.source = video.currentSrc;
      return result;
    } finally { video.removeEventListener('ended', ended); }
  })()`);
  assert(automaticHandoff.ended && automaticHandoff.sourceChanged && automaticHandoff.nextPlaying, JSON.stringify(automaticHandoff));
  assert(automaticHandoff.frames > 0 && automaticHandoff.visibleFrames === 0 && !automaticHandoff.fullscreenLost, 'Automatic next episode must keep fullscreen controls hidden: ' + JSON.stringify(automaticHandoff));
  assert.equal(automaticHandoff.source, down.source, 'Automatic next after default ArrowUp must select the following episode');
  result.automaticHandoff = automaticHandoff;
  const handoffScreenshot = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(out, 'portable-windows-auto-next-hidden.png'), Buffer.from(handoffScreenshot.data, 'base64'));
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 120, y: 120 });
  await delay(250);
  assert(await evaluate('getComputedStyle(document.querySelector(".player-controls")).opacity === "1"'), 'Pointer movement after automatic next episode must restore controls');
  result.checks.push('Actual single-file EXE: after default ArrowUp returns to the previous episode, natural ended advances through Player to the expected second local flower episode; every sampled frame retains hidden controls and fullscreen; pointer movement restores controls');
  await clickControl('退出全屏');
  await delay(2400);
  assert(await evaluate('!document.fullscreenElement && !document.querySelector("video").paused && getComputedStyle(document.querySelector(".player-controls")).opacity === "0"'), 'Ordinary landscape must hide idle controls after exiting fullscreen');
  result.fullscreenControls = { idleHidden: true, pointerRestores: true, pausedVisible: true, resumedHidden: true, landscapeIdleHidden: true };
  result.checks.push('Actual single-file EXE: fullscreen and ordinary landscape idle hide controls; pointer restores; pause keeps visible; resume hides');
  result.passed = true;
  console.log('Windows release smoke: PASS (' + result.checks.length + ' checks)');
})().catch(error => { result.passed = false; result.error = error.stack; console.error(error.stack); process.exitCode = 1; })
  .finally(() => {
    socket?.close();
    if (child?.pid) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  });
