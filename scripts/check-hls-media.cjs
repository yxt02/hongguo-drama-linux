// Real normal-video HLS, routed through in-memory public-URL fixtures. No Internet or user data writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-hls-'));
const helper = path.join(__dirname, '../src/native/hls-media.js');
assert.ok(fs.existsSync(helper), 'HLS needs a guarded disk remux helper');
const { remuxHls } = require(helper);
const ffmpeg = process.env.HONGGUO_FFMPEG, video = process.env.HONGGUO_VIDEO_FIXTURE;
if (!ffmpeg || !video) {
  console.log('SKIP check-hls-media: Set HONGGUO_FFMPEG and HONGGUO_VIDEO_FIXTURE');
  process.exit(0);
}
(async () => {
  fs.writeFileSync(path.join(root, 'key'), Buffer.alloc(16, 42));
  fs.writeFileSync(path.join(root, 'keyinfo'), `https://fixture.example/key\n${path.join(root, 'key')}\n`);
  execFileSync(ffmpeg, ['-v','error','-y','-i',video,'-t','2','-vf','scale=320:-2','-c:v','libx264','-preset','ultrafast','-an','-f','hls','-hls_time','1','-hls_list_size','0','-hls_key_info_file',path.join(root,'keyinfo'),'-hls_segment_filename',path.join(root,'part%d.ts'),path.join(root,'media.m3u8')], { timeout:30000 });
  fs.writeFileSync(path.join(root,'master.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nmedia.m3u8\n');
  const requests = [];
  const request = async (url, { signal } = {}) => {
    assert.equal(new URL(url).hostname, 'fixture.example'); requests.push(url);
    if (signal?.aborted) throw new Error('cancelled');
    const file = path.join(root, new URL(url).pathname.slice(1));
    return { status:200, headers:{'content-length':String(fs.statSync(file).size)}, data: fs.createReadStream(file), url };
  };
  const output = name => path.join(root, name + '.mp4');
  const options = { url:'https://fixture.example/master.m3u8', ffmpeg, request };
  await remuxHls({ ...options, output:output('ok') });
  assert.ok(fs.statSync(output('ok')).size > 0);
  assert.ok(requests.some(url => url.endsWith('/key')), 'encrypted keys pass through guarded proxy');
  const ffprobe = process.env.HONGGUO_FFPROBE;
  if (ffprobe) {
    const info = JSON.parse(execFileSync(ffprobe, ['-v','error','-show_entries','stream=codec_type,width,height:format=duration','-of','json',output('ok')], {encoding:'utf8',timeout:10000}));
    assert.ok(info.streams.some(s => s.codec_type === 'video' && s.width === 320)); assert.ok(Number(info.format.duration) >= 1.8);
  }
  for (const privateUrl of ['http://127.0.0.1/secret.ts','http://192.168.1.1/key','file:///etc/passwd']) {
    await assert.rejects(remuxHls({...options,output:output('private'),request:async(url,args) => url.endsWith('media.m3u8')
      ? {status:200,headers:{},data:Readable.from([`#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${privateUrl}\n#EXT-X-ENDLIST\n`]),url} : request(url,args)}), /公网|安全|地址|协议/);
    assert.equal(fs.existsSync(output('private')), false);
  }
  await assert.rejects(remuxHls({...options,output:output('privatekey'),request:async(url,args)=>url.endsWith('media.m3u8')
    ? {status:200,headers:{},data:Readable.from(['#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-KEY:METHOD=AES-128,URI="http://192.168.1.1/key"\n#EXTINF:2,\npart0.ts\n#EXT-X-ENDLIST\n']),url}:request(url,args)}),/公网|地址/);
  assert.equal(fs.existsSync(output('privatekey')),false);
  await assert.rejects(remuxHls({...options,output:output('missing'),request:async(url,args) => url.includes('/part') ? Promise.reject(new Error('missing segment')) : request(url,args)}), /missing segment|分片|媒体/);
  assert.equal(fs.existsSync(output('missing')), false);
  await assert.rejects(remuxHls({...options,output:output('truncated'),request:async(url,args) => url.includes('/part')
    ? {status:200,headers:{'content-length':'999999'},data:Readable.from([Buffer.from('partial')]),url}:request(url,args)}), /不完整/);
  assert.equal(fs.existsSync(output('truncated')),false);
  let allowed = true;
  await assert.rejects(remuxHls({...options,output:output('disabled'),checkAccess:()=>{if(!allowed)throw new Error('source disabled');},request:async(url,args)=>{const response=await request(url,args);if(url.includes('/part'))allowed=false;return response;}}),/disabled/);
  assert.equal(fs.existsSync(output('disabled')),false);
  const controller = new AbortController();
  const pending = remuxHls({...options,output:output('cancel'),signal:controller.signal,request:async(url,args) => {
    if (!url.includes('/part')) return request(url,args);
    return new Promise((resolve,reject) => { args.signal.addEventListener('abort',()=>reject(new Error('cancelled')), {once:true}); controller.abort(); });
  }});
  await assert.rejects(pending, /取消|cancel/i); assert.equal(fs.existsSync(output('cancel')), false);
  console.log('PASS HLS: encrypted master/variant/segments/key remux; real ffprobe; private/file URLs blocked; missing segment and cancellation clean output');
})().catch(error => { console.error(error.stack); process.exitCode=1; }).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
