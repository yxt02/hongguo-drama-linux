#!/bin/sh
# 首次接入一键更新：使用此解压目录直接升级旧安装，无需卸载或再次下载。
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$(readlink -f "$0")")" && pwd)
TARGET="${HONGGUO_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/opt}/hongguo-drama}"
if [ ! -d "$TARGET/app" ]; then
    echo "未找到现有安装：$TARGET" >&2
    echo "可设置 HONGGUO_INSTALL_DIR 指向旧安装目录，或运行 install.sh 首次安装。" >&2
    exit 1
fi
exec env ELECTRON_RUN_AS_NODE=1 "$HERE/app/hongguo-downloader" "$HERE/linux-update.cjs" --target "$TARGET" --bundle "$HERE" --restart
