import React, { useState, useRef } from 'react';
import socket from '../../services/socket';
import { formatTimeDisplay } from '../../utils/themeColors';
import { useScrollShadows } from '../../hooks/useScrollShadows';

export default function SongSidebar({ song, queue = [], currentTime = 0, duration = 0, isOpen = true, onSeek, onSelectSong }) {
  const wrapperRef = useRef(null);
  const scrollRef = useRef(null);
  useScrollShadows(scrollRef, { wrapperRef });

  const [isDragging, setIsDragging] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);

  const displayTime = isDragging ? scrubTime : currentTime;

  // Filter queue for upcoming songs after current track
  const readySongs = (queue || []).filter(s => s.status === 'ready' || !s.status);
  let curIdx = -1;
  const targetQId = song?.queueId;
  if (targetQId) {
    curIdx = readySongs.findIndex(s => String(s.queueId) === String(targetQId));
  }
  if (curIdx === -1 && song?.id) {
    curIdx = readySongs.findIndex(s => String(s.id) === String(song.id));
  }

  const allUpcoming = curIdx !== -1 ? readySongs.slice(curIdx + 1) : (song ? [] : readySongs);
  const upcomingSongs = allUpcoming.slice(0, 3);
  const remainingCount = Math.max(0, allUpcoming.length - 3);

  // In the last 10 seconds of current song, the next up track expands with progress fill
  const remainingTime = duration > 0 ? (duration - currentTime) : Infinity;
  const shouldExpand = duration > 0 && remainingTime <= 10 && remainingTime >= 0;

  const handleSliderInput = (e) => {
    setIsDragging(true);
    setScrubTime(parseFloat(e.target.value) || 0);
  };

  const handleSliderChange = (e) => {
    setIsDragging(false);
    const target = parseFloat(e.target.value) || 0;
    if (onSeek) {
      onSeek(target);
    } else {
      socket.emit('player_command', { command: 'seek', time: target });
    }
  };

  const handleSongClick = (item) => {
    if (typeof onSelectSong === 'function') {
      onSelectSong(item);
    } else {
      socket.emit('player_command', {
        command: 'select_song',
        id: item.id,
        queueId: item.queueId || item.id
      });
    }
  };

  return (
    <aside className={`song-info-sidebar glass ${!isOpen ? 'closed' : ''}`} id="songSidebar" ref={wrapperRef}>
      <div className="scroll-shadow-overlay scroll-shadow-top scroll-shadow-sidebar" aria-hidden="true" />
      <div className="song-sidebar-scroll" ref={scrollRef}>
        <div className="cover-wrapper">
        <img
          id="displaySongCover"
          src={song?.albumArt || '/CtrlAltLyrics-logo.svg'}
          alt="Album Cover"
          onError={(e) => { e.target.onerror = null; e.target.src = '/CtrlAltLyrics-logo.svg'; }}
        />
      </div>

      <div className="song-meta">
        <h2 id="displaySongTitle" className="meta-title">
          {song?.title || 'Ctrl+Alt+Lyrics'}
        </h2>
        <p id="displaySongArtist" className="meta-artist">
          {song?.artist || 'Ready for playback'}
        </p>
      </div>

      {/* Playback Timeline & Timer */}
      <div className="display-timeline-section" id="displayTimelineSection">
        <span id="displayTimeDisplay" className="display-time-display">
          {formatTimeDisplay(displayTime, duration)}
        </span>
        <input
          type="range"
          id="displayTimelineSlider"
          min="0"
          max={duration || 0}
          value={displayTime || 0}
          step="any"
          disabled={!song || !duration || duration <= 0}
          onInput={handleSliderInput}
          onChange={handleSliderChange}
          aria-label="Playback Timeline"
        />
      </div>

      {/* Next Up in Queue */}
      <div className="display-queue-section" id="displayQueueSection">
        <div className="display-queue-header">
          <span className="display-queue-heading">
            <i className="icon-list" style={{ marginRight: '0.35rem' }}></i> Next Up
          </span>
        </div>

        <div className="display-queue-list" id="displayQueueList">
          {upcomingSongs.length === 0 ? (
            <div className="display-queue-empty">No upcoming songs</div>
          ) : (
            upcomingSongs.map((item, idx) => {
              const isFirst = idx === 0;
              const isExpanded = isFirst && shouldExpand;
              const fillProgress = isExpanded
                ? Math.max(0, Math.min(100, ((10 - remainingTime) / 10) * 100))
                : 0;

              return (
                <div
                  key={item.queueId || item.id || idx}
                  className={`display-queue-item ${isExpanded ? 'expanded' : ''}`}
                  style={{
                    '--queue-fill-progress': `${fillProgress.toFixed(2)}%`
                  }}
                  data-id={item.id}
                  data-queue-id={item.queueId || item.id}
                  title={`Click to play: ${item.title}`}
                  onClick={() => handleSongClick(item)}
                >
                  <div className="queue-compact-row">
                    <span className="queue-item-text">
                      <strong className="queue-item-title">{item.title}</strong>
                      <span className="queue-item-sep">•</span>
                      <span className="queue-item-artist">{item.artist}</span>
                    </span>
                  </div>
                  <div className="queue-expanded-container">
                    <div className="queue-expanded-body">
                      <img
                        className="queue-expanded-art"
                        src={item.albumArt || '/CtrlAltLyrics-logo.svg'}
                        alt="art"
                        onError={(e) => { e.target.onerror = null; e.target.src = '/CtrlAltLyrics-logo.svg'; }}
                      />
                      <div className="queue-expanded-info">
                        <div className="queue-expanded-title">{item.title}</div>
                        <div className="queue-expanded-artist">{item.artist}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {remainingCount > 0 && (
          <div className="display-queue-more" id="displayQueueMore">
            +{remainingCount} more
          </div>
        )}
      </div>
      </div>
      <div className="scroll-shadow-overlay scroll-shadow-bottom scroll-shadow-sidebar" aria-hidden="true" />
    </aside>
  );
}
