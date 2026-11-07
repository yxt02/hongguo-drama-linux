import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import useDialogKeyboard from './useDialogKeyboard';
import SeasonSwitcher from './SeasonSwitcher';
import PlayerControls from './PlayerControls';
import CommentDanmaku, { useDanmaku } from './CommentDanmaku';
import OfficialDanmaku from './OfficialDanmaku';
import EpisodeList from './EpisodeList';
import { PREFETCH_LEVELS, normalizePrefetchLevel, prefetchCount, taskPhaseFromProgressStage, nextPlayableEpisode, nextEpisodeSummary, parseEpisodeJump } from './episodeStatus.mjs';
import { SHORTCUT_ACTIONS, formatShortcut, ignoresPlaybackShortcut, readShortcuts, shortcutKey, subscribeShortcuts } from '../shortcuts';
import { SAMPLE_INTERVAL_MS, createDecodeGuard, createFrameDecodeGuard, createFrameSampler, isHevcCodec, probeHevcSupport, shouldTranscodeFirst, seriesNeedsCompat, rememberSeriesCompat } from '../decodeWatch';
import CommunityPanel from './CommunityPanel';
import VideoEnhancement, { useVideoEnhancement } from './VideoEnhancement';
import './Player.css';
import { Play, Film, Download, Check, RefreshCw, Layers, X, Trash2, ChevronDown, Zap } from './icons';

const localMediaKey = (seriesId, episode) => JSON.stringify([seriesId, episode?.vid, episode?.fileUrl, episode?.fileSize, episode?.taskId]);
const cannotPlayHevc = codec => isHevcCodec(codec) && shouldTranscodeFirst(codec, probeHevcSupport(
  () => document.createElement('video'),
  typeof MediaSource !== 'undefined' ? MediaSource : null
));
const cancelPrefetchCompat = ({ requestId, seriesId, vidIndex, quality }) =>
  window.electronAPI.cancelTranscodeForPlayback?.({ requestId: requestId + ':compat', seriesId, vidIndex, quality }).catch(() => {});

/**
 * Player —— 内置播放器
 *
 * 设计要点：
 *  - 直接播本地 file:// 文件（实测支持 seek），无需流服务器
 *  - 「边下边看」：下一集若还在下载，显示等待态并轮询，下完自动接上
 *  - 断点续播：按 series_id 记住看到第几集、第几秒
 */
function Player({ target, onNavigate, onSeriesSelected, active = true, portrait = false, actionsHidden = false, episodesOpen = false, setEpisodesOpen }) {
  const enhancement = useVideoEnhancement();
  const [shortcuts, setShortcuts] = useState(readShortcuts);
  const [showDanmakuControls, setShowDanmakuControls] = useState(false);
  useEffect(() => subscribeShortcuts(setShortcuts), []);
  const [portraitActionsOpen, setPortraitActionsOpen] = useState(false);
  const [windowFill, setWindowFill] = useState(false);
  useEffect(() => { if (!portrait || !active) setWindowFill(false); }, [portrait, active]);
  const [seriesList, setSeriesList] = useState([]);
  const [activeSeriesId, setActiveSeriesId] = useState('');
  const [pictureChoice, setPictureChoice] = useState(null);
  const savedPictureMode = useMemo(() => {
    try { return window.localStorage.getItem(`hongguo:picture-mode:${activeSeriesId}`) === 'width' ? 'width' : 'fit'; }
    catch { return 'fit'; }
  }, [activeSeriesId]);
  const pictureMode = pictureChoice?.seriesId === activeSeriesId ? pictureChoice.mode : savedPictureMode;
  const changePictureMode = mode => {
    if (!activeSeriesId || !['fit', 'width'].includes(mode)) return;
    setPictureChoice({ seriesId: activeSeriesId, mode });
    try { window.localStorage.setItem(`hongguo:picture-mode:${activeSeriesId}`, mode); }
    catch { showToast('画面模式已切换，但未能保存；下次打开可能恢复默认'); }
  };
  const [detail, setDetail] = useState(null); // { series_title, episodes: [...], total, completedCount }
  const [currentIndex, setCurrentIndex] = useState(1);
  const [autoNext, setAutoNext] = useState(true);
  const [autoAdvancing, setAutoAdvancing] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [downloadQuality, setDownloadQuality] = useState('auto');
  const [qualityLoading, setQualityLoading] = useState(true);
  const [downloadingFollowing, setDownloadingFollowing] = useState(false);
  const downloadingFollowingRef = useRef(false);
  const [waitingFor, setWaitingFor] = useState(null); // 正在等待下载的集号
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);   // 剧集选择面板
  const [pickerQuery, setPickerQuery] = useState('');
  const [dismissedCount, setDismissedCount] = useState(0);

  // 在线播放（按需流式或临时准备后缓存）
  const [onlineVid, setOnlineVid] = useState(null);
  const [onlineUrl, setOnlineUrl] = useState('');
  const [mediaBuffering, setMediaBuffering] = useState(false);
  const [onlineProgress, setOnlineProgress] = useState(null); // {percent, phase}
  const [cacheInfo, setCacheInfo] = useState({ count: 0, bytes: 0 });
  const [sourceInfo, setSourceInfo] = useState(null);
  const [downloadedMap, setDownloadedMap] = useState({}); // series_id -> {completed,total}
  const [storageMap, setStorageMap] = useState({});       // series_id -> {files,bytes}
  const [storageTotal, setStorageTotal] = useState({ files: 0, bytes: 0 });
  const [confirmAsk, setConfirmAsk] = useState(null);     // {title, message, danger, onOk}

  // 兼容模式：本机解不了 HEVC 时转码为 H.264
  const linuxPlayback = window.electronAPI.platform === 'linux';
  const [seriesCompat, setSeriesCompat] = useState(!linuxPlayback);
  const defaultCompatRef = useRef(!linuxPlayback);
  const seriesCompatRef = useRef({ seriesId: '', enabled: false });
  const [compatMap, setCompatMap] = useState({});         // vidIndex -> { url, original }
  const [compatProgress, setCompatProgress] = useState(null); // {vidIndex, percent}
  const [compatError, setCompatError] = useState('');
  const [decodeFailed, setDecodeFailed] = useState(false);    // 当前集解不出画面
  const [playbackError, setPlaybackError] = useState('');
  const [playbackVersion, setPlaybackVersion] = useState(0);
  const [compatCache, setCompatCache] = useState({ files: 0, bytes: 0 });
  const [mergeAsk, setMergeAsk] = useState(false);            // 合并格式选择

  // 预缓存真实状态：按集号关联实际任务（后台/前台共用），切剧、换画质后重新判定。
  const [taskStates, setTaskStates] = useState({});           // vidIndex -> { seriesId, quality, vid, phase, percent, requestId, error }
  const taskRef = useRef({});
  const [episodeCache, setEpisodeCache] = useState(null);
  const [prefetchLevel, setPrefetchLevel] = useState('next2');
  // 已看过标记：由真实播放进度产生，与每季续播位置分别读取。
  const [watchedSet, setWatchedSet] = useState(() => new Set());
  // 跨季续播与选集定位
  const [seasonNext, setSeasonNext] = useState(null);         // { seriesId, unique, candidates, currentNumber }
  const [seasonEndPrompt, setSeasonEndPrompt] = useState(false);
  const [jumpQuery, setJumpQuery] = useState('');
  const [jumpError, setJumpError] = useState('');
  // 应用内全屏与舞台抽屉（选集 / 信息）
  const [appFill, setAppFill] = useState(false);
  const [stageDrawer, setStageDrawer] = useState(null);       // 'episodes' | 'info' | null
  const [drawerPlacement, setDrawerPlacement] = useState('overlay');
  const appFillRef = useRef(false);
  appFillRef.current = appFill;
  const episodesBtnRef = useRef(null);
  const infoBtnRef = useRef(null);
  const seasonSwitcherRef = useRef(null);
  const drawerSeasonRef = useRef(null);
  const panelChipRefs = useRef(new Map());
  const drawerChipRefs = useRef(new Map());

  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const playbackRateRef = useRef(1);
  const toastTimer = useRef(null);
  const pendingSeekRef = useRef(0); // 切集后要跳转的秒数
  const pendingAutoplayRef = useRef(true);
  const lastSavedRef = useRef(0);
  const stateRef = useRef({ currentIndex, autoNext, activeSeriesId });
  stateRef.current = { currentIndex, autoNext, activeSeriesId, waitingFor, downloadQuality, qualityLoading };
  const selectedSeriesRef = useRef('');
  const selectionVersion = useRef(0);
  const onlineRequestRef = useRef(null);
  const prefetchRef = useRef(new Map());
  const prefetchQueueRef = useRef([]);
  const prefetchActiveRef = useRef(0);
  const prefetchWindowRef = useRef('');
  const mediaVersion = useRef(0);
  const compatRequestRef = useRef(null);
  const decodeWatchRef = useRef(null); // { timer, guard, sampler } —— 播放中解码守卫
  const qualityChangeRef = useRef(0);
  const mediaQualityRef = useRef('auto');
  const mediaCodecRef = useRef('');   // 当前片源编码；未知时按可能不兼容处理
  const pendingTargetRef = useRef(null);
  const loadedMediaRef = useRef(null);
  const autoCompatAttemptRef = useRef(null);
  const reconnectAttemptRef = useRef(null);
  const onlineSourceRef = useRef(null);
  const lastVideoSrcRef = useRef('');
  const lastLoadRef = useRef(null);
  const fallbackRef = useRef(null);
  const fallbackAttemptRef = useRef(null);
  const rejectedLocalRef = useRef(null);
  const levelRef = useRef('next2');
  const episodesRef = useRef([]);
  const episodeCacheRevision = useRef(0);

  // ===== 预缓存任务状态：来自实际任务，按剧、集、画质和请求身份关联 =====
  const syncTasks = useCallback((next) => { taskRef.current = next || {}; setTaskStates(taskRef.current); }, []);
  const patchTask = useCallback((vidIndex, requestId, patch) => {
    const base = taskRef.current[vidIndex];
    if (!base || base.requestId !== requestId) return;
    const next = { ...taskRef.current };
    if (patch) next[vidIndex] = { ...base, ...patch };
    else delete next[vidIndex];
    syncTasks(next);
  }, [syncTasks]);

  // 只有收到当前片源的 metadata 后才保存，避免旧元素的 pause 覆盖新集断点。
  const persistPosition = useCallback((force = false) => {
    const media = loadedMediaRef.current;
    if (!media?.played || media.version !== mediaVersion.current) return;
    const seconds = media.element.currentTime;
    if (!Number.isFinite(seconds) || seconds < 0) return;
    if (!force && Math.abs(seconds - lastSavedRef.current) < 3) return;
    lastSavedRef.current = seconds;
    const watched = media.watched === true;
    window.electronAPI.savePlaybackPosition(media.seriesId, media.vidIndex, seconds, watched).then(result => {
      if (result?.success && watched && selectedSeriesRef.current === String(media.seriesId)) {
        setWatchedSet(prev => prev.has(media.vidIndex) ? prev : new Set([...prev, media.vidIndex]));
      }
    }).catch(() => {});
  }, []);

  const currentPosition = useCallback(() => {
    const media = loadedMediaRef.current;
    return media?.version === mediaVersion.current && Number.isFinite(media.element.currentTime)
      ? media.element.currentTime : pendingSeekRef.current;
  }, []);

  const releaseOnline = useCallback(() => {
    const request = onlineRequestRef.current;
    onlineRequestRef.current = null;
    if (!request) return;
    if (request.promoted && request.compatStarted) cancelPrefetchCompat(request);
    window.electronAPI.releaseOnlinePlay({ requestId: request.requestId, streamId: request.streamId }).catch(() => {});
  }, []);

  const releasePrefetch = useCallback((keep = null) => {
    prefetchWindowRef.current = '';
    prefetchQueueRef.current = [];
    for (const request of prefetchRef.current.values()) {
      if (request === keep) continue;
      prefetchRef.current.delete(request.key);
      window.electronAPI.releaseOnlinePlay({ requestId: request.requestId }).catch(() => {});
      if (request.compatStarted) cancelPrefetchCompat(request);
    }
    const task = keep && taskRef.current[keep.vidIndex];
    syncTasks(task?.requestId === keep?.requestId && task ? { [keep.vidIndex]: task } : {});
  }, [syncTasks]);

  const cancelCompat = useCallback(() => {
    const request = compatRequestRef.current;
    compatRequestRef.current = null;
    if (request && window.electronAPI.cancelTranscodeForPlayback) {
      window.electronAPI.cancelTranscodeForPlayback({ ...request }).catch(() => {});
    }
  }, []);

  // 停掉播放中的解码守卫（切集、转码、卸载时调用）。
  const stopDecodeWatch = useCallback(() => {
    const watch = decodeWatchRef.current;
    decodeWatchRef.current = null;
    if (watch) {
      clearInterval(watch.timer);
      if (watch.frameId != null) watch.video.cancelVideoFrameCallback?.(watch.frameId);
    }
  }, []);

  const resetPlayback = useCallback((autoplay = true) => {
    fallbackRef.current = null;
    pendingAutoplayRef.current = autoplay;
    setAutoAdvancing(false);
    persistPosition(true);
    const previous = loadedMediaRef.current;
    loadedMediaRef.current = null;
    previous?.element.pause();
    mediaVersion.current++;
    setPlaybackVersion(mediaVersion.current);
    autoCompatAttemptRef.current = null;
    mediaCodecRef.current = '';
    stopDecodeWatch();
    cancelCompat();
    releaseOnline();
    setSourceInfo(null);
    setOnlineVid(null);
    setOnlineUrl('');
    setOnlineProgress(null);
    setMediaBuffering(false);
    setCompatProgress(null);
    setDecodeFailed(false);
    setCompatError('');
    setPlaybackError('');
    lastSavedRef.current = 0;
  }, [persistPosition, releaseOnline, cancelCompat, stopDecodeWatch]);

  const stopPlayback = (message = '播放已停止，可重试本集继续观看') => {
    const seekTo = currentPosition();
    releasePrefetch();
    resetPlayback();
    pendingSeekRef.current = seekTo;
    setWaitingFor(null);
    setPlaybackError(message);
  };

  useEffect(() => () => {
    persistPosition(true);
    selectionVersion.current++;
    mediaVersion.current++;
    selectedSeriesRef.current = '';
    cancelCompat();
    releaseOnline();
    releasePrefetch();
    stopDecodeWatch();
    clearTimeout(toastTimer.current);
  }, [persistPosition, releaseOnline, cancelCompat, releasePrefetch, stopDecodeWatch]);

  const showToast = useCallback((text) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const changePlaybackRate = useCallback((value, notify = true) => {
    const rate = Number(value);
    if (!Number.isFinite(rate)) return;
    const next = Math.max(0.25, Math.min(4, rate));
    playbackRateRef.current = next;
    setPlaybackRate(next);
    const v = videoRef.current;
    if (v) {
      v.defaultPlaybackRate = next;
      v.playbackRate = next;
    }
    if (notify) showToast(`播放速度 ${next}×`);
  }, [showToast]);

  // 载入已登记的剧集列表
  const loadSeriesList = useCallback(async () => {
    const list = (await window.electronAPI.getSeriesList()) || [];
    setSeriesList(list);
    return list;
  }, []);

  // 载入某剧的分集状态
  const loadDetail = useCallback(async (seriesId) => {
    if (!seriesId) return null;
    const version = selectionVersion.current;
    const res = await window.electronAPI.getSeriesEpisodes(seriesId);
    if (version !== selectionVersion.current || String(seriesId) !== selectedSeriesRef.current) return null;
    if (!res || !res.success) return null;
    setDetail(res.data);
    return res.data;
  }, []);

  const usableLocal = useCallback((ep, seriesId) => stateRef.current.downloadQuality === 'auto' && ep && !ep.locked && ep.status === 'completed' && ep.fileUrl
    && localMediaKey(seriesId, ep) !== rejectedLocalRef.current, []);

  const resumeLocal = useCallback((ep, seekTo, autoplay = true) => {
    if (linuxPlayback) releasePrefetch();
    resetPlayback(autoplay);
    onlineSourceRef.current = null;
    mediaQualityRef.current = stateRef.current.downloadQuality;
    setCompatMap(prev => { const next = { ...prev }; delete next[ep.vid_index]; return next; });
    pendingSeekRef.current = seekTo;
    setCurrentIndex(ep.vid_index);
    setWaitingFor(null);
  }, [resetPlayback, linuxPlayback, releasePrefetch]);

  const isCurrentFallback = useCallback(intent => fallbackRef.current === intent
    && intent.selection === selectionVersion.current && intent.media === mediaVersion.current
    && intent.seriesId === selectedSeriesRef.current && intent.vidIndex === stateRef.current.currentIndex, []);

  const recoverOnlineFailure = useCallback(async (ep, message) => {
    const seekTo = currentPosition();
    const autoplay = loadedMediaRef.current ? !loadedMediaRef.current.element.paused : pendingAutoplayRef.current;
    if (linuxPlayback) releasePrefetch();
    resetPlayback(autoplay);
    pendingSeekRef.current = seekTo;
    const intent = { seriesId: selectedSeriesRef.current, vidIndex: ep.vid_index, vid: ep.vid,
      selection: selectionVersion.current, media: mediaVersion.current, seekTo, autoplay, submitting: true };
    fallbackRef.current = intent;
    setPlaybackError(message);
    try {
      const data = await loadDetail(intent.seriesId);
      if (!isCurrentFallback(intent)) return;
      const latest = data?.episodes.find(item => item.vid_index === intent.vidIndex && item.vid === intent.vid);
      if (!latest || latest.locked) throw new Error(latest?.locked ? '该集已锁定，请在来源平台确认' : '无法刷新本集状态，请重试');
      if (usableLocal(latest, intent.seriesId)) { resumeLocal(latest, intent.seekTo, intent.autoplay); return; }
      // No independent local file is available. Keep the original source/transfer
      // failure instead of inventing a second cache failure for the same attempt.
      intent.submitting = false;
      setWaitingFor(null);
    } catch (error) {
      if (!isCurrentFallback(intent)) return;
      intent.submitting = false;
      setWaitingFor(null); setPlaybackError(`${message}；${error.message}`);
    }
  }, [currentPosition, resetPlayback, loadDetail, isCurrentFallback, usableLocal, resumeLocal, linuxPlayback, releasePrefetch]);

  const refreshCacheInfo = useCallback(async () => {
    try {
      const res = await window.electronAPI.onlineCacheStatus();
      if (res && res.success) setCacheInfo({ count: res.count, bytes: res.bytes });
      const dc = await window.electronAPI.dismissedCount();
      setDismissedCount(dc || 0);
      const st = await window.electronAPI.getStorageUsage();
      if (st && st.success) {
        const map = {};
        for (const s of st.series) map[String(s.series_id)] = { files: s.files, bytes: s.bytes, merged: s.merged };
        setStorageMap(map);
        setStorageTotal({ files: st.totalFiles, bytes: st.totalBytes });
      }
    } catch (_) {}
  }, []);

  // 分集就绪状态：向主进程查询当前清晰度下已校验的播放缓存与兼容文件。
  const refreshEpisodeCache = useCallback(async () => {
    const revision = ++episodeCacheRevision.current;
    const seriesId = String(selectedSeriesRef.current || '');
    const list = episodesRef.current || [];
    if (!seriesId || !list.length) return;
    const quality = stateRef.current.downloadQuality || 'auto';
    const index = stateRef.current.currentIndex;
    const episodes = list.filter(e => e.vid && !e.locked && Math.abs(e.vid_index - index) <= 5)
      .map(e => ({ vid: String(e.vid), vidIndex: e.vid_index }));
    try {
      const res = await window.electronAPI.episodeCacheStatus?.({ seriesId, quality, episodes });
      if (revision !== episodeCacheRevision.current || seriesId !== selectedSeriesRef.current
        || quality !== stateRef.current.downloadQuality || index !== stateRef.current.currentIndex) return;
      setEpisodeCache(res?.success ? { seriesId, quality, items: res.items || {} } : null);
    } catch (_) {}
  }, []);
  const refreshEpisodeCacheRef = useRef(refreshEpisodeCache);
  refreshEpisodeCacheRef.current = refreshEpisodeCache;

  const fmtSize = (b) => {
    if (!b || b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
  };

  useEffect(() => {
    refreshCacheInfo();
    window.electronAPI.compatCacheStatus().then((r) => {
      if (r && r.success) setCompatCache({ files: r.files, bytes: r.bytes });
    });
  }, [refreshCacheInfo]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setQualityLoading(true);
    window.electronAPI.getSettings().then((settings) => {
      if (!cancelled) {
        defaultCompatRef.current = linuxPlayback ? settings?.playback_decode_mode === 'h264' : settings?.playback_decode_mode !== 'auto';
        const sid = seriesCompatRef.current.seriesId;
        if (sid) {
          const enabled = seriesNeedsCompat(sid, undefined, defaultCompatRef.current);
          seriesCompatRef.current = { seriesId: sid, enabled };
          setSeriesCompat(enabled);
        }
        const quality = settings?.playback_quality ?? settings?.download_quality;
        setDownloadQuality(['1080p', '720p'].includes(quality) ? quality : 'auto');
        const level = normalizePrefetchLevel(settings?.playback_prefetch_level);
        levelRef.current = level;
        setPrefetchLevel(level);
        setShowDanmakuControls(settings?.show_danmaku_controls !== false);
      }
    }).catch(() => {
      if (!cancelled) showToast('默认下载清晰度读取失败，请确认清晰度后再下载');
    }).finally(() => { if (!cancelled) setQualityLoading(false); });
    return () => { cancelled = true; };
  }, [active, linuxPlayback]);

  useEffect(() => {
    if (!window.electronAPI.onTranscodeProgress) return undefined;
    return window.electronAPI.onTranscodeProgress((d) => {
      const request = compatRequestRef.current;
      if (request && d.requestId === request.requestId && request.version === mediaVersion.current
        && String(d.seriesId) === request.seriesId && d.vidIndex === request.vidIndex && !d.done) {
        setCompatProgress({ vidIndex: d.vidIndex, percent: d.percent || 0 });
      }
      // 后台预转码任务按请求身份归属对应分集。
      const task = taskRef.current[d.vidIndex];
      if (task?.seriesId === String(d.seriesId) && d.requestId === task.requestId + ':compat' && !d.done) {
        patchTask(d.vidIndex, task.requestId, { phase: 'transcoding', percent: d.percent || 0 });
      }
    });
  }, [patchTask]);

  // 打开剧集面板时，补全各剧的下载进度（只拉一次）
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    (async () => {
      const map = {};
      for (const s of seriesList) {
        try {
          const res = await window.electronAPI.getSeriesEpisodes(s.series_id);
          if (res && res.success) map[String(s.series_id)] = { completed: res.data.completedCount, total: res.data.total };
        } catch (_) {}
        if (cancelled) return;
      }
      if (!cancelled) setDownloadedMap(map);
    })();
    return () => { cancelled = true; };
  }, [pickerOpen, seriesList]);

  useEffect(() => {
    if (!window.electronAPI.onOnlinePlayProgress) return undefined;
    return window.electronAPI.onOnlinePlayProgress((d) => {
      const request = onlineRequestRef.current;
      const phase = taskPhaseFromProgressStage(d.phase);
      patchTask(d.vidIndex, d.requestId, { phase, progress: d, percent: phase === 'buffering' && d.total > 0 ? d.percent : null });
      if (!request || request.prepared || d.requestId !== request.requestId) return;
      setOnlineProgress({
        vid: d.vid,
        percent: d.percent || 0,
        phase: d.phase || 'downloading',
        received: d.received,
        total: d.total,
      });
    });
  }, [patchTask]);

  // 轮询：让「正在下载」的集实时更新，并在等待时自动接上
  useEffect(() => {
    if (!activeSeriesId || (!active && waitingFor == null)) return;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      const version = mediaVersion.current;
      const submitting = fallbackRef.current?.submitting;
      let d;
      try { d = await loadDetail(activeSeriesId); } catch (_) {} finally { busy = false; }
      if (!d || version !== mediaVersion.current) return;
      const intent = fallbackRef.current;
      const recovery = intent && isCurrentFallback(intent) ? intent : null;
      const wf = stateRef.current.waitingFor ?? recovery?.vidIndex;
      if (wf != null) {
        const ep = d.episodes.find((e) => e.vid_index === wf);
        if (usableLocal(ep, String(activeSeriesId)) && (!recovery || ep.vid === recovery.vid)) {
          // 等待中的下一集下好了 -> 自动切过去
          setWaitingFor(null);
          const sameEpisode = wf === stateRef.current.currentIndex;
          const seekTo = recovery ? recovery.seekTo : sameEpisode ? currentPosition() : 0;
          resumeLocal(ep, seekTo, recovery ? recovery.autoplay : !sameEpisode || !loadedMediaRef.current?.element.paused);
        } else if (stateRef.current.waitingFor != null && !submitting && !recovery?.submitting
          && (!ep || ep.locked || ['failed', 'stopped', 'cancelled', 'missing', 'completed'].includes(ep.status))) {
          setWaitingFor(null);
          setPlaybackError(ep?.status === 'stopped' || ep?.status === 'cancelled' ? '本集下载已停止，可在下载管理重试'
            : ep?.status === 'completed' ? '已有本地文件无法播放，请在下载管理检查文件' : '本集下载失败或任务已移除，请在下载管理检查后重试');
        }
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeSeriesId, waitingFor, loadDetail, currentPosition, isCurrentFallback, usableLocal, resumeLocal]);

  const episodes = detail ? detail.episodes : [];
  episodesRef.current = episodes;
  const current = useMemo(
    () => episodes.find((e) => e.vid_index === currentIndex) || null,
    [episodes, currentIndex]
  );

  const cacheWindowPayload = (index, quality) => ({ seriesId: String(activeSeriesId), vidIndex: index, quality,
    episodes: episodes.filter(e => e.vid && !e.locked && Math.abs(e.vid_index - index) <= 5)
      .map(e => ({ vid: String(e.vid), vidIndex: e.vid_index })) });
  const windowSignature = JSON.stringify(cacheWindowPayload(currentIndex, downloadQuality));
  useEffect(() => {
    if (!activeSeriesId || !episodes.length || qualityLoading) return;
    const payload = JSON.parse(windowSignature);
    const allowed = new Set(payload.episodes.map(e => e.vidIndex));
    setCompatMap(previous => Object.fromEntries(Object.entries(previous).filter(([index]) => allowed.has(Number(index)))));
    window.electronAPI.setPlaybackWindow(payload).then(result => {
      if (result?.success) refreshEpisodeCache();
    }).catch(() => {});
  }, [windowSignature, qualityLoading, refreshEpisodeCache]);

  const compatUrl = current ? compatMap[current.vid_index]?.url : null;
  const isOnlinePlaying = onlineVid && current && current.vid === onlineVid && onlineUrl;
  const canPlay = !!(!loading && !qualityLoading && (!seriesCompat || compatUrl || (linuxPlayback && isOnlinePlaying))
    && !playbackError && !onlineProgress && !compatProgress && current && !current.locked
    && (compatUrl || usableLocal(current, String(activeSeriesId)) || isOnlinePlaying));
  const playableSource = compatUrl || (isOnlinePlaying ? onlineUrl : current?.fileUrl) || '';
  // 原生全屏依附于 video 节点。准备下一集时保留结束帧，换源不换节点。
  if (canPlay) lastVideoSrcRef.current = playableSource;
  const videoSrc = compatProgress ? '' : lastVideoSrcRef.current;
  // 时间轴弹幕与本集评论共用开关与视觉设置；普通播放与应用内全屏使用同一叠层和状态。
  const danmaku = useDanmaku({ seriesId: activeSeriesId, episodeId: current?.vid, active: active && canPlay && showDanmakuControls });

  // ===== 选集摘要与就绪判定（普通选集与全屏抽屉共用） =====
  const readyIndexes = useMemo(() => {
    const items = episodeCache?.seriesId === String(activeSeriesId) && episodeCache.quality === downloadQuality ? episodeCache.items : {};
    return new Set(episodes.filter(ep => {
      if (ep.locked) return false;
      if (!seriesCompat && usableLocal(ep, String(activeSeriesId))) return true;
      const item = items[ep.vid_index];
      if (item?.vid !== String(ep.vid)) return false;
      return item.compatible || (item.cached && !cannotPlayHevc(item.codec) && (!seriesCompat || item.directH264));
    }).map(ep => ep.vid_index));
  }, [episodeCache, episodes, activeSeriesId, downloadQuality, seriesCompat, usableLocal]);
  const nextSummary = useMemo(() => nextEpisodeSummary({
    episodes, currentIndex, seriesId: activeSeriesId, quality: downloadQuality,
    tasks: taskStates, readyIndexes,
  }), [episodes, currentIndex, activeSeriesId, downloadQuality, taskStates, readyIndexes]);

  // 信息抽屉：当前等待阶段与实际使用的媒体信息；尚未得到的显示「待确认」。
  const stageWaitingText = playbackError ? playbackError
    : compatProgress ? `正在转码 ${compatProgress.percent || 0}%`
    : onlineProgress ? ({ preparing: '正在取源', reconnecting: '正在重连', decrypting: '正在准备播放', downloading: '正在缓冲' }[onlineProgress.phase] || '正在缓冲') + (onlineProgress.phase === 'downloading' && Number.isFinite(onlineProgress.percent) ? ` ${onlineProgress.percent || 0}%` : '')
    : waitingFor != null ? `第 ${waitingFor} 集正在下载` : mediaBuffering ? '正在缓冲'
    : loading || qualityLoading ? '正在读取剧集' : '';
  const mediaInfoRows = useMemo(() => {
    const online = !!(isOnlinePlaying || (compatUrl && onlineSourceRef.current));
    const mediaSource = sourceInfo?.mediaSource || onlineRequestRef.current?.mediaSource || '';
    const origin = online
      ? (mediaSource === 'app' ? 'App' : mediaSource === 'web' ? '网页' : mediaSource === 'manual' ? '本地文件'
        : mediaSource || /^(xifan:|hema:|custom:)/.test(String(activeSeriesId)) ? '其他来源' : '待确认')
      : canPlay && current?.fileUrl ? '本地文件' : '待确认';
    const sizeText = sourceInfo?.width && sourceInfo?.height ? `${sourceInfo.width} × ${sourceInfo.height}` : '待确认';
    const tier = ({ auto: '自动（App 最高画质）', '1080p': '1080P', '720p': '720P' })[downloadQuality] || downloadQuality;
    const compatMedia = compatMap[currentIndex];
    const playMode = !canPlay ? '待确认' : compatUrl && !compatMedia?.original ? 'H.264 兼容播放' : '原片直放';
    const rows = [
      ['剧集', detail ? detail.series_title : '待确认'],
      ['季 / 集', `${seasonNext?.seriesId === String(activeSeriesId) && seasonNext.currentNumber > 0 ? `第 ${seasonNext.currentNumber} 季 · ` : ''}第 ${currentIndex} 集${current?.title ? ` · ${current.title}` : ''}`],
      ['片源', origin],
      ['清晰度', `${tier} · 实际 ${sizeText}${sourceInfo?.actualQuality ? `（${sourceInfo.actualQuality}）` : ''}`],
      ['播放方式', playMode],
    ];
    // 原片直放与硬件解码是不同信息：只有确认了实际编码器才显示硬解或软解。
    if (compatUrl && !compatMedia?.original && compatMedia?.encoder) {
      rows.push(['转码方式', compatMedia.encoder === 'libx264' ? '软件转码（x264）' : '硬件加速转码']);
    }
    if (stageWaitingText) rows.push(['当前阶段', stageWaitingText]);
    return rows;
  }, [detail, currentIndex, current, sourceInfo, compatUrl, compatMap, isOnlinePlaying, downloadQuality, activeSeriesId, seasonNext, stageWaitingText, canPlay]);

  useEffect(() => {
    const v = videoRef.current;
    if (loading || !canPlay || !v) return;
    const previous = lastLoadRef.current;
    lastLoadRef.current = { source: videoSrc, version: playbackVersion };
    v.defaultPlaybackRate = playbackRateRef.current;
    // 相同地址的显式重试不会触发 src 变更，用原生 load 重置媒体即可。
    if (previous?.source === videoSrc && previous.version !== playbackVersion) { v.src = videoSrc; v.load(); }
    v.playbackRate = playbackRateRef.current;
  }, [loading, canPlay, videoSrc, playbackVersion]);

  const playableCount = episodes.filter((e) => e.status === 'completed').length;

  const retainNextPrefetch = (ep, quality, force = false) => {
    if (!linuxPlayback) return null;
    // 点选正在准备的分集时，播放器接管同一任务（不限紧邻的下一集）。
    const candidate = !force && prefetchRef.current.get(ep.vid + ':' + quality);
    const filePath = quality === 'auto' && usableLocal(ep, String(activeSeriesId)) ? ep.savePath || null : null;
    const keep = candidate && candidate.seriesId === activeSeriesId && candidate.filePath === filePath ? candidate : null;
    releasePrefetch(keep);
    return keep;
  };

  /** 准备兼容播放，保留当前集的播放位置和暂停状态。 */
  const startCompatPlay = useCallback(
    async (vidIndex, force = false, reason = force ? 'manual' : 'compat-mode', prefetched = null) => {
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (!ep || ep.locked) return;
      const filePath = onlineSourceRef.current === `${activeSeriesId}:${vidIndex}` ? null : ep.savePath || null;
      if (linuxPlayback) {
        const candidate = prefetchRef.current.get(ep.vid + ':' + mediaQualityRef.current);
        if (!prefetched && reason === 'compat-mode' && candidate?.filePath === filePath && candidate?.seriesId === activeSeriesId) prefetched = candidate;
        releasePrefetch(prefetched);
        if (prefetched) {
          prefetched.promoted = true;
          prefetchRef.current.delete(prefetched.key);
        }
      }
      const request = { requestId: crypto.randomUUID(), seriesId: String(activeSeriesId), vidIndex, quality: mediaQualityRef.current, version: mediaVersion.current };
      if (compatRequestRef.current?.version === request.version && compatRequestRef.current?.vidIndex === vidIndex) return;
      if (prefetched?.compatStarted) request.requestId = prefetched.requestId + ':compat';
      autoCompatAttemptRef.current = { version: request.version, force };
      stopDecodeWatch();
      pendingSeekRef.current = currentPosition();
      if (loadedMediaRef.current) pendingAutoplayRef.current = !loadedMediaRef.current.element.paused;
      fallbackRef.current = null;
      setWaitingFor(null);
      setPlaybackError('');
      persistPosition(true);
      videoRef.current?.pause();
      loadedMediaRef.current = null;
      // Windows must release the failed cache before FFmpeg replaces it. Keep the fullscreen node.
      videoRef.current?.removeAttribute('src');
      videoRef.current?.load();
      compatRequestRef.current = request;
      setCompatError('');
      setCompatProgress({ vidIndex, percent: 0 });
      try {
        const res = await window.electronAPI.transcodeForPlayback({
          requestId: request.requestId,
          seriesId: activeSeriesId,
          vidIndex,
          vid: ep.vid,
          filePath,
          force,
          quality: request.quality,
          reason,
          codec: mediaCodecRef.current,
          streamId: onlineRequestRef.current?.streamId,
        });
        if (compatRequestRef.current !== request || request.version !== mediaVersion.current) return;
        compatRequestRef.current = null;
        if (res && res.success) {
          if (prefetched) patchTask(vidIndex, prefetched.requestId, null);
          loadedMediaRef.current = null;
          // A fast same-URL result can be batched with the loading state; restore the DOM source explicitly.
          if (videoRef.current) { videoRef.current.src = res.url; videoRef.current.load(); }
          setCompatMap((prev) => ({ ...prev, [vidIndex]: { url: res.url, original: res.original, encoder: res.encoder || '' } }));
          mediaCodecRef.current = 'h264';
          if (res.original) autoCompatAttemptRef.current = null;
          if (!linuxPlayback && !force && reason !== 'compat-mode' && !seriesCompatRef.current.enabled) {
            rememberSeriesCompat(request.seriesId);
            seriesCompatRef.current = { seriesId: request.seriesId, enabled: true };
            setSeriesCompat(true);
            releasePrefetch();
          }
          if (res.width && res.height) setSourceInfo(prev => ({ ...prev, width: res.width, height: res.height, actualQuality: res.actualQuality || null }));
          setDecodeFailed(false);
          setCompatProgress(null);
          if (!res.original) showToast(res.cached ? '已切换为兼容格式播放' : `已转码为兼容格式（用时 ${res.elapsed}s），开始播放`);
          window.electronAPI.compatCacheStatus().then((r) => {
            if (r && r.success) setCompatCache({ files: r.files, bytes: r.bytes });
          });
          refreshEpisodeCacheRef.current?.();
        } else {
          setCompatProgress(null);
          if (prefetched) patchTask(vidIndex, prefetched.requestId, res?.cancelled ? null : { phase: 'failed', percent: null, error: res?.error || '转码失败' });
          if (!res?.cancelled && reconnectOnce()) return;
          const message = (res && res.error) || '转码失败';
          if (!res?.cancelled && onlineSourceRef.current === `${activeSeriesId}:${vidIndex}`) {
            await recoverOnlineFailure(ep, message);
            return;
          }
          setDecodeFailed(true);
          setCompatError(message);
          showToast(message);
        }
      } catch (e) {
        if (compatRequestRef.current !== request || request.version !== mediaVersion.current) return;
        compatRequestRef.current = null;
        setCompatProgress(null);
        if (reconnectOnce()) return;
        if (onlineSourceRef.current === `${activeSeriesId}:${vidIndex}`) {
          await recoverOnlineFailure(ep, '转码异常: ' + e.message);
          return;
        }
        setDecodeFailed(true);
        setCompatError('转码异常: ' + e.message);
        showToast('转码异常: ' + e.message);
      }
    },
    [episodes, activeSeriesId, linuxPlayback, reconnectOnce, showToast, currentPosition, persistPosition, recoverOnlineFailure, stopDecodeWatch, releasePrefetch, patchTask]
  );

  const tryAutoCompat = useCallback((vidIndex, reason) => {
    const force = !!compatMap[vidIndex] && !compatMap[vidIndex].original;
    const attempt = autoCompatAttemptRef.current;
    if (attempt?.version === mediaVersion.current && (!force || attempt.force)) return;
    startCompatPlay(vidIndex, force, force ? 'repair-output' : reason);
  }, [compatMap, startCompatPlay]);

  /**
   * 播放中解码守卫：按周期采样画面与解码计数，自动发现
   * 「黑屏有声」（有尺寸、音频在播但画面持续纯黑）与「解不出画面」，
   * 命中后自动转 H.264 兼容格式 —— 不再需要手动切换。
   * 必须定义在早返回之前 —— hooks 不能出现在条件分支之后。
   */
  const startDecodeWatch = useCallback((idx) => {
    stopDecodeWatch();
    const version = mediaVersion.current;
    // Linux uses frame progress. Keep the legacy sampling policy on other platforms.
    const guard = linuxPlayback ? createFrameDecodeGuard() : createDecodeGuard({ blackProbeEnabled: !mediaCodecRef.current || isHevcCodec(mediaCodecRef.current) });
    const sampler = linuxPlayback ? null : createFrameSampler(document);
    const watch = { video: videoRef.current, guard, presented: 0 };
    const onFrame = () => {
      if (decodeWatchRef.current !== watch) return;
      watch.presented++;
      watch.frameId = watch.video.requestVideoFrameCallback(onFrame);
    };
    if (linuxPlayback) watch.frameId = watch.video?.requestVideoFrameCallback?.(onFrame);
    const timer = setInterval(() => {
      if (version !== mediaVersion.current) { stopDecodeWatch(); return; }
      const v = videoRef.current;
      if (!v || compatRequestRef.current || document.visibilityState === 'hidden') { guard.reset(); return; }
      const decodedFrames = typeof v.webkitDecodedFrameCount === 'number' ? v.webkitDecodedFrameCount : v.getVideoPlaybackQuality?.().totalVideoFrames;
      const verdict = linuxPlayback ? guard.push({
        currentTime: v.currentTime, playbackRate: v.playbackRate, videoWidth: v.videoWidth,
        inactive: v.paused || v.seeking || v.ended || v.readyState < 3,
        presented: watch.presented, decoded: decodedFrames ?? v.webkitVideoDecodedByteCount,
      }) : guard.push({
        currentTime: v.currentTime,
        paused: v.paused,
        videoWidth: v.videoWidth,
        videoDecodedBytes: typeof decodedFrames === 'number' ? decodedFrames : typeof v.webkitVideoDecodedByteCount === 'number' ? v.webkitVideoDecodedByteCount : null,
        audioDecodedBytes: typeof v.webkitAudioDecodedByteCount === 'number' ? v.webkitAudioDecodedByteCount : null,
        luma: v.paused ? null : sampler.sample(v),
      });
      if (verdict === 'watch' || verdict === 'healthy') return;
      stopDecodeWatch();
      setDecodeFailed(true);
      tryAutoCompat(idx, 'no-picture');
    }, SAMPLE_INTERVAL_MS);
    watch.timer = timer;
    decodeWatchRef.current = watch;
  }, [linuxPlayback, stopDecodeWatch, tryAutoCompat]);

  const clearCompatCache = async () => {
    releasePrefetch();
    const affected = !!(compatUrl && !compatMap[currentIndex].original) || !!compatRequestRef.current;
    if (affected) stopPlayback('兼容播放已停止，可重试本集继续观看');
    try {
      const r = await window.electronAPI.clearCompatCache();
      if (!r?.success) { showToast(r?.error || '清理转码缓存失败'); return; }
      setCompatMap(previous => Object.fromEntries(Object.entries(previous).filter(([, media]) => media.original)));
      setCompatCache({ files: 0, bytes: 0 });
      setEpisodeCache(null);
      refreshEpisodeCache();
      showToast(r.count > 0 ? `已清理转码缓存，释放 ${fmtSize(r.freed)}` : '转码缓存已是空的');
    } catch (e) { showToast('清理转码缓存失败: ' + e.message); }
  };

  // 播放开始后启动解码守卫：黑屏有声 / 解不出画面会自动转 H.264 兼容格式。
  // 必须定义在早返回之前 —— hooks 不能出现在条件分支之后。
  const handlePlaying = useCallback((event) => {
    const media = loadedMediaRef.current;
    const element = event.currentTarget;
    if (playbackVersion !== mediaVersion.current || !canPlay || media?.version !== mediaVersion.current || media.element !== element) return;
    if (element.currentSrc && element.currentSrc !== videoSrc) return;
    if (!media.played) {
      media.played = true;
      media.watchFrom = element.currentTime;
      persistPosition(true);
    }
    setAutoAdvancing(false);
    setDecodeFailed(false);
    setMediaBuffering(false);
    startDecodeWatch(currentIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, tryAutoCompat, startDecodeWatch, playbackVersion, canPlay, videoSrc, persistPosition]);

  /**
   * 在线播放：明文片源按需加载，加密片源准备后返回播放地址。
   * 不占用下载目录；加密片源的准备文件会自动清理。
   */
  const startOnlinePlay = useCallback(
    async (vidIndex, resumeAt, force = false, autoplay = true, qualityOverride) => {
      if (stateRef.current.qualityLoading && qualityOverride == null) return;
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (ep?.locked) { showToast('这一集需在来源平台解锁'); return; }
      if (!ep || !ep.vid) {
        showToast('这一集暂时无法播放，请重新获取剧集后重试');
        return;
      }
      const quality = qualityOverride ?? stateRef.current.downloadQuality;
      const prefetched = retainNextPrefetch(ep, quality, force || !!usableLocal(ep, String(activeSeriesId)));
      if (prefetched) {
        prefetched.promoted = true;
        prefetchRef.current.delete(prefetched.key);
      }
      onlineSourceRef.current = `${activeSeriesId}:${vidIndex}`;
      const seekTo = resumeAt ?? (vidIndex === stateRef.current.currentIndex ? currentPosition() : 0);
      resetPlayback(autoplay);
      setCompatMap(prev => { const next = { ...prev }; delete next[vidIndex]; return next; });
      const request = prefetched || { requestId: crypto.randomUUID(), vid: ep.vid };
      onlineRequestRef.current = request;
      pendingSeekRef.current = seekTo;
      setCurrentIndex(vidIndex);
      setWaitingFor(null);
      setOnlineProgress((prefetched && taskRef.current[vidIndex]?.progress) || { vid: ep.vid, percent: 0, phase: 'preparing' });
      setOnlineVid(ep.vid);
      setOnlineUrl('');
      try {
        mediaQualityRef.current = quality;
        const windowResult = await window.electronAPI.setPlaybackWindow(cacheWindowPayload(vidIndex, quality));
        if (windowResult?.success === false) throw new Error(windowResult.error);
        if (onlineRequestRef.current !== request) return;
        const usesCompat = () => seriesCompatRef.current.seriesId === String(activeSeriesId) && seriesCompatRef.current.enabled;
        if (!linuxPlayback && usesCompat()) {
          releaseOnline();
          setOnlineProgress(null);
          startCompatPlay(vidIndex);
          return;
        }
        let res = prefetched ? await prefetched.onlinePromise : null;
        if (res?.success && !res.url) res = null;
        // 预取已耗尽恢复次数（主备均空终态）时不再立即重发取源：直接呈现失败与重试入口，等下一轮。
        if ((!res || !res.success) && !res?.exhausted && onlineRequestRef.current === request) {
          res = await window.electronAPI.prepareOnlinePlay({
            requestId: request.requestId, vid: ep.vid, seriesId: activeSeriesId, vidIndex,
            force, disk: true, quality,
          });
        }
        if (onlineRequestRef.current !== request) {
          window.electronAPI.releaseOnlinePlay({ requestId: request.requestId, streamId: res?.streamId }).catch(() => {});
          return;
        }
        if (!res || !res.success) {
          if (prefetched) patchTask(vidIndex, request.requestId, { phase: 'failed', percent: null, error: res?.error || '取源失败' });
          await recoverOnlineFailure(ep, (res && res.error) || '在线播放准备失败');
          return;
        }
        request.streamId = res.streamId;
        request.prepared = true;
        request.directH264 = res.directH264;
        request.mediaSource = res.mediaSource || '';
        setSourceInfo(res.width && res.height ? { width: res.width, height: res.height, actualQuality: res.actualQuality || null, mediaSource: res.mediaSource || '' } : null);
        mediaCodecRef.current = String(res.codec || '');
        // 本机明确解不了 HEVC 时直接转兼容格式，避免先播一段黑屏有声再手工切换。
        const unsupportedHevc = cannotPlayHevc(res.codec);
        const explicitCompat = usesCompat();
        if ((explicitCompat && !res.directH264) || unsupportedHevc) {
          if (!linuxPlayback) releaseOnline();
          setOnlineProgress(null);
          if (unsupportedHevc && !explicitCompat) showToast('本机无法解码 HEVC，自动转为 H.264 兼容格式');
          startCompatPlay(vidIndex, false, explicitCompat ? 'compat-mode' : 'unsupported-hevc', prefetched);
          return;
        }
        setMediaBuffering(true);
        setOnlineUrl(res.url);
        setOnlineProgress(null);
        if (prefetched) patchTask(vidIndex, request.requestId, null);
        refreshCacheInfo();
        refreshEpisodeCacheRef.current?.();
      } catch (e) {
        if (onlineRequestRef.current !== request) return;
        await recoverOnlineFailure(ep, '在线播放失败: ' + e.message);
      }
    },
    [episodes, activeSeriesId, showToast, refreshCacheInfo, resetPlayback, releaseOnline, releasePrefetch, currentPosition, recoverOnlineFailure, usableLocal, linuxPlayback, startCompatPlay, patchTask]
  );

  // Downloaded episodes also inherit the series mode before their original is played.
  useEffect(() => {
    if (!seriesCompat || loading || qualityLoading || !current || current.locked || compatUrl
      || compatProgress || onlineProgress || playbackError || compatError || decodeFailed
      || autoCompatAttemptRef.current?.version === mediaVersion.current || !usableLocal(current, String(activeSeriesId))) return;
    if (onlineSourceRef.current === `${activeSeriesId}:${current.vid_index}`) return;
    startCompatPlay(current.vid_index);
  }, [seriesCompat, loading, qualityLoading, current, compatUrl, compatProgress, onlineProgress, playbackError, compatError, decodeFailed, activeSeriesId, usableLocal, startCompatPlay]);

  const restoreSeriesDecode = () => {
    rememberSeriesCompat(activeSeriesId, false);
    seriesCompatRef.current = { seriesId: String(activeSeriesId), enabled: false };
    setSeriesCompat(false);
    releasePrefetch();
    syncTasks({}); // 变更解码方式后重新判定，旧任务的状态只归属于原请求
    showToast('本剧已恢复自动解码，从下次切集或重试开始生效');
  };

  const changeQuality = async (quality) => {
    const selected = selectionVersion.current, change = ++qualityChangeRef.current;
    const index = currentIndex, seekTo = currentPosition(), autoplay = !videoRef.current?.paused;
    setDownloadQuality(quality);
    stateRef.current.downloadQuality = quality;
    releasePrefetch(); setCompatMap({});
    syncTasks({});
    if (current && !current.locked) startOnlinePlay(index, seekTo, false, autoplay, quality);
    try {
      const settings = await window.electronAPI.getSettings();
      if (selected !== selectionVersion.current || change !== qualityChangeRef.current) return;
      const result = await window.electronAPI.saveSettings({ ...settings, playback_quality: quality, download_quality: quality, auto_delete_watched: false });
      if (result?.success === false) showToast('清晰度已切换，但设置保存失败');
    } catch (_) { showToast('清晰度已切换，但设置保存失败'); }
  };

  function reconnectOnce() {
    const key = `${activeSeriesId}:${currentIndex}`;
    if (!current?.vid || current.locked || reconnectAttemptRef.current === key) return false;
    reconnectAttemptRef.current = key;
    if (onlineSourceRef.current !== key && current.status === 'completed') rejectedLocalRef.current = localMediaKey(String(activeSeriesId), current);
    showToast('正在重新获取本集片源…');
    startOnlinePlay(currentIndex, currentPosition(), true, loadedMediaRef.current ? !loadedMediaRef.current.element.paused : pendingAutoplayRef.current);
    return true;
  }

  // 切集
  const goToEpisode = useCallback(
    (vidIndex, resumeAt) => {
      const ep = episodes.find((e) => e.vid_index === vidIndex);
      if (!ep || ep.locked) return;
      fallbackAttemptRef.current = null;
      reconnectAttemptRef.current = null;
      if (!usableLocal(ep, String(activeSeriesId))) {
        startOnlinePlay(vidIndex, resumeAt);
        return;
      }
      retainNextPrefetch(ep, stateRef.current.downloadQuality);
      if (linuxPlayback) setCompatMap(prev => { const next = { ...prev }; delete next[vidIndex]; return next; });
      onlineSourceRef.current = null;
      mediaQualityRef.current = stateRef.current.downloadQuality;
      const seekTo = resumeAt ?? (vidIndex === stateRef.current.currentIndex ? currentPosition() : 0);
      resetPlayback();
      setCurrentIndex(vidIndex);
      setWaitingFor(null);
      pendingSeekRef.current = seekTo;
    },
    [episodes, activeSeriesId, resetPlayback, startOnlinePlay, currentPosition, usableLocal, linuxPlayback, releasePrefetch]
  );

  const retryPlayback = async () => {
    const version = mediaVersion.current, selection = selectionVersion.current;
    let data;
    try { data = await loadDetail(activeSeriesId); } catch (_) {}
    if (version !== mediaVersion.current || selection !== selectionVersion.current) return;
    const latest = data?.episodes.find(ep => ep.vid_index === currentIndex && ep.vid === current?.vid);
    if (usableLocal(latest, String(activeSeriesId))) { resumeLocal(latest, currentPosition()); return; }
    setCompatMap(prev => { const next = { ...prev }; delete next[currentIndex]; return next; });
    if (onlineSourceRef.current === `${activeSeriesId}:${currentIndex}` || current?.status !== 'completed') {
      reconnectAttemptRef.current = null;
      startOnlinePlay(currentIndex, currentPosition(), true);
    } else goToEpisode(currentIndex, currentPosition());
  };

  // 找下一集（按集号顺序）
  const findNext = useCallback(fromIndex => nextPlayableEpisode(episodes, fromIndex), [episodes]);
  const findPrev = useCallback(
    (fromIndex) => {
      const idx = episodes.findIndex((e) => e.vid_index === fromIndex);
      if (idx <= 0) return null;
      return episodes.slice(0, idx).reverse().find((ep) => !ep.locked) || null;
    },
    [episodes]
  );

  // Linux prepares the next playable episode before considering the one after it.
  const pumpPrefetch = () => {
    while (prefetchQueueRef.current.length && prefetchActiveRef.current < (linuxPlayback || prefetchQueueRef.current[0].compat ? 1 : 2)) {
      const request = prefetchQueueRef.current.shift();
      if (prefetchRef.current.has(request.key)) continue;
      prefetchRef.current.set(request.key, request);
      prefetchActiveRef.current++;
      const { requestId, vid, seriesId, vidIndex, quality, filePath } = request;
      const payload = { requestId, vid, seriesId, vidIndex, quality, filePath };
      patchTask(vidIndex, requestId, { phase: 'sourcing', percent: null, error: '' });
      request.onlinePromise = linuxPlayback && filePath ? Promise.resolve({ success: true })
        : window.electronAPI.prepareOnlinePlay({ ...payload, disk: true, prefetch: true }).catch(() => ({ success: false }));
      request.onlinePromise
        .then(async result => {
          try {
            // 主备均空的终态结果：本轮预取停止推进，等待下次播放触发，避免连续打满三次模型请求。
            if (result?.exhausted && prefetchRef.current.get(request.key) === request) {
              for (const queued of prefetchQueueRef.current) patchTask(queued.vidIndex, queued.requestId, null);
              prefetchQueueRef.current = [];
            }
            const unsupportedHevc = linuxPlayback && cannotPlayHevc(result?.codec);
            if (result?.success && !result.directH264 && (request.compat || unsupportedHevc) && prefetchRef.current.get(request.key) === request) {
              request.compatStarted = true;
              patchTask(vidIndex, requestId, { phase: 'transcoding', percent: null });
              const compat = await window.electronAPI.transcodeForPlayback({ ...payload, requestId: requestId + ':compat',
                streamId: result.streamId, codec: result.codec, reason: request.compat ? 'prefetch' : 'unsupported-hevc', background: true });
              if (!request.promoted) {
                patchTask(vidIndex, requestId, compat?.success || compat?.cancelled ? null
                  : { phase: 'failed', percent: null, error: compat?.error || '转码失败' });
              }
            } else if (!request.promoted) {
              patchTask(vidIndex, requestId, result?.success ? null : { phase: 'failed', percent: null, error: result?.error || '取源失败' });
            }
          } finally {
            if (!request.promoted && (!linuxPlayback || !filePath)) {
              await window.electronAPI.releaseOnlinePlay({ requestId, streamId: result?.streamId }).catch(() => {});
            }
          }
        }).catch(() => { if (!request.promoted) patchTask(vidIndex, requestId, { phase: 'failed', percent: null, error: '准备失败' }); })
        .finally(() => {
          if (linuxPlayback && prefetchRef.current.get(request.key) === request) prefetchRef.current.delete(request.key);
          prefetchActiveRef.current--;
          refreshCacheInfo();
          refreshEpisodeCacheRef.current?.();
          pumpPrefetch();
        });
    }
  };
  // 预取窗口：档位控制主动准备多少集（仅 Linux 播放器）；缩小档位时撤销范围外的后台任务。
  const runPrefetchWindow = (video, optionsChanged = false) => {
    const media = loadedMediaRef.current;
    const playing = canPlay && video && !video.paused && media?.played && media.version === mediaVersion.current
      && media.element === video && (!video.currentSrc || video.currentSrc === videoSrc);
    if (!playing && !optionsChanged) return;
    const quality = stateRef.current.downloadQuality;
    const compat = seriesCompatRef.current.seriesId === String(activeSeriesId) && seriesCompatRef.current.enabled;
    const level = levelRef.current;
    const token = activeSeriesId + ':' + currentIndex + ':' + quality + ':' + compat + ':' + level;
    if (prefetchWindowRef.current === token) return;
    const payload = cacheWindowPayload(currentIndex, quality);
    const nearby = episodes.filter(e => e.vid && !e.locked && e.vid_index !== currentIndex
      && Math.abs(e.vid_index - currentIndex) <= 5)
      .sort((a, b) => (a.vid_index < currentIndex) - (b.vid_index < currentIndex)
        || Math.abs(a.vid_index - currentIndex) - Math.abs(b.vid_index - currentIndex));
    const candidates = (linuxPlayback ? nearby.filter(e => e.vid_index > currentIndex).slice(0, prefetchCount(level)) : nearby)
      .filter(e => compat || !usableLocal(e, String(activeSeriesId)));
    // 范围外的请求立即撤销；已被前台接管的播放任务不在预取表内，继续执行。
    const allowed = new Set(linuxPlayback ? candidates.map(e => e.vid + ':' + quality) : payload.episodes.map(e => e.vid + ':' + quality));
    for (const [key, request] of prefetchRef.current) if (!allowed.has(key) || request.seriesId !== activeSeriesId) {
      prefetchRef.current.delete(key);
      if (request.compatStarted) cancelPrefetchCompat(request);
      window.electronAPI.releaseOnlinePlay({ requestId: request.requestId }).catch(() => {});
    }
    prefetchQueueRef.current = prefetchQueueRef.current.filter(request => allowed.has(request.key) && request.seriesId === activeSeriesId);
    if (linuxPlayback) syncTasks(Object.fromEntries(Object.entries(taskRef.current).filter(([, task]) =>
      task.seriesId === String(activeSeriesId) && allowed.has(task.vid + ':' + task.quality))));
    if (!playing) return;
    prefetchWindowRef.current = token;
    window.electronAPI.setPlaybackWindow(payload).then(result => {
      if (prefetchWindowRef.current !== token || result?.success === false) return;
      const nextTasks = { ...taskRef.current };
      prefetchQueueRef.current = candidates.filter(e => !prefetchRef.current.has(e.vid + ':' + quality) && !readyIndexes.has(e.vid_index))
        .map(e => {
          const request = { requestId: crypto.randomUUID(), key: e.vid + ':' + quality, vid: e.vid,
            seriesId: activeSeriesId, vidIndex: e.vid_index, quality, compat,
            filePath: usableLocal(e, String(activeSeriesId)) ? e.savePath || null : null };
          nextTasks[e.vid_index] = { seriesId: String(activeSeriesId), quality, vid: String(e.vid), phase: 'queued', requestId: request.requestId };
          return request;
        });
      syncTasks(nextTasks);
      pumpPrefetch();
    }).catch(() => {});
  };
  const prepareNextEpisode = (event) => runPrefetchWindow(event.currentTarget);

  // 「跳到第 N 集」：输入有效集数后定位到对应按钮，由用户确认播放；锁定集可定位。
  const submitJump = (event, locate) => {
    event.preventDefault();
    const result = parseEpisodeJump(jumpQuery, episodes);
    if (result.error) { setJumpError(result.error); return; }
    setJumpError('');
    setJumpQuery('');
    locate?.(result.index);
  };

  // 预缓存档位：设置即时保存；缩小档位时立即撤销范围外的后台任务，已由前台接管的播放任务继续执行。
  const applyPrefetchLevel = async (value) => {
    const next = normalizePrefetchLevel(value);
    if (next === levelRef.current && next === prefetchLevel) return;
    levelRef.current = next;
    setPrefetchLevel(next);
    prefetchWindowRef.current = '';
    runPrefetchWindow(videoRef.current, true);
    try {
      const result = await window.electronAPI.setPlaybackPrefetchLevel(next);
      if (!result?.success && levelRef.current === next) showToast('档位已切换，但设置保存失败');
    } catch (_) { if (levelRef.current === next) showToast('档位已切换，但设置保存失败'); }
  };

  // 播放结束 -> 连播（未下载的集自动转在线播放，做到「不下载也能连着看」）
  const handleEnded = useCallback(() => {
    const { currentIndex: ci, autoNext: an } = stateRef.current;
    const next = findNext(ci);
    if (!next) {
      if (episodes.at(-1)?.vid_index !== ci) {
        showToast('已播完可播放集数，其余集数需在来源平台解锁');
        return;
      }
      setSeasonEndPrompt(true);
      evaluateSeasonNextRef.current?.(true);
      showToast('已经是最后一集');
      return;
    }
    if (!an) return;
    goToEpisode(next.vid_index, 0);
    setAutoAdvancing(true);

  }, [findNext, goToEpisode, showToast, episodes]);

  // 读取现有季关系：唯一的下一季直接续播；多个候选或季关系待确认时交给季选择入口。
  const evaluateSeasonNext = useCallback(async (discover = false) => {
    const seriesId = String(selectedSeriesRef.current || '');
    if (!seriesId || !window.electronAPI.getSeriesSeasons) return;
    const version = selectionVersion.current;
    try {
      const res = await window.electronAPI.getSeriesSeasons(seriesId);
      if (!res?.success || String(selectedSeriesRef.current || '') !== seriesId) return;
      let view = res.data || {};
      const nextNumber = (view.currentNumber || 1) + 1;
      if (discover && !view.related?.some(season => season.number === nextNumber) && window.electronAPI.discoverSeriesSeasons) {
        try {
          const found = await window.electronAPI.discoverSeriesSeasons(seriesId);
          if (found?.success) view = found.data;
        } catch (_) {}
        if (version !== selectionVersion.current) return;
      }
      const members = (view.seasons || []).filter(s => s.number === nextNumber);
      const related = (view.related || []).filter(s => s.number === nextNumber);
      const unique = members.length === 1 && related.length <= 1 ? members[0] : null;
      let resumeIndex = null;
      if (unique) {
        try {
          const saved = await window.electronAPI.getPlaybackPosition(unique.series_id);
          if (Number.isInteger(saved?.vid_index) && saved.vid_index > 0 && (saved.watched === true || Number(saved.currentTime) > 0)) {
            resumeIndex = saved.vid_index;
          }
        } catch (_) {}
      }
      if (version === selectionVersion.current) {
        setSeasonNext({ seriesId, currentNumber: view.currentNumber || 1, nextNumber, unique, candidates: related, resumeIndex });
      }
    } catch (_) {}
  }, []);
  const evaluateSeasonNextRef = useRef(evaluateSeasonNext);
  evaluateSeasonNextRef.current = evaluateSeasonNext;

  // 后台继续播放也保存进度；离开页面、暂停和关闭窗口强制保存最后一秒。
  useEffect(() => {
    const timer = setInterval(persistPosition, 5000);
    const save = () => persistPosition(true);
    window.addEventListener('beforeunload', save);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [persistPosition]);

  useEffect(() => {
    if (!active) persistPosition(true);
  }, [active, persistPosition]);

  const handleMetadata = (event) => {
    const v = event.currentTarget;
    if (!canPlay || playbackVersion !== mediaVersion.current || v !== videoRef.current || !current || current.locked) return;
    if (v.currentSrc && v.currentSrc !== videoSrc) return;
    if (v.videoWidth && v.videoHeight) setSourceInfo(prev => ({ ...(prev || {}), width: v.videoWidth, height: v.videoHeight }));
    loadedMediaRef.current = { element: v, seriesId: activeSeriesId, vidIndex: currentIndex, version: mediaVersion.current, played: false };
    v.defaultPlaybackRate = playbackRateRef.current;
    v.playbackRate = playbackRateRef.current;
    const seekTo = Math.max(0, Number(pendingSeekRef.current) || 0);
    if (seekTo > 0 && (!Number.isFinite(v.duration) || seekTo < v.duration - 3)) {
      v.currentTime = seekTo;
      showToast(`从 ${Math.floor(seekTo / 60)}:${String(Math.floor(seekTo % 60)).padStart(2, '0')} 继续播放`);
    }
    pendingSeekRef.current = 0;
    if (!linuxPlayback && compatMap[currentIndex]) releaseOnline();
    if (pendingAutoplayRef.current) v.play().catch(() => { if (playbackVersion === mediaVersion.current) setAutoAdvancing(false); });
  };

  const toggleFullscreen = useCallback(async () => {
    if (document.querySelector('.stealth-mode')) { showToast('请先退出隐身小窗'); return; }
    try {
      if (appFillRef.current) { setStageDrawer(null); setAppFill(false); }
      if (portrait) { setWindowFill(fill => !fill); return; }
      if (document.fullscreenElement === stageRef.current) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch { showToast('无法进入或退出全屏，请重试'); }
  }, [portrait, showToast]);

  // Capture handled keys before media controls; cancel keyup too so focused buttons cannot toggle twice.
  useEffect(() => {
    if (!active || confirmAsk || mergeAsk || pickerOpen) return;
    const held = new Set();
    const onKey = (event) => {
      const video = videoRef.current;
      if (!video || event.defaultPrevented || ignoresPlaybackShortcut(event.target)) return;
      const key = shortcutKey(event);
      const action = SHORTCUT_ACTIONS.find(item => shortcuts[item.id] === key);
      if (!action) return;
      event.preventDefault(); event.stopPropagation?.();
      held.add(event.code || event.key);
      if (event.repeat && !action.repeat) return;
      const { currentIndex: index, autoNext: nextEnabled } = stateRef.current;
      if (action.id === 'play') {
        if (video.paused) video.play().catch(() => showToast('暂时无法播放，请重试本集'));
        else video.pause();
      } else if (action.id === 'forward' || action.id === 'backward') {
        const limit = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
        try { video.currentTime = Math.max(0, Math.min(limit, video.currentTime + (action.id === 'forward' ? 5 : -5))); }
        catch { showToast('暂时无法跳转，请稍后重试'); }
      } else if (action.id === 'previous' || action.id === 'next') {
        const episode = action.id === 'previous' ? findPrev(index) : findNext(index);
        if (episode) { goToEpisode(episode.vid_index); setAutoAdvancing(true); }
        else showToast(action.id === 'previous' ? '已经是第一集' : '已经是最后一集');
      } else if (action.id === 'autoNext') setAutoNext(!nextEnabled);
      else if (action.id === 'fullscreen') toggleFullscreen();
      else changePlaybackRate(playbackRateRef.current + (action.id === 'slower' ? -0.25 : 0.25));
    };
    const onKeyUp = event => {
      if (!held.delete(event.code || event.key)) return;
      event.preventDefault(); event.stopPropagation?.();
    };
    const onBlur = () => held.clear();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [active, confirmAsk, mergeAsk, pickerOpen, findNext, findPrev, goToEpisode, changePlaybackRate, showToast, shortcuts, toggleFullscreen]);

  const switchSeries = useCallback(async (sid, requestedIndex = 0, resume = false) => {
    persistPosition(true);
    const version = ++selectionVersion.current;
    selectedSeriesRef.current = String(sid);
    releasePrefetch();
    setWatchedSet(new Set());
    setEpisodeCache(null);
    setSeasonNext(null);
    setSeasonEndPrompt(false);
    setJumpError('');
    setJumpQuery('');
    const enabled = seriesNeedsCompat(sid, undefined, defaultCompatRef.current);
    seriesCompatRef.current = { seriesId: String(sid), enabled };
    setSeriesCompat(enabled);
    fallbackAttemptRef.current = null;
    rejectedLocalRef.current = null;
    onSeriesSelected?.(String(sid));
    pendingTargetRef.current = null;
    reconnectAttemptRef.current = null;
    onlineSourceRef.current = null;
    mediaQualityRef.current = 'auto';
    resetPlayback();
    setCompatMap({});
    setActiveSeriesId(String(sid));
    setDetail(null);
    setWaitingFor(null);
    setLoading(true);
    try {
      const d = await loadDetail(sid);
      if (!d || version !== selectionVersion.current) return;
      const record = await window.electronAPI.getPlaybackPosition(sid);
      if (version !== selectionVersion.current) return;
      setWatchedSet(new Set(record?.watched_indexes || []));
      const saved = requestedIndex && !resume ? null : record;
      const wantedIndex = requestedIndex || saved?.vid_index;
      const selected = d.episodes.find(e => e.vid_index === wantedIndex && !e.locked) || d.episodes.find(e => !e.locked);
      setCurrentIndex(selected?.vid_index || 1);
      pendingSeekRef.current = selected?.vid_index === saved?.vid_index ? saved.currentTime || 0 : 0;
      if ((requestedIndex || saved || resume) && selected) {
        pendingTargetRef.current = { seriesId: String(sid), vidIndex: selected.vid_index, seekTo: pendingSeekRef.current };
      }
    } catch (e) {
      if (version === selectionVersion.current) showToast('加载剧集失败: ' + e.message);
    } finally {
      if (version === selectionVersion.current) setLoading(false);
    }
  }, [persistPosition, resetPlayback, loadDetail, showToast, onSeriesSelected, releasePrefetch]);

  const switchSeason = useCallback(async sid => {
    if (String(sid) === String(activeSeriesId)) return;
    const version = selectionVersion.current;
    await loadSeriesList();
    if (version !== selectionVersion.current) return;
    await switchSeries(sid, 0, true);
  }, [activeSeriesId, loadSeriesList, switchSeries]);

  // ===== 应用内全屏与舞台抽屉 =====
  // 有足够的画面留白时抽屉放在留白处，空间紧张时用可关闭的浮层叠在画面上。
  const measureDrawerPlacement = useCallback(() => {
    const stage = stageRef.current, video = videoRef.current;
    if (!stage || !video || !video.videoWidth || !video.videoHeight || stage.dataset?.pictureMode === 'width') return 'overlay';
    const rect = stage.getBoundingClientRect();
    if (typeof rect.width !== 'number' || !rect.width) return 'overlay';
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    const sideMargin = (rect.width - video.videoWidth * scale) / 2;
    return sideMargin >= 372 ? 'side' : 'overlay';
  }, []);
  const measureDrawerPlacementRef = useRef(measureDrawerPlacement);
  measureDrawerPlacementRef.current = measureDrawerPlacement;

  const closeStageDrawer = useCallback((restoreFocus = true) => {
    const kind = stageDrawer;
    setStageDrawer(null);
    // 关闭抽屉后焦点回到打开它的按钮。
    if (restoreFocus && kind === 'episodes') episodesBtnRef.current?.focus?.();
    else if (restoreFocus && kind === 'info') infoBtnRef.current?.focus?.();
  }, [stageDrawer]);

  const openStageDrawer = useCallback((kind) => {
    setStageDrawer(kind);
    setDrawerPlacement(measureDrawerPlacement());
    if (kind === 'info') evaluateSeasonNextRef.current?.();
  }, [measureDrawerPlacement]);

  const toggleAppFill = useCallback(async () => {
    if (document.querySelector?.('.stealth-mode')) { showToast('请先退出隐身小窗'); return; }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      setStageDrawer(null);
      setWindowFill(false);
      setAppFill(fill => !fill);
    } catch (_) { showToast('无法切换应用内全屏'); }
  }, [showToast]);

  useEffect(() => {
    if (!stageDrawer) return;
    const measure = () => setDrawerPlacement(measureDrawerPlacement());
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [stageDrawer, sourceInfo, pictureMode, measureDrawerPlacement]);

  // 应用内全屏隐藏主导航与页面操作栏；退出时恢复。
  useEffect(() => {
    document.body?.classList?.toggle?.('player-app-fill', appFill);
    return () => document.body?.classList?.remove?.('player-app-fill');
  }, [appFill]);

  useEffect(() => {
    if (active) return;
    setAppFill(false);
    setStageDrawer(null);
  }, [active]);

  // Esc 先关闭抽屉，再退出应用内全屏；拦截后续处理器避免一次退出多层。
  useEffect(() => {
    if (!stageDrawer && !appFill) return;
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation?.();
      if (stageDrawer) closeStageDrawer();
      else setAppFill(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stageDrawer, appFill, closeStageDrawer]);

  // 长剧定位：打开选集与切集后把当前集滚入可见区域；nearest 在已可见时不产生滚动。
  const locateEpisode = useCallback((chipRefs, index, block = 'nearest') => {
    const chip = chipRefs.current?.get(index);
    const list = chip?.parentElement;
    if (!list?.clientHeight) return;
    const bounds = chip.getBoundingClientRect();
    const viewport = list.getBoundingClientRect();
    if (block === 'center') list.scrollTop += bounds.top - viewport.top - (list.clientHeight - bounds.height) / 2;
    else if (bounds.top < viewport.top) list.scrollTop += bounds.top - viewport.top;
    else if (bounds.bottom > viewport.bottom) list.scrollTop += bounds.bottom - viewport.bottom;
  }, []);

  useEffect(() => { locateEpisode(panelChipRefs, currentIndex); }, [currentIndex, detail?.series_id, episodes.length, episodesOpen, appFill, locateEpisode]);
  useEffect(() => { if (stageDrawer === 'episodes') locateEpisode(drawerChipRefs, stateRef.current.currentIndex, 'center'); }, [stageDrawer, locateEpisode]);
  useEffect(() => { locateEpisode(drawerChipRefs, currentIndex); }, [currentIndex, locateEpisode]);

  const continueNextSeason = useCallback(async () => {
    const target = seasonNext?.unique;
    if (!target) return;
    await switchSeason(target.series_id);
  }, [seasonNext, switchSeason]);

  const focusSeasonSwitcher = useCallback(() => {
    const flash = node => {
      if (!node) return;
      node.scrollIntoView?.({ block: 'center' });
      node.classList?.add?.('season-flash');
      setTimeout(() => node.classList?.remove?.('season-flash'), 1600);
    };
    if (!appFillRef.current) {
      // 未进入应用内全屏：直接定位页面上的季切换栏。
      flash(seasonSwitcherRef.current);
      return;
    }
    setStageDrawer('episodes');
    setDrawerPlacement(measureDrawerPlacementRef.current?.() || 'overlay');
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => flash(drawerSeasonRef.current || seasonSwitcherRef.current));
    else flash(drawerSeasonRef.current || seasonSwitcherRef.current);
  }, []);

  // 初次进入与浏览点播共用一次载入，避免两个初始化请求互相覆盖。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await loadSeriesList();
        if (cancelled) return;
        const wanted = target?.seriesId && list.find(s => String(s.series_id) === String(target.seriesId));
        const selected = wanted || [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        if (selected) await switchSeries(selected.series_id, wanted ? target.vidIndex : 0, !!(wanted && target.resume));
        else setLoading(false);
      } catch (e) {
        if (!cancelled) { setLoading(false); showToast('加载剧库失败: ' + e.message); }
      }
    })();
    return () => { cancelled = true; };
  }, [target?.ts, loadSeriesList, switchSeries, showToast]);

  useEffect(() => {
    const pending = pendingTargetRef.current;
    if (loading || qualityLoading || !pending || pending.seriesId !== String(activeSeriesId) || String(detail?.series_id) !== pending.seriesId) return;
    pendingTargetRef.current = null;
    const episode = detail?.episodes.find(e => e.vid_index === pending.vidIndex);
    if (!usableLocal(episode, pending.seriesId)) startOnlinePlay(pending.vidIndex, pending.seekTo);
  }, [loading, qualityLoading, detail, activeSeriesId, startOnlinePlay, usableLocal]);

  // 从列表移除一部短剧（只取消登记，不删本地文件）
  const removeSeries = async (sid, title) => {
    const res = await window.electronAPI.removeSeries(sid);
    if (!res || !res.success) {
      showToast((res && res.error) || '移除失败');
      return;
    }
    showToast(`已从列表移除《${title}》（本地文件保留）`);
    const list = await loadSeriesList();
    refreshCacheInfo();
    if (String(sid) === String(activeSeriesId)) {
      const next = list[0];
      if (next) await switchSeries(next.series_id);
      else {
        selectionVersion.current++;
        selectedSeriesRef.current = '';
        resetPlayback();
        setActiveSeriesId('');
        setDetail(null);
      }
    }
  };

  const purgeEmpty = async () => {
    const res = await window.electronAPI.purgeEmptySeries();
    if (res && res.success) {
      showToast(res.count > 0 ? `已清理 ${res.count} 部未下载的剧` : '没有可清理的剧');
      const list = await loadSeriesList();
      refreshCacheInfo();
      if (!list.some((s) => String(s.series_id) === String(activeSeriesId))) {
        if (list[0]) await switchSeries(list[0].series_id);
        else { selectionVersion.current++; selectedSeriesRef.current = ''; resetPlayback(); setActiveSeriesId(''); setDetail(null); }
      }
    }
  };

  const restoreDismissed = async () => {
    const res = await window.electronAPI.restoreDismissedSeries();
    if (res && res.success) {
      showToast(res.count > 0 ? `已恢复 ${res.count} 部被移除的剧` : '没有被移除的剧');
      await loadSeriesList();
      refreshCacheInfo();
    }
  };

  const clearCache = async () => {
    releasePrefetch();
    syncTasks({});
    if (onlineRequestRef.current && (!compatMap[currentIndex] || compatMap[currentIndex].original)) {
      stopPlayback('在线播放已停止，可重试本集继续观看');
    }
    try {
      const r = await window.electronAPI.clearOnlineCache();
      if (!r?.success) { showToast(r?.error || '清理播放缓存失败'); return; }
      setEpisodeCache(null);
      refreshCacheInfo();
      refreshEpisodeCache();
      showToast('已清空在线播放缓存');
    } catch (e) { showToast('清理播放缓存失败: ' + e.message); }
  };

  const downloadEpisode = async (vidIndex) => {
    if (qualityLoading || !episodes.some((ep) => ep.vid_index === vidIndex && !ep.locked)) return;
    const selection = selectionVersion.current;
    const media = mediaVersion.current;
    try {
      const res = await window.electronAPI.downloadSingleEpisode(activeSeriesId, vidIndex, downloadQuality);
      if (res && res.success) {
        showToast(res.count > 0 ? `第 ${vidIndex} 集已加入下载队列` : `第 ${vidIndex} 集已在队列中`);
        if (selection === selectionVersion.current && media === mediaVersion.current
          && String(activeSeriesId) === selectedSeriesRef.current && stateRef.current.currentIndex === vidIndex) setWaitingFor(vidIndex);
      } else {
        showToast((res && res.error) || '加入下载失败');
      }
    } catch (error) { showToast(error.message || '加入下载失败，请重试'); }
  };

  const downloadMissing = async () => {
    if (qualityLoading || downloadingFollowingRef.current) return;
    const seriesId = activeSeriesId;
    const quality = downloadQuality;
    const afterIndex = Number(currentIndex);
    const missing = episodes.filter((e) => Number(e.vid_index) > afterIndex && !e.locked
      && !['completed', 'pending', 'downloading'].includes(e.status))
      .sort((a, b) => Number(a.vid_index) - Number(b.vid_index));
    if (!missing.length) {
      showToast('当前集之后没有待下载的集数（已完成或已在队列中）');
      return;
    }
    downloadingFollowingRef.current = true;
    setDownloadingFollowing(true);
    let ok = 0;
    let added = 0;
    let firstError = '';
    for (const ep of missing) {
      try {
        const r = await window.electronAPI.downloadSingleEpisode(seriesId, ep.vid_index, quality);
        if (r?.success) { ok++; added += Number(r.count) || 0; }
        else if (!firstError) firstError = r?.error || '加入下载失败';
      } catch (error) { if (!firstError) firstError = error.message || '加入下载失败'; }
    }
    downloadingFollowingRef.current = false;
    setDownloadingFollowing(false);
    showToast(firstError ? `${ok} 集提交成功，${missing.length - ok} 集失败：${firstError}`
      : `当前第 ${afterIndex} 集之后：新增 ${added} 集下载${ok > added ? `，${ok - added} 集已在队列中` : ''}`);
  };

  // 一键合并当前这部剧（弹出格式选择）
  const mergeThisSeries = async (compatible) => {
    setMerging(true);
    setMergeAsk(false);
    try {
      const res = await window.electronAPI.mergeSeries(activeSeriesId, '', { compatible });
      if (!res || !res.success) {
        showToast((res && res.error) || '合并失败');
        return;
      }
      const tip = compatible
        ? `开始兼容格式合并 ${res.count} 集（H.264，耗时较长）`
        : `开始合并 ${res.count} 集，约 ${(res.totalBytes / 1073741824).toFixed(2)} GB`;
      showToast(`${tip}，可在「下载管理」查看进度`);
      if (res.codecWarning) showToast(res.codecWarning);
    } catch (e) {
      showToast('合并异常: ' + e.message);
    } finally {
      setMerging(false);
    }
  };

  useDialogKeyboard(active && !!(confirmAsk || mergeAsk), () => { setConfirmAsk(null); setMergeAsk(false); }, '.player-confirm');

  useEffect(() => {
    if (actionsHidden || !active || !portrait) {
      setPortraitActionsOpen(false);
      setEpisodesOpen(false);
    }
    if (actionsHidden || !active) setPickerOpen(false);
  }, [actionsHidden, active, portrait]);

  useEffect(() => {
    window.electronAPI.setEpisodePanelOpen?.(active && portrait && episodesOpen && !loading).catch(() => {
      setEpisodesOpen(false);
      showToast('选集无法展开，请重试');
    });
  }, [active, portrait, episodesOpen, loading, showToast]);
  useEffect(() => () => { window.electronAPI.setEpisodePanelOpen?.(false).catch(() => {}); }, []);

  // ===== 渲染 =====
  if (loading) {
    return <div className="player-container"><div className="player-empty">加载中…</div></div>;
  }

  if (!seriesList.length) {
    return (
      <div className="player-container">
        <div className="player-header">
          <div className="player-title"><Play size={22} /><h2>我的剧库</h2></div>
        </div>
        <div className="player-empty">
          <Film size={40} />
          <p>还没有可播放的短剧</p>
          <p className="player-empty-sub">先发现或搜索一部短剧，在这里选择集数、观看和管理。</p>
          <div className="player-empty-actions">
            {onNavigate && (
              <button className="btn btn-primary" onClick={() => onNavigate('browse')}>
                发现短剧
              </button>
            )}
            {onNavigate && (
              <button className="btn btn-outline" onClick={() => onNavigate('download')}>
                搜索剧集
              </button>
            )}
          </div>
          {dismissedCount > 0 && (
            <button className="btn btn-outline btn-sm" onClick={restoreDismissed}>
              恢复已移除的 {dismissedCount} 部
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`player-container ${portraitActionsOpen ? 'portrait-actions-open' : ''} ${episodesOpen ? '' : 'episodes-collapsed'}`}>
      <div className="player-header" hidden={actionsHidden}>
        <div className="player-title">
          <Play size={22} />
          <h2>我的剧库</h2>
        </div>
        <div className="player-header-right" id="player-management">
          <p className="player-download-quality-hint" id="player-download-quality-hint">清晰度用于在线播放、自动缓存和新建下载。自动清理缓存，手动下载单独保留。</p>
          <span className="player-stat">已下载 {playableCount} / {episodes.length || 0} 集</span>

          <span className="player-stat">缓存保留前后各 5 集 · {linuxPlayback ? '优先准备后续集' : '默认 H.264 兼容'}</span>
          {seriesCompat && <button className="btn btn-outline btn-sm" disabled={qualityLoading || !!onlineProgress || !!compatProgress} onClick={restoreSeriesDecode}
            title="点击可将本剧改为自动解码">
            本剧：兼容解码 · 恢复自动
          </button>}
          {!seriesCompat && activeSeriesId && <button className="btn btn-outline btn-sm" disabled={qualityLoading || !!onlineProgress || !!compatProgress} onClick={() => {
            rememberSeriesCompat(activeSeriesId, true);
            seriesCompatRef.current = { seriesId: String(activeSeriesId), enabled: true };
            setSeriesCompat(true); releasePrefetch(); syncTasks({});
            showToast('本剧已选择 H.264 兼容解码');
            if (linuxPlayback && isOnlinePlaying && !compatUrl && !onlineRequestRef.current?.directH264) startCompatPlay(currentIndex);
          }}>本剧：自动解码 · 使用 H.264</button>}
          {sourceInfo && <span className="player-stat">片源 {sourceInfo.width} × {sourceInfo.height}</span>}
          <button
            aria-pressed={autoNext}
            className={`btn btn-outline ${autoNext ? 'btn-autonext-on' : ''}`}
            onClick={() => setAutoNext(!autoNext)}
            title={`播完自动播放下一集（${formatShortcut(shortcuts.autoNext)}）`}
          >
            <Layers size={15} />
            连播 {autoNext ? '开' : '关'}
          </button>
          <label className="player-download-quality">
            <span>播放 / 下载清晰度</span>
            <select className="input-field" value={downloadQuality} disabled={qualityLoading}
              aria-describedby="player-download-quality-hint"
              onChange={(event) => changeQuality(event.target.value)}>
              <option value="auto">自动（App 最高画质）</option>
              <option value="1080p">1080P</option>
              <option value="720p">720P</option>
            </select>
          </label>
          <button className="btn btn-outline" onClick={downloadMissing} disabled={qualityLoading || downloadingFollowing}
            title="只下载当前集之后尚未完成且未在队列中的集数；不包含当前集和之前的集数">
            <Download size={15} />
            {downloadingFollowing ? '正在加入队列…' : '下载后续未完成集'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setMergeAsk(true)}
            disabled={merging || playableCount === 0}
            title="把已下载的分集合并成单个 mp4，方便一次性看完"
          >
            <Layers size={15} />
            {merging ? '提交中...' : '合并导出全集'}
          </button>
        </div>
      </div>

      {/* 剧集选择：当前剧 + 下拉管理面板（替代原来会越堆越长的横条） */}
      <div className="player-series-row" hidden={actionsHidden}>
        <div className="player-series-current">
          <span className="player-series-label">正在播放</span>
          <span className="player-series-name" title={detail ? detail.series_title : ''}>
            {detail ? detail.series_title : '—'}
          </span>
        </div>
        <div className="player-series-actions">
        <button className="btn btn-outline portrait-management-toggle" aria-expanded={portraitActionsOpen}
          aria-controls="player-management" onClick={() => setPortraitActionsOpen((open) => !open)}>管理</button>
        <button
          aria-expanded={pickerOpen}
          className={`btn btn-outline series-picker-btn ${pickerOpen ? 'open' : ''}`}
          onClick={() => setPickerOpen((v) => !v)}
        >
          切换剧集
          <span className="series-count">{seriesList.length}</span>
          <ChevronDown size={15} />
        </button>
        </div>
      </div>

      {!actionsHidden && <div ref={seasonSwitcherRef} className="player-season-switcher"><SeasonSwitcher seriesId={activeSeriesId} onSwitch={switchSeason} /></div>}

      {pickerOpen && !actionsHidden && (
        <div className="series-picker">
          <div className="series-picker-head">
            <input
              type="text"
              className="input-field"
              aria-label="在我的剧库搜索"
              placeholder="搜索剧名…"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
            />
            <button className="icon-btn" title="关闭" onClick={() => setPickerOpen(false)}>
              <X size={16} />
            </button>
          </div>

          <div className="series-picker-list">
            {seriesList.length === 0 && <div className="series-picker-empty">还没有剧集</div>}
            {seriesList
              .filter((s) => !pickerQuery.trim() || (s.series_title || '').includes(pickerQuery.trim()))
              .map((s) => {
                const isActive = String(s.series_id) === String(activeSeriesId);
                const dl = downloadedMap[String(s.series_id)];
                return (
                  <div
                    key={s.series_id}
                    role="button"
                    tabIndex={0}
                    aria-label={`选择剧集 ${s.series_title}`}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || !['Enter', ' '].includes(e.key)) return;
                      e.preventDefault();
                      if (!isActive) switchSeries(s.series_id);
                      setPickerOpen(false);
                    }}
                    className={`series-row ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      if (!isActive) switchSeries(s.series_id);
                      setPickerOpen(false);
                    }}
                  >
                    <div className="series-row-cover">
                      {s.cover ? <img src={s.cover} alt="" loading="lazy" /> : <Film size={14} />}
                    </div>
                    <div className="series-row-body">
                      <div className="series-row-title">{s.series_title}</div>
                      <div className="series-row-sub">
                        {dl && dl.completed > 0 ? `已下载 ${dl.completed}/${dl.total} 集` : `共 ${(s.episodes || []).length} 集 · 未下载`}
                      </div>
                    </div>
                    {isActive && <span className="series-row-cur">播放中</span>}
                    {(() => {
                      const st = storageMap[String(s.series_id)];
                      const hasFiles = st && st.files > 0;
                      return (
                        <>
                          {hasFiles && (
                            <button
                              className="icon-btn icon-btn-danger series-row-del"
                              title={`删除本地文件（${st.files} 个 · ${fmtSize(st.bytes)}）`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmAsk({
                                  title: '删除本地文件',
                                  message: `将删除《${s.series_title}》已下载的 ${st.files} 个文件，释放 ${fmtSize(st.bytes)}。\n剧集仍保留在列表中，之后可以随时在线播放或重新下载。`,
                                  okText: '删除文件',
                                  danger: true,
                                  onOk: async () => {
                                    if (String(s.series_id) === selectedSeriesRef.current && !onlineUrl && (!compatUrl || compatMap[currentIndex].original)) stopPlayback('本地播放已停止，可重新连接片源观看');
                                    const r = await window.electronAPI.deleteSeriesFiles(s.series_id);
                                    if (r && r.success) {
                                      showToast(`已删除 ${r.count} 个文件，释放 ${fmtSize(r.freed)}`);
                                      await loadDetail(activeSeriesId);
                                      refreshCacheInfo();
                                    } else {
                                      showToast((r && r.error) || '删除失败');
                                    }
                                  },
                                });
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                          <button
                            className="icon-btn series-row-del"
                            title="从列表移除（不删除本地文件）"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeSeries(s.series_id, s.series_title);
                            }}
                          >
                            <X size={15} />
                          </button>
                        </>
                      );
                    })()}
                  </div>
                );
              })}
          </div>

          <div className="series-picker-foot">
            {storageTotal.files > 0 && (
              <span className="series-picker-usage">
                本地已占用 <b>{fmtSize(storageTotal.bytes)}</b> / {storageTotal.files} 个文件
              </span>
            )}
            <button className="btn btn-outline btn-sm" onClick={purgeEmpty} title="把没有下载过任何一集的剧从列表中移除">
              <Trash2 size={14} />
              清理未下载的剧
            </button>
            {dismissedCount > 0 && (
              <button className="btn btn-outline btn-sm" onClick={restoreDismissed}>
                恢复已移除 ({dismissedCount})
              </button>
            )}
            {storageTotal.files > 0 && (
              <button
                className="btn btn-outline btn-sm btn-danger-text"
                title="删除所有已下载的本地文件"
                onClick={() => {
                  setConfirmAsk({
                    title: '删除全部本地文件',
                    message: `将删除所有已下载的剧集文件，共 ${storageTotal.files} 个文件、${fmtSize(storageTotal.bytes)}。\n剧集列表与分集信息会保留，之后仍可在线播放或重新下载。`,
                    okText: '全部删除',
                    danger: true,
                    onOk: async () => {
                      if (current?.fileUrl && !onlineUrl && (!compatUrl || compatMap[currentIndex].original)) stopPlayback('本地播放已停止，可重新连接片源观看');
                      const r = await window.electronAPI.deleteAllDownloaded();
                      if (r && r.success) {
                        showToast(`已删除 ${r.count} 个文件，释放 ${fmtSize(r.freed)}`);
                        await loadDetail(activeSeriesId);
                        refreshCacheInfo();
                      } else {
                        showToast((r && r.error) || '删除失败');
                      }
                    },
                  });
                }}
              >
                删除全部已下载
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={clearCache} title="清理在线播放的磁盘缓存">
              <Zap size={14} />
              清空播放缓存{cacheInfo.count > 0 ? ` (${cacheInfo.count})` : ''}
            </button>
            {compatCache.files > 0 && (
              <button className="btn btn-outline btn-sm" onClick={clearCompatCache} title="删除转码产生的兼容格式文件">
                <Trash2 size={14} />
                清空转码缓存 ({fmtSize(compatCache.bytes)})
              </button>
            )}
          </div>
        </div>
      )}

      <div className="player-viewing-layout">
      {/* 播放区 */}
      <div className={`player-stage ${windowFill ? 'player-window-fill' : ''} ${appFill ? 'player-app-fill' : ''}`} data-picture-mode={pictureMode} ref={stageRef}>
          <video
            ref={videoRef}
            crossOrigin="anonymous"
            src={videoSrc || undefined}
            className="player-video"
            aria-busy={!canPlay || mediaBuffering}
            tabIndex={0}
            aria-label={`视频画面，${formatShortcut(shortcuts.play)}播放或暂停`}
            onClick={() => {
              const video = videoRef.current;
              if (!canPlay || !video) return;
              video.focus({ preventScroll: true });
              if (video.paused) video.play().catch(() => showToast('暂时无法播放，请重试本集'));
              else video.pause();
            }}
            onLoadedMetadata={handleMetadata}
            onPlay={(event) => {
              const media = loadedMediaRef.current;
              if (!canPlay || playbackVersion !== mediaVersion.current || !media || media.version !== mediaVersion.current || media.element !== event.currentTarget) {
                event.currentTarget.pause();
                return;
              }
              setSeasonEndPrompt(false);
            }}
            onRateChange={(event) => {
              const v = event.currentTarget;
              if (!canPlay || v !== videoRef.current || v.readyState === 0 || loadedMediaRef.current?.version !== mediaVersion.current) return;
              if (v.currentSrc && v.currentSrc !== videoSrc) return;
              if (v.playbackRate !== playbackRateRef.current) changePlaybackRate(v.playbackRate);
            }}
            onEnded={() => { if (canPlay && playbackVersion === mediaVersion.current && (!videoRef.current || loadedMediaRef.current?.version === mediaVersion.current)) handleEnded(); }}
            onPause={() => { if (linuxPlayback) decodeWatchRef.current?.guard.reset(); persistPosition(true); }}
            onSeeking={() => {
              if (linuxPlayback) decodeWatchRef.current?.guard.reset();
              if (loadedMediaRef.current) loadedMediaRef.current.inSeek = true;
            }}
            onSeeked={event => {
              const media = loadedMediaRef.current;
              if (media?.element !== event.currentTarget) return;
              media.inSeek = false;
              media.watchFrom = media.element.currentTime;
            }}
            onTimeUpdate={event => {
              prepareNextEpisode(event);
              const media = loadedMediaRef.current;
              const video = event.currentTarget;
              if (media?.element !== video || media.version !== mediaVersion.current || !media.played || media.watched
                || media.inSeek || video.seeking || video.paused || video.currentTime <= media.watchFrom) return;
              media.watched = true;
              persistPosition(true);
            }}
            onPlaying={(event) => { handlePlaying(event); prepareNextEpisode(event); }}
            onWaiting={() => {
              if (canPlay && playbackVersion === mediaVersion.current) {
                if (linuxPlayback) decodeWatchRef.current?.guard.reset();
                setMediaBuffering(true);
              }
            }}
            onCanPlay={() => { if (canPlay && playbackVersion === mediaVersion.current) setMediaBuffering(false); }}
            onError={(event) => {
              if (!canPlay || compatRequestRef.current || playbackVersion !== mediaVersion.current) return;
              if (videoRef.current && event.currentTarget !== videoRef.current) return;
              if (event.currentTarget.currentSrc && event.currentTarget.currentSrc !== videoSrc) return;
              const errorCode = event.currentTarget.error?.code;
              // Chromium also reports an unavailable HTTP stream as unsupported source (4).
              const unavailableOnline = errorCode === 4 && videoSrc === onlineUrl;
              if (unavailableOnline && reconnectOnce()) return;
              const failedDecode = [3, 4].includes(errorCode);
              if (!failedDecode && errorCode === 2 && reconnectOnce()) return;
              if (isOnlinePlaying && (errorCode === 2 || unavailableOnline)) {
                recoverOnlineFailure(current, '在线播放失败，正在尝试本地文件或下载');
                return;
              }
              if (!failedDecode) {
                const seekTo = currentPosition(); resetPlayback(); pendingSeekRef.current = seekTo;
                setPlaybackError('视频加载失败，请重试本集或检查网络');
              }
              setMediaBuffering(false);
              setDecodeFailed(failedDecode);
              showToast(failedDecode ? '片源暂时无法播放，请先重新连接片源' : '视频加载失败，请重试本集或检查网络');
              if (failedDecode && !unavailableOnline) tryAutoCompat(currentIndex, 'decode-error');
            }}
          />
        <VideoEnhancement videoRef={videoRef} source={videoSrc} available={canPlay && active} enhancement={enhancement} />
        {danmaku.sourceKind === 'official'
          ? <OfficialDanmaku videoRef={videoRef} source={videoSrc} available={canPlay && active} danmaku={danmaku} />
          : <CommentDanmaku videoRef={videoRef} source={videoSrc} available={canPlay && active} danmaku={danmaku} />}
        <PlayerControls danmaku={showDanmakuControls ? danmaku : null} enhancement={enhancement} continuing={autoAdvancing && !playbackError && !decodeFailed} autoContinue={autoNext && !!findNext(currentIndex)} shortcuts={shortcuts} onToggleFullscreen={toggleFullscreen} portrait={portrait} windowFill={windowFill} onWindowFill={setWindowFill} videoRef={videoRef} stageRef={stageRef} source={videoSrc} available={canPlay}
          pictureMode={pictureMode} onPictureModeChange={changePictureMode} rate={playbackRate} onRateChange={changePlaybackRate} onError={showToast}
          appFill={appFill} onToggleAppFill={toggleAppFill} stageDrawer={stageDrawer} onOpenStageDrawer={openStageDrawer} drawerButtonsRef={{ episodes: episodesBtnRef, info: infoBtnRef }} />
        {!canPlay && (
          <div className="player-placeholder" style={{ position: 'absolute', inset: 0 }}>
            {playbackError ? (
              <><Film size={34} /><p role="alert">{playbackError}</p><div className="player-placeholder-actions">
                <button className="btn btn-primary" onClick={retryPlayback}>{current?.status === 'completed' ? '重试本集' : '重试本集（在线播放）'}</button>
                {downloadQuality !== 'auto' && <button className="btn btn-outline" disabled={qualityLoading}
                  onClick={() => changeQuality('auto')}>改用 App 最高可用画质</button>}
                {current?.vid && <button className="btn btn-outline" onClick={() => startOnlinePlay(currentIndex, undefined, true)}>重新连接片源</button>}
                {fallbackRef.current && !fallbackRef.current.submitting && <button className="btn btn-outline" onClick={() => startCompatPlay(currentIndex, true)}>转码后播放</button>}
              </div></>
            ) : onlineProgress && onlineProgress.vid && (!current || current.vid === onlineProgress.vid) ? (
              <>
                <RefreshCw size={30} className="spin" />
                <p>{onlineProgress.phase === 'preparing' ? '正在连接片源…' : onlineProgress.phase === 'reconnecting' ? '正在重连片源…'
                  : onlineProgress.phase === 'decrypting' ? '正在准备播放…' : '正在缓冲在线播放…'}</p>
                {onlineProgress.phase !== 'preparing' && onlineProgress.phase !== 'reconnecting' && <div className="player-wait-bar">
                  <div className="player-wait-fill" style={{ width: `${onlineProgress.percent || 0}%` }} />
                </div>}
                <span className="player-placeholder-sub">
                  {onlineProgress.phase === 'preparing' ? '获取可播放地址' : onlineProgress.phase === 'reconnecting' ? '正在尝试备用入口或更新会话'
                    : `${onlineProgress.percent || 0}%`}
                  {onlineProgress.total ? ` · ${(onlineProgress.received / 1048576).toFixed(1)} / ${(onlineProgress.total / 1048576).toFixed(1)} MB` : ''}
                  {' · 不写入下载目录'}
                </span>
                <button className="btn btn-outline" onClick={() => stopPlayback()}>取消播放</button>
              </>
            ) : waitingFor != null ? (
              <>
                <RefreshCw size={30} className="spin" />
                <p>第 {waitingFor} 集正在下载，完成后自动播放…</p>
                {(() => {
                  const ep = episodes.find((e) => e.vid_index === waitingFor);
                  return ep && ep.status === 'downloading' ? (
                    <div className="player-wait-bar">
                      <div className="player-wait-fill" style={{ width: `${ep.progress || 0}%` }} />
                    </div>
                  ) : null;
                })()}
                <span className="player-placeholder-sub">下载完成后继续本集；取消等待不会停止下载</span>
                <button className="btn btn-outline" onClick={() => stopPlayback('已取消等待，下载会继续；可在下载管理查看')}>取消等待</button>
              </>
            ) : current?.locked || (episodes.length > 0 && episodes.every((ep) => ep.locked)) ? (
              <><Film size={34} /><p>需在来源平台解锁后观看</p><span className="player-placeholder-sub">本应用不提供解锁</span></>
            ) : current ? (
              <>
                <Film size={34} />
                <p>
                  第 {current.vid_index} 集
                  {current.status === 'downloading' ? '正在下载' : current.status === 'pending' ? '排队中' : '尚未下载'}
                </p>
                {current.status === 'downloading' && (
                  <div className="player-wait-bar">
                    <div className="player-wait-fill" style={{ width: `${current.progress || 0}%` }} />
                  </div>
                )}
                <div className="player-placeholder-actions">
                  <button className="btn btn-primary" disabled={qualityLoading} onClick={() => startOnlinePlay(current.vid_index)}>
                    <Play size={15} />
                    在线播放（自动缓存）
                  </button>
                  <button className="btn btn-outline" disabled={qualityLoading} onClick={() => downloadEpisode(current.vid_index)}>
                    <Download size={15} />
                    下载本集
                  </button>
                </div>
                <span className="player-placeholder-sub">在线播放不保存到下载目录，准备产生的临时文件会自动清理</span>
              </>
            ) : (
              <>
                <Film size={34} />
                <p>请选择一集开始播放</p>
              </>
            )}
          </div>
        )}

        {canPlay && mediaBuffering && !compatProgress && (
          <div className="compat-overlay" role="status">
            <RefreshCw size={26} className="spin" /><p>正在加载视频…</p>
            <button className="btn btn-outline" onClick={() => stopPlayback()}>取消播放</button>
          </div>
        )}

        {/* 兼容模式浮层：解码失败提示 / 转码进度 */}
        {compatProgress && compatProgress.vidIndex === currentIndex && (
          <div className="compat-overlay">
            <RefreshCw size={26} className="spin" />
            <p>正在转码为兼容格式（H.264）…</p>
            <div className="player-wait-bar">
              <div className="player-wait-fill" style={{ width: `${compatProgress.percent || 0}%` }} />
            </div>
            <span className="compat-overlay-sub">
              {compatProgress.percent || 0}% · 正在处理当前视频，完成后切换到兼容片源
            </span>
            <button className="btn btn-outline" onClick={() => stopPlayback('转码已取消，可重试本集继续观看')}>取消转码</button>
          </div>
        )}

        {!compatProgress && decodeFailed && canPlay && (
          <div className="compat-overlay">
            <Film size={30} />
            <p>当前片源暂时无法播放</p>
            <span className="compat-overlay-sub" role={compatError ? 'alert' : undefined}>
              {compatError || '请先重新连接片源；若仍有画面或格式问题，可尝试转码为 H.264 兼容格式。'}
            </span>
            <div className="player-placeholder-actions">
              <button className="btn btn-primary" onClick={retryPlayback}>重试本集</button>
              <button className="btn btn-outline" onClick={() => startOnlinePlay(currentIndex, undefined, true)}>重新连接片源</button>
              <button className="btn btn-outline" onClick={() => startCompatPlay(currentIndex, true)}>
                <Zap size={15} />
                重新转码后播放
              </button>

            </div>
          </div>
        )}

        {/* 本季最后一集播完：唯一的下一季直接续播；候选不明确时进入季选择 */}
        {seasonEndPrompt && canPlay && seasonNext?.seriesId === String(activeSeriesId) && seasonNext.unique && (
          <div className="season-next-cta" role="status">
            <p>本季已播完</p>
            <button className="btn btn-primary" onClick={continueNextSeason}>继续第 {seasonNext.nextNumber} 季</button>
            <span className="season-next-sub">
              {seasonNext.resumeIndex ? `接着第 ${seasonNext.resumeIndex} 集看` : '从该季第一可播集开始'}
            </span>
          </div>
        )}
        {seasonEndPrompt && canPlay && seasonNext?.seriesId === String(activeSeriesId) && !seasonNext.unique && (seasonNext.candidates?.length || 0) > 0 && (
          <div className="season-next-cta" role="status">
            <p>本季已播完，检测到下一季候选</p>
            <button className="btn btn-outline" onClick={focusSeasonSwitcher}>查看下一季候选</button>
            <span className="season-next-sub">同一季号有多个候选或季关系待确认，请确认剧名后切换</span>
          </div>
        )}

        {/* 应用内全屏抽屉：留白充足时放留白处，空间紧张时叠加在画面上 */}
        {appFill && stageDrawer && (
          <div className={`stage-drawer stage-drawer-${stageDrawer} stage-drawer-${drawerPlacement}`} role="dialog"
            aria-label={stageDrawer === 'episodes' ? '选集' : '播放信息'}>
            <div className="stage-drawer-head">
              <strong>{stageDrawer === 'episodes' ? '选集' : '播放信息'}</strong>
              <button className="icon-btn" aria-label="关闭" onClick={() => closeStageDrawer()}><X size={16} /></button>
            </div>
            {stageDrawer === 'episodes' ? (
              <div className="stage-drawer-body">
                <p className="stage-drawer-summary" title={nextSummary.task?.error || undefined}>{nextSummary.text}</p>
                {EpisodeList({
                  episodes, currentIndex, onPick: goToEpisode, onDownload: downloadEpisode,
                  seriesId: String(activeSeriesId), quality: downloadQuality, tasks: taskStates,
                  readyIndexes, watchedSet, onlineVid,
                  chipRefs: drawerChipRefs.current,
                })}
                <form className="ep-jump" onSubmit={(event) => submitJump(event, index => locateEpisode(drawerChipRefs, index, 'center'))}>
                  <input className="input-field" type="text" inputMode="numeric" aria-label="跳到第几集"
                    placeholder="跳到第 N 集" value={jumpQuery}
                    onChange={(event) => { setJumpQuery(event.target.value); if (jumpError) setJumpError(''); }} />
                  <button className="btn btn-outline btn-sm" type="submit">定位</button>
                  {jumpError && <span className="ep-jump-error" role="alert">{jumpError}</span>}
                </form>
                <div ref={drawerSeasonRef} className="stage-drawer-seasons">
                  <SeasonSwitcher seriesId={activeSeriesId} onSwitch={async sid => { closeStageDrawer(false); await switchSeason(sid); }} />
                </div>
              </div>
            ) : (
              <dl className="stage-info-list">
                {mediaInfoRows.map(([label, value]) => (
                  <div className="stage-info-row" key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>

      <section className="player-episode-panel" id="player-episode-panel" aria-label="选集" hidden={appFill}>
      <div className="player-episode-toolbar">
        <h3 className="portrait-episode-heading">选集
          <span className="ep-next-summary" title={nextSummary.task?.error || '按连播规则跳过锁定集'}>{nextSummary.text}</span>
        </h3>
        <form className="ep-jump" onSubmit={(event) => submitJump(event, index => locateEpisode(panelChipRefs, index, 'center'))}>
          <input className="input-field" type="text" inputMode="numeric" aria-label="跳到第几集"
            placeholder="跳到第 N 集" value={jumpQuery}
            onChange={(event) => { setJumpQuery(event.target.value); if (jumpError) setJumpError(''); }} />
          <button className="btn btn-outline btn-sm" type="submit">定位</button>
          {jumpError && <span className="ep-jump-error" role="alert">{jumpError}</span>}
        </form>
        {linuxPlayback && (
          <label className="prefetch-level-control" title="控制播放中主动准备多少集；缓存文件仍按现有保留窗口和空间规则管理">
            预缓存
            <select className="input-field" aria-label="预缓存档位" value={prefetchLevel} disabled={qualityLoading}
              onChange={(event) => applyPrefetchLevel(event.target.value)}>
              {PREFETCH_LEVELS.map(level => <option key={level.value} value={level.value}>{level.label}</option>)}
            </select>
            <span className="prefetch-cache-size" title="播放缓存占用（不含手动下载）">缓存 {fmtSize(cacheInfo.bytes)}</span>
          </label>
        )}
      </div>
      {/* 播放中的集信息 */}
      {current && (
        <div className="player-now">
          <span className="player-now-title">
            《{detail ? detail.series_title : ''}》第 {current.vid_index} 集
          </span>
          {current.title && <span className="player-now-sub">{current.title}</span>}
          <span className={`player-now-status status-${current.status}`}>
            {current.locked ? '锁定' : current.status === 'completed' ? '可播放' : current.status === 'downloading' ? `下载中 ${current.progress || 0}%` : current.status === 'pending' ? '排队中' : '未下载'}
          </span>
        </div>
      )}

      {detail?.web_accessible_episodes != null && detail.web_accessible_episodes < detail.total && (
        <p className="player-tips">默认使用 App 高清源播放全部目录中的分集，具体可播情况以 App 接口返回为准。</p>
      )}

      {episodes.some((ep) => ep.locked) && <p className="player-tips">锁定集需在来源平台解锁，本应用不提供解锁；连播会跳过锁定集。</p>}

      {/* 分集列表：与全屏抽屉共用同一份列表与状态 */}
      {EpisodeList({
        episodes, currentIndex, onPick: goToEpisode, onDownload: downloadEpisode,
        seriesId: String(activeSeriesId), quality: downloadQuality, tasks: taskStates,
        readyIndexes, watchedSet, onlineVid,
        chipRefs: panelChipRefs.current,
      })}

      <div className="player-tips">
        快捷键：{SHORTCUT_ACTIONS.map(action => `${formatShortcut(shortcuts[action.id])} ${action.label}`).join(' · ')}。可在设置中更改。
        <br />
        <b>未锁定的灰色分集点一下即可在线播放</b>（不保存到下载目录）；双击才加入下载队列。
        连播时遇到未下载的集会自动转在线播放。
      </div>

      </section>
      </div>

      {/^[0-9]{6,30}$/.test(String(activeSeriesId)) && <CommunityPanel seriesId={activeSeriesId} episodeId={current?.vid} title={detail?.series_title || ''} />}
      {toast && <div className="dm-toast dm-toast-success" onClick={() => setToast(null)}>{toast}</div>}

      {/* 合并格式选择 */}
      {mergeAsk && (
        <div className="player-confirm-mask" onClick={() => setMergeAsk(false)}>
          <div className="player-confirm" role="dialog" aria-modal="true" aria-label={confirmAsk ? confirmAsk.title : '合并导出'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title" style={{ color: 'var(--accent)' }}>
              <Layers size={17} />
              合并导出全集
            </div>
            <div className="player-confirm-msg">
              <p>把《{detail ? detail.series_title : ''}》已下载的 {playableCount} 集合并为一个 mp4。</p>
              <p><b>快速合并</b>：保留原画质与编码，处理较快；部分设备可能不支持播放。</p>
              <p><b>兼容合并</b>：转换为兼容性更好的 H.264 格式，处理时间较长。</p>
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setMergeAsk(false)}>取消</button>
              <button className="btn btn-outline" onClick={() => mergeThisSeries(true)} disabled={merging}>
                兼容合并（H.264）
              </button>
              <button className="btn btn-primary" onClick={() => mergeThisSeries(false)} disabled={merging}>
                快速合并
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认 */}
      {confirmAsk && (        <div className="player-confirm-mask" onClick={() => setConfirmAsk(null)}>
          <div className="player-confirm" role="dialog" aria-modal="true" aria-label={confirmAsk ? confirmAsk.title : '合并导出'} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="player-confirm-title">
              <Trash2 size={17} />
              {confirmAsk.title}
            </div>
            <div className="player-confirm-msg">
              {String(confirmAsk.message).split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <div className="player-confirm-foot">
              <button className="btn btn-outline" onClick={() => setConfirmAsk(null)}>取消</button>
              <button
                className={`btn ${confirmAsk.danger ? 'btn-danger-solid' : 'btn-primary'}`}
                onClick={async () => {
                  const fn = confirmAsk.onOk;
                  setConfirmAsk(null);
                  await fn();
                }}
              >
                {confirmAsk.okText || '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Player;
