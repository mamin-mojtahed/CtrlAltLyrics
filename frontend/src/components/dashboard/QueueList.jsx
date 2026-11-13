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
  const [isPulling, setIsPulling] = useState(false);

  const queueListRef = useRef(null);
  const queueContainerRef = useRef(null);
  const historyWrapperRef = useRef(null);
  const historySectionRef = useRef(null);
  const queueSectionRef = useRef(null);
  const isHistoryUnlockedRef = useRef(false);
  const isUnlockingRef = useRef(false);
  const springOffsetRef = useRef(0);
  const lastTapRef = useRef({ time: 0, x: 0, y: 0, id: null });
  const draggedQueueIdRef = useRef(null);
  const targetQueueIdRef = useRef(null);

  isHistoryUnlockedRef.current = isHistoryUnlocked;
  springOffsetRef.current = springOffset;
  draggedQueueIdRef.current = draggedQueueId;
  targetQueueIdRef.current = targetQueueId;

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

    const container = queueListRef.current;
    const historyEl = historySectionRef.current;
    const wrapper = historyWrapperRef.current;

    const currentSpring = springOffsetRef.current || 44;

    if (wrapper) {
      wrapper.classList.add('is-instant');
      wrapper.classList.add('is-expanded');
    }

    const historyHeight = historyEl ? historyEl.offsetHeight || historyEl.scrollHeight : 0;

    setIsHistoryUnlocked(true);
    setIsPulling(false);
    setSpringOffset(0);

    // Don't start from its top (don't scroll all the way up).
    // Simply resume the scroll right above Queue, keeping the current visual position intact!
    if (container && historyHeight > 0) {
      container.scrollTop = Math.max(0, historyHeight - currentSpring);
    }

    requestAnimationFrame(() => {
      if (wrapper) {
        wrapper.classList.remove('is-instant');
      }
      setTimeout(() => {
        isUnlockingRef.current = false;
      }, 350);
    });
  };

  const handleLockHistory = () => {
    if (!isHistoryUnlockedRef.current) return;
    isHistoryUnlockedRef.current = false;
    isUnlockingRef.current = true;
    setIsPulling(false);
    setSpringOffset(0);

    const container = queueListRef.current;
    if (container && container.scrollTop > 0) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }

    setIsHistoryUnlocked(false);
    setTimeout(() => {
      isUnlockingRef.current = false;
    }, 450);
  };

  const handleScroll = () => {
    if (!isHistoryUnlockedRef.current || isUnlockingRef.current) return;
    const container = queueListRef.current;
    const historyEl = historySectionRef.current;
    const wrapper = historyWrapperRef.current;
    if (!container || !historyEl || !wrapper) return;

    const historyHeight = historyEl.offsetHeight || historyEl.scrollHeight;
    if (historyHeight > 0 && container.scrollTop >= historyHeight) {
      isHistoryUnlockedRef.current = false;
      wrapper.classList.add('is-instant');
      wrapper.classList.remove('is-expanded');
      container.scrollTop = container.scrollTop - historyHeight;
      setIsHistoryUnlocked(false);
      requestAnimationFrame(() => {
        if (wrapper) wrapper.classList.remove('is-instant');
      });
    }
  };

  // Wheel listener: pull down against spring resistance when at top of Queue (twice as hard)
  useEffect(() => {
    const container = queueListRef.current;
    const targetElement = queueContainerRef.current || container;
    if (!container || !targetElement) return;

    let pullAcc = 0;
    let decayTimer = null;

    const handleWheel = (e) => {
      // If History is closed, pull down against spring to reveal History
      if (!isHistoryUnlockedRef.current && container.scrollTop <= 0 && e.deltaY < 0) {
        e.preventDefault();
        clearTimeout(decayTimer);

        setIsPulling(true);
        // Twice as hard: threshold is 245 raw delta units
        pullAcc += -e.deltaY;
        const ratio = Math.min(1, Math.max(0, pullAcc / 245));
        const spring = Math.pow(ratio, 0.8) * 50;
        setSpringOffset(spring);

        if (pullAcc >= 245) {
          pullAcc = 0;
          unlockHistory();
          return;
        }

        decayTimer = setTimeout(() => {
          pullAcc = 0;
          setIsPulling(false);
          setSpringOffset(0);
        }, 120);
      }
    };

    targetElement.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      targetElement.removeEventListener('wheel', handleWheel);
      clearTimeout(decayTimer);
    };
  }, []);

  // Touch listener: pull down against spring resistance on touch screens (twice as hard)
  useEffect(() => {
    const container = queueListRef.current;
    const targetElement = queueContainerRef.current || container;
    if (!container || !targetElement) return;

    let startY = 0;
    let isTouchActive = false;

    const handleTouchStart = (e) => {
      if (e.target.closest('button')) return;
      if (container.scrollTop <= 5 && e.touches.length === 1) {
        startY = e.touches[0].clientY;
        isTouchActive = true;
      }
    };

    const handleTouchMove = (e) => {
      if (!isTouchActive) return;

      if (!isHistoryUnlockedRef.current && container.scrollTop <= 0) {
        const diff = e.touches[0].clientY - startY;
        if (diff > 0) {
          e.preventDefault();
          setIsPulling(true);
          // Twice as hard: threshold is 130px
          const ratio = Math.min(1, Math.max(0, diff / 130));
          const spring = Math.pow(ratio, 0.8) * 50;
          setSpringOffset(spring);
          if (diff >= 130) {
            isTouchActive = false;
            unlockHistory();
          }
        }
      }
    };

    const handleTouchEnd = () => {
      if (isTouchActive) {
        isTouchActive = false;
        setIsPulling(false);
        setSpringOffset(0);
      }
    };

    targetElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    targetElement.addEventListener('touchmove', handleTouchMove, { passive: false });
    targetElement.addEventListener('touchend', handleTouchEnd, { passive: true });
    targetElement.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      targetElement.removeEventListener('touchstart', handleTouchStart);
      targetElement.removeEventListener('touchmove', handleTouchMove);
      targetElement.removeEventListener('touchend', handleTouchEnd);
      targetElement.removeEventListener('touchcancel', handleTouchEnd);
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

  // Helper to determine target queue card from pointer Y
  const getTargetQueueId = (y, currentDraggedId) => {
    if (!queueListRef.current) return null;
    const cards = [
      ...queueListRef.current.querySelectorAll('.queue-cards-group .queue-card')
    ];
    if (cards.length === 0) return '__END__';

    // Find target slot index (0 = before first card, ..., cards.length = after last card)
    let targetSlot = cards.length;
    for (let j = 0; j < cards.length; j++) {
      const box = cards[j].getBoundingClientRect();
      const midY = box.top + box.height / 2;
      if (y < midY) {
        targetSlot = j;
        break;
      }
    }

    // If dragging an item that is already in the queue, slots adjacent to the item represent no move
    if (currentDraggedId) {
      const draggedIdx = queueSongs.findIndex(
        (s) => String(s.queueId || s.id) === String(currentDraggedId)
      );
      if (draggedIdx !== -1) {
        // Dropping before itself (targetSlot === draggedIdx) or after itself (targetSlot === draggedIdx + 1) is a no-op
        if (targetSlot === draggedIdx || targetSlot === draggedIdx + 1) {
          return null;
        }
      }
    }

    return targetSlot < cards.length
      ? (cards[targetSlot].dataset.queueId || null)
      : '__END__';
  };

  const handleRemoveQueueSong = async (qId) => {
    const targetQId = String(qId);
    const { queue: currentQ } = useQueueStore.getState();
    const { currentSong: activeSong, currentQueueId: activeQId, endQueue } = usePlaybackStore.getState();

    const activeTargetQId = String(activeQId || activeSong?.queueId || '');
    const activeTargetSongId = String(activeSong?.id || '');

    // Find index of song being removed in current queue
    const removeIdx = currentQ.findIndex(s => String(s.queueId || s.id) === targetQId);

    // Determine if it is the currently playing active song
    let activeIdx = -1;
    if (activeTargetQId) {
      activeIdx = currentQ.findIndex(s => String(s.queueId || s.id) === activeTargetQId);
    }
    if (activeIdx === -1 && activeTargetSongId) {
      activeIdx = currentQ.findIndex(s => String(s.id) === activeTargetSongId);
    }

    const isCurrentActive =
      (activeTargetQId && activeTargetQId === targetQId) ||
      (activeTargetSongId && activeTargetSongId === targetQId) ||
      (activeIdx >= 0 && removeIdx === activeIdx);

    // Look for the next upcoming song in line after the removed active song
    let nextSongToPlay = null;
    if (isCurrentActive) {
      const fromIdx = activeIdx >= 0 ? activeIdx : removeIdx;
      if (fromIdx >= 0 && fromIdx < currentQ.length - 1) {
        nextSongToPlay = currentQ[fromIdx + 1];
      }
    }

    // Remove from queue
    await remove(qId);

    // Advance playback if the currently playing song was removed
    if (isCurrentActive) {
      if (nextSongToPlay) {
        await selectSong(nextSongToPlay.id, true, nextSongToPlay.queueId);
      } else {
        endQueue();
      }
    }
  };

  const isDraggingAny = draggedQueueId !== null || !!draggedLibrarySong;

  // Global document dragover/drop listeners for dragging outside to remove
  useEffect(() => {
    if (!isDraggingAny) {
      setIsDragOutside(false);
      setTargetQueueId(null);
      targetQueueIdRef.current = null;
      return;
    }

    const handleDocDragOver = (e) => {
      e.preventDefault();
      const isOver = (queueListRef.current && queueListRef.current.contains(e.target)) ||
                     (queueContainerRef.current && queueContainerRef.current.contains(e.target));
      if (!isOver) {
        setIsDragOutside(true);
        setTargetQueueId(null);
        targetQueueIdRef.current = null;
      } else {
        setIsDragOutside(false);
      }
    };

    const handleDocDrop = async (e) => {
      const isOver = (queueListRef.current && queueListRef.current.contains(e.target)) ||
                     (queueContainerRef.current && queueContainerRef.current.contains(e.target));
      const idToRemove = draggedQueueIdRef.current;
      if (!isOver && idToRemove) {
        e.preventDefault();
        setDraggedQueueId(null);
        draggedQueueIdRef.current = null;
        setTargetQueueId(null);
        targetQueueIdRef.current = null;
        setIsDragOutside(false);
        await handleRemoveQueueSong(idToRemove);
      }
    };

    document.addEventListener('dragover', handleDocDragOver);
    document.addEventListener('drop', handleDocDrop);

    return () => {
      document.removeEventListener('dragover', handleDocDragOver);
      document.removeEventListener('drop', handleDocDrop);
    };
  }, [isDraggingAny, remove]);

  const handleQueueDragStart = (e, qId, song) => {
    if (e.target.closest('button') || e.target.closest('.queue-controls-group') || e.target.closest('.queue-arrow-btn')) {
      e.preventDefault();
      return;
    }
    const idStr = String(qId);
    setDraggedQueueId(idStr);
    draggedQueueIdRef.current = idStr;
    setIsDragOutside(false);
    e.dataTransfer.setData('text/plain', idStr);
    e.dataTransfer.setData('application/x-ctrlaltlyrics-queue-id', idStr);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleQueueDragEnd = () => {
    setDraggedQueueId(null);
    draggedQueueIdRef.current = null;
    setTargetQueueId(null);
    targetQueueIdRef.current = null;
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
    const newTargetId = getTargetQueueId(e.clientY, draggedQueueIdRef.current || draggedQueueId);
    targetQueueIdRef.current = newTargetId;
    if (newTargetId !== targetQueueId) {
      setTargetQueueId(newTargetId);
    }
  };

  const handleListDragLeave = (e) => {
    if (!queueListRef.current || !queueListRef.current.contains(e.relatedTarget)) {
      setTargetQueueId(null);
      targetQueueIdRef.current = null;
      setIsDragOutside(true);
    }
  };

  const handleListDrop = async (e) => {
    e.preventDefault();
    const target = targetQueueIdRef.current ?? targetQueueId;

    if (draggedLibrarySong) {
      const songToEnqueue = draggedLibrarySong;
      setDraggedLibrarySong(null);
      setTargetQueueId(null);
      targetQueueIdRef.current = null;
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
      draggedQueueIdRef.current = null;
      setTargetQueueId(null);
      targetQueueIdRef.current = null;
      setIsDragOutside(false);

      if (!target || target === fromId) return;

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

  const renderSongCard = (song, idx, isHistory) => {
    const qId = String(song.queueId || song.id);
    const isCurrentActive = !isHistory && idx === 0 && Boolean(currentSong);
    const isProcessing = song.status !== 'ready';
    const isBeingDragged = isDraggingAny && draggedQueueId === qId;
    const isTargetBefore = !isHistory && showPreview && targetQueueId === qId && draggedQueueId !== qId;
    const isTargetAfter = !isHistory && showPreview && targetQueueId === '__END__' && idx === queueSongs.length - 1 && draggedQueueId !== qId;

    return (
      <React.Fragment key={`${isHistory ? 'hist-' : 'queue-'}${qId}`}>
        <div
          className={`song-card queue-card ${isHistory ? 'history-card' : ''} ${isCurrentActive ? (isPlaying ? 'active-playing' : 'active-playing is-paused') : ''} ${isProcessing ? 'queue-card-processing' : ''} ${isBeingDragged ? 'dragging' : ''} ${isBeingDragged && isDragOutside ? 'dragging-remove' : ''} ${isTargetBefore ? 'drop-target-before' : ''} ${isTargetAfter ? 'drop-target-after' : ''}`}
          data-queue-id={qId}
          draggable={!isHistory}
          onDragStart={(e) => !isHistory && handleQueueDragStart(e, qId, song)}
          onDragEnd={handleQueueDragEnd}
          onPointerDown={(e) => handleQueueCardPointerDown(e, song, qId)}
          onDoubleClick={(e) => handleQueueCardDoubleClick(e, song, qId)}
          title="Double-tap to play track"
        >
          {isTargetBefore && (
            <div className="queue-drop-indicator drop-indicator-before" aria-hidden="true">
              <span className="drop-indicator-dot"></span>
              <span className="drop-indicator-line"></span>
            </div>
          )}
          {isTargetAfter && (
            <div className="queue-drop-indicator drop-indicator-after" aria-hidden="true">
              <span className="drop-indicator-dot"></span>
              <span className="drop-indicator-line"></span>
            </div>
          )}
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
                  onClick={() => isHistory ? remove(qId) : handleRemoveQueueSong(qId)}
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
    <div className="queue-component-container" ref={queueContainerRef}>
      {/* Spring Pull Indicator at the very top edge */}
      <div
        className={`queue-spring-indicator ${springOffset > 0 ? 'is-visible' : ''} ${isPulling ? 'is-pulling' : ''}`}
        style={{
          height: `${springOffset}px`,
          opacity: springOffset > 0 ? Math.min(1, springOffset / 18) : 0
        }}
      >
        <div className="queue-spring-pill">
          <i className={`icon-arrow-down ${springOffset >= 36 ? 'icon-rotate-180' : ''}`}></i>
          <span>{springOffset >= 36 ? 'Release for History' : 'Pull for History'}</span>
        </div>
      </div>

      {/* Queue Content: Frozen History Header (when expanded) + Scroll Wrapper */}
      <div
        className={`queue-content-wrapper ${!isPulling ? 'is-animating' : ''}`}
        style={{
          transform: springOffset > 0 ? `translateY(${springOffset}px)` : 'none'
        }}
      >
        {/* Frozen History Title: stays frozen on top when History is expanded */}
        <div className={`history-header-frozen ${isHistoryUnlocked ? 'is-visible' : ''}`}>
          <div className="history-header-frozen-inner">
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
        </div>

        <ScrollShadowWrapper className="queue-scroll-wrapper" scrollRef={queueListRef}>
          <div
            id="queueList"
            ref={queueListRef}
            className={`queue-list ${isHistoryUnlocked ? 'has-history-unlocked' : ''}`}
            onScroll={handleScroll}
            onDragOver={handleListDragOver}
            onDragLeave={handleListDragLeave}
            onDrop={handleListDrop}
          >
            {/* History Section Wrapper (smooth CSS Grid height & opacity transition above Queue, uses any space needed) */}
            <div
              ref={historyWrapperRef}
              className={`history-section-wrapper ${isHistoryUnlocked ? 'is-expanded' : ''}`}
            >
              <div className="history-section-inner">
                <div className="history-section" ref={historySectionRef}>
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

            {/* Queue Section: Header and cards scroll along bottom of history when history is open */}
            <div className="queue-section" ref={queueSectionRef}>
              <div className="queue-header-row">
                <h2>Queue</h2>
              </div>

              <div className="queue-cards-group">
                {queueSongs.length === 0 ? (
                  <div className={`empty-state ${showPreview ? 'drop-target-empty' : ''}`}>
                    {showPreview ? (
                      <>
                        <i className="icon-plus"></i> Drop here to add to queue
                      </>
                    ) : (
                      'No songs in queue. Use the search bar above to add a track!'
                    )}
                  </div>
                ) : (
                  queueSongs.map((song, idx) => renderSongCard(song, idx, false))
                )}
              </div>
            </div>
          </div>
        </ScrollShadowWrapper>
      </div>
    </div>
  );
}
