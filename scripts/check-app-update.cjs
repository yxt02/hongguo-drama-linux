const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const file = path.resolve(__dirname, '../main.js'), req = createRequire(file);
const app = new EventEmitter();
Object.assign(app, { getVersion: () => '1.2.0', getPath: () => '/synthetic', commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }) });
let settings = {}, response, requests = 0, requestOptions;
const handlers = {}, opened = [], events = [], sender = {};
const store = { setErrorHandler() {}, getSettings: () => settings, saveSettings: v => { settings = v; } };
const electron = { app, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, protocol: { registerSchemesAsPrivileged() {} }, shell: { openExternal: async url => { opened.push(url); } } };
const axios = { get: async (url, options) => { requests++; requestOptions = { url, ...options }; if (response instanceof Error) throw response; return { data: await response }; } };
const context = vm.createContext({ require: name => name === 'electron' ? electron : name === 'axios' ? axios : name === './src/store' ? store : req(name), __dirname: path.dirname(file), process: { ...process, platform: 'darwin' }, Buffer, URL, AbortController, setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} } });
vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
vm.runInContext('mainWindow = { webContents: testSender };', Object.assign(context, { testSender: sender }));
context.sendToRenderer = (name, value) => events.push([name,value]);
context.applyProxySettings = async () => {};
const ipc = (name, ...args) => handlers[name]({sender}, ...args);
(async()=>{
  assert.equal(typeof handlers['check-app-update'], 'function', 'update detection IPC must exist');
  assert.equal((await ipc('get-settings')).app_updates_enabled, true);
  settings.app_updates_enabled=false;
  assert.equal((await ipc('check-app-update')).enabled,false);assert.equal(requests,0);
  settings.app_updates_enabled=true;
  for(const tag of ['v1.1.9','1.2','v1.2.0','v1.2.0-beta.1','garbage']){
    response={tag_name:tag,draft:false,prerelease:false};assert.equal((await ipc('check-app-update')).release,null,tag);
  }
  for(const flags of [{draft:true},{prerelease:true}]){response={tag_name:'v2.0',...flags};assert.equal((await ipc('check-app-update')).release,null);}
  response={tag_name:'v1.2.1',html_url:'https://evil.invalid/download'};
  let result=await ipc('check-app-update');assert.equal(result.release.version,'1.2.1');
  assert.equal(result.release.url,'https://github.com/jackotom/hongguo-drama/releases/tag/v1.2.1');
  await ipc('open-app-update');assert.equal(opened[0],result.release.url);
  assert.equal(requestOptions.url,'https://api.github.com/repos/jackotom/hongguo-drama/releases/latest');
  assert.equal(requestOptions.timeout,10000);assert.equal(requestOptions.maxRedirects,0);
  response={tag_name:'v2.0'};result=await ipc('check-app-update');assert.equal(result.release.version,'2.0');
  response=Error('network timeout');assert.equal((await ipc('check-app-update')).release,null);
  let resolve;response=new Promise(r=>{resolve=r});const pending=ipc('check-app-update');
  await ipc('save-settings',{app_updates_enabled:false});resolve({tag_name:'v3.0'});
  assert.equal((await pending).enabled,false);assert.ok(events.some(([n,v])=>n==='app-update-preference'&&v===false));
  assert.equal((await ipc('open-app-update')).success,false);
  console.log('PASS update IPC: opt-out, persisted preference, versions, stable releases, fixed GitHub destination, timeout and late-response suppression');
})().catch(e=>{console.error(e);process.exitCode=1});
