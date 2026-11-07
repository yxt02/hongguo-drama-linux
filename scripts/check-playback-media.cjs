// Real bundled FFmpeg/FFprobe and a generated HEVC clip; no network, app data or GPU required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { load, roots } = require('./check-playback-cache.cjs');
const bin = path.resolve(__dirname, '../build/ffmpeg/linux-x64');
const ffmpeg = path.join(bin, 'ffmpeg');
const source = fs.readFileSync(path.resolve(__dirname, '../main.js'), 'utf8');
const start = source.indexOf('function probeVideoInfo(');
const configure = h => {
  h.run(source.slice(start, source.indexOf('\n}', start) + 2));
  h.context.resolveFfmpeg = name => path.join(bin, name);
  return h;
};
const h = configure(load());
(async () => {
  const original = path.join(h.root, 'source-hevc.mp4');
  execFileSync(ffmpeg, ['-v','error','-f','lavfi','-i','testsrc2=size=180x320:rate=12',
    '-f','lavfi','-i','sine=frequency=800','-t','1','-c:a','aac',
    '-c:v','libx265','-x265-params','log-level=error:pools=1:frame-threads=1','-pix_fmt','yuv420p','-tag:v','hvc1',original], { timeout: 20000 });
  h.context.requestMedia = async () => { h.metrics.transfers++; return { headers: { 'content-length': String(fs.statSync(original).size) }, data: fs.createReadStream(original) }; };
  const descriptor = { seriesId: 'S', vidIndex: 1, quality: 'auto', episodes: [{ vid: 'v1', vidIndex: 1 }] };
  assert.equal(h.handlers['set-playback-window']({}, descriptor).success, true);
  const converted = await h.handlers['transcode-for-playback']({}, { seriesId:'S',vid:'v1',vidIndex:1,requestId:'real-convert',quality:'auto',force:true });
  assert.equal(converted.success, true, converted.error); assert.equal(converted.codec,'h264'); assert.equal(h.metrics.transfers, 1);
  const prepared = await h.handlers['prepare-online-play']({}, { disk: true, seriesId:'S',vid:'v1',vidIndex:1,requestId:'real-source',quality:'auto',prefetch:true });
  assert.equal(prepared.success, true, prepared.error); assert.equal(prepared.codec, 'hevc'); assert.equal(prepared.width, 180); assert.equal(prepared.height, 320);
  assert.equal(prepared.cached, true, 'prefetch must reuse the validated original prepared by the first conversion');
  const output = h.context.compatPathFor('S',1);
  execFileSync(ffmpeg,['-v','error','-i',output,'-f','null','-'],{timeout:20000});
  const pixels = execFileSync(ffmpeg,['-v','error','-i',output,'-frames:v','1','-vf','scale=16:16','-pix_fmt','rgb24','-f','rawvideo','-'],{timeout:20000});
  assert.ok(pixels.reduce((s,v)=>s+v,0)/pixels.length > 4,'converted test picture must not be black');
  const cached = await h.handlers['transcode-for-playback']({}, { seriesId:'S',vid:'v1',vidIndex:1,requestId:'real-reuse',quality:'auto' });
  assert.equal(cached.cached,true); assert.equal(h.metrics.transfers,1);
  const localH264 = await h.handlers['transcode-for-playback']({}, { seriesId:'S',vid:'v1',vidIndex:1,requestId:'h264-original',quality:'auto',filePath:output,reason:'compat-mode' });
  assert.equal(localH264.original, true, 'validated local H.264 with AAC must bypass encoding');
  const restarted = configure(load(h.root));
  assert.equal(restarted.handlers['set-playback-window']({}, descriptor).success, true);
  const afterRestart = await restarted.handlers['transcode-for-playback']({}, { seriesId:'S',vid:'v1',vidIndex:1,requestId:'restart-reuse',quality:'auto' });
  assert.equal(afterRestart.cached, true, afterRestart.error);
  assert.equal(restarted.metrics.transfers, 0);
  const refreshed = await h.handlers['prepare-online-play']({}, { disk:true,seriesId:'S',vid:'v1',vidIndex:1,requestId:'real-refresh',quality:'auto',force:true });
  assert.equal(refreshed.success,true);assert.equal(h.metrics.transfers,2);
  const rebuilt = await h.handlers['transcode-for-playback']({}, {seriesId:'S',vid:'v1',vidIndex:1,requestId:'new-original',quality:'auto'});
  assert.equal(rebuilt.success,true);assert.notEqual(rebuilt.cached,true,'a replacement original must invalidate its compatibility copy');
  await h.handlers['release-online-play']({}, {streamId:refreshed.streamId});
  console.log('PASS real HEVC/AAC, original H.264 reuse, full decode, prefetch, restart and replacement invalidation');
  await h.handlers['release-online-play']({}, {streamId:prepared.streamId}); h.context.clearOnlineCache();
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>roots.forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
