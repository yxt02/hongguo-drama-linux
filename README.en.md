<p align="center">
  <img src="build/icon.png" alt="Hongguo Short Drama desktop icon" width="112" height="112">
</p>

<h1 align="center">Hongguo Short Drama · Desktop</h1>

<p align="center">
  <strong>English</strong> · <a href="README.md">中文</a>
</p>

<p align="center">Find a good drama and pick up where you left off. Search, play, download, follow series and merge exports — all in one desktop app.</p>

<p align="center">
  <a href="https://github.com/yxt02/hongguo-drama-linux/releases/latest"><img alt="latest release" src="https://img.shields.io/github/v/release/yxt02/hongguo-drama-linux?style=flat-square"></a>
  <img alt="Linux x64" src="https://img.shields.io/badge/Linux-x64-555555?style=flat-square">
  <img alt="macOS 13+ / Windows x64" src="https://img.shields.io/badge/platforms-Linux__x64__%2F__macOS__13%2B__%2F__Windows__x64-55746b?style=flat-square">
  <a href="LICENSE"><img alt="GPL-3.0 license" src="https://img.shields.io/badge/license-GPL--3.0-555555?style=flat-square"></a>
</p>

<p align="center">
  <a href="#linux-quick-start"><strong>Linux Quick Start</strong></a> ·
  <a href="#features">Features</a> ·
  <a href="#build-from-source">Build from source</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="https://github.com/yxt02/hongguo-drama-linux/issues">Report an issue</a>
</p>

> **What this repo is.** A community-maintained open-source desktop client for three free
> short-drama sources (Hongguo / Xifan / Hema). It is **not** an official client and carries no
> endorsement from those platforms. No paid episode unlocking is offered; available series,
> quality and catalogue depend entirely on the source platforms.
>
> **This repository is a fork of
> [jackotom/hongguo-drama](https://github.com/jackotom/hongguo-drama)** and **only maintains Linux
> support**. Upstream ships macOS and Windows only; Linux packaging, the Chromium sandbox
> workaround and the FFmpeg assembly script live here. For Mac and Windows builds, use upstream.

---

## Linux Quick Start

**No Node.js, no system FFmpeg, no flags required.**

1. Download [`hongguo-drama-<version>-linux-x64.tar.gz`](https://github.com/yxt02/hongguo-drama-linux/releases/latest)
2. Extract it and run the launcher:

```sh
tar -xzf hongguo-drama-*-linux-x64.tar.gz
cd hongguo-linux-x64
./红果短剧.sh
```

3. Open **设置 (Settings)** and choose your download directory.

### Optional: install into the application menu

```sh
./install.sh              # adds 红果短剧 to your app menu and a `hongguo` command
./install.sh --uninstall  # removes it again
```

Installs entirely under `~/.local` — **no root / sudo needed**.

| Path | What it is |
|---|---|
| `红果短剧.sh` | **The entry point.** Double-click this or run it from a terminal. |
| `install.sh` | One-command install into the desktop menu |
| `app/` | The application itself (contains bundled FFmpeg — do not move it alone) |
| `使用说明.md` | Chinese usage notes shipped inside the bundle |

### Why a launcher script instead of running `app/hongguo-downloader` directly?

Chromium decides its sandbox mode during its own startup, **before** any application code runs —
so nothing inside the app can fix it. On Ubuntu 23.10+ AppArmor blocks the user-namespace
sandbox, and an unprivileged `chrome-sandbox` helper makes Chromium abort immediately.

The launcher detects that combination and adds `--no-sandbox` automatically. On hosts where the
sandbox works normally, it adds nothing and the default sandbox stays in force. Running the bare
binary skips that step and will fail on affected systems.

To force the sandbox off regardless:

```sh
HONGGUO_NO_SANDBOX=1 ./红果短剧.sh
```

### Getting a Linux build

```sh
git clone https://github.com/yxt02/hongguo-drama-linux.git
cd hongguo-drama-linux
npm ci
npm run package:linux      # produces dist/hongguo-drama-<version>-linux-x64.tar.gz
```

| Command | Output |
|---|---|
| `npm run start:linux` | Run from source (sandbox handled automatically) |
| `npm run package:linux` | Full bundle: `dist/hongguo-linux-x64/` + `.tar.gz` |
| `npm run build:linux:dir` | Unpacked app only: `dist/linux-unpacked/` |
| `npm run build:linux:appimage` | AppImage |

---

## Features

| I want to… | What you get |
|---|---|
| Find a drama | Unified search across Hongguo, Xifan and Hema; categories, hot rankings, share-link parsing |
| Keep watching | Online + local playback, resume, auto-next, playback speed, next-episode pre-cache |
| Download & export | Quality selection, batch download, retry, merge to MP4 |
| Manage my library | Watch history, local favourites, new-episode reminders, file & cache cleanup |
| Tune the experience | Landscape/portrait layouts, always-on-top, picture-in-picture, themes, shortcuts, video enhancement |
| Read comments | Public reviews, per-episode bullet comments (danmaku), local word filter |

<details>
<summary>Expand feature details and limits</summary>

### 1. Finding dramas: three sources, one search

- **All-sources search** — queries Hongguo, Xifan and Hema at once and labels each result;
  you can also search a single source. If one source fails, the others still show.
- **Browse catalogue** — posters, titles, episode counts, genre filters, paging and refresh;
  details list every episode with its download state.
- **Hongguo categories & hot rankings** — live-action, motion-comic and AI dramas; four ranking
  boards (overall, live-action, motion-comic, AI) with the source's own placement and heat.
- **Hongguo link / ID parsing** — paste a share link or enter a series ID to fetch details, then
  play or pick episodes to download.
- **Play straight from details** — no need to download a whole series first.
- **Flexible episode picking** — single, multi, select all, invert, clear; shortcuts for the first
  10, first 30, last 30; ranges like `1-30`, `1,3,5`, `1,5,10-20`.

| Source | Implemented | Current limits |
|---|---|---|
| Hongguo | Catalogue, genres, four hot boards, search, share-link/ID parsing, play & download available episodes | When the page offers no stream the app tries to resolve one; results still depend on what the source returns. |
| Xifan | Own catalogue, genres, paging, search, play & download unlocked episodes | Hot rankings not wired up; locked episodes are marked and skipped. |
| Hema | Official catalogue, genres, forward/back paging, search, full episode list, play & download clearly-free episodes | Paid or unclear episodes stay locked. No unlocking. |

Files are stored per source and series title. "漫画" is a still-image reading format — pick "漫剧"
for video. Streams, quality and availability depend on the platform; the app promises neither
fixed 1080p nor a complete series.

### 2. Playback: online, local and continuous

- **Local first** — downloaded episodes play from disk; undownloaded, unlocked episodes try
  online playback. Double-click an undownloaded episode to queue it.
- **Basic controls** — click to play/pause, scrub, check time, change volume, mute.
- **Automatic disk cache** — keep the current episode and up to five episodes on each side.
  Two background workers prioritize upcoming episodes. Leaving the window cancels old tasks and
  removes automatic originals and compatibility copies; manual downloads are preserved.
  Completed files are validated and reused after restart.
- **Auto-next** — on by default; skips locked episodes and chains local with online episodes.
- **Resume** — episode and position are saved per series; continue from the library or watch
  history. Switching pages in the app keeps playback and progress going.
- **0.25×–4× speed** — 16 steps. The speed readout is a button that steps +0.25×, wrapping to 1×
  after 4×. The three-dot menu picks a level directly; speed is kept across episodes.
- **Compatible playback** — compatibility mode is on by default; while playing, the app detects
  "black picture with sound" and undecodable frames and switches to H.264 conversion
  automatically — no manual toggle needed. When a source is HEVC and the machine cannot decode
  it, the app transcodes first instead of showing a black screen. Manual "转码后播放" stays
  available. Progress is shown, and you can cancel or clear the cache.
- **Failure recovery** — cancel preparation, retry the episode, reconnect the source, or try
  compatibility transcoding. Expired addresses are refreshed a limited number of times; hardware
  transcode failures fall back to software.

Automatic quality prefers App streams ranked by actual resolution, with web fallback when the
App source is unavailable. Playback, caching and new downloads share the quality choice.
Unsupported codecs are converted only when needed; software conversion and source-service
failures can still delay or prevent playback.

### 3. Picture and window

Landscape / portrait layouts with window-size memory, always-on-top, an integrated episode panel
in portrait, a full-window portrait mode (`Esc` to leave), and per-series picture modes
(fit / fill / crop / stretch) that remember playback position.

### 4. Library, history and downloads

Watch history, local favourites and new-episode reminders, a download manager with quality
selection, batch ops, retry and merge-to-MP4, plus cache cleanup.

### 5. Settings

Download directory and naming, concurrency, proxy with test, theme, shortcuts, video enhancement,
danmaku options with a local word filter, custom sources (Apple CMS V10 JSON API or direct
MP4/M3U8), and update reminders.

</details>

## Playback shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Seek back / forward 5 seconds |
| `↑` / `↓` | Previous / next episode |
| `A` | Toggle auto-next |
| `S` / `D` | Speed down / up by 0.25× |
| `F` | Toggle fullscreen |
| `Esc` | Leave portrait full-window, or close the current menu / dialog |

These are the defaults and can be rebound in Settings (single key or Shift combos, with conflict
checks and a reset). Text fields, menus and dialogs never trigger player shortcuts.

## Screenshots

![Hongguo Short Drama 1.6: hot picks and public rankings](docs/screenshots/macos-v1.6-hot.jpg)

<p align="center"><sub>macOS 1.6 release screenshot of the hot-picks page. Titles and heat values are whatever the public board showed at capture time and change as the source updates.</sub></p>

## FAQ

### Why are some episodes locked, failing to load, or in different quality?

Streams and availability are decided by the source service. Xifan locked episodes and Hema paid or
unclear episodes stay locked. The app exposes no unlocking or ad-reward API and promises nothing
about paid content. Source interfaces change — what worked before may stop working.

### Downloads fail, or the catalogue won't load

Check your network and the source platform first, then the proxy switch and mode, and lower
concurrency. Use "retry failed" or reload the catalogue. Black picture with sound now switches to
H.264 compatibility format automatically (also manually via "转码后播放").

### Where are my videos, settings and history?

Videos live in the download directory from Settings, organised by source and series title.
Settings, tasks and watch history default to:

- Linux: `~/.config/hongguo-downloader/`
- macOS: `~/Library/Application Support/hongguo-downloader/`
- Windows: `%APPDATA%\hongguo-downloader\`

If you point the app at a custom profile directory, that location wins. Removing a library entry,
deleting a task record, deleting videos and clearing the cache are different operations — read the
confirm dialog.

### Why doesn't it auto-install updates?

The app only shows an update reminder and links to the release page; downloading and installing is
your decision. Disabling reminders or auto-checks leaves older versions working, though source
service changes can still affect features.

### Does a self-built package get signing and notarisation?

No. macOS builds from source use ad-hoc signing and never request a developer certificate or
notarisation. Those are separate release steps for the official Mac packages. Windows packages are
currently unsigned. There is no need to disable Gatekeeper system-wide for this app.

### How do I report a problem?

Open an [Issue](https://github.com/yxt02/hongguo-drama-linux/issues) with the app version, OS and
CPU, source, steps to reproduce and the error text. Strip account details, cookies, proxy
credentials and personal file paths from screenshots and logs.

## Versions and verification

The current Linux release is **1.74.0** (`1.74.0` in source); upstream Mac/Windows builds remain at
1.73. Package and verification records live
on the [releases page](https://github.com/yxt02/hongguo-drama-linux/releases).

**Linux verification** — the bundled 57-check suite passes on Ubuntu 24.04 x86-64 with the bundled
FFmpeg, covering storage atomicity, window layout, stealth window, single-instance, download queue
and retry, quality selection, HLS remux, merge and cancellation, playback controls / speed /
resume / shortcuts, decode-failure auto-repair (black screen with sound → H.264), all three
sources, source recovery and routing, danmaku, watch history, web media guarding and share-link
security. The packaged bundle was smoke-tested end to end: extract →
`./红果短剧.sh` (no flags) → live catalogue loads and search returns real results.

**Not covered** — physical Windows 11, all GPUs, physical Intel Macs, clean Gatekeeper environments,
real-network danmaku on Windows and long-duration playback. Cloud checks and notarisation do not
replace testing on every device and network.

<details>
<summary>Release history</summary>

| Version | Highlights |
|---|---|
| **1.74.0 (Linux)** | Disk cache within ±5 episodes, high-quality source selection, validated caches and HLS conversion fixes |
| 1.73.1 (Linux) | Auto-repair black screen with sound (H.264 fallback); transcode-first for undecodable HEVC |
| 1.73 | Automatic transient download retries (10/30/60s) |
| 1.72 | Auto-hide landscape controls; safer media-connection reuse |
| 1.71 | Library download hint placement; hot-picks layout |
| 1.70 | Download recovery, random picks, custom playback sources |
| 1.60 | Download quality selection, per-episode danmaku, playback/download recovery |
| 1.50 | Source compatibility, playback failure recovery |
| 1.40 | Merge-candidate fixes |
| 1.30 | Themes, shortcuts, stealth window, public reviews, favourites, video enhancement |
| 1.20 | Per-series picture mode, update notices |

See the upstream project for the full notes.

</details>

## Build from source

The app is **Electron + React + Node.js**. You need Node.js **≥ 22.12**, npm, `tar`, `ldd`, `git`
and `curl`. The build scripts do not install system dependencies for you.

### Linux

```sh
git clone https://github.com/yxt02/hongguo-drama-linux.git
cd hongguo-drama-linux
npm ci
npm run package:linux
```

`npm run package:linux` validates or fetches the bundled FFmpeg, builds the renderer, packages
Electron, then assembles the launcher + installer + `tar.gz`.

**FFmpeg on Linux** lives in `build/ffmpeg/linux-x64/` and comes from **BtbN FFmpeg-Builds**
`n8.1 linux64-gpl` (ships libx264 / libx265), verified by `scripts/setup-ffmpeg-linux.js`:

- archive and binary SHA-256 recorded in `build/ffmpeg/linux-x64/build-manifest.json`;
- ELF magic and x86-64 machine type checked;
- `ldd` confirms only system libraries (glibc / libgcc) — a fully static build is also accepted.

Reuse a previously downloaded archive with `FFMPEG_LINUX_ARCHIVE=/path/to.tar.xz`.

> **Why not a smaller fully-static build?** The `johnvansickle.com` 7.0.2 static build is roughly
> half the size but **segfaults on the app's AES-128 HLS remux path** — a core capability. Size was
> traded for correctness. See [`build/ffmpeg/LINUX-NOTICE.txt`](build/ffmpeg/LINUX-NOTICE.txt) for
> the exact reproduction command; please smoke-test it before swapping in any other build.

[FFmpeg provenance, licence and verification](build/ffmpeg/LINUX-NOTICE.txt) ·
[GPLv3](build/ffmpeg/COPYING.GPLv3) · [LGPLv2.1](build/ffmpeg/COPYING.LGPLv2.1)

FFmpeg binaries are not committed to Git. When redistributing a build, provide the corresponding
source as GPL requires.

**Run the check suite on Linux:**

```sh
export FFMPEG=$PWD/build/ffmpeg/linux-x64/ffmpeg
export FFPROBE=$PWD/build/ffmpeg/linux-x64/ffprobe
export HONGGUO_FFMPEG=$FFMPEG HONGGUO_FFPROBE=$FFPROBE
node scripts/check-merge.cjs
```

Platform-specific checks (`check-ffmpeg-mac`, `check-macos`, `check-windows-release`) print `SKIP`
and exit 0 on a non-matching platform.

### macOS

```sh
npm ci
npm run build:mac
```

Requires Node.js ≥ 22.12, npm, Apple Command Line Tools, `pkg-config`, `make`, `git`, `curl`.
Mac builds compile FFmpeg/x264 from pinned, SHA-256-verified source; see
[MACOS-NOTICE.txt](build/ffmpeg/MACOS-NOTICE.txt). Produces `dist/mac-arm64/红果短剧.app` and the DMG.

### Windows

Build the portable EXE on Windows x64 with matching FFmpeg/FFprobe. Full dependencies, media-tool
source and commands are in [docs/RELEASING.md](docs/RELEASING.md). Self-built packages are not
code-signed.

## Upstream, licence and boundary

This project continues upstream's **[GPL-3.0](LICENSE)** licence and keeps its modification and
provenance notices. See [NOTICE](NOTICE) and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

**Upstream:** [jackotom/hongguo-drama](https://github.com/jackotom/hongguo-drama) — macOS and
Windows builds. **This repo:** the Linux port.

The software is offered for learning and research. Do not impersonate the official apps or charge
for access under a false authorisation. Source-available rights and obligations are governed by
GPLv3; that invitation is not a licence from the platforms or copyright holders, nor a promise of
immunity.

**Boundaries the app does not cross:** no DRM, no live streams, no paid episode unlocking. HLS
handles only public plain and AES-128 playlists. Details: [docs/LINUX-PORT.md](docs/LINUX-PORT.md).
