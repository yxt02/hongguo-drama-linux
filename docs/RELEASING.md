# Linux fork 发行

本仓库独立维护 Linux x64，使用 `v<SemVer>-linux` 标签。v1.74.0-linux 发布已验证的 Linux 包、对应应用源码与 SHA256SUMS.txt；Mac/Windows 继续引用上游构建，不标为本 fork 已发布的平台。下文保留上游三平台发行规则供参考。

# 同步发行规则

从 1.1.9 起，一轮更新共用一个版本：Mac Apple Silicon arm64、Mac Intel x64、Windows x64。不得按平台独立跳号。本机未公开测试版不另算发行。
从 1.4 起，对外版本每次增加 0.1：1.4、1.5……1.9、2.0，不再增加补丁位。配置需要 SemVer 时使用 1.4.0、1.5.0；平台构建号独立递增。以最近公开版本为基准，未公开测试包不另计版本。

1.71 为用户明确指定的例外：从 1.7 增加 0.01，三段配置使用 `1.71.0`。

1.72 同样按本次明确要求增加 0.01，三段配置使用 `1.72.0`。

| 平台 | 构建入口 | 发布门槛 |
|---|---|---|
| macOS arm64 | npm run build:mac | 对应 arm64 媒体组件、Developer ID、Apple 公证 Accepted、装订验证 |
| macOS x64 | npm run build:mac | 对应 x64 媒体组件、Developer ID、Apple 公证 Accepted、装订验证；另记录 Intel 实机覆盖 |
| Windows x64 | Windows x64 release candidate 工作流 | 单文件便携 EXE（无需安装）及包含同一 EXE 的 ZIP；精确 FFmpeg 对应源码；单文件启动、媒体和窗口冒烟验证；明确签名状态 |

Windows 工作流只上传 Actions 构建资产，不创建 Release，不改 latest，不覆盖总校验文件。正式版本由统一发行会话汇总三端资产、对应源码和总 SHA256SUMS。
Windows 当前未配置代码签名证书；EXE 必须明确标为未签名。Windows CI 虚拟机验证不等于用户实体电脑、GPU/HEVC、真实平台下载与长期稳定性验收。
若某平台受阻，同版本保留，记录具体缺口及已有资产状态；不得将缺失平台写成已发布，也不得为补平台另跳版本。

## Windows 构建

Ubuntu 24.04 安装 gcc-mingw-w64-x86-64、make、pkg-config 后运行 `bash scripts/build-ffmpeg-source-win.sh BUILD_DIRECTORY 4`。
将 artifacts/bin 内容放入 build/ffmpeg。Windows x64、Node 22.12+ 执行 `npm ci`、`npm run build:portable`。
`node scripts/check-windows-release.cjs` 仅用于一次性 Windows CI：便携 EXE 直接启动、临时用户资料、普通 CC0 花朵视频；不要对用户现有安装运行。
旧 `scripts/setup-ffmpeg.js` 下载 Gyan 7.1 仅保留作历史开发入口，不得用于 1.1.9 正式发行。

发布必须同时提供应用精确源码 ZIP 与 FFmpeg/x264 Windows 完整对应源码 TAR.GZ。不得遗漏 Windows 专用配置、工作流和构建脚本。

用户下载提供 `.exe` 与 `.zip` 两种形式。ZIP 内仅同一份便携 EXE，无需安装；对应源码归档另外提供。
