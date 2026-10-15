// Run with node; an optional argument supplies an existing node_modules directory.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
if (process.argv[2] === '--renderer-test') {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', path.join(process.argv[3], 'profile'));
  app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 800 });
    try {
      await window.loadFile(path.join(process.argv[3], 'index.html'));
      const result = await window.webContents.executeJavaScript('window.testResult');
      console.log(JSON.stringify(result));
      app.exit(result.passed ? 0 : 1);
    } catch (error) { console.error(error); app.exit(1); }
  });
} else {
  const modules = path.resolve(process.argv[2] || path.join(__dirname, '../node_modules'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-danmaku-test-'));
  try {
    require(path.join(modules, 'esbuild')).buildSync({
      entryPoints: [path.join(__dirname, 'danmaku-live.fixture.jsx')], bundle: true,
      outfile: path.join(temp, 'test.js'), nodePaths: [modules], loader: { '.css': 'empty' },
      define: { 'process.env.NODE_ENV': '"development"' },
    });
    fs.writeFileSync(path.join(temp, 'index.html'), '<div id="root"></div><script src="test.js"></script>');
    const electronBin = require(path.join(modules, 'electron'));
    // Chromium aborts at startup when the SUID helper is unusable and user
    // namespaces are restricted (Ubuntu 24.04), so add --no-sandbox there.
    const { sandboxArgv } = require('./chromium-sandbox.cjs');
    const result = require('node:child_process').spawnSync(electronBin,
      sandboxArgv(electronBin, [__filename, '--renderer-test', temp]), { encoding: 'utf8', timeout: 20000 });
    console.log(result.stdout.trim());
    if (result.status !== 0) console.error(result.error || result.stderr.trim());
    process.exitCode = result.status === 0 ? 0 : 1;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
