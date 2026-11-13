import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as audioPlayer from '../../services/audioPlayer';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { formatCentiseconds } from '../../utils/themeColors';
import { getLineWordPairsWithPauses } from '../../utils/lyricsWrapping';

/**
 * Interactive Audio Waveform & Timeline Visualizer for Lyrics Syncing
 * Features:
 * - Minimap with draggable/resizable viewport frame
 * - Waveform peaks & vocal formant overlay
 * - Auto-following playhead tracking during playback
 * - Interactive draggable lyric pins to visually adjust timestamps
 * - Transient onset auto-snapping for syllable/word synchronization
 * - Zoom & navigation (fit song, zoom to line, zoom in/out)
 */

// Sample-range min/max resolution helper with absolute-anchored block queries
function getSampleRangeMinMax(channel, cachedBlocks, s0, s1) {
  let min = 0;
  let max = 0;
  const len = s1 - s0;
  if (len <= 64 || !cachedBlocks || !cachedBlocks.blocks) {
    for (let s = s0; s < s1; s++) {
      const v = channel[s];
      if (v < min) min = v;
      if (v > max) max = v;
    }
  } else {
    const blkSize = cachedBlocks.BLOCK || 64;
    const blkArr = cachedBlocks.blocks;
    const totalBlks = cachedBlocks.numBlocks || (blkArr.length / 2);
    const b0 = Math.min(totalBlks - 1, Math.max(0, Math.floor(s0 / blkSize)));
    const b1 = Math.min(totalBlks - 1, Math.max(b0, Math.floor(s1 / blkSize)));
    for (let b = b0; b <= b1; b++) {
      const pMin = blkArr[b * 2];
      const pMax = blkArr[b * 2 + 1];
      if (pMin < min) min = pMin;
      if (pMax > max) max = pMax;
    }
  }
  return { min, max };
}

const LyricsTimelineSpectrumEditor = forwardRef(function LyricsTimelineSpectrumEditor({
  song,
  lines,
  selectedRowIndex,
  onSelectRow,
  onUpdateLineTime,
  onAddLine,
  playbackTime,
  isPlaying,
  duration,
  onSeek,
  onTogglePlayPause,
  nudgeStep = 0.10,
  onStampCurrentLine,
  onUpdateSyncPointTime,
  onUpdateSyncPointEndTime,
  onUpdatePauseBounds,
  isSameSong = false,
  selectedSyncPtKey = null,
  onSelectSyncPoint = null,
  onDeleteSyncPoint = null,
  onRemovePause = null
}, ref) {
  // Viewport window (in seconds)
  const [viewStart, setViewStart] = useState(0);
  const [viewDuration, setViewDuration] = useState(25);
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [transientStatus, setTransientStatus] = useState(null);
  const [hoveredMarkerIndex, setHoveredMarkerIndex] = useState(-1);
  const [hoveredPauseKey, setHoveredPauseKey] = useState(null);

  const MAIN_TRACK_H = 120;
  const pausePartitionsRef = useRef([]);
  const activePauseDragRef = useRef(null);
  const hoveredPauseRef = useRef(null);
  const hoveredSubMarkerRef = useRef(null);
  const selectedSyncPtKeyRef = useRef(selectedSyncPtKey);
  selectedSyncPtKeyRef.current = selectedSyncPtKey;

  // Dismiss cheatsheet modal on Escape before parent modal receives the key event
  useEffect(() => {
    if (!showShortcutsModal) return;
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
        setShowShortcutsModal(false);
      }
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [showShortcutsModal]);

  // Dragging states
  const isDraggingMinimapRef = useRef(null); // 'vp-left' | 'vp-right' | 'vp-move'
  const isDraggingMarkerRef = useRef(null); // line index
  const isScrubbingRulerRef = useRef(false);
  const dragAnchorRef = useRef({ startX: 0, initialViewStart: 0, initialViewDuration: 0, initialViewEnd: 0, startTime: 0 });
  const hoveredMarkerIndexRef = useRef(-1);
  const markerBoxesRef = useRef([]);
  const isDraggingSubMarkerRef = useRef(null);
  const subMarkerBoxesRef = useRef([]);

  // DOM Refs
  const containerRef = useRef(null);
  const minimapWrapRef = useRef(null);
  const minimapCanvasRef = useRef(null);
  const rulerCanvasRef = useRef(null);
  const mainCanvasRef = useRef(null);
  const canvasWrapRef = useRef(null);

  // Audio Buffers & Downsampled Peaks Cache
  const audioBufferRef = useRef(null);
  const peaksCacheRef = useRef({ mix: null, lead: null });
  const bufferBlocksCacheRef = useRef(new WeakMap());
  const animFrameRef = useRef(null);

  const getAudioBlocks = useCallback((buf) => {
    if (!buf || typeof buf.getChannelData !== 'function' || !buf.length) return null;
    let cached = bufferBlocksCacheRef.current.get(buf);
    if (cached) return cached;

    const ch0 = buf.getChannelData(0);
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
    const len = buf.length;
    const BLOCK = 64;
    const numBlocks = Math.ceil(len / BLOCK);
    const blocks = new Float32Array(numBlocks * 2);

    for (let b = 0; b < numBlocks; b++) {
      const start = b * BLOCK;
      const end = Math.min(len, start + BLOCK);
      let min = 0;
      let max = 0;
      for (let j = start; j < end; j++) {
        const s = (ch0[j] + ch1[j]) * 0.5;
        if (s < min) min = s;
        if (s > max) max = s;
      }
      blocks[b * 2] = min;
      blocks[b * 2 + 1] = max;
    }

    const result = { blocks, BLOCK, numBlocks };
    bufferBlocksCacheRef.current.set(buf, result);
    return result;
  }, []);

  // Fresh state refs for global event listeners
  const viewStartRef = useRef(viewStart);
  viewStartRef.current = viewStart;
  const viewDurationRef = useRef(viewDuration);
  viewDurationRef.current = viewDuration;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const playbackTimeRef = useRef(playbackTime);
  playbackTimeRef.current = playbackTime;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const selectedRowIndexRef = useRef(selectedRowIndex);
  selectedRowIndexRef.current = selectedRowIndex;
  const followPlayheadRef = useRef(followPlayhead);
  followPlayheadRef.current = followPlayhead;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const isSameSongRef = useRef(isSameSong);
  isSameSongRef.current = isSameSong;

  // Viewport centering initialization when selectedRowIndex changes initially
  const hasInitializedViewRef = useRef(false);
  useEffect(() => {
    if (hasInitializedViewRef.current) return;
    if (selectedRowIndex > 0 && lines[selectedRowIndex]) {
      const lineTime = typeof lines[selectedRowIndex].time === 'number' ? lines[selectedRowIndex].time : parseFloat(lines[selectedRowIndex].time) || 0;
      if (lineTime > 2) {
        hasInitializedViewRef.current = true;
        setViewStart(Math.max(0, lineTime - 2.0));
      }
    }
  }, [selectedRowIndex, lines]);

  // 1. Resolve Audio Buffer for Visualization (Vocal Stem or Mix)
  useEffect(() => {
    let isCancelled = false;

    // Check if audioPlayer already has stems loaded
    const loadedStems = audioPlayer.getStemBuffers();
    const primaryBuf = loadedStems.leadBuf || loadedStems.instBuf || loadedStems.backBuf || audioPlayer.getLoadedBuffer();

    if (primaryBuf && primaryBuf.duration > 0) {
      audioBufferRef.current = primaryBuf;
      generatePeaks(primaryBuf, loadedStems.leadBuf);
      return;
    }

    if (!song) return;

    // Fetch and decode audio if not already available
    const ctx = audioPlayer.getAudioContext();
    if (!ctx) return;

    const stems = song.stems || {};
    const targetUrl = stems.lead || stems.full || stems.inst || `/audio/${song.id}/lead_vocal.mp3`;

    fetch(targetUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((ab) => ctx.decodeAudioData(ab))
      .then((decodedBuf) => {
        if (isCancelled) return;
        audioBufferRef.current = decodedBuf;
        generatePeaks(decodedBuf, stems.lead ? decodedBuf : null);
      })
      .catch((err) => {
        // Fallback to instrumental or full audio
        const fallbackUrl = stems.inst || `/audio/${song.id}/instrumental.mp3`;
        fetch(fallbackUrl)
          .then((r) => r.ok && r.arrayBuffer())
          .then((ab) => ab && ctx.decodeAudioData(ab))
          .then((buf) => {
            if (!isCancelled && buf) {
              audioBufferRef.current = buf;
              generatePeaks(buf, null);
            }
          })
          .catch(() => {});
      });

    return () => {
      isCancelled = true;
    };
  }, [song]);

  // Downsample AudioBuffer into fast 3,000-bucket min/max peaks + 64-sample block pyramid
  const generatePeaks = (mixBuf, leadBuf) => {
    if (!mixBuf) return;
    const computeSummary = (buf) => {
      if (!buf) return null;
      const blkData = getAudioBlocks(buf);
      if (!blkData) return null;
      const { blocks, numBlocks, BLOCK } = blkData;
      const buckets = 3000;
      const step = buf.length / buckets;
      const summary = new Float32Array(buckets * 2);

      for (let i = 0; i < buckets; i++) {
        const start = Math.floor(i * step);
        const end = Math.min(buf.length, Math.floor((i + 1) * step));
        const b0 = Math.min(numBlocks - 1, Math.max(0, Math.floor(start / BLOCK)));
        const b1 = Math.min(numBlocks - 1, Math.max(b0, Math.floor(end / BLOCK)));
        let min = 0;
        let max = 0;
        for (let b = b0; b <= b1; b++) {
          const pMin = blocks[b * 2];
          const pMax = blocks[b * 2 + 1];
          if (pMin < min) min = pMin;
          if (pMax > max) max = pMax;
        }
        summary[i * 2] = min;
        summary[i * 2 + 1] = max;
      }
      return { ...blkData, summary };
    };

    peaksCacheRef.current = {
      mix: computeSummary(mixBuf),
      lead: leadBuf ? computeSummary(leadBuf) : null
    };
    renderAllCanvases();
  };

  // 3. Zoom Navigation Functions
  const handleZoom = (factor, centerRatio = 0.5) => {
    if (duration <= 0) return;
    const curDur = viewDuration;
    const minDur = 2.0;
    const newDur = Math.max(minDur, Math.min(duration, curDur * factor));
    const centerTime = viewStart + curDur * centerRatio;
    const newStart = Math.max(0, Math.min(duration - newDur, centerTime - newDur * centerRatio));

    setViewDuration(newDur);
    setViewStart(newStart);
  };

  const handleZoomFit = () => {
    setViewStart(0);
    setViewDuration(Math.max(10, duration));
  };

  const handleZoomToActiveLine = () => {
    if (selectedRowIndex < 0 || !lines[selectedRowIndex] || duration <= 0) return;
    const lineTime = lines[selectedRowIndex].time;
    const targetDur = 12.0;
    const newDur = Math.min(duration, targetDur);
    const newStart = Math.max(0, Math.min(duration - newDur, lineTime - newDur * 0.35));
    setViewStart(newStart);
    setViewDuration(newDur);
  };

  useImperativeHandle(ref, () => ({
    zoomIn: () => handleZoom(0.70),
    zoomOut: () => handleZoom(1.40),
    zoomFit: handleZoomFit,
    zoomToActiveLine: handleZoomToActiveLine,
    toggleShortcutsModal: () => setShowShortcutsModal((prev) => !prev),
    snapTransient: handleSnapTransient,
    getHoveredSyncPoint: () => {
      if (hoveredPauseRef.current) {
        const parts = hoveredPauseRef.current.split('_');
        if (parts.length >= 2) {
          const lIdx = parseInt(parts[0], 10);
          if (!isNaN(lIdx)) {
            return {
              lineIndex: lIdx,
              pointIndex: hoveredPauseRef.current,
              isPause: true,
              pauseKey: hoveredPauseRef.current
            };
          }
        }
      }
      if (hoveredSubMarkerRef.current) {
        return {
          lineIndex: hoveredSubMarkerRef.current.lineIndex,
          pointIndex: hoveredSubMarkerRef.current.pointIndex,
          isPause: false
        };
      }
      return null;
    },
    clearHovered: () => {
      hoveredPauseRef.current = null;
      setHoveredPauseKey(null);
      hoveredSubMarkerRef.current = null;
    }
  }), [duration, viewDuration, viewStart, selectedRowIndex, lines]);

  // 4. Snap Selected Lyric to Nearest Vocal Transient
  const handleSnapTransient = () => {
    const activeIdx = selectedRowIndexRef.current;
    const curLines = linesRef.current;
    if (activeIdx < 0 || !curLines[activeIdx]) return;

    const buf = audioBufferRef.current;
    if (!buf) {
      setTransientStatus('Audio not yet decoded');
      setTimeout(() => setTransientStatus(null), 2000);
      return;
    }

    const curTime = curLines[activeIdx].time;
    const sampleRate = buf.sampleRate || 44100;
    const channel = buf.getChannelData(0);
    const windowSec = 0.45;

    const centerSample = Math.floor(curTime * sampleRate);
    const halfWin = Math.floor(windowSec * sampleRate);
    const start = Math.max(0, centerSample - halfWin);
    const end = Math.min(channel.length - 1, centerSample + halfWin);

    const chunkSize = Math.floor(sampleRate * 0.01);
    let maxEnergy = 0;
    let maxSample = centerSample;

    for (let s = start; s < end - chunkSize; s += Math.floor(chunkSize / 2)) {
      let energy = 0;
      for (let i = 0; i < chunkSize; i++) {
        const val = channel[s + i];
        energy += val * val;
      }
      if (energy > maxEnergy) {
        maxEnergy = energy;
        maxSample = s;
      }
    }

    const snappedTime = Math.round((maxSample / sampleRate) * 100) / 100;
    const diff = Math.round((snappedTime - curTime) * 100) / 100;

    onUpdateLineTime(activeIdx, snappedTime);
    setTransientStatus(`Snapped to vocal onset (${diff >= 0 ? '+' : ''}${diff}s)`);
    setTimeout(() => setTransientStatus(null), 2500);
  };

  // Safe canvas rounded rect helper with cross-browser fallback
  const drawRoundRect = (ctx, x, y, w, h, r) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      try {
        ctx.roundRect(x, y, w, h, r);
        return;
      } catch (_) {}
    }
    ctx.rect(x, y, w, h);
  };

  // Safe canvas circle helper with finite number checks
  const drawCircle = (ctx, cx, cy, r) => {
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r <= 0) return;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // 5. Canvas Rendering Loop
  const renderAllCanvases = useCallback(() => {
    try {
      const wrap = canvasWrapRef.current;
      const safeDuration = typeof duration === 'number' && !isNaN(duration) && duration > 0 ? duration : 0;
      if (!wrap || safeDuration <= 0) return;

      const width = wrap.clientWidth;
      if (width <= 0) return;
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      let safePlayTime = 0;
      if (isScrubbingRulerRef.current) {
        safePlayTime = typeof playbackTimeRef.current === 'number' && !isNaN(playbackTimeRef.current)
          ? Math.max(0, playbackTimeRef.current)
          : 0;
      } else if (isPlayingRef.current && isSameSongRef.current) {
        safePlayTime = usePlaybackStore.getState().getAccuratePlaybackTime();
      } else {
        safePlayTime = typeof playbackTimeRef.current === 'number' && !isNaN(playbackTimeRef.current)
          ? Math.max(0, playbackTimeRef.current)
          : 0;
      }
      safePlayTime = Math.max(0, Math.min(safeDuration, safePlayTime));
      const safeViewStart = typeof viewStart === 'number' && !isNaN(viewStart) ? Math.max(0, viewStart) : 0;
      const safeViewDuration = Math.max(0.1, typeof viewDuration === 'number' && !isNaN(viewDuration) ? viewDuration : 25);

      // ==========================================
      // A. Render Minimap Overview
      // ==========================================
      const minimap = minimapCanvasRef.current;
      if (minimap) {
        const mmW = minimap.clientWidth;
        const mmH = 30;
        if (mmW > 0) {
          const targetW = Math.floor(mmW * dpr);
          const targetH = Math.floor(mmH * dpr);
          if (minimap.width !== targetW || minimap.height !== targetH) {
            minimap.width = targetW;
            minimap.height = targetH;
            minimap.style.width = `${mmW}px`;
            minimap.style.height = `${mmH}px`;
          }

          const ctx = minimap.getContext('2d');
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, mmW, mmH);

          // Background
          ctx.fillStyle = '#060a12';
          ctx.fillRect(0, 0, mmW, mmH);

          // Thumbnail waveform silhouette
          const peaksObj = peaksCacheRef.current.lead || peaksCacheRef.current.mix;
          const peaks = peaksObj?.summary || peaksObj;
          if (peaks && (peaks.length || peaks.summary?.length)) {
            const arr = peaks.summary || peaks;
            const total = arr.length / 2;
            ctx.fillStyle = 'rgba(99, 102, 241, 0.40)';
            ctx.beginPath();
            for (let x = 0; x < mmW; x++) {
              const b = Math.floor((x / mmW) * total);
              const max = arr[b * 2 + 1];
              const barH = Math.max(1, max * (mmH / 2) * 0.85);
              ctx.rect(x, mmH / 2 - barH, 1, barH * 2);
            }
            ctx.fill();
          }

          // Lyric Tick Markers across the whole song
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            const lineTime = typeof line.time === 'number' ? line.time : parseFloat(line.time) || 0;
            const lx = (lineTime / safeDuration) * mmW;
            if (Number.isFinite(lx) && lx >= 0 && lx <= mmW) {
              const isSel = selectedRowIndex === i;
              ctx.fillStyle = isSel ? '#fbbf24' : 'rgba(255, 255, 255, 0.45)';
              ctx.fillRect(lx - (isSel ? 1.5 : 0.5), isSel ? 2 : 7, isSel ? 3 : 1, isSel ? mmH - 4 : mmH - 14);
            }
          }

          // Viewport Camera Window (Cyan Theme)
          const vpX1 = Math.max(0, (safeViewStart / safeDuration) * mmW);
          const vpX2 = Math.min(mmW, ((safeViewStart + safeViewDuration) / safeDuration) * mmW);
          const vpW = Math.max(4, vpX2 - vpX1);

          // Outside curtain mask
          ctx.fillStyle = 'rgba(2, 6, 23, 0.60)';
          if (vpX1 > 0) ctx.fillRect(0, 0, vpX1, mmH);
          if (vpX2 < mmW) ctx.fillRect(vpX2, 0, mmW - vpX2, mmH);

          // Inside view illumination
          ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
          ctx.fillRect(vpX1, 0, vpW, mmH);

          // View border
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(vpX1, 0.5, vpW, mmH - 1);

          // Top & Bottom rails
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(vpX1, 0, vpW, 2);
          ctx.fillRect(vpX1, mmH - 2, vpW, 2);

          // Left & Right Resize Handles
          ctx.fillStyle = '#0284c7';
          ctx.fillRect(vpX1 - 2.5, 2, 5, mmH - 4);
          ctx.fillRect(vpX2 - 2.5, 2, 5, mmH - 4);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(vpX1 - 0.5, mmH / 2 - 4, 1.5, 8);
          ctx.fillRect(vpX2 - 0.5, mmH / 2 - 4, 1.5, 8);

          // Playhead on minimap
          const pmX = (safePlayTime / safeDuration) * mmW;
          if (Number.isFinite(pmX)) {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(pmX, 0);
            ctx.lineTo(pmX, mmH);
            ctx.stroke();
          }
        }
      }

      // ==========================================
      // B. Render Time Ruler
      // ==========================================
      const ruler = rulerCanvasRef.current;
      if (ruler) {
        const rH = 24;
        const targetW = Math.floor(width * dpr);
        const targetH = Math.floor(rH * dpr);
        if (ruler.width !== targetW || ruler.height !== targetH) {
          ruler.width = targetW;
          ruler.height = targetH;
          ruler.style.width = `${width}px`;
          ruler.style.height = `${rH}px`;
        }

        const ctx = ruler.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, rH);

        // Background
        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, width, rH);

        // Time Steps
        let timeStep = 5;
        if (safeViewDuration <= 3) timeStep = 0.2;
        else if (safeViewDuration <= 8) timeStep = 0.5;
        else if (safeViewDuration <= 18) timeStep = 1;
        else if (safeViewDuration <= 45) timeStep = 2;
        else if (safeViewDuration <= 90) timeStep = 5;
        else timeStep = 15;

        const firstTick = Math.floor(safeViewStart / timeStep) * timeStep;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';

        for (let t = firstTick; t <= safeViewStart + safeViewDuration; t += timeStep) {
          const x = ((t - safeViewStart) / safeViewDuration) * width;
          if (Number.isFinite(x) && x >= 0 && x <= width) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, 14);
            ctx.lineTo(x, rH);
            ctx.stroke();

            const label = formatCentiseconds(t).slice(0, 5);
            ctx.fillText(label, x, 10);
          }
        }

        // Playhead flag on ruler
        if (safePlayTime >= safeViewStart && safePlayTime <= safeViewStart + safeViewDuration) {
          const px = ((safePlayTime - safeViewStart) / safeViewDuration) * width;
          if (Number.isFinite(px)) {
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.moveTo(px - 5, 0);
            ctx.lineTo(px + 5, 0);
            ctx.lineTo(px, 12);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      // ==========================================
      // C. Render Main Spectrum & Waveform Track
      // ==========================================
      const canvas = mainCanvasRef.current;
      if (canvas) {
        const trackH = 120;
        const targetW = Math.floor(width * dpr);
        const targetH = Math.floor(trackH * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
          canvas.style.width = `${width}px`;
          canvas.style.height = `${trackH}px`;
        }

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, trackH);

        // Background gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, trackH);
        bgGrad.addColorStop(0, '#070b14');
        bgGrad.addColorStop(1, '#0c111e');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, trackH);

        // Center zero line
        const centerY = trackH / 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();

        // 1. High-Precision Background Audio Spectrum & Formant Waveform
        const buf = audioBufferRef.current || audioPlayer.getLoadedBuffer();
        const hasValidBuf = buf && typeof buf.getChannelData === 'function' && buf.numberOfChannels > 0 && typeof buf.length === 'number' && buf.length > 0;
        if (hasValidBuf && safeDuration > 0) {
          const ch = buf.getChannelData(0);
          const sampleRate = buf.sampleRate || 44100;
          const startSample = Math.max(0, Math.floor(safeViewStart * sampleRate));
          const endSample = Math.min(ch.length, Math.floor((safeViewStart + safeViewDuration) * sampleRate));
          const totalSamples = endSample - startSample;

          if (totalSamples > 0) {
            const step = totalSamples / width;
            const maxAmp = (trackH / 2) * 0.88;
            const baseBlocks = getAudioBlocks(buf);

            // Base Audio Waveform
            const waveGrad = ctx.createLinearGradient(0, 0, 0, trackH);
            waveGrad.addColorStop(0, '#38bdf8');   // Cyan high
            waveGrad.addColorStop(0.3, '#818cf8'); // Indigo mid
            waveGrad.addColorStop(0.5, '#c084fc'); // Purple center
            waveGrad.addColorStop(0.7, '#818cf8'); // Indigo mid
            waveGrad.addColorStop(1, '#38bdf8');   // Cyan low

            ctx.fillStyle = waveGrad;
            ctx.beginPath();

            for (let x = 0; x < width; x++) {
              const s0 = Math.max(0, Math.min(ch.length - 1, Math.floor(startSample + x * step)));
              const s1 = Math.max(s0 + 1, Math.min(ch.length, Math.floor(startSample + (x + 1) * step)));
              const { min, max } = getSampleRangeMinMax(ch, baseBlocks, s0, s1);

              const topY = centerY - Math.max(1, max * maxAmp);
              const botY = centerY - Math.min(-1, min * maxAmp);
              ctx.rect(x, topY, 1, Math.max(1.5, botY - topY));
            }
            ctx.fill();

            // Vocal Formant Energy Layer (Highlighted in Gold & Rose)
            const stemBuffers = audioPlayer.getStemBuffers() || {};
            const leadBuf = stemBuffers.leadBuf || (buf !== audioPlayer.getLoadedBuffer() ? audioBufferRef.current : null);
            const hasValidLead = leadBuf && typeof leadBuf.getChannelData === 'function' && leadBuf.numberOfChannels > 0 && typeof leadBuf.length === 'number' && leadBuf.length > 0;

            if (hasValidLead && leadBuf !== buf) {
              const leadCh = leadBuf.getChannelData(0);
              const leadSampleRate = leadBuf.sampleRate || 44100;
              const leadStart = Math.max(0, Math.floor(safeViewStart * leadSampleRate));
              const leadEnd = Math.min(leadCh.length, Math.floor((safeViewStart + safeViewDuration) * leadSampleRate));
              const leadTotal = leadEnd - leadStart;

              if (leadTotal > 0) {
                const leadStep = leadTotal / width;
                const leadBlocks = getAudioBlocks(leadBuf);
                const vocalGrad = ctx.createLinearGradient(0, 0, 0, trackH);
                vocalGrad.addColorStop(0, '#ec4899'); // Fuchsia
                vocalGrad.addColorStop(0.5, '#fbbf24'); // Bright Gold
                vocalGrad.addColorStop(1, '#ec4899');

                ctx.fillStyle = vocalGrad;
                ctx.beginPath();

                for (let x = 0; x < width; x++) {
                  const s0 = Math.max(0, Math.min(leadCh.length - 1, Math.floor(leadStart + x * leadStep)));
                  const s1 = Math.max(s0 + 1, Math.min(leadCh.length, Math.floor(leadStart + (x + 1) * leadStep)));
                  const { min, max } = getSampleRangeMinMax(leadCh, leadBlocks, s0, s1);

                  if (max > 0.03 || min < -0.03) {
                    const topY = centerY - Math.max(1, max * maxAmp);
                    const botY = centerY - Math.min(-1, min * maxAmp);
                    ctx.rect(x, topY, 1, Math.max(1.5, botY - topY));
                  }
                }
                ctx.fill();
              }
            }
          }
        } else {
          // Fallback to coarse peaks if buffer is still decoding
          const peaksObj = peaksCacheRef.current.lead || peaksCacheRef.current.mix;
          const peaks = peaksObj?.summary || peaksObj;
          if (peaks && safeDuration > 0) {
            const totalBuckets = (peaks.length || peaks.summary?.length) / 2;
            const maxAmp = (trackH / 2) * 0.88;
            ctx.fillStyle = '#818cf8';
            ctx.beginPath();
            for (let x = 0; x < width; x++) {
              const t0 = safeViewStart + (x / width) * safeViewDuration;
              const t1 = safeViewStart + ((x + 1) / width) * safeViewDuration;
              const b0 = Math.max(0, Math.min(totalBuckets - 1, Math.floor((t0 / safeDuration) * totalBuckets)));
              const b1 = Math.max(0, Math.min(totalBuckets - 1, Math.floor((t1 / safeDuration) * totalBuckets)));
              let min = 0, max = 0;
              for (let b = b0; b <= b1; b++) {
                if (peaks[b * 2] < min) min = peaks[b * 2];
                if (peaks[b * 2 + 1] > max) max = peaks[b * 2 + 1];
              }
              const topY = centerY - Math.max(1, max * maxAmp);
              const botY = centerY - Math.min(-1, min * maxAmp);
              ctx.rect(x, topY, 1, Math.max(2, botY - topY));
            }
            ctx.fill();
          }
        }

        // 2. Render Interactive Lyric Pins & Badges
        const boxes = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const lineTime = typeof line.time === 'number' ? line.time : parseFloat(line.time) || 0;
          const lx = ((lineTime - safeViewStart) / safeViewDuration) * width;

          if (Number.isFinite(lx) && lx >= -80 && lx <= width + 80) {
            const isSel = selectedRowIndex === i;
            const isHov = hoveredMarkerIndex === i;

            // Vertical Marker Line
            ctx.strokeStyle = isSel ? '#fbbf24' : (isHov ? '#38bdf8' : 'rgba(56, 189, 248, 0.55)');
            ctx.lineWidth = isSel || isHov ? 2 : 1.5;
            if (!isSel && !isHov) ctx.setLineDash([4, 3]);
            else ctx.setLineDash([]);

            ctx.beginPath();
            ctx.moveTo(lx, 24);
            ctx.lineTo(lx, trackH);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draggable Knob / Handle
            ctx.fillStyle = isSel ? '#f59e0b' : (isHov ? '#38bdf8' : '#0284c7');
            drawCircle(ctx, lx, trackH - 10, isSel || isHov ? 5 : 4);

            // Lyric Header Pill Badge at Top of Pin
            const previewText = line.text ? (line.text.length > 16 ? line.text.slice(0, 15) + '…' : line.text) : '#INST';
            const label = `[#${i + 1}] ${previewText}`;
            ctx.font = isSel ? 'bold 10px sans-serif' : '10px sans-serif';
            const textW = ctx.measureText(label).width;
            const badgeW = textW + 14;
            const badgeH = 20;
            const badgeX = Math.max(2, Math.min(width - badgeW - 2, lx - badgeW / 2));
            const badgeY = 3;

            boxes.push({ index: i, lx, badgeX, badgeY, badgeW, badgeH, time: lineTime });

            // Badge Background
            if (isSel) {
              ctx.fillStyle = 'rgba(245, 158, 11, 0.95)';
              ctx.strokeStyle = '#fef08a';
              ctx.lineWidth = 1.5;
            } else if (isHov) {
              ctx.fillStyle = 'rgba(30, 58, 138, 0.92)';
              ctx.strokeStyle = '#38bdf8';
              ctx.lineWidth = 1.5;
            } else {
              ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
              ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
              ctx.lineWidth = 1;
            }

            // Rounded Badge rect
            ctx.beginPath();
            drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();
            ctx.stroke();

            // Badge Text
            ctx.fillStyle = isSel ? '#000000' : (isHov ? '#ffffff' : '#e2e8f0');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, badgeX + badgeW / 2, badgeY + badgeH / 2);
          }
        }
        markerBoxesRef.current = boxes;

        // 3. Render Nested Sub-Line Word Pins & Pauses
        const subBoxes = [];
        const pausePartitions = [];
        const pauseHandles = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line || !line.text) continue;
          const isSelectedLine = selectedRowIndex === i;
          // In the nested sub-line workspace, render sub-line words & pauses for the active selected line
          if (selectedRowIndex >= 0 && !isSelectedLine) continue;

          const { words, pauses } = getLineWordPairsWithPauses(line.text, line.syncPoints, line.time, line.endTime);

          // 1. Render pauses for this line
          pauses.forEach((p) => {
            const sx = ((p.startTime - safeViewStart) / safeViewDuration) * width;
            const endX = ((p.endTime - safeViewStart) / safeViewDuration) * width;
            const durVal = p.duration;
            const pWidth = Math.max(6, endX - sx);

            if (Number.isFinite(sx) && Number.isFinite(endX) && (endX >= -40 && sx <= width + 40)) {
              const pointId = p.id || `pause_${i}_${p.slot}`;
              // Prevent duplicate rendering if a partition with identical lineIndex and slot/id was already processed
              const alreadyExists = pausePartitions.some((pp) => pp.lineIndex === i && (pp.pointId === pointId || (p.slot >= 0 && pp.slot === p.slot)));
              if (alreadyExists) return;

              pausePartitions.push({
                lineIndex: i,
                pointIndex: p.ptIndex >= 0 ? p.ptIndex : p.slot,
                prevWordIndex: p.prevWordIndex,
                nextWordIndex: p.nextWordIndex,
                slot: p.slot,
                pointId,
                startX: sx,
                endX: endX,
                startTime: p.startTime,
                endTime: p.endTime,
                duration: durVal,
                label: p.label,
                isSelected: isSelectedLine
              });

              const curSelKey = selectedSyncPtKeyRef.current || selectedSyncPtKey;
              const isSelectedPause = curSelKey === `${i}_pause_${p.prevWordIndex}` ||
                curSelKey === `${i}_${p.ptIndex}` ||
                curSelKey === pointId;
              const pauseKeyId = `${i}_pause_${p.prevWordIndex}`;
              const isHoveredBody = hoveredPauseRef.current === `${pauseKeyId}_select` || hoveredPauseRef.current === `${pauseKeyId}_move` || hoveredPauseRef.current === `${i}_${p.ptIndex}_move`;
              const isHoveredLeft = hoveredPauseRef.current === `${pauseKeyId}_left` || hoveredPauseRef.current === `${i}_${p.ptIndex}_left`;
              const isHoveredRight = hoveredPauseRef.current === `${pauseKeyId}_right` || hoveredPauseRef.current === `${i}_${p.ptIndex}_right`;
              const isDraggingThis = activePauseDragRef.current?.pointId === pointId;
              const dragMode = isDraggingThis ? activePauseDragRef.current.mode : null;

              // Clamp drawing coordinates strictly to viewport to prevent WebKit/Canvas path overflow when zoomed in max
              const clampStartX = Math.max(-10, Math.min(width + 10, sx));
              const clampEndX = Math.max(-10, Math.min(width + 10, endX));
              const clampW = Math.max(0, clampEndX - clampStartX);

              if (clampW > 0) {
                // Shaded Partition Body (Refined Amber / Gold palette - zero harsh red overlay)
                ctx.fillStyle = isSelectedPause
                  ? 'rgba(245, 158, 11, 0.28)'
                  : (isDraggingThis || isHoveredBody
                    ? 'rgba(245, 158, 11, 0.20)'
                    : (isSelectedLine ? 'rgba(245, 158, 11, 0.10)' : 'rgba(245, 158, 11, 0.05)'));
                ctx.strokeStyle = isSelectedPause
                  ? '#fbbf24'
                  : (isDraggingThis || isHoveredBody
                    ? (dragMode === 'move' ? '#fbbf24' : '#f59e0b')
                    : (isSelectedLine ? 'rgba(245, 158, 11, 0.55)' : 'rgba(245, 158, 11, 0.30)'));
                ctx.lineWidth = isSelectedPause ? 2.5 : (isDraggingThis ? 2 : (isSelectedLine || isHoveredBody ? 1.5 : 1));
                ctx.setLineDash(isSelectedPause ? [] : [4, 3]);
                drawRoundRect(ctx, clampStartX, 24, clampW, trackH - 34, 4);
                ctx.fill();
                ctx.stroke();
                ctx.setLineDash([]);
              }

              // Clean middle badge with word pair and automatic duration
              let badgeLabel = `⏸ ${p.label} (${durVal}s)`;
              if (dragMode === 'left') {
                badgeLabel = `⏸ START: ${formatCentiseconds(p.startTime)} (${durVal}s)`;
              } else if (dragMode === 'right') {
                badgeLabel = `⏸ END: ${formatCentiseconds(p.endTime)} (${durVal}s)`;
              } else if (dragMode === 'move') {
                badgeLabel = `⏸ MOVE: ${p.label} (${durVal}s)`;
              }

              ctx.font = isSelectedLine || isDraggingThis || isSelectedPause ? 'bold 10px sans-serif' : '9px sans-serif';
              const badgeTextW = ctx.measureText(badgeLabel).width;
              const badgeW = badgeTextW + 12;
              const badgeH = 18;
              const badgeCenterX = Math.max(sx + badgeW / 2 + 2, Math.min(endX - badgeW / 2 - 2, sx + pWidth / 2));
              const badgeCenterY = 24 + (trackH - 34) / 2;

              // Only render full badge when partition is wide enough or actively selected/dragged to avoid obscuring adjacent lyrics
              const canFitBadge = pWidth >= badgeW + 8;
              const isHighlightState = isDraggingThis || isSelectedPause || isHoveredBody;

              if (canFitBadge || isHighlightState) {
                ctx.fillStyle = isSelectedPause
                  ? 'rgba(180, 83, 9, 0.96)'
                  : (isDraggingThis
                    ? (dragMode === 'move' ? 'rgba(217, 119, 6, 0.96)' : 'rgba(180, 83, 9, 0.95)')
                    : (isHoveredBody ? 'rgba(180, 83, 9, 0.92)' : 'rgba(15, 23, 42, 0.88)'));
                ctx.strokeStyle = isSelectedPause ? '#fbbf24' : (isDraggingThis ? '#fbbf24' : (isHoveredBody ? '#fbbf24' : 'rgba(245, 158, 11, 0.55)'));
                ctx.lineWidth = isSelectedPause ? 2 : 1;
                drawRoundRect(ctx, badgeCenterX - badgeW / 2, badgeCenterY - badgeH / 2, badgeW, badgeH, 3);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = isSelectedPause || isDraggingThis ? '#ffffff' : (isHoveredBody ? '#ffffff' : '#fde68a');
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(badgeLabel, badgeCenterX, badgeCenterY);
              } else if (pWidth >= 20) {
                // Compact mini pill for narrow zoom levels so lyrics remain 100% visible
                const miniW = 20;
                const miniCenterX = Math.max(sx + miniW / 2 + 2, Math.min(endX - miniW / 2 - 2, sx + pWidth / 2));
                ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
                ctx.strokeStyle = 'rgba(245, 158, 11, 0.50)';
                ctx.lineWidth = 1;
                drawRoundRect(ctx, miniCenterX - miniW / 2, badgeCenterY - badgeH / 2, miniW, badgeH, 3);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#fbbf24';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('⏸', miniCenterX, badgeCenterY);
              }

              // Left Resize Handle (Line and Knob at sx)
              if (sx >= -20 && sx <= width + 20) {
                const isLeftActive = isHoveredLeft || dragMode === 'left';
                ctx.beginPath();
                ctx.strokeStyle = isLeftActive ? '#fbbf24' : (isSelectedPause ? '#fbbf24' : 'rgba(245, 158, 11, 0.70)');
                ctx.lineWidth = isLeftActive ? 3 : (isSelectedPause ? 2.5 : 1.5);
                ctx.moveTo(sx, 24);
                ctx.lineTo(sx, trackH - 10);
                ctx.stroke();

                // Knob
                ctx.beginPath();
                ctx.fillStyle = isLeftActive ? '#fbbf24' : (isSelectedPause ? '#fbbf24' : 'rgba(245, 158, 11, 0.80)');
                drawCircle(ctx, sx, trackH / 2, isLeftActive ? 7 : (isSelectedPause ? 5.5 : 4));
                ctx.fillStyle = '#ffffff';
                drawCircle(ctx, sx, trackH / 2, isLeftActive ? 3.5 : (isSelectedPause ? 2.5 : 1.5));
              }

              // Right Resize Handle (Line and Knob at endX)
              if (endX >= -20 && endX <= width + 20) {
                const isRightActive = isHoveredRight || dragMode === 'right';
                ctx.beginPath();
                ctx.strokeStyle = isRightActive ? '#fbbf24' : (isSelectedPause ? '#fbbf24' : 'rgba(245, 158, 11, 0.70)');
                ctx.lineWidth = isRightActive ? 3 : (isSelectedPause ? 2.5 : 1.5);
                ctx.moveTo(endX, 24);
                ctx.lineTo(endX, trackH - 10);
                ctx.stroke();

                // Knob
                ctx.beginPath();
                ctx.fillStyle = isRightActive ? '#fbbf24' : (isSelectedPause ? '#fbbf24' : 'rgba(245, 158, 11, 0.80)');
                drawCircle(ctx, endX, trackH / 2, isRightActive ? 7 : (isSelectedPause ? 5.5 : 4));
                ctx.fillStyle = '#ffffff';
                drawCircle(ctx, endX, trackH / 2, isRightActive ? 3.5 : (isSelectedPause ? 2.5 : 1.5));
              }
            }
          });

          // 2. Render word pins for this line
          if (isSelectedLine) {
            words.forEach((w) => {
              if (!w.hasPoint) return;
              const sx = ((w.time - safeViewStart) / safeViewDuration) * width;
              const curSel = selectedSyncPtKeyRef.current || selectedSyncPtKey;
              const isSelectedWord = curSel === `${i}_${w.ptIndex}` ||
                curSel === `${i}_word_${w.index}`;

              if (Number.isFinite(sx) && sx >= -60 && sx <= width + 60) {
                ctx.strokeStyle = isSelectedWord ? '#fbbf24' : '#a855f7';
                ctx.lineWidth = isSelectedWord ? 2.5 : 1.5;
                ctx.setLineDash(isSelectedWord ? [] : [2, 2]);
                ctx.beginPath();
                ctx.moveTo(sx, 28);
                ctx.lineTo(sx, trackH - 14);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = isSelectedWord ? '#fbbf24' : '#c084fc';
                drawCircle(ctx, sx, trackH - 14, isSelectedWord ? 4 : 3);

                const wordLabel = w.text.length > 8 ? w.text.slice(0, 7) + '…' : w.text;
                ctx.font = isSelectedWord ? 'bold 9px sans-serif' : '9px sans-serif';
                const wW = ctx.measureText(wordLabel).width + 8;
                const wH = 15;
                const wX = Math.max(2, Math.min(width - wW - 2, sx - wW / 2));
                const wY = 28 + (w.index % 2) * 16;

                ctx.fillStyle = isSelectedWord ? 'rgba(126, 34, 206, 0.98)' : 'rgba(88, 28, 135, 0.90)';
                ctx.strokeStyle = isSelectedWord ? '#fbbf24' : '#c084fc';
                ctx.lineWidth = isSelectedWord ? 2 : 1;
                ctx.beginPath();
                drawRoundRect(ctx, wX, wY, wW, wH, 3);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(wordLabel, wX + wW / 2, wY + wH / 2);

                subBoxes.push({
                  lineIndex: i,
                  pointIndex: w.ptIndex,
                  wordIndex: w.index,
                  pointId: w.pointId,
                  sx,
                  badgeX: wX,
                  badgeY: wY,
                  badgeW: wW,
                  badgeH: wH,
                  time: w.time
                });
              }
            });
          }
        }
        subMarkerBoxesRef.current = subBoxes;
        pausePartitionsRef.current = pausePartitions;

        // 4. Render Red Playhead Needle
        if (safePlayTime >= safeViewStart && safePlayTime <= safeViewStart + safeViewDuration) {
          const playX = ((safePlayTime - safeViewStart) / safeViewDuration) * width;
          if (Number.isFinite(playX)) {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(playX, 0);
            ctx.lineTo(playX, trackH);
            ctx.stroke();

            // Playhead Time Badge
            const timeText = formatCentiseconds(safePlayTime);
            ctx.font = '9px monospace';
            const tw = ctx.measureText(timeText).width + 8;
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            drawRoundRect(ctx, playX - tw / 2, trackH - 16, tw, 14, 3);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(timeText, playX, trackH - 9);
          }
        }
      }
    } catch (err) {
      console.error('Error rendering timeline canvases:', err);
    }
  }, [duration, viewStart, viewDuration, lines, selectedRowIndex, isPlaying, hoveredMarkerIndex, hoveredPauseKey, selectedSyncPtKey]);

  // Continuously request animation frame during playback for silky 60fps spectrum
  useEffect(() => {
    try {
      renderAllCanvases();
    } catch (e) {
      console.error('Error rendering timeline canvases:', e);
    }
  }, [renderAllCanvases]);

  useEffect(() => {
    if (!isPlaying) {
      try {
        renderAllCanvases();
      } catch (e) {
        console.error('Error rendering timeline canvases on seek:', e);
      }
    }
  }, [playbackTime, isPlaying, renderAllCanvases]);

  useEffect(() => {
    if (!isPlaying) return;
    let rafId;
    const loop = () => {
      try {
        if (followPlayheadRef.current && isPlayingRef.current && isSameSongRef.current) {
          const cur = usePlaybackStore.getState().getAccuratePlaybackTime();
          const curStart = viewStartRef.current;
          const curDur = viewDurationRef.current;
          const totalDur = durationRef.current;
          if (cur > curStart + curDur - 1.5 || cur < curStart) {
            const targetStart = Math.max(0, Math.min(totalDur - curDur, cur - curDur * 0.25));
            setViewStart(targetStart);
          }
        }
        renderAllCanvases();
      } catch (e) {
        console.error('Error in timeline render loop:', e);
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, renderAllCanvases]);

  useEffect(() => {
    const handleResize = () => renderAllCanvases();
    window.addEventListener('resize', handleResize);

    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(() => {
        renderAllCanvases();
      });
      ro.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (ro) ro.disconnect();
    };
  }, [renderAllCanvases]);

  // 6. Interactive Minimap Handlers (Resize/Stretch/Pan View Rectangle)
  const handleMinimapMouseDown = (e) => {
    if (e.button !== 0 || durationRef.current <= 0) return;
    const wrap = minimapWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const mmW = rect.width;
    const dur = durationRef.current;
    const vStart = viewStartRef.current;
    const vDur = viewDurationRef.current;

    const clickX = Math.max(0, Math.min(mmW, e.clientX - rect.left));
    const clickedTime = (clickX / mmW) * dur;

    const vpX1 = (vStart / dur) * mmW;
    const vpX2 = ((vStart + vDur) / dur) * mmW;

    const HANDLE_PX = 8;
    const distVpLeft = Math.abs(clickX - vpX1);
    const distVpRight = Math.abs(clickX - vpX2);

    let mode = null;
    if (distVpLeft <= HANDLE_PX && distVpLeft <= distVpRight) {
      mode = 'vp-left';
    } else if (distVpRight <= HANDLE_PX) {
      mode = 'vp-right';
    } else if (clickedTime >= vStart && clickedTime <= vStart + vDur) {
      mode = 'vp-move';
    } else {
      // Click outside: Center view window
      const newStart = Math.max(0, Math.min(dur - vDur, clickedTime - vDur / 2));
      setViewStart(newStart);
      return;
    }

    isDraggingMinimapRef.current = mode;
    dragAnchorRef.current = {
      initialViewStart: vStart,
      initialViewDuration: vDur,
      initialViewEnd: vStart + vDur,
      startTime: clickedTime
    };

    document.body.style.cursor = mode.includes('left') || mode.includes('right') ? 'ew-resize' : 'grabbing';

    const onGlobalMinimapMove = (moveEvent) => {
      if (!minimapWrapRef.current || durationRef.current <= 0) return;
      const mRect = minimapWrapRef.current.getBoundingClientRect();
      const curX = Math.max(0, Math.min(mRect.width, moveEvent.clientX - mRect.left));
      const curTime = (curX / mRect.width) * durationRef.current;
      const curMode = isDraggingMinimapRef.current;
      const anchor = dragAnchorRef.current;
      if (!curMode || !anchor) return;

      const durTotal = durationRef.current;
      const minViewDur = 2.0;

      if (curMode === 'vp-left') {
        const newStart = Math.min(anchor.initialViewEnd - minViewDur, Math.max(0, curTime));
        const newDur = anchor.initialViewEnd - newStart;
        setViewStart(newStart);
        setViewDuration(newDur);
      } else if (curMode === 'vp-right') {
        const newEnd = Math.max(anchor.initialViewStart + minViewDur, Math.min(durTotal, curTime));
        const newDur = newEnd - anchor.initialViewStart;
        setViewDuration(newDur);
      } else if (curMode === 'vp-move') {
        const delta = curTime - anchor.startTime;
        const newStart = Math.max(0, Math.min(durTotal - anchor.initialViewDuration, anchor.initialViewStart + delta));
        setViewStart(newStart);
      }
    };

    const onGlobalMinimapUp = () => {
      isDraggingMinimapRef.current = null;
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onGlobalMinimapMove);
      window.removeEventListener('mouseup', onGlobalMinimapUp);
    };

    window.addEventListener('mousemove', onGlobalMinimapMove);
    window.addEventListener('mouseup', onGlobalMinimapUp);
  };

  const handleMinimapMouseMove = (e) => {
    if (isDraggingMinimapRef.current) return;
    const wrap = minimapWrapRef.current;
    if (!wrap || durationRef.current <= 0) return;
    const rect = wrap.getBoundingClientRect();
    const mmW = rect.width;
    const dur = durationRef.current;
    const vStart = viewStartRef.current;
    const vDur = viewDurationRef.current;

    const clickX = Math.max(0, Math.min(mmW, e.clientX - rect.left));
    const curTime = (clickX / mmW) * dur;

    const vpX1 = (vStart / dur) * mmW;
    const vpX2 = ((vStart + vDur) / dur) * mmW;

    const HANDLE_PX = 8;
    if (Math.abs(clickX - vpX1) <= HANDLE_PX || Math.abs(clickX - vpX2) <= HANDLE_PX) {
      wrap.style.cursor = 'ew-resize';
      wrap.title = 'Drag to shrink or stretch view window';
    } else if (curTime >= vStart && curTime <= vStart + vDur) {
      wrap.style.cursor = 'grab';
      wrap.title = 'Drag to pan visible view window';
    } else {
      wrap.style.cursor = 'pointer';
      wrap.title = 'Click to jump view window here';
    }
  };

  // 7. Interactive Timeline Canvas & Lyric Marker Dragging Handlers
  const getTimeFromCanvasEvent = (e) => {
    const wrap = canvasWrapRef.current;
    if (!wrap || durationRef.current <= 0) return 0;
    const rect = wrap.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const t = viewStartRef.current + (x / rect.width) * viewDurationRef.current;
    return Math.max(0, Math.min(durationRef.current, t));
  };

  const findHitLyricIndex = useCallback((canvasX, canvasY, width) => {
    const curLines = linesRef.current;
    const vStart = viewStartRef.current;
    const vDur = viewDurationRef.current;
    if (!curLines || curLines.length === 0 || vDur <= 0) return -1;

    // 1. First priority: Check if tapping/clicking any Lyric Text Box (Badge)
    // Check in reverse order so newer / top-painted badges take precedence
    const boxes = markerBoxesRef.current;
    if (boxes && boxes.length > 0) {
      let hitBadgeIndex = -1;
      let minBadgeCenterDist = Infinity;

      for (let k = boxes.length - 1; k >= 0; k--) {
        const b = boxes[k];
        if (!b) continue;
        // Generous 6px hit box margin around the badge
        const insideX = canvasX >= b.badgeX - 6 && canvasX <= b.badgeX + b.badgeW + 6;
        const insideY = canvasY >= b.badgeY - 6 && canvasY <= b.badgeY + b.badgeH + 8;

        if (insideX && insideY) {
          const center = b.badgeX + b.badgeW / 2;
          const dist = Math.abs(canvasX - center);
          // Prioritize already selected row if overlapping
          const priorityDist = selectedRowIndexRef.current === b.index ? dist - 14 : dist;
          if (priorityDist < minBadgeCenterDist) {
            minBadgeCenterDist = priorityDist;
            hitBadgeIndex = b.index;
          }
        }
      }

      if (hitBadgeIndex >= 0) return hitBadgeIndex;
    }

    // Dynamic badge fallback if boxes weren't populated yet
    for (let i = curLines.length - 1; i >= 0; i--) {
      const line = curLines[i];
      const lx = ((line.time - vStart) / vDur) * width;
      const previewText = line.text ? (line.text.length > 16 ? line.text.slice(0, 15) + '…' : line.text) : '#INST';
      const label = `[#${i + 1}] ${previewText}`;
      const approxW = Math.max(48, label.length * 6.5 + 14);
      const bX = Math.max(2, Math.min(width - approxW - 2, lx - approxW / 2));
      const bY = 3;
      const bH = 20;

      if (canvasX >= bX - 6 && canvasX <= bX + approxW + 6 && canvasY >= bY - 6 && canvasY <= bY + bH + 8) {
        return i;
      }
    }

    // 2. Second priority: Check if near the vertical marker line or knob (within generous 18px radius)
    let hitLineIndex = -1;
    let minLineDist = 18;

    for (let i = 0; i < curLines.length; i++) {
      const lx = ((curLines[i].time - vStart) / vDur) * width;
      const dist = Math.abs(canvasX - lx);
      if (dist < minLineDist && canvasY >= 0 && canvasY <= 126) {
        minLineDist = dist;
        hitLineIndex = i;
      }
    }

    return hitLineIndex;
  }, []);

  const hitTestPausePartitions = (canvasX, canvasY) => {
    if (!pausePartitionsRef.current || pausePartitionsRef.current.length === 0) return null;
    if (canvasY < 15 || canvasY > MAIN_TRACK_H - 6) return null;

    // Prioritize selected line's pauses first
    const partitions = [...pausePartitionsRef.current].sort((a, b) => {
      if (a.isSelected && !b.isSelected) return -1;
      if (!a.isSelected && b.isSelected) return 1;
      return 0;
    });

    for (const pp of partitions) {
      const leftDist = Math.abs(canvasX - pp.startX);
      const rightDist = Math.abs(canvasX - pp.endX);
      const handleRadius = 12;

      if (pp.endX - pp.startX < 24) {
        if (leftDist <= handleRadius && leftDist <= rightDist) {
          return { pp, mode: 'left' };
        }
        if (rightDist <= handleRadius) {
          return { pp, mode: 'right' };
        }
        if (canvasX >= pp.startX - 4 && canvasX <= pp.endX + 4) {
          return { pp, mode: 'move' };
        }
      } else {
        if (leftDist <= handleRadius) {
          return { pp, mode: 'left' };
        }
        if (rightDist <= handleRadius) {
          return { pp, mode: 'right' };
        }
        if (canvasX > pp.startX && canvasX < pp.endX) {
          return { pp, mode: 'move' };
        }
      }
    }
    return null;
  };

  const handleMainCanvasPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    if (durationRef.current <= 0) return;
    const wrap = canvasWrapRef.current;
    const canvas = mainCanvasRef.current;
    if (!wrap || !canvas) return;

    const wrapRect = wrap.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const width = wrapRect.width;

    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const canvasX = clientX - canvasRect.left;
    const canvasY = clientY - canvasRect.top;
    const clickTime = getTimeFromCanvasEvent(e);
    const curLines = linesRef.current;

    // Check if clicking or tapping a pause partition (left end, right end, or middle body)
    const pauseHit = hitTestPausePartitions(canvasX, canvasY);
    if (pauseHit && (typeof onUpdatePauseBounds === 'function' || typeof onUpdateSyncPointEndTime === 'function' || typeof onSelectSyncPoint === 'function')) {
      e.preventDefault();
      e.stopPropagation();
      const { pp, mode } = pauseHit;

      if (selectedRowIndex !== pp.lineIndex && typeof onSelectRow === 'function') {
        onSelectRow(pp.lineIndex);
        const listEl = document.querySelector('.sync-editor-list');
        const rowEl = document.getElementById(`sync-line-${pp.lineIndex}`);
        if (listEl && rowEl) {
          const listRect = listEl.getBoundingClientRect();
          const rowRect = rowEl.getBoundingClientRect();
          if (rowRect.top < listRect.top + 6) {
            listEl.scrollTop += (rowRect.top - listRect.top) - 14;
          } else if (rowRect.bottom > listRect.bottom - 6) {
            listEl.scrollTop += (rowRect.bottom - listRect.bottom) + 14;
          }
        }
      }

      if (typeof onSelectSyncPoint === 'function') {
        const pauseKey = typeof pp.prevWordIndex === 'number' && pp.prevWordIndex >= 0
          ? `${pp.lineIndex}_pause_${pp.prevWordIndex}`
          : `${pp.lineIndex}_${pp.pointIndex}`;
        onSelectSyncPoint(pauseKey);
      }

      if (typeof onUpdatePauseBounds === 'function' || typeof onUpdateSyncPointEndTime === 'function') {
        const pointId = pp.pointId || `pause_${pp.lineIndex}_${pp.prevWordIndex ?? pp.pointIndex}`;
        activePauseDragRef.current = {
          pp,
          mode,
          pointId,
          startX: clientX,
          initialClickTime: clickTime,
          initialStartTime: pp.startTime,
          initialEndTime: pp.endTime,
          initialDuration: pp.duration
        };

        document.body.style.cursor = mode === 'move' ? 'grabbing' : 'col-resize';
        try {
          renderAllCanvases();
        } catch (err) {}

        let lastStartTime = pp.startTime;
        let lastEndTime = pp.endTime;

        const onGlobalPauseMove = (moveEvt) => {
          if (!activePauseDragRef.current) return;
          moveEvt.preventDefault?.();
          const dragInfo = activePauseDragRef.current;
          const curMouseTime = getTimeFromCanvasEvent(moveEvt);
          const timeDelta = curMouseTime - dragInfo.initialClickTime;

          let newStartTime = dragInfo.initialStartTime;
          let newEndTime = dragInfo.initialEndTime;

          if (dragInfo.mode === 'left') {
            // Adjust start time (prev word endTime), keep end time fixed
            newStartTime = Math.max(0, Math.min(dragInfo.initialEndTime - 0.18, dragInfo.initialStartTime + timeDelta));
            newEndTime = dragInfo.initialEndTime;
          } else if (dragInfo.mode === 'right') {
            // Adjust end time (next word time), keep start time fixed
            newStartTime = dragInfo.initialStartTime;
            newEndTime = Math.max(dragInfo.initialStartTime + 0.18, Math.min(durationRef.current || 9999, dragInfo.initialEndTime + timeDelta));
          } else if (dragInfo.mode === 'move') {
            // Simply move both ends of the pause block, preserving duration
            const dur = dragInfo.initialDuration;
            const minStart = (dragInfo.pp.prevWord && typeof dragInfo.pp.prevWord.time === 'number')
              ? Math.round((dragInfo.pp.prevWord.time + 0.05) * 100) / 100
              : 0;
            const maxStart = Math.max(minStart, (durationRef.current || 9999) - dur);
            newStartTime = Math.max(minStart, Math.min(maxStart, Math.round((dragInfo.initialStartTime + timeDelta) * 100) / 100));
            newEndTime = Math.round((newStartTime + dur) * 100) / 100;
          }

          lastStartTime = newStartTime;
          lastEndTime = newEndTime;

          if (typeof onUpdatePauseBounds === 'function') {
            onUpdatePauseBounds(dragInfo.pp.lineIndex, dragInfo.pp.pointIndex, newStartTime, newEndTime, false, dragInfo.pointId, dragInfo.mode);
          } else if (typeof onUpdateSyncPointEndTime === 'function') {
            onUpdateSyncPointEndTime(dragInfo.pp.lineIndex, dragInfo.pp.pointIndex, newEndTime);
          }
        };

        const onGlobalPauseUp = (upEvt) => {
          upEvt?.preventDefault?.();
          if (activePauseDragRef.current) {
            const dragInfo = activePauseDragRef.current;
            if (typeof onUpdatePauseBounds === 'function') {
              onUpdatePauseBounds(dragInfo.pp.lineIndex, dragInfo.pp.pointIndex, lastStartTime, lastEndTime, true, dragInfo.pointId, dragInfo.mode);
            } else if (typeof onUpdateSyncPointEndTime === 'function') {
              onUpdateSyncPointEndTime(dragInfo.pp.lineIndex, dragInfo.pp.pointIndex, lastEndTime);
            }
            activePauseDragRef.current = null;
          }
          document.body.style.cursor = '';
          try {
            renderAllCanvases();
          } catch (err) {}
          window.removeEventListener('pointermove', onGlobalPauseMove);
          window.removeEventListener('pointerup', onGlobalPauseUp);
          window.removeEventListener('pointercancel', onGlobalPauseUp);
          window.removeEventListener('mousemove', onGlobalPauseMove);
          window.removeEventListener('mouseup', onGlobalPauseUp);
          window.removeEventListener('touchmove', onGlobalPauseMove);
          window.removeEventListener('touchend', onGlobalPauseUp);
        };

        window.addEventListener('pointermove', onGlobalPauseMove);
        window.addEventListener('pointerup', onGlobalPauseUp);
        window.addEventListener('pointercancel', onGlobalPauseUp);
        window.addEventListener('mousemove', onGlobalPauseMove);
        window.addEventListener('mouseup', onGlobalPauseUp);
        window.addEventListener('touchmove', onGlobalPauseMove);
        window.addEventListener('touchend', onGlobalPauseUp);
        return;
      }
    }

    // Check if clicking or tapping a sub-marker word pin / badge
    if (subMarkerBoxesRef.current && subMarkerBoxesRef.current.length > 0 && typeof onUpdateSyncPointTime === 'function') {
      for (const sb of subMarkerBoxesRef.current) {
        if (
          canvasX >= sb.badgeX - 6 && canvasX <= sb.badgeX + sb.badgeW + 6 &&
          canvasY >= sb.badgeY - 4 && canvasY <= sb.badgeY + sb.badgeH + 6
        ) {
          isDraggingSubMarkerRef.current = sb;
          document.body.style.cursor = 'ew-resize';

          if (selectedRowIndex !== sb.lineIndex && typeof onSelectRow === 'function') {
            onSelectRow(sb.lineIndex);
          }
          if (typeof onSelectSyncPoint === 'function') {
            onSelectSyncPoint(`${sb.lineIndex}_${sb.pointIndex}`);
          }

          let lastSubTime = sb.time;
          const onGlobalSubMove = (moveEvt) => {
            if (!isDraggingSubMarkerRef.current) return;
            const newTime = getTimeFromCanvasEvent(moveEvt);
            lastSubTime = newTime;
            onUpdateSyncPointTime(sb.lineIndex, sb.pointIndex, newTime, false);
          };

          const onGlobalSubUp = () => {
            if (isDraggingSubMarkerRef.current) {
              onUpdateSyncPointTime(sb.lineIndex, sb.pointIndex, lastSubTime, true);
              isDraggingSubMarkerRef.current = null;
            }
            document.body.style.cursor = '';
            window.removeEventListener('pointermove', onGlobalSubMove);
            window.removeEventListener('pointerup', onGlobalSubUp);
            window.removeEventListener('mousemove', onGlobalSubMove);
            window.removeEventListener('mouseup', onGlobalSubUp);
            window.removeEventListener('touchmove', onGlobalSubMove);
            window.removeEventListener('touchend', onGlobalSubUp);
          };

          window.addEventListener('pointermove', onGlobalSubMove);
          window.addEventListener('pointerup', onGlobalSubUp);
          window.addEventListener('mousemove', onGlobalSubMove);
          window.addEventListener('mouseup', onGlobalSubUp);
          window.addEventListener('touchmove', onGlobalSubMove);
          window.addEventListener('touchend', onGlobalSubUp);
          return;
        }
      }
    }

    // Check if clicking or tapping a Lyric Text Box Badge or Marker Pin
    const hitIndex = findHitLyricIndex(canvasX, canvasY, width);

    if (hitIndex >= 0) {
      // Immediately select the line
      onSelectRow(hitIndex);
      if (typeof onSelectSyncPoint === 'function') {
        onSelectSyncPoint(null);
      }
      const listEl = document.querySelector('.sync-editor-list');
      const rowEl = document.getElementById(`sync-line-${hitIndex}`);
      if (listEl && rowEl) {
        const listRect = listEl.getBoundingClientRect();
        const rowRect = rowEl.getBoundingClientRect();
        if (rowRect.top < listRect.top + 6) {
          listEl.scrollTop += (rowRect.top - listRect.top) - 14;
        } else if (rowRect.bottom > listRect.bottom - 6) {
          listEl.scrollTop += (rowRect.bottom - listRect.bottom) + 14;
        }
      }

      isDraggingMarkerRef.current = hitIndex;
      dragAnchorRef.current = { startX: clientX, initialTime: curLines[hitIndex].time };
      document.body.style.cursor = 'ew-resize';

      let lastLineTime = curLines[hitIndex].time;
      const onGlobalMarkerMove = (moveEvt) => {
        const curIdx = isDraggingMarkerRef.current;
        if (curIdx === null) return;
        const newTime = getTimeFromCanvasEvent(moveEvt);
        lastLineTime = newTime;
        onUpdateLineTime(curIdx, newTime, false);
      };

      const onGlobalMarkerUp = () => {
        const curIdx = isDraggingMarkerRef.current;
        if (curIdx !== null) {
          onUpdateLineTime(curIdx, lastLineTime, true);
          isDraggingMarkerRef.current = null;
        }
        document.body.style.cursor = '';
        window.removeEventListener('pointermove', onGlobalMarkerMove);
        window.removeEventListener('pointerup', onGlobalMarkerUp);
        window.removeEventListener('pointercancel', onGlobalMarkerUp);
        window.removeEventListener('mousemove', onGlobalMarkerMove);
        window.removeEventListener('mouseup', onGlobalMarkerUp);
        window.removeEventListener('touchmove', onGlobalMarkerMove);
        window.removeEventListener('touchend', onGlobalMarkerUp);
      };

      window.addEventListener('pointermove', onGlobalMarkerMove);
      window.addEventListener('pointerup', onGlobalMarkerUp);
      window.addEventListener('pointercancel', onGlobalMarkerUp);
      window.addEventListener('mousemove', onGlobalMarkerMove);
      window.addEventListener('mouseup', onGlobalMarkerUp);
      window.addEventListener('touchmove', onGlobalMarkerMove);
      window.addEventListener('touchend', onGlobalMarkerUp);
      return;
    }

    // Otherwise: Scrub / Seek Playhead directly to clicked timestamp
    if (typeof onSelectSyncPoint === 'function') {
      onSelectSyncPoint(null);
    }
    playbackTimeRef.current = clickTime;
    renderAllCanvases();
    onSeek(clickTime);
    isScrubbingRulerRef.current = true;
    document.body.style.cursor = 'col-resize';

    const onGlobalScrubMove = (moveEvt) => {
      if (!isScrubbingRulerRef.current) return;
      const scrubTime = getTimeFromCanvasEvent(moveEvt);
      playbackTimeRef.current = scrubTime;
      renderAllCanvases();
      onSeek(scrubTime);
    };

    const onGlobalScrubUp = () => {
      isScrubbingRulerRef.current = false;
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onGlobalScrubMove);
      window.removeEventListener('pointerup', onGlobalScrubUp);
      window.removeEventListener('pointercancel', onGlobalScrubUp);
      window.removeEventListener('mousemove', onGlobalScrubMove);
      window.removeEventListener('mouseup', onGlobalScrubUp);
      window.removeEventListener('touchmove', onGlobalScrubMove);
      window.removeEventListener('touchend', onGlobalScrubUp);
      renderAllCanvases();
    };

    window.addEventListener('pointermove', onGlobalScrubMove);
    window.addEventListener('pointerup', onGlobalScrubUp);
    window.addEventListener('pointercancel', onGlobalScrubUp);
    window.addEventListener('mousemove', onGlobalScrubMove);
    window.addEventListener('mouseup', onGlobalScrubUp);
    window.addEventListener('touchmove', onGlobalScrubMove);
    window.addEventListener('touchend', onGlobalScrubUp);
  };

  const handleMainCanvasPointerMove = (e) => {
    const wrap = canvasWrapRef.current;
    const canvas = mainCanvasRef.current;
    if (!wrap || !canvas || durationRef.current <= 0) return;
    if (isDraggingMarkerRef.current !== null || isScrubbingRulerRef.current || activePauseDragRef.current !== null || isDraggingSubMarkerRef.current !== null) return;

    const wrapRect = wrap.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const width = wrapRect.width;

    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const canvasX = clientX - canvasRect.left;
    const canvasY = clientY - canvasRect.top;

    // Check if hovering over pause partition (left handle, right handle, or middle body)
    const pauseHover = hitTestPausePartitions(canvasX, canvasY);
    if (pauseHover) {
      const { pp, mode } = pauseHover;
      const hoverKey = `${pp.lineIndex}_pause_${pp.prevWordIndex ?? pp.pointIndex}_${mode}`;
      if (hoveredPauseRef.current !== hoverKey) {
        hoveredPauseRef.current = hoverKey;
        setHoveredPauseKey(hoverKey);
      }
      hoveredSubMarkerRef.current = null;
      if (mode === 'left') {
        wrap.style.cursor = 'col-resize';
        wrap.title = `Drag left edge to resize pause start (current: ${pp.duration}s)`;
      } else if (mode === 'right') {
        wrap.style.cursor = 'col-resize';
        wrap.title = `Drag right edge to resize pause end (current: ${pp.duration}s)`;
      } else {
        wrap.style.cursor = 'grab';
        wrap.title = `Pause (${pp.duration}s) - Drag to move both ends, drag edges to resize, press Delete to remove`;
      }
      return;
    } else if (hoveredPauseRef.current !== null) {
      hoveredPauseRef.current = null;
      setHoveredPauseKey(null);
    }

    // Check if hovering over sub-marker word badge
    let hitSub = null;
    if (subMarkerBoxesRef.current && subMarkerBoxesRef.current.length > 0) {
      for (const sb of subMarkerBoxesRef.current) {
        if (
          canvasX >= sb.badgeX - 4 && canvasX <= sb.badgeX + sb.badgeW + 4 &&
          canvasY >= sb.badgeY - 4 && canvasY <= sb.badgeY + sb.badgeH + 4
        ) {
          hitSub = sb;
          break;
        }
      }
    }

    if (hitSub) {
      hoveredSubMarkerRef.current = { lineIndex: hitSub.lineIndex, pointIndex: hitSub.pointIndex };
      wrap.style.cursor = 'ew-resize';
      wrap.title = `Word timestamp #${hitSub.pointIndex + 1} (Click to select, drag to adjust, press Delete to remove)`;
      return;
    } else {
      hoveredSubMarkerRef.current = null;
    }

    const hitIndex = findHitLyricIndex(canvasX, canvasY, width);

    if (hoveredMarkerIndexRef.current !== hitIndex) {
      hoveredMarkerIndexRef.current = hitIndex;
      setHoveredMarkerIndex(hitIndex);
    }

    if (hitIndex >= 0) {
      wrap.style.cursor = 'pointer';
      const line = linesRef.current[hitIndex];
      const preview = line ? (line.text || '(empty line)') : '';
      wrap.title = `Line #${hitIndex + 1}: "${preview}" (Click or tap to select, drag to adjust)`;
    } else {
      wrap.style.cursor = 'crosshair';
      wrap.title = 'Double-click to insert line, click to seek playhead';
    }
  };

  const handleMainCanvasPointerLeave = () => {
    if (hoveredMarkerIndexRef.current !== -1) {
      hoveredMarkerIndexRef.current = -1;
      setHoveredMarkerIndex(-1);
    }
    if (hoveredPauseRef.current !== null) {
      hoveredPauseRef.current = null;
      setHoveredPauseKey(null);
    }
    hoveredSubMarkerRef.current = null;
  };

  // Double click canvas to insert a new line at clicked timestamp
  const handleMainCanvasDoubleClick = (e) => {
    const wrap = canvasWrapRef.current;
    const canvas = mainCanvasRef.current;
    if (wrap && canvas) {
      const wrapRect = wrap.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - canvasRect.left;
      const canvasY = e.clientY - canvasRect.top;
      // Do not insert duplicate if double clicking an existing lyric text box or pin or pause
      const hitIdx = findHitLyricIndex(canvasX, canvasY, wrapRect.width);
      if (hitIdx >= 0) return;
      if (hitTestPausePartitions(canvasX, canvasY)) return;
    }

    const clickedTime = getTimeFromCanvasEvent(e);
    // Find index of last line before this timestamp
    let insertAfter = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= clickedTime) {
        insertAfter = i;
      } else {
        break;
      }
    }
    onAddLine(insertAfter, clickedTime);
  };

  // Wheel zoom and pan
  const handleWheel = (e) => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    e.preventDefault();

    if (e.ctrlKey || e.metaKey || e.altKey) {
      const rect = wrap.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const factor = e.deltaY > 0 ? 1.25 : 0.80;
      handleZoom(factor, ratio);
    } else {
      const deltaSeconds = (e.deltaX || e.deltaY) * (viewDuration / 500);
      setViewStart((prev) => Math.max(0, Math.min(duration - viewDuration, prev + deltaSeconds)));
    }
  };

  return (
    <div className="lyrics-timeline-container" ref={containerRef}>
      {/* 1. Timeline Header & Control Toolbar */}
      <div className="lyrics-timeline-toolbar">
        {/* Left: Playback & Follow Controls */}
        <div className="lyrics-tl-btn-group">
          <button
            type="button"
            className={`btn-tl-ctrl ${isPlaying ? 'is-playing' : ''}`}
            onClick={onTogglePlayPause}
            title={isPlaying ? 'Pause Playback (Space)' : 'Start Playback (Space)'}
          >
            <i className={isPlaying ? 'icon-pause' : 'icon-play'}></i>
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          <button
            type="button"
            className="btn-tl-ctrl"
            onClick={() => {
              if (selectedRowIndex >= 0 && lines[selectedRowIndex]) {
                onSeek(lines[selectedRowIndex].time);
                if (!isPlaying) onTogglePlayPause();
              }
            }}
            disabled={selectedRowIndex < 0}
            title="Play Active Lyric Line (Shift + Space)"
          >
            <i className="icon-play-circle"></i>
            <span>Play Line</span>
          </button>

          <button
            type="button"
            className="btn-tl-ctrl"
            onClick={() => {
              if (isPlaying && typeof onTogglePlayPause === 'function') {
                onTogglePlayPause();
              }
              onSeek(0);
            }}
            title="Stop & Rewind to Beginning (K)"
          >
            <i className="icon-skip-back"></i>
          </button>

          <div className="tl-toolbar-divider"></div>

          {/* Auto-Follow Playhead Toggle */}
          <button
            type="button"
            className={`btn-tl-ctrl ${followPlayhead ? 'is-active-follow' : ''}`}
            onClick={() => setFollowPlayhead(!followPlayhead)}
            title={followPlayhead ? 'Auto-follow active during playback' : 'Enable auto-follow playhead'}
          >
            <i className="icon-locate"></i>
            <span>Follow</span>
          </button>
        </div>

        {/* Center: Lyrics Timing & Alignment Tools */}
        <div className="lyrics-tl-btn-group">
          <button
            type="button"
            className="btn-tl-action btn-stamp-active"
            onClick={onStampCurrentLine}
            title="Stamp Selected Line to Current Playhead Time (Enter)"
          >
            <i className="icon-check"></i>
            <span>Stamp at Playhead</span>
          </button>

          <button
            type="button"
            className="btn-tl-action"
            onClick={handleSnapTransient}
            disabled={selectedRowIndex < 0}
            title="Automatically align line to nearest vocal onset transient peak"
          >
            <i className="icon-wand-2"></i>
            <span>Snap Vocal Onset</span>
          </button>

          {transientStatus && (
            <span className="transient-status-badge">
              <i className="icon-sparkles"></i> {transientStatus}
            </span>
          )}
        </div>

        {/* Right: Zoom & Navigation Controls */}
        <div className="lyrics-tl-btn-group">

          <button type="button" className="btn-tl-icon-only" onClick={() => handleZoom(0.7)} title="Zoom In (+)">
            <i className="icon-zoom-in"></i>
          </button>
          <button type="button" className="btn-tl-icon-only" onClick={() => handleZoom(1.4)} title="Zoom Out (-)">
            <i className="icon-zoom-out"></i>
          </button>
          <button type="button" className="btn-tl-icon-only" onClick={handleZoomToActiveLine} title="Zoom to Active Line (Z)">
            <i className="icon-maximize-2"></i>
          </button>
          <button type="button" className="btn-tl-icon-only" onClick={handleZoomFit} title="Fit Entire Song (F)">
            <i className="icon-refresh-cw"></i>
          </button>

          <button
            type="button"
            className="btn-tl-icon-only"
            onClick={() => setShowShortcutsModal(true)}
            title="Lyrics Editor Keyboard Shortcuts (?)"
          >
            <i className="icon-help-circle"></i>
          </button>

          <button
            type="button"
            className="btn-tl-icon-only"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? 'Expand Timeline' : 'Collapse Timeline'}
          >
            <i className={isCollapsed ? 'icon-chevron-down' : 'icon-chevron-up'}></i>
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* 2. Minimap Overview Bar with Viewport Navigation */}
          <div
            ref={minimapWrapRef}
            className="lyrics-timeline-minimap-row"
            onMouseDown={handleMinimapMouseDown}
            onMouseMove={handleMinimapMouseMove}
            title="Minimap: Drag cyan edges to resize view window, drag center to pan, or click to jump"
          >
            <canvas ref={minimapCanvasRef} className="lyrics-minimap-canvas" />
          </div>

          {/* 3. Main Multi-Layer Waveform, Live Spectrum & Lyrics Pin Workspace */}
          <div
            ref={canvasWrapRef}
            className="lyrics-timeline-workspace"
            onPointerDown={handleMainCanvasPointerDown}
            onPointerMove={handleMainCanvasPointerMove}
            onPointerLeave={handleMainCanvasPointerLeave}
            onDoubleClick={handleMainCanvasDoubleClick}
            onWheel={handleWheel}
          >
            {/* Synchronized Time Ruler */}
            <div
              className="lyrics-ruler-wrap"
              onPointerMove={handleMainCanvasPointerMove}
            >
              <canvas ref={rulerCanvasRef} className="lyrics-ruler-canvas" />
            </div>

            {/* Main Interactive Waveform & Lyric Pins Canvas */}
            <div
              className="lyrics-canvas-wrap"
            >
              <canvas ref={mainCanvasRef} className="lyrics-main-canvas" />
            </div>
          </div>
        </>
      )}

      {/* Keyboard Shortcuts Cheatsheet Modal */}
      {showShortcutsModal && (
        <div className="modal-backdrop stem-shortcuts-backdrop" onClick={() => setShowShortcutsModal(false)}>
          <div className="modal-box stem-shortcuts-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><i className="icon-command" style={{ marginRight: '0.4rem' }}></i> Lyrics Visual Editor Shortcuts</h3>
              <button className="btn-close" onClick={() => setShowShortcutsModal(false)}><i className="icon-x"></i></button>
            </div>
            <div className="shortcuts-grid">
              <div className="shortcut-col">
                <h4>Playback &amp; Transport</h4>
                <div className="shortcut-row"><kbd>Space</kbd><span>Play / Pause</span></div>
                <div className="shortcut-row"><kbd>Shift + Space</kbd><span>Play Active Line</span></div>
                <div className="shortcut-row"><kbd>K</kbd><span>Stop &amp; Rewind</span></div>
                <div className="shortcut-row"><kbd>← / →</kbd><span>Nudge Active Line (±{nudgeStep}s)</span></div>
              </div>

              <div className="shortcut-col">
                <h4>Timeline &amp; Zoom</h4>
                <div className="shortcut-row"><kbd>+ / =</kbd><span>Zoom In</span></div>
                <div className="shortcut-row"><kbd>- / _</kbd><span>Zoom Out</span></div>
                <div className="shortcut-row"><kbd>Z</kbd><span>Zoom to Active Line</span></div>
                <div className="shortcut-row"><kbd>F</kbd><span>Fit Entire Song</span></div>
                <div className="shortcut-row"><kbd>Ctrl+Wheel</kbd><span>Zoom at Mouse Cursor</span></div>
                <div className="shortcut-row"><kbd>Minimap</kbd><span>Drag Cyan Edges to Resize</span></div>
              </div>

              <div className="shortcut-col">
                <h4>Syncing &amp; Editing</h4>
                <div className="shortcut-row"><kbd>Enter</kbd><span>Stamp Line at Playhead</span></div>
                <div className="shortcut-row"><kbd>Delete / ⌫</kbd><span>Remove Selected Timestamp / Pause</span></div>
                <div className="shortcut-row"><kbd>Drag Marker</kbd><span>Move Lyric Pin in Timeline</span></div>
                <div className="shortcut-row"><kbd>Drag Pause Body</kbd><span>Move Both Pause Ends</span></div>
                <div className="shortcut-row"><kbd>Drag Pause Edges</kbd><span>Resize Pause Duration</span></div>
                <div className="shortcut-row"><kbd>Double Click</kbd><span>Insert Line at Timestamp</span></div>
                <div className="shortcut-row"><kbd>Ctrl + S</kbd><span>Save Synced Lyrics</span></div>
                <div className="shortcut-row"><kbd>Ctrl + Z</kbd><span>Undo Timestamp Edit</span></div>
                <div className="shortcut-row"><kbd>?</kbd><span>Toggle Shortcuts Help</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default LyricsTimelineSpectrumEditor;
