import React, { useEffect, useState, useRef, useCallback } from 'react';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useModalStore } from '../../stores/useModalStore';
import * as audioPlayer from '../../services/audioPlayer';
import { formatTime } from '../../utils/themeColors';
import { isRtlText } from '../../utils/lyricsWrapping';
import VisualizerCanvas from '../display/VisualizerCanvas';

/**
 * Pure, safe helper to determine active lyric index and karaoke progress percentage.
 * Protected against undefined/null objects, NaN times, or mutated arrays.
 */
function getActiveLyricInfo(time, lyricsList, songDuration) {
  if (!Array.isArray(lyricsList) || lyricsList.length === 0) {
    return { activeIndex: -1, currentLyric: null, progress: 0 };
  }

  const validTime = typeof time === 'number' && !isNaN(time) ? Math.max(0, time) : 0;
  let activeIndex = -1;

  for (let i = 0; i < lyricsList.length; i++) {
    const item = lyricsList[i];
    if (!item) continue;
    const itemTime = typeof item.time === 'number' ? item.time : parseFloat(item.time);
    if (!isNaN(itemTime) && validTime >= itemTime) {
      activeIndex = i;
    } else if (!isNaN(itemTime) && validTime < itemTime) {
      break;
    }
  }

  if (activeIndex < 0) {
    return { activeIndex: -1, currentLyric: null, progress: 0 };
  }

  const currentLyric = lyricsList[activeIndex];
  if (!currentLyric) {
    return { activeIndex: -1, currentLyric: null, progress: 0 };
  }

  const start = typeof currentLyric.time === 'number'
    ? currentLyric.time
    : (parseFloat(currentLyric.time) || 0);

  let end;
  if (activeIndex < lyricsList.length - 1 && lyricsList[activeIndex + 1]) {
    const nextLine = lyricsList[activeIndex + 1];
    const nextStart = typeof nextLine.time === 'number'
      ? nextLine.time
      : (parseFloat(nextLine.time) || 0);
    end = nextStart > start ? nextStart : start + 3;
  } else {
    const dur = typeof songDuration === 'number' && songDuration > 0 ? songDuration : start + 6;
    end = dur > start ? dur : start + 6;
  }

  const lineDur = Math.max(0.3, end - start);
  let progress = 0;
  if (validTime <= start) {
    progress = 0;
  } else if (validTime >= end) {
    progress = 100;
  } else {
    progress = Math.min(100, Math.max(0, ((validTime - start) / lineDur) * 100));
  }

  return { activeIndex, currentLyric, progress };
}

export default function PlaybackControls() {
  const openLyricsSyncModal = useModalStore((state) => state.openLyricsSyncModal);
  const currentSong = usePlaybackStore((state) => state.currentSong);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const duration = usePlaybackStore((state) => state.duration);
  const showKaraokeSlide = usePlaybackStore((state) => state.showKaraokeSlide);
  const showWaveform = usePlaybackStore((state) => state.showWaveform);
  const audioMaster = usePlaybackStore((state) => state.audioMaster);

  const togglePlayPause = usePlaybackStore((state) => state.togglePlayPause);
  const playNext = usePlaybackStore((state) => state.playNext);
  const playPrev = usePlaybackStore((state) => state.playPrev);
  const jumpToNextLine = usePlaybackStore((state) => state.jumpToNextLine);
  const jumpToPrevLine = usePlaybackStore((state) => state.jumpToPrevLine);
  const seek = usePlaybackStore((state) => state.seek);
  const setDraggingSlider = usePlaybackStore((state) => state.setDraggingSlider);

  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const [sliderTime, setSliderTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showRemaining, setShowRemaining] = useState(false);

  const animFrameRef = useRef(null);
  const lyricPreviewRef = useRef(null);
  const sliderRef = useRef(null);
  const timeCurrentRef = useRef(null);
  const timeTotalRef = useRef(null);
  const showRemainingRef = useRef(showRemaining);
  showRemainingRef.current = showRemaining;

  // High-precision sync anchor when audioMaster is display (or remote)
  const syncAnchorRef = useRef({ time: 0, timestamp: performance.now(), isPlaying: false });
  const activeIndexRef = useRef(-1);

  // Subscribe to store updates without triggering 10Hz React component re-renders
  useEffect(() => {
    const unsub = usePlaybackStore.subscribe((state, prevState) => {
      const safeTime = typeof state.currentTime === 'number' && !isNaN(state.currentTime) ? state.currentTime : 0;
      const now = performance.now();

      if (state.audioMaster === 'display') {
        if (state.isPlaying) {
          const curAnchor = syncAnchorRef.current;
          if (curAnchor.isPlaying) {
            const estimated = curAnchor.time + (now - curAnchor.timestamp) / 1000;
            const delta = safeTime - estimated;
            if (Math.abs(delta) > 0.45) {
              curAnchor.time = safeTime;
              curAnchor.timestamp = now;
            }
          } else {
            curAnchor.time = safeTime;
            curAnchor.timestamp = now;
            curAnchor.isPlaying = true;
          }
        } else {
          syncAnchorRef.current.time = safeTime;
          syncAnchorRef.current.timestamp = now;
          syncAnchorRef.current.isPlaying = false;
        }
      } else {
        syncAnchorRef.current.time = safeTime;
        syncAnchorRef.current.timestamp = now;
        syncAnchorRef.current.isPlaying = state.isPlaying;
      }

      // If audio is paused and user is not dragging, sync DOM slider & timestamps
      if (!state.isPlaying && !isDragging) {
        const maxDur = typeof state.duration === 'number' && state.duration > 0 ? state.duration : 0;
        const bounded = maxDur > 0 ? Math.min(maxDur, safeTime) : safeTime;
        if (sliderRef.current) sliderRef.current.value = bounded;
        if (timeCurrentRef.current) timeCurrentRef.current.textContent = formatTime(bounded);
        if (timeTotalRef.current) {
          timeTotalRef.current.textContent = showRemainingRef.current
            ? (maxDur > 0 ? `-${formatTime(Math.max(0, maxDur - bounded))}` : '--:--')
            : (maxDur > 0 ? formatTime(maxDur) : '--:--');
        }
      }
    });

    return unsub;
  }, [isDragging]);

  // Reset active line index tracking when currentSong changes
  useEffect(() => {
    activeIndexRef.current = -1;
    setActiveLineIndex(-1);
    if (lyricPreviewRef.current) {
      lyricPreviewRef.current.style.removeProperty('--karaoke-progress');
    }
    const safeTime = usePlaybackStore.getState().currentTime || 0;
    if (sliderRef.current && !isDragging) {
      sliderRef.current.value = safeTime;
    }
  }, [currentSong?.id]);

  // Calculate accurate playback time at any animation frame
  const getPlaybackTime = useCallback(() => {
    if (audioMaster === 'dashboard' && isPlaying) {
      return audioPlayer.getCurrentPlaybackTime(true);
    }
    const anchor = syncAnchorRef.current;
    if (isPlaying && anchor.isPlaying) {
      const now = performance.now();
      const elapsed = (now - anchor.timestamp) / 1000;
      return Math.max(0, anchor.time + elapsed);
    }
    return anchor.time || usePlaybackStore.getState().currentTime || 0;
  }, [audioMaster, isPlaying]);

  // Smooth 60fps tracking animation loop
  useEffect(() => {
    let animId;

    const frameLoop = () => {
      animId = requestAnimationFrame(frameLoop);

      if (!isDragging) {
        const cur = getPlaybackTime();
        const maxDur = typeof duration === 'number' && duration > 0 ? duration : 0;
        const bounded = maxDur > 0 ? Math.min(maxDur, cur) : cur;

        // 1. Direct DOM updates for timeline slider and time stamps
        if (sliderRef.current) {
          sliderRef.current.value = bounded;
        }
        if (timeCurrentRef.current) {
          timeCurrentRef.current.textContent = formatTime(bounded);
        }
        if (timeTotalRef.current) {
          if (showRemainingRef.current) {
            timeTotalRef.current.textContent = maxDur > 0 ? `-${formatTime(Math.max(0, maxDur - bounded))}` : '--:--';
          } else {
            timeTotalRef.current.textContent = maxDur > 0 ? formatTime(maxDur) : '--:--';
          }
        }

        // 2. Karaoke progress calculation & CSS variable update
        const lyricsList = Array.isArray(currentSong?.lyrics) ? currentSong.lyrics : [];
        const { activeIndex, progress } = getActiveLyricInfo(bounded, lyricsList, maxDur);

        if (lyricPreviewRef.current) {
          if (showKaraokeSlide && activeIndex >= 0) {
            lyricPreviewRef.current.style.setProperty('--karaoke-progress', `${progress.toFixed(1)}%`);
          } else {
            lyricPreviewRef.current.style.removeProperty('--karaoke-progress');
          }
        }

        // 3. Update React activeLineIndex only when line actually changes
        if (activeIndex !== activeIndexRef.current) {
          activeIndexRef.current = activeIndex;
          setActiveLineIndex(activeIndex);
        }
      }
    };

    if (isPlaying && currentSong) {
      animId = requestAnimationFrame(frameLoop);
    } else {
      // Audio paused or stopped: sync static state
      const cur = usePlaybackStore.getState().currentTime || 0;
      const maxDur = typeof duration === 'number' && duration > 0 ? duration : 0;
      const bounded = maxDur > 0 ? Math.min(maxDur, cur) : cur;

      if (sliderRef.current && !isDragging) {
        sliderRef.current.value = bounded;
      }
      if (timeCurrentRef.current) {
        timeCurrentRef.current.textContent = formatTime(bounded);
      }
      if (timeTotalRef.current) {
        if (showRemainingRef.current) {
          timeTotalRef.current.textContent = maxDur > 0 ? `-${formatTime(Math.max(0, maxDur - bounded))}` : '--:--';
        } else {
          timeTotalRef.current.textContent = maxDur > 0 ? formatTime(maxDur) : '--:--';
        }
      }

      const lyricsList = Array.isArray(currentSong?.lyrics) ? currentSong.lyrics : [];
      const { activeIndex, progress } = getActiveLyricInfo(bounded, lyricsList, maxDur);
      if (lyricPreviewRef.current) {
        if (showKaraokeSlide && activeIndex >= 0) {
          lyricPreviewRef.current.style.setProperty('--karaoke-progress', `${progress.toFixed(1)}%`);
        } else {
          lyricPreviewRef.current.style.removeProperty('--karaoke-progress');
        }
      }
      if (activeIndex !== activeIndexRef.current) {
        activeIndexRef.current = activeIndex;
        setActiveLineIndex(activeIndex);
      }
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, currentSong, duration, isDragging, showKaraokeSlide, getPlaybackTime]);

  const handleSliderInput = (e) => {
    const val = parseFloat(e.target.value) || 0;
    setIsDragging(true);
    setDraggingSlider(true);
    setSliderTime(val);

    const maxDur = typeof duration === 'number' && duration > 0 ? duration : 0;
    if (timeCurrentRef.current) {
      timeCurrentRef.current.textContent = formatTime(val);
    }
    if (timeTotalRef.current) {
      if (showRemainingRef.current) {
        timeTotalRef.current.textContent = maxDur > 0 ? `-${formatTime(Math.max(0, maxDur - val))}` : '--:--';
      } else {
        timeTotalRef.current.textContent = maxDur > 0 ? formatTime(maxDur) : '--:--';
      }
    }

    const lyricsList = Array.isArray(currentSong?.lyrics) ? currentSong.lyrics : [];
    const { activeIndex, progress } = getActiveLyricInfo(val, lyricsList, maxDur);
    if (lyricPreviewRef.current) {
      if (showKaraokeSlide && activeIndex >= 0) {
        lyricPreviewRef.current.style.setProperty('--karaoke-progress', `${progress.toFixed(1)}%`);
      } else {
        lyricPreviewRef.current.style.removeProperty('--karaoke-progress');
      }
    }
    if (activeIndex !== activeIndexRef.current) {
      activeIndexRef.current = activeIndex;
      setActiveLineIndex(activeIndex);
    }
  };

  const handleSliderChange = (e) => {
    const target = parseFloat(e.target.value) || 0;
    setIsDragging(false);
    setDraggingSlider(false);
    seek(target);
  };

  const handleToggleRemaining = () => {
    setShowRemaining((prev) => {
      const next = !prev;
      showRemainingRef.current = next;
      const cur = isDragging ? sliderTime : getPlaybackTime();
      const maxDur = typeof duration === 'number' && duration > 0 ? duration : 0;
      if (timeTotalRef.current) {
        if (next) {
          timeTotalRef.current.textContent = maxDur > 0 ? `-${formatTime(Math.max(0, maxDur - cur))}` : '--:--';
        } else {
          timeTotalRef.current.textContent = maxDur > 0 ? formatTime(maxDur) : '--:--';
        }
      }
      return next;
    });
  };

  const handleRevealInLibrary = () => {
    if (!currentSong) return;

    const { filterQuery, setFilterQuery } = useLibraryStore.getState();
    if (filterQuery) {
      setFilterQuery('');
    }

    setTimeout(() => {
      const el = document.getElementById(`library-song-${currentSong.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('highlight-pulse');
        void el.offsetWidth;
        el.classList.add('highlight-pulse');
        setTimeout(() => {
          el.classList.remove('highlight-pulse');
        }, 2200);
      } else {
        const list = document.getElementById('libraryList');
        if (list) {
          list.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, 60);
  };

  const lyrics = Array.isArray(currentSong?.lyrics) ? currentSong.lyrics : [];
  const currentLineNum = activeLineIndex >= 0 ? activeLineIndex + 1 : 0;
  const totalLines = lyrics.length;
  const currentLyric = (activeLineIndex >= 0 && activeLineIndex < lyrics.length) ? lyrics[activeLineIndex] : null;
  const currentLyricText = currentLyric ? (currentLyric.text || '').trim() : '';
  const isRtl = isRtlText(currentLyricText);

  return (
    <div className="audio-controls-card">
      {/* Top: Large Song Info Card with Cover Art, Title, Artist, and Reveal Button */}
      <div className="player-track-info-card">
        <div className="player-track-art-wrapper">
          <img
            src={currentSong?.albumArt || '/CtrlAltLyrics-logo.svg'}
            alt={currentSong?.title ? `${currentSong.title} cover` : 'Album Art'}
            className="player-cover-art"
            onError={(e) => {
              e.target.onerror = null;
              e.target.src = '/CtrlAltLyrics-logo.svg';
            }}
          />
        </div>

        <div className="player-track-text-meta">
          <div className="player-status-badge">
            <span className="currently-playing-label">Current:</span>
          </div>
          <div
            className="player-song-title"
            id="currentSongTitle"
            title={currentSong?.title || 'No track selected'}
          >
            {currentSong?.title || 'No Track Selected'}
          </div>
          <div
            className="player-song-artist"
            title={currentSong?.artist || ''}
          >
            {currentSong?.artist || (currentSong ? 'Unknown Artist' : 'Select a track to start')}
          </div>
        </div>

        <div className="player-track-actions">
          <button
            className="btn reveal-library-btn"
            title={currentSong ? "Reveal in Library (scroll to song)" : "No song playing"}
            aria-label="Reveal currently playing song in library"
            disabled={!currentSong}
            onClick={handleRevealInLibrary}
          >
            <i className="icon-library"></i>
          </button>
        </div>
      </div>

      {/* Middle 1: Current Lyric Preview with Waveform Background & Karaoke Slide */}
      <div
        ref={lyricPreviewRef}
        className={`current-lyric-preview ${showKaraokeSlide && currentLyricText ? 'has-karaoke' : ''} ${isRtl ? 'rtl' : 'ltr'}`}
        title={currentLyricText ? `Current lyric: "${currentLyricText}" (Click to edit sync)` : (currentSong ? "Click to open Lyrics & Sync Editor" : undefined)}
        style={{ cursor: currentSong ? 'pointer' : 'default' }}
        onClick={() => {
          if (currentSong) openLyricsSyncModal(currentSong);
        }}
      >
        {showWaveform && (
          <VisualizerCanvas
            song={currentSong}
            duration={duration}
            isPlaying={isPlaying}
            syncAnchorRef={syncAnchorRef}
            getPlaybackTime={getPlaybackTime}
            mode="bottom"
            id="dashboardLyricVisualizer"
          />
        )}
        <i className="icon-music lyric-preview-icon" aria-hidden="true" />
        <span className={`current-lyric-text ${!currentLyricText ? 'is-placeholder' : ''}`}>
          {currentLyricText || (currentSong ? (lyrics.length > 0 ? '♪ Instrumental / Intro ♪' : 'No lyrics synced') : '—')}
        </span>
      </div>

      {/* Middle 2: Single Controls Row (Lyric controls on Left, Playback buttons on Right) */}
      <div className="player-controls-row">
        {/* Left: Lyric Navigation Controls */}
        <div className="lyrics-nav-group">
          <button
            className="btn prev-line-btn"
            title="Prev Line (<)"
            aria-label="Previous lyric line"
            disabled={!currentSong || lyrics.length === 0}
            onClick={jumpToPrevLine}
          >
            <i className="icon-chevron-left"></i>
          </button>

          <span
            className="lyrics-counter"
            style={{ cursor: currentSong ? 'pointer' : 'default', userSelect: 'none' }}
            title={currentSong ? "Open Lyrics & Sync Editor" : undefined}
            onClick={() => {
              if (currentSong) openLyricsSyncModal(currentSong);
            }}
          >
            Lyrics {currentLineNum}/{totalLines}
          </span>

          <button
            className="btn next-line-btn"
            title="Next Line (>)"
            aria-label="Next lyric line"
            disabled={!currentSong || lyrics.length === 0}
            onClick={jumpToNextLine}
          >
            <i className="icon-chevron-right"></i>
          </button>
        </div>

        {/* Right: Playback Buttons (Prev Song, Play/Pause, Next Song) */}
        <div className="playback-btn-group">
          <button
            className="btn prev-song-btn"
            title="Prev Song (Shift + <)"
            aria-label="Previous song"
            disabled={!currentSong}
            onClick={playPrev}
          >
            <i className="icon-skip-back"></i>
          </button>

          <button
            className="btn play-pause-btn"
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={!currentSong}
            onClick={togglePlayPause}
          >
            <i className={isPlaying ? 'icon-pause' : 'icon-play'}></i>
          </button>

          <button
            className="btn next-song-btn"
            title="Next Song (Shift + >)"
            aria-label="Next song"
            disabled={!currentSong}
            onClick={playNext}
          >
            <i className="icon-skip-forward"></i>
          </button>
        </div>
      </div>

      {/* Bottom: Timeline Slider & Time Display */}
      <div className="timeline-group">
        <span ref={timeCurrentRef} className="time-display time-current" title="Elapsed Time">
          {formatTime(usePlaybackStore.getState().currentTime || 0)}
        </span>

        <input
          ref={sliderRef}
          type="range"
          id="timelineSlider"
          min="0"
          max={duration || 0}
          defaultValue={usePlaybackStore.getState().currentTime || 0}
          step="any"
          disabled={!currentSong}
          aria-label="Timeline seek slider"
          aria-valuemin="0"
          aria-valuemax={duration || 0}
          aria-valuenow={usePlaybackStore.getState().currentTime || 0}
          onInput={handleSliderInput}
          onChange={handleSliderChange}
        />

        <span
          ref={timeTotalRef}
          className="time-display time-total clickable"
          title={showRemaining ? "Tapping switches to Total Duration" : "Tapping switches to Remaining Time"}
          onClick={handleToggleRemaining}
        >
          {showRemaining
            ? (duration && duration > 0 ? `-${formatTime(Math.max(0, duration - (usePlaybackStore.getState().currentTime || 0)))}` : '--:--')
            : (duration && duration > 0 ? formatTime(duration) : '--:--')}
        </span>
      </div>
    </div>
  );
}
