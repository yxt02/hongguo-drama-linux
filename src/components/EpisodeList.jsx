import React from 'react';
import { Check } from './icons';
import { episodePrepState } from './episodeStatus.mjs';

/**
 * 分集网格：普通选集与全屏抽屉共用同一份列表。
 *
 * 这是一个无 Hook 的纯渲染函数，由调用方直接调用（`{EpisodeList({ ... })}`），
 * 滚动定位与键盘交互由调用方管理；已下载、已看过与预缓存状态同时可辨认，
 * 当前集的选中样式优先，仅在有相关任务或结果时显示准备状态。
 */
export default function EpisodeList({
  episodes, currentIndex, onPick, onDownload, seriesId, quality,
  tasks, readyIndexes, watchedSet, onlineVid, chipRefs,
}) {
  const setChip = index => node => {
    if (node) chipRefs?.set?.(index, node);
    else chipRefs?.delete?.(index);
  };
  return (
    <div className="player-episodes" role="group" aria-label="分集列表">
      {episodes.map((ep) => {
        const isCurrent = ep.vid_index === currentIndex;
        const prep = ep.locked ? null : episodePrepState({
          episode: ep, seriesId, quality, tasks, readyIndexes,
        });
        const watched = watchedSet.has(ep.vid_index);
        const ready = prep?.phase === 'ready';
        const statusTitle = [
          ep.locked ? '需在来源平台解锁'
            : ep.status === 'completed' ? '已下载，点击播放（本地）'
            : ep.status === 'downloading' || ep.status === 'pending' ? '下载继续，点击在线播放'
            : '点击在线播放（自动缓存）· 双击加入下载',
          prep ? `${prep.label}${prep.error ? ` · ${prep.error}` : ''}` : null,
          watched ? '已看过' : null,
        ].filter(Boolean).join(' · ');
        return (
          <button
            key={ep.vid_index}
            data-episode={ep.vid_index}
            disabled={ep.locked === true}
            aria-label={`第 ${ep.vid_index} 集${watched ? '，已看过' : ''}${prep ? `，${prep.label}` : ''}`}
            aria-pressed={isCurrent}
            className={`ep-chip ep-${ep.status} ${isCurrent ? 'ep-current' : ''} ${prep ? `ep-prep ep-prep-${prep.phase}` : ''} ${watched ? 'ep-watched' : ''}`}
            onClick={() => onPick(ep.vid_index)}
            title={statusTitle}
            ref={setChip(ep.vid_index)}
            onDoubleClick={() => ep.status !== 'completed' && onDownload(ep.vid_index)}
          >
            <span className="ep-num">{ep.vid_index}</span>
            {ep.locked && <span className="ep-lock-label">锁定</span>}
            {ep.status === 'completed' && <Check size={11} className="ep-badge" aria-label="已下载" />}
            {watched && <span className="ep-watched-dot" aria-hidden="true" />}
            {ready && <span className="ep-ready-dot" aria-hidden="true" />}
            {prep && ['buffering', 'transcoding'].includes(prep.phase) && (
              <span className="ep-prep-progress" style={prep.percent != null ? { width: `${prep.percent}%` } : undefined} />
            )}
            {prep && !ready && prep.phase !== 'buffering' && prep.phase !== 'transcoding' && (
              <span className={`ep-prep-mark ${prep.phase === 'failed' ? 'ep-prep-mark-failed' : ''}`} aria-hidden="true" />
            )}
            {ep.status === 'downloading' && (
              <span className="ep-progress" style={{ width: `${ep.progress || 0}%` }} />
            )}
            {onlineVid === ep.vid && <span className="ep-online-dot" />}
          </button>
        );
      })}
    </div>
  );
}
