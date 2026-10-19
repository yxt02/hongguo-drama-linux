import React, { useEffect, useState } from 'react';

export default function AppWindowControls() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const off = window.electronAPI?.onAppLifecycleState?.(s => { if (active) setState(s); });
    window.electronAPI?.getAppLifecycleState?.().then(s => { if (active) setState(s); }).catch(() => {});
    return () => { active = false; off?.(); };
  }, []);
  const action = async (method, value) => {
    setBusy(true); setError('');
    try {
      const result = await window.electronAPI[method](value);
      if (!result?.success) setError(result?.error || '操作失败，请重试');
      else if (result.closeBehavior) setState(result);
    } catch (e) { setError(e.message || '操作失败，请重试'); }
    finally { setBusy(false); }
  };
  if (!state?.supported) return null;
  return <section className="settings-card" aria-label="窗口与托盘">
    <div className="settings-group">
      <label className="settings-label" htmlFor="close-behavior">关闭按钮（X）</label>
      <select id="close-behavior" className="input-field select-field" value={state.closeBehavior} disabled={busy}
        onChange={event => action('setCloseBehavior', event.target.value)}>
        <option value="quit">退出程序</option>
        <option value="tray" disabled={!state.trayAvailable}>最小化到托盘，继续后台任务</option>
      </select>
      <p className="settings-hint">立即保存。托盘图标可显示主窗口、收起窗口或退出程序；“退出程序”会结束后台任务，更新时也会完整退出。</p>
      <div className="preset-row">
        <button type="button" className="btn btn-outline" disabled={busy || !state.trayAvailable} onClick={() => action('hideToTray')}>最小化到托盘</button>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => action('minimizeWindow')}>普通最小化</button>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => action('quitApp')}>退出程序</button>
      </div>
      {(error || state.error) && <p className="settings-hint" role="alert">{error || state.error}</p>}
    </div>
  </section>;
}
