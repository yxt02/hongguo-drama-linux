// 播放解码守卫：自动发现「黑屏有声 / 解不出画面」，并探测本机 HEVC 解码能力。
// 判定逻辑与像素采样分离，DOM 能力全部经参数注入，便于在无浏览器的
// 检查脚本里回归（scripts/check-decode-watch.cjs）。

// 采样周期与判定阈值：连续纯黑采样数 × 周期 ≈ 持续黑屏时长。
export const SAMPLE_INTERVAL_MS = 900;
export const BLACK_LUMA_MAX = 4;         // 0-255，平均亮度不高于此视为纯黑帧
export const BLACK_SAMPLES_TO_FAIL = 6;  // ≈5.4s 持续纯黑才判定黑屏有声
export const NO_PIC_SAMPLES_TO_FAIL = 3; // ≈2.7s 一直解不出画面
export const MIN_ADVANCE_SECONDS = 3;    // 黑屏期间播放时间至少推进这么多（证明有声在播）

export const HEVC_CODECS = ['hevc', 'h265', 'h265_hvc1', 'hvc1', 'hev1', 'bytevc1'];

export function isHevcCodec(codec) {
  return HEVC_CODECS.includes(String(codec || '').trim().toLowerCase());
}

/**
 * 探测本机 HEVC 解码能力：'probably' | 'maybe' | 'no' | 'unknown'。
 * createVideo() 返回带 canPlayType 的 video 元素；mediaSource 为可注入的
 * MediaSource（传 null 表示明确不探测该途径）。
 */
export function probeHevcSupport(createVideo, mediaSource = null) {
  const types = ['video/mp4; codecs="hev1.1.6.L93.B0"', 'video/mp4; codecs="hvc1.1.6.L93.B0"'];
  let answered = false;
  try {
    if (mediaSource && typeof mediaSource.isTypeSupported === 'function') {
      answered = true;
      if (types.some((t) => mediaSource.isTypeSupported(t))) return 'probably';
    }
    const video = createVideo ? createVideo() : null;
    if (video && typeof video.canPlayType === 'function') {
      answered = true;
      const answers = types.map((t) => String(video.canPlayType(t) || '').toLowerCase());
      if (answers.includes('probably')) return 'probably';
      if (answers.includes('maybe')) return 'maybe';
      return 'no';
    }
  } catch (_) {
    return 'unknown';
  }
  return answered ? 'no' : 'unknown';
}

/**
 * 是否应在直接播放前就转 H.264 兼容格式。
 * 仅当片源是 HEVC 且本机明确解不了时提前转换，避免先经历一段黑屏；
 * 'maybe' / 'probably' 交给播放中的黑屏守卫兜底。
 */
export function shouldTranscodeFirst(codec, hevcSupport) {
  return isHevcCodec(codec) && hevcSupport === 'no';
}

/**
 * 帧亮度采样器：把当前画面缩到 32x18 求平均亮度（0-255）。
 * 采样失败（画布被污染、尚无帧等）返回 null，不参与黑屏判定。
 */
export function createFrameSampler(doc) {
  let canvas = null;
  let ctx = null;
  return {
    sample(video) {
      try {
        if (!canvas) {
          canvas = doc.createElement('canvas');
          if (!canvas || typeof canvas.getContext !== 'function') return null;
          canvas.width = 32;
          canvas.height = 18;
          ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
          if (!ctx) return null;
        }
        ctx.drawImage(video, 0, 0, 32, 18);
        const { data } = ctx.getImageData(0, 0, 32, 18);
        if (!data || !data.length) return null;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
        }
        return sum / (data.length / 4);
      } catch (_) {
        return null;
      }
    },
  };
}

/**
 * 解码守卫状态机。每个媒体版本创建一个，按采样周期喂入样本：
 *
 *   push({ currentTime, paused, videoWidth, videoDecodedBytes, audioDecodedBytes, luma })
 *
 * 返回 'watch'（继续观察）| 'healthy'（已见正常画面，收工）
 *     | 'fail-no-picture' | 'fail-black-screen'。
 *
 * - videoWidth 持续为 0：完全解不出画面。
 * - videoWidth 正常但视频轨 0 字节、音频在解：解不出画面。
 * - 连续纯黑帧 + 播放时间推进 + 音频解码字节在涨（黑屏有声）：黑屏。
 * 一旦采到可见画面即锁存 healthy，避免后续暗场误判。
 * blackProbeEnabled 为 false 时不做黑屏判定，只保留无画面这类无歧义信号。
 */
export function createDecodeGuard({ blackProbeEnabled = true } = {}) {
  let blackStreak = 0;
  let noPicStreak = 0;
  let blackStart = null; // { time, audioBytes }
  let lastTime = null;
  let done = null;

  const result = (value) => {
    if (value !== 'watch') done = value;
    return done || 'watch';
  };

  return {
    get verdict() { return done; },
    reset() {
      blackStreak = 0;
      noPicStreak = 0;
      blackStart = null;
      lastTime = null;
      done = null;
    },
    push(sample) {
      if (done) return done;
      if (!sample || sample.paused) return 'watch';
      const time = Number(sample.currentTime);
      if (!Number.isFinite(time)) return 'watch';
      const width = Number(sample.videoWidth) || 0;

      if (!width) {
        blackStreak = 0;
        blackStart = null;
        noPicStreak += 1;
        if (noPicStreak >= NO_PIC_SAMPLES_TO_FAIL && time > 0.3) return result('fail-no-picture');
        lastTime = time;
        return 'watch';
      }

      const luma = sample.luma == null ? null : Number(sample.luma);
      const visible = luma != null && Number.isFinite(luma) && luma > BLACK_LUMA_MAX;
      if (visible) {
        noPicStreak = 0;
        blackStreak = 0;
        blackStart = null;
        return result('healthy');
      }

      if (lastTime == null) lastTime = time;
      lastTime = time;

      // 画面尺寸正常但视频轨完全没解出字节、音频在解：解码失败（与颜色无关）。
      const vBytes = sample.videoDecodedBytes;
      const aBytes = sample.audioDecodedBytes;
      const videoSilent = typeof vBytes === 'number' && typeof aBytes === 'number'
        && vBytes === 0 && aBytes > 0 && time > 0.5;
      if (videoSilent) {
        blackStreak = 0;
        blackStart = null;
        noPicStreak += 1;
        if (noPicStreak >= NO_PIC_SAMPLES_TO_FAIL) return result('fail-no-picture');
        return 'watch';
      }
      noPicStreak = 0;

      if (luma == null || !Number.isFinite(luma) || !blackProbeEnabled) return 'watch';

      if (luma <= BLACK_LUMA_MAX) {
        blackStreak += 1;
        if (!blackStart) {
          blackStart = { time, audioBytes: typeof aBytes === 'number' ? aBytes : null };
        }
        const spanAdvance = time - blackStart.time;
        const audioGrew = blackStart.audioBytes != null
          && typeof aBytes === 'number' && aBytes > blackStart.audioBytes;
        // 「有声」：音频解码字节在涨；拿不到计数时只要播放时间推进即视为在播。
        const heard = audioGrew || blackStart.audioBytes == null;
        if (blackStreak >= BLACK_SAMPLES_TO_FAIL && spanAdvance >= MIN_ADVANCE_SECONDS && heard) {
          return result('fail-black-screen');
        }
        return 'watch';
      }

      // 灰帧（非纯黑）：不判健康也不判黑屏，只断开连续纯黑计数。
      blackStreak = 0;
      blackStart = null;
      return 'watch';
    },
  };
}
