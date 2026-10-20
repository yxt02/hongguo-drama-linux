# Linux 开发与验证

目标平台为 Linux x86_64，开发环境需要 Node.js 22.12 或更新版本、npm、Python 3.11 或更新版本，以及 tar / curl。发行包本身包含运行时和 FFmpeg，使用者不需要安装这些开发依赖。

## 准备依赖

```sh
git clone https://github.com/yxt02/hongguo-drama-linux.git
cd hongguo-drama-linux
npm ci --no-audit --no-fund
node node_modules/electron/install.js
```

显式安装 Electron 可兼容不会自动执行依赖安装脚本的 npm 配置。

## 固定媒体工具

上游 FFmpeg 的 `latest` 归档会变化。为保持已验证的媒体工具不变，可从本项目固定的 1.74.6 包恢复 FFmpeg / FFprobe：

```sh
curl -fL --retry 3 -o /tmp/hongguo-base.tar.gz \
  https://github.com/yxt02/hongguo-drama-linux/releases/download/v1.74.6-linux/hongguo-drama-1.74.6-linux-x64.tar.gz
python3 scripts/restore-linux-media.py /tmp/hongguo-base.tar.gz
node scripts/setup-ffmpeg-linux.js
```

恢复脚本核对整个归档和两个二进制的固定 SHA256，不运行旧应用。具体来源、许可证和校验值见 [LINUX-NOTICE.txt](../build/ffmpeg/LINUX-NOTICE.txt)。

## 构建与运行

```sh
HONGGUO_ELECTRON_DIST="$PWD/node_modules/electron/dist" npm run package:linux
./dist/hongguo-linux-x64/红果短剧.sh
```

输出：

- `dist/hongguo-linux-x64/`：完整可运行目录，含启动器、安装器和更新器。
- `dist/hongguo-drama-<version>-linux-x64.tar.gz`：分发归档。

调试前端可用 `npm run dev`；仅编译前端使用 `npm run build:react`。

## 回归检查

普通回归入口为 `npm run test:playback`。需要真实媒体的检查依赖本地视频样本；下面的方式可运行完整媒体检查：

```sh
fixture=$(mktemp --suffix=.mp4)
build/ffmpeg/linux-x64/ffmpeg -v error -f lavfi \
  -i testsrc2=size=360x640:rate=24 -t 3 -c:v libx264 \
  -preset ultrafast -pix_fmt yuv420p -y "$fixture"
HONGGUO_VIDEO_FIXTURE="$fixture" \
HONGGUO_FFMPEG="$PWD/build/ffmpeg/linux-x64/ffmpeg" \
HONGGUO_FFPROBE="$PWD/build/ffmpeg/linux-x64/ffprobe" \
  npm run test:playback
rm "$fixture"
```

打包完成后，运行完整包更新检查：

```sh
node scripts/check-linux-update-bundle.cjs
```

该检查使用临时安装目录，覆盖完整归档、程序版本验证、旧版备份、原位替换和观看记录保留。容器的 `/proc` 与进程 PID 命名空间不一致时，进程退出检查会明确跳过；标准 Linux 环境会实际执行。

## 发布

更新 `package.json` 与锁文件的版本号，添加 `docs/release-<version>-linux.md`，推送到 `main`。

Linux 工作流执行完整回归、打包和更新包检查，通过后才发布正式版及 `SHA256SUMS.txt`。已经发布的版本不会重复覆盖。
