const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const slots = [], effects = [], calls = []; let cursor = 0, tree, listener, cleanup, off = false;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], n => { slots[i] = typeof n === 'function' ? n(slots[i]) : n; }]; },
  useEffect(fn) { const i = cursor++; if (!(i in slots)) { slots[i] = true; effects.push(fn); } },
};
const initial = { supported: true, trayAvailable: true, closeBehavior: 'quit' };
const api = {
  getAppLifecycleState: async () => initial,
  onAppLifecycleState: cb => { listener = cb; return () => { off = true; }; },
  setCloseBehavior: async value => { calls.push(['behavior', value]); return { success: true, ...initial, closeBehavior: value }; },
};
for (const method of ['hideToTray', 'minimizeWindow', 'quitApp']) api[method] = async () => { calls.push([method]); return { success: true }; };
const context = { module: { exports: {} }, require: () => react, window: { electronAPI: api } }; context.exports = context.module.exports;
vm.runInNewContext(transformSync(fs.readFileSync(require.resolve('../src/components/AppWindowControls.jsx'),'utf8'),{loader:'jsx',format:'cjs'}).code,context);
const render = () => { cursor = 0; tree = context.module.exports.default(); effects.splice(0).forEach(fn => { cleanup = fn(); }); };
const nodes = () => { const all=[]; const walk = n => { if (!n || typeof n !== 'object') return; all.push(n); n.children?.forEach(walk); }; walk(tree); return all; };
const button = label => nodes().find(n => n.type==='button' && n.children.includes(label));
(async()=>{
  render(); await Promise.resolve(); render();
  await nodes().find(n=>n.type==='select').props.onChange({target:{value:'tray'}}); render();
  assert.equal(nodes().find(n=>n.type==='select').props.value,'tray'); assert.deepEqual(calls.pop(),['behavior','tray']);
  for (const [label, method] of [['最小化到托盘','hideToTray'],['普通最小化','minimizeWindow'],['退出程序','quitApp']]) {
    await button(label).props.onClick(); assert.deepEqual(calls.pop(),[method]);
  }
  listener({...initial,trayAvailable:false,error:'No tray host'}); render();
  assert.equal(button('最小化到托盘').props.disabled,true); assert.equal(button('退出程序').props.disabled,false);
  assert.ok(nodes().some(n=>n.props.role==='alert'));
  listener({...initial,closeBehavior:'tray'}); render(); assert.equal(nodes().find(n=>n.type==='select').props.value,'tray');
  cleanup(); assert.ok(off);
  console.log('PASS window controls: immediate close preference, tray/normal minimize, quit, unavailable-tray fallback, external menu preference sync, cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
