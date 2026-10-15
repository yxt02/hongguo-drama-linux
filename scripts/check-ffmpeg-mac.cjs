const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin') {
  console.log('SKIP check-ffmpeg-mac: 需要 macOS（lipo/otool 与 darwin 构建）');
  process.exit(0);
}
const arch = process.argv[2] || process.arch;
assert(['arm64', 'x64'].includes(arch), 'Expected arm64 or x64');
const binary = name => path.resolve(__dirname, `../build/ffmpeg/darwin-${arch}`, name);
const run = (name, args) => execFileSync(binary(name), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-ffmpeg-check-'));
try {
  for (const name of ['ffmpeg', 'ffprobe']) {
    execFileSync('/usr/bin/lipo', [binary(name), '-verify_arch', arch === 'x64' ? 'x86_64' : 'arm64']);
    const dependencies = execFileSync('/usr/bin/otool', ['-L', binary(name)], { encoding: 'utf8' }).trim().split('\n').slice(1);
    assert(dependencies.length && dependencies.every(line => /^\s+\/(usr\/lib|System\/Library)\//.test(line)), 'Non-system dynamic dependency');
    assert.match(run(name, ['-version']), /version 9\.0\.2/);
  }
  const video = path.join(temp, 'fixture.mp4');
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=10:duration=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', video]));
  assert(probe.streams.some(s => s.codec_name === 'h264' && s.width === 96 && s.height === 64));
  assert(probe.streams.some(s => s.codec_name === 'aac'));
  run('ffmpeg', ['-v', 'error', '-i', video, '-f', 'null', '-']);
  console.log(JSON.stringify({ passed: true, architecture: arch, execution: arch === 'x64' && process.arch === 'arm64' ? 'Rosetta on Apple Silicon; not physical Intel hardware' : 'native', checks: ['Mach-O architecture', 'system-only dynamic dependencies', 'FFmpeg and ffprobe version', 'libx264 H.264 and AAC encode', 'MP4 stream probe', 'video and audio decode'], physical_intel_verified: false }, null, 2));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
