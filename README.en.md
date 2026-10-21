<p align="center">
  <img src="docs/images/app-icon-1.74.6.png" alt="Hongguo Drama Linux icon" width="132" height="132">
</p>

<h1 align="center">Hongguo Drama for Linux</h1>
<p align="center">Find short dramas, watch on your Linux desktop, and resume where you left off.</p>
<p align="center"><a href="README.md">中文</a> · <strong>English</strong></p>
<p align="center">
  <a href="https://github.com/yxt02/hongguo-drama-linux/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/yxt02/hongguo-drama-linux?style=flat-square"></a>
  <img alt="Linux x64" src="https://img.shields.io/badge/platform-Linux%20x64-55746b?style=flat-square">
  <a href="LICENSE"><img alt="GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-555555?style=flat-square"></a>
</p>
<p align="center"><a href="https://github.com/yxt02/hongguo-drama-linux/releases/latest"><strong>Download for Linux</strong></a> · <a href="https://github.com/yxt02/hongguo-drama-linux/issues">Report an issue</a></p>

An independently maintained Linux desktop project by [yxt02](https://github.com/yxt02), with drama search, online playback, local downloads and resume support. Distributed for **Linux x86_64**, with the runtime and FFmpeg included.

## Install

Download `hongguo-drama-<version>-linux-x64.tar.gz` from the [latest release](https://github.com/yxt02/hongguo-drama-linux/releases/latest). Extract it and run the launcher:

```sh
tar -xzf hongguo-drama-<version>-linux-x64.tar.gz
cd hongguo-linux-x64
./红果短剧.sh
```

Run `./install.sh` to add the application menu entry and the `hongguo` command. The default installation lives in `~/.local/opt/hongguo-drama`. No sudo, Node.js or system FFmpeg installation is required.

Releases also include source and `SHA256SUMS.txt`. With the archive and checksum file in the same directory:

```sh
sha256sum --ignore-missing -c SHA256SUMS.txt
```

## Update in place

Open **Settings → Check for updates → Update and restart**. The updater verifies SHA256 and the application version, replaces the complete directory after exit, and keeps a `.previous` backup. It restores the old installation on failure. Settings, history and manual downloads outside the application directory are preserved.

You can also run:

```sh
hongguo --update --restart
```

For older installations without the updater, extract the latest bundle and run `升级现有安装.sh`. It closes the old application and upgrades using the extracted bundle, without uninstalling or downloading it again.

In-app updates support writable Linux x64 directory installations. Other package formats, including AppImage, require manual updates from the release page.

## Watching

| Feature | Behavior |
|---|---|
| Discovery | Browse categories, search titles, or paste a share link / series ID |
| Quality | Prefer the highest available App-source resolution, with explicit 1080p / 720p options |
| Compatibility | Prepare H.264 before first playback by default |
| Resume | Keep separate episode and time positions for each drama and season |
| Automatic cache | Retain the current episode and up to five episodes on each side |
| Downloads | Download unfinished episodes after the current one; skip completed, queued and locked episodes |
| Playback | Auto-next, playback speed, fullscreen and picture controls |
| Tray | Choose full exit or minimize-to-tray when closing the window |

Resolution and availability depend on the provider. App-source failures prompt a retry rather than silently falling back to a lower-quality web source. H.264 conversion cannot turn low-resolution footage into HD.

## Automatic season buttons

Opening a drama starts a background search for other seasons from the same provider. **Buttons below the title** let you switch directly, without linking seasons manually first.

| Title ending | Interpretation |
|---|---|
| `1`, `2`, `3` | Arabic season numbers |
| `一`, `二`, `三` | Chinese season numbers |
| `第一季`, `第二部` | Explicit Chinese season / part numbers |
| `Season 2`, `S3` | English season numbers |
| `（２）` | Brackets and full-width digits |

Seasons resume independently. Other titles, providers and dismissed library entries are filtered; duplicate season numbers retain their titles so you can choose the right entry.

Matching is based on titles, not an official season relationship. Use **修正季信息** to correct nonstandard names manually. Failed searches can be retried without interrupting playback.

## H.264 and disk use

H.264 compatibility is the default for online and local playback. Conversion preserves source dimensions, reuses valid compatibility caches, and prepares nearby episodes serially. Initial preparation time depends on the source and computer.

Use **本剧：兼容解码 → 恢复自动** to switch one drama to automatic decoding. The choice persists, and you can switch back to H.264. Decode failure detection remains available in automatic mode.

Automatic originals and compatibility copies outside the current ±5-episode window are cleaned up. Manual downloads are retained separately. Cache sizes and cleanup controls are available in the player and settings.

## Closing and the tray

Closing the window exits fully by default. **Settings → Window and tray** can change this to minimize-to-tray. The tray menu provides show, minimize and quit actions. If the tray is unavailable, the app keeps its window accessible.

Quitting closes background search windows and waits for download writes and transcoding to finish. Use the tray's quit action or `hongguo --quit` before an external upgrade.

## Troubleshooting

- **Blurry video:** check the actual source resolution. Conversion and picture enhancement cannot recover detail missing from the source.
- **1080p source unavailable:** some episodes have a 1080p label but report smaller dimensions, such as 640×360. The app explains the mismatch and keeps your selected quality. Click **改用 App 最高可用画质** to explicitly try the highest available App stream. Missing dimensions and unsupported codecs receive separate messages; conversion cannot create a missing HD version.
- **Missing seasons:** matching depends on provider search results and consistent base titles. Retry or correct the season information manually.
- **Long conversion:** valid compatibility caches are reused. If the original codec works on your machine, choose automatic decoding for that drama.
- **Source or download errors:** check the network and proxy settings, then retry. Locked or unavailable content must be handled on the source platform.
- **Launch problems:** run `红果短剧.sh` from the bundle root. The launcher handles Chromium sandbox compatibility on some distributions.

Report reproducible problems in [Issues](https://github.com/yxt02/hongguo-drama-linux/issues), including version, distribution, steps and error messages. Remove personal information before sharing logs.

## Development and releases

The current application version is **1.74.9**, correcting the following-episode download range and source-quality diagnostics. All 46 playback regression scripts, Linux packaging and a complete in-place upgrade check passed. See the [release notes](docs/release-1.74.9-linux.md).

Build instructions, pinned media recovery and test setup are in [Linux development](docs/DEVELOPMENT.md). The Linux workflow tests and packages version changes before publishing the archive, source and checksums.

## Origin and license

This project continues development from [jackotom/hongguo-drama](https://github.com/jackotom/hongguo-drama). Earlier origins and modification notices are recorded in [NOTICE](NOTICE). Independent maintenance preserves the original license and attribution.

Code is licensed under [GPL-3.0](LICENSE). Bundled FFmpeg provenance, licensing and fixed checksums are documented in the [Linux media notice](build/ffmpeg/LINUX-NOTICE.txt) and [third-party notices](THIRD-PARTY-NOTICES.md).

This is an unofficial Linux client and is not affiliated with Hongguo.
