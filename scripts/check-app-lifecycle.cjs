const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppLifecycle } = require('../src/native/app-lifecycle');
function fixture({ host = true, trayFails = false } = {}) {
  const app = new EventEmitter(), win = new EventEmitter(); let settings = {}, menu, tray, cleanupCount = 0, finalExit = 0, restored = 0, hidden = 0, failSave = false, release;
  app.quit = () => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; app.emit('before-quit', event); if (!event.prevented) { finalExit++; const close = { preventDefault() { throw Error('quit was incorrectly hidden to tray'); } }; win.emit('close', close); app.emit('will-quit'); } };
  Object.assign(win, { isDestroyed: () => false, hide: () => { hidden++; } });
  class Tray extends EventEmitter {
    constructor() { super(); if (trayFails) throw Error('unavailable'); tray = this; }
    setToolTip() {} setContextMenu(value) { menu = value; } destroy() { this.destroyed = true; }
  }
  const events = [];
  const controller = createAppLifecycle({ app, Tray, Menu: { buildFromTemplate: value => value }, nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize: () => ({}) }) },
    getWindow: () => win, showWindow: () => { restored++; }, getSettings: () => settings,
    saveBehavior: value => { if (failSave) throw Error('disk full'); settings = { ...settings, close_behavior: value }; },
    cleanup: () => { cleanupCount++; return new Promise(resolve => { release = resolve; }); },
    send: (name, state) => events.push({ name, state }), probeHost: async () => host,
  });
  controller.attach(win);
  return { controller, app, win, events, get menu() { return menu; }, get tray() { return tray; }, get hidden() { return hidden; }, get restored() { return restored; }, get cleanupCount() { return cleanupCount; }, get exits() { return finalExit; }, release: () => release(), failSave: () => { failSave = true; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  let f = fixture(); await f.controller.start();
  assert.equal(f.controller.state().closeBehavior, 'quit'); assert.equal(f.controller.state().trayAvailable, true);
  assert.equal(f.controller.setBehavior('tray').success, true);
  let prevented = false; f.win.emit('close', { preventDefault() { prevented = true; } });
  assert.ok(prevented); assert.equal(f.hidden, 1); assert.equal(f.cleanupCount, 0, 'close-to-tray leaves background work alive');
  f.tray.emit('click'); f.menu.find(m => m.label === '显示主窗口').click(); assert.equal(f.restored, 2);
  f.menu.find(m => m.label === '最小化到托盘').click(); assert.equal(f.hidden, 2);
  f.failSave(); assert.equal(f.controller.setBehavior('quit').success, false); assert.equal(f.controller.state().closeBehavior, 'tray');
  assert.equal(f.controller.setBehavior('invalid').success, false);
  f.menu.find(m => m.label === '退出程序').click(); await flush();
  assert.equal(f.cleanupCount, 1); assert.equal(f.exits, 0, 'updater must wait for writers to drain');
  f.app.quit(); await flush(); assert.equal(f.cleanupCount, 1); assert.equal(f.exits, 0, 'repeated quit cannot bypass the drain');
  f.release(); await flush(); assert.equal(f.exits, 1); assert.ok(f.tray.destroyed);
  f = fixture(); await f.controller.start();
  f.win.emit('close', { preventDefault() {} }); await flush();
  assert.equal(f.cleanupCount, 1, 'default X explicitly quits despite hidden helper windows');
  f.release(); await flush(); assert.equal(f.exits, 1);
  for (const options of [{ host: false }, { trayFails: true }]) {
    f = fixture(options); await f.controller.start();
    assert.equal(f.controller.state().trayAvailable, false);
    assert.equal(f.controller.setBehavior('tray').success, false);
    assert.equal(f.controller.hide().success, false); assert.equal(f.hidden, 0, 'never hide into an unavailable tray');
    f.app.quit(); await flush(); f.release(); await flush(); assert.equal(f.exits, 1);
  }
  console.log('PASS lifecycle: tray restore/hide/menu, saved close preference, unavailable-host fallback, hidden helper close bug, explicit quit and updater quit drain, tray destruction');
})().catch(e => { console.error(e); process.exitCode = 1; });
