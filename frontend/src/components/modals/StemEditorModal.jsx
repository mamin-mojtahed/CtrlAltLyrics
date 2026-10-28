import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useModalStore } from '../../stores/useModalStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import * as api from '../../services/api';
import * as audioPlayer from '../../services/audioPlayer';
import { audioBufferToWav } from '../../utils/wavEncoder';

const TRACK_CONFIGS = [
  {
    id: 'inst',
    stemKey: 'inst',
    name: 'Instrumental',
    icon: 'icon-music',
    color: '#06b6d4',      // Cyan
    colorDark: '#083344',
    gradTop: '#22d3ee',
    gradBot: '#0891b2'
  },
  {
    id: 'lead',
    stemKey: 'lead',
    name: 'Lead Vocals',
    icon: 'icon-mic',
    color: '#a855f7',      // Violet/Purple
    colorDark: '#3b0764',
    gradTop: '#c084fc',
    gradBot: '#9333ea'
  },
  {
    id: 'back',
    stemKey: 'back',
    name: 'Backing Vocals',
    icon: 'icon-users',
    color: '#f59e0b',      // Amber/Gold
    colorDark: '#451a03',
    gradTop: '#fbbf24',
    gradBot: '#d97706'
  }
];

function formatTimePrecise(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) return '00:00.00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const wholeSecs = Math.floor(secs);
  const hundredths = Math.floor((secs - wholeSecs) * 100);
  return `${String(mins).padStart(2, '0')}:${String(wholeSecs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export default function StemEditorModal() {
  const song = useModalStore((state) => state.stemEditorModalSong);
  const close = useModalStore((state) => state.closeStemEditorModal);

  // Audio Context & Decoded AudioBuffers
  const audioCtxRef = useRef(null);
  const buffersRef = useRef({ inst: null, lead: null, back: null });
  const [isAudioLoaded, setIsAudioLoaded] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('Initializing Stem Editor...');
  const [loadError, setLoadError] = useState(null);

  // Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLooping, setIsLooping] = useState(false);

  // Active Web Audio Sources & Gain Nodes
  const activeSourcesRef = useRef({});
  const gainNodesRef = useRef({});
  const playbackStartTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const animFrameRef = useRef(null);

  // Track Control States (Mute, Solo, Volume)
  const [trackStates, setTrackStates] = useState({
    inst: { muted: false, solo: false, volume: 1.0 },
    lead: { muted: false, solo: false, volume: 1.0 },
    back: { muted: false, solo: false, volume: 1.0 }
  });

  // Viewport & Zoom Navigation (in seconds)
  const [viewStart, setViewStart] = useState(0);
  const [viewDuration, setViewDuration] = useState(30);

  // Selection Interval: { start: number, end: number } in seconds
  const [selection, setSelection] = useState(null);
  const isDraggingWaveformRef = useRef(null); // 'create' | 'left' | 'right' | 'move'
  const isDraggingMinimapRef = useRef(null);   // 'sel-left' | 'sel-right' | 'sel-move' | 'vp-left' | 'vp-right' | 'vp-move'
  const dragAnchorRef = useRef({ startX: 0, initialStart: 0, initialEnd: 0, initialViewStart: 0, initialViewDuration: 0, initialViewEnd: 0, startTime: 0 });

  // Synchronized refs to guarantee zero-latency, fresh values in global drag listeners
  const viewStartRef = useRef(viewStart);
  viewStartRef.current = viewStart;
  const viewDurationRef = useRef(viewDuration);
  viewDurationRef.current = viewDuration;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Stem Correction Tool Panel
  const [sourceStem, setSourceStem] = useState('lead');
  const [actionType, setActionType] = useState('move'); // 'move' | 'copy' | 'swap' | 'silence'
  const [targetStem, setTargetStem] = useState('inst');
  const [crossfadeMs, setCrossfadeMs] = useState(10);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // Undo / Redo Stacks
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);

  // Downsampled Peak Cache for Fast 60fps Waveform Rendering
  const peaksCacheRef = useRef({ inst: null, lead: null, back: null });

  // DOM Refs (Waveforms Pane is the dedicated coordinate parent)
  const workspaceRef = useRef(null);
  const waveformsPaneRef = useRef(null);
  const timeRulerCanvasRef = useRef(null);
  const minimapWrapRef = useRef(null);
  const minimapCanvasRef = useRef(null);
  const trackCanvasRefs = useRef({});

  // 1. Initialize Audio Context and Fetch Stems
  useEffect(() => {
    if (!song) return;

    let isCancelled = false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setLoadError('Web Audio API is not supported in this browser.');
      return;
    }

    const ctx = new AudioContextClass();
    audioCtxRef.current = ctx;

    gainNodesRef.current = {
      inst: ctx.createGain(),
      lead: ctx.createGain(),
      back: ctx.createGain(),
      master: ctx.createGain()
    };
    gainNodesRef.current.inst.connect(gainNodesRef.current.master);
    gainNodesRef.current.lead.connect(gainNodesRef.current.master);
    gainNodesRef.current.back.connect(gainNodesRef.current.master);
    gainNodesRef.current.master.connect(ctx.destination);

    const loadStems = async () => {
      setIsAudioLoaded(false);
      setLoadError(null);
      setLoadingMsg('Fetching multi-track stem files...');

      try {
        const stems = song.stems || {};
        const instUrl = stems.inst || stems.full || `/audio/${song.id}/instrumental.mp3`;
        const leadUrl = stems.lead || stems.full || `/audio/${song.id}/lead_vocal.mp3`;
        const backUrl = stems.back || stems.full || `/audio/${song.id}/back_vocal.mp3`;

        const fetchAndDecode = async (url, label) => {
          setLoadingMsg(`Loading & decoding ${label}...`);
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${label}`);
            const arrayBuf = await res.arrayBuffer();
            return await ctx.decodeAudioData(arrayBuf);
          } catch (e) {
            console.warn(`Failed to decode stem ${label} from ${url}:`, e);
            return null;
          }
        };

        const [instBuf, leadBuf, backBuf] = await Promise.all([
          fetchAndDecode(instUrl, 'Instrumental stem'),
          fetchAndDecode(leadUrl, 'Lead Vocals stem'),
          fetchAndDecode(backUrl, 'Backing Vocals stem')
        ]);

        if (isCancelled) return;

        const maxLen = Math.max(instBuf?.length || 0, leadBuf?.length || 0, backBuf?.length || 0);
        const sampleRate = instBuf?.sampleRate || leadBuf?.sampleRate || backBuf?.sampleRate || 44100;
        const totalDur = maxLen / sampleRate;

        if (totalDur <= 0) {
          throw new Error('Unable to decode valid stem audio data for this track.');
        }

        const ensureBuffer = (buf) => {
          if (buf && buf.length === maxLen && buf.numberOfChannels === 2) return buf;
          const newBuf = ctx.createBuffer(2, maxLen, sampleRate);
          if (buf) {
            const ch0 = buf.getChannelData(0);
            const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
            newBuf.copyToChannel(ch0, 0, 0);
            newBuf.copyToChannel(ch1, 1, 0);
          }
          return newBuf;
        };

        buffersRef.current = {
          inst: ensureBuffer(instBuf),
          lead: ensureBuffer(leadBuf),
          back: ensureBuffer(backBuf)
        };

        computeAllPeaks();

        setDuration(totalDur);
        setViewDuration(Math.min(totalDur, 30));
        setViewStart(0);
        setCurrentTime(0);
        pauseTimeRef.current = 0;
        setIsAudioLoaded(true);
      } catch (err) {
        if (!isCancelled) {
          console.error('Stem load error:', err);
          setLoadError(err.message || 'Error decoding audio stems');
        }
      }
    };

    loadStems();

    return () => {
      isCancelled = true;
      stopSources();
      if (ctx.state !== 'closed') {
        ctx.close().catch(() => { });
      }
    };
  }, [song]);

  // 2. Precompute Downsampled Peak Cache for Fast Waveform Rendering
  const computeAllPeaks = useCallback(() => {
    const buckets = 4000;
    const cache = {};

    for (const trackId of ['inst', 'lead', 'back']) {
      const buf = buffersRef.current[trackId];
      if (!buf) continue;

      const len = buf.length;
      const ch0 = buf.getChannelData(0);
      const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
      const peaks = new Float32Array(buckets * 2);
      const step = len / buckets;

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
      cache[trackId] = peaks;
    }
    peaksCacheRef.current = cache;
  }, []);

  const recomputeTrackPeaks = useCallback((trackId) => {
    const buf = buffersRef.current[trackId];
    if (!buf) return;
    const buckets = 4000;
    const len = buf.length;
    const ch0 = buf.getChannelData(0);
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
    const peaks = new Float32Array(buckets * 2);
    const step = len / buckets;

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
    peaksCacheRef.current[trackId] = peaks;
  }, []);

  // 3. Audio Playback Control
  const stopSources = () => {
    for (const key of ['inst', 'lead', 'back']) {
      if (activeSourcesRef.current[key]) {
        try {
          activeSourcesRef.current[key].onended = null;
          activeSourcesRef.current[key].stop();
        } catch (e) { }
        activeSourcesRef.current[key] = null;
      }
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  };

  const updateGains = useCallback(() => {
    const gn = gainNodesRef.current;
    if (!gn.inst) return;

    const hasAnySolo = Object.values(trackStates).some((t) => t.solo);

    for (const [key, state] of Object.entries(trackStates)) {
      if (!gn[key]) continue;
      let targetGain = state.volume;
      if (state.muted) {
        targetGain = 0;
      } else if (hasAnySolo && !state.solo) {
        targetGain = 0;
      }
      gn[key].gain.setValueAtTime(targetGain, audioCtxRef.current.currentTime);
    }
  }, [trackStates]);

  useEffect(() => {
    updateGains();
  }, [trackStates, updateGains]);

  const playAudio = (offset = 0) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { });
    }

    stopSources();

    const maxDur = duration;
    const safeOffset = Math.max(0, Math.min(maxDur, offset));

    playbackStartTimeRef.current = ctx.currentTime - safeOffset;
    pauseTimeRef.current = safeOffset;

    for (const key of ['inst', 'lead', 'back']) {
      const buf = buffersRef.current[key];
      if (buf && gainNodesRef.current[key]) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(gainNodesRef.current[key]);
        src.start(0, safeOffset);
        activeSourcesRef.current[key] = src;
      }
    }

    setIsPlaying(true);

    const loop = () => {
      const elapsed = ctx.currentTime - playbackStartTimeRef.current;

      if (isLooping && selection && selection.end > selection.start) {
        if (elapsed >= selection.end) {
          playAudio(selection.start);
          return;
        }
      } else if (maxDur > 0 && elapsed >= maxDur) {
        pauseAudio();
        setCurrentTime(maxDur);
        return;
      }

      setCurrentTime(elapsed);

      // Auto-pan viewport if playhead moves off-screen
      if (elapsed > viewStart + viewDuration) {
        setViewStart((prev) => Math.min(maxDur - viewDuration, elapsed - viewDuration * 0.15));
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
  };

  const pauseAudio = () => {
    const ctx = audioCtxRef.current;
    if (ctx && isPlaying) {
      pauseTimeRef.current = ctx.currentTime - playbackStartTimeRef.current;
    }
    stopSources();
    setIsPlaying(false);
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      pauseAudio();
    } else {
      playAudio(pauseTimeRef.current);
    }
  };

  const handleStop = () => {
    pauseAudio();
    const rewindTo = selection ? selection.start : 0;
    pauseTimeRef.current = rewindTo;
    setCurrentTime(rewindTo);
  };

  const handlePlaySelection = () => {
    if (!selection) return;
    pauseAudio();
    playAudio(selection.start);
  };

  // 4. Viewport & Zoom Navigation
  const handleZoom = (factor, centerRatio = 0.5) => {
    if (duration <= 0) return;
    const currentDur = viewDuration;
    const newDur = Math.max(1.5, Math.min(duration, currentDur * factor));
    const centerTime = viewStart + currentDur * centerRatio;
    const newStart = Math.max(0, Math.min(duration - newDur, centerTime - newDur * centerRatio));

    setViewDuration(newDur);
    setViewStart(newStart);
  };

  const handleZoomFit = () => {
    setViewStart(0);
    setViewDuration(duration);
  };

  const handleZoomToSelection = () => {
    if (!selection || duration <= 0) return;
    const selDur = Math.max(1.0, selection.end - selection.start);
    const margin = selDur * 0.25;
    const newDur = Math.min(duration, selDur + margin * 2);
    const newStart = Math.max(0, Math.min(duration - newDur, selection.start - margin));
    setViewStart(newStart);
    setViewDuration(newDur);
  };

  // 5. Canvas Waveform & Time Ruler Rendering (Cleanly bounds-checked against waveformsPaneRef)
  const renderAllCanvases = useCallback(() => {
    const pane = waveformsPaneRef.current;
    if (!pane || duration <= 0) return;

    const width = pane.clientWidth;
    if (width <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // A. Render Time Ruler
    const ruler = timeRulerCanvasRef.current;
    if (ruler) {
      ruler.width = Math.floor(width * dpr);
      ruler.height = Math.floor(28 * dpr);
      ruler.style.width = `${width}px`;
      ruler.style.height = '28px';

      const ctx = ruler.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, 28);

      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, width, 28);

      let timeStep = 5;
      if (viewDuration <= 4) timeStep = 0.2;
      else if (viewDuration <= 10) timeStep = 0.5;
      else if (viewDuration <= 20) timeStep = 1;
      else if (viewDuration <= 60) timeStep = 5;
      else if (viewDuration <= 180) timeStep = 15;
      else timeStep = 30;

      const firstTick = Math.floor(viewStart / timeStep) * timeStep;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';

      for (let t = firstTick; t <= viewStart + viewDuration; t += timeStep) {
        const x = ((t - viewStart) / viewDuration) * width;
        if (x >= 0 && x <= width) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 16);
          ctx.lineTo(x, 28);
          ctx.stroke();

          const label = formatTimePrecise(t).slice(0, 5);
          ctx.fillText(label, x, 12);
        }
      }

      // Playhead flag on ruler
      if (currentTime >= viewStart && currentTime <= viewStart + viewDuration) {
        const px = ((currentTime - viewStart) / viewDuration) * width;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(px - 5, 0);
        ctx.lineTo(px + 5, 0);
        ctx.lineTo(px, 12);
        ctx.closePath();
        ctx.fill();
      }
    }

    // B. Render Track Waveforms
    for (const track of TRACK_CONFIGS) {
      const canvas = trackCanvasRefs.current[track.id];
      if (!canvas) continue;

      const trackHeight = 110;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(trackHeight * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${trackHeight}px`;

      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, trackHeight);

      // Background
      ctx.fillStyle = track.colorDark;
      ctx.globalAlpha = 0.22;
      ctx.fillRect(0, 0, width, trackHeight);
      ctx.globalAlpha = 1.0;

      // Center zero line
      const centerY = trackHeight / 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Render Peaks
      const peaks = peaksCacheRef.current[track.id];
      if (peaks && duration > 0) {
        const totalBuckets = peaks.length / 2;
        const grad = ctx.createLinearGradient(0, 0, 0, trackHeight);
        grad.addColorStop(0, track.gradTop);
        grad.addColorStop(0.5, track.color);
        grad.addColorStop(1, track.gradBot);

        ctx.fillStyle = grad;
        ctx.beginPath();

        const maxAmp = (trackHeight / 2) * 0.90;

        for (let x = 0; x < width; x += 2) {
          const t0 = viewStart + (x / width) * viewDuration;
          const t1 = viewStart + ((x + 2) / width) * viewDuration;

          const b0 = Math.max(0, Math.min(totalBuckets - 1, Math.floor((t0 / duration) * totalBuckets)));
          const b1 = Math.max(0, Math.min(totalBuckets - 1, Math.floor((t1 / duration) * totalBuckets)));

          let min = 0;
          let max = 0;
          for (let b = b0; b <= b1; b++) {
            const pMin = peaks[b * 2];
            const pMax = peaks[b * 2 + 1];
            if (pMin < min) min = pMin;
            if (pMax > max) max = pMax;
          }

          const topY = centerY - Math.max(1, max * maxAmp);
          const botY = centerY - Math.min(-1, min * maxAmp);
          const barH = Math.max(2, botY - topY);

          ctx.rect(x, topY, 1.5, barH);
        }

        ctx.fill();
      }

      // Selection Highlight Overlay with Draggable Visual Handles
      if (selection && selection.end > selection.start) {
        const selX1 = Math.max(0, ((selection.start - viewStart) / viewDuration) * width);
        const selX2 = Math.min(width, ((selection.end - viewStart) / viewDuration) * width);

        if (selX2 > selX1) {
          // Shaded region
          ctx.fillStyle = 'rgba(99, 102, 241, 0.25)';
          ctx.fillRect(selX1, 0, selX2 - selX1, trackHeight);

          // Left Handle Bar & Grip
          ctx.strokeStyle = '#818cf8';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(selX1, 0);
          ctx.lineTo(selX1, trackHeight);
          ctx.stroke();

          // Left grip knob
          ctx.fillStyle = '#c7d2fe';
          ctx.fillRect(selX1 - 2.5, trackHeight / 2 - 10, 5, 20);

          // Right Handle Bar & Grip
          ctx.beginPath();
          ctx.moveTo(selX2, 0);
          ctx.lineTo(selX2, trackHeight);
          ctx.stroke();

          // Right grip knob
          ctx.fillRect(selX2 - 2.5, trackHeight / 2 - 10, 5, 20);
        }
      }

      // Playhead Line
      if (currentTime >= viewStart && currentTime <= viewStart + viewDuration) {
        const playX = ((currentTime - viewStart) / viewDuration) * width;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(playX, 0);
        ctx.lineTo(playX, trackHeight);
        ctx.stroke();
      }
    }

    // C. Render Minimap Overview
    const minimap = minimapCanvasRef.current;
    if (minimap && duration > 0) {
      const mmW = minimap.clientWidth;
      const mmH = 36;
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

      // Waveform thumbnail
      const leadPeaks = peaksCacheRef.current.lead;
      if (leadPeaks) {
        const total = leadPeaks.length / 2;
        ctx.fillStyle = 'rgba(147, 51, 234, 0.45)';
        ctx.beginPath();
        for (let x = 0; x < mmW; x++) {
          const b = Math.floor((x / mmW) * total);
          const max = leadPeaks[b * 2 + 1];
          const barH = Math.max(1, max * (mmH / 2) * 0.85);
          ctx.rect(x, mmH / 2 - barH, 1, barH * 2);
        }
        ctx.fill();
      }

      // 1. Visible Viewport Frame & Draggable Edge Handles (Cyan Theme)
      const vpX1 = Math.max(0, (viewStart / duration) * mmW);
      const vpX2 = Math.min(mmW, ((viewStart + viewDuration) / duration) * mmW);
      const vpW = Math.max(4, vpX2 - vpX1);

      // Outside dimmed curtain effect
      ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
      if (vpX1 > 0) ctx.fillRect(0, 0, vpX1, mmH);
      if (vpX2 < mmW) ctx.fillRect(vpX2, 0, mmW - vpX2, mmH);

      // Inside illuminated viewport fill
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.fillRect(vpX1, 0, vpW, mmH);

      // Viewport Border Box
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vpX1, 0.5, vpW, mmH - 1);

      // Top & Bottom Accent Rails
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(vpX1, 0, vpW, 2.5);
      ctx.fillRect(vpX1, mmH - 2.5, vpW, 2.5);

      // Viewport Left Resize Handle (Cyan Tab with White Grip)
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(vpX1 - 3, 2, 6, mmH - 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(vpX1 - 0.75, mmH / 2 - 5, 1.5, 10);

      // Viewport Right Resize Handle (Cyan Tab with White Grip)
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(vpX2 - 3, 2, 6, mmH - 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(vpX2 - 0.75, mmH / 2 - 5, 1.5, 10);

      // 2. Selection on Minimap (Indigo Theme) with Draggable Handles
      if (selection && selection.end > selection.start) {
        const smX1 = (selection.start / duration) * mmW;
        const smX2 = (selection.end / duration) * mmW;
        const smW = Math.max(2, smX2 - smX1);

        ctx.fillStyle = 'rgba(99, 102, 241, 0.45)';
        ctx.fillRect(smX1, 0, smW, mmH);

        ctx.strokeStyle = '#818cf8';
        ctx.lineWidth = 2;
        ctx.strokeRect(smX1, 0.5, smW, mmH - 1);

        // Minimap selection edge handles
        ctx.fillStyle = '#818cf8';
        ctx.fillRect(smX1 - 2.5, 5, 5, mmH - 10);
        ctx.fillRect(smX2 - 2.5, 5, 5, mmH - 10);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(smX1 - 0.75, mmH / 2 - 4, 1.5, 8);
        ctx.fillRect(smX2 - 0.75, mmH / 2 - 4, 1.5, 8);
      }

      // Playhead on Minimap
      const pmX = (currentTime / duration) * mmW;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pmX, 0);
      ctx.lineTo(pmX, mmH);
      ctx.stroke();
    }
  }, [duration, viewStart, viewDuration, currentTime, selection]);

  useEffect(() => {
    renderAllCanvases();
  }, [renderAllCanvases]);

  useEffect(() => {
    const handleResize = () => renderAllCanvases();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderAllCanvases]);

  // 6. ACCURATE WAVEFORM TIME CALCULATION (ZERO OFFSET)
  const getWaveformTimeFromEvent = (e) => {
    const pane = waveformsPaneRef.current;
    if (!pane || duration <= 0) return 0;
    const rect = pane.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const t = viewStart + (x / rect.width) * viewDuration;
    return Math.max(0, Math.min(duration, t));
  };

  // Waveform Mouse Down / Move / Up handlers
  const handleWaveformMouseDown = (e) => {
    if (e.button !== 0 || durationRef.current <= 0) return;
    const clickedTime = getWaveformTimeFromEvent(e);

    const pane = waveformsPaneRef.current;
    if (!pane) return;
    const rect = pane.getBoundingClientRect();
    const handleThresholdTime = (10 / rect.width) * viewDurationRef.current;
    const currentSel = selectionRef.current;

    if (currentSel) {
      if (Math.abs(clickedTime - currentSel.start) < handleThresholdTime) {
        isDraggingWaveformRef.current = 'left';
        dragAnchorRef.current = { startX: e.clientX, initialStart: currentSel.start, initialEnd: currentSel.end };
      } else if (Math.abs(clickedTime - currentSel.end) < handleThresholdTime) {
        isDraggingWaveformRef.current = 'right';
        dragAnchorRef.current = { startX: e.clientX, initialStart: currentSel.start, initialEnd: currentSel.end };
      } else if (clickedTime > currentSel.start && clickedTime < currentSel.end) {
        isDraggingWaveformRef.current = 'move';
        dragAnchorRef.current = { startX: e.clientX, initialStart: currentSel.start, initialEnd: currentSel.end, startTime: clickedTime };
      } else {
        // Create new selection range
        isDraggingWaveformRef.current = 'create';
        dragAnchorRef.current = { startX: e.clientX, initialTime: clickedTime };
        setSelection({ start: clickedTime, end: clickedTime });
      }
    } else {
      // Create new selection range
      isDraggingWaveformRef.current = 'create';
      dragAnchorRef.current = { startX: e.clientX, initialTime: clickedTime };
      setSelection({ start: clickedTime, end: clickedTime });
    }

    // Also update playhead immediately
    pauseTimeRef.current = clickedTime;
    setCurrentTime(clickedTime);
    if (isPlaying) {
      playAudio(clickedTime);
    }

    const onGlobalWaveformMove = (moveEvt) => {
      handleWaveformMouseMove(moveEvt);
    };

    const onGlobalWaveformUp = () => {
      handleWaveformMouseUp();
      window.removeEventListener('mousemove', onGlobalWaveformMove);
      window.removeEventListener('mouseup', onGlobalWaveformUp);
    };

    window.addEventListener('mousemove', onGlobalWaveformMove);
    window.addEventListener('mouseup', onGlobalWaveformUp);
  };

  const handleWaveformMouseMove = (e) => {
    const pane = waveformsPaneRef.current;
    if (!pane || durationRef.current <= 0) return;

    const curTime = getWaveformTimeFromEvent(e);
    const mode = isDraggingWaveformRef.current;
    const curSel = selectionRef.current;
    const vDur = viewDurationRef.current;

    if (!mode) {
      // Dynamic cursor on hover
      if (curSel) {
        const rect = pane.getBoundingClientRect();
        const handleThresholdTime = (10 / rect.width) * vDur;
        if (Math.abs(curTime - curSel.start) < handleThresholdTime || Math.abs(curTime - curSel.end) < handleThresholdTime) {
          pane.style.cursor = 'ew-resize';
        } else if (curTime > curSel.start && curTime < curSel.end) {
          pane.style.cursor = 'grab';
        } else {
          pane.style.cursor = 'crosshair';
        }
      } else {
        pane.style.cursor = 'crosshair';
      }
      return;
    }

    const anchor = dragAnchorRef.current;
    const totalDur = durationRef.current;

    if (mode === 'create') {
      const t0 = Math.min(anchor.initialTime, curTime);
      const t1 = Math.max(anchor.initialTime, curTime);
      setSelection({ start: t0, end: t1 });
    } else if (mode === 'left') {
      const newStart = Math.min(anchor.initialEnd - 0.05, Math.max(0, curTime));
      setSelection({ start: newStart, end: anchor.initialEnd });
    } else if (mode === 'right') {
      const newEnd = Math.max(anchor.initialStart + 0.05, Math.min(totalDur, curTime));
      setSelection({ start: anchor.initialStart, end: newEnd });
    } else if (mode === 'move') {
      const delta = curTime - anchor.startTime;
      const length = anchor.initialEnd - anchor.initialStart;
      let newStart = anchor.initialStart + delta;
      let newEnd = anchor.initialEnd + delta;
      if (newStart < 0) {
        newStart = 0;
        newEnd = length;
      } else if (newEnd > totalDur) {
        newEnd = totalDur;
        newStart = totalDur - length;
      }
      setSelection({ start: newStart, end: newEnd });
    }
  };

  const handleWaveformMouseUp = () => {
    if (isDraggingWaveformRef.current === 'create') {
      const curSel = selectionRef.current;
      if (curSel && curSel.end - curSel.start < 0.05) {
        setSelection(null);
      }
    }
    isDraggingWaveformRef.current = null;
    if (waveformsPaneRef.current) {
      waveformsPaneRef.current.style.cursor = 'crosshair';
    }
  };

  // 7. MINIMAP INTERACTION (SHRINK, STRETCH, MOVE SELECTION & VIEW RECTANGLE)
  const getMinimapTimeFromEvent = (e) => {
    const wrap = minimapWrapRef.current;
    if (!wrap || durationRef.current <= 0) return 0;
    const rect = wrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    return (x / rect.width) * durationRef.current;
  };

  const handleMinimapMouseDown = (e) => {
    if (e.button !== 0 || durationRef.current <= 0) return;
    const wrap = minimapWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const mmW = rect.width;
    const dur = durationRef.current;
    const vStart = viewStartRef.current;
    const vDur = viewDurationRef.current;
    const sel = selectionRef.current;

    const clickX = Math.max(0, Math.min(mmW, e.clientX - rect.left));
    const clickY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const clickedTime = (clickX / mmW) * dur;

    const vpX1 = (vStart / dur) * mmW;
    const vpX2 = ((vStart + vDur) / dur) * mmW;
    const smX1 = sel ? (sel.start / dur) * mmW : -9999;
    const smX2 = sel ? (sel.end / dur) * mmW : -9999;

    const HANDLE_PX = 8;
    const distVpLeft = Math.abs(clickX - vpX1);
    const distVpRight = Math.abs(clickX - vpX2);
    const distSelLeft = sel ? Math.abs(clickX - smX1) : Infinity;
    const distSelRight = sel ? Math.abs(clickX - smX2) : Infinity;

    const candidates = [
      { mode: 'sel-left', dist: distSelLeft },
      { mode: 'sel-right', dist: distSelRight },
      { mode: 'vp-left', dist: distVpLeft },
      { mode: 'vp-right', dist: distVpRight },
    ].filter((c) => c.dist <= HANDLE_PX);

    candidates.sort((a, b) => {
      if (Math.abs(a.dist - b.dist) < 1.0) {
        if (clickY < 8 || clickY > 28) {
          if (a.mode.startsWith('vp') && !b.mode.startsWith('vp')) return -1;
          if (!a.mode.startsWith('vp') && b.mode.startsWith('vp')) return 1;
        } else {
          if (a.mode.startsWith('sel') && !b.mode.startsWith('sel')) return -1;
          if (!a.mode.startsWith('sel') && b.mode.startsWith('sel')) return 1;
        }
      }
      return a.dist - b.dist;
    });

    let chosenMode = null;
    if (candidates.length > 0) {
      chosenMode = candidates[0].mode;
    } else if (sel && clickedTime >= sel.start && clickedTime <= sel.end) {
      chosenMode = 'sel-move';
    } else if (clickedTime >= vStart && clickedTime <= vStart + vDur) {
      chosenMode = 'vp-move';
    } else {
      // Click outside: Center view window at clicked time
      const newStart = Math.max(0, Math.min(dur - vDur, clickedTime - vDur / 2));
      setViewStart(newStart);
      return;
    }

    isDraggingMinimapRef.current = chosenMode;
    dragAnchorRef.current = {
      initialViewStart: vStart,
      initialViewDuration: vDur,
      initialViewEnd: vStart + vDur,
      initialStart: sel ? sel.start : 0,
      initialEnd: sel ? sel.end : 0,
      startX: e.clientX,
      startTime: clickedTime
    };

    if (chosenMode.includes('left') || chosenMode.includes('right')) {
      document.body.style.cursor = 'ew-resize';
    } else {
      document.body.style.cursor = 'grabbing';
    }

    const onGlobalMinimapMove = (moveEvent) => {
      if (!minimapWrapRef.current || durationRef.current <= 0) return;
      const mRect = minimapWrapRef.current.getBoundingClientRect();
      const curX = Math.max(0, Math.min(mRect.width, moveEvent.clientX - mRect.left));
      const curTime = (curX / mRect.width) * durationRef.current;
      const currentMode = isDraggingMinimapRef.current;
      const anchor = dragAnchorRef.current;
      if (!currentMode || !anchor) return;

      const durTotal = durationRef.current;
      const minViewDur = 1.5;

      if (currentMode === 'vp-left') {
        const targetStart = curTime;
        const newStart = Math.min(anchor.initialViewEnd - minViewDur, Math.max(0, targetStart));
        const newDur = anchor.initialViewEnd - newStart;
        setViewStart(newStart);
        setViewDuration(newDur);
      } else if (currentMode === 'vp-right') {
        const targetEnd = curTime;
        const newEnd = Math.max(anchor.initialViewStart + minViewDur, Math.min(durTotal, targetEnd));
        const newDur = newEnd - anchor.initialViewStart;
        setViewDuration(newDur);
      } else if (currentMode === 'vp-move') {
        const delta = curTime - anchor.startTime;
        const newStart = Math.max(0, Math.min(durTotal - anchor.initialViewDuration, anchor.initialViewStart + delta));
        setViewStart(newStart);
      } else if (currentMode === 'sel-left') {
        const newStart = Math.min(anchor.initialEnd - 0.1, Math.max(0, curTime));
        setSelection({ start: newStart, end: anchor.initialEnd });
      } else if (currentMode === 'sel-right') {
        const newEnd = Math.max(anchor.initialStart + 0.1, Math.min(durTotal, curTime));
        setSelection({ start: anchor.initialStart, end: newEnd });
      } else if (currentMode === 'sel-move') {
        const delta = curTime - anchor.startTime;
        const length = anchor.initialEnd - anchor.initialStart;
        let newStart = anchor.initialStart + delta;
        let newEnd = anchor.initialEnd + delta;
        if (newStart < 0) {
          newStart = 0;
          newEnd = length;
        } else if (newEnd > durTotal) {
          newEnd = durTotal;
          newStart = durTotal - length;
        }
        setSelection({ start: newStart, end: newEnd });
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
    const sel = selectionRef.current;

    const clickX = Math.max(0, Math.min(mmW, e.clientX - rect.left));
    const clickY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const curTime = (clickX / mmW) * dur;

    const vpX1 = (vStart / dur) * mmW;
    const vpX2 = ((vStart + vDur) / dur) * mmW;
    const smX1 = sel ? (sel.start / dur) * mmW : -9999;
    const smX2 = sel ? (sel.end / dur) * mmW : -9999;

    const HANDLE_PX = 8;
    const distVpLeft = Math.abs(clickX - vpX1);
    const distVpRight = Math.abs(clickX - vpX2);
    const distSelLeft = sel ? Math.abs(clickX - smX1) : Infinity;
    const distSelRight = sel ? Math.abs(clickX - smX2) : Infinity;

    const candidates = [
      { mode: 'sel-left', dist: distSelLeft, tip: 'Drag to stretch/shrink selection start' },
      { mode: 'sel-right', dist: distSelRight, tip: 'Drag to stretch/shrink selection end' },
      { mode: 'vp-left', dist: distVpLeft, tip: 'Drag to stretch/shrink view window start' },
      { mode: 'vp-right', dist: distVpRight, tip: 'Drag to stretch/shrink view window end' },
    ].filter((c) => c.dist <= HANDLE_PX);

    candidates.sort((a, b) => {
      if (Math.abs(a.dist - b.dist) < 1.0) {
        if (clickY < 8 || clickY > 28) {
          if (a.mode.startsWith('vp') && !b.mode.startsWith('vp')) return -1;
          if (!a.mode.startsWith('vp') && b.mode.startsWith('vp')) return 1;
        } else {
          if (a.mode.startsWith('sel') && !b.mode.startsWith('sel')) return -1;
          if (!a.mode.startsWith('sel') && b.mode.startsWith('sel')) return 1;
        }
      }
      return a.dist - b.dist;
    });

    if (candidates.length > 0) {
      wrap.style.cursor = 'ew-resize';
      wrap.title = candidates[0].tip;
    } else if (sel && curTime >= sel.start && curTime <= sel.end) {
      wrap.style.cursor = 'grab';
      wrap.title = 'Drag to move selection range';
    } else if (curTime >= vStart && curTime <= vStart + vDur) {
      wrap.style.cursor = 'grab';
      wrap.title = 'Drag to pan view window';
    } else {
      wrap.style.cursor = 'pointer';
      wrap.title = 'Click to jump view window here';
    }
  };

  const handleMinimapMouseUp = () => {
    isDraggingMinimapRef.current = null;
    document.body.style.cursor = '';
    if (minimapWrapRef.current) {
      minimapWrapRef.current.style.cursor = 'pointer';
    }
  };

  // Wheel zoom and pan
  const handleWheel = (e) => {
    if (!workspaceRef.current) return;
    e.preventDefault();

    if (e.ctrlKey || e.metaKey || e.altKey) {
      const rect = workspaceRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const factor = e.deltaY > 0 ? 1.25 : 0.80;
      handleZoom(factor, ratio);
    } else {
      const deltaSeconds = (e.deltaX || e.deltaY) * (viewDuration / 600);
      setViewStart((prev) => Math.max(0, Math.min(duration - viewDuration, prev + deltaSeconds)));
    }
  };

  // 8. STEM CORRECTION / TRANSFER ENGINE
  const handleApplyTransfer = () => {
    if (!selection || selection.end <= selection.start) {
      alert('Please select a time interval on the waveforms first.');
      return;
    }

    const { start, end } = selection;
    const srcBuf = buffersRef.current[sourceStem];
    const tgtBuf = buffersRef.current[targetStem];

    if (!srcBuf) {
      alert('Source stem audio buffer not loaded.');
      return;
    }
    if (actionType !== 'silence' && !tgtBuf) {
      alert('Target stem audio buffer not loaded.');
      return;
    }
    if (actionType !== 'silence' && sourceStem === targetStem) {
      alert('Source and destination stems cannot be identical.');
      return;
    }

    const sampleRate = srcBuf.sampleRate;
    const startSample = Math.max(0, Math.floor(start * sampleRate));
    const endSample = Math.min(srcBuf.length, Math.floor(end * sampleRate));
    const countSamples = endSample - startSample;

    if (countSamples <= 0) return;

    const cfSamples = Math.min(Math.floor(countSamples / 2), Math.floor((crossfadeMs / 1000) * sampleRate));

    const undoItem = {
      actionType,
      sourceStem,
      targetStem,
      startSample,
      endSample,
      prevSrc: [
        new Float32Array(srcBuf.getChannelData(0).subarray(startSample, endSample)),
        new Float32Array(srcBuf.getChannelData(1).subarray(startSample, endSample))
      ],
      prevTgt: tgtBuf ? [
        new Float32Array(tgtBuf.getChannelData(0).subarray(startSample, endSample)),
        new Float32Array(tgtBuf.getChannelData(1).subarray(startSample, endSample))
      ] : null,
      desc: `${actionType.toUpperCase()}: ${formatTimePrecise(start)}-${formatTimePrecise(end)} (${sourceStem} → ${actionType === 'silence' ? 'Silence' : targetStem})`
    };

    for (let c = 0; c < 2; c++) {
      const srcData = srcBuf.getChannelData(c);
      const tgtData = tgtBuf ? tgtBuf.getChannelData(c) : null;

      for (let i = 0; i < countSamples; i++) {
        const sIdx = startSample + i;

        let w = 1.0;
        if (cfSamples > 0) {
          if (i < cfSamples) {
            w = 0.5 * (1 - Math.cos((Math.PI * i) / cfSamples));
          } else if (countSamples - i < cfSamples) {
            w = 0.5 * (1 - Math.cos((Math.PI * (countSamples - i)) / cfSamples));
          }
        }

        const sVal = srcData[sIdx];

        if (actionType === 'move') {
          if (tgtData) {
            tgtData[sIdx] = Math.max(-1.0, Math.min(1.0, tgtData[sIdx] + sVal * w));
          }
          srcData[sIdx] = sVal * (1.0 - w);
        } else if (actionType === 'copy') {
          if (tgtData) {
            tgtData[sIdx] = Math.max(-1.0, Math.min(1.0, tgtData[sIdx] + sVal * w));
          }
        } else if (actionType === 'swap') {
          if (tgtData) {
            const tVal = tgtData[sIdx];
            tgtData[sIdx] = Math.max(-1.0, Math.min(1.0, tVal * (1.0 - w) + sVal * w));
            srcData[sIdx] = Math.max(-1.0, Math.min(1.0, sVal * (1.0 - w) + tVal * w));
          }
        } else if (actionType === 'silence') {
          srcData[sIdx] = sVal * (1.0 - w);
        }
      }
    }

    undoStackRef.current.push(undoItem);
    redoStackRef.current = [];
    setHistoryCount(undoStackRef.current.length);

    recomputeTrackPeaks(sourceStem);
    if (targetStem && targetStem !== sourceStem && actionType !== 'silence') {
      recomputeTrackPeaks(targetStem);
    }
    renderAllCanvases();

    if (isPlaying) {
      playAudio(currentTime);
    }
  };

  // 9. Undo & Redo Handlers
  const handleUndo = () => {
    if (undoStackRef.current.length === 0) return;
    const item = undoStackRef.current.pop();

    const srcBuf = buffersRef.current[item.sourceStem];
    const tgtBuf = buffersRef.current[item.targetStem];

    const redoItem = {
      ...item,
      prevSrc: [
        new Float32Array(srcBuf.getChannelData(0).subarray(item.startSample, item.endSample)),
        new Float32Array(srcBuf.getChannelData(1).subarray(item.startSample, item.endSample))
      ],
      prevTgt: tgtBuf ? [
        new Float32Array(tgtBuf.getChannelData(0).subarray(item.startSample, item.endSample)),
        new Float32Array(tgtBuf.getChannelData(1).subarray(item.startSample, item.endSample))
      ] : null
    };
    redoStackRef.current.push(redoItem);

    for (let c = 0; c < 2; c++) {
      srcBuf.getChannelData(c).set(item.prevSrc[c], item.startSample);
      if (tgtBuf && item.prevTgt) {
        tgtBuf.getChannelData(c).set(item.prevTgt[c], item.startSample);
      }
    }

    setHistoryCount(undoStackRef.current.length);
    recomputeTrackPeaks(item.sourceStem);
    if (item.targetStem && item.targetStem !== item.sourceStem) {
      recomputeTrackPeaks(item.targetStem);
    }
    renderAllCanvases();

    if (isPlaying) playAudio(currentTime);
  };

  const handleRedo = () => {
    if (redoStackRef.current.length === 0) return;
    const item = redoStackRef.current.pop();

    const srcBuf = buffersRef.current[item.sourceStem];
    const tgtBuf = buffersRef.current[item.targetStem];

    const undoItem = {
      ...item,
      prevSrc: [
        new Float32Array(srcBuf.getChannelData(0).subarray(item.startSample, item.endSample)),
        new Float32Array(srcBuf.getChannelData(1).subarray(item.startSample, item.endSample))
      ],
      prevTgt: tgtBuf ? [
        new Float32Array(tgtBuf.getChannelData(0).subarray(item.startSample, item.endSample)),
        new Float32Array(tgtBuf.getChannelData(1).subarray(item.startSample, item.endSample))
      ] : null
    };
    undoStackRef.current.push(undoItem);

    for (let c = 0; c < 2; c++) {
      srcBuf.getChannelData(c).set(item.prevSrc[c], item.startSample);
      if (tgtBuf && item.prevTgt) {
        tgtBuf.getChannelData(c).set(item.prevTgt[c], item.startSample);
      }
    }

    setHistoryCount(undoStackRef.current.length);
    recomputeTrackPeaks(item.sourceStem);
    if (item.targetStem && item.targetStem !== item.sourceStem) {
      recomputeTrackPeaks(item.targetStem);
    }
    renderAllCanvases();

    if (isPlaying) playAudio(currentTime);
  };

  // 10. COMPREHENSIVE ESSENTIAL KEYBOARD SHORTCUTS
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Playback / Transport
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.shiftKey) {
          handlePlaySelection();
        } else {
          handleTogglePlay();
        }
      } else if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handleStop();
      } else if (e.key.toLowerCase() === 'l' && !cmdOrCtrl) {
        e.preventDefault();
        setIsLooping((prev) => !prev);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selection && selection.end > selection.start) {
          handleApplyTransfer();
        }
      }

      // Zooming & Viewport
      else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoom(0.70);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        handleZoom(1.40);
      } else if (e.key.toLowerCase() === 'f' && !cmdOrCtrl) {
        e.preventDefault();
        handleZoomFit();
      } else if (e.key.toLowerCase() === 'z' && !cmdOrCtrl && !e.shiftKey) {
        e.preventDefault();
        handleZoomToSelection();
      }

      // Selection shortcuts
      else if (cmdOrCtrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection({ start: 0, end: duration });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (showShortcutsModal) {
          setShowShortcutsModal(false);
        } else if (selection) {
          setSelection(null);
        } else {
          pauseAudio();
          close();
        }
      } else if (e.key === '[') {
        e.preventDefault();
        setSelection((prev) => ({ start: currentTime, end: Math.max(currentTime + 0.5, prev?.end || duration) }));
      } else if (e.key === ']') {
        e.preventDefault();
        setSelection((prev) => ({ start: Math.min(currentTime - 0.5, prev?.start || 0), end: currentTime }));
      }

      // Arrow navigation & nudge
      else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const step = e.altKey ? 0.2 : (e.shiftKey ? 2.0 : 1.0);
        if (e.shiftKey && selection) {
          // Nudge selection left
          const len = selection.end - selection.start;
          const s = Math.max(0, selection.start - step);
          setSelection({ start: s, end: s + len });
        } else {
          const t = Math.max(0, currentTime - step);
          pauseTimeRef.current = t;
          setCurrentTime(t);
          if (isPlaying) playAudio(t);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.altKey ? 0.2 : (e.shiftKey ? 2.0 : 1.0);
        if (e.shiftKey && selection) {
          // Nudge selection right
          const len = selection.end - selection.start;
          const s = Math.min(duration - len, selection.start + step);
          setSelection({ start: s, end: s + len });
        } else {
          const t = Math.min(duration, currentTime + step);
          pauseTimeRef.current = t;
          setCurrentTime(t);
          if (isPlaying) playAudio(t);
        }
      }

      // Track switching via 1, 2, 3
      else if (e.key === '1') {
        setSourceStem('inst');
      } else if (e.key === '2') {
        setSourceStem('lead');
      } else if (e.key === '3') {
        setSourceStem('back');
      }

      // Silence / Mute Selection shortcut
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selection && selection.end > selection.start) {
          e.preventDefault();
          setActionType('silence');
          setTimeout(() => handleApplyTransfer(), 50);
        }
      }

      // Undo / Redo
      else if (cmdOrCtrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (cmdOrCtrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }

      // Save shortcut
      else if (cmdOrCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveStems();
      }

      // Shortcuts modal
      else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // 11. Save & Apply Stems to Backend
  const handleSaveStems = async () => {
    if (!song) return;
    setIsSaving(true);
    setSaveStatus('Encoding high-fidelity 16-bit PCM WAV audio for all stems...');

    try {
      const instBlob = audioBufferToWav(buffersRef.current.inst);
      const leadBlob = audioBufferToWav(buffersRef.current.lead);
      const backBlob = audioBufferToWav(buffersRef.current.back);

      setSaveStatus('Uploading & compiling stem audio files to server...');

      const result = await api.saveStemCorrections(song.id, {
        inst: instBlob,
        lead: leadBlob,
        back: backBlob
      });

      audioPlayer.updateLoadedStemBuffers({
        instBuf: buffersRef.current.inst,
        leadBuf: buffersRef.current.lead,
        backBuf: buffersRef.current.back
      });

      const currentPlaybackSong = usePlaybackStore.getState().currentSong;
      if (currentPlaybackSong && currentPlaybackSong.id === song.id && result.stems) {
        usePlaybackStore.setState({
          currentSong: {
            ...currentPlaybackSong,
            stems: result.stems
          }
        });
      }

      setSaveStatus('✓ Stems saved and applied successfully!');
      setTimeout(() => setSaveStatus(null), 3500);
    } catch (err) {
      console.error('Save stems error:', err);
      setSaveStatus(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!song) return null;

  return (
    <div
      id="stemEditorModal"
      className="modal-backdrop stem-editor-backdrop"
      style={{ display: 'flex' }}
      onClick={() => {
        pauseAudio();
        close();
      }}
    >
      <div
        className="modal-box stem-editor-box"
        onClick={(e) => e.stopPropagation()}
        onMouseMove={handleWaveformMouseMove}
        onMouseUp={handleWaveformMouseUp}
      >
        {/* Top Studio Header */}
        <div className="stem-editor-header">
          <div className="stem-editor-track-info">
            <img
              src={song.albumArt || '/CtrlAltLyrics-logo.svg'}
              alt="Album cover"
              className="stem-editor-art"
              onError={(e) => { e.target.src = '/CtrlAltLyrics-logo.svg'; }}
            />
            <div className="stem-editor-title-group">
              <div className="stem-editor-title">
                <i className="icon-sliders" style={{ color: '#10b981', marginRight: '0.45rem' }}></i>
                Stem Editor: "{song.title || 'Untitled'}"
              </div>
              <div className="stem-editor-meta">
                <span>{song.artist || 'Unknown Artist'}</span>
                <span>•</span>
                <span className="mono-tag" style={{ color: '#5eead4' }}>3 Audio Tracks</span>
                <span>•</span>
                <span className="mono-tag">{formatTimePrecise(duration)}</span>
              </div>
            </div>
          </div>

          <div className="stem-editor-time-readout">
            <div className="time-readout-main">
              {formatTimePrecise(currentTime)}
            </div>
            <div className="time-readout-sub">
              {selection ? (
                <span style={{ color: '#a5b4fc' }}>
                  Sel: {formatTimePrecise(selection.start)} - {formatTimePrecise(selection.end)} ({formatTimePrecise(selection.end - selection.start).slice(3)}s)
                </span>
              ) : (
                <span style={{ color: '#64748b' }}>No Range Selected</span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-tool"
              onClick={() => setShowShortcutsModal(true)}
              title="Keyboard Shortcuts Cheatsheet (?)"
            >
              <i className="icon-help-circle"></i>
              <span>Shortcuts</span>
            </button>
            <button
              className="btn-close"
              onClick={() => {
                pauseAudio();
                close();
              }}
              title="Close Stem Editor (Esc)"
            >
              <i className="icon-x"></i>
            </button>
          </div>
        </div>

        {/* Global Transport & Zoom Toolbar */}
        <div className="stem-editor-toolbar">
          {/* Playback Transport Buttons */}
          <div className="toolbar-group transport-group">
            <button
              type="button"
              className={`btn btn-transport ${isPlaying ? 'is-playing' : ''}`}
              onClick={handleTogglePlay}
              title={isPlaying ? 'Pause (Space)' : 'Play All Tracks (Space)'}
              disabled={!isAudioLoaded}
            >
              <i className={isPlaying ? 'icon-pause' : 'icon-play'}></i>
              <span>{isPlaying ? 'Pause' : 'Play'}</span>
            </button>

            <button
              type="button"
              className="btn btn-transport"
              onClick={handleStop}
              title="Stop & Rewind (K)"
              disabled={!isAudioLoaded}
            >
              <i className="icon-square"></i>
            </button>

            <button
              type="button"
              className={`btn btn-transport ${isLooping ? 'is-active' : ''}`}
              onClick={() => setIsLooping(!isLooping)}
              title="Toggle Selection Loop (L)"
              disabled={!isAudioLoaded || !selection}
            >
              <i className="icon-repeat"></i>
              <span>Loop</span>
            </button>

            <button
              type="button"
              className="btn btn-transport"
              onClick={handlePlaySelection}
              title="Play Selected Interval Only (Shift+Space)"
              disabled={!isAudioLoaded || !selection}
            >
              <i className="icon-play-circle"></i>
              <span>Play Selection</span>
            </button>
          </div>

          {/* Zoom & Viewport Controls */}
          <div className="toolbar-group zoom-group">
            <button
              type="button"
              className="btn btn-tool"
              onClick={() => handleZoom(0.65)}
              title="Zoom In (+ or Ctrl+Wheel Up)"
              disabled={!isAudioLoaded}
            >
              <i className="icon-zoom-in"></i>
            </button>

            <button
              type="button"
              className="btn btn-tool"
              onClick={() => handleZoom(1.5)}
              title="Zoom Out (- or Ctrl+Wheel Down)"
              disabled={!isAudioLoaded}
            >
              <i className="icon-zoom-out"></i>
            </button>

            <button
              type="button"
              className="btn btn-tool"
              onClick={handleZoomFit}
              title="Fit Entire Track (F)"
              disabled={!isAudioLoaded}
            >
              <i className="icon-maximize-2"></i>
              <span>Fit</span>
            </button>

            {selection && (
              <button
                type="button"
                className="btn btn-tool"
                onClick={handleZoomToSelection}
                title="Zoom Directly to Selected Interval (Z)"
              >
                <i className="icon-crop"></i>
                <span>Selection</span>
              </button>
            )}

            <span className="zoom-level-badge">
              View: {formatTimePrecise(viewDuration).slice(3)}s
            </span>
          </div>

          {/* Undo / Redo / Save Group */}
          <div className="toolbar-group action-save-group">
            <button
              type="button"
              className="btn btn-tool"
              onClick={handleUndo}
              disabled={undoStackRef.current.length === 0}
              title="Undo last audio correction (Ctrl+Z)"
            >
              <i className="icon-undo"></i>
              <span>Undo {historyCount > 0 ? `(${historyCount})` : ''}</span>
            </button>

            <button
              type="button"
              className="btn btn-tool"
              onClick={handleRedo}
              disabled={redoStackRef.current.length === 0}
              title="Redo audio correction (Ctrl+Shift+Z)"
            >
              <i className="icon-redo"></i>
            </button>

            <button
              type="button"
              className="btn btn-save-stems"
              onClick={handleSaveStems}
              disabled={!isAudioLoaded || isSaving}
              title="Save modified stem files to server (Ctrl+S)"
            >
              <i className={isSaving ? 'icon-loader-2 icon-spin' : 'icon-save'}></i>
              <span>{isSaving ? 'Saving Stems...' : 'Save & Apply Stems'}</span>
            </button>
          </div>
        </div>

        {/* Status notification banner */}
        {saveStatus && (
          <div className={`stem-editor-banner ${saveStatus.includes('failed') ? 'error' : 'success'}`}>
            <i className={saveStatus.includes('failed') ? 'icon-alert-triangle' : 'icon-check-circle'}></i>
            <span>{saveStatus}</span>
          </div>
        )}

        {/* Loading / Error States */}
        {!isAudioLoaded && (
          <div className="stem-editor-loading-overlay">
            {loadError ? (
              <div className="load-error-box">
                <i className="icon-alert-circle"></i>
                <div style={{ fontWeight: 600, fontSize: '1rem', marginTop: '0.5rem' }}>Failed to Load Stems</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.25rem' }}>{loadError}</div>
              </div>
            ) : (
              <div className="load-spinner-box">
                <i className="icon-loader-2 icon-spin" style={{ fontSize: '2.5rem', color: '#10b981' }}></i>
                <div style={{ fontWeight: 600, marginTop: '1rem', color: '#f8fafc' }}>{loadingMsg}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.35rem' }}>
                  Decoding multi-track audio buffers...
                </div>
              </div>
            )}
          </div>
        )}

        {/* Minimap Overview Bar with Interactive View Window & Selection Resize/Stretch */}
        <div
          ref={minimapWrapRef}
          className="stem-editor-minimap-row"
          onMouseDown={handleMinimapMouseDown}
          onMouseMove={handleMinimapMouseMove}
          onMouseUp={handleMinimapMouseUp}
          title="Minimap: Drag cyan edges to resize view window, drag purple edges to resize selection, drag body to move, or click to jump"
        >
          <canvas ref={minimapCanvasRef} className="minimap-canvas" />
        </div>

        {/* Main Multi-Track Audio Waveform Workspace (2-Column Architecture with ZERO OFFSET) */}
        <div
          ref={workspaceRef}
          className="stem-editor-workspace"
          onWheel={handleWheel}
        >
          <div className="tracks-split-container">
            {/* Left Column: Fixed 220px Track Control Headers */}
            <div className="track-headers-column">
              <div className="ruler-header-spacer">
                <span className="tracks-label">TRACKS</span>
              </div>

              {TRACK_CONFIGS.map((track) => {
                const state = trackStates[track.id];

                return (
                  <div key={track.id} className="track-control-header" style={{ borderLeftColor: track.color }}>
                    <div className="track-identity">
                      <i className={track.icon} style={{ color: track.color }}></i>
                      <span className="track-name">{track.name}</span>
                    </div>

                    <div className="track-buttons-row">
                      <button
                        type="button"
                        className={`btn-track-badge btn-mute ${state.muted ? 'is-muted' : ''}`}
                        title={state.muted ? 'Unmute Track' : 'Mute Track'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setTrackStates((prev) => ({
                            ...prev,
                            [track.id]: { ...prev[track.id], muted: !prev[track.id].muted }
                          }));
                        }}
                      >
                        M
                      </button>

                      <button
                        type="button"
                        className={`btn-track-badge btn-solo ${state.solo ? 'is-solo' : ''}`}
                        title={state.solo ? 'Disable Solo' : 'Solo Track'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setTrackStates((prev) => ({
                            ...prev,
                            [track.id]: { ...prev[track.id], solo: !prev[track.id].solo }
                          }));
                        }}
                      >
                        S
                      </button>

                      <div className="track-volume-wrap" onClick={(e) => e.stopPropagation()}>
                        <i className="icon-volume-2 track-vol-icon"></i>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={state.volume}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setTrackStates((prev) => ({
                              ...prev,
                              [track.id]: { ...prev[track.id], volume: val }
                            }));
                          }}
                          className="track-vol-slider"
                          title={`Track Volume: ${Math.round(state.volume * 100)}%`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right Column: Waveforms & Timeline Canvas Pane (EXACT BOUNDS, ZERO OFFSET) */}
            <div
              ref={waveformsPaneRef}
              className="track-waveforms-column"
              onMouseDown={handleWaveformMouseDown}
              onMouseMove={handleWaveformMouseMove}
              onMouseUp={handleWaveformMouseUp}
            >
              {/* Synchronized Time Ruler */}
              <div className="ruler-waveform-wrap">
                <canvas ref={timeRulerCanvasRef} className="time-ruler-canvas" />
              </div>

              {/* 3 Synchronized Track Waveforms */}
              {TRACK_CONFIGS.map((track) => (
                <div key={track.id} className="track-waveform-row">
                  <canvas
                    ref={(el) => { trackCanvasRefs.current[track.id] = el; }}
                    className="track-waveform-canvas"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stem Transfer & Correction Tool Panel */}
        <div className="stem-transfer-panel">
          <div className="transfer-header">
            <div className="transfer-title">
              <i className="icon-scissors" style={{ color: '#38bdf8', marginRight: '0.45rem' }}></i>
              Stem Correction &amp; Audio Transfer
            </div>
            <div className="transfer-desc">
              Select an interval above or on the minimap, choose tracks, and transfer or swap audio to correct separation bleed.
            </div>
          </div>

          <div className="transfer-controls-row">
            {/* Source Stem Selector */}
            <div className="transfer-input-group">
              <label>Source Stem</label>
              <select
                className="select-input transfer-select"
                value={sourceStem}
                onChange={(e) => setSourceStem(e.target.value)}
              >
                <option value="lead">Lead Vocals [2]</option>
                <option value="inst">Instrumental [1]</option>
                <option value="back">Backing Vocals [3]</option>
              </select>
            </div>

            {/* Action Type Selector */}
            <div className="transfer-input-group">
              <label>Correction Action</label>
              <select
                className="select-input transfer-select"
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
              >
                <option value="move">Move &amp; Merge (Cut from Source, Add to Target)</option>
                <option value="copy">Copy &amp; Merge (Duplicate into Target)</option>
                <option value="swap">Swap Audio (Exchange between Stems)</option>
                <option value="silence">Silence Selection (Zero out Source)</option>
              </select>
            </div>

            {/* Destination Stem Selector (if not silencing) */}
            {actionType !== 'silence' && (
              <div className="transfer-input-group">
                <label>Destination Stem</label>
                <select
                  className="select-input transfer-select"
                  value={targetStem}
                  onChange={(e) => setTargetStem(e.target.value)}
                >
                  <option value="inst" disabled={sourceStem === 'inst'}>Instrumental</option>
                  <option value="lead" disabled={sourceStem === 'lead'}>Lead Vocals</option>
                  <option value="back" disabled={sourceStem === 'back'}>Backing Vocals</option>
                </select>
              </div>
            )}

            {/* Crossfade edge selector */}
            <div className="transfer-input-group" style={{ maxWidth: '120px' }}>
              <label>Crossfade</label>
              <select
                className="select-input transfer-select"
                value={crossfadeMs}
                onChange={(e) => setCrossfadeMs(parseInt(e.target.value, 10))}
                title="Crossfade smoothing on selection edges to prevent clicks"
              >
                <option value={0}>0 ms (Hard)</option>
                <option value={5}>5 ms</option>
                <option value={10}>10 ms (Smooth)</option>
                <option value={25}>25 ms</option>
                <option value={50}>50 ms</option>
              </select>
            </div>

            {/* Selected Time Bounds inputs */}
            <div className="transfer-input-group" style={{ maxWidth: '170px' }}>
              <label>Selection Bounds</label>
              <div className="selection-bounds-readout">
                {selection ? (
                  <span>{formatTimePrecise(selection.start).slice(3)} → {formatTimePrecise(selection.end).slice(3)}</span>
                ) : (
                  <span style={{ color: '#64748b' }}>None</span>
                )}
              </div>
            </div>

            {/* Apply Action Button */}
            <div className="transfer-input-group" style={{ alignSelf: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-apply-transfer"
                onClick={handleApplyTransfer}
                disabled={!selection || selection.end <= selection.start || (actionType !== 'silence' && sourceStem === targetStem)}
                title="Apply audio transfer to the selected interval (Enter)"
              >
                <i className="icon-arrow-right-circle" style={{ marginRight: '0.4rem' }}></i>
                Apply Transfer (↵)
              </button>
            </div>
          </div>
        </div>

        {/* Keyboard Shortcuts Cheatsheet Modal */}
        {showShortcutsModal && (
          <div className="modal-backdrop stem-shortcuts-backdrop" onClick={() => setShowShortcutsModal(false)}>
            <div className="modal-box stem-shortcuts-box" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3><i className="icon-command" style={{ marginRight: '0.4rem' }}></i> Stem Editor Keyboard Shortcuts</h3>
                <button className="btn-close" onClick={() => setShowShortcutsModal(false)}><i className="icon-x"></i></button>
              </div>
              <div className="shortcuts-grid">
                <div className="shortcut-col">
                  <h4>Playback &amp; Transport</h4>
                  <div className="shortcut-row"><kbd>Space</kbd><span>Play / Pause</span></div>
                  <div className="shortcut-row"><kbd>Shift + Space</kbd><span>Play Selection Only</span></div>
                  <div className="shortcut-row"><kbd>K</kbd><span>Stop &amp; Rewind</span></div>
                  <div className="shortcut-row"><kbd>L</kbd><span>Toggle Loop Selection</span></div>
                  <div className="shortcut-row"><kbd>← / →</kbd><span>Seek Playhead (1s)</span></div>
                  <div className="shortcut-row"><kbd>Alt + ← / →</kbd><span>Seek Playhead Fine (0.2s)</span></div>
                </div>

                <div className="shortcut-col">
                  <h4>Selection &amp; Zoom</h4>
                  <div className="shortcut-row"><kbd>+ / =</kbd><span>Zoom In</span></div>
                  <div className="shortcut-row"><kbd>- / _</kbd><span>Zoom Out</span></div>
                  <div className="shortcut-row"><kbd>F</kbd><span>Fit Entire Track</span></div>
                  <div className="shortcut-row"><kbd>Z</kbd><span>Zoom to Selection</span></div>
                  <div className="shortcut-row"><kbd>Ctrl/Cmd + A</kbd><span>Select All Track</span></div>
                  <div className="shortcut-row"><kbd>Esc</kbd><span>Clear Selection / Close</span></div>
                  <div className="shortcut-row"><kbd>[ / ]</kbd><span>Set Start / End to Playhead</span></div>
                  <div className="shortcut-row"><kbd>Shift + ← / →</kbd><span>Nudge Selection Range</span></div>
                  <div className="shortcut-row"><kbd>Minimap Edges</kbd><span>Drag View or Selection Sides</span></div>
                </div>

                <div className="shortcut-col">
                  <h4>Editing &amp; Actions</h4>
                  <div className="shortcut-row"><kbd>1 / 2 / 3</kbd><span>Select Source Stem (Inst / Lead / Back)</span></div>
                  <div className="shortcut-row"><kbd>Enter</kbd><span>Apply Current Transfer</span></div>
                  <div className="shortcut-row"><kbd>Backspace / Del</kbd><span>Silence Selection</span></div>
                  <div className="shortcut-row"><kbd>Ctrl/Cmd + Z</kbd><span>Undo Last Transfer</span></div>
                  <div className="shortcut-row"><kbd>Ctrl/Cmd + Shift + Z</kbd><span>Redo Transfer</span></div>
                  <div className="shortcut-row"><kbd>Ctrl/Cmd + S</kbd><span>Save &amp; Apply Stems</span></div>
                  <div className="shortcut-row"><kbd>?</kbd><span>Toggle Shortcuts Cheatsheet</span></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
