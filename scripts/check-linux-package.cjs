// Regression checks for the Linux packaging scripts. No GUI, network or app launch.
//
// Covers the two bugs the first Linux package shipped with and that nothing
// else in the suite exercised:
//   1. the launcher located app/ via `dirname $0`, which breaks when it is
//      reached through the `hongguo` symlink install.sh creates;
//   2. install.sh wrote a desktop Icon pointing into the *source* extract
//      directory, so the icon vanished once that folder was deleted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

if (process.platform !== 'linux') {
  console.log('SKIP check-linux-package: 需要 Linux');
  process.exit(0);
}

// ---- launcher -------------------------------------------------------------
const launcher = read('scripts/linux-launcher.sh');

assert.match(
  launcher,
  /readlink -f "\$0"/,
  '启动器必须解析符号链接，否则通过 ~/.local/bin/hongguo 启动时找不到 app/'
);
assert.match(
  launcher,
  /app\/hongguo-downloader/,
  '启动器必须指向 app/hongguo-downloader'
);
assert.match(
  launcher,
  /--no-sandbox/,
  '启动器需在沙箱不可用时补 --no-sandbox'
);
assert.match(
  launcher,
  /apparmor_restrict_unprivileged_userns/,
  '启动器必须检测 AppArmor 的用户命名空间限制'
);
assert.match(
  launcher,
  /HONGGUO_NO_SANDBOX/,
  '启动器需支持 HONGGUO_NO_SANDBOX 强制关闭沙箱'
);

// The launcher must only add --no-sandbox when needed: if it passed the flag
// unconditionally, hosts with a working sandbox would silently lose it. Check
// the structure rather than the bare line — the flag is expected, but only
// inside the needs_no_sandbox branch, with a plain exec as the other path.
const sandboxBranch = launcher.indexOf('if needs_no_sandbox');
const sandboxExec = launcher.indexOf('exec "$BIN" --no-sandbox "$@"');
const plainExec = launcher.indexOf('exec "$BIN" "$@"');
assert.ok(sandboxBranch >= 0, '启动器需有 needs_no_sandbox 分支');
assert.ok(sandboxExec > sandboxBranch, '--no-sandbox 的 exec 必须在 needs_no_sandbox 分支内');
assert.ok(plainExec > sandboxExec, '启动器必须保留不加 --no-sandbox 的普通 exec 路径');

// ---- install script -------------------------------------------------------
const installer = read('scripts/install-linux.sh');

assert.match(
  installer,
  /\$OPT_DIR\/icon\.png/,
  '桌面图标必须装进安装目录（不能指向解压目录）'
);
assert.match(
  installer,
  /--uninstall/,
  '安装脚本需提供卸载路径'
);
assert.match(
  installer,
  /\$HOME\/\.local/,
  '安装应落在 ~/.local，不需要 root'
);
assert.doesNotMatch(
  installer,
  /sudo /,
  '安装脚本不应要求 sudo'
);

// The desktop file it writes must quote Exec and point at the install dir.
assert.match(installer, /Exec="\$OPT_DIR\/红果短剧\.sh"/, '桌面 Exec 必须指向安装目录的启动器');

// ---- assembled launcher actually resolves through a symlink ---------------
// Regression for bug 1: run the real launcher through a symlink against a
// fake app/ and confirm it finds the binary.
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-pkg-'));
try {
  fs.mkdirSync(path.join(stage, 'app'), { recursive: true });
  const fakeBin = path.join(stage, 'app', 'hongguo-downloader');
  // A stub that echoes its argv so the test can assert what the launcher passed.
  fs.writeFileSync(fakeBin, '#!/bin/sh\necho "ARGS:$@"\n', { mode: 0o755 });

  const launcherCopy = path.join(stage, '红果短剧.sh');
  fs.copyFileSync(path.join(root, 'scripts', 'linux-launcher.sh'), launcherCopy);
  fs.chmodSync(launcherCopy, 0o755);

  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hongguo-bin-'));
  const link = path.join(linkDir, 'hongguo');
  fs.symlinkSync(launcherCopy, link);

  const out = execFileSync(link, ['--version'], { encoding: 'utf8', timeout: 15000 });
  assert.match(out, /ARGS:/, '通过符号链接启动时必须找到 app/hongguo-downloader');

  // Direct invocation must behave the same way.
  const outDirect = execFileSync(launcherCopy, ['--version'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(outDirect, out, '符号链接与直接启动应传给二进制相同的参数');
  fs.rmSync(linkDir, { recursive: true, force: true });
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

// ---- packaging script ships the icon --------------------------------------
const packager = read('scripts/package-linux.js');
assert.match(
  packager,
  /icon\.png/,
  '打包脚本必须把 icon.png 放进发行目录（否则安装后桌面无图标）'
);
assert.match(
  packager,
  /红果短剧\.sh/,
  '打包脚本必须把启动器放进发行目录'
);

console.log('PASS Linux packaging: 启动器符号链接解析、条件沙箱、安装目录图标、免 root 安装与打包完整性');
