// Real Player state/effects plus main IPC, using isolated media and temporary directories.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mount } = require('./check-player-resume.cjs');
const { load, roots } = require('./check-playback-cache.cjs');
const KEY = 'hongguo:series-compat:v1';
const target = (seriesId = 'A', vidIndex = 1) => ({ target: { seriesId, vidIndex, ts: 1 } });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const originals = ui => ui.prepares.filter(p => !p.prefetch);
(async () => {
  let failed = 0;
  const test = async (name, fn) => { try { await fn(); console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); } };
  await test('successful repair affects only the current episode', async () => {
    const storage = new Map(), ui = mount({ storage, props: target() });
    await ui.flush(); ui.metadata(); ui.media.currentTime = 19; ui.error(3); await ui.flush();
    assert.equal(ui.transcodes.length, 1); assert.equal(storage.has(KEY), false);
    assert.ok(ui.button('本剧：自动解码'));
    ui.metadata(); assert.equal(ui.media.currentTime, 19);
    ui.episode(2); await ui.flush();
    assert.equal(ui.transcodes.length, 1);
    assert.ok(ui.find(n => n.type === 'video').props.src.startsWith('hongguo-stream://')); ui.unmount();
  });
  await test('series preference survives restart, is isolated from other series, and can be cleared', async () => {
    const storage = new Map([[KEY, '["A"]']]);
    const ui = mount({ storage, props: target() }); await ui.flush();
    assert.equal(ui.transcodes.length, 1); assert.equal(originals(ui).length, 1);
    ui.button('本剧：兼容解码').props.onClick(); await ui.flush();
    assert.deepEqual(JSON.parse(storage.get(KEY)), []);
    ui.episode(2); await ui.flush(); assert.equal(originals(ui).length, 2); assert.equal(ui.transcodes.length, 1); ui.unmount();
    storage.set(KEY, '["A"]');
    const other = mount({ storage, seriesId: 'B', props: target('B') }); await other.flush();
    assert.equal(other.transcodes.length, 0); assert.equal(originals(other).length, 1); other.unmount();
  });
  await test('confirmed unsupported HEVC falls back independently per episode', async () => {
    const storage = new Map(), ui = mount({ storage, props: target(), prepare: () => ({ success:true, url:'hongguo-stream://hevc', codec:'hevc' }) });
    ui.setHevcAnswer(''); await ui.flush();
    assert.equal(storage.has(KEY), false); ui.episode(2); await ui.flush();
    assert.equal(originals(ui).length, 2); assert.equal(ui.transcodes.length, 2); ui.unmount();
  });
  await test('HTTP source failures and failed conversions never learn a series-wide decoder problem', async () => {
    const storage = new Map(), ui = mount({ storage, props: target() }); await ui.flush();
    ui.error(4); await ui.flush(); ui.error(4); await ui.flush();
    assert.equal(storage.has(KEY), false); assert.equal(ui.transcodes.length, 0); ui.unmount();
    const failure = mount({ storage, props: target(), transcode: () => ({ success:false, error:'转换失败' }) });
    await failure.flush(); failure.error(3); await failure.flush();
    assert.equal(storage.has(KEY), false); failure.unmount();
  });
  await test('local automatic repair does not change the next original', async () => {
    const storage = new Map(), ui = mount({ storage, local:true }); await ui.flush();
    ui.metadata(); ui.error(3); await ui.flush(); assert.equal(ui.transcodes.length, 1);
    ui.episode(2); await ui.flush(); assert.equal(ui.transcodes.length, 1);
    assert.equal(ui.transcodes[0].filePath, '/mock-1.mp4');
    assert.equal(ui.prepares.length, 0); assert.equal(ui.find(n => n.type === 'video').props.src, 'file:///mock-2.mp4'); ui.unmount();
  });
  await test('compatibility preparation is serial, future-first and limited to the current plus/minus five window', async () => {
    const gates = [], storage = new Map([[KEY, '["A"]']]); let active = 0, peak = 0;
    const ui = mount({ storage, episodeCount:20, props:target('A', 10), lockedIndexes:[12], backgroundTranscode:p => {
      const gate = deferred(); gates.push({ ...gate, p }); active++; peak = Math.max(active, peak);
      return gate.promise.finally(() => active--);
    } });
    await ui.flush(); ui.metadata(); await ui.flush(); assert.equal(gates.length, 1);
    for (let i = 0; i < 2; i++) { assert.ok(gates[i]); gates[i].resolve({success:true}); await ui.flush(); }
    assert.equal(peak, 1); assert.deepEqual(gates.map(g => g.p.vidIndex), [11,13]);
    assert.ok(gates.every(g => g.p.background && g.p.quality === 'auto' && Math.abs(g.p.vidIndex - 10) <= 5));
    assert.ok(ui.windows.every(w => w.episodes.length <= 11)); ui.unmount();
  });
  await test('jump and unmount cancel background conversions without launching stale queued episodes', async () => {
    const gates = [], ui = mount({ storage:new Map([[KEY, '["A"]']]), episodeCount:20, props:target('A',10), backgroundTranscode:p => {
      const gate=deferred(); gates.push({...gate,p}); return gate.promise;
    } });
    await ui.flush(); ui.metadata(); await ui.flush(); assert.equal(gates[0].p.vidIndex, 11);
    ui.episode(1); await ui.flush(); ui.metadata(); await ui.flush();
    assert.ok(ui.cancelled.some(p => p.requestId === gates[0].p.requestId));
    assert.equal(gates.length, 1, 'old cancelled worker must settle before starting another encoder');
    gates[0].resolve({success:false,cancelled:true}); await ui.flush();
    assert.equal(gates[1].p.vidIndex, 2); ui.unmount();
    assert.ok(ui.cancelled.some(p => p.requestId === gates[1].p.requestId));
    gates[1].resolve({success:false,cancelled:true}); await ui.flush(); assert.equal(gates.length, 2);
  });
  await test('cancelled delayed downloads cannot start a late background conversion', async () => {
    const gate = deferred(), ui = mount({ storage:new Map([[KEY, '["A"]']]), episodeCount:20, props:target('A',10),
      prepare:p => p.prefetch ? gate.promise : {success:true,url:'hongguo-stream://ready'} });
    await ui.flush(); ui.metadata(); await ui.flush(); ui.unmount(); gate.resolve({success:true, streamId:'late'}); await ui.flush();
    assert.equal(ui.backgroundTranscodes.length, 0);
  });
  await test('main IPC rejects late out-of-window background jobs before FFmpeg, and foreground can share a background job', async () => {
    const h = load();
    h.handlers['set-playback-window']({}, {seriesId:'S',vidIndex:10,quality:'auto',episodes:[{vid:'v10',vidIndex:10}]});
    let calls=0; const gate=deferred(); h.context.transcodeForPlayback=async()=>{calls++;return gate.promise;};
    const late=await h.handlers['transcode-for-playback']({}, {seriesId:'S',vidIndex:25,vid:'v25',quality:'auto',requestId:'late',background:true});
    assert.equal(late.cancelled,true); assert.equal(calls,0);
    const p={seriesId:'S',vidIndex:10,vid:'v10',quality:'auto'};
    const background=h.handlers['transcode-for-playback']({}, {...p,requestId:'background',background:true});
    const foreground=h.handlers['transcode-for-playback']({}, {...p,requestId:'foreground'});
    await new Promise(r=>setImmediate(r)); assert.equal(calls,1);
    await h.handlers['cancel-transcode-for-playback']({}, {...p,requestId:'background'});
    gate.resolve({success:true,url:'file:///compatible.mp4'});
    assert.equal((await background).cancelled,true); assert.equal((await foreground).success,true);
  });
  await test('sequential switch promotes the existing compatibility request and holds its original', async () => {
    const gate = deferred(), ui = mount({ storage: new Map([[KEY, '["A"]']]), episodeCount: 3, props: target(),
      prepare: p => ({ success: true, url: 'hongguo-stream://v' + p.vidIndex, streamId: 'stream-' + p.vidIndex, codec: 'hevc' }),
      backgroundTranscode: () => gate.promise });
    await ui.flush(); ui.metadata(); await ui.flush();
    const job = ui.backgroundTranscodes[0];
    assert.equal(job.vidIndex, 2);
    ui.episode(2); await ui.flush();
    assert.equal(ui.transcodes.at(-1).requestId, job.requestId);
    assert.equal(ui.transcodes.at(-1).streamId, job.streamId);
    assert.equal(ui.prepares.filter(p => p.vidIndex === 2).length, 1);
    assert.ok(!ui.cancelled.some(p => p.requestId === job.requestId));
    gate.resolve({ success: true }); await ui.flush();
    assert.ok(!ui.releases.some(p => p.streamId === job.streamId));
    ui.unmount();
  });
  await test('late cancelled repair cannot teach a series preference after leaving the episode', async () => {
    const gate=deferred(), storage=new Map(), ui=mount({storage,props:target(),transcode:()=>gate.promise});
    await ui.flush(); ui.error(3); await ui.flush(); ui.episode(2); await ui.flush();
    gate.resolve({success:true,url:'file:///obsolete.mp4'}); await ui.flush();
    assert.equal(storage.has(KEY),false); assert.notEqual(ui.find(n=>n.type==='video').props.src,'file:///obsolete.mp4'); ui.unmount();
  });
  await test('failed repair in a remembered local series remains bounded and exposes retry', async () => {
    const ui=mount({local:true,storage:new Map([[KEY,'["A"]']]),transcode:()=>({success:false,error:'encoder unavailable'})});
    await ui.flush(); await ui.flush(); const count=ui.transcodes.length;
    assert.ok(count>0 && count<=3); await ui.flush(); assert.equal(ui.transcodes.length,count);
    ui.unmount();
  });
  process.exitCode=failed?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>roots.forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
