const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPublicDetails: (seriesId, vid) => ipcRenderer.invoke('get-public-details', seriesId, vid),
  getEpisodeComments: options => ipcRenderer.invoke('get-episode-comments', options),
  setStealthMode: enabled => ipcRenderer.invoke('set-stealth-mode', enabled),
  onStealthState: cb => {
    const listener = (_event, state) => cb(state);
    ipcRenderer.on('stealth-state', listener);
    return () => ipcRenderer.removeListener('stealth-state', listener);
  },
  // 应用信息 / 官网链接
  getAppLifecycleState: () => ipcRenderer.invoke('get-app-lifecycle-state'),
  setCloseBehavior: value => ipcRenderer.invoke('set-close-behavior', value),
  hideToTray: () => ipcRenderer.invoke('hide-to-tray'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  onAppLifecycleState: cb => {
    const listener = (_event, value) => cb(value);
    ipcRenderer.on('app-lifecycle-state', listener);
    return () => ipcRenderer.removeListener('app-lifecycle-state', listener);
  },
  checkAppUpdate: (options) => ipcRenderer.invoke('check-app-update', options),
  getAppUpdateState: () => ipcRenderer.invoke('get-app-update-state'),
  downloadAppUpdate: () => ipcRenderer.invoke('download-app-update'),
  cancelAppUpdate: () => ipcRenderer.invoke('cancel-app-update'),
  installAppUpdate: () => ipcRenderer.invoke('install-app-update'),
  onAppUpdateState: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('app-update-state', listener);
    return () => ipcRenderer.removeListener('app-update-state', listener);
  },
  openAppUpdate: () => ipcRenderer.invoke('open-app-update'),
  onAppUpdatePreference: cb => {
    const listener = (_event, enabled) => cb(enabled);
    ipcRenderer.on('app-update-preference', listener);
    return () => ipcRenderer.removeListener('app-update-preference', listener);
  },
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),


  // 红果解析与下载
  hongguoResolve: (input) => ipcRenderer.invoke('hongguo-resolve', input),
  hongguoDownloadBatch: (payload) => ipcRenderer.invoke('hongguo-download-batch', payload),

  // 搜索（内嵌浏览器嗅探）
  searchSeries: (keyword, options) => ipcRenderer.invoke('search-series', keyword, options),
  searchResolve: (seriesId) => ipcRenderer.invoke('search-resolve', seriesId),
  searchWindowShow: (visible, sourceUrl) => ipcRenderer.invoke('search-window-show', visible, sourceUrl),
  getSeriesList: (options) => ipcRenderer.invoke('get-series-list', options),
  removeSeries: (seriesId) => ipcRenderer.invoke('remove-series', seriesId),
  purgeEmptySeries: () => ipcRenderer.invoke('purge-empty-series'),
  restoreDismissedSeries: () => ipcRenderer.invoke('restore-dismissed-series'),
  dismissedCount: () => ipcRenderer.invoke('dismissed-count'),
  rescanDownloads: () => ipcRenderer.invoke('rescan-downloads'),

  // 在线播放（内存或临时磁盘缓存 + 自定义流协议）
  setPlaybackWindow: payload => ipcRenderer.invoke('set-playback-window', payload),
  prepareOnlinePlay: (payload) => ipcRenderer.invoke('prepare-online-play', payload),
  releaseOnlinePlay: (payload) => ipcRenderer.invoke('release-online-play', payload),
  onlineCacheStatus: () => ipcRenderer.invoke('online-cache-status'),
  clearOnlineCache: () => ipcRenderer.invoke('clear-online-cache'),
  onOnlinePlayProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('online-play-progress', listener);
    return () => ipcRenderer.removeListener('online-play-progress', listener);
  },

  // 兼容模式（HEVC -> H.264 转码，解决「黑屏有声」）
  transcodeForPlayback: (payload) => ipcRenderer.invoke('transcode-for-playback', payload),
  cancelTranscodeForPlayback: (payload) => ipcRenderer.invoke('cancel-transcode-for-playback', payload),
  compatCacheStatus: () => ipcRenderer.invoke('compat-cache-status'),
  clearCompatCache: () => ipcRenderer.invoke('clear-compat-cache'),
  decodeCapability: () => ipcRenderer.invoke('decode-capability'),
  onTranscodeProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('transcode-progress', listener);
    return () => ipcRenderer.removeListener('transcode-progress', listener);
  },

  // 浏览（分类页）
  getCustomSources: () => ipcRenderer.invoke('get-custom-sources'),
  saveCustomSource: draft => ipcRenderer.invoke('save-custom-source',draft),
  deleteCustomSource: id => ipcRenderer.invoke('delete-custom-source',id),
  testCustomSource: draft => ipcRenderer.invoke('test-custom-source',draft),
  getMediaSources: () => ipcRenderer.invoke('get-media-sources'),
  browseCategories: () => ipcRenderer.invoke('browse-categories'),
  browseList: (options) => ipcRenderer.invoke('browse-list', options),
  playSeries: (payload) => ipcRenderer.invoke('play-series', payload),
  onNavigate: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('navigate', listener);
    return () => ipcRenderer.removeListener('navigate', listener);
  },

  // 播放器
  getSeriesEpisodes: (seriesId) => ipcRenderer.invoke('get-series-episodes', seriesId),
  downloadSingleEpisode: (seriesId, vidIndex, quality) =>
    ipcRenderer.invoke('download-single-episode', seriesId, vidIndex, quality),
  savePlaybackPosition: (seriesId, vidIndex, currentTime) =>
    ipcRenderer.invoke('save-playback-position', seriesId, vidIndex, currentTime),
  getPlaybackPosition: (seriesId) => ipcRenderer.invoke('get-playback-position', seriesId),

  // 观看记录
  getWatchHistory: () => ipcRenderer.invoke('get-watch-history'),
  refreshWatchHistory: () => ipcRenderer.invoke('refresh-watch-history'),
  acknowledgeWatchUpdates: (seriesId, snapshot) => ipcRenderer.invoke('acknowledge-watch-updates', seriesId, snapshot),
  onWatchHistoryUpdated: (cb) => {
    const listener = (_event, data) => cb(data);
    ipcRenderer.on('watch-history-updated', listener);
    return () => ipcRenderer.removeListener('watch-history-updated', listener);
  },

  // 一键合并
  getFfmpegStatus: () => ipcRenderer.invoke('get-ffmpeg-status'),
  mergeSeries: (seriesId, outputName, options) => ipcRenderer.invoke('merge-series', seriesId, outputName, options),
  cancelMerge: (id) => ipcRenderer.invoke('cancel-merge', id),
  getMergeTasks: () => ipcRenderer.invoke('get-merge-tasks'),
  deleteMergeTask: (id) => ipcRenderer.invoke('delete-merge-task', id),
  onMergeProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('merge-progress', listener);
    return () => ipcRenderer.removeListener('merge-progress', listener);
  },
  onMergeTaskAdded: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('merge-task-added', listener);
    return () => ipcRenderer.removeListener('merge-task-added', listener);
  },
  onMergeCompleted: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('merge-completed', listener);
    return () => ipcRenderer.removeListener('merge-completed', listener);
  },
  onMergeFailed: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('merge-failed', listener);
    return () => ipcRenderer.removeListener('merge-failed', listener);
  },

  // 设置
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getWindowLayout: () => ipcRenderer.invoke('get-window-layout'),
  setWindowLayout: (mode) => ipcRenderer.invoke('set-window-layout', mode),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('set-always-on-top', value),
  setEpisodePanelOpen: (value) => ipcRenderer.invoke('set-episode-panel-open', value),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  onStorageError: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('storage-error', listener);
    return () => ipcRenderer.removeListener('storage-error', listener);
  },

  // 网络代理
  getProxyStatus: () => ipcRenderer.invoke('get-proxy-status'),
  testProxy: (draft) => ipcRenderer.invoke('test-proxy', draft),

  // 下载管理
  getDownloadTasks: () => ipcRenderer.invoke('get-download-tasks'),
  deleteTask: (taskId) => ipcRenderer.invoke('delete-task', taskId),
  deleteTasks: (taskIds) => ipcRenderer.invoke('delete-tasks', taskIds),

  // 文件清理
  deleteTaskWithFiles: (taskId, deleteFiles) => ipcRenderer.invoke('delete-task', taskId, { deleteFiles }),
  deleteTasksWithFiles: (taskIds, deleteFiles) => ipcRenderer.invoke('delete-tasks', taskIds, { deleteFiles }),
  deleteSeriesFiles: (seriesId, options) => ipcRenderer.invoke('delete-series-files', seriesId, options),
  deleteEpisodeFile: (seriesId, vidIndex) => ipcRenderer.invoke('delete-episode-file', seriesId, vidIndex),
  getStorageUsage: () => ipcRenderer.invoke('get-storage-usage'),
  deleteAllDownloaded: () => ipcRenderer.invoke('delete-all-downloaded'),
  stopDownload: (taskId) => ipcRenderer.invoke('stop-download', taskId),
  retryTask: (taskId) => ipcRenderer.invoke('retry-task', taskId),
  retryTasks: (taskIds) => ipcRenderer.invoke('retry-tasks', taskIds),
  openFolder: (taskId) => ipcRenderer.invoke('open-folder', taskId),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),

  // 一键启动 / 一键暂停 / 队列状态
  pauseAll: () => ipcRenderer.invoke('pause-all'),
  resumeAll: () => ipcRenderer.invoke('resume-all'),
  getQueueStatus: () => ipcRenderer.invoke('get-queue-status'),

  // 事件监听
  onDownloadProgress: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },
  onDownloadTaskAdded: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-task-added', listener);
    return () => ipcRenderer.removeListener('download-task-added', listener);
  },
  onDownloadCompleted: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-completed', listener);
    return () => ipcRenderer.removeListener('download-completed', listener);
  },
  onDownloadFailed: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-failed', listener);
    return () => ipcRenderer.removeListener('download-failed', listener);
  },
  onDownloadStopped: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-stopped', listener);
    return () => ipcRenderer.removeListener('download-stopped', listener);
  },
  onDownloadQueueChanged: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on('download-queue-changed', listener);
    return () => ipcRenderer.removeListener('download-queue-changed', listener);
  },
});
