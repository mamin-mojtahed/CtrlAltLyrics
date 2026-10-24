import React, { useRef, useEffect, memo } from 'react';
import * as audioPlayer from '../../services/audioPlayer';
import { getMomentaryAudioData } from '../../utils/waveform';

function VisualizerCanvas({
  song,
  duration = 0,
  isPlaying = false,
  syncAnchorRef,
  getPlaybackTime,
  accentColor = null,
  mode = 'mirror', // 'mirror' (Display tab) | 'bottom' (Dashboard tab current lyric preview)
  id = 'visualizer',
  className = ''
}) {
  const canvasRef = useRef(null);
  const isBottomMode = mode === 'bottom';
  const smoothBarsRef = useRef(null);

  // Maintain stable refs for high-frequency dynamic props to prevent effect thrashing
  const getPlaybackTimeRef = useRef(getPlaybackTime);
  getPlaybackTimeRef.current = getPlaybackTime;

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const syncAnchorRefActual = useRef(syncAnchorRef);
  syncAnchorRefActual.current = syncAnchorRef;

  const accentColorRef = useRef(accentColor);
  accentColorRef.current = accentColor;

  const songRef = useRef(song);
  songRef.current = song;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    let lastW = 0;
    let lastH = 0;
    let lastDpr = 0;

    // High-DPI responsive resize handler that only invalidates canvas if dimensions actually changed
    const handleResize = () => {
      const parent = canvas.parentElement;
      const width = parent ? parent.clientWidth : window.innerWidth;
      const height = parent ? parent.clientHeight : window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (width <= 0 || height <= 0) return;
      if (width === lastW && height === lastH && dpr === lastDpr) return;

      lastW = width;
      lastH = height;
      lastDpr = dpr;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };

    const ro = new ResizeObserver(handleResize);
    if (canvas.parentElement) {
      ro.observe(canvas.parentElement);
    }
    window.addEventListener('resize', handleResize);
    handleResize();

    // Cached accent color to eliminate forced style recalculation / reflows on 60fps frames
    let lastAccentRefVal = null;
    let cachedAccentRgb = { r: 99, g: 102, b: 241 };

    const updateAccentRgb = () => {
      const custom = accentColorRef.current;
      lastAccentRefVal = custom;
      if (custom && custom.r !== undefined) {
        cachedAccentRgb = custom;
        return;
      }
      try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        if (raw.startsWith('#')) {
          const hex = raw.slice(1);
          if (hex.length === 6) {
            cachedAccentRgb = {
              r: parseInt(hex.slice(0, 2), 16),
              g: parseInt(hex.slice(2, 4), 16),
              b: parseInt(hex.slice(4, 6), 16)
            };
            return;
          }
        }
        const match = raw.match(/\d+/g);
        if (match && match.length >= 3) {
          cachedAccentRgb = { r: parseInt(match[0], 10), g: parseInt(match[1], 10), b: parseInt(match[2], 10) };
          return;
        }
      } catch (e) {}
      cachedAccentRgb = { r: 99, g: 102, b: 241 };
    };
    updateAccentRgb();

    // Cached gradients to eliminate GC allocation churn per frame
    let cachedGradWidth = 0;
    let cachedGradR = -1;
    let cachedGradG = -1;
    let cachedGradB = -1;
    let cachedColorfulGrad = null;

    const getColorfulGrad = (width, r, g, b) => {
      if (
        cachedColorfulGrad &&
        cachedGradWidth === width &&
        cachedGradR === r &&
        cachedGradG === g &&
        cachedGradB === b
      ) {
        return cachedColorfulGrad;
      }
      const grad = ctx.createLinearGradient(0, 0, width, 0);
      grad.addColorStop(0.0, `rgba(${Math.min(255, r + 40)}, ${Math.min(255, g + 80)}, 255, 0.48)`);
      grad.addColorStop(0.25, `rgba(${Math.min(255, r + 20)}, ${Math.max(0, g - 20)}, ${Math.min(255, b + 40)}, 0.60)`);
      grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.75)`);
      grad.addColorStop(0.75, `rgba(${Math.min(255, r + 50)}, ${Math.min(255, g + 20)}, ${Math.max(0, b - 30)}, 0.60)`);
      grad.addColorStop(1.0, `rgba(${Math.min(255, r + 40)}, ${Math.min(255, g + 80)}, 255, 0.48)`);

      cachedGradWidth = width;
      cachedGradR = r;
      cachedGradG = g;
      cachedGradB = b;
      cachedColorfulGrad = grad;
      return grad;
    };

    let cachedRibbonHeight = 0;
    let cachedRibbonR = -1;
    let cachedRibbonG = -1;
    let cachedRibbonB = -1;
    let cachedRibbonGrad = null;

    const getRibbonGrad = (height, r, g, b) => {
      if (
        cachedRibbonGrad &&
        cachedRibbonHeight === height &&
        cachedRibbonR === r &&
        cachedRibbonG === g &&
        cachedRibbonB === b
      ) {
        return cachedRibbonGrad;
      }
      const grad = ctx.createLinearGradient(0, height - 28, 0, height);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.16)`);
      grad.addColorStop(0.65, `rgba(${r}, ${g}, ${b}, 0.07)`);
      grad.addColorStop(1, 'transparent');
      cachedRibbonHeight = height;
      cachedRibbonR = r;
      cachedRibbonG = g;
      cachedRibbonB = b;
      cachedRibbonGrad = grad;
      return grad;
    };

    let cachedCenterY = 0;
    let cachedGlowH = 0;
    let cachedCenterR = -1;
    let cachedCenterG = -1;
    let cachedCenterB = -1;
    let cachedCenterGrad = null;

    const getCenterGrad = (centerY, glowH, r, g, b) => {
      if (
        cachedCenterGrad &&
        cachedCenterY === centerY &&
        cachedGlowH === glowH &&
        cachedCenterR === r &&
        cachedCenterG === g &&
        cachedCenterB === b
      ) {
        return cachedCenterGrad;
      }
      const grad = ctx.createLinearGradient(0, centerY - glowH / 2, 0, centerY + glowH / 2);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.06)`);
      grad.addColorStop(1, 'transparent');
      cachedCenterY = centerY;
      cachedGlowH = glowH;
      cachedCenterR = r;
      cachedCenterG = g;
      cachedCenterB = b;
      cachedCenterGrad = grad;
      return grad;
    };

    const draw = () => {
      animId = requestAnimationFrame(draw);

      const parent = canvas.parentElement;
      const width = parent ? parent.clientWidth : window.innerWidth;
      const height = parent ? parent.clientHeight : window.innerHeight;
      if (width <= 0 || height <= 0) return;

      // Ensure canvas backing store matches size
      if (width !== lastW || height !== lastH) {
        handleResize();
      }

      ctx.clearRect(0, 0, width, height);

      const isPlayingCurrent = isPlayingRef.current;
      const getPlaybackTimeCurrent = getPlaybackTimeRef.current;
      const syncAnchorCurrent = syncAnchorRefActual.current;

      // 1. Calculate microsecond-accurate playback time
      let curTime = 0;
      if (typeof getPlaybackTimeCurrent === 'function') {
        curTime = getPlaybackTimeCurrent();
      } else if (syncAnchorCurrent?.current) {
        const anchor = syncAnchorCurrent.current;
        curTime = anchor.time || 0;
        if (anchor.isPlaying) {
          const elapsed = (performance.now() - anchor.timestamp) / 1000;
          curTime = Math.max(0, anchor.time + elapsed);
        }
      } else {
        curTime = audioPlayer.getCurrentPlaybackTime(isPlayingCurrent);
      }

      // Check if accentColor changed without calling getComputedStyle repeatedly
      if (accentColorRef.current !== lastAccentRefVal) {
        updateAccentRgb();
      }
      const { r, g, b } = cachedAccentRgb;

      // 2. Bar geometry adaptation
      const barCount = isBottomMode
        ? Math.min(90, Math.max(36, Math.floor(width / 7.0)))
        : Math.min(110, Math.max(48, Math.floor(width / 15.0)));

      // Initialize or resize smoothed bars buffer
      if (!smoothBarsRef.current || smoothBarsRef.current.length !== barCount) {
        smoothBarsRef.current = new Float32Array(barCount);
      }
      const smoothBars = smoothBarsRef.current;

      const wavePoints = isBottomMode ? 32 : 48;

      // 3. Extract real-time momentary frequencies, time-domain wave samples, and instantaneous amplitude
      // Lazy buffer lookup without background interval
      const currentBuffer = audioPlayer.getLoadedBuffer();
      const { frequencies, waveSamples, amplitude } = getMomentaryAudioData(curTime, isPlayingCurrent, currentBuffer, barCount, wavePoints);

      // Smooth attack and natural organic decay reflecting the true audio
      for (let i = 0; i < barCount; i++) {
        const target = isPlayingCurrent ? frequencies[i] : 0;
        if (target > smoothBars[i]) {
          smoothBars[i] += (target - smoothBars[i]) * 0.40; // Quick musical attack
        } else {
          smoothBars[i] *= 0.88; // Natural musical decay
        }
      }

      // Vertical placement:
      // Display tab: Exactly in the middle of screen vertically (50% height) where current lyric sits
      // Dashboard tab: Anchored at lower border
      const centerY = isBottomMode ? height : Math.floor(height * 0.5);

      // 4. Uniform Faded Colourful Theme Gradient (cached)
      const colorfulGrad = getColorfulGrad(width, r, g, b);

      // 5. LAYER 1: Subtle Ambient Underglow (no line animations, cached gradients)
      const ribbonEnergy = isPlayingCurrent ? Math.min(1.0, 0.20 + amplitude * 0.80) : 0;

      if (ribbonEnergy > 0.01) {
        ctx.save();
        ctx.globalAlpha = ribbonEnergy;

        if (isBottomMode) {
          // Lower border ambient glow shaped by real audio amplitude & wave
          ctx.beginPath();
          for (let i = 0; i < wavePoints; i++) {
            const wx = (i / (wavePoints - 1)) * width;
            const waveVal = waveSamples ? Math.abs(waveSamples[i] || 0) : 0;
            const wy = height - 1 - (waveVal * 12 * ribbonEnergy + ribbonEnergy * 3.5);
            if (i === 0) ctx.moveTo(wx, wy);
            else ctx.lineTo(wx, wy);
          }
          ctx.lineTo(width, height);
          ctx.lineTo(0, height);
          ctx.closePath();

          ctx.fillStyle = getRibbonGrad(height, r, g, b);
          ctx.fill();
        } else {
          // Display tab: Subtle soft atmospheric center glow behind lyrics
          const glowH = Math.min(height * 0.16, 90);
          ctx.fillStyle = getCenterGrad(centerY, glowH, r, g, b);
          ctx.fillRect(0, centerY - glowH / 2, width, glowH);
        }
        ctx.restore();
      }

      // 6. LAYER 2: Live Frequency Spectrum Bars (Batched single path with vibrant colourful theme)
      // Executed as a single batched draw call without per-bar shadowBlur for maximum 60fps throughput
      const stepX = width / barCount;
      const barWidth = Math.max(2.0, stepX * (isBottomMode ? 0.60 : 0.54));
      const maxH = isBottomMode
        ? Math.min(height * 0.72, 40)
        : Math.min(height * 0.15, 85);

      const rad = isBottomMode ? Math.min(barWidth / 2, 3) : Math.min(barWidth / 2, 3.5);
      const minH = isBottomMode ? 3.0 : 2.5;

      ctx.save();
      ctx.fillStyle = colorfulGrad;
      ctx.beginPath();

      if (isBottomMode) {
        // Dashboard tab: Upper half of waveform rising upwards from lower border
        for (let i = 0; i < barCount; i++) {
          const bx = i * stepX + stepX / 2;
          const val = smoothBars[i];
          const barH = Math.max(minH, val * maxH);
          const topY = height - barH;
          const x = bx - barWidth / 2;

          if (ctx.roundRect) {
            ctx.roundRect(x, topY, barWidth, barH, [rad, rad, 0, 0]);
          } else {
            ctx.rect(x, topY, barWidth, barH);
          }
        }
      } else {
        // Display tab: Middle of screen vertically, mirrored around centerY
        for (let i = 0; i < barCount; i++) {
          const bx = i * stepX + stepX / 2;
          const val = smoothBars[i];
          const barH = Math.max(minH, val * maxH);
          const topY = centerY - barH / 2;
          const x = bx - barWidth / 2;

          if (ctx.roundRect) {
            ctx.roundRect(x, topY, barWidth, barH, rad);
          } else {
            ctx.rect(x, topY, barWidth, barH);
          }
        }
      }

      ctx.fill();
      ctx.restore();
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [mode, isBottomMode, id]);

  return (
    <canvas
      ref={canvasRef}
      id={id}
      className={`lyrics-waveform-canvas ${isBottomMode ? 'waveform-bottom-mode' : ''} ${className}`}
      aria-hidden="true"
    />
  );
}

export default memo(VisualizerCanvas);
