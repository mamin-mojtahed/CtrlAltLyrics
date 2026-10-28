import React, { useState, useRef, useEffect } from 'react';
import { useQueueStore } from '../../stores/useQueueStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useLibraryStore } from '../../stores/useLibraryStore';

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
  } else if (song.status === 'fetching_lyrics') {
    icons = (
      <>
        <i className="icon-loader-2 icon-spin" />
        <i className="icon-file-text" />
      </>
    );
    statusClass = 'status-lyrics';
    tooltip = 'Fetching lyrics...';
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

  const queueListRef = useRef(null);
  const lastTapRef = useRef({ time: 0, x: 0, y: 0, id: null });

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
      }
    }
  };

  const showPreview = isDraggingAny && !isDragOutside && !!targetQueueId;
  const draggedTitle = draggedLibrarySong?.title ||
    queue.find(s => String(s.queueId || s.id) === String(draggedQueueId))?.title ||
    'Track';

  return (
    <>
      <div className="queue-header-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>Queue</h2>
        <div
          id="queueDragOutHint"
          className={`queue-drag-out-hint ${isDragOutside ? 'active' : ''}`}
          style={{ display: draggedQueueId !== null ? 'inline-flex' : 'none' }}
        >
          <i className="icon-trash-2" style={{ marginRight: '0.25rem' }}></i> Drag outside to remove
        </div>
      </div>

      <div
        id="queueList"
        ref={queueListRef}
        className="queue-list"
        onDragOver={handleListDragOver}
        onDragLeave={handleListDragLeave}
        onDrop={handleListDrop}
      >
        {queue.length === 0 && !isDraggingAny ? (
          <div className="empty-state">No songs in queue. Use the search bar above to add a track!</div>
        ) : (
          <>
            {queue.map((song, idx) => {
              const qId = String(song.queueId || song.id);
              const activeQueueId = currentQueueId || currentSong?.queueId;
              let isActive = false;
              if (activeQueueId && song.queueId) {
                isActive = String(song.queueId) === String(activeQueueId);
              } else if (currentSong && song.id && String(currentSong.id) === String(song.id)) {
                const firstMatchIdx = queue.findIndex(s => String(s.id) === String(currentSong.id));
                isActive = idx === firstMatchIdx;
              }
              const isProcessing = song.status !== 'ready';
              const isBeingDragged = isDraggingAny && draggedQueueId === qId;
              const isTargetBefore = showPreview && targetQueueId === qId;

              return (
                <React.Fragment key={qId}>
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
                    className={`song-card queue-card ${isActive ? (isPlaying ? 'active-playing' : 'active-playing is-paused') : ''} ${isProcessing ? 'queue-card-processing' : ''} ${isBeingDragged ? 'dragging' : ''} ${isBeingDragged && isDragOutside ? 'dragging-remove' : ''}`}
                    data-queue-id={qId}
                    draggable
                    onDragStart={(e) => handleQueueDragStart(e, qId, song)}
                    onDragEnd={handleQueueDragEnd}
                    onPointerDown={(e) => handleQueueCardPointerDown(e, song, qId)}
                    onDoubleClick={(e) => handleQueueCardDoubleClick(e, song, qId)}
                    title="Double-tap to play track"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1, minWidth: 0 }}>
                        <div className="queue-reorder-col" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="queue-arrow-btn"
                            onClick={() => reorderItem(qId, 'up')}
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
                            onClick={() => reorderItem(qId, 'down')}
                            disabled={idx === queue.length - 1}
                            title="Move Down"
                            aria-label="Move Down"
                          >
                            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                          </button>
                        </div>

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
                        {isActive ? (
                          <div
                            className={`currently-playing-badge ${isPlaying ? 'is-playing' : 'is-paused'}`}
                            title={isPlaying ? "Currently Playing" : "Currently Paused"}
                            aria-label={isPlaying ? "Currently Playing" : "Currently Paused"}
                          >
                            <i className={isPlaying ? "icon-play" : "icon-pause"}></i>
                          </div>
                        ) : (
                          isProcessing && <QueueStatusBadge song={song} />
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
                            title="Remove from Queue"
                            aria-label="Remove from Queue"
                          >
                            <i className="icon-x"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}

            {/* Show preview placeholder at the end of the queue if targeted */}
            {showPreview && targetQueueId === '__END__' && (
              <div className="song-card queue-card queue-drop-placeholder">
                <i className="icon-plus"></i>
                <span className="placeholder-text">
                  Insert: <strong>{draggedTitle}</strong>
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating Drag Remove Toast */}
      {isDragOutside && draggedQueueId !== null && (
        <div id="queueRemoveToast" className="queue-remove-toast" style={{ display: 'flex' }}>
          <i className="icon-trash-2"></i> Drop here to remove from queue
        </div>
      )}
    </>
  );
}
