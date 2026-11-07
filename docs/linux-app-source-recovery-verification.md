# Linux App 取源恢复验证

2026 年 11 月 7 日按 [docs/linux-app-source-recovery-plan.md](linux-app-source-recovery-plan.md) 实现并验证。模拟回归全部通过；实网试播通过连播验证。

## 模拟回归

`npm run test:playback` 57 项检查全部通过。跳过的 `check-hls-media.cjs` 另用随包 FFmpeg 与真实媒体样本单独运行通过。`npm run build:react` 构建通过。

| 验收项 | 覆盖检查 | 结果 |
| --- | --- | --- |
| 备用入口成功且零额外注册 | `check-app-source-recovery.cjs`：主入口空响应后同会话备用入口成功，`renewals === 0` | 通过 |
| 主备均空后快速更新一次 | 同上：单轮最多三次模型请求，前台角色只调用一次 `requestFastDeviceUpdate` | 通过 |
| 10 秒冷却内任务合并 | `playback-device.test.cjs`：并发快速更新共享一次注册；间隔未满时可等待剩余短间隔 | 通过 |
| 更新失败后 60 秒退避 | 同上：失败后退避期内拒绝并给出可重试时间，期满后恢复 | 通过 |
| 新会话仍为空时 60 秒退避 | 同上 + `check-app-source-recovery.cjs`：`pauseFastDeviceUpdates` 只在更新成功仍为空时触发一次 | 通过 |
| 普通与快速更新共享注册 | `playback-device.test.cjs`：在途快速更新被普通更新直接共享，不再各自注册 | 通过 |
| 切走后不再更新会话 | `check-media-recovery.cjs` + `check-app-source-recovery.cjs`：取消信号传入取源轮次，等待中止且不发第三次请求 | 通过 |
| 切到已耗尽的预取不重发 | `check-player-fallback.cjs`：呈现失败与重试入口；手动重试才发起下一轮 | 通过 |
| 补充请求空响应独立提示 | `check-app-source-recovery.cjs` / `check-source-recovery.cjs`：补充播放信息空响应与主备均空分别提示 | 通过 |
| 主备均空结束外围本轮 | `check-media-recovery.cjs`：收到 `exhausted` 结果后不再重走三次模型请求 | 通过 |
| 取源角色按播放窗口判定 | 同上：当前集 `foreground`、紧邻下一集 `next`、更远预取 `distant` | 通过 |
| 预取提升与缓存复用 | 同上 + `check-next-cache.cjs` / `check-online-disk-lifecycle.cjs`：提升复用同一在途任务并接管恢复阶段回报 | 通过 |

提示语按实际执行结果区分：会话已更新（「已更新会话后仍返回空响应」）、仍在冷却（含约多少秒后可再试）、补充播放信息返回空响应。取源日志记录阶段、主备入口标签、响应大小、耗时、是否实际更新会话和结果。

## 实网试播

隔离配置下原速连续播完第 178–180 集：第 179 集靠备用入口恢复，第 180 集靠更新会话恢复，两次恢复都在切集前完成预取；切集到首个解码帧分别为 64 毫秒和 35 毫秒。

试播后补做的四项边界测试曾复现问题并已修复回归：

| 边界场景 | 修复 | 回归 |
| --- | --- | --- |
| 新会话仍返回空正文后 10 秒又注册一次 | 新会话重取仍为空时调用 `pauseFastDeviceUpdates`，从失败时起退避 60 秒 | `playback-device.test.cjs`、`check-app-source-recovery.cjs` |
| 普通更新与快速更新同时触发各自注册 | 快速更新门槛同步生效；普通更新在途时直接共享 `registerTask`，不再自行注册 | `playback-device.test.cjs` |
| 切走后旧任务在冷却结束后仍注册 | 任务取消信号经 `withMediaRecovery` → `fetchPlayUrlSingle` → 取源轮次 `AbortSignal.any` 传入，冷却等待随取消中止 | `check-media-recovery.cjs`、`check-app-source-recovery.cjs` |
| 切到已耗尽恢复次数的预取立即重发取源 | 预取结果为 `exhausted` 终态时直接呈现失败与重试入口，手动重试才进入下一轮 | `check-player-fallback.cjs` |
