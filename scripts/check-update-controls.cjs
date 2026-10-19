const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const slots = [], effects = [], calls = [];
let cursor = 0, tree, listener, off = false, release = { version: '1.74.2' }, downloadResult = { success: true, phase: 'ready' };
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
  useEffect(fn) { const i = cursor++; if (!(i in slots)) { slots[i] = true; effects.push(fn); } },
};
const api = {
  getAppUpdateState: async () => ({ phase: 'idle', supported: true, linux: true, version: '1.74.1' }),
  onAppUpdateState: cb => { listener = cb; return () => { off = true; }; },
  checkAppUpdate: async options => { assert.equal(options.manual, true); return { enabled: false, release }; },
};
for (const method of ['downloadAppUpdate', 'cancelAppUpdate', 'installAppUpdate', 'openAppUpdate']) api[method] = async () => { calls.push(method); return { success: true }; };
api.downloadAppUpdate = async () => { calls.push('downloadAppUpdate'); return downloadResult; };
const context = { module: { exports: {} }, require: () => react, window: { electronAPI: api } }; context.exports = context.module.exports;
vm.runInNewContext(transformSync(fs.readFileSync(require.resolve('../src/components/AppUpdateControls.jsx'), 'utf8'), { loader: 'jsx', format: 'cjs' }).code, context);
let cleanup;
const render = () => { cursor = 0; tree = context.module.exports.default(); effects.splice(0).forEach(fn => { cleanup = fn(); }); };
const nodes = () => { const list = []; const walk = n => { if (!n || typeof n !== 'object') return; list.push(n); n.children?.forEach(walk); }; walk(tree); return list; };
const button = text => nodes().find(n => n.type === 'button' && n.children.includes(text));
(async () => {
  render(); await Promise.resolve(); render();
  await button('一键更新并重启').props.onClick();
  assert.deepEqual(calls.splice(0), ['downloadAppUpdate', 'installAppUpdate'], 'one click checks/downloads and installs without a second confirmation');
  for (const result of [{ success: false, error: '已取消更新' }, { success: false, error: '校验失败' }, { success: true, phase: 'current' }]) {
    downloadResult = result;
    await button('一键更新并重启').props.onClick();
    assert.deepEqual(calls.splice(0), ['downloadAppUpdate'], 'cancel, failure or current version never triggers install');
  }
  await button('立即检查更新').props.onClick(); render();
  assert.ok(button('一键更新并重启'), 'manual check works while auto check is disabled');
  listener({ phase: 'downloading', supported: true, percent: 42 }); render();
  assert.equal(button('立即检查更新').props.disabled, true); assert.ok(button('取消更新'));
  await button('取消更新').props.onClick(); assert.equal(calls.pop(), 'cancelAppUpdate');
  listener({ phase: 'ready', supported: true, nextVersion: '1.74.2' }); render();
  await button('重启并安装更新').props.onClick(); assert.equal(calls.pop(), 'installAppUpdate');
  listener({ phase: 'error', supported: true, error: 'previous network error' }); render();
  release = null; await button('立即检查更新').props.onClick(); render();
  assert.ok(!nodes().some(n => n.children?.includes('previous network error')), 'retry clears stale failure');
  listener({ phase: 'idle', supported: false }); release = { version: '1.74.2' }; render();
  await button('立即检查更新').props.onClick(); render();
  await button('打开发布页').props.onClick(); assert.equal(calls.pop(), 'openAppUpdate');
  cleanup(); assert.ok(off);
  console.log('PASS update controls: one-click download/install, cancel/failure blocks install, manual check with auto disabled, progress/cancel, retry, unsupported fallback, listener cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
