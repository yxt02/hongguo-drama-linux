<p align="center">
  <img src="build/icon.png" alt="红果短剧桌面版图标" width="112" height="112">
</p>

<h1 align="center">红果短剧 · 桌面版</h1>

<p align="center">
  <strong>中文</strong> · <a href="README.en.md">English</a>
</p>

<p align="center">发现好剧，接着上次看。搜索、播放、下载、追剧与合并导出，在一个桌面应用里完成。</p>

<p align="center">
  <a href="https://github.com/jackotom/hongguo-drama/releases/latest"><img alt="最新公开版本" src="https://img.shields.io/github/v/release/jackotom/hongguo-drama?style=flat-square"></a>
  <img alt="macOS 13 或更新版本" src="https://img.shields.io/badge/macOS-13%2B-555555?style=flat-square">
  <img alt="M 系列 Mac、Intel Mac 与 Windows x64" src="https://img.shields.io/badge/platforms-Mac_arm64_%2F_x64_%C2%B7_Windows_x64-55746b?style=flat-square">
  <a href="LICENSE"><img alt="GPL-3.0 许可证" src="https://img.shields.io/badge/license-GPL--3.0-555555?style=flat-square"></a>
</p>

<p align="center">
  <a href="#下载与安装"><strong>下载与安装</strong></a> ·
  <a href="#完整功能">完整功能</a> ·
  <a href="#界面与演示">界面与演示</a> ·
  <a href="#常见问题">常见问题</a> ·
  <a href="https://github.com/jackotom/hongguo-drama/issues">反馈问题</a>
</p>

## Linux 快速开始

> **本仓库是 Linux 移植版。** 上游只提供 macOS 与 Windows；本仓库补上了 Linux 打包、Chromium 沙箱适配与 FFmpeg 装配。功能完全一致。

**不需要 Node.js、不需要系统 FFmpeg、不需要任何启动参数。**

从 [Releases](https://github.com/yxt02/hongguo-drama-linux/releases/latest) 下载
`hongguo-drama-<version>-linux-x64.tar.gz`，然后：

```sh
tar -xzf hongguo-drama-*-linux-x64.tar.gz
cd hongguo-linux-x64
./红果短剧.sh          # 双击也可以
```

可选：装进应用菜单（**不需要 root / sudo**，全部装在 `~/.local`）

```sh
./install.sh              # 菜单出现「红果短剧」，终端可敲 hongguo
./install.sh --uninstall  # 卸载
```

### 快捷更新（1.74.1 起）

设置 → 检测更新 → **一键更新并重启**。
从本仓库正式发行版下载，完成 SHA256 与程序版本校验后才安装；
退出后替换完整目录，失败恢复旧版，并保留一份 `.previous` 备份。
不覆盖应用目录之外的设置、观看记录及手动下载。

退出应用后也可以执行：

```sh
hongguo --update --restart
# 或在解压目录运行 ./更新红果短剧.sh --restart
```

完整 Linux x64 目录包支持快捷更新，无需另装 Node.js；AppImage 等方式请手动下载安装。
首次从旧版升级：运行本包的 `./升级现有安装.sh`，自动关闭该安装的旧版及残留后台进程，直接替换原安装并重新启动，无需卸载或再次下载。
默认升级 `~/.local/opt/hongguo-drama`，自定义安装可设置 `HONGGUO_INSTALL_DIR`。

### 系统托盘与退出（1.74.2 起）

系统托盘图标菜单提供“显示主窗口”“最小化到托盘”“点 X 时”和“退出程序”。
设置 → 窗口与托盘中可选择点 X 退出程序（默认）或最小化到托盘，选择立即保存。
托盘中继续运行后台任务；“退出程序”和一键更新会等待下载/转码收尾，并关闭隐藏搜索窗口。
系统托盘不可用时不会隐藏窗口，可使用普通最小化或退出。终端也可执行 `hongguo --quit`。

**为什么必须用启动器，不能直接跑 `app/hongguo-downloader`？**
Chromium 在自身初始化阶段就决定沙箱模式，早于应用代码，所以应用内无法补救。Ubuntu 23.10+ 的 AppArmor 会阻止用户命名空间沙箱，未提权的 `chrome-sandbox` 又会让 Chromium 直接中止。启动器检测到该组合时自动补 `--no-sandbox`，其余情况不加、保持默认沙箱。

详见 [从源码构建 Linux 版](#从源码构建-linux-版) 与 [Linux 移植分析](docs/LINUX-PORT.md)。

---

## 下载与安装

> **本 fork 只维护 Linux。** Mac 与 Windows 请到上游
> [jackotom/hongguo-drama](https://github.com/jackotom/hongguo-drama/releases) 获取官方构建；本页下方的 Mac/Windows 表格仅为方便而保留上游链接。

**当前正式版：1.74.3**（Linux fork；Mac/Windows 上游为 1.73）。媒体工具已内置，无需另装 Node.js、Homebrew 或 FFmpeg。

| 设备 | 下载 | 安装方式 |
|---|---|---|
| **Linux x64（本仓库）** | [下载 tar.gz](https://github.com/yxt02/hongguo-drama-linux/releases/latest) | 解压后运行 `./红果短剧.sh`，详见上方「Linux 快速开始」 |
| Apple 芯片 Mac（M 系列），macOS 13+ | [下载 DMG](https://github.com/jackotom/hongguo-drama/releases/download/v1.73/Hongguo-1.73-mac-arm64.dmg)（上游） | 打开 DMG，拖入「应用程序」后启动 |
| Intel Mac，macOS 13+ | [下载 DMG](https://github.com/jackotom/hongguo-drama/releases/download/v1.73/Hongguo-1.73-mac-x64.dmg)（上游） | 打开 DMG，拖入「应用程序」后启动 |
| Windows x64 | [下载 EXE](https://github.com/jackotom/hongguo-drama/releases/download/v1.73/hongguo-downloader-1.73.0-win-x64.exe) · [下载 ZIP](https://github.com/jackotom/hongguo-drama/releases/download/v1.73/hongguo-downloader-1.73.0-win-x64.zip)（上游） | 便携版，直接运行 EXE；ZIP 解压后运行同一程序 |

[本仓库 Linux 发行页](https://github.com/yxt02/hongguo-drama-linux/releases) · [上游正式版](https://github.com/jackotom/hongguo-drama/releases/latest) · [1.73 更新说明与源码](https://github.com/jackotom/hongguo-drama/releases/tag/v1.73) · [SHA256 校验文件](https://github.com/jackotom/hongguo-drama/releases/download/v1.73/SHA256SUMS.txt)

- **更新旧版**：Linux 1.74.1 起提供设置页一键更新及 `hongguo --update --restart`。首次可运行 `升级现有安装.sh` 直接升级；下载和安装均由用户主动触发。
- **Mac**：1.73 两种架构的应用与 DMG 均已完成 Developer ID 签名、Apple 公证及票据装订；无需全局关闭 Gatekeeper。公证不等于 App Store 审核或内容授权。
- **Windows**：EXE 尚未签名，可能出现系统安全提示。请核对下载来源；首次启动会展开临时运行文件，设置与观看记录仍保存在用户资料目录。
- **普通使用只需安装包**：Assets 中的 `source` 文件和 GitHub 自动生成的 Source code 是源码，不能直接运行。

本项目是社区维护的开源修改版，**不是红果、西饭或河马的官方客户端，也未获平台官方背书**。不提供付费分集解锁；剧集、清晰度和可用范围取决于来源平台。

## 开始使用

1. 打开「设置」，选择下载目录并保存。
2. 在「发现短剧」浏览，或在「搜索与下载」输入剧名、红果分享链接或剧集 ID。
3. 打开详情点「立即播放」，也可选择集数与清晰度加入下载队列。
4. 下次从「我的剧库」或「观看记录」接着看；下载进度、失败重试和整剧合并在「下载管理」。

## 1.73 下载自动重试

临时传输故障按 10、30、60 秒自动重试；下载管理显示等待状态、轮次和时间，支持立即重试或停止。详见 [1.73 更新说明](docs/release-1.73.md)。

## 1.72 播放与下载修复

- 普通横屏播放时，控制条无操作约两秒后隐藏；暂停、菜单、拖动和键盘焦点仍可正常使用。
- 官网及自定义片源复用经过安全检查的连接，减少分段播放重复建连；代理与直连分开。
- 指定清晰度下载遇到临时网络错误，可按既有上限延迟重试，保持原画质，不无限重试。
- 保留 1.71 布局。详见 [1.72 更新说明](docs/release-1.72.md)；上游不可用或明确画质缺失仍可能失败。

## 1.71 布局更新

- 我的剧库的下载清晰度说明移到标题下、操作按钮上方；竖屏时随管理面板展开。
- 热播推荐四个榜单与“摇一摇”分散排布，旧试用包更新后生效。
- 保留原有剧库、下载和设置。详见 [1.71 更新说明](docs/release-1.71.md)。

## 1.7 更新重点


**下载仍可能失败。** 平台风控可能限制取址；App 取址已采用每次请求更换合成设备标识符的方式尝试绕过按设备限制，但不保证所有剧集可用或下载成功。失败任务会保留，可稍后重试。

本软件用于学习研究，建议体验后 24 小时内自行删除；请勿冒充官方或以虚假授权名义收费。开源权利义务以 [GPLv3](LICENSE) 为准。上述倡议不代表获得平台或版权方授权，也不构成免责承诺。

- 取址遭遇临时拒绝时，按 3、8、15 分钟最多延迟重试三次；可暂停或停止，不无限重试。
- 修复本地资料读取失败后的覆盖风险、多实例争抢资料、合并期间误删分集、合并选中旧记录，以及下载完成前的视频有效性检查。
- 修复下载回复晚到后跳集、暂停状态在同集换源后丢失、返回剧库重复执行旧点播指令。完整预缓存可经质量检查后保存，减少重复取流。
- 热播推荐保留四种榜单，新增“摇一摇”短剧签筒。支持全部来源、单来源随机，避免连续抽到同部，结果在统一剧库播放。
- 设置新增自定义播放源：支持苹果 CMS V10 JSON API 的目录、搜索、详情与选集，以及明确 MP4/M3U8 直链的播放和下载。已启用来源加入发现、全部搜索和摇一摇。
- M3U8 仅支持点播；先将清单、分片和密钥逐项检查并准备到本地，再播放或保存为 MP4。支持普通与 AES-128 HLS，不支持直播、DRM、解析网页、远程插件和付费解锁。
- 自定义源可测试、启停、编辑和删除；删除配置不删除本地视频。沿用现有代理设置，代理端最终 DNS 由用户所选代理负责。

源码基于公开 v1.6，保留原播放恢复与三来源功能。公开发行与平台验证状态以发行页为准。详见 [1.7 升级说明](docs/release-1.7.md)。

## 1.6 更新重点

- **下载清晰度可选**：自动（高清优先）、1080P、720P；按实际分辨率选源，不静默降级。
- **本集评论弹幕**：可调字号、速度、不透明度、区域和密度，支持本机屏蔽词。
- **播放与下载恢复**：地址失效或传输中断时，有限次刷新取址并尝试备用片源；文件完整并通过校验后才标记下载完成。

弹幕仅展示公开网页提供的部分评论，通常首屏约 15 条，读完不循环；不代表全部评论，也不支持发送或回复。完整改动和验证范围见 [1.6 发行说明](https://github.com/jackotom/hongguo-drama/releases/tag/v1.6)。

## 完整功能

| 想做什么 | 主要功能 |
|---|---|
| 找剧 | 红果、西饭、河马统一搜索，分类、热播榜、分享链接解析 |
| 连续观看 | 在线与本地播放、断点续播、自动连播、倍速与下一集预缓存 |
| 下载与导出 | 清晰度选择、批量下载、失败重试、合并 MP4 |
| 管理剧库 | 观看记录、本机收藏、新集提醒、下载文件与缓存清理 |
| 调整观看体验 | 横竖布局、置顶、小窗、主题、快捷键与画质增强 |
| 阅读评论 | 公开剧评、本集评论弹幕与本机屏蔽词 |

<details>
<summary>展开功能详情与使用限制</summary>

### 1. 找剧：三个来源，一次搜索

- **全部来源搜索**：默认同时查询红果、西饭和河马，结果标明来源；也可切换单一来源。某个来源失败时，仍显示其他来源的结果。
- **发现目录**：海报、剧名、集数、题材筛选、分页浏览和刷新片单；详情展示完整分集及下载状态。
- **红果分类与热播榜**：真人剧、漫剧、AI 剧；综合、真人、漫剧、AI 四类榜单，显示来源提供的排名与热度。
- **红果链接 / ID 解析**：粘贴分享链接或输入剧集 ID，获取详情后播放或选集下载。
- **详情直接播放**：无需先下载整部剧；未下载的可用分集尝试在线播放。
- **选集更灵活**：单选、多选、全选、反选、取消全选；快捷选前 10 集、前 30 集、后 30 集；支持 `1-30`、`1,3,5`、`1,5,10-20` 等范围。

| 来源 | 已实现 | 当前边界 |
|---|---|---|
| 红果 | 目录、题材、四类热播榜、搜索、分享链接 / ID 解析、可用分集播放下载 | 网页未提供片源时尝试补充取址，结果仍以来源实际返回为准。 |
| 西饭 | 独立目录、题材、分页、搜索、已开放分集播放下载 | 热播榜尚未接入；锁定分集保留标记并跳过。 |
| 河马 | 官网目录、题材、前后翻页、搜索、完整分集列表、明确免费分集播放下载 | 收费或状态不明的分集锁定，不提供解锁。 |

三个来源的文件按来源与剧名分目录保存。“漫画”是图文阅读内容；要播放视频请选“漫剧”。片源、清晰度及可用分集取决于平台，软件不承诺固定 1080p 或全集可用。

### 2. 播放：在线、本地与连续观看

- **本地优先**：已下载分集直接播放本地文件，未下载且未锁定分集尝试在线播放；双击未下载分集可加入下载队列。
- **基本控制**：点击画面或按钮播放 / 暂停，拖动进度条，查看时间，调整音量与静音。
- **自动缓存前后各 5 集**：磁盘保留当前集及前后各五集，最多十一集；优先预取后续集，后台最多两个任务。切集后取消窗口外任务并清理原片与兼容副本，完成缓存可在重启后校验复用；手动下载继续保留。
- **自动连播**：默认开启，可随时关闭；自动切换下一集，跳过锁定分集，本地与在线分集可衔接播放。
- **断点续播**：按剧保存集数和播放位置，从剧库或观看记录接着看；切换到应用内其他页面，仍可继续播放并保存进度。
- **0.25×–4× 倍速**：共 16 档。右下角倍速数字是独立按钮，每点增加 0.25×，4× 后回到 1×；三点菜单可直接选档，切集与连播保持当前倍速。
- **兼容播放**：默认开启兼容模式；播放中自动识别「黑屏有声」与解不出画面并自动转为 H.264，不必手工切换。片源是 HEVC 而本机解不了时直接转兼容格式，不再先播一段黑屏。也可手动「转码后播放」。显示转码进度，支持取消和清理缓存。
- **失败恢复**：可取消准备、重试本集、重新连接片源或尝试兼容转码。地址过期或传输中断时有限次刷新取址，不无限重试；硬件转码失败时尝试软件转码。

自动模式优先 App 高清片源，按真实分辨率选流；App 片源不可用时允许回退到网页。能直接解码时保持原片，确实不支持时自动转码；软件转码可能更慢，来源服务异常仍可能导致播放失败。

在线播放不保存到下载目录，但部分片源会先准备临时媒体文件并在使用后清理；兼容转码另有磁盘缓存。因此“在线”不代表完全不占磁盘。

### 3. 画面与窗口：横屏、竖屏和专注观看

- **横屏版 / 竖屏版**：从顶部切换布局；切回横屏时恢复此前窗口尺寸与位置。
- **窗口置顶**：一键置顶 / 取消置顶，方便边工作边看。
- **右侧一体选集**：竖屏模式下，选集栏随窗口展开或收起，减少对视频的遮挡。
- **隐藏管理按钮**：收起不常用操作，让播放区更简洁。
- **去掉播放器边框**：竖屏下去掉播放区周围留白与圆角；这是播放器布局效果，不是移除系统窗口边框。
- **全屏**：横屏使用视频全屏；竖屏填满当前窗口，`Esc` 退出。全屏或竖屏播放时，控制条闲置约 2 秒自动隐藏，移动鼠标或操作非切集快捷键后重新显示；暂停、拖动进度条、打开菜单或键盘焦点停在控件上时保持可见。自动连播及上一集、下一集快捷键切集时，已隐藏的控制条保持隐藏，不再短暂弹出。
- **画面模式**：在播放器三点菜单切换，**每部剧独立记忆**，切换保留播放进度。

| 画面模式 | 效果 | 适合场景 |
|---|---|---|
| 适应窗口（默认） | 按可用宽高等比缩放，完整显示画面 | 希望人物、字幕和画面边缘都能看全。 |
| 保持宽度 | 按可用宽度等比缩放；只缩短窗口高度时，画面不跟着变小，上下超出部分居中裁剪 | 希望调整窗口高度时保持画面大小；注意边缘字幕或人物可能被裁掉。 |

### 4. 观看记录与追剧提醒

- 独立「观看记录」页，真正开始播放后才计入，按最近观看排序。
- 显示封面、剧名、集数、播放时间点及最近观看时间，点击继续观看。
- 支持手动「检查更新」；应用运行期间每部剧约 6 小时检查一次新集，列表较多时分批处理，以红点和新增集数提醒。
- 约每天检查同来源、同名且季数更高的**疑似续作**，并直接打开；该功能可单独关闭，名称匹配可能误报或漏报。
- 系统通知默认关闭，可在设置中开启；仍需系统允许通知。

追剧检查仅在应用运行时执行，不承诺退出后提醒或实时推送。观看记录保存在本机，不提供跨设备同步。

### 5. 下载队列：批量保存与失败恢复

- **下载清晰度**：自动（高清优先）、1080P、720P，可保存默认值。按视频实际尺寸选源，保存前再次检查；没有达标片源会提示，不静默降级或放大冒充高清。只有更高分辨率时保留原分辨率，不降采样。
- **任务独立保存选择**：修改默认清晰度不改变已有任务的普通重试；已有低清文件保留，不自动覆盖。清晰度选项同时用于在线播放、自动缓存和新建下载；已有本地原件须经过尺寸校验才能满足指定画质。
- 单集或批量加入队列，显示等待中、下载中、已完成、失败、已停止状态，以及下载进度、已接收 / 总字节数和失败原因。
- 支持全部开始、全部暂停、单任务停止、重试失败、选中失败项及重试选中；停止的任务可重新排队。
- **1–10 个并发下载**，默认 3，在设置保存后生效；较高并发可能触发来源限流。
- 下载列表按剧组织并分页；**跨页全选、取消全选、选择保留与批量删除**。
- 删除前确认：默认仅删除任务记录，可勾选同时删除本地文件；可清空已完成记录。
- 一键打开任务文件夹；**扫描下载目录**，补登记符合应用目录与命名规则的已有文件。

片源的“1080P”标签可能与实际尺寸不符，也不代表上游母版质量；不保证每部剧或每一集都有 1080P。“重新排队 / 重试”不等于从已下载字节续传，锁定集不能加入下载队列。

### 6. 合并导出：多集合成一个 MP4

在「下载管理」选择剧名后点「合并整部剧」，无需勾选任务；「我的剧库」也提供合并入口。候选列表只显示仍有本地可合并分集的剧，在线播放记录不会混入；仅删除任务记录但保留文件时，仍可合并。

| 模式 | 处理方式 |
|---|---|
| 智能快速合并 | 编码参数一致时直接拼接；不一致时按需要处理音视频，混合编码可能需要转码。 |
| 兼容合并（H.264） | 导出 H.264/AAC；已兼容分集尽量直接拼接，仅处理不匹配部分。 |

显示阶段、进度、耗时及可用的处理速度 / 预计剩余时间，支持取消、打开输出所在文件夹和移除合并记录。两种方式都保留原始分集；**仅合并已下载分集，不会自动补齐缺集**。转码并非无损，用时取决于内容和设备。

### 7. 我的剧库与空间清理

- 搜索、切换已登记短剧，查看集数、下载数量和文件占用，下载尚未完成的可用分集。
- 从剧库列表移除但保留文件；恢复已移除的剧；批量清理没有本地下载的剧。
- 删除单部剧或全部已下载文件，保留剧集信息，之后仍可尝试在线播放或重新下载。
- 分别清理在线播放缓存与兼容转码缓存。
- 自动清理只管理播放缓存及其转码副本，手动下载的文件继续保留；旧的「看完自动删」设置不再生效。

### 8. 设置、网络与软件更新

- **下载位置**：选择文件夹或手动填写目录。
- **命名规则**：支持「剧名」「集数」「标题」变量，以及“剧名_第N集”“剧名_第N集_标题”预设；保留独立集号以避免覆盖。
- **代理配置**：开关、跟随系统 / 环境变量、手动 HTTP/HTTPS 代理、强制直连；支持地址端口、常见端口预设及可选认证信息。
- **代理测试**：可在保存前测试草稿配置，保存后生效。当前“跟随系统”主进程读取 `HTTP_PROXY` / `HTTPS_PROXY` 等环境变量，不保证识别所有系统代理或 PAC；一次测试成功不代表全部片源可访问。
- **提醒开关**：分别控制新集检查、疑似续作、系统通知和自动检测软件更新。
- **软件更新提示**：默认开启；启动及运行期间每 6 小时检查 GitHub 正式新版。右上角提醒可关闭，也可取消自动检测并保存；网络失败不阻止使用旧版。
- 点击更新提醒只打开 GitHub 发行页，**不会自动下载或安装，也不强制升级**。

### 9. 外观、收藏与评论

- **外观与小窗**：浅色、深色或跟随系统；隐身小窗在鼠标移开时暂停并隐藏，移回继续，可通过 Esc、Dock 或窗口菜单恢复主窗口。
- **找剧辅助**：本机搜索历史联想、公开热播榜、已完结或更新中筛选；未知状态不冒充已完结，热播榜不是账号个性化推荐。
- **公开剧评与本集弹幕**：查看来源提供的评分、整剧剧评和单集评论节选。弹幕可调不透明度、字号、速度、区域和密度，也可隐藏入口；默认开启常见敏感词过滤，可添加本机屏蔽词，无法识别所有变体。
- **本机收藏与上新**：收藏仅保存在本机；「收藏与上新」按已浏览剧集的首次公开日期整理，不是完整的未来上新排期。
- **画质增强**：原画、可调锐化、Anime4K CNNx2M 2× 增强。Anime4K 面向动漫，支持不高于 1080p 的输入；真人画面可能偏平滑，不兼容或处理持续过慢时恢复原画，不改变下载文件。
- **分享链接**：用户主动点击后读取分享链接；公开剧集可复制官方分享页链接。

公开评论仅供阅读，弹幕通常只有公开网页首屏约 15 条，读完不会循环。当前不提供手机号登录、手机账号收藏／点赞／历史同步、弹幕发送或回复。

</details>

## 播放快捷键

| 按键 | 操作 |
|---|---|
| `空格` | 播放 / 暂停 |
| `←` / `→` | 后退 / 前进 5 秒 |
| `↑` / `↓` | 上一集 / 下一集 |
| `A` | 开启 / 关闭连播 |
| `S` / `D` | 降低 / 提高 0.25 倍速 |
| `F` | 切换全屏 |
| `Esc` | 退出竖屏填满窗口状态，或关闭当前菜单 / 弹窗 |

以上为默认键位，可在「设置」中点击修改，支持单键或 Shift 组合，并检查冲突、恢复默认。输入框、菜单和弹窗操作不会误触播放器快捷键。

## 界面与演示

![红果短剧 1.6：热播推荐与公开榜单](docs/screenshots/macos-v1.6-hot.jpg)

<p align="center"><sub>macOS 1.6 正式版实拍：热播推荐页面。截图中的片单与热度为截取时的公开榜单内容，会随来源更新。</sub></p>

<details>
<summary>观看 3 分钟功能介绍（基于 1.3，未包含后续更新）</summary>

https://github.com/user-attachments/assets/b95f4f60-b57c-495f-a30e-62ac2b0bda11

3 分钟，从三来源搜索、链接解析讲到播放续看、下载合并、横竖屏与画面模式，再展示 1.3 的主题、快捷键、隐身小窗、热播推荐、公开剧评、本机收藏与日历、画质增强和更新提醒。

视频使用 1.3 正式前端和隔离的演示资料；播放器画面为短剧封面演示，集数、榜单、评分、评论与日期不代表真实平台数据。

[下载三分钟介绍视频（1080p，约6 MB）](https://github.com/jackotom/hongguo-drama/releases/download/v1.3/Hongguo-1.3-Complete-Intro-3min.mp4)

</details>

## 常见问题

### 为什么有些分集锁定、加载失败或清晰度不同？

片源和可用范围由来源服务决定；西饭锁定集、河马收费或状态不明集会保留锁定。应用不提供解锁或广告奖励接口，不承诺付费内容可用。来源接口可能变化，过去能用不保证一直可用。

### 下载失败、目录加载不出来怎么办？

先检查网络与来源平台，再检查代理开关和模式，适当降低并发，使用「重试失败」或重新加载目录。黑屏有声时会自动转为 H.264 兼容格式，也可手动「转码后播放」。

### 视频、设置和记录存在哪里？

视频保存在设置中的下载目录，按来源与剧名组织。设置、任务及观看记录默认位于：

- macOS：`~/Library/Application Support/hongguo-downloader/`
- Windows：`%APPDATA%\hongguo-downloader\`

自行指定用户资料目录时以指定位置为准。移除剧库条目、删除任务记录、删除视频和清理缓存是不同操作，请核对确认框。

### 为什么没有自动安装新版？

软件只提供更新提醒与发行页入口，下载和安装由你决定。关闭提醒或自动检测后，旧版仍可继续使用；来源服务变化仍可能影响功能。

### 自行构建也有签名和公证吗？

源码默认 Mac 构建使用 ad-hoc 签名，不会自动使用开发者证书或提交公证。正式 Mac 包的 Developer ID 签名与公证是独立发行步骤；Windows 包当前未签名。无需为本应用全局关闭 Gatekeeper。

### 如何反馈问题？

到 [Issues](https://github.com/jackotom/hongguo-drama/issues) 提供应用版本、操作系统与芯片类型、来源、复现步骤和错误提示。截图与日志请移除账号信息、Cookie、代理凭据及个人文件路径。

## 版本与验证范围

上游当前正式版为 **1.73**；本仓库 Linux 版为 **1.74.3**（源码配置版本 `1.74.3`）。Linux 安装包见[本仓库发行页](https://github.com/yxt02/hongguo-drama-linux/releases)，Mac/Windows 的签名公证与验证记录以上游[发行页](https://github.com/jackotom/hongguo-drama/releases)为准。

1.73 两种 Mac 架构的 App 和 DMG 均已签名、公证并装订票据，安装包挂载后代码与媒体工具核验一致。Mac 成品代码使用隔离资料验证等待重试、立即重试、停止及正常本地视频播放；故障由受控模拟提供。Windows 云端成品检查通过，EXE 未签名。下载重试 14 项、下载界面 13 项及媒体恢复回归通过；真实上游与长期下载不保证全部成功。

**尚未覆盖**：实体 Windows 11、全部显卡、实体 Intel Mac、启用 Gatekeeper 的干净环境、Windows 真实网络弹幕及长期播放。云端检查和公证不能代替所有设备与网络环境的实测。

<details>
<summary>历史版本与旧版升级提示</summary>

| 版本 | 主要变化 | 详细记录 |
|---|---|---|
| **1.74.3（Linux）** | 修复 App 高清视频请求错误 Referer 导致的 403，真实取流与解码验证 | [发行说明](docs/release-1.74.3-linux.md) |
| 1.74.2（Linux） | 系统托盘菜单、点 X 行为选择、完整退出及隐藏搜索窗口残留修复 | [发行说明](docs/release-1.74.2-linux.md) |
| 1.74.1（Linux） | 一键下载、校验并重启更新，旧版备份及失败回滚，无需卸载重装 | [发行说明](docs/release-1.74.1-linux.md) |
| 1.74.0（Linux） | 前后各五集磁盘缓存、统一高清优先选择、缓存校验与 HLS 转码修复 | [发行说明](docs/release-1.74-linux.md) |
| 1.73.1（Linux） | 黑屏有声自动转 H.264；HEVC 不支持时直接转兼容格式 | [发行页](https://github.com/yxt02/hongguo-drama-linux/releases) |
| 1.6 | 下载清晰度、本集弹幕、播放与下载恢复 | [发行说明](https://github.com/jackotom/hongguo-drama/releases/tag/v1.6) |
| 1.5 | 片源兼容、播放失败恢复、全屏切集控制条优化 | [发行说明](https://github.com/jackotom/hongguo-drama/releases/tag/v1.5) |
| 1.4 | 修复合并候选混入在线播放记录、文件删除后候选残留 | [发行说明](https://github.com/jackotom/hongguo-drama/releases/tag/v1.4) |
| 1.3 | 主题、快捷键、隐身小窗、公开剧评、本机收藏与画质增强 | [发行说明](https://github.com/jackotom/hongguo-drama/releases/tag/v1.3) |
| 1.2 | 按剧记忆画面模式、正式新版提醒 | [版本记录](docs/release-1.2.md) |

仓库曾从 `hongguo-drama-mac` 更名为 `hongguo-drama`。如果仍使用更名前的 1.2 安装包，请从本页手动下载当前正式版替换一次；应用标识与用户资料位置保持不变。1.2 修订版的精确源码见该版发行附件，原 `v1.2` 标签保留首发历史。

</details>

## 从源码构建 Mac 版

<details>
<summary>展开构建步骤、产物位置与 FFmpeg 对应源码说明</summary>

应用使用 **Electron + React + Node.js**。构建需要 Node.js **22.12 或更新版本**、npm、Apple Command Line Tools、`pkg-config`，以及可用的 `make`、`git`、`curl`。构建脚本不会自动安装这些系统依赖。

```sh
git clone https://github.com/jackotom/hongguo-drama.git
cd hongguo-drama
npm ci
npm run build:mac
```

上述默认命令在 Apple Silicon 上构建两种 Mac 架构。Intel 构建机请先运行 `node scripts/setup-ffmpeg-mac.js x64` 和 `npm run build:react`，再运行 `npx electron-builder --mac dmg --x64 --publish never`。

构建会验证已有 FFmpeg / FFprobe 缓存；缺少匹配缓存时，从固定且经过 SHA256 校验的 FFmpeg/x264 源码编译，然后生成前端、指定架构应用和 DMG。首次构建需联网获取依赖和源码，编译可能耗时数分钟。

| 用途 | 命令或产物 |
|---|---|
| 开发模式 | `npm run dev` |
| 仅生成 Mac 应用 | `npm run build:mac:dir` |
| 应用产物 | `dist/mac-arm64/红果短剧.app`、`dist/mac/红果短剧.app` |
| DMG | `dist/红果短剧-<版本>-mac-arm64.dmg` 或 `dist/红果短剧-<版本>-mac-x64.dmg`；版本取自 `package.json` |

### FFmpeg 的准确对应源码

Mac 包内置的 FFmpeg / FFprobe 基于 **FFmpeg 9.0.2** 与 **x264 `b35605ace3ddf7c1a5d67a2eb553f034aef41d55`** 的未修改源码编译。此构建为 **GPLv3-or-later**，仅静态链接 x264，保留 VideoToolbox，未启用 `nonfree`；动态依赖仅为 macOS 系统库，不依赖使用者的 Homebrew 环境。

[各版本的 Release](https://github.com/jackotom/hongguo-drama/releases) 附有**应用源码 ZIP**以及独立的 **FFmpeg/x264 完整对应源码包**，后者包含准确源码归档、构建脚本、清单与许可文本。请按需要的应用版本与平台选择对应附件。只下载 GitHub 自动生成的项目源码归档，不能代替这一媒体工具对应源码包。

- [FFmpeg 来源、源码校验值与构建说明](build/ffmpeg/MACOS-NOTICE.txt)
- [准确版本与构建配置](build/ffmpeg/MACOS-VERSIONS.txt)
- [FFmpeg 源码构建脚本](scripts/build-ffmpeg-source-mac.sh)
- [FFmpeg GPLv3 许可全文](build/ffmpeg/MACOS-LICENSE.txt) · [x264 许可全文](build/ffmpeg/MACOS-X264-LICENSE.txt)

FFmpeg 二进制不提交到 Git。重新分发编译包时，请按 GPL 要求同时提供完整对应源码及构建材料。

</details>

## 从源码构建 Windows 版

在 Windows x64 上构建便携 EXE，需准备匹配的 FFmpeg / FFprobe；完整依赖、媒体工具源码与构建命令见 [三平台发行与 Windows 构建说明](docs/RELEASING.md)。云端构建工作流随源码提供。自行构建不会自动获得代码签名。

## 从源码构建 Linux 版

<details>
<summary>展开构建步骤、产物位置、沙箱说明与 FFmpeg 校验</summary>

应用使用 **Electron + React + Node.js**。Linux 构建需要 Node.js **22.12 或更新版本**、npm、`tar`、`ldd`、`git`、`curl`，以及可用的 `python3`（`electron-builder` 解包用）。构建脚本不会自动安装这些系统依赖。

```sh
git clone https://github.com/jackotom/hongguo-drama.git
cd hongguo-drama
npm ci
npm run build:linux:dir     # 生成 dist/linux-unpacked/
npm run build:linux:appimage  # 额外生成 AppImage
```

`npm run build:linux` 会先跑 `node scripts/setup-ffmpeg-linux.js` 校验或获取 FFmpeg，再生成前端并打包。

| 用途 | 命令或产物 |
|---|---|
| 开发模式 | `npm run dev` |
| 源码目录直接启动（自动处理沙箱） | `npm run start:linux` |
| 仅生成 Linux 应用目录 | `npm run build:linux:dir` |
| 应用产物 | `dist/linux-unpacked/hongguo-downloader` |
| AppImage | `dist/红果短剧-<版本>-x86_64.AppImage` |

### Chromium 沙箱（Ubuntu 24.04 等发行版）

Electron 在 Linux 上可用 **SUID `chrome-sandbox`** 或 **非特权用户命名空间** 两种沙箱。Ubuntu 23.10+ 默认 `kernel.apparmor_restrict_unprivileged_userns=1`，会阻止命名空间沙箱；此时若 `chrome-sandbox` 也非 root 所有的 SUID，Chromium 会在启动时直接中止。

`npm run start:linux` 会自动检测这一组合并退到 `--no-sandbox`，同时打印三种可选修法（SUID helper、AppArmor sysctl、或使用打包器产物）。仅本机自用时 `--no-sandbox` 通常可接受；对外分发请用会正确安装 SUID helper 的 deb/AppImage 包。

### FFmpeg 的校验与来源

Linux 包内置的 FFmpeg / FFprobe 位于 `build/ffmpeg/linux-x64/`，来源为 **BtbN FFmpeg-Builds** 的 `n8.1 linux64-gpl` 发布构建（含 libx264 / libx265），由 `scripts/setup-ffmpeg-linux.js` 按固定 SHA256 校验：

- 归档 SHA256、二进制 SHA256 记录在 `build/ffmpeg/linux-x64/build-manifest.json`；
- 校验 ELF 魔数与 x86-64 机器类型；
- 用 `ldd` 确认只依赖系统动态库（glibc / libgcc），全静态亦可接受。

已下载的归档可通过 `FFMPEG_LINUX_ARCHIVE=/path/to.tar.xz` 复用，避免重复下载。

- [FFmpeg 来源、许可与校验说明](build/ffmpeg/LINUX-NOTICE.txt)（含「为何不用更小的全静态构建」的实测记录）
- [FFmpeg GPLv3 许可全文](build/ffmpeg/COPYING.GPLv3) · [LGPLv2.1](build/ffmpeg/COPYING.LGPLv2.1)

**与 Windows / macOS 构建的差异**：那两端从钉住的源码快照自行编译、只链接 x264 并随发行附带对应源码包；Linux 使用上游预编译 gpl 发布构建，编码器集合更大，两个二进制约 330MB。若要求同等的「最小依赖 + 可复现源码」标准，可自行编译 FFmpeg 放入 `build/ffmpeg/linux-x64/`，setup 脚本会校验任何通过上述检查的产物——但**务必先用 AES-128 HLS 转封装命令做冒烟测试**（详见 LINUX-NOTICE）。

FFmpeg 二进制不提交到 Git。重新分发编译包时，请按 GPL 要求同时提供完整对应源码及构建材料。

### 在 Linux 上跑校验套件

```sh
export FFMPEG=$PWD/build/ffmpeg/linux-x64/ffmpeg
export FFPROBE=$PWD/build/ffmpeg/linux-x64/ffprobe
export HONGGUO_FFMPEG=$FFMPEG HONGGUO_FFPROBE=$FFPROBE
node scripts/check-merge.cjs          # 合并链路
node scripts/check-hls-media.cjs      # HLS 拆包（需 HONGGUO_VIDEO_FIXTURE）
```

平台专属检查（`check-ffmpeg-mac`、`check-macos`、`check-windows-release`）在不匹配的平台上会打印 `SKIP` 并返回 0。

</details>

## 上游、许可证与使用边界

本项目延续上游的 **[GPL-3.0](LICENSE)** 许可，并保留修改与来源声明。Mac 分支自 2026-10-07 开始适配，详细变更见 [NOTICE](NOTICE)，组件许可见 [第三方声明](THIRD-PARTY-NOTICES.md)。

感谢以下项目提供的基础工作与参考：

- **[327044572/hongguo-downloader](https://github.com/327044572/hongguo-downloader)**：原始上游项目。
- **[zhenyong97/hongguo-downloader](https://github.com/zhenyong97/hongguo-downloader)**：本次 Mac 移植的直接基础。
- **[woshishiq1/drpys](https://github.com/woshishiq1/drpys)** 与 **[N3urda/hongguoTV](https://github.com/N3urda/hongguoTV)**：App 片源相关算法来源；准确提交与修改说明见 [算法来源声明](src/native/licenses/NOTICE.txt)。
- **[Hululu007/drpy-node](https://github.com/Hululu007/drpy-node/tree/295f2b7047e14122d542a7736cb931e81abcf85c)**：西饭接口路径与返回结构参考；本项目独立编写适配器。
- **Electron、React、FFmpeg 与 x264**：桌面运行、界面和媒体处理组件，许可详情见上述声明。

开源许可适用于软件，不授予剧集内容的再分发权。安装包不包含剧集媒体；作品版权归原平台及创作者所有。请仅处理你有权访问、下载或备份的内容，遵守平台条款与相关法律，勿用于未经授权的传播或商业盗版。平台接口可能调整，某次验证通过不保证后续片源持续可用。
