// Adapted from dawei233/hongguo-drama, commit c884fab6c6e36ad38173e251738b9b35f958383f (GPL-3.0).
// https://github.com/dawei233/hongguo-drama
/**
 * 「用哪个弹幕源」这一项偏好。
 *
 * 单独一个存储键，理由有两个：
 *  1. 视觉设置（字号/透明度/速度/区域/密度/屏蔽词）应该两个源共用 —— 换源不该
 *     把用户的调参清掉，所以那一份仍然放在 `hongguo:comment-danmaku:v1`；
 *  2. 源的取值属于"用哪条数据通路"，与视觉无关，而且 `Settings` 页和播放器都要
 *     读它。放在独立键里，两边用同一个自定义事件同步，不必让 `Settings` 依赖
 *     播放器的 hook。
 */

import { useEffect, useState } from 'react';
import { DEFAULT_DANMAKU_SOURCE, normalizeDanmakuSource } from './danmakuOfficial.mjs';

const STORAGE_KEY = 'hongguo:danmaku-source:v1';
// 同窗口内 localStorage 不会触发 storage 事件，所以自己广播一个。
const CHANGE_EVENT = 'hongguo:danmaku-source-change';

const storage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function readDanmakuSource() {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    return raw === null || raw === undefined ? DEFAULT_DANMAKU_SOURCE : normalizeDanmakuSource(JSON.parse(raw));
  } catch {
    return DEFAULT_DANMAKU_SOURCE;
  }
}

export function writeDanmakuSource(value) {
  const next = normalizeDanmakuSource(value);
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用时本次会话仍然生效，只是不持久化；不打断播放。
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  return next;
}

export function useDanmakuSource() {
  const [source, setSource] = useState(readDanmakuSource);
  useEffect(() => {
    const sync = event => setSource(normalizeDanmakuSource(event?.detail));
    const syncStorage = event => {
      if (event.key === STORAGE_KEY) setSource(readDanmakuSource());
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);
  return source;
}

export { STORAGE_KEY, CHANGE_EVENT };
