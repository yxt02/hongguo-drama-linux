const assert=require('node:assert/strict'),fs=require('node:fs');
const {load,roots}=require('./check-playback-cache.cjs');
const {mount}=require('./check-season-switcher.cjs');
const model=require('../src/native/season-groups');
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const registry=[{series_id:'A',series_title:'归来一',episodes:[{vid:'v1',vid_index:1}]}];
const remote=[{series_id:'B',series_title:'归来2'},{series_id:'C',series_title:'归来三'},{series_id:'X',series_title:'别的剧2'}];
(async()=>{
 const h=load();try {
  h.context.fixture=structuredClone(registry);h.run('seriesRegistry=fixture');let calls=0;const gate=defer();
  h.context.search=async(keyword,options)=>{calls++;assert.equal(keyword,'归来');assert.equal(options.source,'hongguo');await gate.promise;return {success:true,results:remote};};h.run('searchSeriesForSource=search');
  const a=h.handlers['discover-series-seasons']({},'A'),b=h.handlers['discover-series-seasons']({},'A');assert.equal(calls,1,'share concurrent search');gate.resolve();
  for(const result of await Promise.all([a,b])){assert.equal(result.success,true);assert.deepEqual(Array.from(result.data.related,s=>s.number),[1,2,3]);}
  await h.handlers['discover-series-seasons']({},'A');assert.equal(calls,1,'reuse search cache');assert.equal(h.run('seriesRegistry.length'),1,'discovery never registers or downloads candidates');
  h.run('seasonSearchCache.clear()');h.context.search=async()=>{calls++;return {success:false,error:'暂时离线'};};h.run('searchSeriesForSource=search');
  assert.equal((await h.handlers['discover-series-seasons']({},'A')).success,false);
  assert.equal((await h.handlers['discover-series-seasons']({},'A')).success,false);assert.equal(calls,3,'failure remains retryable');
 }finally{for(const root of roots)fs.rmSync(root,{recursive:true,force:true});}
 const view=model.view(registry,'A',remote);let resolves=0;
 const ui=mount({getSeriesSeasons:async()=>({success:true,data:model.view(registry,'A')}),discoverSeriesSeasons:async()=>({success:true,data:view}),searchResolve:async id=>{resolves++;return {success:true,data:{series_id:id}};}});
 await ui.flush();assert.equal(resolves,0);assert.equal(ui.links.length,0);
 const chip=ui.find(n=>n.props['aria-label']==='切换到第 2 季 · 归来2');assert.ok(chip,'automatic chips visible without opening management');
 chip.props.onClick();await ui.flush();assert.equal(resolves,1);assert.deepEqual(ui.switches,['B']);assert.equal(ui.links.length,0,'one click needs no manual association');ui.unmount();
 const old=defer(),stale=mount({getSeriesSeasons:async id=>({success:true,data:model.view([{series_id:id,series_title:id==='A'?'归来一':'新剧一'}],id)}),discoverSeriesSeasons:id=>id==='A'?old.promise:Promise.resolve({success:true,data:model.view([{series_id:id,series_title:'新剧一'}],id)})});
 await stale.flush();stale.props.seriesId='D';stale.render();await stale.flush();old.resolve({success:true,data:view});await stale.flush();
 assert.equal(stale.find(n=>n.props['aria-label']==='切换到第 2 季 · 归来2'),undefined,'old discovery cannot overwrite a different drama');stale.unmount();
 console.log('PASS automatic season discovery, same-source matching, cache, retries, visible chips, one-click resolve and stale replies');
})().catch(e=>{console.error(e);process.exitCode=1});
