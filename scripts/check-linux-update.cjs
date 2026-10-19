const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { execFile } = require('node:child_process');
const exec = require('node:util').promisify(execFile);
const asar = require('@electron/asar');
const u = require('../src/native/linux-update');
const { availableRelease, releasesApi } = require('../src/native/app-update');
async function bundle(root, version) {
  await fs.mkdir(path.join(root, 'app/resources/bin'), { recursive: true });
  for (const name of ['app/hongguo-downloader', '红果短剧.sh', 'app/resources/bin/ffmpeg', 'app/resources/bin/ffprobe']) {
    await fs.writeFile(path.join(root, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const source = await fs.mkdtemp(path.join(path.dirname(root), 'asar-'));
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'hongguo-downloader', version }));
  await asar.createPackage(source, path.join(root, 'app/resources/app.asar')); await fs.rm(source, { recursive: true });
}
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'hongguo-update-test-'));
  try {
    assert.equal(releasesApi('linux'), 'https://api.github.com/repos/yxt02/hongguo-drama-linux/releases/latest');
    assert.equal(availableRelease({ tag_name: 'v1.74.1-linux' }, '1.74.0', { platform: 'linux' }).version, '1.74.1');
    for (const tag of ['v1.74.0-linux', 'v1.73.9-linux', 'v1.75.0', 'v1.75.0-linux-beta']) assert.equal(availableRelease({ tag_name: tag }, '1.74.0', { platform: 'linux' }), null);
    assert.equal(availableRelease({ tag_name: 'v1.75.0-linux', prerelease: true }, '1.74.0', { platform: 'linux' }), null);
    const release = { version: '1.74.1', tag: 'v1.74.1-linux', name: 'hongguo-drama-1.74.1-linux-x64.tar.gz' };
    let requested;
    const latest = await u.latest('1.74.0', { request: { get: async url => { requested = url; return { data: { tag_name: release.tag, assets: [release.name, 'SHA256SUMS.txt'].map(name => ({ name, state: 'uploaded' })) } }; } } });
    assert.equal(requested, releasesApi('linux')); assert.equal(latest.version, release.version);
    await assert.rejects(u.latest('1.74.0', { request: { get: async () => ({ data: { tag_name: release.tag, assets: [] } }) } }), /完整/);
    const incoming = path.join(temp, 'hongguo-linux-x64'), target = path.join(temp, 'installed');
    await bundle(incoming, '1.74.1'); await bundle(target, '1.74.0');
    assert.equal(u.validateBundle(target), '1.74.0');
    assert.equal(u.detectBundle(path.join(target, 'app/hongguo-downloader')), target);
    assert.throws(() => u.validateBundle(incoming, '1.74.2'), /版本/);
    const archive = path.join(temp, release.name);
    await exec('tar', ['-czf', archive, '-C', temp, 'hongguo-linux-x64']);
    const digest = await u.sha256(archive), data = await fs.readFile(archive);
    assert.equal(u.expectedHash(digest + '  ' + release.name + '\n', release.name), digest);
    assert.throws(() => u.expectedHash(digest + '  ' + release.name + '\n' + digest + '  ' + release.name, release.name), /唯一/);
    const fakeRequest = (hash = digest) => ({ get: async (url, options) => {
      assert.ok(url.startsWith('https://github.com/yxt02/hongguo-drama-linux/releases/download/v1.74.1-linux/'));
      return url.endsWith('SHA256SUMS.txt') ? { data: hash + '  ' + release.name } : { data: Readable.from([data]), headers: { 'content-length': String(data.length) } };
    } });
    const downloadDir = await fs.mkdtemp(path.join(temp, 'download-'));
    assert.equal(await u.sha256(await u.download(release, downloadDir, { request: fakeRequest() })), digest);
    const badDir = await fs.mkdtemp(path.join(temp, 'bad-'));
    await assert.rejects(u.download(release, badDir, { request: fakeRequest('0'.repeat(64)) }), /SHA256/);
    await assert.rejects(u.download({ ...release, tag: 'v1.74.2-linux' }, badDir), /发行信息/);
    assert.equal(u.validateBundle(target), '1.74.0', 'checksum failure cannot change installed app');
    const unpackDir = await fs.mkdtemp(path.join(temp, 'unpack-'));
    assert.equal(u.validateBundle(await u.unpack(archive, unpackDir, '1.74.1')), '1.74.1');
    await assert.rejects(u.unpack(archive, unpackDir, '1.74.1', { execute: async () => ({ stdout: '../escape\n' }) }), /路径/);
    let calls = 0;
    await assert.rejects(u.unpack(archive, unpackDir, '1.74.1', { execute: async () => ({ stdout: ++calls === 1 ? 'hongguo-linux-x64/evil\n' : 'lrwxrwxrwx 0/0 0 2026-01-01 hongguo-linux-x64/evil -> /etc/passwd\n' }) }), /符号链接/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(u.download(release, await fs.mkdtemp(path.join(temp, 'cancel-')), { request: fakeRequest(), signal: controller.signal }));
    await assert.rejects(u.waitForExit(process.pid), /无效/);
    await fs.writeFile(path.join(temp, 'settings.json'), 'keep me');
    let renames = 0;
    await assert.rejects(u.install(incoming, target, '1.74.1', { rename: async (...args) => { if (++renames === 2) throw new Error('simulated rename failure'); return fs.rename(...args); } }), /simulated/);
    assert.equal(u.validateBundle(target), '1.74.0', 'replacement failure restores old install');
    await fs.mkdir(target + '.update-lock'); await assert.rejects(u.install(incoming, target, '1.74.1'), /EEXIST/); await fs.rmdir(target + '.update-lock');
    const result = await u.install(incoming, target, '1.74.1');
    assert.equal(u.validateBundle(target), '1.74.1'); assert.equal(u.validateBundle(result.backup), '1.74.0');
    assert.equal(await fs.readFile(path.join(temp, 'settings.json'), 'utf8'), 'keep me');
    console.log('PASS Linux update: fork/tag selection, complete assets, ASAR version, checksum, cancellation, tar paths/types, process guard, lock, rollback, backup, preserved data');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
