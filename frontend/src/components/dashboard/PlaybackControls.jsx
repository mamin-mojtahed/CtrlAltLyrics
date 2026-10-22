import React, { useEffect, useState, useRef } from 'react';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useModalStore } from '../../stores/useModalStore';
import * as audioPlayer from '../../services/audioPlayer';
import { formatTimeDisplay } from '../../utils/themeColors';

export default function PlaybackControls() {
  const openLyricsSyncModal = useModalStore((state) => state.openLyricsSyncModal);
  const currentSong = usePlaybackStore((state) => state.currentSong);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const currentTime = usePlaybackStore((state) => state.currentTime);
  const duration = usePlaybackStore((state) => state.duration);

  const togglePlayPause = usePlaybackStore((state) => state.togglePlayPause);
  const playNext = usePlaybackStore((state) => state.playNext);
  const playPrev = usePlaybackStore((state) => state.playPrev);
  const jumpToNextLine = usePlaybackStore((state) => state.jumpToNextLine);
  const jumpToPrevLine = usePlaybackStore((state) => state.jumpToPrevLine);
  const seek = usePlaybackStore((state) => state.seek);
  const setDraggingSlider = usePlaybackStore((state) => state.setDraggingSlider);

  const [sliderTime, setSliderTime] = useState(currentTime);
  const [isDragging, setIsDragging] = useState(false);
  const animFrameRef = useRef(null);

  // Sync internal slider time when currentTime changes from outside and not dragging
  useEffect(() => {
    if (!isDragging) {
      setSliderTime(currentTime);
    }
  }, [currentTime, isDragging]);

  // Smooth 60fps tracking when audio is playing
  useEffect(() => {
    if (!isPlaying || !currentSong) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setSliderTime(currentTime || 0);
      return;
    }

    const updateSlider = () => {
      if (!isDragging) {
        const cur = audioPlayer.getCurrentPlaybackTime(true);
        const maxDur = duration || 0;
        setSliderTime(maxDur > 0 ? Math.min(maxDur, cur) : cur);
      }
      animFrameRef.current = requestAnimationFrame(updateSlider);
    };

    animFrameRef.current = requestAnimationFrame(updateSlider);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, isDragging, currentSong, duration, currentTime]);

  // Calculate current lyric index for lyrics counter
  const lyrics = currentSong?.lyrics || [];
  let currentLineIndex = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (sliderTime >= lyrics[i].time) {
      currentLineIndex = i;
    } else {
      break;
    }
  }
  const currentLineNum = currentLineIndex >= 0 ? currentLineIndex + 1 : 0;
  const totalLines = lyrics.length;

  const handleSliderInput = (e) => {
    setIsDragging(true);
    setDraggingSlider(true);
    setSliderTime(parseFloat(e.target.value));
  };

  const handleSliderChange = (e) => {
    const target = parseFloat(e.target.value);
    setIsDragging(false);
    setDraggingSlider(false);
    seek(target);
  };

  return (
    <div className="audio-controls-card">
      <h2 style={{ textAlign: 'center' }}>
        <span className="currently-playing-label">Currently Playing: </span>
        <span id="currentSongTitle">{currentSong?.title || 'None'}</span>
      </h2>

      {/* Merged Play/Pause & Song Navigation */}
      <div className="playback-btn-group">
        <button
          className="btn prev-song-btn"
          title="Prev Song (Shift + <)"
          onClick={playPrev}
        >
          <i className="icon-skip-back"></i>
        </button>

        <button
          className="btn play-pause-btn"
          title="Play/Pause (Space)"
          onClick={togglePlayPause}
        >
          <i className={isPlaying ? 'icon-pause' : 'icon-play'}></i>
        </button>

        <button
          className="btn next-song-btn"
          title="Next Song (Shift + >)"
          onClick={playNext}
        >
          <i className="icon-skip-forward"></i>
        </button>
      </div>

      {/* Lyric Line Navigation */}
      <div className="lyrics-nav-group">
        <button
          className="btn prev-line-btn"
          title="Prev Line (<)"
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
          onClick={jumpToNextLine}
        >
          <i className="icon-chevron-right"></i>
        </button>
      </div>

      {/* Timeline Slider & Time Display */}
      <div className="timeline-group">
        <input
          type="range"
          id="timelineSlider"
          min="0"
          max={duration || 0}
          value={sliderTime || 0}
          step="any"
          disabled={!currentSong}
          onInput={handleSliderInput}
          onChange={handleSliderChange}
        />
        <span className="time-display">
          {formatTimeDisplay(sliderTime, duration)}
        </span>
      </div>
    </div>
  );
}
