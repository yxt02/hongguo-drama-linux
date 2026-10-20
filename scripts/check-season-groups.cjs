// Confirmed season associations use real IPC/persistence and never change media identity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const model = require('../src/native/season-groups');
const { load, roots } = require('./check-playback-cache.cjs');
const entries = () => [
  {series_id:'A',series_title:'归来 第一季',episodes:[{vid:'a',vid_index:1}],savePath:'/keep/a.mp4'},
  {series_id:'B',series_title:'归来 第二季',episodes:[{vid:'b',vid_index:1}]},
  {series_id:'C',series_title:'归来 第三季'},
  {series_id:'xifan:B',series_title:'归来 第二季'},
  {series_id:'hidden',series_title:'归来 第四季',dismissed:true},
];
for (const [title,base,number] of [['归来 第十二季','归来',12],['归来（第二部）','归来',2],['Return Season 3','Return',3],['Return S4','Return',4],['归来2026','归来2026',null],['归来2','归来2',null]]) {
  const info=model.titleInfo(title); assert.equal(info.base,base);assert.equal(info.number,number);
}
const initial=entries(), snapshot=JSON.stringify(initial);
assert.equal(model.view(initial,'A').linked,false);
assert.deepEqual(model.view(initial,'A').candidates.map(s=>s.series_id),['B','C']);
let registry=model.link(initial,'A','B',2);
assert.equal(JSON.stringify(initial),snapshot,'no in-place mutation');
assert.deepEqual(model.view(registry,'B').seasons.map(s=>[s.series_id,s.number]),[['A',1],['B',2]]);
assert.equal(registry[0].episodes,initial[0].episodes);
for (const n of [0,-1,1,1.2,1000,NaN,'3']) assert.throws(()=>model.link(registry,'A','C',n));
assert.throws(()=>model.link(registry,'A','xifan:B',3),/同一来源/);
assert.throws(()=>model.link(registry,'A','missing',3),/剧库/);
assert.throws(()=>model.link(registry,'A','hidden',3),/剧库/);
assert.throws(()=>model.link(registry,'C','B',3),/原关联/);
registry=model.link(registry,'A','A',4);
assert.deepEqual(model.view(registry,'B').seasons.map(s=>s.number),[2,4]);
registry=model.link(registry,'A','C',3);
const removed=model.unlink(registry,'B','A');
assert.equal(model.view(removed,'A').linked,false);
assert.deepEqual(model.view(removed,'B').seasons.map(s=>s.series_id),['B','C']);
assert.equal(removed[0].savePath,'/keep/a.mp4');assert.deepEqual(removed[0].episodes,initial[0].episodes);
assert.throws(()=>model.unlink(removed,'B','A'));
assert.notEqual(model.sourceOf('custom:one:id'),model.sourceOf('custom:two:id'));

const h=load();
try {
  h.context.fixture=entries();h.run('seriesRegistry=fixture; store.saveSeries = data => { persisted=JSON.parse(JSON.stringify(data)); }');
  const payload={seriesId:'A',targetSeriesId:'B',seasonNumber:2};
  assert.equal(h.handlers['link-series-season']({},payload).success,true);
  assert.equal(h.run('persisted[0].season_group === seriesRegistry[0].season_group'),true);
  h.run("upsertSeriesRegistry({series_id:'A',series_title:'新标题',episodes:[{vid:'new-a',vid_index:1}]})");
  assert.equal(h.handlers['get-series-seasons']({},'A').data.seasons.length,2,'refresh retains relationship');
  h.run('seriesRegistry=JSON.parse(JSON.stringify(persisted))');
  assert.equal(h.handlers['get-series-seasons']({},'B').data.seasons.length,2,'restart retains relationship');
  const before=h.run('JSON.stringify(seriesRegistry)');
  h.run('store.saveSeries=()=>{throw Error("disk full")}');
  assert.equal(h.handlers['unlink-series-season']({},payload).success,false);
  assert.equal(h.run('JSON.stringify(seriesRegistry)'),before,'failed save leaves live state untouched');
  assert.equal(h.handlers['link-series-season']({},{...payload,seasonNumber:8}).success,false);
  assert.equal(h.run('JSON.stringify(seriesRegistry)'),before);
  assert.equal(h.handlers['get-series-seasons']({},'missing').success,false);
  console.log('PASS title suggestions, explicit season groups, validation, isolation, unlink and persistent IPC');
} finally { for(const root of roots)fs.rmSync(root,{recursive:true,force:true}); }
