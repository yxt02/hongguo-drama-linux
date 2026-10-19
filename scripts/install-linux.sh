#!/bin/sh
# 红果短剧 · 一键安装到 Linux 应用菜单
#
# 用法：./install.sh
# 卸载：./install.sh --uninstall
#
# 装完后可从系统「应用程序」菜单启动，也可在终端输入 hongguo 启动。
# 不需要 root / sudo，全部装到你的家目录。
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_NAME="红果短剧"
BIN_NAME="hongguo"
OPT_DIR="${XDG_DATA_HOME:-$HOME/.local/opt}/hongguo-drama"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
DESKTOP_FILE="$DESKTOP_DIR/hongguo-drama.desktop"

if [ "${1:-}" = "--uninstall" ]; then
    rm -f "$DESKTOP_FILE" "$BIN_DIR/$BIN_NAME"
    rm -rf "$OPT_DIR"
    update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
    echo "已卸载：应用菜单项、命令 $BIN_NAME 与 $OPT_DIR 已移除。"
    exit 0
fi

if [ ! -x "$HERE/app/hongguo-downloader" ]; then
    echo "未找到 $HERE/app/hongguo-downloader" >&2
    echo "请在解压后的目录里运行本脚本，不要单独拷贝 install.sh。" >&2
    exit 1
fi

echo "安装到 $OPT_DIR ..."
rm -rf "$OPT_DIR"
mkdir -p "$OPT_DIR" "$BIN_DIR" "$DESKTOP_DIR"
cp -a "$HERE/app" "$OPT_DIR/app"
cp -a "$HERE/红果短剧.sh" "$OPT_DIR/红果短剧.sh"
cp -a "$HERE/更新红果短剧.sh" "$HERE/linux-update.cjs" "$OPT_DIR/"
chmod +x "$OPT_DIR/红果短剧.sh" "$OPT_DIR/更新红果短剧.sh"

# 桌面图标：用随包附带的 PNG，并装到安装目录内
# （不能指向 $HERE，那会在解压目录删除后失效）
if [ -f "$HERE/icon.png" ]; then
    cp -a "$HERE/icon.png" "$OPT_DIR/icon.png"
fi
ICON="$OPT_DIR/icon.png"
[ -f "$ICON" ] || ICON=hongguo-downloader

# 命令行入口
ln -sf "$OPT_DIR/红果短剧.sh" "$BIN_DIR/$BIN_NAME"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME
GenericName=Short Drama Player
Comment=发现好剧，接着上次看
Exec="$OPT_DIR/红果短剧.sh" %U
Icon=$ICON
Terminal=false
Categories=AudioVideo;Video;Player;
StartupWMClass=hongguo-downloader
Keywords=短剧;视频;播放;下载;
EOF

update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
gtk-update-icon-cache -f -t "${XDG_DATA_HOME:-$HOME/.local/share}/icons" >/dev/null 2>&1 || true

echo
echo "安装完成。"
echo "  · 应用菜单：搜索「红果短剧」"
echo "  · 终端启动：$BIN_NAME"
echo "  · 安装位置：$OPT_DIR"
echo
echo "卸载：$0 --uninstall"
