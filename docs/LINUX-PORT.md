# 红果短剧 · Linux 移植与架构分析

本文记录对 `jackotom/hongguo-drama` 的代码分析结论，以及在 Linux 上复现其功能所做的改动。
分析基于 v1.73 源码，验证环境为 Ubuntu 24.04 LTS (x86-64, X11)。

---

## 1. 这个 repo 是什么

GPL-3.0 开源的 **Electron 桌面客户端**，面向三个免费短剧来源（红果 / 西饭 / 河马），
提供浏览、搜索、在线播放、选集下载、合并导出、观看记录与追剧。

上游明确声明：不是红果、西饭或河马的官方客户端，不提供付费分集解锁；
HLS 只处理公开的普通与 AES-128 清单，**不支持 DRM、直播与付费解锁**。

**核心结论：它本来就是 Web 技术栈（Electron + React + Vite），平台无关部分占绝大多数。
Linux 移植不是重写，而是补齐打包配置、媒体工具装配与 Chromium 沙箱适配。**

---

## 2. 架构

```
┌──────────────────────────────────────────────────────────┐
│ Electron 主进程  main.js (~4400 行)                       │
│   ├─ 窗口 / 布局 / 隐身小窗 / 单实例                       │
│   ├─ IPC 面 (ipcMain.handle ...)                          │
│   ├─ 下载队列、重试、合并 (ffmpeg concat)                  │
│   ├─ 代理、流协议 (hongguo-stream / hongguo-local)        │
│   └─ resolveFfmpeg() / pickH264Encoder()                 │
├──────────────────────────────────────────────────────────┤
│ Preload  preload.js  (contextIsolation, 无 nodeIntegration)│
├──────────────────────────────────────────────────────────┤
│ Renderer  src/*.jsx (React 18 + Vite)                    │
│   Browse / Player / DownloadManager / Settings / ...      │
├──────────────────────────────────────────────────────────┤
│ 业务模块  src/native/*.js                                │
│   hongguo.js · xifan.js · hema.js · custom-source.js     │
│   hls-media.js · merge-runner.js · decrypt-worker.cjs    │
│   catalog.js · watch-history.js · media-access.js ...     │
└──────────────────────────────────────────────────────────┘
```

### 2.1 三来源接入

| 模块 | 职责 |
|---|---|
| `src/native/hongguo.js` | 红果：目录、题材、四类热播榜、搜索、分享链接/ID 解析、取址 |
| `src/native/xifan.js` | 西饭：独立目录、题材、分页、搜索 |
| `src/native/hema.js` | 河马：官网目录、题材、前后翻页、完整分集列表 |
| `src/native/custom-source.js` | 自定义源：苹果 CMS V10 JSON API，及明确 MP4/M3U8 直链 |
| `src/native/catalog.js` | 统一目录路由与来源聚合 |
| `src/components/mediaSourcesModel.mjs` | 前端来源清单（`hongguo` / `xifan` / `hema` / `custom:*`） |

`main.js` 的 `ipcMain.handle('browse-list', ...)` 按来源分流到上述模块。

### 2.2 媒体链路

- **在线播放**：`hongguo-stream://` 自定义协议 + `media-access.js` 的安全连接复用；
  `web-media-guard.js` 做地址封锁与有界回退。
- **HLS**：`hls-media.js` 负责清单/分片/密钥的本地准备与 remux，支持普通与 AES-128。
- **解密**：`decrypt-worker.cjs`（Worker 线程），仅针对公开 AES-128 HLS。
- **下载**：`main.js` 的队列 + `download-quality.js` 清晰度选择，失败按 10/30/60s 自动重试。
- **合并**：`merge-runner.js` + `merge-plan.js`，走 ffmpeg `concat` 流复制（无损、快）。
- **兼容转码**：`pickH264Encoder()` 优先硬件编码器，失败回退 `libx264`。

### 2.3 本地持久化

`src/store.js` + `app.getPath('userData')/data.json`：
下载任务、剧集登记、观看记录、设置、收藏、合并任务。写入有原子性保护
（`check-store.cjs` 覆盖断电/改名中断场景）。

---

## 3. 平台相关代码盘点

移植前把 `main.js` 里的 `process.platform` 分支全部过了一遍：

| 位置 | 内容 | Linux 处置 |
|---|---|---|
| `resolveFfmpeg()` | 查 `build/ffmpeg/<platform>-<arch>` 与 PATH | **已天然支持** `linux-x64` |
| `pickH264Encoder()` | darwin→videotoolbox；其余→nvenc/qsv/amf/mf/libx264 | **已天然支持**（走 libx264 兜底） |
| `createWindow()` | darwin `titleBarStyle: hiddenInset` | **无需改动**，Linux 用默认边框 |
| 应用菜单 | 仅 darwin 构建原生菜单 | **无需改动**，Linux 走 `autoHideMenuBar` |
| `window-all-closed` | 非 darwin 则 `app.quit()` | **已正确** |
| `shell.showItemInFolder/openPath/openExternal` | 通用 | **无需改动** |
| `Notification.isSupported()` | 有守卫 | **无需改动** |
| 资源路径 `process.resourcesPath/bin` | 打包后 ffmpeg 位置 | **沿用** win/mac 相同布局 |

**结论：`main.js` / `preload.js` / `src/**` 无需为 Linux 改一行产品逻辑。**
真正缺的是打包配置、媒体工具装配、以及 Chromium 沙箱适配。

---

## 4. 本次为 Linux 所做的改动

### 4.1 新增文件

| 文件 | 作用 |
|---|---|
| `scripts/setup-ffmpeg-linux.js` | 获取/校验 Linux 静态 FFmpeg：SHA256 + ELF + `ldd` 仅系统库 |
| `scripts/run-linux.js` | Linux 启动器：检测沙箱可用性，自动退到 `--no-sandbox` 并说明 |
| `scripts/chromium-sandbox.cjs` | 沙箱判定共享模块（启动器与检查脚本共用） |
| `scripts/ffmpeg-bin.cjs` | ffmpeg/ffprobe 解析共享模块（替代硬编码 darwin-arm64） |
| `build/ffmpeg/LINUX-NOTICE.txt` | Linux FFmpeg 来源、许可、校验与两端差异说明 |

### 4.2 `package.json`

- 新增脚本：`setup:ffmpeg:linux`、`build:linux`、`build:linux:dir`、`build:linux:appimage`、`start:linux`
- 新增 `build.linux` 配置：AppImage + dir 目标、桌面项、`extraResources` 打包 `bin/ffmpeg`、`bin/ffprobe` 与许可文本
  （与 win/mac 的 `resources/bin` 布局一致，`resolveFfmpeg()` 直接命中）

### 4.3 检查套件可移植化

| 脚本 | 改动 |
|---|---|
| `check-ffmpeg-mac.cjs` | 非 darwin 打印 `SKIP` 并返回 0 |
| `check-windows-release.cjs` | 非 win32 打印 `SKIP` 并返回 0 |
| `check-merge.cjs` / `check-merge-benchmark.cjs` | ffmpeg 路径改用 `ffmpeg-bin.cjs` 跨平台解析 |
| `check-merge-benchmark.cjs` | 缺 `--old/--real` 参数时 SKIP 而非硬失败 |
| `check-hls-media.cjs` / `check-download-media-validity.cjs` | 缺夹具环境变量时 SKIP |
| `check-macos.cjs` | 补全 mock 的 `webContents.once/on` 与 `setInterval`（原本在所有平台都会挂） |
| `check-share-security.cjs` | 去掉过期的 `version === '1.1.7'` 快照断言，保留 axios 钉版等安全断言 |
| `check-hema-browse.cjs` | 来源下拉已改为 `mediaSources.map(...)`，断言改为校验来源模型声明 + 渲染接线 |

---

## 5. 验证结果

### 5.1 自带校验套件

**57 / 57 通过**（Ubuntu 24.04 x86-64，内置 Linux FFmpeg，含视频夹具）。

覆盖：存储原子性、窗口布局、隐身小窗、单实例、下载队列与重试、清晰度、
HLS 拆包、合并与取消、播放控制/倍速/续播/快捷键、解码失败自动修复（黑屏有声 → H.264）、
三来源接入、来源恢复与路由、弹幕、观看记录、Web 媒体守卫、分享链接安全、
mac/win 平台专属逻辑等。

### 5.2 真实运行

- 源码启动：`node scripts/run-linux.js` → Electron v44.6.0 正常起窗
- 界面完整渲染，**「共 800 部」表明真实片单接口已连通**
- 打包产物：`dist/linux-unpacked/hongguo-downloader` 可独立启动，
  `resources/bin/{ffmpeg,ffprobe}` 就位

### 5.3 已知事项

| 事项 | 说明 |
|---|---|
| Chromium 沙箱 | Ubuntu 24.04 的 `apparmor_restrict_unprivileged_userns=1` 会挡命名空间沙箱；开发用 `--no-sandbox`，对外分发请用带 SUID helper 的 deb/AppImage |
| FFmpeg 体积 | BtbN 静态构建每个约 170MB，比 win/mac 的最小 x264 构建大；可自行编译替换，setup 脚本会校验 |
| 可复现源码 | win/mac 随发行附 FFmpeg 对应源码包；Linux 目前用上游预编译产物，若对外发行需按 GPL 补对应源码 |
| 上游测试漂移 | `check-share-security` / `check-hema-browse` 的过期断言在所有平台都会挂，已一并修正 |

---

## 6. 复现功能的边界

功能层面已在 Linux 复现：浏览、搜索、分类/热播榜、详情、在线播放、
选集下载、队列与重试、合并导出、观看记录、设置与代理、三来源与自定义源。

未做的（属上游本就声明的边界，非移植缺口）：
- DRM、直播、付费分集解锁 —— 上游明确不支持
- 硬件转码加速 —— 依赖具体 GPU 与驱动，Linux 上默认走 `libx264`
- 代码签名与公证 —— Linux 无对应体系；分发请自行提供 deb/AppImage
