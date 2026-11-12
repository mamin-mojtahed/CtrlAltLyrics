import React, { useState, useRef, useEffect } from 'react';
import { useQueueStore } from '../../stores/useQueueStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import ScrollShadowWrapper from '../common/ScrollShadowWrapper';

function QueueStatusBadge({ song }) {
  if (!song) return null;

  let icons = <i className="icon-loader-2 icon-spin" />;
  let statusClass = 'status-processing';
  let tooltip = 'Processing track...';

  if (song.status === 'downloading') {
    icons = (
      <>
        <i className="icon-loader-2 icon-spin" />
        <i className="icon-download" />
      </>
    );
    statusClass = 'status-downloading';
    tooltip = 'Downloading audio...';
  } else if (song.status === 'splitting') {
    icons = (
      <>
        <i className="icon-loader-2 icon-spin" />
        <i className="icon-scissors" />
      </>
    );
    statusClass = 'status-splitting';
    tooltip = 'Separating stems...';
  } else if (song.status === 'fetching_lyrics' || song.lyricsStatus) {
    icons = (
      <>
        <i className="icon-loader-2 icon-spin" />
        <i className="icon-file-text" />
      </>
    );
    statusClass = 'status-lyrics';
    tooltip = song.lyricsStatus ? `Fetching lyrics: ${song.lyricsStatus}` : 'Fetching lyrics...';
  } else if (song.status === 'error') {
    icons = <i className="icon-alert-triangle" />;
    statusClass = 'status-error';
    tooltip = song.downloadError || song.splitError || song.lyricsError || 'Processing error';
  } else if (song.status === 'pending') {
    icons = <i className="icon-clock" />;
    statusClass = 'status-pending';
    tooltip = 'Queued for processing...';
  }

  return (
    <div className={`queue-status-badge queue-processing-badge ${statusClass}`} title={tooltip} aria-label={tooltip}>
      {icons}
    </div>
  );
}

export default function QueueList() {
  const queue = useQueueStore((state) => state.queue);
  const reorderItem = useQueueStore((state) => state.reorderItem);
  const reorderAll = useQueueStore((state) => state.reorderAll);
  const remove = useQueueStore((state) => state.remove);
  const enqueue = useQueueStore((state) => state.enqueue);

  const draggedLibrarySong = useQueueStore((state) => state.draggedLibrarySong);
  const setDraggedLibrarySong = useQueueStore((state) => state.setDraggedLibrarySong);

  const currentSong = usePlaybackStore((state) => state.currentSong);
  const currentQueueId = usePlaybackStore((state) => state.currentQueueId);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const selectSong = usePlaybackStore((state) => state.selectSong);

  const [draggedQueueId, setDraggedQueueId] = useState(null);
  const [targetQueueId, setTargetQueueId] = useState(null);
  const [isDragOutside, setIsDragOutside] = useState(false);

  // History reveal & spring interaction state
  const [isHistoryUnlocked, setIsHistoryUnlocked] = useState(false);
  const [springOffset, setSpringOffset] = useState(0);

  const queueListRef = useRef(null);
  const historyWrapperRef = useRef(null);
  const historySectionRef = useRef(null);
  const queueSectionRef = useRef(null);
  const isHistoryUnlockedRef = useRef(false);
  const isUnlockingRef = useRef(false);
  const lastTapRef = useRef({ time: 0, x: 0, y: 0, id: null });

  isHistoryUnlockedRef.current = isHistoryUnlocked;

  // Derive active index to separate past songs into History and current/upcoming into Queue
  const activeQueueId = currentQueueId || currentSong?.queueId;
  let currentIdx = -1;
  if (activeQueueId) {
    currentIdx = queue.findIndex(s => s.queueId && String(s.queueId) === String(activeQueueId));
  }
  if (currentIdx === -1 && currentSong?.id) {
    currentIdx = queue.findIndex(s => String(s.id) === String(currentSong.id));
  }

  const historySongs = currentIdx > 0 ? queue.slice(0, currentIdx) : [];
  const queueSongs = currentIdx >= 0 ? queue.slice(currentIdx) : queue;

  const unlockHistory = () => {
    isHistoryUnlockedRef.current = true;
    isUnlockingRef.current = true;
    if (historyWrapperRef.current) {
      historyWrapperRef.current.style.transition = '';
      historyWrapperRef.current.style.gridTemplateRows = '';
      historyWrapperRef.current.style.opacity = '';
      historyWrapperRef.current.style.display = '';
    }
    setIsHistoryUnlocked(true);
    setSpringOffset(0);
    setTimeout(() => {
      isUnlockingRef.current = false;
    }, 700);
  };

  const handleLockHistory = () => {
    isHistoryUnlockedRef.current = false;
    const container = queueListRef.current;
    if (historyWrapperRef.current) {
      historyWrapperRef.current.style.transition = '';
      historyWrapperRef.current.style.gridTemplateRows = '';
      historyWrapperRef.current.style.opacity = '';
      historyWrapperRef.current.style.display = '';
    }
    if (container && container.scrollTop > 10) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => {
        setIsHistoryUnlocked(false);
      }, 180);
    } else {
      setIsHistoryUnlocked(false);
    }
  };

  // When History unlocks, if history is taller than container, smoothly align recent history above queue
  useEffect(() => {
    if (isHistoryUnlocked) {
      const container = queueListRef.current;
      const historyEl = historySectionRef.current;
      if (!container || !historyEl) return;

      const timer = setTimeout(() => {
        const containerHeight = container.clientHeight;
        const historyHeight = historyEl.offsetHeight;

        if (historyHeight > containerHeight - 65) {
          const targetScroll = Math.max(0, historyHeight - (containerHeight - 75));
          container.scrollTo({ top: targetScroll, behavior: 'smooth' });
        }
      }, 70);

      return () => clearTimeout(timer);
    }
  }, [isHistoryUnlocked]);

  // Relock History when scrolled down so History is completely out of view
  const handleScroll = () => {
    if (!isHistoryUnlockedRef.current || isUnlockingRef.current) return;
    const container = queueListRef.current;
    const historyEl = historySectionRef.current;
    const wrapper = historyWrapperRef.current;
    if (!container || !historyEl) return;

    const historyHeight = historyEl.offsetHeight;
    if (historyHeight > 0 && container.scrollTop >= historyHeight) {
      isHistoryUnlockedRef.current = false;
      if (wrapper) {
        wrapper.style.transition = 'none';
        wrapper.style.display = 'none';
      }
      // Synchronously adjust scrollTop on the DOM in the same frame as hiding wrapper
      container.scrollTop = Math.max(0, container.scrollTop - historyHeight);
      if (wrapper) void wrapper.offsetHeight;
      setIsHistoryUnlocked(false);
    }
  };

  // Wheel listener: pull up against spring resistance when at top of Queue (twice as hard)
  // And when History is open, scrolling down at top smoothly auto-collapses History!
  useEffect(() => {
    const container = queueListRef.current;
    if (!container) return;

    let pullAcc = 0;
    let decayTimer = null;

    const handleWheel = (e) => {
      // If History is open and user scrolls down at top, smoothly auto-collapse History!
      if (isHistoryUnlockedRef.current) {
        if (container.scrollTop <= 10 && e.deltaY > 15) {
          e.preventDefault();
          handleLockHistory();
        }
        return;
      }

      // If History is closed, pull up against spring to reveal History
      if (container.scrollTop <= 0 && e.deltaY < 0) {
        e.preventDefault();
        clearTimeout(decayTimer);

        // Twice as hard: threshold is 245 raw delta units (vs 122 previously)
        pullAcc += -e.deltaY;
        const ratio = Math.min(1, Math.max(0, pullAcc / 245));
        const spring = Math.pow(ratio, 0.75) * 44;
        setSpringOffset(spring);

        if (pullAcc >= 245) {
          pullAcc = 0;
          setSpringOffset(0);
          unlockHistory();
          return;
        }

        decayTimer = setTimeout(() => {
          pullAcc = 0;
          setSpringOffset(0);
        }, 180);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
      clearTimeout(decayTimer);
    };
  }, []);

  // Touch listener: pull down against spring resistance on touch screens (twice as hard)
  // And when History is open, swiping up at top smoothly auto-collapses History!
  useEffect(() => {
    const container = queueListRef.current;
    if (!container) return;

    let startY = 0;
    let isPulling = false;

    const handleTouchStart = (e) => {
      if (container.scrollTop <= 10 && e.touches.length === 1) {
        startY = e.touches[0].clientY;
        isPulling = true;
      }
    };

    const handleTouchMove = (e) => {
      if (!isPulling) return;

      if (isHistoryUnlockedRef.current) {
        if (container.scrollTop <= 10) {
          const diff = e.touches[0].clientY - startY;
          if (diff < -25) {
            isPulling = false;
            handleLockHistory();
          }
        }
        return;
      }

      if (container.scrollTop <= 0) {
        const diff = e.touches[0].clientY - startY;
        if (diff > 0) {
          e.preventDefault();
          // Twice as hard: threshold is 130px (vs 65px previously)
          const ratio = Math.min(1, Math.max(0, diff / 130));
          const spring = Math.pow(ratio, 0.75) * 44;
          setSpringOffset(spring);
          if (diff >= 130) {
            isPulling = false;
            setSpringOffset(0);
            unlockHistory();
          }
        }
      }
    };

    const handleTouchEnd = () => {
      if (isPulling) {
        isPulling = false;
        setSpringOffset(0);
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  const handleQueueCardPointerDown = (e, song, qId) => {
    if (e.target.closest('button') || e.target.closest('.queue-controls-group') || e.target.closest('.queue-arrow-btn') || e.target.closest('.queue-drag-handle')) {
      return;
    }
    const now = performance.now();
    const last = lastTapRef.current;
    const dist = Math.hypot(e.clientX - last.x, e.clientY - last.y);
    if (last.id === qId && now - last.time < 380 && dist < 30) {
      e.preventDefault();
      selectSong(song.id, true, qId);
      lastTapRef.current = { time: 0, x: 0, y: 0, id: null };
      return;
    }
    lastTapRef.current = { time: now, x: e.clientX, y: e.clientY, id: qId };
  };

  const handleQueueCardDoubleClick = (e, song, qId) => {
    if (e.target.closest('button') || e.target.closest('.queue-controls-group') || e.target.closest('.queue-arrow-btn') || e.target.closest('.queue-drag-handle')) {
      return;
    }
    e.preventDefault();
    selectSong(song.id, true, qId);
  };

  const handleRevealInLibrary = (song) => {
    if (!song || !song.id) return;

    // Reset library filter if active so the target song is rendered
    const { filterQuery, setFilterQuery } = useLibraryStore.getState();
    if (filterQuery) {
      setFilterQuery('');
    }

    // Scroll to library song card and trigger pulse animation
    setTimeout(() => {
      const el = document.getElementById(`library-song-${song.id}`);
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

  // Helper to determine target element from pointer Y
  const getDragAfterElement = (y) => {
    if (!queueListRef.current) return null;
    const cards = [...queueListRef.current.querySelectorAll('.queue-card:not(.dragging):not(.queue-drop-placeholder)')];
    if (cards.length === 0) return null;

    const firstBox = cards[0].getBoundingClientRect();
    if (y < firstBox.top + firstBox.height / 2) {
      return cards[0];
    }
    const lastBox = cards[cards.length - 1].getBoundingClientRect();
    if (y > lastBox.top + lastBox.height / 2) {
      return null; // Append at end of list
    }

    return cards.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - (box.top + box.height / 2);
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element || null;
  };

  const isDraggingAny = draggedQueueId !== null || !!draggedLibrarySong;

  // Global document dragover/drop listeners for dragging outside to remove
  useEffect(() => {
    if (!isDraggingAny) {
      setIsDragOutside(false);
      setTargetQueueId(null);
      return;
    }

    const handleDocDragOver = (e) => {
      e.preventDefault();
      const isOver = queueListRef.current && queueListRef.current.contains(e.target);
      if (!isOver) {
        setIsDragOutside(true);
        setTargetQueueId(null);
      } else {
        setIsDragOutside(false);
      }
    };

    const handleDocDrop = async (e) => {
      const isOver = queueListRef.current && queueListRef.current.contains(e.target);
      if (!isOver && draggedQueueId) {
        e.preventDefault();
        const idToRemove = draggedQueueId;
        setDraggedQueueId(null);
        setTargetQueueId(null);
        setIsDragOutside(false);
        await remove(idToRemove);
      }
    };

    document.addEventListener('dragover', handleDocDragOver);
    document.addEventListener('drop', handleDocDrop);

    return () => {
      document.removeEventListener('dragover', handleDocDragOver);
      document.removeEventListener('drop', handleDocDrop);
    };
  }, [isDraggingAny, draggedQueueId, remove]);

  const handleQueueDragStart = (e, qId, song) => {
    if (e.target.closest('button') || e.target.closest('.queue-controls-group') || e.target.closest('.queue-arrow-btn')) {
      e.preventDefault();
      return;
    }
    setDraggedQueueId(String(qId));
    setIsDragOutside(false);
    e.dataTransfer.setData('text/plain', String(qId));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleQueueDragEnd = () => {
    setDraggedQueueId(null);
    setTargetQueueId(null);
    setIsDragOutside(false);
  };

  const handleListDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = draggedLibrarySong ? 'copy' : 'move';

    // Auto-scroll when dragging near top/bottom
    if (queueListRef.current) {
      const rect = queueListRef.current.getBoundingClientRect();
      const threshold = 45;
      if (e.clientY < rect.top + threshold) {
        queueListRef.current.scrollTop -= 8;
      } else if (e.clientY > rect.bottom - threshold) {
        queueListRef.current.scrollTop += 8;
      }
    }

    setIsDragOutside(false);
    const afterEl = getDragAfterElement(e.clientY);
    setTargetQueueId(afterEl ? (afterEl.dataset.queueId || '__END__') : '__END__');
  };

  const handleListDragLeave = (e) => {
    if (!queueListRef.current || !queueListRef.current.contains(e.relatedTarget)) {
      setTargetQueueId(null);
      setIsDragOutside(true);
    }
  };

  const handleListDrop = async (e) => {
    e.preventDefault();
    const target = targetQueueId;

    if (draggedLibrarySong) {
      const songToEnqueue = draggedLibrarySong;
      setDraggedLibrarySong(null);
      setTargetQueueId(null);
      setIsDragOutside(false);

      let insertIdx = queue.length;
      if (target && target !== '__END__') {
        const idx = queue.findIndex(s => String(s.queueId || s.id) === target);
        if (idx !== -1) insertIdx = idx;
      }
      await enqueue(songToEnqueue, insertIdx);
      return;
    }

    if (draggedQueueId) {
      const fromId = draggedQueueId;
      setDraggedQueueId(null);
      setTargetQueueId(null);
      setIsDragOutside(false);

      if (!target) return;

      const fromIdx = queue.findIndex(s => String(s.queueId || s.id) === fromId);
      if (fromIdx === -1) return;
      const movedItem = queue[fromIdx];
      const remaining = queue.filter((_, i) => i !== fromIdx);

      if (target === '__END__') {
        remaining.push(movedItem);
      } else {
        const insertIdx = remaining.findIndex(s => String(s.queueId || s.id) === target);
        if (insertIdx !== -1) {
          remaining.splice(insertIdx, 0, movedItem);
        } else {
          remaining.push(movedItem);
        }
      }

      const oldIds = queue.map(s => String(s.queueId || s.id));
      const newIds = remaining.map(s => String(s.queueId || s.id));
      const hasChanged = newIds.length === oldIds.length && newIds.some((id, i) => id !== oldIds[i]);
      if (hasChanged) {
        await reorderAll(newIds);

        // If the current active song was swapped with a later song, play the new top song
        const oldActiveSong = currentIdx >= 0 ? queue[currentIdx] : null;
        const newActiveSong = currentIdx >= 0 ? remaining[currentIdx] : null;
        if (
          oldActiveSong &&
          newActiveSong &&
          String(oldActiveSong.queueId || oldActiveSong.id) !== String(newActiveSong.queueId || newActiveSong.id)
        ) {
          await selectSong(newActiveSong.id, true, newActiveSong.queueId);
        }
      }
    }
  };

  const handleReorderClick = async (qId, direction, song, idx) => {
    // Case 1: Moving the current active song down -> play the song right after it
    if (idx === 0 && direction === 'down') {
      const nextSong = queueSongs[1];
      if (nextSong) {
        await reorderItem(qId, 'down');
        await selectSong(nextSong.id, true, nextSong.queueId);
        return;
      }
    }

    // Case 2: Moving the song right after current active song up -> it swaps and is played
    if (idx === 1 && direction === 'up') {
      await reorderItem(qId, 'up');
      await selectSong(song.id, true, song.queueId);
      return;
    }

    // Default: normal reorder between other queue songs
    await reorderItem(qId, direction);
  };

  const showPreview = isDraggingAny && !isDragOutside && !!targetQueueId;
  const draggedTitle = draggedLibrarySong?.title ||
    queue.find(s => String(s.queueId || s.id) === String(draggedQueueId))?.title ||
    'Track';

  const renderSongCard = (song, idx, isHistory) => {
    const qId = String(song.queueId || song.id);
    const isCurrentActive = !isHistory && idx === 0 && Boolean(currentSong);
    const isProcessing = song.status !== 'ready';
    const isBeingDragged = isDraggingAny && draggedQueueId === qId;
    const isTargetBefore = showPreview && targetQueueId === qId;

    return (
      <React.Fragment key={`${isHistory ? 'hist-' : 'queue-'}${qId}`}>
        {/* Show preview placeholder before this item if targeted */}
        {isTargetBefore && (
          <div className="song-card queue-card queue-drop-placeholder">
            <i className="icon-plus"></i>
            <span className="placeholder-text">
              Insert: <strong>{draggedTitle}</strong>
            </span>
          </div>
        )}

        <div
          className={`song-card queue-card ${isHistory ? 'history-card' : ''} ${isCurrentActive ? (isPlaying ? 'active-playing' : 'active-playing is-paused') : ''} ${isProcessing ? 'queue-card-processing' : ''} ${isBeingDragged ? 'dragging' : ''} ${isBeingDragged && isDragOutside ? 'dragging-remove' : ''}`}
          data-queue-id={qId}
          draggable={!isHistory}
          onDragStart={(e) => !isHistory && handleQueueDragStart(e, qId, song)}
          onDragEnd={handleQueueDragEnd}
          onPointerDown={(e) => handleQueueCardPointerDown(e, song, qId)}
          onDoubleClick={(e) => handleQueueCardDoubleClick(e, song, qId)}
          title="Double-tap to play track"
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1, minWidth: 0 }}>
              {!isHistory && (
                <div className="queue-reorder-col" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="queue-arrow-btn"
                    onClick={() => handleReorderClick(qId, 'up', song, idx)}
                    disabled={idx === 0}
                    title="Move Up"
                    aria-label="Move Up"
                  >
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="18 15 12 9 6 15"></polyline>
                    </svg>
                  </button>
                  <span className="queue-drag-handle" title="Drag to reorder">
                    <i className="icon-grip-vertical"></i>
                  </span>
                  <button
                    className="queue-arrow-btn"
                    onClick={() => handleReorderClick(qId, 'down', song, idx)}
                    disabled={idx === queueSongs.length - 1}
                    title="Move Down"
                    aria-label="Move Down"
                  >
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </button>
                </div>
              )}

              <img
                src={song.albumArt || '/CtrlAltLyrics-logo.svg'}
                alt="art"
                onError={(e) => { e.target.onerror = null; e.target.src = '/CtrlAltLyrics-logo.svg'; }}
              />
              <div className="song-info">
                <div className="song-title">{song.title}</div>
                <div className="song-artist">{song.artist}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              {isCurrentActive ? (
                <div
                  className={`currently-playing-badge ${isPlaying ? 'is-playing' : 'is-paused'}`}
                  title={isPlaying ? "Currently Playing" : "Currently Paused"}
                  aria-label={isPlaying ? "Currently Playing" : "Currently Paused"}
                >
                  <i className={isPlaying ? "icon-play" : "icon-pause"}></i>
                </div>
              ) : (
                !isHistory && isProcessing && <QueueStatusBadge song={song} />
              )}

              <div className="queue-controls-group" onClick={(e) => e.stopPropagation()}>
                <button
                  className="btn reveal-library-btn"
                  title="Reveal in Library (scroll to song)"
                  aria-label={`Reveal ${song.title || 'song'} in library`}
                  onClick={() => handleRevealInLibrary(song)}
                >
                  <i className="icon-library"></i>
                </button>

                <button
                  className="queue-icon-btn"
                  onClick={() => remove(qId)}
                  title={isHistory ? "Remove from History" : "Remove from Queue"}
                  aria-label={isHistory ? "Remove from History" : "Remove from Queue"}
                >
                  <i className="icon-x"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </React.Fragment>
    );
  };

  return (
    <div className="queue-component-container">
      {/* Spring Pull Indicator */}
      {springOffset > 0 && (
        <div className="queue-spring-indicator" style={{ height: `${springOffset}px` }}>
          <div className="queue-spring-pill" style={{ opacity: Math.min(1, springOffset / 20) }}>
            <i className={`icon-arrow-down ${springOffset >= 36 ? 'icon-rotate-180' : ''}`}></i>
            <span>{springOffset >= 36 ? 'Release for History' : 'Pull for History'}</span>
          </div>
        </div>
      )}

      <ScrollShadowWrapper className="queue-scroll-wrapper" scrollRef={queueListRef}>
        <div
          id="queueList"
          ref={queueListRef}
          className={`queue-list ${isHistoryUnlocked ? 'has-history-unlocked' : ''}`}
          style={
            springOffset > 0
              ? { transform: `translateY(${springOffset}px)`, transition: 'none' }
              : { transition: 'transform 0.32s cubic-bezier(0.16, 1, 0.3, 1)' }
          }
          onScroll={handleScroll}
          onDragOver={handleListDragOver}
          onDragLeave={handleListDragLeave}
          onDrop={handleListDrop}
        >
          {/* History Section Wrapper (smooth CSS Grid height & opacity transition) */}
          <div
            ref={historyWrapperRef}
            className={`history-section-wrapper ${isHistoryUnlocked ? 'is-expanded' : ''}`}
          >
            <div className="history-section-inner">
              <div className="history-section" ref={historySectionRef}>
                <div className="history-header-row">
                  <h2>History</h2>
                  <button
                    type="button"
                    className="history-collapse-btn"
                    onClick={handleLockHistory}
                    title="Lock History"
                    aria-label="Lock History"
                  >
                    <i className="icon-chevron-up"></i>
                  </button>
                </div>

                <div className="history-cards-group">
                  {historySongs.length === 0 ? (
                    <div className="empty-state history-empty-state">No played tracks in history yet.</div>
                  ) : (
                    historySongs.map((song, idx) => renderSongCard(song, idx, true))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Queue Section */}
          <div className="queue-section" ref={queueSectionRef}>
            <div className="queue-header-row">
              <h2>Queue</h2>
              <div
                id="queueDragOutHint"
                className={`queue-drag-out-hint ${isDragOutside ? 'active' : ''}`}
                style={{ display: draggedQueueId !== null ? 'inline-flex' : 'none' }}
              >
                <i className="icon-trash-2" style={{ marginRight: '0.25rem' }}></i> Drag outside to remove
              </div>
            </div>

            <div className="queue-cards-group">
              {queueSongs.length === 0 && !isDraggingAny ? (
                <div className="empty-state">No songs in queue. Use the search bar above to add a track!</div>
              ) : (
                queueSongs.map((song, idx) => renderSongCard(song, idx, false))
              )}
            </div>
          </div>

          {/* Show preview placeholder at the end of the queue if targeted */}
          {showPreview && targetQueueId === '__END__' && (
            <div className="song-card queue-card queue-drop-placeholder">
              <i className="icon-plus"></i>
              <span className="placeholder-text">
                Insert: <strong>{draggedTitle}</strong>
              </span>
            </div>
          )}
        </div>
      </ScrollShadowWrapper>

      {/* Floating Drag Remove Toast */}
      {isDragOutside && draggedQueueId !== null && (
        <div id="queueRemoveToast" className="queue-remove-toast" style={{ display: 'flex' }}>
          <i className="icon-trash-2"></i> Drop here to remove from queue
        </div>
      )}
    </div>
  );
}
