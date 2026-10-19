// Real distribution smoke test: bundled Electron/Node, bundled updater, full tar,
// ASAR version validation and atomic install. All writes stay in a temporary dir.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const exec = require('node:util').promisify(execFile);
const asar = require('@electron/asar');
const u = require('../src/native/linux-update');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
async function fixture(target, version, temp) {
  await fs.mkdir(path.join(target, 'app/resources/bin'), { recursive: true });
  for (const name of ['app/hongguo-downloader', '红果短剧.sh', 'app/resources/bin/ffmpeg', 'app/resources/bin/ffprobe']) await fs.writeFile(path.join(target, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const source = await fs.mkdtemp(path.join(temp, 'asar-'));
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'hongguo-downloader', version }));
  await asar.createPackage(source, path.join(target, 'app/resources/app.asar'));
}
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hongguo-bundle-test-'));
  const stage = path.join(root, 'dist/hongguo-linux-x64');
  const runtime = path.join(stage, 'app/hongguo-downloader'), worker = path.join(stage, 'linux-update.cjs');
  const archive = path.join(root, 'dist/hongguo-drama-' + version + '-linux-x64.tar.gz');
  try {
    assert.equal(u.validateBundle(stage), version);
    const sums = path.join(temp, 'SHA256SUMS.txt');
    await fs.writeFile(sums, await u.sha256(archive) + '  ' + path.basename(archive) + '\n');
    const target = path.join(temp, 'installed'); await fixture(target, '1.73.1', temp);
    await fs.writeFile(path.join(temp, 'watch-history.json'), 'preserve');
    await fs.symlink(path.join(target, '红果短剧.sh'), path.join(temp, 'hongguo'));
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    const result = await exec(runtime, [worker, '--target', target, '--archive', archive, '--checksum', sums, '--version', version], { env, timeout: 180000, maxBuffer: 3000 });
    assert.match(result.stdout, /更新完成/);
    assert.equal(u.validateBundle(target), version); assert.equal(u.validateBundle(target + '.previous'), '1.73.1');
    assert.equal(await fs.readFile(path.join(temp, 'watch-history.json'), 'utf8'), 'preserve');
    assert.equal(await fs.realpath(path.join(temp, 'hongguo')), path.join(target, '红果短剧.sh'));
    await fs.access(path.join(target, '更新红果短剧.sh')); await fs.access(path.join(target, 'linux-update.cjs'));
    // Exercise the detached-worker protocol and real process-exit wait as well.
    const incoming = path.join(temp, 'next'); await fixture(incoming, '1.75.0', temp);
    const firstInstall = path.join(temp, 'bootstrap-target'); await fixture(firstInstall, '1.73.1', temp);
    await exec(runtime, [worker, '--target', firstInstall, '--bundle', incoming], { env, timeout: 30000 });
    assert.equal(u.validateBundle(firstInstall), '1.75.0', 'bootstrap uses an extracted bundle without downloading again');
    assert.equal(u.validateBundle(firstInstall + '.previous'), '1.73.1');
    await assert.rejects(exec(runtime, [worker, '--target', firstInstall, '--bundle', stage], { env, timeout: 30000 }), /不进行降级/);
    const old = spawn(process.execPath, ['-e', 'setTimeout(()=>{},1000)'], { stdio: 'ignore' });
    const job = path.join(temp, 'job.json'), resultFile = path.join(temp, 'result.json'), workdir = path.join(temp, 'worker-temp');
    await fs.mkdir(workdir);
    await fs.writeFile(job, JSON.stringify({ pid: old.pid, root: incoming, target, version: '1.75.0', restart: false, resultFile, workdir }));
    await exec(runtime, [worker, '--job', job], { env, timeout: 30000, maxBuffer: 3000 });
    assert.equal(u.validateBundle(target), '1.75.0'); assert.equal(u.validateBundle(target + '.previous'), version);
    assert.equal(JSON.parse(await fs.readFile(resultFile, 'utf8')).success, true);
    console.log('PASS real Linux bundle: Electron Node runtime, full release archive, standalone CLI, bootstrap without redownload, downgrade guard, preserved history/launcher, previous backup, worker exit wait and result');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
