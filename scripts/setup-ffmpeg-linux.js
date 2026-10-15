// Fetch or validate the pinned static FFmpeg used for the Linux build.
// See build/ffmpeg/LINUX-NOTICE.txt for provenance and redistribution notes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', 'build', 'ffmpeg');
const dest = path.join(root, 'linux-x64');
const names = ['ffmpeg', 'ffprobe'];

// Pinned static build: BtbN FFmpeg-Builds n8.1 linux64 gpl (release line).
// Ships libx264/libx265 and passes the AES-128 HLS remux the app depends on.
// Note: the earlier johnvansickle 7.0.2 static build segfaults on that remux,
// so it is deliberately not used here.
// The archive URL is a moving alias; the recorded digest is the authority.
const artifact = {
  url: process.env.FFMPEG_LINUX_URL ||
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz',
  sha256: process.env.FFMPEG_LINUX_SHA256 ||
    '80742938a95f9ecf9e0635192b417b7af61ddd53c4ab511898a11da5dad81667',
  prefix: 'ffmpeg-n8.1-latest-linux64-gpl-8.1',
  binDir: 'bin',
};

const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(dest, 'build-manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

function binariesValid(manifest) {
  return Boolean(
    manifest &&
    manifest.artifact_sha256 === artifact.sha256 &&
    names.every((name) => {
      const file = path.join(dest, name);
      return fs.existsSync(file) && sha256(file) === manifest.binaries?.[name];
    })
  );
}

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('重定向过多'));
    const https = require('node:https');
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function verifyBinary(file) {
  // ELF x86-64, and only system dynamic dependencies (or none at all when the
  // build is fully static) — the Linux counterpart of the lipo/otool checks in
  // setup-ffmpeg-mac.js.
  const head = fs.readFileSync(file).subarray(0, 20);
  assert.equal(head.subarray(0, 4).toString('hex'), '7f454c46', path.basename(file) + ' 不是 ELF');
  assert.equal(head.readUInt16LE(18), 0x3e, path.basename(file) + ' 不是 x86-64');

  let listing;
  try {
    listing = execFileSync('/usr/bin/ldd', [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // ldd exits non-zero for static binaries and reports that on stderr;
    // merge both streams so the "not a dynamic executable" marker is seen.
    listing = String(error.stdout || '') + '\n' + String(error.stderr || '');
  }
  if (/not a dynamic executable|statically linked/i.test(listing)) return;

  const deps = listing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('=>') || line.startsWith('/lib'))
    .map((line) => (line.split('=>')[1] || line.split(' ')[0]).trim().split(' ')[0])
    .filter(Boolean);

  assert.ok(deps.length > 0, path.basename(file) + ' 既非静态也无可见动态依赖');
  for (const dep of deps) {
    assert.ok(
      dep.startsWith('/lib/') || dep.startsWith('/lib64/'),
      path.basename(file) + ' 含非系统动态库: ' + dep
    );
  }
}

async function main() {
  assert.equal(process.platform, 'linux', '需要 Linux');
  assert.equal(process.arch, 'x64', '当前仅提供 linux-x64 工具');

  let manifest = loadManifest();
  if (!binariesValid(manifest)) {
    console.log('准备 Linux FFmpeg：下载固定校验和的静态构建…');
    // FFMPEG_LINUX_ARCHIVE lets an already-fetched tarball be reused, which
    // avoids re-downloading the large archive during offline or repeated builds.
    const localArchive = process.env.FFMPEG_LINUX_ARCHIVE;
    const archive = localArchive ? fs.readFileSync(localArchive) : await download(artifact.url);
    assert.equal(
      createHash('sha256').update(archive).digest('hex'),
      artifact.sha256,
      '下载内容与固定 SHA256 不符'
    );

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-ffmpeg-linux-'));
    try {
      const tarball = path.join(staging, 'ffmpeg.tar.xz');
      fs.writeFileSync(tarball, archive);
      execFileSync('/bin/tar', ['-xf', tarball, '-C', staging], { stdio: 'inherit' });
      fs.mkdirSync(dest, { recursive: true });
      for (const name of names) {
        const source = path.join(staging, artifact.prefix, artifact.binDir || '', name);
        fs.copyFileSync(source, path.join(dest, name));
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }

    manifest = {
      source: artifact.url,
      artifact_sha256: artifact.sha256,
      binaries: Object.fromEntries(names.map((name) => [name, sha256(path.join(dest, name))])),
    };
    fs.writeFileSync(
      path.join(dest, 'build-manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    );
  }

  for (const name of names) {
    const binary = path.join(dest, name);
    fs.chmodSync(binary, 0o755);
    verifyBinary(binary);
    console.log(name + ': SHA256、ELF x86-64 与系统库依赖校验通过');
  }
}

main().catch((error) => {
  console.error('Linux FFmpeg 准备失败：' + error.message);
  process.exitCode = 1;
});
