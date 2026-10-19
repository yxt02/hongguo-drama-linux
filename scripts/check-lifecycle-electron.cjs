// Run with Electron on a desktop session. Test windows stay hidden and user data
// is isolated under HONGGUO_TEST_TMP. No real application data is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const { createAppLifecycle } = require(process.env.HONGGUO_TEST_ASAR ? path.join(process.env.HONGGUO_TEST_ASAR, 'src/native/app-lifecycle') : '../src/native/app-lifecycle');
const temp = process.env.HONGGUO_TEST_TMP;
if (!temp || !path.resolve(temp).startsWith('/tmp/')) throw Error('HONGGUO_TEST_TMP must point to an isolated /tmp directory');
for (const name of ['userData', 'sessionData', 'crashDumps']) { const dir=path.join(temp,name); fs.mkdirSync(dir,{recursive:true}); app.setPath(name,dir); }
app.setAppLogsPath(path.join(temp,'logs')); app.setName('红果短剧托盘测试'); app.disableHardwareAcceleration();
let controller, cleanupCount = 0, settings = {}, trayState;
app.whenReady().then(async()=>{
  const main = new BrowserWindow({ show:false, webPreferences:{sandbox:true} });
  const helper = new BrowserWindow({ show:false, webPreferences:{sandbox:true} });
  controller = createAppLifecycle({ app, Tray, Menu, nativeImage, iconPath:process.env.HONGGUO_TEST_ASAR ? path.join(process.env.HONGGUO_TEST_ASAR,'build/icon.png') : path.join(__dirname,'../build/icon.png'),
    getWindow:()=>main, showWindow:()=>{}, getSettings:()=>settings, saveBehavior:value=>{settings.close_behavior=value;},
    cleanup:async()=>{cleanupCount++;await new Promise(r=>setTimeout(r,20));}, send:()=>{}, title:'红果短剧托盘测试' });
  controller.attach(main); trayState=await controller.start();
  assert.equal(trayState.trayAvailable,true,'the real desktop must expose the tray host');
  const mode = process.env.HONGGUO_TEST_CLOSE_MODE || 'tray';
  if (mode === 'tray') {
    assert.equal(controller.setBehavior('tray').success,true); main.close();
    assert.equal(main.isDestroyed(),false); assert.equal(main.isVisible(),false);
    assert.equal(helper.isDestroyed(),false); assert.equal(cleanupCount,0);
  }
  app.once('will-quit',()=>{
    assert.equal(cleanupCount,1); assert.equal(main.isDestroyed(),true); assert.equal(helper.isDestroyed(),true);
    fs.writeFileSync(path.join(temp,'result.json'),JSON.stringify({passed:true,mode,trayAvailable:trayState.trayAvailable,hiddenHelperClosed:true,cleanupCount}));
  });
  if (mode === 'tray') controller.quit(); else main.close();
}).catch(error=>{console.error(error);app.exit(1);});
