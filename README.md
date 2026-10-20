<p align="center">
  <img src="docs/images/app-icon-1.74.6.png" alt="红果短剧 Linux 应用图标" width="132" height="132">
</p>

<h1 align="center">红果短剧 Linux</h1>
<p align="center">在 Linux 桌面找剧、看片，接着上次的位置继续看。</p>
<p align="center">
  <strong>中文</strong> · <a href="README.en.md">English</a>
</p>
<p align="center">
  <a href="https://github.com/yxt02/hongguo-drama-linux/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/yxt02/hongguo-drama-linux?style=flat-square"></a>
  <img alt="Linux x64" src="https://img.shields.io/badge/platform-Linux%20x64-55746b?style=flat-square">
  <a href="LICENSE"><img alt="GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-555555?style=flat-square"></a>
</p>
<p align="center">
  <a href="https://github.com/yxt02/hongguo-drama-linux/releases/latest"><strong>下载 Linux 版</strong></a> ·
  <a href="#一键更新">一键更新</a> ·
  <a href="#自动切季">自动切季</a> ·
  <a href="https://github.com/yxt02/hongguo-drama-linux/issues">反馈问题</a>
</p>

由 [yxt02](https://github.com/yxt02) 维护的独立 Linux 桌面项目，提供短剧搜索、在线播放、本地下载和续播。面向 **Linux x86_64** 分发，FFmpeg 与运行时已包含在安装包中。

## 下载与安装

在 [最新发行版](https://github.com/yxt02/hongguo-drama-linux/releases/latest) 下载：

```text
hongguo-drama-<版本号>-linux-x64.tar.gz
```

解压后运行 **`红果短剧.sh`**：

```sh
tar -xzf hongguo-drama-<版本号>-linux-x64.tar.gz
cd hongguo-linux-x64
./红果短剧.sh
```

运行 `./install.sh` 可添加应用菜单入口和 `hongguo` 命令。安装在用户目录 `~/.local/opt/hongguo-drama`，无需 sudo，也无需另外安装 Node.js 或 FFmpeg。

发行版同时提供源码包和 `SHA256SUMS.txt`。将下载的压缩包与校验文件放在同一目录后，可核对安装包：

```sh
sha256sum --ignore-missing -c SHA256SUMS.txt
```

## 一键更新

进入 **设置 → 检测更新 → 一键更新并重启**。

应用会下载完整目录包，核对 SHA256 与程序版本，退出后原位替换并重启。更新失败会恢复旧版，并保留一份 `.previous` 备份；应用目录之外的观看记录、设置与手动下载不会被覆盖。

终端也可以执行：

```sh
hongguo --update --restart
```

从尚未支持一键更新的旧版本升级：下载并解压新版，运行 **`升级现有安装.sh`**，自动关闭旧程序后替换，无需先卸载，也不重复下载安装包。

> 应用内更新支持可写的 Linux x64 完整目录安装。AppImage 等安装方式请从发行页手动更新。

## 日常观看

| 功能 | 使用方式 |
|---|---|
| 找剧 | 浏览分类、搜索剧名，或粘贴分享链接 / 剧集 ID |
| 高清取源 | 默认优先 App 最高可用画质，也可指定 1080p / 720p |
| 兼容播放 | 默认准备 H.264 兼容格式后播放，不必等黑屏才手动转码 |
| 接着上次看 | 每部剧、每一季分别保存集数和播放位置 |
| 自动缓存 | 保留当前集及前后各 5 集，移出窗口的自动缓存会清理 |
| 批量下载 | 将需要长期保留的集数加入下载队列，与自动缓存分开管理 |
| 连续播放 | 支持自动下一集、倍速、全屏与画面调节 |
| 托盘 | 可选择点 X 完全退出，或最小化到托盘继续运行 |

实际清晰度与可播范围以来源返回为准。App 源失败时会提示重试，不自动切回网页低清源。转成 H.264 不会把低清素材变成高清。

## 自动切季

打开一部剧后，应用会在后台查找同一来源的其他季，直接显示在**剧名下方**。点击季按钮即可切换，无需先手动关联。

支持这些标题形式：

| 剧名示例 | 识别结果 |
|---|---|
| `某部剧1`、`某部剧2` | 第 1、2 季 |
| `某部剧一`、`某部剧二` | 第 1、2 季 |
| `某部剧 第一季`、`某部剧 第二部` | 第 1、2 季 |
| `某部剧 Season 2`、`某部剧 S3` | 第 2、3 季 |
| `某部剧（２）` | 第 2 季 |

各季独立续播。标题匹配会过滤其他剧名、跨来源和已移出剧库的条目，同一季号的不同条目会显示剧名供区分。

季关系来自标题识别，可能存在误判；不规范的标题可通过 **修正季信息** 手动指定。查找失败可重试，不影响当前播放。

## H.264 兼容播放与空间管理

默认使用 H.264 兼容播放，在线片源和本地视频均适用。转码保持源视频尺寸，复用有效的兼容缓存，并串行提前准备附近集数。第一次准备可能需要等待，耗时取决于视频和电脑性能。

播放器中的 **本剧：兼容解码 → 恢复自动** 可以只为当前剧切回自动解码，选择会被记住，也能随时恢复 H.264。自动模式仍保留解码故障检测与修复。

自动缓存只围绕当前播放位置保留前后各 5 集；**手动下载单独保留**。可在播放器或设置中查看占用并清理缓存。

## 关闭与托盘

默认点 X 完整退出。可在 **设置 → 窗口与托盘** 改成最小化到托盘。托盘菜单提供显示主窗口、最小化和退出程序等操作；托盘不可用时不会把窗口隐藏后留在后台。

退出程序会关闭后台搜索窗口，并等待下载写入和转码收尾。需要升级或确认程序退出时，可使用托盘菜单中的 **退出程序**，或执行 `hongguo --quit`。

## 常见问题

**画面仍然模糊？** 先确认来源实际返回的分辨率。默认会选 App 最高可用画质；低码率素材无法靠转码恢复细节，画面增强也不能补回原本不存在的信息。

**找不到其他季？** 自动识别依赖来源搜索结果和一致的名称主体。可尝试重试，或用“修正季信息”指定其他季。

**转码等待较久？** H.264 兼容模式需要准备视频。已生成的有效缓存会复用；如本机原编码播放正常，可为该剧切回自动解码。

**来源、目录或下载失败？** 检查网络与代理设置，再重试。锁定或不可用内容需到来源平台处理，应用不能保证所有条目可播。

**程序启动不了？** 请运行压缩包根目录的 `红果短剧.sh`。启动器会处理部分 Linux 发行版的 Chromium 沙箱兼容问题，不建议直接运行 `app/` 内的二进制。

**如何反馈？** 到 [Issues](https://github.com/yxt02/hongguo-drama-linux/issues) 提供版本号、发行版、复现步骤和错误提示；附日志前请移除个人信息。

## 开发与版本

- 当前应用版本：**1.74.8**；本次新增默认 H.264 与自动季按钮。
- 验证：45 项播放回归、Linux 打包及完整原位更新检查通过。详见 [发行说明](docs/release-1.74.8-linux.md)。
- 从源码构建、媒体工具校验和测试方法见 [Linux 开发说明](docs/DEVELOPMENT.md)。
- Linux 发布工作流在版本号更新后执行测试、打包和更新包检查，通过后发布安装包、源码及校验文件。

## 项目来源与许可

本项目在 [jackotom/hongguo-drama](https://github.com/jackotom/hongguo-drama) 的代码基础上持续开发；更早来源与修改声明见 [NOTICE](NOTICE)。独立维护不改变原有开源许可及署名。

代码使用 [GPL-3.0](LICENSE)。内置 FFmpeg 的来源、许可与固定校验信息见 [Linux 媒体工具说明](build/ffmpeg/LINUX-NOTICE.txt)及[第三方声明](THIRD-PARTY-NOTICES.md)。

本项目是非官方 Linux 客户端，与红果官方无隶属关系。
