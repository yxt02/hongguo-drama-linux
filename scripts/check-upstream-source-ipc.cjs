// Exercise the integrated search/catalog dispatch; no browser, registration or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../main.js'), 'utf8');
function fixture() {
  const calls = [], handlers = {};
  const state = { web: { success: true, results: [{ series_id: '1' }] }, app: { success: true, results: [{ series_id: '2' }] },
    recent: [{ series_id: '3' }], catalog: { success: true, results: [] }, mode: 'direct' };
  const invoke = (name, value, args) => { calls.push({ name, args }); if (value instanceof Error) throw value; return value; };
  const context = vm.createContext({
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    resolveProxyConfig: () => ({ mode: state.mode }), getCurrentSettings: () => ({}),
    require: name => ({
      './src/native/hongguo-search': { searchHongguo: async (...args) => invoke('web-search', state.web, args) },
      './src/native/hongguo-app-search': { searchApp: async (...args) => invoke('app-search', state.app, args) },
      './src/native/hongguo-app-new': { searchNewReleases: async (...args) => invoke('recent', state.recent, args) },
      './src/native/hongguo-app-catalog': { browseList: async (...args) => invoke('app-catalog', state.catalog, args) },
      './src/native/catalog': { browseList: async (...args) => invoke('web-catalog', { success: true, results: [] }, args) },
      './src/native/hema': { browseList: async (...args) => invoke('hema', { success: true }, args) },
      './src/native/xifan': { browseList: async (...args) => invoke('xifan', { success: true }, args) },
      './src/native/custom-source': { browseList: async (...args) => invoke('custom', { success: true }, args) },
    })[name],
  });
  const start = source.indexOf('async function runSearchSniff(');
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  const catalog = source.indexOf("ipcMain.handle('browse-list'");
  vm.runInContext(source.slice(catalog, source.indexOf('\n});', catalog) + 4), context);
  return { calls, state, search: (...args) => context.runSearchSniff(...args), browse: options => handlers['browse-list']({}, options) };
}
(async () => {
  let h = fixture();
  assert.equal((await h.search('测试')).results[0].series_id, '1');
  assert.deepEqual(h.calls.map(c => c.name), ['web-search'], 'healthy website search needs no hidden window or extra registration');
  h = fixture(); h.state.web = { success: true, results: [] };
  assert.equal((await h.search('测试')).results[0].series_id, '2');
  assert.deepEqual(h.calls.map(c => c.name), ['web-search', 'app-search']);
  assert.equal(h.calls[0].args[1].deadline, h.calls[1].args[1].deadline, 'fallback shares one total deadline');
  h.state.app = new Error('接口不可用');
  assert.equal((await h.search('测试')).channel, 'app-new');
  h.state.recent = []; assert.equal((await h.search('测试')).success, true, 'valid empty website results remain valid');
  h.state.web = new Error('官网连接中断');
  await assert.rejects(h.search('测试'), /官网连接中断/);
  h.state.app = { success: true, results: [], channel: 'app' };
  assert.equal((await h.search('测试')).channel, 'app', 'an empty but valid App response survives a website failure');
  const before = h.calls.length;
  await assert.rejects(h.search('测试', { deadline: Date.now() - 1 }), /搜索超时/);
  assert.equal(h.calls.length, before);

  h = fixture();
  await h.browse({ source: 'hongguo' }); assert.equal(h.calls.at(-1).name, 'app-catalog');
  h.state.catalog = { success: false, error: 'App 目录暂不可用' };
  await h.browse({ source: 'hongguo' }); assert.equal(h.calls.at(-1).name, 'web-catalog');
  assert.equal(h.calls.at(-1).args[0].allowTrustedDns, true);
  h.state.mode = 'custom'; await h.browse({ source: 'hongguo', catalogChannel: 'web', allowTrustedDns: true });
  assert.equal(h.calls.at(-1).args[0].allowTrustedDns, false, 'renderer cannot bypass the selected proxy');
  for (const provider of ['hema', 'xifan', 'custom:test']) {
    await h.browse({ source: provider }); assert.equal(h.calls.at(-1).name, provider.split(':')[0]);
  }
  const previous = h.calls.length;
  assert.equal((await h.browse({ catalogChannel: 'unknown' })).success, false);
  assert.equal(h.calls.length, previous);
  console.log('PASS integrated website/App/new-release search, shared deadline, App catalog fallback, proxy policy and source isolation');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
