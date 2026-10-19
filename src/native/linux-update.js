// Linux portable-bundle updater. User data lives outside the replaced application directory.
// Electron's patched fs treats *.asar as virtual directories. Updating must copy
// and read the archive itself, including when using ELECTRON_RUN_AS_NODE.
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const exec = promisify(execFile);
const { FORK, availableRelease, releasesApi } = require('./app-update');
const MAX_ARCHIVE = 600 * 1024 * 1024, MAX_UNPACKED = 2 * 1024 * 1024 * 1024;
const ROOT = 'hongguo-linux-x64';
function readVersion(bundle) {
  const file = path.join(bundle, 'app/resources/app.asar');
  const fd = fs.openSync(file, 'r');
  try {
    const size = Buffer.alloc(8); if (fs.readSync(fd, size, 0, 8, 0) !== 8) throw new Error('应用归档无效');
    const length = size.readUInt32LE(4); if (length < 8 || length > 16 * 1024 * 1024) throw new Error('应用归档头无效');
    const header = Buffer.alloc(length); if (fs.readSync(fd, header, 0, length, 8) !== length) throw new Error('应用归档不完整');
    const jsonLength = header.readUInt32LE(4); if (jsonLength > length - 8) throw new Error('应用归档头不完整');
    const record = JSON.parse(header.subarray(8, 8 + jsonLength).toString()).files?.['package.json'];
    const offset = Number(record?.offset), count = Number(record?.size);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(count) || count < 1 || count > 65536 || record.unpacked) throw new Error('缺少应用版本信息');
    const contents = Buffer.alloc(count); if (fs.readSync(fd, contents, 0, count, 8 + length + offset) !== count) throw new Error('应用版本信息不完整');
    const pkg = JSON.parse(contents.toString());
    if (pkg.name !== 'hongguo-downloader' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('不是红果短剧应用');
    return pkg.version;
  } finally { fs.closeSync(fd); }
}
function validateBundle(bundle, version) {
  if (!fs.lstatSync(bundle).isDirectory() || fs.lstatSync(bundle).isSymbolicLink()) throw new Error('应用目录无效');
  for (const name of ['app/hongguo-downloader', '红果短剧.sh', 'app/resources/bin/ffmpeg', 'app/resources/bin/ffprobe']) {
    const file = path.join(bundle, name), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !(stat.mode & 0o111)) throw new Error('缺少可执行组件：' + name);
  }
  const actual = readVersion(bundle); if (version && actual !== version) throw new Error('安装包版本与发行版本不一致');
  return actual;
}
function detectBundle(execPath = process.execPath) {
  try {
    const root = path.dirname(path.dirname(fs.realpathSync(execPath)));
    validateBundle(root); fs.accessSync(path.dirname(root), fs.constants.W_OK);
    return root;
  } catch (_) { return null; }
}
async function sha256(file) { const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
function expectedHash(text, name) {
  const rows = String(text).split(/\r?\n/).filter(Boolean).map(line => /^([a-fA-F0-9]{64})[ \t]+\*?([^\r\n]+)$/.exec(line));
  if (rows.some(row => !row)) throw new Error('校验文件格式无效');
  const matches = rows.filter(row => row[2] === name);
  if (matches.length !== 1) throw new Error('校验文件缺少唯一的 Linux 安装包记录');
  return matches[0][1].toLowerCase();
}
function requestOptions(signal) {
  return { signal, timeout: 30000, maxRedirects: 5, headers: { 'User-Agent': 'Hongguo-Linux-Updater', Accept: 'application/vnd.github+json' },
    beforeRedirect(options) {
      const host = String(options.hostname || '').toLowerCase();
      if (options.protocol !== 'https:' || !(host === 'github.com' || host === 'api.github.com' || host.endsWith('.githubusercontent.com'))) throw new Error('更新下载重定向到未知地址');
    } };
}
async function latest(current, { request = require('axios'), signal } = {}) {
  const response = await request.get(releasesApi('linux'), { ...requestOptions(signal), maxRedirects: 0, maxContentLength: 1024 * 1024 });
  const release = availableRelease(response.data, current, { platform: 'linux' });
  if (!release) return null;
  const name = 'hongguo-drama-' + release.version + '-linux-x64.tar.gz';
  const names = new Set((response.data.assets || []).filter(a => a.state === 'uploaded').map(a => a.name));
  if (!names.has(name) || !names.has('SHA256SUMS.txt')) throw new Error('新版尚未提供完整 Linux 安装包与校验文件');
  return { ...release, name };
}
async function download(release, workdir, { request = require('axios'), signal, progress = () => {} } = {}) {
  if (release.tag !== 'v' + release.version + '-linux' || !/^v\d+\.\d+\.\d+-linux$/.test(release.tag) || release.name !== 'hongguo-drama-' + release.version + '-linux-x64.tar.gz') throw new Error('发行信息无效');
  const base = 'https://github.com/' + FORK + '/releases/download/' + release.tag + '/';
  const sums = await request.get(base + 'SHA256SUMS.txt', { ...requestOptions(signal), responseType: 'text', maxContentLength: 65536 });
  const expected = expectedHash(sums.data, release.name);
  const archive = path.join(workdir, release.name);
  const response = await request.get(base + release.name, { ...requestOptions(signal), responseType: 'stream' });
  const total = Number(response.headers['content-length']) || 0;
  let received = 0, lastProgress = 0;
  if (total > MAX_ARCHIVE) { response.data.destroy(); throw new Error('更新安装包超过大小限制'); }
  response.data.on('data', chunk => {
    received += chunk.length;
    if (received > MAX_ARCHIVE) { response.data.destroy(new Error('更新安装包超过大小限制')); return; }
    if (Date.now() - lastProgress > 150) { progress({ phase: 'downloading', received, total, percent: total ? Math.floor(received / total * 100) : 0 }); lastProgress = Date.now(); }
  });
  try { await pipeline(response.data, fs.createWriteStream(archive, { flags: 'wx', mode: 0o600 }), { signal }); }
  finally { response.data.destroy(); }
  if (!received || total && received !== total) throw new Error('安装包下载不完整');
  progress({ phase: 'verifying', percent: 100 });
  if (await sha256(archive) !== expected) throw new Error('安装包 SHA256 校验失败，未替换旧版');
  return archive;
}
async function unpack(archive, workdir, version, { signal, execute = exec } = {}) {
  const options = { timeout: 120000, maxBuffer: 8 * 1024 * 1024, signal };
  const listed = await execute('tar', ['-tzf', archive, '--quoting-style=escape'], options);
  const names = listed.stdout.trim().split('\n');
  if (!names.length || names.length > 20000 || names.some(name => /[\\\x00-\x1f\x7f]/.test(name) || name.startsWith('/') || name.split('/').includes('..') || !(name === ROOT || name.startsWith(ROOT + '/')))) throw new Error('安装包包含不安全的文件路径');
  const detailed = await execute('tar', ['-tvzf', archive, '--numeric-owner', '--quoting-style=escape'], options);
  let bytes = 0;
  for (const line of detailed.stdout.trim().split('\n')) {
    const row = /^([d-])[rwxStTs-]{9}\s+\d+\/\d+\s+(\d+)\s/.exec(line);
    if (!row) throw new Error('安装包不允许符号链接或特殊文件');
    bytes += Number(row[2]); if (!Number.isSafeInteger(bytes) || bytes > MAX_UNPACKED) throw new Error('解压后的更新超过大小限制');
  }
  const stage = path.join(workdir, 'unpack'); await fsp.mkdir(stage, { mode: 0o700 });
  await execute('tar', ['-xzf', archive, '-C', stage, '--no-same-owner', '--no-same-permissions', '--delay-directory-restore'], options);
  const root = path.join(stage, ROOT); validateBundle(root, version); return root;
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }
async function waitForExit(pid, timeout = 120000) {
  if (!Number.isInteger(pid) || pid < 1 || pid === process.pid) throw new Error('等待退出的进程无效');
  const deadline = Date.now() + timeout;
  while (alive(pid)) { if (Date.now() > deadline) throw new Error('旧版仍在运行，请退出后重新更新'); await new Promise(r => setTimeout(r, 250)); }
}
async function runningProcesses(target) {
  const executable = path.join(path.resolve(target), 'app/hongguo-downloader');
  const processes = [];
  for (const pid of (await fsp.readdir('/proc')).filter(p => /^\d+$/.test(p) && Number(p) !== process.pid)) {
    const link = await fsp.readlink('/proc/' + pid + '/exe').catch(() => '');
    if (link !== executable) continue;
    const argv = (await fsp.readFile('/proc/' + pid + '/cmdline').catch(() => Buffer.alloc(0))).toString().split('\0');
    processes.push({ pid: Number(pid), helper: argv.some(arg => arg.startsWith('--type=')) });
  }
  return processes;
}
async function waitForTargetExit(target, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while ((await runningProcesses(target)).length) {
    if (Date.now() > deadline) throw new Error('旧版后台进程仍未退出，请从托盘菜单退出程序后再更新');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
async function closeRunning(target) {
  // Only the selected installation's main processes; never kill by a broad name.
  for (const { pid, helper } of await runningProcesses(target)) if (!helper) {
    if (await fsp.readlink('/proc/' + pid + '/exe').catch(() => '') !== path.join(path.resolve(target), 'app/hongguo-downloader')) continue;
    try { process.kill(pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await waitForTargetExit(target);
}
async function install(root, target, version, { rename = fsp.rename } = {}) {
  target = path.resolve(target); validateBundle(target); validateBundle(root, version);
  if (target === path.parse(target).root || path.resolve(root).startsWith(target + path.sep)) throw new Error('不能从安装目录内部替换自身');
  const parent = path.dirname(target), lock = target + '.update-lock', backup = target + '.previous';
  // Copy to the destination filesystem before any rename; /tmp may be a different mount.
  const staging = await fsp.mkdtemp(path.join(parent, '.hongguo-update-'));
  let locked = false;
  try {
    await fsp.mkdir(lock, { mode: 0o700 }); locked = true;
    await fsp.cp(root, path.join(staging, 'next'), { recursive: true }); validateBundle(path.join(staging, 'next'), version);
    if (fs.existsSync(backup)) { validateBundle(backup); await fsp.rm(backup, { recursive: true }); }
    await rename(target, backup);
    try { await rename(path.join(staging, 'next'), target); }
    catch (error) { await rename(backup, target); throw error; }
    return { version, target, backup };
  } finally { await fsp.rm(staging, { recursive: true, force: true }); if (locked) await fsp.rmdir(lock); }
}
function restart(target) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn('/bin/sh', [path.join(target, '红果短剧.sh')], { detached: true, stdio: 'ignore', env }); child.unref();
}
async function runJob(job) {
  let result;
  try {
    await waitForExit(job.pid); await waitForTargetExit(job.target);
    result = { success: true, ...await install(job.root, job.target, job.version) };
  } catch (error) { result = { success: false, error: error.message }; }
  if (job.resultFile) await fsp.writeFile(job.resultFile, JSON.stringify(result), { mode: 0o600 }).catch(error => console.error('无法保存更新结果：' + error.message));
  if (job.restart && fs.existsSync(path.join(job.target, '红果短剧.sh'))) restart(job.target);
  if (!result.success) throw new Error(result.error);
  await fsp.rm(job.workdir, { recursive: true, force: true }); return result;
}
async function runCli(args = process.argv.slice(2)) {
  const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
  if (option('--job')) return runJob(JSON.parse(await fsp.readFile(option('--job'), 'utf8')));
  const target = option('--target'); if (!target) throw new Error('请指定 --target 安装目录');
  const current = validateBundle(target);
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hongguo-update-'));
  try {
    let version, archive, root;
    if (option('--bundle')) {
      root = path.resolve(option('--bundle')); version = validateBundle(root);
      if (version === current) { console.log('当前已是此安装包版本：' + current); return; }
      if (!availableRelease({ tag_name: 'v' + version + '-linux' }, current, { platform: 'linux' })) throw new Error('安装包版本较旧，不进行降级');
    } else if (option('--archive')) {
      archive = path.resolve(option('--archive')); version = option('--version');
      if (!version || !option('--checksum')) throw new Error('本地更新需要版本号与校验文件');
      if (await sha256(archive) !== expectedHash(await fsp.readFile(option('--checksum'), 'utf8'), path.basename(archive))) throw new Error('本地安装包 SHA256 校验失败');
    } else {
      console.log('正在检查 yxt02/hongguo-drama-linux ...'); const release = await latest(current);
      if (!release) { console.log('当前已是最新版本：' + current); return; }
      version = release.version; archive = await download(release, workdir, { progress: p => { if (p.percent % 10 === 0) console.log('下载更新 ' + p.percent + '%'); } });
    }
    console.log('正在校验并准备 ' + version + ' ...');
    if (!root) root = await unpack(archive, workdir, version);
    if (args.includes('--close-running')) { console.log('正在关闭旧版及后台进程 ...'); await closeRunning(target); }
    else if (option('--wait-pid')) { await waitForExit(Number(option('--wait-pid'))); await waitForTargetExit(target); }
    else if ((await runningProcesses(target)).length) throw new Error('请先从托盘或设置中退出程序，或使用 --close-running 关闭旧版后更新');
    const result = await install(root, target, version); console.log('更新完成：' + result.version + '\n旧版备份：' + result.backup);
    if (args.includes('--restart')) restart(target); return result;
  } finally { await fsp.rm(workdir, { recursive: true, force: true }); }
}
module.exports = { readVersion, validateBundle, detectBundle, expectedHash, sha256, latest, download, unpack, install, waitForExit, runningProcesses, closeRunning, waitForTargetExit, runJob, runCli, requestOptions };
