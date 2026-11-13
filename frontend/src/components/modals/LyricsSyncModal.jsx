import React, { useState, useEffect, useRef } from 'react';
import { useModalStore } from '../../stores/useModalStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { formatCentiseconds, parseCentiseconds } from '../../utils/themeColors';
import { isInstrumentalText, isRtlText, getLineWordPairsWithPauses, migrateLegacySyncPoints } from '../../utils/lyricsWrapping';
import * as audioPlayer from '../../services/audioPlayer';
import { emitUpdateState } from '../../services/socket';
import LyricsTimelineSpectrumEditor from './LyricsTimelineSpectrumEditor';
import ScrollShadowWrapper from '../common/ScrollShadowWrapper';

export default function LyricsSyncModal() {
  const rawModalSong = useModalStore((state) => state.lyricsSyncModalSong);
  const close = useModalStore((state) => state.closeLyricsSyncModal);
  const currentSong = usePlaybackStore((state) => state.currentSong);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const duration = usePlaybackStore((state) => state.duration) || 0;
  const seek = usePlaybackStore((state) => state.seek);
  const togglePlayPause = usePlaybackStore((state) => state.togglePlayPause);
  const selectSong = usePlaybackStore((state) => state.selectSong);

  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState([]);
  const [timeStrings, setTimeStrings] = useState({});
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [activeTapIndex, setActiveTapIndex] = useState(0);
  const [isTapMode, setIsTapMode] = useState(false);
  const [nudgeUnit, setNudgeUnit] = useState('0.10');
  const [showTranslit, setShowTranslit] = useState(false);
  const [showTranslat, setShowTranslat] = useState(false);
  const [showPreciseSync, setShowPreciseSync] = useState(false);
  const [showNestedTableIndex, setShowNestedTableIndex] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [playbackTime, setPlaybackTime] = useState(0);

  // Sub-line / word / character sync state
  const [expandedSyncRowIndex, setExpandedSyncRowIndex] = useState(null);
  const [selectedSyncPtKey, setSelectedSyncPtKey] = useState(null);
  const [aiPrecision, setAiPrecision] = useState('word');
  const [aiModel, setAiModel] = useState('small');
  const [isAutoSyncing, setIsAutoSyncing] = useState(false);
  const [autoSyncProgress, setAutoSyncProgress] = useState(null);

  const getSongId = (s) => (s ? String(s.id || s._id || '') : '');
  const modalSongId = getSongId(song) || (typeof rawModalSong === 'string' ? rawModalSong : getSongId(rawModalSong));
  const activeSongId = getSongId(currentSong);
  const isSameSong = Boolean(modalSongId && activeSongId && modalSongId === activeSongId);
  const isPlayingForSong = isSameSong && isPlaying;
  const effectiveDuration = isSameSong
    ? (duration || audioPlayer.getLoadedDuration() || song?.duration || 0)
    : (song?.duration || (lines.length > 0 ? (lines[lines.length - 1].time || 0) + 5 : 0));

  const savedSnapshotRef = useRef('');
  const nudgeStep = Math.max(0.01, parseFloat(nudgeUnit) || 0.1);
  const timelineRef = useRef(null);

  // Fresh state refs for global event listener
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const isPlayingForSongRef = useRef(isPlayingForSong);
  isPlayingForSongRef.current = isPlayingForSong;
  const isSameSongRef = useRef(isSameSong);
  isSameSongRef.current = isSameSong;
  const selectedRowIndexRef = useRef(selectedRowIndex);
  selectedRowIndexRef.current = selectedRowIndex;
  const selectedSyncPtKeyRef = useRef(selectedSyncPtKey);
  selectedSyncPtKeyRef.current = selectedSyncPtKey;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const activeTapIndexRef = useRef(activeTapIndex);
  activeTapIndexRef.current = activeTapIndex;
  const isTapModeRef = useRef(isTapMode);
  isTapModeRef.current = isTapMode;
  const nudgeStepRef = useRef(nudgeStep);
  nudgeStepRef.current = nudgeStep;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const effectiveDurationRef = useRef(effectiveDuration);
  effectiveDurationRef.current = effectiveDuration;
  const songRef = useRef(song);
  songRef.current = song;
  const modalBoxRef = useRef(null);
  const playbackTimeRef = useRef(playbackTime);
  playbackTimeRef.current = playbackTime;

  // Helper to scroll only the internal sync-editor-list without shifting the modal box
  const scrollToLine = (idx, block = 'nearest') => {
    if (idx < 0) return;
    const rowEl = document.getElementById(`sync-line-${idx}`);
    const listEl = modalBoxRef.current?.querySelector('.sync-editor-list') || document.querySelector('.sync-editor-list');
    if (listEl && rowEl) {
      const listRect = listEl.getBoundingClientRect();
      const rowRect = rowEl.getBoundingClientRect();
      if (block === 'center') {
        const targetScroll = listEl.scrollTop + (rowRect.top - listRect.top) - (listEl.clientHeight / 2) + (rowRect.height / 2);
        listEl.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
      } else {
        if (rowRect.top < listRect.top + 6) {
          listEl.scrollTop += (rowRect.top - listRect.top) - 14;
        } else if (rowRect.bottom > listRect.bottom - 6) {
          listEl.scrollTop += (rowRect.bottom - listRect.bottom) + 14;
        }
      }
    }
    if (modalBoxRef.current && modalBoxRef.current.scrollTop !== 0) {
      modalBoxRef.current.scrollTop = 0;
    }
  };

  // Manage focus when modal opens to ensure keyboard shortcuts work cleanly
  useEffect(() => {
    if (rawModalSong) {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      if (modalBoxRef.current) {
        modalBoxRef.current.scrollTop = 0;
        if (typeof modalBoxRef.current.focus === 'function') {
          modalBoxRef.current.focus();
        }
      }
    }
  }, [rawModalSong]);

  // Expose global helper for backward compatibility
  useEffect(() => {
    window.openSyncEditorModal = (songOrId) => {
      useModalStore.getState().openLyricsSyncModal(songOrId);
    };
  }, []);

  // Smooth playback time ticker with 60 FPS direct DOM updates and throttled React state
  useEffect(() => {
    if (!rawModalSong) return;
    let rafId;
    let lastStateUpdate = 0;

    const tick = (now) => {
      const cur = isSameSongRef.current
        ? usePlaybackStore.getState().getAccuratePlaybackTime()
        : (playbackTimeRef.current || 0);
      playbackTimeRef.current = cur;

      // Direct DOM update for live centisecond clock - 60 FPS without React re-renders
      const curTimeEl = document.getElementById('syncEditorCurTime');
      if (curTimeEl) {
        curTimeEl.textContent = formatCentiseconds(cur);
      }
      const tapBtnEl = document.getElementById('syncTapStampBtnTime');
      if (tapBtnEl) {
        tapBtnEl.textContent = formatCentiseconds(cur);
      }

      // Throttle React state update to 10 FPS (every 100ms) or when paused
      if (!isPlayingForSongRef.current || now - lastStateUpdate >= 100) {
        lastStateUpdate = now;
        setPlaybackTime(cur);
      }

      if (isPlayingForSongRef.current) {
        rafId = requestAnimationFrame(tick);
      }
    };

    if (isPlayingForSong) {
      rafId = requestAnimationFrame(tick);
    } else {
      const cur = isSameSong
        ? usePlaybackStore.getState().getAccuratePlaybackTime()
        : (playbackTimeRef.current || 0);
      playbackTimeRef.current = cur;
      setPlaybackTime(cur);
      const curTimeEl = document.getElementById('syncEditorCurTime');
      if (curTimeEl) curTimeEl.textContent = formatCentiseconds(cur);
      const tapBtnEl = document.getElementById('syncTapStampBtnTime');
      if (tapBtnEl) tapBtnEl.textContent = formatCentiseconds(cur);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isPlayingForSong, rawModalSong, isSameSong]);

  // Synchronize paused playback time from store changes (e.g. seek in main player, display tab updates)
  useEffect(() => {
    if (!isSameSong) return;
    const unsub = usePlaybackStore.subscribe((state, prevState) => {
      if (!state.isPlaying && state.currentTime !== prevState.currentTime) {
        playbackTimeRef.current = state.currentTime;
        setPlaybackTime(state.currentTime);
        const curTimeEl = document.getElementById('syncEditorCurTime');
        if (curTimeEl) curTimeEl.textContent = formatCentiseconds(state.currentTime);
        const tapBtnEl = document.getElementById('syncTapStampBtnTime');
        if (tapBtnEl) tapBtnEl.textContent = formatCentiseconds(state.currentTime);
      }
    });
    return unsub;
  }, [isSameSong]);

  // Resolve song details when rawModalSong changes (supports ID string or song object)
  useEffect(() => {
    if (!rawModalSong) {
      setSong(null);
      setLines([]);
      return;
    }

    const songId = typeof rawModalSong === 'string' ? rawModalSong : rawModalSong.id;

    // Check if passed object already has lyrics populated
    if (typeof rawModalSong === 'object' && Array.isArray(rawModalSong.lyrics) && rawModalSong.lyrics.length > 0) {
      setSong(rawModalSong);
      return;
    }

    // Check if current playing song in store matches and has lyrics
    if (currentSong && currentSong.id === songId && Array.isArray(currentSong.lyrics) && currentSong.lyrics.length > 0) {
      setSong(currentSong);
      return;
    }

    // Fetch full song details with lyrics
    setLoading(true);
    fetch(`/api/song_details/${songId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.song) {
          setSong(data.song);
        } else if (typeof rawModalSong === 'object') {
          setSong(rawModalSong);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch song details for sync editor:', err);
        if (typeof rawModalSong === 'object') {
          setSong(rawModalSong);
        }
      })
      .finally(() => setLoading(false));
  }, [rawModalSong, currentSong]);

  // Initialize lines when resolved song is available
  useEffect(() => {
    if (song) {
      const initial = (song.lyrics || []).map((l, i) => {
        const isInst = !!l.isInstrumental || isInstrumentalText(l.text);
        let textVal = l.text || '';
        if (textVal === '🎵🎵🎵') {
          textVal = '';
        }
        return {
          id: i,
          time: typeof l.time === 'number' ? l.time : parseFloat(l.time) || 0,
          endTime: typeof l.endTime === 'number' ? l.endTime : (parseFloat(l.endTime) || undefined),
          text: textVal,
          transliteration: l.transliteration || '',
          translation: l.translation || '',
          isInstrumental: isInst,
          syncPoints: Array.isArray(l.syncPoints) ? migrateLegacySyncPoints(l.syncPoints) : []
        };
      });

      const hasTl = initial.some((l) => l.transliteration && l.transliteration.trim() !== '');
      const hasTr = initial.some((l) => l.translation && l.translation.trim() !== '');
      setShowTranslit(hasTl);
      setShowTranslat(hasTr);

      setLines(initial);
      setTimeStrings({});
      setUndoStack([]);
      setRedoStack([]);

      // Auto-detect currently playing active line if song is playing or loaded
      let initialActiveIdx = initial.length > 0 ? 0 : -1;
      const curTime = isSameSong
        ? usePlaybackStore.getState().getAccuratePlaybackTime()
        : 0;
      if (isSameSong) {
        playbackTimeRef.current = curTime;
        setPlaybackTime(curTime);
        const curTimeEl = document.getElementById('syncEditorCurTime');
        if (curTimeEl) curTimeEl.textContent = formatCentiseconds(curTime);
        const tapBtnEl = document.getElementById('syncTapStampBtnTime');
        if (tapBtnEl) tapBtnEl.textContent = formatCentiseconds(curTime);
      } else {
        playbackTimeRef.current = 0;
        setPlaybackTime(0);
      }
      if (curTime > 0 && initial.length > 0) {
        let foundIdx = -1;
        for (let i = 0; i < initial.length; i++) {
          if (initial[i].time <= curTime + 0.15) {
            foundIdx = i;
          } else {
            break;
          }
        }
        if (foundIdx >= 0) initialActiveIdx = foundIdx;
      }

      setSelectedRowIndex(initialActiveIdx);
      setActiveTapIndex(initialActiveIdx >= 0 ? initialActiveIdx : 0);
      setIsTapMode(false);
      setIsDirty(false);
      savedSnapshotRef.current = JSON.stringify(initial);

      // Scroll active line into view smoothly inside list container ONLY
      if (initialActiveIdx > 0) {
        setTimeout(() => {
          scrollToLine(initialActiveIdx, 'center');
        }, 120);
      }
    }
  }, [song]);

  const pushUndo = (newLines) => {
    setUndoStack((prev) => [...prev.slice(-40), lines]);
    setRedoStack([]);
    setLines(newLines);
    setIsDirty(true);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, lines]);
    setLines(prev);
    setTimeStrings({});
    setIsDirty(true);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, lines]);
    setLines(next);
    setTimeStrings({});
    setIsDirty(true);
  };

  const handleLineChange = (index, field, value) => {
    const next = [...lines];
    next[index] = { ...next[index], [field]: value };
    if (field === 'text') {
      const trimmed = (value || '').trim();
      next[index].isInstrumental = !trimmed || trimmed.toUpperCase() === '#INSTRUMENTAL';
    }
    pushUndo(next);
  };

  const handleTimeInputChange = (index, val) => {
    setTimeStrings((prev) => ({ ...prev, [index]: val }));
  };

  const handleTimeInputCommit = (index) => {
    const raw = timeStrings[index];
    if (raw !== undefined) {
      const parsed = parseCentiseconds(raw);
      const next = [...lines];
      const oldTime = next[index]?.time || 0;
      const shift = parsed - oldTime;
      const updatedSyncPoints = Array.isArray(next[index]?.syncPoints)
        ? next[index].syncPoints.map((p) => ({
            ...p,
            time: Math.max(0, Math.round(((parseFloat(p.time) || 0) + shift) * 100) / 100),
            endTime: p.endTime ? Math.max(0, Math.round(((parseFloat(p.endTime) || 0) + shift) * 100) / 100) : undefined
          }))
        : [];
      next[index] = { ...next[index], time: parsed, syncPoints: updatedSyncPoints };
      pushUndo(next);
      setTimeStrings((prev) => {
        const copy = { ...prev };
        delete copy[index];
        return copy;
      });
    }
  };

  const handleTimeNudge = (index, delta) => {
    const next = [...lines];
    if (!next[index]) return;
    const cur = parseFloat(next[index].time) || 0;
    const target = Math.max(0, Math.round((cur + delta) * 100) / 100);
    const timeShift = target - cur;
    const updatedSyncPoints = Array.isArray(next[index].syncPoints)
      ? next[index].syncPoints.map((p) => ({
          ...p,
          time: Math.max(0, Math.round(((parseFloat(p.time) || 0) + timeShift) * 100) / 100),
          endTime: p.endTime ? Math.max(0, Math.round(((parseFloat(p.endTime) || 0) + timeShift) * 100) / 100) : undefined
        }))
      : [];
    next[index] = { ...next[index], time: target, syncPoints: updatedSyncPoints };
    pushUndo(next);
    setTimeStrings((prev) => {
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });
  };

  const handleBulkShift = (delta) => {
    const next = lines.map((l) => ({
      ...l,
      time: Math.max(0, Math.round(((parseFloat(l.time) || 0) + delta) * 100) / 100),
      endTime: l.endTime ? Math.max(0, Math.round(((parseFloat(l.endTime) || 0) + delta) * 100) / 100) : undefined,
      syncPoints: Array.isArray(l.syncPoints)
        ? l.syncPoints.map((p) => ({
            ...p,
            time: Math.max(0, Math.round(((parseFloat(p.time) || 0) + delta) * 100) / 100),
            endTime: p.endTime ? Math.max(0, Math.round(((parseFloat(p.endTime) || 0) + delta) * 100) / 100) : undefined
          }))
        : []
    }));
    pushUndo(next);
    setTimeStrings({});
  };

  const handleAddLine = (afterIndex, optionalTime) => {
    let prevTime = 0;
    if (optionalTime !== undefined) {
      prevTime = Math.max(0, Math.round(optionalTime * 100) / 100);
    } else if (afterIndex >= 0 && lines[afterIndex]) {
      prevTime = lines[afterIndex].time + 2;
    }
    const newLine = {
      id: Date.now(),
      time: prevTime,
      text: '',
      transliteration: '',
      translation: '',
      isInstrumental: true,
      syncPoints: []
    };
    const next = [...lines];
    const insertIdx = afterIndex >= 0 ? afterIndex + 1 : next.length;
    next.splice(insertIdx, 0, newLine);
    if (optionalTime !== undefined) {
      next.sort((a, b) => a.time - b.time);
    }
    pushUndo(next);
    const newIdx = next.indexOf(newLine);
    setSelectedRowIndex(newIdx >= 0 ? newIdx : insertIdx);
  };

  const handleUpdateLineTime = (index, newTime, commit = true) => {
    const curLines = linesRef.current || lines;
    if (!curLines[index]) return;
    if (!commit && !dragInitialLinesRef.current) {
      dragInitialLinesRef.current = curLines;
    }
    const next = [...curLines];
    const oldTime = next[index].time || 0;
    const rounded = Math.max(0, Math.round(newTime * 100) / 100);
    const shift = rounded - oldTime;
    const updatedSyncPoints = Array.isArray(next[index].syncPoints)
      ? next[index].syncPoints.map((p) => ({
          ...p,
          time: Math.max(0, Math.round(((parseFloat(p.time) || 0) + shift) * 100) / 100),
          endTime: p.endTime ? Math.max(0, Math.round(((parseFloat(p.endTime) || 0) + shift) * 100) / 100) : undefined
        }))
      : [];
    next[index] = { ...next[index], time: rounded, syncPoints: updatedSyncPoints };
    if (commit) {
      const initialSnapshot = dragInitialLinesRef.current || curLines;
      dragInitialLinesRef.current = null;
      setUndoStack((prev) => [...prev.slice(-40), initialSnapshot]);
      setRedoStack([]);
      setLines(next);
      linesRef.current = next;
      setIsDirty(true);
      setTimeStrings((prev) => {
        const copy = { ...prev };
        delete copy[index];
        return copy;
      });
    } else {
      setLines(next);
      linesRef.current = next;
      setIsDirty(true);
    }
  };

  const handleDeleteLine = (index) => {
    const next = lines.filter((_, i) => i !== index);
    pushUndo(next);
    setTimeStrings({});
    if (next.length > 0) {
      setSelectedRowIndex(Math.max(0, Math.min(index, next.length - 1)));
    } else {
      setSelectedRowIndex(-1);
    }
  };

  const handleTogglePlayPause = async () => {
    try {
      const curStore = usePlaybackStore.getState();
      const targetSong = songRef.current || (typeof rawModalSong === 'object' ? rawModalSong : null) || curStore.currentSong;
      if (!targetSong) return;

      const curSong = curStore.currentSong;
      const needsSelect = !curSong ||
        curSong.id !== targetSong.id ||
        (!audioPlayer.getLoadedBuffer() && !audioPlayer.isPlayingLocally() && curStore.audioMaster !== 'display');

      if (needsSelect) {
        await curStore.selectSong(targetSong, true);
        return;
      }

      await togglePlayPause();
    } catch (err) {
      console.error('Error toggling playback in sync editor:', err);
    }
  };

  const handleSeek = (time) => {
    const targetTime = typeof time === 'number' ? time : parseFloat(time) || 0;
    const maxDur = effectiveDurationRef.current || 0;
    const clamped = Math.max(0, maxDur > 0 ? Math.min(maxDur, targetTime) : targetTime);
    playbackTimeRef.current = clamped;
    setPlaybackTime(clamped);

    const curTimeEl = document.getElementById('syncEditorCurTime');
    if (curTimeEl) curTimeEl.textContent = formatCentiseconds(clamped);
    const tapBtnEl = document.getElementById('syncTapStampBtnTime');
    if (tapBtnEl) tapBtnEl.textContent = formatCentiseconds(clamped);

    if (isSameSongRef.current) {
      seek(clamped);
    }
  };

  const handlePlayLine = async (time) => {
    try {
      const targetTime = typeof time === 'number' ? time : parseFloat(time) || 0;
      const curStore = usePlaybackStore.getState();
      const targetSong = songRef.current || (typeof rawModalSong === 'object' ? rawModalSong : null) || curStore.currentSong;

      if (targetSong && (!curStore.currentSong || curStore.currentSong.id !== targetSong.id)) {
        await curStore.selectSong(targetSong, false);
      }

      handleSeek(targetTime);
      if (!isPlayingForSongRef.current) {
        await handleTogglePlayPause();
      }
    } catch (err) {
      console.error('Error playing line in sync editor:', err);
    }
  };

  const handleStampCurrentLine = () => {
    const curTime = isSameSongRef.current
      ? usePlaybackStore.getState().getAccuratePlaybackTime()
      : (playbackTimeRef.current || 0);
    const stamped = Math.round(curTime * 100) / 100;
    const next = [...linesRef.current];
    const targetIdx = isTapModeRef.current ? activeTapIndexRef.current : (selectedRowIndexRef.current >= 0 ? selectedRowIndexRef.current : 0);
    if (next[targetIdx]) {
      const oldTime = next[targetIdx].time || 0;
      const shift = stamped - oldTime;
      const updatedSyncPoints = Array.isArray(next[targetIdx].syncPoints)
        ? next[targetIdx].syncPoints.map((p) => ({
            ...p,
            time: Math.max(0, Math.round(((parseFloat(p.time) || 0) + shift) * 100) / 100),
            endTime: p.endTime ? Math.max(0, Math.round(((parseFloat(p.endTime) || 0) + shift) * 100) / 100) : undefined
          }))
        : [];
      next[targetIdx] = { ...next[targetIdx], time: stamped, syncPoints: updatedSyncPoints };
      pushUndo(next);
      setTimeStrings((prev) => {
        const copy = { ...prev };
        delete copy[targetIdx];
        return copy;
      });
    }
    if (isTapModeRef.current) {
      if (activeTapIndexRef.current < linesRef.current.length - 1) {
        const nextIdx = activeTapIndexRef.current + 1;
        setActiveTapIndex(nextIdx);
        setSelectedRowIndex(nextIdx);
        scrollToLine(nextIdx, 'nearest');
      } else {
        setIsTapMode(false);
      }
    }
  };

  const handleSave = async () => {
    if (!song?.id) return;
    setIsSaving(true);
    const sorted = [...lines].sort((a, b) => a.time - b.time);
    const cleanPayload = sorted.map((l) => {
      const trimmed = (l.text || '').trim();
      const isInst = !trimmed || trimmed.toUpperCase() === '#INSTRUMENTAL' || l.isInstrumental;
      return {
        time: Math.round(l.time * 100) / 100,
        endTime: typeof l.endTime === 'number' ? Math.round(l.endTime * 100) / 100 : undefined,
        text: trimmed || '#INSTRUMENTAL',
        transliteration: l.transliteration?.trim() || undefined,
        translation: l.translation?.trim() || undefined,
        isInstrumental: isInst || undefined,
        syncPoints: Array.isArray(l.syncPoints) && l.syncPoints.length > 0 ? l.syncPoints
          .filter((p) => !p?.isPause)
          .map((p) => {
            const ptTime = Math.round((parseFloat(p.time) || 0) * 100) / 100;
            const ptEnd = (typeof p.endTime === 'number' && !isNaN(p.endTime))
              ? Math.round((parseFloat(p.endTime) || 0) * 100) / 100
              : undefined;
            return {
              charIndex: typeof p.charIndex === 'number' ? p.charIndex : 0,
              time: ptTime,
              ...(ptEnd !== undefined ? { endTime: ptEnd } : {}),
              text: p.text ? p.text.trim() : undefined
            };
          }) : undefined
      };
    });

    try {
      const res = await fetch('/api/edit_lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: song.id, lyrics: cleanPayload })
      });
      const data = await res.json();
      if (data.success) {
        savedSnapshotRef.current = JSON.stringify(lines);
        setIsDirty(false);
        if (currentSong && currentSong.id === song.id) {
          usePlaybackStore.setState({
            currentSong: { ...currentSong, lyrics: cleanPayload }
          });
          emitUpdateState({
            songId: song.id,
            songData: { ...currentSong, lyrics: cleanPayload }
          });
        }
      } else {
        alert('Failed to save lyrics.');
      }
    } catch (err) {
      console.error('Error saving lyrics:', err);
      alert('Error saving synced lyrics.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (isDirty) {
      if (!window.confirm('You have unsaved changes in Lyrics & Sync Editor. Discard and exit?')) {
        return;
      }
    }
    close();
  };

  // Sync Point & Pause Handlers
  const dragInitialLinesRef = useRef(null);

  const handleSyncPointTimeChange = (lineIdx, ptIdx, newTime, commit = true) => {
    const curLines = linesRef.current || lines;
    if (!curLines[lineIdx]?.syncPoints?.[ptIdx]) return;
    if (!commit && !dragInitialLinesRef.current) {
      dragInitialLinesRef.current = curLines;
    }
    const next = [...curLines];
    const pts = [...next[lineIdx].syncPoints];
    const pt = pts[ptIdx];
    const rounded = Math.max(0, Math.round(newTime * 100) / 100);
    const updated = { ...pt, time: rounded };
    if (typeof pt.duration === 'number' && pt.duration > 0) {
      updated.endTime = Math.round((rounded + pt.duration) * 100) / 100;
    } else if (typeof pt.endTime === 'number' && pt.endTime > pt.time) {
      const dur = Math.max(0.05, Math.round((pt.endTime - pt.time) * 100) / 100);
      updated.duration = dur;
      updated.endTime = Math.round((rounded + dur) * 100) / 100;
    }
    pts[ptIdx] = updated;
    if (commit) {
      const initialSnapshot = dragInitialLinesRef.current || curLines;
      dragInitialLinesRef.current = null;
      pts.sort((a, b) => a.time - b.time);
      next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
      setUndoStack((prev) => [...prev.slice(-40), initialSnapshot]);
      setRedoStack([]);
      setLines(next);
      linesRef.current = next;
      setIsDirty(true);
    } else {
      next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
      setLines(next);
      linesRef.current = next;
      setIsDirty(true);
    }
  };

  const handleSyncPointDurationChange = (lineIdx, ptIdx, newDuration) => {
    const curLines = linesRef.current || lines;
    if (!curLines[lineIdx]?.syncPoints?.[ptIdx]) return;
    const next = [...curLines];
    const pts = [...next[lineIdx].syncPoints];
    const pt = pts[ptIdx];
    const curTime = typeof pt.time === 'number' ? pt.time : parseFloat(pt.time) || 0;
    const dur = Math.max(0.05, Math.round(newDuration * 100) / 100);
    pts[ptIdx] = {
      ...pt,
      duration: dur,
      endTime: Math.round((curTime + dur) * 100) / 100,
      isPause: true
    };
    next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
    pushUndo(next);
  };

  const handleSyncPointEndTimeChange = (lineIdx, ptIdx, newEndTime, commit = true) => {
    const curLines = linesRef.current || lines;
    if (!curLines[lineIdx]?.syncPoints?.[ptIdx]) return;
    if (!commit && !dragInitialLinesRef.current) {
      dragInitialLinesRef.current = curLines;
    }
    const next = [...curLines];
    const pts = [...next[lineIdx].syncPoints];
    const pt = pts[ptIdx];
    const curTime = typeof pt.time === 'number' ? pt.time : parseFloat(pt.time) || 0;
    const end = Math.max(curTime + 0.05, Math.round(newEndTime * 100) / 100);
    const dur = Math.round((end - curTime) * 100) / 100;
    pts[ptIdx] = {
      ...pt,
      endTime: end,
      duration: dur,
      isPause: true
    };
    next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
    if (commit) {
      const initialSnapshot = dragInitialLinesRef.current || curLines;
      dragInitialLinesRef.current = null;
      setUndoStack((prev) => [...prev.slice(-40), initialSnapshot]);
      setRedoStack([]);
      setLines(next);
      linesRef.current = next;
      setIsDirty(true);
    } else {
      setLines(next);
      linesRef.current = next;
      setIsDirty(true);
    }
  };

  const handleUpdatePauseBounds = (lineIdx, ptIdx, newStartTime, newEndTime, commit = true, pauseId = null, dragMode = null) => {
    const curLines = linesRef.current || lines;
    if (!curLines[lineIdx]) return;
    if (!commit && !dragInitialLinesRef.current) {
      dragInitialLinesRef.current = curLines;
    }
    const next = [...curLines];
    let pts = Array.isArray(next[lineIdx].syncPoints) ? migrateLegacySyncPoints(next[lineIdx].syncPoints) : [];

    const start = Math.max(0, Math.round(newStartTime * 100) / 100);
    const end = Math.max(start + 0.05, Math.round(newEndTime * 100) / 100);

    const { words, pauses } = getLineWordPairsWithPauses(next[lineIdx].text, pts, next[lineIdx].time, next[lineIdx].endTime);
    let targetPause = null;
    if (pauseId) {
      targetPause = pauses.find((p) => p.id === pauseId || `${lineIdx}_pause_${p.prevWordIndex}` === pauseId || pauseId.includes(`pause_${p.prevWordIndex}`));
    }
    if (!targetPause && typeof ptIdx === 'number' && ptIdx >= 0) {
      targetPause = pauses.find((p) => p.ptIndex === ptIdx || p.slot === ptIdx || p.prevWordIndex === ptIdx);
    }
    if (!targetPause && typeof ptIdx === 'string') {
      targetPause = pauses.find((p) => p.id === ptIdx || `${lineIdx}_pause_${p.prevWordIndex}` === ptIdx || ptIdx.includes(`pause_${p.prevWordIndex}`));
    }
    if (!targetPause && pauses.length > 0) {
      targetPause = pauses[0];
    }

    if (targetPause) {
      // 1. Preceding word's endTime is updated to start timestamp
      if (targetPause.prevWord) {
        const pw = targetPause.prevWord;
        let pWordIdx = pts.findIndex((p) => p.id === pw.pointId || p._id === pw.pointId);
        if (pWordIdx === -1 && typeof pw.charIndex === 'number') {
          pWordIdx = pts.findIndex((p) => typeof p.charIndex === 'number' && Math.abs(p.charIndex - pw.charIndex) <= 1);
        }
        if (pWordIdx === -1 && pw.ptIndex >= 0 && pts[pw.ptIndex]) pWordIdx = pw.ptIndex;
        if (pWordIdx === -1) pWordIdx = pts.findIndex((p) => p.text === pw.text);
        if (pWordIdx >= 0) {
          pts[pWordIdx] = { ...pts[pWordIdx], endTime: start };
        }
      }

      // 2. Following word's time is updated to end timestamp
      if (targetPause.nextWord) {
        const nw = targetPause.nextWord;
        let nWordIdx = pts.findIndex((p) => p.id === nw.pointId || p._id === nw.pointId);
        if (nWordIdx === -1 && typeof nw.charIndex === 'number') {
          nWordIdx = pts.findIndex((p) => typeof p.charIndex === 'number' && Math.abs(p.charIndex - nw.charIndex) <= 1);
        }
        if (nWordIdx === -1 && nw.ptIndex >= 0 && pts[nw.ptIndex]) nWordIdx = nw.ptIndex;
        if (nWordIdx === -1) nWordIdx = pts.findIndex((p) => p.text === nw.text);
        if (nWordIdx >= 0) {
          const nwPt = pts[nWordIdx];
          let nextEnd = nwPt.endTime;
          if (typeof nextEnd === 'number' && nextEnd <= end + 0.05) {
            nextEnd = Math.round((end + 0.4) * 100) / 100;
          }
          pts[nWordIdx] = { ...nwPt, time: end, ...(nextEnd !== undefined ? { endTime: nextEnd } : {}) };
        }
      }
    }

    pts.sort((a, b) => (a.time !== b.time ? a.time - b.time : (a.charIndex || 0) - (b.charIndex || 0)));
    next[lineIdx] = { ...next[lineIdx], syncPoints: pts };

    if (commit) {
      const initialSnapshot = dragInitialLinesRef.current || curLines;
      dragInitialLinesRef.current = null;
      if (targetPause) {
        setSelectedSyncPtKey(`${lineIdx}_pause_${targetPause.prevWordIndex}`);
      }
      setUndoStack((prev) => [...prev.slice(-40), initialSnapshot]);
      setRedoStack([]);
      setLines(next);
      linesRef.current = next;
      setIsDirty(true);
    } else {
      setLines(next);
      linesRef.current = next;
      setIsDirty(true);
    }
  };

  const handleSetPauseStart = (lineIdx, pause, newStartTime) => {
    const start = Math.max(0, Math.round(newStartTime * 100) / 100);
    const end = Math.max(start + 0.05, pause.endTime);
    handleUpdatePauseBounds(lineIdx, pause.ptIndex, start, end, true, pause.id);
  };

  const handleSetPauseEnd = (lineIdx, pause, newEndTime) => {
    const end = Math.max(pause.startTime + 0.05, Math.round(newEndTime * 100) / 100);
    handleUpdatePauseBounds(lineIdx, pause.ptIndex, pause.startTime, end, true, pause.id);
  };

  const handleAdjustPauseGap = (lineIdx, pause, delta) => {
    const curDur = pause.duration || 0.8;
    const newDur = Math.max(0.05, Math.round((curDur + delta) * 100) / 100);
    const newEnd = Math.round((pause.startTime + newDur) * 100) / 100;
    handleUpdatePauseBounds(lineIdx, pause.ptIndex, pause.startTime, newEnd, true, pause.id);
  };

  const handleRemovePauseBetween = (lineIdx, pause) => {
    const curLines = linesRef.current || lines;
    if (!curLines[lineIdx]) return;
    const next = [...curLines];
    let pts = Array.isArray(next[lineIdx].syncPoints) ? migrateLegacySyncPoints(next[lineIdx].syncPoints) : [];

    if (pause?.prevWord) {
      const pw = pause.prevWord;
      let pIdx = pts.findIndex((p) => p.id === pw.pointId || p._id === pw.pointId);
      if (pIdx === -1 && typeof pw.charIndex === 'number') {
        pIdx = pts.findIndex((p) => typeof p.charIndex === 'number' && Math.abs(p.charIndex - pw.charIndex) <= 1);
      }
      if (pIdx === -1 && pw.ptIndex >= 0 && pts[pw.ptIndex]) pIdx = pw.ptIndex;
      if (pIdx === -1) pIdx = pts.findIndex((p) => p.text === pw.text);

      if (pIdx >= 0) {
        const updated = { ...pts[pIdx] };
        delete updated.endTime;
        delete updated.isPause;
        delete updated.duration;
        pts[pIdx] = updated;
      }
    }

    next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
    setSelectedSyncPtKey(null);
    pushUndo(next);
  };

  const handleAddPauseBetween = (lineIdx, w1Idx, w2Idx) => {
    const curLines = linesRef.current || lines;
    if (!curLines[lineIdx]) return;
    const next = [...curLines];
    let pts = Array.isArray(next[lineIdx].syncPoints) ? migrateLegacySyncPoints(next[lineIdx].syncPoints) : [];
    const { words } = getLineWordPairsWithPauses(next[lineIdx].text, pts, next[lineIdx].time, next[lineIdx].endTime);
    if (!words[w1Idx] || !words[w2Idx]) return;

    const w1 = words[w1Idx];
    const w2 = words[w2Idx];

    // Find w1 in pts
    let pWordIdx = pts.findIndex((p) => p.id === w1.pointId || p._id === w1.pointId);
    if (pWordIdx === -1 && typeof w1.charIndex === 'number') {
      pWordIdx = pts.findIndex((p) => typeof p.charIndex === 'number' && Math.abs(p.charIndex - w1.charIndex) <= 1);
    }
    if (pWordIdx === -1 && w1.ptIndex >= 0 && pts[w1.ptIndex]) pWordIdx = w1.ptIndex;
    if (pWordIdx === -1) pWordIdx = pts.findIndex((p) => p.text === w1.text);

    // Find w2 in pts
    let nWordIdx = pts.findIndex((p) => p.id === w2.pointId || p._id === w2.pointId);
    if (nWordIdx === -1 && typeof w2.charIndex === 'number') {
      nWordIdx = pts.findIndex((p) => typeof p.charIndex === 'number' && Math.abs(p.charIndex - w2.charIndex) <= 1);
    }
    if (nWordIdx === -1 && w2.ptIndex >= 0 && pts[w2.ptIndex]) nWordIdx = w2.ptIndex;
    if (nWordIdx === -1) nWordIdx = pts.findIndex((p) => p.text === w2.text);

    if (pWordIdx === -1) return;

    const w1Start = pts[pWordIdx].time;
    let w2Start = nWordIdx >= 0 ? pts[nWordIdx].time : w1Start + 0.8;

    let pauseStart = Math.round(Math.max(w1Start + 0.15, w2Start - 0.45) * 100) / 100;
    if (pauseStart >= w2Start - 0.05) {
      const shiftDelta = Math.round((pauseStart + 0.45 - w2Start) * 100) / 100;
      if (shiftDelta > 0 && nWordIdx >= 0) {
        for (let k = nWordIdx; k < pts.length; k++) {
          pts[k] = {
            ...pts[k],
            time: Math.round((pts[k].time + shiftDelta) * 100) / 100,
            ...(typeof pts[k].endTime === 'number' ? { endTime: Math.round((pts[k].endTime + shiftDelta) * 100) / 100 } : {})
          };
        }
        w2Start = Math.round((w2Start + shiftDelta) * 100) / 100;
      }
    }

    // Set optional earlier endTime on w1: this visualizes the pause segment [pauseStart, w2Start]
    pts[pWordIdx] = {
      ...pts[pWordIdx],
      endTime: pauseStart
    };

    next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
    setSelectedSyncPtKey(`${lineIdx}_pause_${w1Idx}`);
    pushUndo(next);
  };

  const handleWordEndTimeChange = (lineIdx, ptIdx, newEndTime) => {
    const curLines = linesRef.current || lines;
    if (!curLines[lineIdx]?.syncPoints?.[ptIdx]) return;
    const next = [...curLines];
    const pts = [...next[lineIdx].syncPoints];
    const pt = pts[ptIdx];
    if (newEndTime === null || newEndTime === undefined || isNaN(newEndTime)) {
      const updated = { ...pt };
      delete updated.endTime;
      delete updated.isPause;
      delete updated.duration;
      pts[ptIdx] = updated;
    } else {
      const end = Math.max(pt.time + 0.05, Math.round(newEndTime * 100) / 100);
      pts[ptIdx] = {
        ...pt,
        endTime: end
      };
    }
    next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
    pushUndo(next);
  };

  const handleWordEndTimeNudge = (lineIdx, ptIdx, delta) => {
    const curLines = linesRef.current || lines;
    if (!curLines[lineIdx]?.syncPoints?.[ptIdx]) return;
    const pt = curLines[lineIdx].syncPoints[ptIdx];
    const curEnd = typeof pt.endTime === 'number' ? pt.endTime : pt.time + 0.4;
    handleWordEndTimeChange(lineIdx, ptIdx, curEnd + delta);
  };

  const handleSyncPointDurationNudge = (lineIdx, ptIdx, delta) => {
    const next = [...lines];
    if (!next[lineIdx]?.syncPoints?.[ptIdx]) return;
    const pt = next[lineIdx].syncPoints[ptIdx];
    const curTime = typeof pt.time === 'number' ? pt.time : parseFloat(pt.time) || 0;
    const curEnd = typeof pt.endTime === 'number' ? pt.endTime : curTime + 0.4;
    handleWordEndTimeChange(lineIdx, ptIdx, curEnd + delta);
  };

  const handleRemovePause = (lineIdx, ptIdx) => {
    const curLines = linesRef.current || lines;
    const next = [...curLines];
    if (!next[lineIdx]?.syncPoints) return;
    let pts = migrateLegacySyncPoints(next[lineIdx].syncPoints);

    const { pauses } = getLineWordPairsWithPauses(next[lineIdx].text, pts, next[lineIdx].time, next[lineIdx].endTime);
    let targetP = null;
    if (typeof ptIdx === 'string') {
      targetP = pauses.find((p) =>
        p.id === ptIdx ||
        `${lineIdx}_pause_${p.prevWordIndex}` === ptIdx ||
        ptIdx.includes(`pause_${p.prevWordIndex}`) ||
        `${lineIdx}_${p.ptIndex}` === ptIdx
      );
    } else if (typeof ptIdx === 'number') {
      targetP = pauses.find((p) => p.ptIndex === ptIdx || p.slot === ptIdx);
    }

    if (targetP) {
      handleRemovePauseBetween(lineIdx, targetP);
      return;
    }

    const numericIdx = typeof ptIdx === 'number' ? ptIdx : parseInt(ptIdx, 10);
    if (!isNaN(numericIdx) && pts[numericIdx]) {
      const updated = { ...pts[numericIdx] };
      delete updated.endTime;
      delete updated.isPause;
      delete updated.duration;
      pts[numericIdx] = updated;
      next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
      pushUndo(next);
    }
  };

  const handleSyncPointNudge = (lineIdx, ptIdx, delta) => {
    const next = [...lines];
    if (!next[lineIdx]?.syncPoints?.[ptIdx]) return;
    const pts = [...next[lineIdx].syncPoints];
    const pt = pts[ptIdx];
    const curTime = typeof pt.time === 'number' ? pt.time : parseFloat(pt.time) || 0;
    const target = Math.max(0, Math.round((curTime + delta) * 100) / 100);
    const updated = { ...pt, time: target };
    if (typeof pt.endTime === 'number') {
      updated.endTime = Math.max(0, Math.round((pt.endTime + delta) * 100) / 100);
    }
    pts[ptIdx] = updated;
    pts.sort((a, b) => a.time - b.time);
    next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
    pushUndo(next);
  };

  const handleSyncPointTogglePause = (lineIdx, ptIdx) => {
    const next = [...lines];
    if (!next[lineIdx]?.syncPoints?.[ptIdx]) return;
    const pts = [...next[lineIdx].syncPoints];
    const pt = pts[ptIdx];
    const nextPt = pts[ptIdx + 1];
    if (typeof pt.endTime === 'number') {
      const updated = { ...pt };
      delete updated.endTime;
      delete updated.isPause;
      delete updated.duration;
      pts[ptIdx] = updated;
    } else {
      const nextTime = nextPt ? nextPt.time : pt.time + 1.0;
      const earlyEnd = Math.max(pt.time + 0.1, Math.round((nextTime - 0.4) * 100) / 100);
      pts[ptIdx] = {
        ...pt,
        endTime: earlyEnd
      };
    }
    next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
    pushUndo(next);
  };

  const handleDeleteSyncPoint = (lineIdx, ptIdx) => {
    const curLines = linesRef.current || lines;
    const next = [...curLines];
    if (!next[lineIdx]?.syncPoints) return;
    let pts = migrateLegacySyncPoints(next[lineIdx].syncPoints);
    const numIdx = typeof ptIdx === 'number' ? ptIdx : parseInt(ptIdx, 10);
    if (isNaN(numIdx)) return;
    pts = pts.filter((_, idx) => idx !== numIdx);
    next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
    setSelectedSyncPtKey(null);
    pushUndo(next);
  };

  const handleAddSyncPoint = (lineIdx, charIndex, wordText, optionalTime) => {
    const next = [...lines];
    if (!next[lineIdx]) return;
    const pts = Array.isArray(next[lineIdx].syncPoints) ? [...next[lineIdx].syncPoints] : [];
    const t = optionalTime !== undefined ? optionalTime : playbackTime;
    pts.push({
      charIndex: charIndex >= 0 ? charIndex : 0,
      time: Math.round(t * 100) / 100,
      endTime: Math.round((t + 0.4) * 100) / 100,
      text: wordText || ''
    });
    pts.sort((a, b) => (a.time !== b.time ? a.time - b.time : a.charIndex - b.charIndex));
    next[lineIdx] = { ...next[lineIdx], syncPoints: pts };
    pushUndo(next);
  };

  const handleAutoGenerateWordSyncPoints = (lineIdx) => {
    const next = [...lines];
    const line = next[lineIdx];
    if (!line || !line.text) return;
    const lineText = line.text.trim();
    if (!lineText) return;

    const words = [];
    const regex = /\S+/gu;
    let match;
    while ((match = regex.exec(lineText)) !== null) {
      words.push({ text: match[0], charIndex: match.index });
    }
    if (words.length === 0) return;

    const lineStart = typeof line.time === 'number' ? line.time : parseFloat(line.time) || 0;
    const nextLine = lineIdx < lines.length - 1 ? lines[lineIdx + 1] : null;
    const nextStart = nextLine ? (typeof nextLine.time === 'number' ? nextLine.time : parseFloat(nextLine.time) || (lineStart + 3)) : lineStart + 3;
    const lineDur = Math.max(1.0, nextStart - lineStart);
    const wordDur = lineDur / words.length;

    const pts = words.map((w, i) => ({
      charIndex: w.charIndex,
      time: Math.round((lineStart + i * wordDur) * 100) / 100,
      endTime: Math.round((lineStart + (i + 1) * wordDur) * 100) / 100,
      text: w.text
    }));

    next[lineIdx] = { ...line, syncPoints: pts, endTime: Math.round((lineStart + lineDur) * 100) / 100 };
    pushUndo(next);
  };

  const handleTriggerAutoSync = async () => {
    if (!song?.id || isAutoSyncing) return;
    setIsAutoSyncing(true);
    setAutoSyncProgress('Starting AI Auto-Sync...');
    try {
      const res = await fetch(`/api/auto_sync_lyrics/${song.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: aiModel, precision: aiPrecision, language: song.language || null })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Auto-sync failed');
      }
      if (Array.isArray(data.lines) && data.lines.length > 0) {
        const formatted = data.lines.map((l, i) => ({
          id: i,
          time: typeof l.time === 'number' ? l.time : parseFloat(l.time) || 0,
          endTime: typeof l.endTime === 'number' ? l.endTime : (parseFloat(l.endTime) || undefined),
          text: l.text === '🎵🎵🎵' ? '' : (l.text || ''),
          transliteration: l.transliteration || '',
          translation: l.translation || '',
          isInstrumental: !!l.isInstrumental || isInstrumentalText(l.text),
          syncPoints: Array.isArray(l.syncPoints) ? migrateLegacySyncPoints(l.syncPoints) : []
        }));
        pushUndo(formatted);
        setSelectedRowIndex(0);
        setIsDirty(true);
      }
    } catch (err) {
      alert(`Auto-Sync Error: ${err.message}`);
    } finally {
      setIsAutoSyncing(false);
      setAutoSyncProgress(null);
    }
  };

  // Keyboard navigation & shortcuts
  useEffect(() => {
    if (!rawModalSong) return;
    const handleKeyDown = (e) => {
      const isInput = e.target && (
        (e.target.tagName === 'INPUT' && e.target.type !== 'range') ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
      );

      // Save shortcut: Ctrl+S / Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

      // Undo: Ctrl+Z / Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!isInput) {
          e.preventDefault();
          handleUndo();
        }
        return;
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z / Cmd+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        if (!isInput) {
          e.preventDefault();
          handleRedo();
        }
        return;
      }

      // Escape: deselect sync point/pause, exit tap mode, or close modal
      if (e.key === 'Escape') {
        if (isInput && e.target && typeof e.target.blur === 'function') {
          e.target.blur();
          return;
        }
        if (selectedSyncPtKeyRef.current) {
          e.preventDefault();
          setSelectedSyncPtKey(null);
          selectedSyncPtKeyRef.current = null;
          return;
        }
        if (isTapModeRef.current) {
          e.preventDefault();
          setIsTapMode(false);
        } else {
          handleClose();
        }
        return;
      }

      // All transport, editing, and navigation controls when not typing inside an input/textarea
      if (!isInput) {
        // Delete or Backspace: Remove selected or hovered timestamp or pause
        if (e.key === 'Delete' || e.key === 'Backspace') {
          let targetLineIdx = null;
          let targetPtIdx = null;
          let targetIsPause = false;

          const curKey = selectedSyncPtKeyRef.current;
          if (curKey) {
            const parts = curKey.split('_');
            if (parts.length >= 2) {
              targetLineIdx = parseInt(parts[0], 10);
              if (curKey.includes('pause')) {
                targetIsPause = true;
                targetPtIdx = curKey;
              } else {
                targetPtIdx = parseInt(parts[1], 10);
              }
            }
          }

          if (targetLineIdx === null || targetPtIdx === null || isNaN(targetLineIdx)) {
            const hovered = timelineRef.current?.getHoveredSyncPoint?.();
            if (hovered && typeof hovered.lineIndex === 'number' && typeof hovered.pointIndex === 'number') {
              targetLineIdx = hovered.lineIndex;
              targetPtIdx = hovered.pointIndex;
              targetIsPause = !!hovered.isPause;
            }
          }

          if (targetLineIdx !== null && targetPtIdx !== null && !isNaN(targetLineIdx)) {
            const curLines = linesRef.current || lines;
            const curLine = curLines[targetLineIdx];

            if (targetIsPause || (typeof targetPtIdx === 'string' && targetPtIdx.includes('pause'))) {
              e.preventDefault();
              e.stopPropagation();
              handleRemovePause(targetLineIdx, targetPtIdx);
              setSelectedSyncPtKey(null);
              selectedSyncPtKeyRef.current = null;
              timelineRef.current?.clearHovered?.();
              return;
            }

            const targetPt = curLine?.syncPoints?.[targetPtIdx];
            if (targetPt) {
              e.preventDefault();
              e.stopPropagation();

              if (targetPt.isPause) {
                handleRemovePause(targetLineIdx, targetPtIdx);
              } else {
                handleDeleteSyncPoint(targetLineIdx, targetPtIdx);
              }

              setSelectedSyncPtKey(null);
              selectedSyncPtKeyRef.current = null;
              timelineRef.current?.clearHovered?.();
              return;
            }
          }
        }

        // Space: Play / Pause (or Shift+Space: Play active line)
        if (e.code === 'Space' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          if (e.target && typeof e.target.blur === 'function') {
            e.target.blur();
          }
          if (modalBoxRef.current && typeof modalBoxRef.current.focus === 'function') {
            modalBoxRef.current.focus();
          }
          if (e.shiftKey) {
            const curIdx = isTapModeRef.current ? activeTapIndexRef.current : selectedRowIndexRef.current;
            const curLines = linesRef.current;
            if (curIdx >= 0 && curLines[curIdx]) {
              const lineTime = typeof curLines[curIdx].time === 'number' ? curLines[curIdx].time : parseFloat(curLines[curIdx].time) || 0;
              handlePlayLine(lineTime);
            }
          } else {
            handleTogglePlayPause();
          }
          return;
        }

        // K: Stop & Rewind to 0
        if (e.key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          if (isPlayingForSongRef.current) {
            handleTogglePlayPause();
          }
          handleSeek(0);
          return;
        }

        // Enter: Stamp current line at playhead
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          if (e.target && typeof e.target.blur === 'function') {
            e.target.blur();
          }
          handleStampCurrentLine();
          return;
        }

        // ArrowUp / ArrowDown: Navigate lines & smooth scroll
        if (e.code === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          if (isTapModeRef.current) {
            handleStampCurrentLine();
          } else {
            const curIdx = selectedRowIndexRef.current;
            const curLines = linesRef.current;
            if (curIdx < curLines.length - 1) {
              const newIdx = curIdx + 1;
              setSelectedRowIndex(newIdx);
              scrollToLine(newIdx, 'nearest');
            }
          }
          return;
        }

        if (e.code === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          if (isTapModeRef.current) {
            if (activeTapIndexRef.current > 0) {
              const newIdx = activeTapIndexRef.current - 1;
              setActiveTapIndex(newIdx);
              setSelectedRowIndex(newIdx);
              if (linesRef.current[newIdx]) handleSeek(linesRef.current[newIdx].time);
            }
          } else {
            const curIdx = selectedRowIndexRef.current;
            if (curIdx > 0) {
              const newIdx = curIdx - 1;
              setSelectedRowIndex(newIdx);
              scrollToLine(newIdx, 'nearest');
            }
          }
          return;
        }

        // ArrowLeft / ArrowRight: Nudge timestamp by nudgeStep (or Shift+Arrow to seek 5s)
        if (e.code === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            const curTime = isSameSongRef.current
              ? usePlaybackStore.getState().getAccuratePlaybackTime()
              : (playbackTimeRef.current || 0);
            handleSeek(Math.max(0, curTime - 5));
          } else {
            const curIdx = isTapModeRef.current ? activeTapIndexRef.current : selectedRowIndexRef.current;
            if (curIdx >= 0) {
              handleTimeNudge(curIdx, -nudgeStepRef.current);
            }
          }
          return;
        }

        if (e.code === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            const curTime = isSameSongRef.current
              ? usePlaybackStore.getState().getAccuratePlaybackTime()
              : (playbackTimeRef.current || 0);
            const d = effectiveDurationRef.current || 0;
            handleSeek(Math.min(d, curTime + 5));
          } else {
            const curIdx = isTapModeRef.current ? activeTapIndexRef.current : selectedRowIndexRef.current;
            if (curIdx >= 0) {
              handleTimeNudge(curIdx, nudgeStepRef.current);
            }
          }
          return;
        }

        // < / , and > / .: Prev / Next line & seek (aligned with dashboard)
        if (e.key === '<' || e.key === ',') {
          e.preventDefault();
          e.stopPropagation();
          const curIdx = isTapModeRef.current ? activeTapIndexRef.current : selectedRowIndexRef.current;
          if (curIdx > 0) {
            const newIdx = curIdx - 1;
            if (isTapModeRef.current) setActiveTapIndex(newIdx);
            setSelectedRowIndex(newIdx);
            if (linesRef.current[newIdx]) handleSeek(linesRef.current[newIdx].time);
            scrollToLine(newIdx, 'nearest');
          }
          return;
        }

        if (e.key === '>' || e.key === '.') {
          e.preventDefault();
          e.stopPropagation();
          const curIdx = isTapModeRef.current ? activeTapIndexRef.current : selectedRowIndexRef.current;
          const curLines = linesRef.current;
          if (curIdx < curLines.length - 1) {
            const newIdx = curIdx + 1;
            if (isTapModeRef.current) setActiveTapIndex(newIdx);
            setSelectedRowIndex(newIdx);
            if (linesRef.current[newIdx]) handleSeek(linesRef.current[newIdx].time);
            scrollToLine(newIdx, 'nearest');
          }
          return;
        }

        // Timeline Zoom & Navigation shortcuts (preserve Cmd/Ctrl +/- for browser native zoom)
        if ((e.key === '+' || e.key === '=') && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          timelineRef.current?.zoomIn();
          return;
        }

        if ((e.key === '-' || e.key === '_') && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          timelineRef.current?.zoomOut();
          return;
        }

        if (e.key.toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          timelineRef.current?.zoomToActiveLine();
          return;
        }

        if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          timelineRef.current?.zoomFit();
          return;
        }

        // Toggle Shortcuts Help: ?
        if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
          timelineRef.current?.toggleShortcutsModal();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rawModalSong, song, isDirty, undoStack, redoStack]);

  if (!rawModalSong) return null;

  const songTitle = song?.title || (typeof rawModalSong === 'object' ? rawModalSong.title : 'Loading...');

  return (
    <div className="modal-backdrop" style={{ display: 'flex', zIndex: 3000 }} onClick={handleClose}>
      <div
        ref={modalBoxRef}
        tabIndex={-1}
        className="modal-box lyrics-sync-modal-box"
        style={{ outline: 'none' }}
        onClick={(e) => e.stopPropagation()}
        onScroll={(e) => {
          if (e.target === modalBoxRef.current && modalBoxRef.current.scrollTop !== 0) {
            modalBoxRef.current.scrollTop = 0;
          }
        }}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="sync-editor-title-wrap">
            <h3 style={{ margin: 0 }}>Lyrics &amp; Sync Editor: "{songTitle}"</h3>
            <span className={`sync-status-badge ${isDirty ? 'unsaved' : 'saved'}`}>
              <span className="sync-status-dot"></span>
              <span className="sync-status-text">{isDirty ? 'Unsaved' : 'Saved'}</span>
            </span>
          </div>
          <button className="btn-close" onClick={handleClose} title="Close / Back (Esc)"><i className="icon-x"></i></button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
            <i className="icon-loader-2 icon-spin" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}></i>
            <p>Loading song lyrics...</p>
          </div>
        ) : (
          <>
            {/* Visual Audio Spectrum & Timeline Editor */}
            <LyricsTimelineSpectrumEditor
              ref={timelineRef}
              song={song}
              lines={lines}
              selectedRowIndex={selectedRowIndex}
              onSelectRow={setSelectedRowIndex}
              onUpdateLineTime={handleUpdateLineTime}
              onAddLine={handleAddLine}
              playbackTime={playbackTime}
              isPlaying={isPlayingForSong}
              duration={effectiveDuration}
              onSeek={handleSeek}
              onTogglePlayPause={handleTogglePlayPause}
              nudgeStep={nudgeStep}
              onStampCurrentLine={handleStampCurrentLine}
              onUpdateSyncPointTime={handleSyncPointTimeChange}
              onUpdateSyncPointEndTime={handleSyncPointEndTimeChange}
              onUpdatePauseBounds={handleUpdatePauseBounds}
              isSameSong={isSameSong}
              selectedSyncPtKey={selectedSyncPtKey}
              onSelectSyncPoint={(key) => {
                setSelectedSyncPtKey(key);
                if (key) {
                  const parts = key.split('_');
                  const lIdx = parseInt(parts[0], 10);
                  if (!isNaN(lIdx)) {
                    setExpandedSyncRowIndex(lIdx);
                  }
                }
              }}
              onDeleteSyncPoint={handleDeleteSyncPoint}
              onRemovePause={handleRemovePause}
            />

            {/* Toolbar */}
            <div className="sync-toolbar">
              <div className="sync-toolbar-left">
                {/* Shift group with editable unit and - / + buttons */}
                <div className="sync-shift-group">
                  <span className="sync-shift-label">Shift:</span>
                  <button
                    type="button"
                    className="sync-shift-btn"
                    onClick={() => handleBulkShift(-nudgeStep)}
                    title={`Shift all earlier (-${nudgeStep}s)`}
                  >
                    <i className="icon-minus"></i>
                  </button>
                  <input
                    type="text"
                    className="sync-shift-input"
                    value={nudgeUnit}
                    onChange={(e) => setNudgeUnit(e.target.value)}
                    title="Adjustment unit in seconds"
                  />
                  <span className="sync-unit-label">(s)</span>
                  <button
                    type="button"
                    className="sync-shift-btn"
                    onClick={() => handleBulkShift(nudgeStep)}
                    title={`Shift all later (+${nudgeStep}s)`}
                  >
                    <i className="icon-plus"></i>
                  </button>
                </div>

                {/* Playback time tracker in mm:ss.cs */}
                <div className="sync-playback-tracker" title="Current Playback Time / Total Duration">
                  <span className="sync-tracker-icon"><i className="icon-clock"></i></span>
                  <span id="syncEditorCurTime">{formatCentiseconds(playbackTime)}</span>
                  <span className="sync-tracker-slash">/</span>
                  <span id="syncEditorDurTime">{formatCentiseconds(duration)}</span>
                </div>

                <span className="sync-line-count-badge">{lines.length} lines</span>
              </div>

              <div className="sync-toolbar-right">
                {/* Undo / Redo */}
                <div className="sync-btn-group">
                  <button
                    type="button"
                    className="sync-btn-icon"
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    title="Undo (Ctrl+Z)"
                  >
                    <i className="icon-undo-2"></i>
                  </button>
                  <button
                    type="button"
                    className="sync-btn-icon"
                    onClick={handleRedo}
                    disabled={redoStack.length === 0}
                    title="Redo (Ctrl+Y)"
                  >
                    <i className="icon-redo-2"></i>
                  </button>
                </div>

                <div className="sync-toolbar-divider"></div>

                {/* Column / Layer Toggles */}
                <div className="sync-btn-group">
                  <button
                    type="button"
                    className={`sync-btn-icon ${showTranslit ? 'active' : ''}`}
                    onClick={() => setShowTranslit(!showTranslit)}
                    title={showTranslit ? "Hide Pronunciation / Transliteration" : "Show Pronunciation / Transliteration"}
                  >
                    <i className="icon-ear"></i>
                  </button>
                  <button
                    type="button"
                    className={`sync-btn-icon ${showTranslat ? 'active' : ''}`}
                    onClick={() => setShowTranslat(!showTranslat)}
                    title={showTranslat ? "Hide Translation" : "Show Translation"}
                  >
                    <i className="icon-languages"></i>
                  </button>
                  <button
                    type="button"
                    className={`sync-btn-icon ${showPreciseSync ? 'active' : ''}`}
                    onClick={() => setShowPreciseSync(!showPreciseSync)}
                    title={showPreciseSync ? "Hide Precise Sync Timestamps (Word/Char)" : "Show Precise Sync Timestamps (Word/Char)"}
                  >
                    <i className="icon-timer"></i>
                  </button>
                </div>

                <div className="sync-toolbar-divider"></div>

                {/* Tap-to-Sync Mode Toggle */}
                <div className="sync-btn-group">
                  <button
                    type="button"
                    className={`sync-btn-icon sync-metronome-btn ${isTapMode ? 'active' : ''}`}
                    onClick={() => setIsTapMode(!isTapMode)}
                    title={isTapMode ? "Exit Tap-to-Sync" : "Tap-to-Sync Mode"}
                  >
                    <i className="icon-clock"></i>
                  </button>
                </div>

                <div className="sync-toolbar-divider"></div>

                {/* AI Whisper Auto-Sync */}
                <div className="sync-btn-group sync-ai-toolbar-group">
                  <select
                    className="sync-nudge-select"
                    value={aiPrecision}
                    onChange={(e) => setAiPrecision(e.target.value)}
                    title="AI Auto-Sync Precision"
                    disabled={isAutoSyncing}
                  >
                    <option value="word">Word Precision</option>
                    <option value="line">Line Precision</option>
                  </select>
                  <button
                    type="button"
                    className="sync-btn-icon sync-ai-trigger-btn"
                    onClick={handleTriggerAutoSync}
                    disabled={isAutoSyncing || !song?.id}
                    title={`Run AI Auto-Sync (${aiPrecision === 'word' ? 'Word-by-Word' : 'Line-by-Line'})`}
                  >
                    {isAutoSyncing ? (
                      <i className="icon-loader-2 icon-spin" style={{ color: '#c084fc' }}></i>
                    ) : (
                      <i className="icon-sparkles" style={{ color: '#38bdf8' }}></i>
                    )}
                  </button>
                </div>

                <div className="sync-toolbar-divider"></div>

                {/* Save Button */}
                <div className="sync-btn-group">
                  <button
                    type="button"
                    className="sync-btn-icon sync-save-btn"
                    onClick={handleSave}
                    disabled={isSaving || !isDirty}
                    title="Save Lyrics & Sync (Ctrl+S)"
                  >
                    <i className="icon-save"></i>
                  </button>
                </div>
              </div>
            </div>

            {/* Tap-to-Sync Active Banner */}
            {isTapMode && (
              <div className="sync-tap-banner">
                <span className="sync-tap-banner-text">
                  <strong>Tap-to-Sync Active:</strong> Row {activeTapIndex + 1} of {lines.length} |
                  Press <strong>ArrowDown</strong> to stamp &amp; advance, <strong>ArrowUp</strong> to seek back,
                  <strong>ArrowLeft / Right</strong> to nudge by ±{nudgeStep}s.
                </span>
                <button
                  type="button"
                  className="btn btn-primary sync-tap-stamp-btn"
                  onClick={handleStampCurrentLine}
                >
                  <i className="icon-check" style={{ marginRight: '0.25rem' }}></i>
                  Stamp [<span id="syncTapStampBtnTime">{formatCentiseconds(playbackTime)}</span>] &amp; Next (Row {activeTapIndex + 1})
                </button>
              </div>
            )}

            {/* Column Headers */}
            <div className="sync-col-headers">
              <div className="sync-col-hdr sync-col-play"></div>
              <div
                className="sync-col-hdr sync-col-time"
                title="Minutes:Seconds.Centiseconds (mm:ss.cs)"
              >
                Time (mm:ss.cs)
              </div>
              <div className="sync-col-hdr sync-col-text">Lyrics</div>
              {showTranslit && <div className="sync-col-hdr sync-col-tl">Transliteration</div>}
              {showTranslat && <div className="sync-col-hdr sync-col-tr">Translation</div>}
              <div className="sync-col-hdr sync-col-actions"></div>
            </div>

            {/* Rows List */}
            <ScrollShadowWrapper className="sync-editor-scroll-wrapper">
              <div className="sync-editor-list">
              {lines.length === 0 ? (
                <div className="sync-empty-state">
                  <p>No lyrics found for this song.</p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleAddLine(-1)}
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <i className="icon-plus"></i> Add First Line
                  </button>
                </div>
              ) : (
                lines.map((line, idx) => {
                  const isSel = selectedRowIndex === idx || (isTapMode && activeTapIndex === idx);
                  const isPreciseOpen = showPreciseSync || expandedSyncRowIndex === idx;
                  const lineText = line.text || '';
                  const isRtl = isRtlText(lineText);
                  const pts = Array.isArray(line.syncPoints) ? line.syncPoints : [];

                  return (
                    <div
                      key={line.id || idx}
                      id={`sync-line-${idx}`}
                      className={`sync-row-card sync-row-wrapper ${isSel ? 'is-selected' : ''}`}
                      onClick={() => {
                        setSelectedRowIndex(idx);
                        if (isTapMode) setActiveTapIndex(idx);
                      }}
                    >
                      {/* Strip button to add line above */}
                      <button
                        type="button"
                        className="btn-add-line-strip btn-add-line-top"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddLine(idx - 1);
                        }}
                        title="Add line above"
                      >
                        <i className="icon-plus"></i> <span>Add line above</span>
                      </button>

                      <div className="sync-editor-row">
                        {/* Play Button */}
                        <button
                          type="button"
                          className="sync-line-play-btn sync-col-play"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayLine(line.time);
                          }}
                          title="Jump audio to this line"
                        >
                          <i className="icon-play"></i>
                        </button>

                        {/* Minus Icon Button */}
                        <button
                          type="button"
                          className="sync-shift-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTimeNudge(idx, -nudgeStep);
                          }}
                          title={`Nudge line earlier (-${nudgeStep}s)`}
                        >
                          <i className="icon-minus"></i>
                        </button>

                        {/* Time Input in MM:SS.cs */}
                        <input
                          type="text"
                          inputMode="decimal"
                          className="sync-time sync-col-time"
                          value={timeStrings[idx] !== undefined ? timeStrings[idx] : formatCentiseconds(line.time)}
                          onChange={(e) => handleTimeInputChange(idx, e.target.value)}
                          onBlur={() => handleTimeInputCommit(idx)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.target.blur();
                            }
                          }}
                          title="Time (mm:ss.cs)"
                        />

                        {/* Plus Icon Button */}
                        <button
                          type="button"
                          className="sync-shift-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTimeNudge(idx, nudgeStep);
                          }}
                          title={`Nudge line later (+${nudgeStep}s)`}
                        >
                          <i className="icon-plus"></i>
                        </button>

                        {/* Lyrics Text with #INSTRUMENTAL placeholder */}
                        <input
                          type="text"
                          className="sync-text sync-col-text"
                          value={line.text}
                          dir={isRtl ? 'rtl' : 'ltr'}
                          placeholder="#INSTRUMENTAL"
                          onChange={(e) => handleLineChange(idx, 'text', e.target.value)}
                        />

                        {/* Transliteration Column */}
                        {showTranslit && (
                          <input
                            type="text"
                            className="sync-tl sync-col-tl"
                            value={line.transliteration || ''}
                            placeholder="Transliteration..."
                            onChange={(e) => handleLineChange(idx, 'transliteration', e.target.value)}
                          />
                        )}

                        {/* Translation Column */}
                        {showTranslat && (
                          <input
                            type="text"
                            className="sync-tr sync-col-tr"
                            value={line.translation || ''}
                            placeholder="Translation..."
                            onChange={(e) => handleLineChange(idx, 'translation', e.target.value)}
                          />
                        )}

                        {/* Precise Word Sync Toggle on this line */}
                        <button
                          type="button"
                          className={`sync-sub-toggle-btn ${isPreciseOpen ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedSyncRowIndex(expandedSyncRowIndex === idx ? null : idx);
                          }}
                          title={isPreciseOpen ? "Hide precise sync timestamps" : "View/Edit precise word & pause timestamps"}
                        >
                          <i className="icon-timer"></i>
                          {pts.length > 0 && (
                            <span className="sync-pts-badge">{pts.length}</span>
                          )}
                        </button>

                        {/* Delete Line */}
                        <button
                          type="button"
                          className="sync-del-btn sync-col-actions"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteLine(idx);
                          }}
                          title="Delete line"
                        >
                          <i className="icon-x"></i>
                        </button>
                      </div>

                      {/* Precise Sync Section inside the same card */}
                      {isPreciseOpen && !line.isInstrumental && lineText.trim() !== '' && (() => {
                        const { words, pauses } = getLineWordPairsWithPauses(lineText, pts, line.time, line.endTime);

                        return (
                          <div className={`sync-card-precise-section sync-cursor-bar ${isRtl ? 'rtl' : 'ltr'}`} dir={isRtl ? 'rtl' : 'ltr'}>
                            <div className="sync-cursor-bar-header">
                              <span className="sync-cursor-bar-label">
                                <i className="icon-timer"></i>
                                <span>Precise Sync:</span>
                              </span>
                              <span className="sync-cursor-count-badge">
                                {words.filter((w) => w.hasPoint).length} words, {pauses.length} pause{pauses.length === 1 ? '' : 's'}
                              </span>
                            </div>

                            <div className="sync-cursor-tokens">
                              {/* Intro pause before the first word */}
                              {(() => {
                                const introPause = pauses.find((p) => p.slot === -1);
                                if (!introPause) return null;
                                const isSelectedPause = selectedSyncPtKey === `${idx}_pause_pre_0` ||
                                  (introPause.ptIndex >= 0 && selectedSyncPtKey === `${idx}_${introPause.ptIndex}`);

                                return (
                                  <button
                                    key="pause_pre_0"
                                    type="button"
                                    className={`sync-cursor-chip is-pause ${isSelectedPause ? 'is-selected' : ''}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const key = introPause.ptIndex >= 0 ? `${idx}_${introPause.ptIndex}` : `${idx}_pause_pre_0`;
                                      setSelectedSyncPtKey(isSelectedPause ? null : key);
                                    }}
                                    title={`Intro Pause: ${formatCentiseconds(introPause.startTime)} → ${formatCentiseconds(introPause.endTime)} (${introPause.duration}s)`}
                                  >
                                    <i className="icon-pause" style={{ fontSize: '0.62rem' }}></i>
                                    <span>⏸ {introPause.duration}s</span>
                                  </button>
                                );
                              })()}

                              {words.map((w, wIdx) => {
                                const isSelectedWord = (w.ptIndex >= 0 && selectedSyncPtKey === `${idx}_${w.ptIndex}`) ||
                                  selectedSyncPtKey === `${idx}_word_${w.index}`;
                                const pauseAfter = pauses.find((p) => p.prevWordIndex === wIdx);
                                const isSelectedPause = pauseAfter && (
                                  (pauseAfter.ptIndex >= 0 && selectedSyncPtKey === `${idx}_${pauseAfter.ptIndex}`) ||
                                  selectedSyncPtKey === `${idx}_pause_${wIdx}` ||
                                  selectedSyncPtKey === pauseAfter.id
                                );

                                return (
                                  <React.Fragment key={wIdx}>
                                    {/* Word Start Timestamp Chip */}
                                    <button
                                      type="button"
                                      className={`sync-cursor-chip ${w.hasPoint ? 'has-point' : 'ghost'} ${isSelectedWord ? 'is-selected' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (w.hasPoint) {
                                          setSelectedSyncPtKey(isSelectedWord ? null : `${idx}_${w.ptIndex}`);
                                        } else {
                                          handleAddSyncPoint(idx, w.charIndex, w.text);
                                        }
                                      }}
                                      title={w.hasPoint ? `Word start: ${formatCentiseconds(w.time)} (Click to edit, Delete to clear)` : `Stamp word "${w.text}" at current time`}
                                    >
                                      {w.hasPoint ? (
                                        <>
                                          <i className="icon-play" style={{ fontSize: '0.62rem' }}></i>
                                          <span>{formatCentiseconds(w.time)}</span>
                                        </>
                                      ) : (
                                        <span className="ghost-add">+</span>
                                      )}
                                    </button>

                                    {/* Word Text Token */}
                                    <span
                                      className={`sync-word-token ${isSelectedWord ? 'is-selected-text' : ''}`}
                                      onClick={() => {
                                        if (w.hasPoint) setSelectedSyncPtKey(`${idx}_${w.ptIndex}`);
                                        else handleAddSyncPoint(idx, w.charIndex, w.text);
                                      }}
                                    >
                                      {w.text}
                                    </span>

                                    {/* Pause Slot between Word wIdx and Word wIdx + 1 */}
                                    {wIdx < words.length - 1 && (
                                      pauseAfter ? (
                                        <button
                                          type="button"
                                          className={`sync-cursor-chip is-pause ${isSelectedPause ? 'is-selected' : ''}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const key = pauseAfter.ptIndex >= 0 ? `${idx}_${pauseAfter.ptIndex}` : `${idx}_pause_${wIdx}`;
                                            setSelectedSyncPtKey(isSelectedPause ? null : key);
                                          }}
                                          title={`Pause between "${w.text}" and "${words[wIdx + 1]?.text}": ${formatCentiseconds(pauseAfter.startTime)} → ${formatCentiseconds(pauseAfter.endTime)} (${pauseAfter.duration}s) - Click to edit two timestamps`}
                                        >
                                          <i className="icon-pause" style={{ fontSize: '0.62rem' }}></i>
                                          <span>⏸ {pauseAfter.duration}s</span>
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          className="sync-cursor-add-pause"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleAddPauseBetween(idx, wIdx, wIdx + 1);
                                          }}
                                          title={`Add pause between "${w.text}" and "${words[wIdx + 1]?.text}"`}
                                        >
                                          <span className="add-pause-plus">+</span>
                                          <span className="add-pause-icon">⏸</span>
                                        </button>
                                      )
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </div>

                            {/* Mini toolbar when a sync point or pause is selected */}
                            {selectedSyncPtKey && selectedSyncPtKey.startsWith(`${idx}_`) && (() => {
                              let selPause = null;
                              let selWord = null;

                              if (selectedSyncPtKey.includes('pause')) {
                                selPause = pauses.find((p) => p.id === selectedSyncPtKey ||
                                  `${idx}_pause_${p.prevWordIndex}` === selectedSyncPtKey ||
                                  selectedSyncPtKey.includes(`pause_${p.prevWordIndex}`));
                              } else {
                                const pIdx = parseInt(selectedSyncPtKey.split('_')[1], 10);
                                if (!isNaN(pIdx) && pts[pIdx]) {
                                  selWord = words.find((w) => w.ptIndex === pIdx) || words[pIdx] || {
                                    text: pts[pIdx].text || 'word',
                                    time: pts[pIdx].time,
                                    endTime: pts[pIdx].endTime,
                                    ptIndex: pIdx
                                  };
                                }
                              }

                              if (selPause) {
                                return (
                                  <div className="sync-pt-mini-toolbar is-pause-tb" onClick={(e) => e.stopPropagation()}>
                                    {/* Header Row: Title, Duration Badge, Quick Nudges, and Actions */}
                                    <div className="mini-tb-header">
                                      <div className="mini-tb-header-left">
                                        <span className="mini-tb-badge-icon">⏸</span>
                                        <span className="mini-tb-title">
                                          Pause: <strong>"{selPause.prevWord?.text || 'start'}"</strong> ↔ <strong>"{selPause.nextWord?.text || 'end'}"</strong>
                                        </span>
                                        <span className="mini-tb-dur-badge" title="Automatically calculated duration">
                                          {selPause.duration}s
                                        </span>
                                      </div>

                                      <div className="mini-tb-header-right">
                                        <div className="mini-tb-gap-nudges" title="Quick duration gap adjusters">
                                          <button type="button" className="mini-tb-gap-btn" onClick={() => handleAdjustPauseGap(idx, selPause, -0.5)} title="-0.5s duration">-0.5s</button>
                                          <button type="button" className="mini-tb-gap-btn" onClick={() => handleAdjustPauseGap(idx, selPause, -0.1)} title="-0.1s duration">-0.1s</button>
                                          <button type="button" className="mini-tb-gap-btn" onClick={() => handleAdjustPauseGap(idx, selPause, 0.1)} title="+0.1s duration">+0.1s</button>
                                          <button type="button" className="mini-tb-gap-btn" onClick={() => handleAdjustPauseGap(idx, selPause, 0.5)} title="+0.5s duration">+0.5s</button>
                                        </div>

                                        <button
                                          type="button"
                                          className="mini-tb-action-btn is-warning"
                                          onClick={() => {
                                            handleRemovePauseBetween(idx, selPause);
                                            setSelectedSyncPtKey(null);
                                          }}
                                          title="Remove pause gap (words become continuous, Delete key)"
                                        >
                                          <i className="icon-play"></i>
                                          <span>Remove</span>
                                        </button>

                                        <button
                                          type="button"
                                          className="mini-tb-close-btn"
                                          onClick={() => setSelectedSyncPtKey(null)}
                                          title="Close toolbar (Esc)"
                                        >
                                          <i className="icon-x"></i>
                                        </button>
                                      </div>
                                    </div>

                                    {/* Controls Row: Start Stepper → Arrow → End Stepper */}
                                    <div className="mini-tb-body">
                                      {/* Pause Start */}
                                      <div className="mini-tb-ts-group" title={`Pause Start (${selPause.prevWord ? `"${selPause.prevWord.text}" finishes` : 'start'})`}>
                                        <span className="mini-tb-ts-tag">Start</span>
                                        <div className="mini-tb-stepper">
                                          <button
                                            type="button"
                                            className="mini-tb-step-btn"
                                            onClick={() => handleSetPauseStart(idx, selPause, selPause.startTime - nudgeStep)}
                                            title={`-${nudgeStep}s`}
                                          >
                                            <i className="icon-minus"></i>
                                          </button>
                                          <input
                                            type="text"
                                            className="sync-pt-time-input"
                                            value={formatCentiseconds(selPause.startTime)}
                                            onChange={(e) => {
                                              const parsed = parseCentiseconds(e.target.value);
                                              handleSetPauseStart(idx, selPause, parsed);
                                            }}
                                            title="Pause start timestamp"
                                          />
                                          <button
                                            type="button"
                                            className="mini-tb-step-btn"
                                            onClick={() => handleSetPauseStart(idx, selPause, selPause.startTime + nudgeStep)}
                                            title={`+${nudgeStep}s`}
                                          >
                                            <i className="icon-plus"></i>
                                          </button>
                                        </div>
                                        <button
                                          type="button"
                                          className="mini-tb-stamp-btn"
                                          onClick={() => handleSetPauseStart(idx, selPause, playbackTime)}
                                          title="Stamp at playhead"
                                        >
                                          <i className="icon-check"></i> Stamp
                                        </button>
                                      </div>

                                      {/* Connector Arrow */}
                                      <div className="mini-tb-arrow-divider" title={`Pause Duration: ${selPause.duration}s`}>
                                        →
                                      </div>

                                      {/* Pause End */}
                                      <div className="mini-tb-ts-group" title={`Pause End (${selPause.nextWord ? `"${selPause.nextWord.text}" begins` : 'end'})`}>
                                        <span className="mini-tb-ts-tag">End</span>
                                        <div className="mini-tb-stepper">
                                          <button
                                            type="button"
                                            className="mini-tb-step-btn"
                                            onClick={() => handleSetPauseEnd(idx, selPause, selPause.endTime - nudgeStep)}
                                            title={`-${nudgeStep}s`}
                                          >
                                            <i className="icon-minus"></i>
                                          </button>
                                          <input
                                            type="text"
                                            className="sync-pt-time-input"
                                            value={formatCentiseconds(selPause.endTime)}
                                            onChange={(e) => {
                                              const parsed = parseCentiseconds(e.target.value);
                                              handleSetPauseEnd(idx, selPause, parsed);
                                            }}
                                            title="Pause end timestamp"
                                          />
                                          <button
                                            type="button"
                                            className="mini-tb-step-btn"
                                            onClick={() => handleSetPauseEnd(idx, selPause, selPause.endTime + nudgeStep)}
                                            title={`+${nudgeStep}s`}
                                          >
                                            <i className="icon-plus"></i>
                                          </button>
                                        </div>
                                        <button
                                          type="button"
                                          className="mini-tb-stamp-btn"
                                          onClick={() => handleSetPauseEnd(idx, selPause, playbackTime)}
                                          title="Stamp at playhead"
                                        >
                                          <i className="icon-check"></i> Stamp
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              }

                              if (selWord) {
                                const wordDur = selWord.endTime && selWord.endTime > selWord.time
                                  ? Math.round((selWord.endTime - selWord.time) * 100) / 100
                                  : 0.4;

                                return (
                                  <div className="sync-pt-mini-toolbar is-word-tb" onClick={(e) => e.stopPropagation()}>
                                    {/* Header Row: Title, Duration Badge, and Actions */}
                                    <div className="mini-tb-header">
                                      <div className="mini-tb-header-left">
                                        <span className="mini-tb-badge-icon">🔤</span>
                                        <span className="mini-tb-title">
                                          Word: <strong>"{selWord.text}"</strong>
                                        </span>
                                        <span className="mini-tb-dur-badge" title="Word duration">
                                          {wordDur}s
                                        </span>
                                      </div>

                                      <div className="mini-tb-header-right">
                                        <button
                                          type="button"
                                          className="mini-tb-action-btn is-danger"
                                          onClick={() => {
                                            handleDeleteSyncPoint(idx, selWord.ptIndex);
                                            setSelectedSyncPtKey(null);
                                          }}
                                          title="Clear word timestamp (Delete / Backspace)"
                                        >
                                          <i className="icon-x"></i>
                                          <span>Clear</span>
                                        </button>

                                        <button
                                          type="button"
                                          className="mini-tb-close-btn"
                                          onClick={() => setSelectedSyncPtKey(null)}
                                          title="Close toolbar (Esc)"
                                        >
                                          <i className="icon-x"></i>
                                        </button>
                                      </div>
                                    </div>

                                    {/* Controls Row: Word Start Stepper → Arrow → Word End Stepper */}
                                    <div className="mini-tb-body">
                                      {/* Word Start */}
                                      <div className="mini-tb-ts-group" title={`Word Start ("${selWord.text}" begins)`}>
                                        <span className="mini-tb-ts-tag">Start</span>
                                        <div className="mini-tb-stepper">
                                          <button
                                            type="button"
                                            className="mini-tb-step-btn"
                                            onClick={() => handleSyncPointNudge(idx, selWord.ptIndex, -nudgeStep)}
                                            title={`-${nudgeStep}s`}
                                          >
                                            <i className="icon-minus"></i>
                                          </button>
                                          <input
                                            type="text"
                                            className="sync-pt-time-input"
                                            value={formatCentiseconds(selWord.time)}
                                            onChange={(e) => {
                                              const parsed = parseCentiseconds(e.target.value);
                                              handleSyncPointTimeChange(idx, selWord.ptIndex, parsed);
                                            }}
                                            title="Word start timestamp"
                                          />
                                          <button
                                            type="button"
                                            className="mini-tb-step-btn"
                                            onClick={() => handleSyncPointNudge(idx, selWord.ptIndex, nudgeStep)}
                                            title={`+${nudgeStep}s`}
                                          >
                                            <i className="icon-plus"></i>
                                          </button>
                                        </div>
                                        <button
                                          type="button"
                                          className="mini-tb-stamp-btn"
                                          onClick={() => handleSyncPointTimeChange(idx, selWord.ptIndex, playbackTime)}
                                          title="Stamp at playhead"
                                        >
                                          <i className="icon-check"></i> Stamp
                                        </button>
                                      </div>

                                      {/* Connector Arrow */}
                                      <div className="mini-tb-arrow-divider" title={`Word Duration: ${wordDur}s`}>
                                        →
                                      </div>

                                      {/* Word End */}
                                      <div className="mini-tb-ts-group" title={`Word End ("${selWord.text}" finishes)`}>
                                        <span className="mini-tb-ts-tag">End</span>
                                        <div className="mini-tb-stepper">
                                          <button
                                            type="button"
                                            className="mini-tb-step-btn"
                                            onClick={() => handleWordEndTimeNudge(idx, selWord.ptIndex, -nudgeStep)}
                                            title={`-${nudgeStep}s`}
                                          >
                                            <i className="icon-minus"></i>
                                          </button>
                                          <input
                                            type="text"
                                            className="sync-pt-time-input"
                                            value={formatCentiseconds(selWord.endTime || selWord.time + 0.4)}
                                            onChange={(e) => {
                                              const parsed = parseCentiseconds(e.target.value);
                                              handleWordEndTimeChange(idx, selWord.ptIndex, parsed);
                                            }}
                                            title="Word end timestamp"
                                          />
                                          <button
                                            type="button"
                                            className="mini-tb-step-btn"
                                            onClick={() => handleWordEndTimeNudge(idx, selWord.ptIndex, nudgeStep)}
                                            title={`+${nudgeStep}s`}
                                          >
                                            <i className="icon-plus"></i>
                                          </button>
                                        </div>
                                        <button
                                          type="button"
                                          className="mini-tb-stamp-btn"
                                          onClick={() => handleWordEndTimeChange(idx, selWord.ptIndex, playbackTime)}
                                          title="Stamp at playhead"
                                        >
                                          <i className="icon-check"></i> Stamp
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              }

                              return null;
                            })()}

                            <div className="sync-cursor-bar-actions">
                              <button
                                type="button"
                                className="sync-btn-sub sync-btn-auto-split"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAutoGenerateWordSyncPoints(idx);
                                }}
                                title="Auto-generate evenly spaced word timestamps"
                              >
                                <i className="icon-wand-2"></i> Auto Words
                              </button>
                              <button
                                type="button"
                                className={`sync-btn-sub ${showNestedTableIndex === idx ? 'active' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowNestedTableIndex(showNestedTableIndex === idx ? null : idx);
                                }}
                                title="Toggle table breakdown"
                              >
                                <i className="icon-timer"></i> {showNestedTableIndex === idx ? 'Hide Table' : 'Table View'}
                              </button>
                            </div>

                            {/* Expandable Nested Table breakdown inside the same card */}
                            {showNestedTableIndex === idx && (
                              <div className="sync-nested-drawer">
                                <div className="sync-nested-drawer-header">
                                  <span>
                                    <strong>Nested Timestamps Table</strong> ({pts.length} sync points)
                                  </span>
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-secondary"
                                    onClick={() => handleAddSyncPoint(idx, 0, '', playbackTime)}
                                  >
                                    <i className="icon-plus"></i> Add Point at [{formatCentiseconds(playbackTime)}]
                                  </button>
                                </div>
                                <div className="sync-nested-table">
                                    <div className="sync-nested-hdr-row">
                                      <div>#</div>
                                      <div>Word</div>
                                      <div>Char Pos</div>
                                      <div>Start Time (Default)</div>
                                      <div>End Time (Optional)</div>
                                      <div>Actions</div>
                                    </div>
                                    {pts.length === 0 ? (
                                      <div className="sync-nested-empty">
                                        <span>No word timestamps yet. Click "+ Add Point" or "Auto Words".</span>
                                      </div>
                                    ) : (
                                      pts.map((pt, pIdx) => {
                                        const nextPt = pIdx < pts.length - 1 ? pts[pIdx + 1] : null;
                                        const hasEnd = typeof pt.endTime === 'number';
                                        const hasPause = hasEnd && nextPt && pt.endTime < (nextPt.time - 0.05);
                                        const pauseDur = hasPause ? Math.max(0.05, Math.round((nextPt.time - pt.endTime) * 100) / 100) : null;

                                        return (
                                          <div key={pIdx} className="sync-nested-row">
                                            <div>#{pIdx + 1}</div>
                                            <div>
                                              <span className="sync-nested-tag tag-word">
                                                {pt.text || 'word'}
                                              </span>
                                            </div>
                                            <div>Char #{pt.charIndex ?? 0}</div>
                                            <div>
                                              <input
                                                type="text"
                                                className="sync-nested-time-input"
                                                value={formatCentiseconds(pt.time)}
                                                onChange={(e) => {
                                                  const val = parseCentiseconds(e.target.value);
                                                  handleSyncPointTimeChange(idx, pIdx, val);
                                                }}
                                                title="Word start timestamp (default)"
                                              />
                                            </div>
                                            <div className="sync-nested-dur-cell">
                                              {hasEnd ? (
                                                <div className="sync-nested-endtime-group">
                                                  <input
                                                    type="text"
                                                    className="sync-nested-time-input is-endtime"
                                                    value={formatCentiseconds(pt.endTime)}
                                                    onChange={(e) => {
                                                      const val = parseCentiseconds(e.target.value);
                                                      handleWordEndTimeChange(idx, pIdx, val);
                                                    }}
                                                    title="Word end timestamp"
                                                  />
                                                  {hasPause && (
                                                    <span className="sync-nested-pause-badge" title={`Pause duration before "${nextPt?.text || 'next word'}"`}>
                                                      ⏸ {pauseDur}s
                                                    </span>
                                                  )}
                                                  <button
                                                    type="button"
                                                    className="btn btn-xs btn-outline sync-clear-end-btn"
                                                    onClick={() => handleWordEndTimeChange(idx, pIdx, null)}
                                                    title="Clear end time (continuous to next word)"
                                                  >
                                                    ✕
                                                  </button>
                                                </div>
                                              ) : (
                                                <div className="sync-nested-continuous">
                                                  <span className="sync-nested-no-pause">Continuous</span>
                                                  {nextPt && (
                                                    <button
                                                      type="button"
                                                      className="btn btn-xs btn-outline sync-set-end-btn"
                                                      onClick={() => {
                                                        const earlyEnd = Math.max(pt.time + 0.1, Math.round((nextPt.time - 0.4) * 100) / 100);
                                                        handleWordEndTimeChange(idx, pIdx, earlyEnd);
                                                      }}
                                                      title="Set earlier end time to create a pause before next word"
                                                    >
                                                      + ⏸
                                                    </button>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                            <div className="sync-nested-actions">
                                              <button
                                                type="button"
                                                className="btn btn-xs btn-outline"
                                                onClick={() => handleSyncPointNudge(idx, pIdx, -nudgeStep)}
                                                title={`-${nudgeStep}s`}
                                              >
                                                <i className="icon-minus"></i>
                                              </button>
                                              <button
                                                type="button"
                                                className="btn btn-xs btn-outline"
                                                onClick={() => handleSyncPointNudge(idx, pIdx, nudgeStep)}
                                                title={`+${nudgeStep}s`}
                                              >
                                                <i className="icon-plus"></i>
                                              </button>
                                              <button
                                                type="button"
                                                className="btn btn-xs btn-danger"
                                                onClick={() => handleDeleteSyncPoint(idx, pIdx)}
                                                title="Delete word timestamp (Delete / Backspace)"
                                              >
                                                <i className="icon-x"></i>
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })
                                    )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Strip button to add line below */}
                      <button
                        type="button"
                        className="btn-add-line-strip btn-add-line-bottom"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddLine(idx);
                        }}
                        title="Add line below"
                      >
                        <i className="icon-plus"></i> <span>Add line below</span>
                      </button>
                    </div>
                  );
                })
              )}
              </div>
            </ScrollShadowWrapper>
          </>
        )}
      </div>
    </div>
  );
}
