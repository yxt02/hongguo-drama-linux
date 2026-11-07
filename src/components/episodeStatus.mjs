// 选集状态、下一集摘要与预缓存档位的纯函数：普通选集与全屏抽屉共用。
export const PREFETCH_LEVELS = Object.freeze([
  { value: 'next2', label: '后两集' },
  { value: 'next', label: '仅下一集' },
  { value: 'off', label: '关闭' },
]);

export function normalizePrefetchLevel(value) {
  return ['off', 'next', 'next2'].includes(value) ? value : 'next2';
}

// 档位控制主动准备多少集；关闭时点播或切集仍按需准备。
export function prefetchCount(level) {
  return level === 'next2' ? 2 : level === 'next' ? 1 : 0;
}

// 与设计稿一致的任务阶段文案。
export const TASK_PHASE_LABELS = Object.freeze({
  queued: '待准备',
  sourcing: '正在取源',
  reconnecting: '正在重连',
  buffering: '正在缓冲',
  transcoding: '正在转码',
  failed: '准备失败',
});

const PHASE_FROM_STAGE = Object.freeze({ preparing: 'sourcing', reconnecting: 'reconnecting', decrypting: 'buffering', downloading: 'buffering' });

// 主进程 online-play-progress 的阶段映射为选集任务阶段。
export function taskPhaseFromProgressStage(stage) {
  return PHASE_FROM_STAGE[stage] || 'sourcing';
}

export function taskView(task) {
  if (!task) return null;
  const phase = TASK_PHASE_LABELS[task.phase] ? task.phase : 'queued';
  return {
    phase,
    label: TASK_PHASE_LABELS[phase],
    percent: Number.isFinite(task.percent) ? task.percent : null,
    error: typeof task.error === 'string' ? task.error : '',
  };
}

// 连播规则：跳过锁定集，取当前集之后第一个可播集。
export function nextPlayableEpisode(episodes, fromIndex) {
  const idx = (episodes || []).findIndex(e => e.vid_index === fromIndex);
  if (idx === -1) return null;
  return episodes.slice(idx + 1).find(ep => !ep.locked) || null;
}

// 「选集」标题右侧的一行摘要。当前目录没有后续可播集时明确说明。
export function nextEpisodeSummary({ episodes, currentIndex, ...status }) {
  const next = nextPlayableEpisode(episodes, currentIndex);
  if (!next) return { text: '暂无下一可播集', next: null };
  const task = episodePrepState({ ...status, episode: next });
  const percent = task?.percent == null ? '' : ` ${task.percent}%`;
  return { text: `下一集 · 第 ${next.vid_index} 集 · ${task?.label || '播放时准备'}${percent}`, next, task };
}

// 分集按钮上的准备状态：仅在有相关任务或结果时显示，长列表保持简洁。
export function episodePrepState({ episode, seriesId, quality, tasks = {}, readyIndexes }) {
  const task = tasks[episode.vid_index];
  const view = task?.seriesId === String(seriesId) && task.quality === quality && task.vid === String(episode.vid) ? taskView(task) : null;
  if (view && view.phase !== 'failed') return view;
  if (readyIndexes?.has(episode.vid_index)) return { phase: 'ready', label: '已就绪' };
  return view;
}

// 「跳到第 N 集」：输入有效集数后仅定位，由用户确认播放；锁定集可定位并显示锁定状态。
export function parseEpisodeJump(value, episodes) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,5}$/.test(text)) return { error: '请输入 1-5 位集号数字' };
  const index = Number(text);
  if (index < 1) return { error: '集号需从 1 开始' };
  const listed = (episodes || []).some(e => e.vid_index === index);
  if (!listed) return { index, missing: true, error: `本剧没有第 ${index} 集` };
  return { index, missing: false };
}
