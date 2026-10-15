// Shared ffmpeg/ffprobe resolver for check scripts.
// Honours FFMPEG / FFPROBE overrides, then the platform build directory
// (build/ffmpeg/<platform>-<arch>), then the unscoped build/ffmpeg directory,
// then PATH. This replaces the darwin-arm64-only defaults that assumed the
// checks were always run on an Apple Silicon Mac.
const fs = require('node:fs');
const path = require('node:path');

function resolveFfmpegBinary(name) {
  const override = process.env[name.toUpperCase()];
  if (override) return override;

  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [
    path.resolve(__dirname, '..', 'build', 'ffmpeg', `${process.platform}-${process.arch}`, executable),
    path.resolve(__dirname, '..', 'build', 'ffmpeg', executable),
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, executable)),
  ];

  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* try the next candidate */ }
  }
  return path.resolve(__dirname, '..', 'build', 'ffmpeg', `${process.platform}-${process.arch}`, executable);
}

module.exports = { resolveFfmpegBinary };
