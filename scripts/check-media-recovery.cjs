// Offline regression: real HTTP streams, isolated main process, no GUI/user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-stream-'));
const source = path.resolve(__dirname, '../main.js');
const req = createRequire(source);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function load(fetchPlayUrlSingle, overrides = {}) {
  const handlers = {}, protocols = {}, app = new EventEmitter();
  Object.assign(app, { getVersion: () => 'test', getPath: () => root, commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
  const electron = { app, ipcMain: { handle: (n, f) => handlers[n] = f }, protocol: { registerSchemesAsPrivileged() {}, handle: (n, f) => protocols[n] = f } };
  const native = { fetchPlayUrlSingle, UA: 'test', WEB_UA: 'browser-test', WEB_REFERER: 'https://hongguoduanju.com/', VIDEO_REFERER: 'https://example.com/', deriveKey: () => Buffer.alloc(16), decryptMp4Buffer: b => b };
  // These transport fixtures intentionally use a loopback server; the real guard has its own boundary tests.
  const mediaGuard = req('./src/native/web-media-guard');
  overrides = { './src/native/web-media-guard': { webMediaRequestOptions: value => {
    if (new URL(value).hostname === '127.0.0.1') return {};
    return mediaGuard.webMediaRequestOptions(value);
  } }, ...overrides };
  const context = vm.createContext({ require: n => overrides[n] || (n === 'electron' ? electron : n === './src/native/hongguo' ? native : n === './src/store' ? { saveTasks() {}, getSettings: () => ({ root }) } : req(n)), __dirname: path.dirname(source), console: { log() {}, warn() {}, error() {} }, process, Buffer, URL, Response, Request, Headers, AbortController, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(source, 'utf8'), context, { filename: source });
  // These transport/decryption fixtures are synthetic; real media validity is checked separately.
  context.probeVideoInfo = async () => ({ w: 1080, h: 1920, duration: 12, codec: 'h264' });
  context.resolveFfmpeg = () => '/fixture/ffprobe';
  context.registerStreamProtocol();
  context.registerLocalProtocol();
  return { context, handlers, protocols, run: s => vm.runInContext(s, context) };
}

(async () => {
  const hits = [];
  const server = http.createServer((r, s) => {
    hits.push({url:r.url, headers:r.headers});
    if (r.url === '/missing') { s.writeHead(404); s.end(); return; }
    if (r.url.startsWith('/native') && r.headers.referer) { s.writeHead(403); s.end(); return; }
    if (r.url === '/native-retry' && hits.filter(hit => hit.url === '/native-retry').length === 1) { s.writeHead(403); s.end(); return; }
    if (r.url === '/html') { s.setHeader('Content-Type','text/html'); s.end('bad'); return; }
    if (r.url === '/broken') { s.writeHead(200, {'Content-Length':'999'}); s.write('partial'); setTimeout(() => s.destroy(), 5); return; }
    if (r.url === '/race') {
      if(r.headers.range==='bytes=0-1') {s.writeHead(206,{'Content-Range':'bytes 0-1/14','Content-Length':'2'});s.end('co');}
      else setTimeout(()=>{s.writeHead(404);s.end();},30);
      return;
    }
    if(r.url==='/head-race') {
      if(r.method==='HEAD'){s.writeHead(404);s.end();}
      else setTimeout(()=>{s.writeHead(206,{'Content-Range':'bytes 0-1/14','Content-Length':'2'});s.end('co');},700);
      return;
    }
    if (r.url === '/identity' && (r.headers['user-agent'] !== 'app-provider' || r.headers.referer !== 'https://novel.snssdk.com/')) { s.writeHead(404); s.end(); return; }
    const bytes = Buffer.from('complete-media');
    if (r.headers.range === 'bytes=2-5') { s.writeHead(206, {'Content-Type':'video/mp4','Content-Range':`bytes 2-5/${bytes.length}`,'Content-Length':'4'}); s.end(bytes.subarray(2,6)); }
    else { s.writeHead(200, {'Content-Type':'video/mp4','Content-Length':bytes.length}); s.end(bytes); }
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const info = (url, source='app') => ({url:base+url,source,vid:'11'});
  let failures=0; const harnesses=[];
  const harness = (fn, overrides) => { const h=load(fn, overrides); harnesses.push(h); return h; };
  const task = id => ({id, type:'hongguo',filename:id+'.mp4',customDir:root,hongguoInfo:{vid:'11',series_id:'1'}});
  async function check(name, fn) { try { await fn(); console.log('PASS '+name); } catch(e) { failures++; console.error('FAIL '+name+': '+e.message); } }
  await check('download refreshes a failed address without another click',async()=>{
    const calls=[]; const h=harness(async(_v,_s,o)=>{ calls.push(o); return calls.length===1?info('/missing','web'):info('/ok'); });
    const t=task('refresh'); await h.context.executeHongguoDownload(t);
    assert.equal(t.status,'completed',t.error); assert.equal(fs.readFileSync(t.savePath,'utf8'),'complete-media');
    assert.equal(calls[1].force,true);
  });
  await check('download tries valid backup after primary HTTP 404',async()=>{
    let lookups=0; const first=info('/missing'); first.variants=[first,info('/ok')];
    const h=harness(async()=>{ lookups++; return first; }); const t=task('backup');
    await h.context.executeHongguoDownload(t); assert.equal(t.status,'completed',t.error); assert.equal(lookups,1);
  });
  await check('empty source is refreshed during playback preparation',async()=>{
    let lookups=0; const h=harness(async()=>++lookups===1?{url:null,code:'SOURCE_UNAVAILABLE',error:'temporary'}:info('/ok'));
    const p=await h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1'});
    assert.equal(p.success,true,p.error); assert.equal(lookups,2);
  });
  await check('both-empty exhaustion ends the round instead of rewalking the model requests',async()=>{
    let lookups=0; const h=harness(async()=>{ lookups++;
      return {url:null,code:'SOURCE_UNAVAILABLE',error:'播放接口返回空响应（已尝试备用入口），请稍后重试',
        sources:[{source:'app',code:'EMPTY_RESPONSE',message:'播放接口返回空响应（已尝试备用入口），请稍后重试',exhausted:true}]}; });
    const p=await h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1'});
    assert.equal(p.success,false);
    assert.equal(p.exhausted,true,'renderer learns the terminal state to stop advancing prefetch');
    assert.match(p.error,/空响应/);
    assert.equal(lookups,1,'外围重试收到主备均空后立即结束这一轮');
  });
  await check('source roles follow the playback window',async()=>{
    const roles=[]; const h=harness(async(_v,_s,o)=>{ roles.push(o.role); return info('/ok'); });
    const w=await h.handlers['set-playback-window']({}, {seriesId:'1',vidIndex:1,quality:'auto',
      episodes:[{vid:'11',vidIndex:1},{vid:'22',vidIndex:2},{vid:'33',vidIndex:3}]});
    assert.equal(w.success,true,w.error);
    const next=await h.handlers['prepare-online-play']({}, {vid:'22',seriesId:'1',vidIndex:2,prefetch:true});
    assert.equal(next.success,true,next.error);
    assert.equal(roles[0],'next','紧邻的下一可播集预取可申请快速更新');
    const distant=await h.handlers['prepare-online-play']({}, {vid:'33',seriesId:'1',vidIndex:3,prefetch:true});
    assert.equal(distant.success,true,distant.error);
    assert.equal(roles[1],'distant','更远的预取不申请快速更新');
    const foreground=await h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1',vidIndex:1});
    assert.equal(foreground.success,true,foreground.error);
    assert.equal(roles[2],'foreground','当前集优先取源');
  });
  await check('a promoted prefetch reuses its in-flight job and gains foreground stage reporting',async()=>{
    const events=[]; let calls=0, release;
    const h=harness(async(_v,_s,o)=>{ calls++;
      return new Promise(resolve=>{ release=()=>{ o.onStage?.('reconnecting'); resolve(info('/ok')); }; });
    });
    h.context.sendToRenderer=(channel,payload)=>{ if(channel==='online-play-progress') events.push(payload); };
    const w=await h.handlers['set-playback-window']({}, {seriesId:'1',vidIndex:1,quality:'auto',
      episodes:[{vid:'11',vidIndex:1},{vid:'22',vidIndex:2}]});
    assert.equal(w.success,true,w.error);
    const prefetch=h.handlers['prepare-online-play']({}, {vid:'22',seriesId:'1',vidIndex:2,prefetch:true,requestId:'pf'});
    for (let i=0;i<30 && calls<1;i++) await new Promise(r=>setImmediate(r));
    assert.equal(calls,1);
    assert.equal(events.length,0,'预取阶段不上报前台等待状态');
    const promoted=h.handlers['prepare-online-play']({}, {vid:'22',seriesId:'1',vidIndex:2,requestId:'fg'});
    await new Promise(r=>setImmediate(r));
    release();
    const pp=await prefetch, mp=await promoted;
    assert.equal(pp.success,true,pp.error); assert.equal(mp.success,true,mp.error);
    assert.equal(calls,1,'切集提升复用同一在途任务，不重新取源');
    assert.ok(events.some(e=>e.phase==='reconnecting'),'提升后的恢复阶段回报给前台');
  });
  await check('managed prefetch reports reconnecting and readiness belongs to the validated file', async () => {
    const events = [];
    let finish;
    const h = harness(async (_vid, _series, options) => {
      options.onStage('reconnecting');
      return new Promise(resolve => { finish = () => resolve(info('/ok')); });
    });
    h.context.sendToRenderer = (channel, payload) => { if (channel === 'online-play-progress') events.push(payload); };
    const contents = h.run('mainWindow = {webContents: {mainFrame: {}}}; mainWindow.webContents');
    const event = { sender: contents, senderFrame: contents.mainFrame };
    const descriptor = { vid: '2202', vidIndex: 2 };
    const window = await h.handlers['set-playback-window']({}, { seriesId: '1', vidIndex: 1, episodes: [descriptor] });
    assert.equal(window.success, true, window.error);
    const request = h.handlers['prepare-online-play']({}, { ...descriptor, seriesId: '1', disk: true, prefetch: true, requestId: 'managed-pf' });
    for (let i = 0; i < 30 && !finish; i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(finish);
    assert.ok(events.some(e => e.requestId === 'managed-pf' && e.phase === 'reconnecting'));
    finish();
    const prepared = await request;
    assert.equal(prepared.success, true, prepared.error);
    const inspect = (seriesId, vidIndex = 2) => h.handlers['episode-cache-status'](event, { seriesId, episodes: [{ ...descriptor, vidIndex }] });
    assert.equal(inspect('1').items[2].cached, true);
    assert.equal(inspect('1', 3).items[3], undefined);
    assert.equal(inspect('2').items[2], undefined);
    const file = h.run("playbackEntry('2202').filePath");
    fs.utimesSync(file, new Date(0), new Date(0));
    assert.equal(inspect('1').items[2], undefined, 'same-size modified files are not ready');
    await h.handlers['release-online-play'](event, { streamId: prepared.streamId });
  });
  await check('switching away aborts the old episode fetch signal before session updates',async()=>{
    let calls=0; const signals=[];
    const h=harness(async(_v,_s,o)=>{ calls++;
      signals.push(o.signal);
      return new Promise(()=>{}); // 旧任务挂起，模拟冷却等待中的取源
    });
    const window=episodes=>h.handlers['set-playback-window']({}, {seriesId:'1',vidIndex:1,quality:'auto',episodes});
    assert.equal((await window([{vid:'11',vidIndex:1},{vid:'22',vidIndex:2}])).success,true);
    const stale=h.handlers['prepare-online-play']({}, {vid:'22',seriesId:'1',vidIndex:2,disk:true,prefetch:true});
    for (let i=0;i<60 && calls<1;i++) await new Promise(r=>setImmediate(r));
    assert.equal(calls,1);
    // 窗口切走后旧任务被取消；取消信号必须传入取源轮次，冷却结束后不得再注册。
    assert.equal((await window([{vid:'11',vidIndex:1}])).success,true);
    const result=await stale;
    assert.equal(result.success,false);
    assert.ok(signals[0],'取源轮次收到任务的取消信号');
    assert.equal(signals[0].aborted,true,'切走后旧任务的取源信号随任务中止');
  });
  await check('stream recovers before headers and preserves requested Range',async()=>{
    let lookups=0; const h=harness(async()=>++lookups===1?info('/missing','web'):info('/ok'));
    const p=await h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1'});
    const r=await h.protocols['hongguo-stream'](new Request(p.url,{headers:{Range:'bytes=2-5'}}));
    assert.equal(r.status,206); assert.equal(await r.text(),'mple');
  });
  await check('broken prefetch body retries complete transfer and caches only final bytes',async()=>{
    let lookups=0; const h=harness(async()=>++lookups===1?info('/broken'):info('/ok'));
    const p=await h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1',prefetch:true});
    assert.equal(p.success,true,p.error);
    const r=await h.protocols['hongguo-stream'](new Request(p.url)); assert.equal(await r.text(),'complete-media');
  });
  await check('broken download retries without keeping partial bytes',async()=>{
    let lookups=0; const h=harness(async()=>++lookups===1?info('/broken'):info('/ok')), t=task('broken');
    await h.context.executeHongguoDownload(t); assert.equal(t.status,'completed',t.error);
    assert.equal(fs.readFileSync(t.savePath,'utf8'),'complete-media');
    assert.ok(!fs.existsSync(t.savePath+'.enc.tmp'));
  });
  await check('stream fallback decrypts a new candidate before serving Range',async()=>{
    let lookups=0; const h=harness(async()=>++lookups===1?info('/missing','web'):{...info('/ok'),spadeA:'test'}, {
      './src/native/decrypt-worker.cjs':{decryptInWorker:async({buffer})=>Buffer.from(buffer)},
    });
    const p=await h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1'});
    const r=await h.protocols['hongguo-stream'](new Request(p.url,{headers:{Range:'bytes=2-5'}}));
    assert.equal(r.status,206);assert.equal(await r.text(),'mple');
    assert.equal(hits.at(-1).headers.range,undefined,'encrypted candidate must be fetched completely');
  });
  await check('a stream never mixes byte offsets from different media after first response',async()=>{
    let lookups=0; const h=harness(async()=>{lookups++;return info('/ok');});
    const p=await h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1'});
    const first=await h.protocols['hongguo-stream'](new Request(p.url,{headers:{Range:'bytes=2-5'}}));await first.text();
    h.run(`onlineSessions.get(${JSON.stringify(p.streamId)}).entry.playInfo.url = ${JSON.stringify(base+'/missing')}`);
    const next=await h.protocols['hongguo-stream'](new Request(p.url,{headers:{Range:'bytes=2-5'}}));
    assert.equal(next.status,502,'must reconnect with time-based seek instead of changing media under same URL');assert.equal(lookups,1);
  });
  await check('late stream interruption marks Web failed before a time-based reconnect',async()=>{
    let failed=false;
    const native={fetchPlayUrlSingle:async()=>failed?info('/ok'):info('/broken','web'),UA:'test',WEB_UA:'browser-test',WEB_REFERER:'https://hongguoduanju.com/',markWebMediaFailure:()=>{failed=true;}};
    const h=harness(native.fetchPlayUrlSingle,{'./src/native/hongguo':native});
    const p=await h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1'});
    const r=await h.protocols['hongguo-stream'](new Request(p.url));await assert.rejects(r.text());
    assert.equal(failed,true,'reconnect must know that the old Web body failed');
    const p2=await h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1',force:true});
    assert.equal(await (await h.protocols['hongguo-stream'](new Request(p2.url))).text(),'complete-media');
  });
  await check('concurrent first Range requests cannot race into two media representations',async()=>{
    let lookups=0; const h=harness(async()=>++lookups===1?info('/race'):info('/ok'));
    const p=await h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1'});
    const early=h.protocols['hongguo-stream'](new Request(p.url,{headers:{Range:'bytes=0-1'}}));
    const late=h.protocols['hongguo-stream'](new Request(p.url,{headers:{Range:'bytes=2-5'}}));
    const r1=await early;assert.equal(await r1.text(),'co');
    assert.equal((await late).status,502,'late candidate must not replace the source already handed to the player');
  });
  await check('HEAD fallback and pending GET stay on one media representation',async()=>{
    let lookups=0;const h=harness(async()=>++lookups===1?info('/head-race'):{...info('/ok'),spadeA:'test'},{
      './src/native/decrypt-worker.cjs':{decryptInWorker:async()=>Buffer.from('different-media')},
    });
    const p=await h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1'});
    const get=h.protocols['hongguo-stream'](new Request(p.url,{headers:{Range:'bytes=0-1'}}));
    const head=h.protocols['hongguo-stream'](new Request(p.url,{method:'HEAD'}));
    assert.equal((await head).status,200);
    assert.equal((await get).status,502,'GET cannot publish the pre-fallback source after HEAD fixed another representation');
  });
  await check('two sessions sharing preparation never mutate each other media entry',async()=>{
    let lookups=0;const h=harness(async()=>++lookups===1?info('/ok'):{...info('/ok'),spadeA:'test'},{
      './src/native/decrypt-worker.cjs':{decryptInWorker:async()=>Buffer.from('different-media')},
    });
    const [a,b]=await Promise.all([h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1'}),h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1'})]);
    assert.equal(await(await h.protocols['hongguo-stream'](new Request(a.url,{headers:{Range:'bytes=2-5'}}))).text(),'mple');
    h.run(`onlineSessions.get(${JSON.stringify(b.streamId)}).entry.playInfo = ${JSON.stringify(info('/missing'))}`);
    assert.equal(await(await h.protocols['hongguo-stream'](new Request(b.url))).text(),'different-media');
    assert.equal(await(await h.protocols['hongguo-stream'](new Request(a.url,{headers:{Range:'bytes=2-5'}}))).text(),'mple');
  });
  await check('HTML error page tries backup and never becomes completed media',async()=>{
    const first=info('/html'); first.variants=[info('/ok')]; const h=harness(async()=>first), t=task('html');
    await h.context.executeHongguoDownload(t); assert.equal(t.status,'completed',t.error); assert.equal(fs.readFileSync(t.savePath,'utf8'),'complete-media');
  });
  await check('media request retains provider UA and Referer',async()=>{
    const h=harness(async()=>({...info('/identity'), userAgent:'app-provider',referer:'https://novel.snssdk.com/'})), t=task('identity');
    await h.context.executeHongguoDownload(t); assert.equal(t.status,'completed',t.error);
  });
  await check('native App source omits Referer while preserving UA and Range',async()=>{
    const h=harness(async()=>info('/native'));
    const response=await h.context.requestMedia({...info('/native'), userAgent:'app-provider',referer:'https://novelquickapp.com/',omitReferer:true},
      {headers:{rEfErEr:'https://invalid.example/',Range:'bytes=2-5'}});
    let body='';for await(const chunk of response.data)body+=chunk.toString();
    assert.equal(response.status,206);assert.equal(body,'mple');
    assert.equal(hits.at(-1).headers.referer,undefined);assert.equal(hits.at(-1).headers['user-agent'],'app-provider');
  });
  await check('App 403 retry does not reintroduce the rejected Referer',async()=>{
    const h=harness(async()=>info('/native-retry'));
    const response=await h.context.requestMedia({...info('/native-retry'),omitReferer:true});
    for await(const chunk of response.data){}
    const requests=hits.filter(hit=>hit.url==='/native-retry');
    assert.equal(requests.length,2);assert.ok(requests.every(hit=>!hit.headers.referer));assert.equal(response.status,200);
  });
  await check('permanent failure stops within bounded attempts and leaves no file',async()=>{
    let lookups=0; const before=hits.length; const h=harness(async()=>{lookups++;return info('/missing','web');}),t=task('permanent');
    await h.context.executeHongguoDownload(t); assert.equal(t.status,'failed');
    assert.ok(lookups<=3); assert.ok(hits.length-before<=8); assert.ok(!fs.existsSync(t.savePath)); assert.ok(!fs.existsSync(t.savePath+'.enc.tmp'));
  });
  await check('stop during retry wait cancels all later requests',async()=>{
    let lookups=0;const h=harness(async()=>{lookups++;return info('/missing','web');}),t=task('cancel');
    const pending=h.context.executeHongguoDownload(t); await sleep(40);
    t.cancelled=true; t.cancelSource?.cancel('stop'); await pending; const after=lookups; await sleep(40);
    assert.equal(t.status,'stopped'); assert.equal(lookups,after); assert.ok(!fs.existsSync(t.savePath));
  });
  await check('unresponsive source lookup has a finite wait instead of leaving playback loading',async()=>{
    const h=harness(()=>new Promise(()=>{}));
    h.context.setTimeout=(fn,ms)=>setTimeout(fn,Math.min(ms,5));
    const pending=h.handlers['prepare-online-play']({}, {vid:'11',seriesId:'1',requestId:'timeout'});
    const result=await Promise.race([pending,sleep(80).then(()=>({unbounded:true}))]);
    await h.handlers['release-online-play']({}, {requestId:'timeout'});await pending;
    assert.ok(!result.unbounded,'source lookup never settled within its time budget');assert.equal(result.success,false);assert.match(result.error,/超时/);
  });
  for(const h of harnesses) {
    h.context.clearOnlineCache();
    h.run('for (const timer of sourceRetryTimers.values()) clearTimeout(timer); sourceRetryTimers.clear();');
  }
  server.closeAllConnections(); await new Promise(r=>server.close(r));
  assert.equal(failures,0,`${failures} recovery regressions`);
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
