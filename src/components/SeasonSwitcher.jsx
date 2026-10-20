import React, { useState, useEffect, useCallback, useRef } from 'react';
import './SeasonSwitcher.css';

export default function SeasonSwitcher({ seriesId, onSwitch }) {
  const [view, setView] = useState(null), [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [query, setQuery] = useState(''), [input, setInput] = useState('');
  const [number, setNumber] = useState(2), [currentNumber, setCurrentNumber] = useState(1), [results, setResults] = useState([]);
  const [discovering, setDiscovering] = useState(false), [discoveryError, setDiscoveryError] = useState('');
  const discoveryRevision = useRef(0);
  const revision = useRef(0), operation = useRef(false), searchRevision = useRef(0);
  const reload = useCallback(async () => {
    if (!seriesId || !window.electronAPI.getSeriesSeasons || operation.current) return;
    operation.current = true; setBusy(true);
    const run = ++revision.current;
    try {
      const result = await window.electronAPI.getSeriesSeasons(String(seriesId));
      if (run !== revision.current) return;
      if (!result?.success) throw Error(result?.error || '读取季信息失败');
      setView(result.data); setQuery(result.data.query); setNumber(result.data.nextNumber); setCurrentNumber(result.data.currentNumber); setError('');
      if (window.electronAPI.discoverSeriesSeasons) {
        const lookup = ++discoveryRevision.current;
        setDiscovering(true); setDiscoveryError('');
        window.electronAPI.discoverSeriesSeasons(String(seriesId)).then(found => {
          if (run !== revision.current || lookup !== discoveryRevision.current) return;
          if (!found?.success) throw Error(found?.error || '自动查找其他季失败');
          setView(found.data);
        }).catch(e => { if (run === revision.current && lookup === discoveryRevision.current) setDiscoveryError(e.message); })
          .finally(() => { if (run === revision.current && lookup === discoveryRevision.current) setDiscovering(false); });
      }
    } catch (e) { if (run === revision.current) setError(e.message); }
    finally { if (run === revision.current) { operation.current = false; setBusy(false); } }
  }, [seriesId]);
  useEffect(() => {
    setDiscovering(false); setDiscoveryError(''); setView(null); setOpen(false); setResults([]); setInput(''); setError(''); operation.current = false; setBusy(false);
    reload();
    return () => { revision.current++; searchRevision.current++; discoveryRevision.current++; };
  }, [reload]);
  const perform = async action => {
    if (operation.current) return;
    discoveryRevision.current++; setDiscovering(false);
    operation.current = true; setBusy(true); setError(''); const run = revision.current;
    try { await action(run); }
    catch(e) { if (run === revision.current) setError(e.message || '操作失败，请重试'); }
    finally { if (run === revision.current) { operation.current = false; setBusy(false); } }
  };
  const link = async (id, season, run) => {
    const result = await window.electronAPI.linkSeriesSeason({ seriesId:String(seriesId), targetSeriesId:String(id), seasonNumber:Number(season) });
    if (run !== revision.current) return;
    if (!result?.success) throw Error(result?.error || '关联失败');
    setView(result.data); setNumber(result.data.nextNumber); setCurrentNumber(result.data.currentNumber); setResults([]);
  };
  const add = id => perform(async run => {
    const resolved = await window.electronAPI.searchResolve(id);
    if (run !== revision.current) return;
    if (!resolved?.success || String(resolved.data?.series_id) !== String(id)) throw Error(resolved?.error || '来源返回的剧集不一致');
    await link(id, number, run);
  });
  const search = () => perform(async run => {
    const searchRun = ++searchRevision.current;
    const result = await window.electronAPI.searchSeries(query.trim(), { source:view.source });
    if (run !== revision.current || searchRun !== searchRevision.current) return;
    if (!result?.success) throw Error(result?.error || '搜索失败');
    setResults((result.results || []).filter(s=>String(s.series_id)!==String(seriesId)).slice(0,50));
    if (!result.results?.length) setError('没有搜索结果，可以尝试分享链接或剧集 ID');
  });
  const addInput = () => perform(async run => {
    const value=input.trim();
    const result = /^(?:xifan:|hema:|custom:)/.test(value) ? await window.electronAPI.searchResolve(value) : await window.electronAPI.hongguoResolve(value);
    if (run !== revision.current) return;
    if (!result?.success || !result.data?.series_id) throw Error(result?.error || '未能识别该季');
    await link(result.data.series_id, number, run); if (run === revision.current) setInput('');
  });
  const switchTo = id => {
    if (String(id) === String(seriesId)) return;
    perform(async run => {
      const item = view?.related?.find(s => s.series_id === String(id));
      if (item && !item.registered) {
        const resolved = await window.electronAPI.searchResolve(id);
        if (run !== revision.current) return;
        if (!resolved?.success || String(resolved.data?.series_id) !== String(id)) throw Error(resolved?.error || '该季暂时无法加载');
      }
      await onSwitch(id);
      if (run === revision.current) setOpen(false);
    });
  };
  if (!seriesId || !window.electronAPI.getSeriesSeasons) return null;
  return <div className="season-switcher">
    <div className="season-strip" aria-label="剧集季列表">
      <strong>季</strong>
      {(view?.related || view?.seasons || []).map(s => <button key={s.series_id} className={`btn btn-outline season-chip ${s.series_id===String(seriesId)?'active':''}`}
        aria-pressed={s.series_id===String(seriesId)} aria-label={`切换到第 ${s.number} 季 · ${s.series_title}`}
        title={`${s.series_title}${s.automatic?' · 按剧名自动识别':''}`} disabled={busy} onClick={()=>switchTo(s.series_id)}>
        第 {s.number} 季 {s.automatic && <small>· {s.series_title}</small>}
      </button>)}
      {discovering && <span role="status">自动查找其他季…</span>}
      {discoveryError && <span className="season-discovery-error">自动查找暂不可用 <button className="btn btn-outline btn-sm" disabled={busy} onClick={reload}>重试</button></span>}
    </div>
    {error && !open && <p role="alert">{error}</p>}
    <button className="btn btn-outline" aria-expanded={open} disabled={busy} onClick={()=>{if(!open)reload();setOpen(v=>!v);}}>修正季信息</button>
    {open && <section className="season-panel" aria-label="管理剧集季" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);}}}>
      <div className="season-panel-heading"><strong>季管理</strong><button className="btn btn-outline btn-sm" onClick={()=>setOpen(false)}>收起</button></div>
      <p>其他季已按剧名自动显示，点击即可切换。识别有误时可在这里手动指定季号与关联。每季独立保存观看进度。</p>
      {error && <p role="alert">{error}</p>}
      <div className="season-form"><label>当前季号<input disabled={busy} aria-label="当前季号" className="input-field" type="number" min="1" max="999" value={currentNumber} onChange={e=>setCurrentNumber(e.target.value)} /></label>
        <button className="btn btn-outline" disabled={busy || !view} onClick={()=>perform(run=>link(seriesId,currentNumber,run))}>保存当前季号</button></div>
      <ul className="season-members">{view?.seasons.map(s=><li key={s.series_id}><span>第 {s.number} 季 · {s.series_title}</span>
        {view.linked && <button className="btn btn-outline btn-sm" disabled={busy} onClick={()=>perform(async run=>{
          const result=await window.electronAPI.unlinkSeriesSeason({seriesId:String(seriesId),targetSeriesId:s.series_id});
          if(run!==revision.current)return;if(!result?.success)throw Error(result?.error||'解除失败');setView(result.data);setNumber(result.data.nextNumber);setCurrentNumber(result.data.currentNumber);
        })}>解除关联</button>}
      </li>)}</ul>
      <div className="season-form"><label>关联为第几季<input disabled={busy} aria-label="要关联的季号" className="input-field" type="number" min="1" max="999" value={number} onChange={e=>setNumber(e.target.value)} /></label></div>
      <form className="season-form" onSubmit={event=>{event.preventDefault();if(query.trim())search();}}>
        <input disabled={busy} className="input-field" aria-label="查找其他季" placeholder="搜索其他季的剧名" value={query} onChange={e=>{searchRevision.current++;setQuery(e.target.value);setResults([]);}} />
        <button className="btn btn-outline" disabled={busy || !query.trim() || !view}>搜索其他季</button>
      </form>
      <form className="season-form" onSubmit={event=>{event.preventDefault();if(input.trim())addInput();}}>
        <input disabled={busy} className="input-field" aria-label="其他季分享链接或ID" placeholder="或粘贴分享链接 / 剧集 ID" value={input} onChange={e=>setInput(e.target.value)} />
        <button className="btn btn-outline" disabled={busy || !input.trim() || !view}>关联链接</button>
      </form>
      {busy && <p role="status">正在处理…</p>}
      {!results.length && !!view?.candidates.length && <p>剧库中的可能续季（请确认后关联）</p>}
      <ul className="season-candidates">{(results.length ? results : view?.candidates || []).filter(s=>!view?.seasons.some(m=>m.series_id===String(s.series_id))).map(s=><li key={s.series_id}>
        {s.cover && <img src={s.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <span>{s.series_title}</span><button className="btn btn-outline btn-sm" disabled={busy} onClick={()=>add(s.series_id)}>关联为第 {number} 季</button>
      </li>)}</ul>
    </section>}
  </div>;
}
