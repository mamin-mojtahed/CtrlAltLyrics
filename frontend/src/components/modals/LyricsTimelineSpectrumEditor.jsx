import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as audioPlayer from '../../services/audioPlayer';
import { formatCentiseconds } from '../../utils/themeColors';

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
  onStampCurrentLine
}, ref) {
  // Viewport window (in seconds)
  const [viewStart, setViewStart] = useState(0);
  const [viewDuration, setViewDuration] = useState(25);
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [transientStatus, setTransientStatus] = useState(null);
  const [hoveredMarkerIndex, setHoveredMarkerIndex] = useState(-1);

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
  const animFrameRef = useRef(null);

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

  // Downsample AudioBuffer into fast 3,000-bucket min/max peaks
  const generatePeaks = (mixBuf, leadBuf) => {
    if (!mixBuf) return;
    const buckets = 3000;
    const computeFor = (buf) => {
      if (!buf) return null;
      const ch0 = buf.getChannelData(0);
      const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
      const len = buf.length;
      const step = len / buckets;
      const peaks = new Float32Array(buckets * 2);

      for (let i = 0; i < buckets; i++) {
        const start = Math.floor(i * step);
        const end = Math.min(len, Math.floor((i + 1) * step));
        let min = 0;
        let max = 0;

        for (let j = start; j < end; j += 4) {
          const s = (ch0[j] + ch1[j]) * 0.5;
          if (s < min) min = s;
          if (s > max) max = s;
        }
        peaks[i * 2] = min;
        peaks[i * 2 + 1] = max;
      }
      return peaks;
    };

    peaksCacheRef.current = {
      mix: computeFor(mixBuf),
      lead: leadBuf ? computeFor(leadBuf) : null
    };
    renderAllCanvases();
  };

  // 2. Playhead Auto-Follow Logic during Playback
  useEffect(() => {
    if (!isPlaying || !followPlayhead || duration <= 0) return;

    const cur = playbackTime;
    const curStart = viewStartRef.current;
    const curDur = viewDurationRef.current;

    // Advance view when playhead exceeds 75% of view or lags behind
    if (cur > curStart + curDur * 0.75 || cur < curStart) {
      const targetStart = Math.max(0, Math.min(duration - curDur, cur - curDur * 0.30));
      setViewStart(targetStart);
    }
  }, [playbackTime, isPlaying, followPlayhead, duration]);

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
    snapTransient: handleSnapTransient
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

  // 5. Canvas Rendering Loop
  const renderAllCanvases = useCallback(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap || duration <= 0) return;

    const width = wrap.clientWidth;
    if (width <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // ==========================================
    // A. Render Minimap Overview
    // ==========================================
    const minimap = minimapCanvasRef.current;
    if (minimap) {
      const mmW = minimap.clientWidth;
      const mmH = 30;
      minimap.width = Math.floor(mmW * dpr);
      minimap.height = Math.floor(mmH * dpr);
      minimap.style.width = `${mmW}px`;
      minimap.style.height = `${mmH}px`;

      const ctx = minimap.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, mmW, mmH);

      // Background
      ctx.fillStyle = '#060a12';
      ctx.fillRect(0, 0, mmW, mmH);

      // Thumbnail waveform silhouette
      const peaks = peaksCacheRef.current.lead || peaksCacheRef.current.mix;
      if (peaks) {
        const total = peaks.length / 2;
        ctx.fillStyle = 'rgba(99, 102, 241, 0.40)';
        ctx.beginPath();
        for (let x = 0; x < mmW; x++) {
          const b = Math.floor((x / mmW) * total);
          const max = peaks[b * 2 + 1];
          const barH = Math.max(1, max * (mmH / 2) * 0.85);
          ctx.rect(x, mmH / 2 - barH, 1, barH * 2);
        }
        ctx.fill();
      }

      // Lyric Tick Markers across the whole song
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lx = (line.time / duration) * mmW;
        if (lx >= 0 && lx <= mmW) {
          const isSel = selectedRowIndex === i;
          ctx.fillStyle = isSel ? '#fbbf24' : 'rgba(255, 255, 255, 0.45)';
          ctx.fillRect(lx - (isSel ? 1.5 : 0.5), isSel ? 2 : 7, isSel ? 3 : 1, isSel ? mmH - 4 : mmH - 14);
        }
      }

      // Viewport Camera Window (Cyan Theme)
      const vpX1 = Math.max(0, (viewStart / duration) * mmW);
      const vpX2 = Math.min(mmW, ((viewStart + viewDuration) / duration) * mmW);
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
      const pmX = (playbackTime / duration) * mmW;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pmX, 0);
      ctx.lineTo(pmX, mmH);
      ctx.stroke();
    }

    // ==========================================
    // B. Render Time Ruler
    // ==========================================
    const ruler = rulerCanvasRef.current;
    if (ruler) {
      const rH = 24;
      ruler.width = Math.floor(width * dpr);
      ruler.height = Math.floor(rH * dpr);
      ruler.style.width = `${width}px`;
      ruler.style.height = `${rH}px`;

      const ctx = ruler.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, rH);

      // Background
      ctx.fillStyle = '#0a0e1a';
      ctx.fillRect(0, 0, width, rH);

      // Time Steps
      let timeStep = 5;
      if (viewDuration <= 3) timeStep = 0.2;
      else if (viewDuration <= 8) timeStep = 0.5;
      else if (viewDuration <= 18) timeStep = 1;
      else if (viewDuration <= 45) timeStep = 2;
      else if (viewDuration <= 90) timeStep = 5;
      else timeStep = 15;

      const firstTick = Math.floor(viewStart / timeStep) * timeStep;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';

      for (let t = firstTick; t <= viewStart + viewDuration; t += timeStep) {
        const x = ((t - viewStart) / viewDuration) * width;
        if (x >= 0 && x <= width) {
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
      if (playbackTime >= viewStart && playbackTime <= viewStart + viewDuration) {
        const px = ((playbackTime - viewStart) / viewDuration) * width;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(px - 5, 0);
        ctx.lineTo(px + 5, 0);
        ctx.lineTo(px, 12);
        ctx.closePath();
        ctx.fill();
      }
    }

    // ==========================================
    // C. Render Main Spectrum & Waveform Track
    // ==========================================
    const canvas = mainCanvasRef.current;
    if (canvas) {
      const trackH = 120;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(trackH * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${trackH}px`;

      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
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
      if (buf && duration > 0) {
        const ch = buf.getChannelData(0);
        const sampleRate = buf.sampleRate || 44100;
        const startSample = Math.max(0, Math.floor(viewStart * sampleRate));
        const endSample = Math.min(ch.length, Math.floor((viewStart + viewDuration) * sampleRate));
        const totalSamples = endSample - startSample;

        if (totalSamples > 0) {
          const step = totalSamples / width;
          const maxAmp = (trackH / 2) * 0.88;

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
            const s0 = Math.floor(startSample + x * step);
            const s1 = Math.min(ch.length, Math.floor(startSample + (x + 1) * step));
            let min = 0;
            let max = 0;
            const len = s1 - s0;
            const stride = Math.max(1, Math.floor(len / 48));

            for (let s = s0; s < s1; s += stride) {
              const v = ch[s];
              if (v < min) min = v;
              if (v > max) max = v;
            }

            const topY = centerY - Math.max(1, max * maxAmp);
            const botY = centerY - Math.min(-1, min * maxAmp);
            ctx.rect(x, topY, 1, Math.max(1.5, botY - topY));
          }
          ctx.fill();

          // Vocal Formant Energy Layer (Highlighted in Gold & Rose)
          const stemBuffers = audioPlayer.getStemBuffers();
          const leadBuf = stemBuffers.leadBuf || (buf !== audioPlayer.getLoadedBuffer() ? audioBufferRef.current : null);

          if (leadBuf && leadBuf !== buf) {
            const leadCh = leadBuf.getChannelData(0);
            const leadSampleRate = leadBuf.sampleRate || 44100;
            const leadStart = Math.max(0, Math.floor(viewStart * leadSampleRate));
            const leadEnd = Math.min(leadCh.length, Math.floor((viewStart + viewDuration) * leadSampleRate));
            const leadTotal = leadEnd - leadStart;

            if (leadTotal > 0) {
              const leadStep = leadTotal / width;
              const vocalGrad = ctx.createLinearGradient(0, 0, 0, trackH);
              vocalGrad.addColorStop(0, '#f43f5e'); // Rose
              vocalGrad.addColorStop(0.5, '#fbbf24'); // Bright Gold
              vocalGrad.addColorStop(1, '#f43f5e');

              ctx.fillStyle = vocalGrad;
              ctx.beginPath();

              for (let x = 0; x < width; x++) {
                const s0 = Math.floor(leadStart + x * leadStep);
                const s1 = Math.min(leadCh.length, Math.floor(leadStart + (x + 1) * leadStep));
                let min = 0;
                let max = 0;
                const len = s1 - s0;
                const stride = Math.max(1, Math.floor(len / 48));

                for (let s = s0; s < s1; s += stride) {
                  const v = leadCh[s];
                  if (v < min) min = v;
                  if (v > max) max = v;
                }

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
        const peaks = peaksCacheRef.current.lead || peaksCacheRef.current.mix;
        if (peaks && duration > 0) {
          const totalBuckets = peaks.length / 2;
          const maxAmp = (trackH / 2) * 0.88;
          ctx.fillStyle = '#818cf8';
          ctx.beginPath();
          for (let x = 0; x < width; x += 2) {
            const t0 = viewStart + (x / width) * viewDuration;
            const t1 = viewStart + ((x + 2) / width) * viewDuration;
            const b0 = Math.max(0, Math.min(totalBuckets - 1, Math.floor((t0 / duration) * totalBuckets)));
            const b1 = Math.max(0, Math.min(totalBuckets - 1, Math.floor((t1 / duration) * totalBuckets)));
            let min = 0, max = 0;
            for (let b = b0; b <= b1; b++) {
              if (peaks[b * 2] < min) min = peaks[b * 2];
              if (peaks[b * 2 + 1] > max) max = peaks[b * 2 + 1];
            }
            const topY = centerY - Math.max(1, max * maxAmp);
            const botY = centerY - Math.min(-1, min * maxAmp);
            ctx.rect(x, topY, 1.5, Math.max(2, botY - topY));
          }
          ctx.fill();
        }
      }
      // 2. Render Interactive Lyric Pins & Badges
      const boxes = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lx = ((line.time - viewStart) / viewDuration) * width;

        if (lx >= -80 && lx <= width + 80) {
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
          ctx.beginPath();
          ctx.arc(lx, trackH - 10, isSel || isHov ? 5 : 4, 0, Math.PI * 2);
          ctx.fill();

          // Lyric Header Pill Badge at Top of Pin
          const previewText = line.text ? (line.text.length > 16 ? line.text.slice(0, 15) + '…' : line.text) : '#INST';
          const label = `[#${i + 1}] ${previewText}`;
          ctx.font = isSel ? 'bold 10px sans-serif' : '10px sans-serif';
          const textW = ctx.measureText(label).width;
          const badgeW = textW + 14;
          const badgeH = 20;
          const badgeX = Math.max(2, Math.min(width - badgeW - 2, lx - badgeW / 2));
          const badgeY = 3;

          boxes.push({ index: i, lx, badgeX, badgeY, badgeW, badgeH, time: line.time });

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
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
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

      // 4. Render Red Playhead Needle
      if (playbackTime >= viewStart && playbackTime <= viewStart + viewDuration) {
        const playX = ((playbackTime - viewStart) / viewDuration) * width;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(playX, 0);
        ctx.lineTo(playX, trackH);
        ctx.stroke();

        // Playhead Time Badge
        const timeText = formatCentiseconds(playbackTime);
        ctx.font = '9px monospace';
        const tw = ctx.measureText(timeText).width + 8;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.roundRect(playX - tw / 2, trackH - 16, tw, 14, 3);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(timeText, playX, trackH - 9);
      }
    }
  }, [duration, viewStart, viewDuration, playbackTime, lines, selectedRowIndex, isPlaying, hoveredMarkerIndex]);

  // Continuously request animation frame during playback for silky 60fps spectrum
  useEffect(() => {
    renderAllCanvases();
  }, [renderAllCanvases]);

  useEffect(() => {
    if (!isPlaying) return;
    let rafId;
    const loop = () => {
      renderAllCanvases();
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

    // Check if clicking or tapping a Lyric Text Box Badge or Marker Pin
    const hitIndex = findHitLyricIndex(canvasX, canvasY, width);

    if (hitIndex >= 0) {
      // Immediately select the line
      onSelectRow(hitIndex);
      const rowEl = document.getElementById(`sync-line-${hitIndex}`);
      if (rowEl) rowEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

      isDraggingMarkerRef.current = hitIndex;
      dragAnchorRef.current = { startX: clientX, initialTime: curLines[hitIndex].time };
      document.body.style.cursor = 'ew-resize';

      const onGlobalMarkerMove = (moveEvt) => {
        const curIdx = isDraggingMarkerRef.current;
        if (curIdx === null) return;
        const newTime = getTimeFromCanvasEvent(moveEvt);
        onUpdateLineTime(curIdx, newTime);
      };

      const onGlobalMarkerUp = () => {
        isDraggingMarkerRef.current = null;
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
    onSeek(clickTime);
    isScrubbingRulerRef.current = true;
    document.body.style.cursor = 'col-resize';

    const onGlobalScrubMove = (moveEvt) => {
      if (!isScrubbingRulerRef.current) return;
      const scrubTime = getTimeFromCanvasEvent(moveEvt);
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
    if (isDraggingMarkerRef.current !== null || isScrubbingRulerRef.current) return;

    const wrapRect = wrap.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const width = wrapRect.width;

    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const canvasX = clientX - canvasRect.left;
    const canvasY = clientY - canvasRect.top;

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
      // Do not insert duplicate if double clicking an existing lyric text box or pin
      const hitIdx = findHitLyricIndex(canvasX, canvasY, wrapRect.width);
      if (hitIdx >= 0) return;
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
            onClick={() => onSeek(0)}
            title="Rewind to Beginning (K)"
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
                <div className="shortcut-row"><kbd>Drag Marker</kbd><span>Move Lyric Pin in Timeline</span></div>
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
