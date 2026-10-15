#!/bin/sh
# 红果短剧 · Linux 启动器
#
# 这是你唯一需要运行的东西：双击它，或在终端执行 ./红果短剧.sh
#
# 为什么需要启动器而不是直接跑 app/hongguo-downloader：
# Chromium 在自身初始化阶段就会决定沙箱模式，早于应用代码，所以应用内
# 无法补救。Ubuntu 23.10+ 的 AppArmor 会阻止用户命名空间沙箱，而未提权
# 的 chrome-sandbox 又会让 Chromium 直接中止。本脚本检测到该组合时补上
# --no-sandbox，其余情况不加，保持默认沙箱。
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$(readlink -f "$0")")" && pwd)
BIN="$HERE/app/hongguo-downloader"

if [ ! -x "$BIN" ]; then
    echo "找不到可执行文件：$BIN" >&2
    echo "请确认 app/ 目录与本脚本在同一层。" >&2
    exit 1
fi

needs_no_sandbox() {
    [ "${HONGGUO_NO_SANDBOX:-}" = "1" ] && return 0

    # SUID chrome-sandbox 可用则保持默认沙箱
    helper="$HERE/app/chrome-sandbox"
    if [ -u "$helper" ] && [ "$(stat -c %u "$helper" 2>/dev/null || echo 1)" = "0" ]; then
        return 1
    fi

    # 非特权用户命名空间可用、且未被 AppArmor 限制时，Chromium 可用命名空间沙箱
    userns=$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)
    maxns=$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 1)
    aar=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)

    [ "$userns" = "1" ] || return 0
    [ "$maxns" -gt 0 ] 2>/dev/null || return 0
    [ "$aar" = "1" ] && return 0
    return 1
}

if needs_no_sandbox; then
    exec "$BIN" --no-sandbox "$@"
fi

exec "$BIN" "$@"
