const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

function intelRenderDevices(dri = '/dev/dri', sys = '/sys/class/drm') {
  const entries = dir => {
    try { return fs.readdirSync(dir).sort(); } catch (_) { return []; }
  };
  const byPath = path.join(dri, 'by-path');
  const candidates = [
    ...entries(byPath).filter(name => name.endsWith('-render')).map(name => path.join(byPath, name)),
    ...entries(dri).filter(name => /^renderD\d+$/.test(name)).map(name => path.join(dri, name)),
  ];
  const devices = new Map();
  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync(candidate);
      if (devices.has(resolved) || !/^renderD\d+$/.test(path.basename(resolved))) continue;
      fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
      if (fs.readFileSync(path.join(sys, path.basename(resolved), 'device/vendor'), 'utf8').trim() === '0x8086') {
        devices.set(resolved, candidate);
      }
    } catch (_) {}
  }
  return [...devices.values()];
}

const probeResults = new Map();
async function pickPlaybackVaapi(ffmpeg, job) {
  for (const device of intelRenderDevices()) {
    if (job.controller.signal.aborted) return null;
    const key = ffmpeg + '\0' + device;
    let works = probeResults.get(key);
    if (works === undefined) {
      works = await new Promise(resolve => {
        const child = execFile(ffmpeg, ['-hide_banner', '-v', 'error', '-vaapi_device', device,
          '-f', 'lavfi', '-i', 'color=s=128x128', '-vf', 'format=nv12,hwupload',
          '-frames:v', '1', '-c:v', 'h264_vaapi', '-f', 'null', '-'],
        { timeout: 5000 }, error => {
          if (job.child === child) delete job.child;
          resolve(!error);
        });
        job.child = child;
      });
      if (job.controller.signal.aborted) return null;
      probeResults.set(key, works);
    }
    if (works) return device;
  }
  return null;
}

module.exports = { intelRenderDevices, pickPlaybackVaapi };
