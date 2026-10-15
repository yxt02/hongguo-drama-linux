// Run with HONGGUO_VIDEO_FIXTURE and HONGGUO_FFPROBE. Reads a normal local video; no network or app data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const video = process.env.HONGGUO_VIDEO_FIXTURE;
const ffprobe = process.env.HONGGUO_FFPROBE;
if (!video || !ffprobe) {
  console.log('SKIP check-download-media-validity: Set HONGGUO_VIDEO_FIXTURE and HONGGUO_FFPROBE to local fixture paths');
  process.exit(0);
}
const harness = fs.readFileSync(path.join(__dirname, 'check-download-quality-integration.cjs'), 'utf8').split('const payload =')[0];
const moduleStub = { exports: {} };
vm.runInNewContext(harness + '\nmodule.exports = { fixture, dirs };', { module: moduleStub, require, __dirname, console, process, Buffer, URL, Response, Request, Headers, AbortController, setTimeout, clearTimeout });
const { fixture, dirs } = moduleStub.exports;
(async () => {
  const h = fixture();
  // Restore the real production probe that the transport harness deliberately mocks.
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  h.run(source.slice(source.indexOf('function probeVideoInfo('), source.indexOf("ipcMain.handle('get-ffmpeg-status'")));
  h.context.fixtureFfprobe = ffprobe;
  h.run('resolveFfmpeg = () => fixtureFfprobe');
  const info = await h.context.verifyDownloadQuality(video, 'auto', true);
  assert.match(info, /^\d+p$/);
  const broken = path.join(h.root, 'broken.mp4');
  fs.writeFileSync(broken, Buffer.alloc(200000));
  await assert.rejects(h.context.verifyDownloadQuality(broken, 'auto', true), /有效视频轨|分辨率|时长/);
  assert.equal(fs.statSync(broken).size, 200000, 'invalid existing file remains untouched');
  const bytes = fs.readFileSync(video);
  h.context.fixtureBytes = bytes;
  h.context.fixtureStream = () => fs.createReadStream(video);
  h.run("requestMedia = async () => ({ headers: { 'content-length': String(fixtureBytes.length) }, data: fixtureStream() })");
  await h.handlers['hongguo-download-batch']({}, { seriesId: '1', seriesTitle: 'Fixture', episodes: [{ vid: '11', vid_index: 1 }] });
  await h.run('executeHongguoDownload(downloadTasks[0])');
  const task = h.saved()[0];
  assert.equal(task.status, 'completed', task.error);
  assert.deepEqual(fs.readFileSync(task.savePath), bytes);
  assert.equal(fs.existsSync(task.savePath + '.enc.tmp'), false);
  console.log('PASS real ffprobe: valid local video accepted; 200KB corrupt file rejected and retained; valid transfer published unchanged');
})().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
