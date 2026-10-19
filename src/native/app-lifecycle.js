const { execFile } = require('node:child_process');

function probeTrayHost() {
  return new Promise(resolve => {
    execFile('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.NameHasOwner', 'org.kde.StatusNotifierWatcher'],
      { timeout: 1500 }, (error, stdout) => resolve(error ? null : /\btrue\b/.test(stdout)));
  });
}

function createAppLifecycle({ app, Tray, Menu, nativeImage, iconPath, getWindow, showWindow,
  getSettings, saveBehavior, cleanup, send, probeHost = probeTrayHost, title = '红果短剧' }) {
  let tray = null, available = false, quitting = false, finalizing = false, error = '';
  const behavior = () => getSettings().close_behavior === 'tray' ? 'tray' : 'quit';
  const state = () => ({ supported: true, trayAvailable: available, closeBehavior: behavior(), error });
  const publish = () => send('app-lifecycle-state', state());
  const destroyTray = () => { available = false; if (tray) { try { tray.destroy(); } catch (_) {} tray = null; } };
  const quit = () => { app.quit(); };
  const hide = () => {
    const win = getWindow();
    if (quitting || !win || win.isDestroyed()) return { success: false, error: '窗口不可用' };
    if (!available) return { success: false, error: '系统托盘不可用，请使用普通最小化或退出程序' };
    win.hide(); return { success: true };
  };
  const setBehavior = value => {
    if (!['quit', 'tray'].includes(value)) return { success: false, error: '关闭行为无效' };
    if (value === 'tray' && !available) return { success: false, error: '系统托盘不可用，不能收起到托盘' };
    try { saveBehavior(value); error = ''; refresh(); return { success: true, ...state() }; }
    catch (e) { error = '保存关闭行为失败：' + e.message; refresh(); return { success: false, error }; }
  };
  const refresh = () => {
    if (tray) tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主窗口', click: showWindow },
      { label: '最小化到托盘', enabled: available, click: hide },
      { type: 'separator' },
      { label: '点 X 时', submenu: [
        { label: '退出程序', type: 'radio', checked: behavior() === 'quit', click: () => setBehavior('quit') },
        { label: '最小化到托盘', type: 'radio', enabled: available, checked: behavior() === 'tray', click: () => setBehavior('tray') },
      ] },
      { type: 'separator' },
      { label: '退出程序', click: quit },
    ]));
    publish();
  };
  const start = async () => {
    try {
      const image = nativeImage.createFromPath(iconPath);
      if (image.isEmpty()) throw new Error('缺少托盘图标');
      tray = new Tray(image.resize({ width: 22, height: 22 }));
      tray.setToolTip(title);
      tray.on('click', showWindow);
      const host = await probeHost();
      available = host !== false;
      if (!available) error = '系统没有可用的托盘服务；点 X 将退出程序';
    } catch (e) { error = '托盘不可用：' + e.message; destroyTray(); }
    refresh(); return state();
  };
  const attach = win => {
    win.on('close', event => {
      if (quitting) { if (!finalizing) event.preventDefault(); return; }
      event.preventDefault();
      if (behavior() === 'tray' && available) hide();
      else quit(); // Explicitly quit even if a hidden search window still exists.
    });
  };
  app.on('before-quit', event => {
    if (finalizing) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    // Wait for cancelled writers/FFmpeg before releasing the process to the updater.
    Promise.resolve().then(cleanup).catch(e => {
      console.error('[Quit] 清理后台任务失败:', e.message);
    }).finally(() => { destroyTray(); finalizing = true; app.quit(); });
  });
  app.on('will-quit', destroyTray);
  return { start, attach, state, refresh, hide, quit, setBehavior, get quitting() { return quitting; } };
}
module.exports = { createAppLifecycle, probeTrayHost };
