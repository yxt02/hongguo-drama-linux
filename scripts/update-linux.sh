#!/bin/sh
# 独立更新器：退出应用后运行；使用随应用提供的 Node 运行时。
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$(readlink -f "$0")")" && pwd)
exec env ELECTRON_RUN_AS_NODE=1 "$HERE/app/hongguo-downloader" "$HERE/linux-update.cjs" --target "$HERE" "$@"
