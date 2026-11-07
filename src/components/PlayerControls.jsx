import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, Settings as SettingsIcon } from './icons';
import './PlayerControls.css';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, formatShortcut, ignoresPlaybackShortcut, shortcutKey } from '../shortcuts';
import { VideoEnhancementControls } from './VideoEnhancement';
import { DanmakuSettings } from './CommentDanmaku';

const formatTime = seconds => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
const Icon = ({ children }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;

export default function PlayerControls({ danmaku, enhancement, shortcuts = DEFAULT_SHORTCUTS, onToggleFullscreen, videoRef, stageRef, source, available, continuing = false, autoContinue = false, rate, onRateChange, onError, pictureMode = 'fit', onPictureModeChange, portrait = false, windowFill = false, onWindowFill, appFill = false, onToggleAppFill, stageDrawer = null, onOpenStageDrawer, drawerButtonsRef }) {
  const [media, setMedia] = useState({ paused: true, ended: false, time: 0, duration: 0, muted: false, volume: 1 });
  const [fullscreen, setFullscreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [danmakuOpen, setDanmakuOpen] = useState(false);
  const danmakuPanelRef = useRef(null);
  const danmakuButtonRef = useRef(null);
  const [danmakuHeight, setDanmakuHeight] = useState(300);
  const [menuHeight, setMenuHeight] = useState(240);
  const [controlsHidden, setControlsHidden] = useState(false);
  const controlsRef = useRef(null);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);
  const speedRef = useRef(null);
  const episodeKeysRef = useRef(new Set());
  const pointerRef = useRef(null);
  const expanded = fullscreen || windowFill;

  useEffect(() => {
    if (!menuOpen) return;
    const measure = () => {
      const stage = stageRef.current?.getBoundingClientRect?.();
      const button = menuButtonRef.current?.getBoundingClientRect?.();
      if (stage && button) setMenuHeight(Math.max(96, button.top - Math.max(8, stage.top) - 16));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (stageRef.current) observer?.observe(stageRef.current);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [menuOpen, fullscreen, windowFill, stageRef]);

  useEffect(() => {
    if (!windowFill) return;
    const escape = event => { if (event.key === 'Escape' && !event.defaultPrevented && !event.target.closest?.('.danmaku-settings')) onWindowFill(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [windowFill, onWindowFill]);

  useEffect(() => {
    const stage = stageRef.current;
    let timer;
    let pauseTimer;
    let dragging = false;
    const scheduleHide = () => {
      clearTimeout(timer);
      // 抽屉打开或键盘焦点在控件内时保持可操作。
      if (available && !media.paused && !menuOpen && !danmakuOpen && !dragging && !stageDrawer) {
        timer = setTimeout(() => {
          if (!controlsRef.current?.querySelector(':focus-visible')) setControlsHidden(true);
        }, 2000);
      }
    };
    const reveal = () => { clearTimeout(pauseTimer); setControlsHidden(false); scheduleHide(); };
    const onKey = event => {
      const physicalKey = event.code || event.key;
      // Keep the release paired across source/effect changes, even if Shift is released first.
      if (event.type === 'keyup' && episodeKeysRef.current.delete(physicalKey)) return;
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      const key = shortcutKey(event);
      if (!menuOpen && !ignoresPlaybackShortcut(event.target) && key && [shortcuts.previous, shortcuts.next].includes(key)) {
        if (event.type === 'keydown') episodeKeysRef.current.add(physicalKey);
        return;
      }
      reveal();
    };
    const onPointerMove = event => {
      const previous = pointerRef.current;
      pointerRef.current = { x: event.screenX, y: event.screenY };
      // Native fullscreen/source changes can dispatch a move without moving the pointer.
      if (previous ? previous.x === event.screenX && previous.y === event.screenY : !event.movementX && !event.movementY) return;
      reveal();
    };
    const startDrag = event => { dragging = !!event.target.closest?.('input[type="range"]'); reveal(); };
    const stopDrag = () => { if (dragging) { dragging = false; reveal(); } };
    const onFocus = event => {
      // Tab and pointerdown reveal immediately; media focus churn is not user activity.
      if (controlsRef.current?.contains(event.target)) reveal();
      else scheduleHide();
    };
    stage?.addEventListener('pointermove', onPointerMove);
    stage?.addEventListener('pointerdown', startDrag);
    stage?.addEventListener('focusin', onFocus);
    stage?.addEventListener('focusout', scheduleHide);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    const onBlur = () => { episodeKeysRef.current.clear(); stopDrag(); };
    window.addEventListener('blur', onBlur);
    // Source changes and automatic handoffs are not user activity.
    if (menuOpen || danmakuOpen || (!continuing && !available)) reveal();
    else if (!continuing && media.paused && !(media.ended && autoContinue)) {
      // A native pause can precede ended; explicit key/click pauses already reveal immediately.
      if (autoContinue && controlsHidden) pauseTimer = setTimeout(() => {
        if (videoRef.current?.paused && !videoRef.current.ended) reveal();
      }, 120);
      else reveal();
    } else scheduleHide();
    return () => {
      clearTimeout(timer);
      clearTimeout(pauseTimer);
      stage?.removeEventListener('pointermove', onPointerMove);
      stage?.removeEventListener('pointerdown', startDrag);
      stage?.removeEventListener('focusin', onFocus);
      stage?.removeEventListener('focusout', scheduleHide);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
      window.removeEventListener('blur', onBlur);
    };
  }, [portrait, expanded, available, media.paused, media.ended, continuing, autoContinue, menuOpen, danmakuOpen, stageDrawer, source, stageRef, shortcuts]);

  useEffect(() => {
    setMenuOpen(false);
    setDanmakuOpen(false);
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setMedia({ paused: video.paused, ended: video.ended, time: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0, muted: video.muted, volume: video.volume });
    const events = ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange', 'volumechange', 'emptied'];
    events.forEach(name => video.addEventListener(name, sync));
    sync();
    return () => events.forEach(name => video.removeEventListener(name, sync));
  }, [videoRef, source, available]);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [stageRef]);

  useEffect(() => {
    if (!menuOpen) return;
    speedRef.current?.focus();
    const outside = event => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false); };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setMenuOpen(false); menuButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [menuOpen]);

  useEffect(() => {
    if (!danmakuOpen) return;
    const measure = () => {
      const stage = stageRef.current?.getBoundingClientRect();
      const controls = controlsRef.current?.getBoundingClientRect();
      if (stage && controls) setDanmakuHeight(Math.max(60, controls.top - stage.top - 12));
    };
    const outside = event => {
      if (!danmakuPanelRef.current?.contains(event.target) && !danmakuButtonRef.current?.contains(event.target)) setDanmakuOpen(false);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (stageRef.current) observer.observe(stageRef.current);
    if (controlsRef.current) observer.observe(controlsRef.current);
    document.addEventListener('pointerdown', outside);
    return () => { observer.disconnect(); document.removeEventListener('pointerdown', outside); };
  }, [danmakuOpen, stageRef]);

  const closeDanmaku = () => { setDanmakuOpen(false); danmakuButtonRef.current?.focus(); };

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!available || !video) return;
    try { if (video.paused) await video.play(); else video.pause(); }
    catch { onError?.('暂时无法播放，请重试本集'); }
  };
  const seek = event => {
    const video = videoRef.current;
    if (!available || !video || !media.duration) return;
    try { video.currentTime = Math.max(0, Math.min(media.duration, Number(event.target.value))); }
    catch { onError?.('暂时无法跳转，请稍后重试'); }
  };
  const changeVolume = event => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Number(event.target.value);
    video.muted = video.volume === 0;
  };

  return (
    <div ref={controlsRef} className={`player-controls ${controlsHidden ? 'controls-hidden' : ''}`} role="group" aria-label="视频播放控制">
      {/* 应用内全屏：右上角提供「选集」和「信息」，控制条隐藏时一并隐藏 */}
      {appFill && onOpenStageDrawer && (
        <div className="player-controls-top">
          <button type="button" ref={drawerButtonsRef?.episodes} aria-label="选集" title="选集"
            aria-pressed={stageDrawer === 'episodes'} onClick={() => onOpenStageDrawer('episodes')}>
            <span className="player-controls-top-label" aria-hidden="true">选集</span>
          </button>
          <button type="button" ref={drawerButtonsRef?.info} aria-label="播放信息" title="播放信息"
            aria-pressed={stageDrawer === 'info'} onClick={() => onOpenStageDrawer('info')}>
            <span className="player-controls-top-label" aria-hidden="true">信息</span>
          </button>
        </div>
      )}
      <input className="player-controls-seek" type="range" aria-label="播放进度" aria-valuetext={`${formatTime(media.time)} / ${formatTime(media.duration)}`} min="0" max={media.duration || 0} step="0.1" value={Math.min(media.time, media.duration)} disabled={!available || !media.duration} onChange={seek} />
      <div className="player-controls-row">
        <button type="button" data-player-control aria-label={media.paused ? '播放' : '暂停'} title={`播放/暂停（${formatShortcut(shortcuts.play)}）`} disabled={!available} onClick={togglePlay}>{media.paused ? <Play size={18} /> : <Pause size={18} />}</button>
        <span className="player-controls-time">{formatTime(media.time)} / {formatTime(media.duration)}</span>
        {danmaku && <div className="player-controls-danmaku">
          <button type="button" data-player-menu className={`danmaku-icon-button ${danmaku.enabled ? 'danmaku-enabled' : ''}`} aria-label={danmaku.enabled ? '关闭弹幕' : '开启弹幕'} aria-pressed={danmaku.enabled}
            title={danmaku.supported ? `显示本集${danmaku.sourceLabel || '弹幕'}` : '仅红果来源支持弹幕'} disabled={!danmaku.supported} onClick={danmaku.toggle}><span className="danmaku-symbol" aria-hidden="true">弹<span className="danmaku-state-mark" /></span></button>
          <button type="button" data-player-menu className="danmaku-icon-button" ref={danmakuButtonRef} aria-label="弹幕设置" title="弹幕设置" aria-haspopup="dialog" aria-expanded={danmakuOpen}
            onClick={() => { setMenuOpen(false); setDanmakuOpen(open => !open); }}>
            <span className="danmaku-symbol" aria-hidden="true">弹<span className="danmaku-settings-mark"><SettingsIcon size={10} /></span></span>
          </button>
          {danmakuOpen && <DanmakuSettings danmaku={danmaku} onClose={closeDanmaku} panelRef={danmakuPanelRef} maxHeight={danmakuHeight} />}
        </div>}
        <div className="player-controls-volume">
          <button type="button" data-player-control aria-label={media.muted ? '取消静音' : '静音'} onClick={() => { const video = videoRef.current; if (video) video.muted = !video.muted; }}>
            <Icon><path d="M11 5 6 9H3v6h3l5 4Z" />{media.muted ? <path d="m16 9 5 6m0-6-5 6" /> : <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />}</Icon>
          </button>
          <input type="range" aria-label="音量" aria-valuetext={`${Math.round((media.muted ? 0 : media.volume) * 100)}%`} min="0" max="1" step="0.05" value={media.muted ? 0 : media.volume} onChange={changeVolume} />
        </div>
        <button type="button" data-player-control aria-label={expanded ? '退出全屏' : '全屏'} title={`${expanded ? '退出全屏' : portrait ? '填满当前窗口' : '全屏'}（${formatShortcut(shortcuts.fullscreen)}）`} onClick={onToggleFullscreen}>
          <Icon><path d={expanded ? 'M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6'} /></Icon>
        </button>
        {onToggleAppFill && (
          <button type="button" data-player-control aria-label={appFill ? '退出应用内全屏' : '应用内全屏'} aria-pressed={appFill}
            title={appFill ? '退出应用内全屏' : '应用内全屏：播放器填满应用窗口，收起导航与页面操作栏'} onClick={onToggleAppFill}>
            <Icon><rect x="3.5" y="4.5" width="17" height="15" rx="2" />{appFill ? <path d="M9 9h6v6H9z" /> : <path d="M7 12h10" />}</Icon>
          </button>
        )}
        <button type="button" data-player-control className="player-controls-rate" aria-label="增加播放速度" title={`播放速度 ${rate}×，点击增加 0.25 倍，4 倍后回到 1 倍`} onClick={() => onRateChange(rate >= 4 ? 1 : Math.min(4, rate + 0.25))}>{rate}×</button>
        <div className="player-controls-options" data-player-menu ref={menuRef}>
          <button type="button" ref={menuButtonRef} aria-label="更多播放选项" title="更多播放选项" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => { setDanmakuOpen(false); setMenuOpen(open => !open); }}>
            <Icon><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></Icon>
          </button>
          {menuOpen && <div className="player-controls-menu" style={{ maxHeight: menuHeight }} role="dialog" aria-label="播放选项">
            <label>播放速度<select ref={speedRef} aria-label="播放速度" value={rate} onChange={event => onRateChange(Number(event.target.value))}>
              {Array.from({ length: 16 }, (_, index) => (index + 1) / 4).map(value => <option key={value} value={value}>{value}×</option>)}
            </select></label>
            <label className="player-picture-mode">画面模式<select aria-label="画面模式" aria-describedby="picture-mode-hint" value={pictureMode} onChange={event => onPictureModeChange(event.target.value)}>
              <option value="fit">适应窗口</option>
              <option value="width">保持宽度</option>
            </select></label>
            <span id="picture-mode-hint">{pictureMode === 'width' ? '按宽度显示，上下可能裁剪。按剧单独记忆。' : '完整显示，随窗口缩放。按剧单独记忆。'}</span>
            {enhancement && <VideoEnhancementControls enhancement={enhancement} available={available} />}
            {SHORTCUT_ACTIONS.map(action => <span key={action.id}>{formatShortcut(shortcuts[action.id])}：{action.label}</span>)}
          </div>}
        </div>
      </div>
    </div>
  );
}
