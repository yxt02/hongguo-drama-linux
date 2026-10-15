#!/usr/bin/env node
// Assemble a self-contained Linux bundle: app/ + launcher + installer + docs.
//
// Produces dist/hongguo-linux-x64/ and dist/hongguo-drama-<version>-linux-x64.tar.gz
// so a user only needs to extract and run 红果短剧.sh — or run install.sh to
// add it to the desktop menu. No Node.js, no system ffmpeg, no flags required.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const stageName = 'hongguo-linux-x64';
const stage = path.join(root, 'dist', stageName);
const unpacked = path.join(root, 'dist', 'linux-unpacked');
const launcher = path.join(root, 'scripts', 'linux-launcher.sh');
const installer = path.join(root, 'scripts', 'install-linux.sh');

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' });
}

function step(label) {
  console.log('\n==> ' + label);
}

function writeUsage(target) {
  fs.writeFileSync(
    path.join(target, '使用说明.md'),
    `# 红果短剧 · Linux 版（v${pkg.version}）

## 三步开始用

1. 解压本压缩包（或双击解压）
2. 运行 **红果短剧.sh**
   \`\`\`sh
   ./红果短剧.sh
   \`\`\`
3. 在「设置」里选好下载目录，就可以开始看了

## 装进应用菜单（可选）

\`\`\`sh
./install.sh          # 安装：菜单里出现「红果短剧」，终端可敲 hongguo
./install.sh --uninstall   # 卸载
\`\`\`

不需要 root / sudo，全部装在家目录（\`~/.local\`）。

## 目录说明

| 路径 | 作用 |
|---|---|
| \`红果短剧.sh\` | **入口**，双击或在终端运行这个 |
| \`install.sh\` | 一键装进应用菜单 |
| \`app/\` | 程序本体（含内置 FFmpeg，不要单独移动） |

## 常见问题

**为什么不能直接跑 \`app/hongguo-downloader\`？**
Chromium 在自己初始化时就决定沙箱模式，早于应用代码。Ubuntu 23.10+ 的
AppArmor 会阻止用户命名空间沙箱，未提权的 \`chrome-sandbox\` 又会让 Chromium
直接中止。启动器检测到该组合时会自动补上 \`--no-sandbox\`，其余情况不加、
保持默认沙箱。直接跑裸二进制会缺这一步。

**想强制关掉沙箱**
\`\`\`sh
HONGGUO_NO_SANDBOX=1 ./红果短剧.sh
\`\`\`

**合并 / 转码不可用？**
内置 FFmpeg 在 \`app/resources/bin/\`，启动器会通过应用自身解析到它。
若你替换了 \`app/\` 里的 FFmpeg，请保证 \`ffmpeg\` 与 \`ffprobe\` 可执行。

## 许可

本软件为 GPL-3.0。内置 FFmpeg 的来源与许可见
\`app/resources/bin/LINUX-NOTICE.txt\` 与同目录 COPYING.*。
按 GPL 再分发本包时，请一并提供对应源码。
`,
  );
}

function main() {
  if (process.platform !== 'linux') throw new Error('package-linux 需要在 Linux 上运行');

  step('校验 / 准备内置 FFmpeg');
  run('node', [path.join('scripts', 'setup-ffmpeg-linux.js')]);

  step('生成前端');
  run('npm', ['run', 'build:react']);

  step('打包 Electron 应用');
  run('npx', ['electron-builder', '--linux', '--x64', '--publish', 'never', '--dir']);

  if (!fs.existsSync(path.join(unpacked, 'hongguo-downloader'))) {
    throw new Error('未生成 dist/linux-unpacked/hongguo-downloader');
  }

  step('组装可分发目录');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.cpSync(unpacked, path.join(stage, 'app'), { recursive: true });
  fs.copyFileSync(launcher, path.join(stage, '红果短剧.sh'));
  fs.copyFileSync(installer, path.join(stage, 'install.sh'));
  // Desktop entries need an on-disk icon; the app's own icon is inside the
  // asar, so ship the source PNG next to the launcher for install.sh to use.
  fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(stage, 'icon.png'));
  fs.chmodSync(path.join(stage, '红果短剧.sh'), 0o755);
  fs.chmodSync(path.join(stage, 'install.sh'), 0o755);
  writeUsage(stage);

  // The launcher and installer live next to app/, not inside it, so keep the
  // asar payload untouched. Strip the stale chrome-sandbox SUID expectation by
  // leaving the file as shipped; the launcher decides when to work around it.

  step('生成 tar.gz');
  // ASCII asset name: GitHub release upload mangles non-ASCII filenames, and
  // an ASCII name is safer for shell quoting and download links.
  const tarball = path.join(root, 'dist', `hongguo-drama-${pkg.version}-linux-x64.tar.gz`);
  fs.rmSync(tarball, { force: true });
  run('tar', ['-C', path.join(root, 'dist'), '-czf', tarball, stageName]);

  const size = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';
  console.log('\n完成：');
  console.log('  目录   ' + stage);
  console.log('  压缩包 ' + tarball + '  (' + size(fs.statSync(tarball).size) + ')');
  console.log('\n用户只需：解压 → 运行 ./红果短剧.sh');
}

try {
  main();
} catch (error) {
  console.error('打包失败：' + error.message);
  process.exitCode = 1;
}
