import React, { useEffect, useState } from 'react';

export default function AppUpdateControls() {
  const [state, setState] = useState({ phase: 'idle', supported: false });
  const [release, setRelease] = useState(null);
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    let active = true;
    const off = window.electronAPI?.onAppUpdateState?.(s => { if (active) setState(s); });
    window.electronAPI?.getAppUpdateState?.().then(s => { if (active) setState(s); }).catch(() => {});
    return () => { active = false; off?.(); };
  }, []);
  const action = async method => {
    setNotice('');
    try { const result = await window.electronAPI[method](); if (result?.success === false) setNotice(result.error || '操作失败，请重试'); return result; }
    catch (error) { setNotice(error.message || '操作失败，请重试'); }
  };
  const updateAndRestart = async () => {
    const result = await action('downloadAppUpdate');
    if (result?.success && result.phase === 'ready') await action('installAppUpdate');
  };
  const check = async () => {
    setChecking(true); setNotice(''); setRelease(null);
    setState(s => ({ ...s, phase: 'idle', error: '' }));
    try {
      const result = await window.electronAPI.checkAppUpdate({ manual: true });
      setRelease(result.release);
      setNotice(result.release ? '发现新版 ' + result.release.version : '未发现可用新版。若网络不可用，请稍后重试。');
    } catch { setNotice('检查失败，请确认 GitHub 网络连接后重试'); }
    finally { setChecking(false); }
  };
  const busy = ['checking', 'downloading', 'verifying', 'installing'].includes(state.phase);
  const labels = { updated: '已成功更新至 ' + state.version, checking: '检查新版…', downloading: '下载中 ' + (state.percent || 0) + '%', verifying: '校验并准备更新…', ready: '新版 ' + state.nextVersion + ' 已就绪', installing: '正在退出并安装…', current: '当前已是最新版本' };
  return <div className="app-update-controls">
    <p className="settings-hint">当前版本 {state.version || '…'}{state.linux ? ' · Linux 版' : ''}。{state.supported ? '点击一键更新后自动下载、校验并重启，无需卸载，保留旧版备份及观看记录。' : '可从发布页下载新版安装包。'}</p>
    <div className="preset-row">
      <button type="button" className="btn btn-outline" disabled={checking || busy || state.phase === 'ready'} onClick={check}>{checking ? '检查中…' : '立即检查更新'}</button>
      {state.supported && !busy && state.phase !== 'ready' && <button type="button" className="btn btn-primary" disabled={checking} onClick={updateAndRestart}>一键更新并重启</button>}
      {release && !state.supported && !busy && <button type="button" className="btn btn-primary" onClick={() => action('openAppUpdate')}>打开发布页</button>}
      {state.phase === 'ready' && <button type="button" className="btn btn-primary" onClick={() => action('installAppUpdate')}>重启并安装更新</button>}
      {(busy && state.phase !== 'installing' || state.phase === 'ready') && <button type="button" className="btn btn-outline" onClick={() => action('cancelAppUpdate')}>取消更新</button>}
    </div>
    <p className="settings-hint" role="status" aria-live="polite">{labels[state.phase] || notice}</p>
    {(state.error || notice && labels[state.phase]) && <p className="settings-hint" role="status">{state.error || notice}</p>}
  </div>;
}
