// Run real component handlers/effects with controlled IPC replies, including stale replies.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {transformSync}=require('esbuild');
const {mount:player}=require('./check-player-resume.cjs');
const source=transformSync(fs.readFileSync(require.resolve('../src/components/SeasonSwitcher.jsx'),'utf8'),{loader:'jsx',format:'cjs'}).code;
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const data=(id='A',linked=false)=>({source:'hongguo',query:'归来',linked,currentNumber:1,nextNumber:2,candidates:[],seasons:[{series_id:id,series_title:'归来',number:1},...(linked?[{series_id:'B',series_title:'归来 第二季',number:2}]:[])]});
function mount(overrides={}) {
 const slots=[],effects=[],cleanups=[],links=[],switches=[];let cursor=0,tree;
 const changed=(old,deps)=>!old||deps.some((v,i)=>!Object.is(v,old[i]));
 const react={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)}),
 useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=init;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},
 useRef:init=>{const i=cursor++;return slots[i]||=( {current:init});},
 useCallback:(fn,deps)=>{const i=cursor++;if(!slots[i]||changed(slots[i].deps,deps))slots[i]={deps,fn};return slots[i].fn;},
 useEffect:(fn,deps)=>{const i=cursor++;if(changed(slots[i],deps)){slots[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}};
 const api={getSeriesSeasons:async id=>({success:true,data:data(id)}),searchResolve:async id=>({success:true,data:{series_id:id}}),
 linkSeriesSeason:async p=>{links.push(p);return {success:true,data:data('A',true)};},
 searchSeries:async()=>({success:true,results:[{series_id:'B',series_title:'归来 第二季'}]}),...overrides};
 const module={exports:{}};vm.runInNewContext(source,{module,exports:module.exports,require:n=>n==='react'?react:{},window:{electronAPI:api}});
 const props={seriesId:'A',onSwitch:async id=>switches.push(id)};
 const render=()=>{cursor=0;tree=module.exports.default(props);effects.splice(0).forEach(f=>f());};
 const flush=async()=>{for(let i=0;i<20;i++){await Promise.resolve();render();}};
 const text=n=>typeof n==='string'||typeof n==='number'?String(n):n?.children?.map(text).join('')||'';
 const find=fn=>{let result;const walk=n=>{if(!n||typeof n!=='object')return;if(fn(n)&&!result)result=n;n.children?.forEach(walk);};walk(tree);return result;};
 render();return {props,render,flush,links,switches,find,button:label=>find(n=>n.type==='button'&&text(n).includes(label)),unmount:()=>cleanups.forEach(f=>f?.())};
}
(async()=>{
 const ui=mount();await ui.flush();ui.button('关联 / 管理季').props.onClick();await ui.flush();
 ui.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await ui.flush();
 assert.equal(ui.links.length,0,'search must never silently associate matching titles');
 ui.button('关联为第 2 季').props.onClick();await ui.flush();
 assert.equal(ui.links[0].targetSeriesId,'B');assert.equal(ui.links[0].seasonNumber,2);
 ui.find(n=>n.type==='select').props.onChange({target:{value:'B'}});await ui.flush();assert.deepEqual(ui.switches,['B']);ui.unmount();
 const gate=defer(), stale=mount({getSeriesSeasons:id=>id==='A'?gate.promise:Promise.resolve({success:true,data:data(id)})});
 stale.props.seriesId='C';stale.render();await stale.flush();gate.resolve({success:true,data:data('A',true)});await stale.flush();
 assert.equal(stale.find(n=>n.type==='option').props.value,'C','old season response must not replace new selection');stale.unmount();
 const searchGate=defer(), search=mount({searchSeries:()=>searchGate.promise});await search.flush();search.button('关联 / 管理季').props.onClick();await search.flush();
 search.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});search.render();assert.equal(search.button('关联 / 管理季').props.disabled,true,'cannot invalidate an in-flight operation by reloading');
 search.props.seriesId='C';search.render();await search.flush();searchGate.resolve({success:true,results:[{series_id:'obsolete'}]});await search.flush();
 search.button('关联 / 管理季').props.onClick();await search.flush();assert.equal(search.find(n=>n.props.key==='obsolete'),undefined);search.unmount();
 const failed=mount({linkSeriesSeason:async()=>({success:false,error:'季号冲突'})});await failed.flush();failed.button('关联 / 管理季').props.onClick();await failed.flush();
 failed.button('保存当前季号').props.onClick();await failed.flush();assert.ok(failed.find(n=>n.props.role==='alert').children.includes('季号冲突'));assert.equal(failed.button('保存当前季号').props.disabled,false);failed.unmount();

 const positions=new Map([['A',{vid_index:1,currentTime:12}],['B',{vid_index:2,currentTime:36}]]);
 const playback=player({apiOverrides:{getSeriesList:async()=>[{series_id:'A'},{series_id:'B'},{series_id:'C'}],getPlaybackPosition:async id=>positions.get(id),
 getSeriesEpisodes:async id=>({success:true,data:{series_id:id,series_title:id,episodes:[1,2].map(n=>({vid_index:n,vid:id+n,status:'missing'}))}})},props:{target:{seriesId:'A',vidIndex:1,resume:true}}});
 await playback.flush();playback.metadata();playback.media.currentTime=19;
 const seasonControl=()=>playback.find(n=>n.props.onSwitch&&n.props.seriesId);
 await seasonControl().props.onSwitch('B');await playback.flush();assert.equal(playback.prepares.at(-1).seriesId,'B');assert.equal(playback.prepares.at(-1).vidIndex,2);
 playback.metadata();assert.equal(playback.media.currentTime,36);assert.ok(playback.saves.some(p=>p[0]==='A'&&p[2]===19),'outgoing season position saved');
 await seasonControl().props.onSwitch('C');await playback.flush();assert.equal(playback.prepares.at(-1).seriesId,'C');assert.equal(playback.prepares.at(-1).vidIndex,1,'unwatched season starts first episode');playback.unmount();
 const positionGate=defer(),race=player({props:{target:{seriesId:'A',vidIndex:1}},apiOverrides:{getSeriesList:async()=>[{series_id:'A'},{series_id:'C'}],getPlaybackPosition:id=>id==='B'?positionGate.promise:Promise.resolve(null)}});await race.flush();
 const pending=race.find(n=>n.props.onSwitch&&n.props.seriesId).props.onSwitch('B');race.props.target={seriesId:'C',vidIndex:1,ts:2};race.render();await race.flush();positionGate.resolve({vid_index:2});await pending;await race.flush();
 assert.equal(race.find(n=>n.props.onSwitch&&n.props.seriesId).props.seriesId,'C','late season switch cannot override newer navigation');race.unmount();
 console.log('PASS season UI confirmation, stale IPC, errors, saved positions, first episode and navigation race');
})().catch(e=>{console.error(e);process.exitCode=1;});
