#!/usr/bin/env node
// Linux launcher: picks a working Chromium sandbox mode and starts the app.
//
// Electron on Linux can use either the SUID chrome-sandbox helper or the
// unprivileged user-namespace sandbox. Ubuntu 23.10+ ships
// kernel.apparmor_restrict_unprivileged_userns=1, which blocks the namespace
// sandbox for binaries without a matching AppArmor profile; an un-chowned
// chrome-sandbox then makes Chromium refuse to start. This launcher detects
// that combination and falls back to --no-sandbox with a clear notice instead
// of aborting with a fatal error.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { canSandbox, sandboxArgv, sandboxHelp } = require('./chromium-sandbox.cjs');

const root = path.resolve(__dirname, '..');

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

function resolveElectron() {
  const override = process.env.ELECTRON_PATH;
  if (override && fs.existsSync(override)) return override;

  const packaged = firstExisting([
    // electron-builder --dir output
    path.join(root, 'dist', 'linux-unpacked', 'hongguo-downloader'),
    path.join(root, 'dist', 'linux-unpacked', '红果短剧'),
    // AppImage mount point when already extracted
    path.join(root, 'dist', 'linux-unpacked', 'electron'),
  ]);
  if (packaged) return packaged;

  return path.join(root, 'node_modules', 'electron', 'dist', 'electron');
}

function main() {
  const electronPath = resolveElectron();
  if (!fs.existsSync(electronPath)) {
    console.error('未找到可执行文件：' + electronPath);
    console.error('先执行 `npm install`，或用 `npm run build:linux:dir` 生成 linux-unpacked。');
    process.exit(1);
  }

  const args = sandboxArgv(electronPath, process.argv.slice(2));
  if (!canSandbox(electronPath)) console.log(sandboxHelp);

  const child = spawn(electronPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

main();
