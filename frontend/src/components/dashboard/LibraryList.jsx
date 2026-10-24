import React, { useState, useRef, useEffect } from 'react';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useQueueStore } from '../../stores/useQueueStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useModalStore } from '../../stores/useModalStore';
import * as api from '../../services/api';
import SongStatusBadges from '../common/SongStatusBadges';

export default function LibraryList() {
  const library = useLibraryStore((state) => state.library);
  const filterQuery = useLibraryStore((state) => state.filterQuery);
  const setFilterQuery = useLibraryStore((state) => state.setFilterQuery);
  const sortKey = useLibraryStore((state) => state.sortKey);
  const sortOrder = useLibraryStore((state) => state.sortOrder);
  const setSort = useLibraryStore((state) => state.setSort);
  const removeSong = useLibraryStore((state) => state.removeSong);
  const getFilteredAndSorted = useLibraryStore((state) => state.getFilteredAndSorted);

  const enqueue = useQueueStore((state) => state.enqueue);
  const setDraggedLibrarySong = useQueueStore((state) => state.setDraggedLibrarySong);

  const currentSong = usePlaybackStore((state) => state.currentSong);

  const openUploadModal = useModalStore((state) => state.openUploadModal);
  const openComponentManager = useModalStore((state) => state.openComponentManager);

  const [showSortMenu, setShowSortMenu] = useState(false);
  const [draggedSongId, setDraggedSongId] = useState(null);
  const sortMenuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target)) {
        setShowSortMenu(false);
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const songs = getFilteredAndSorted();

  const handleOpenSourceLink = (song) => {
    if (song.spotifyUrl) {
      window.open(song.spotifyUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const q = `${song.title || ''} ${song.artist || ''}`.trim();
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = async (id, title) => {
    if (window.confirm(`Are you sure you want to remove "${title || 'this song'}" from your library?`)) {
      await removeSong(id);
    }
  };

  const handleDragStart = (e, song) => {
    if (e.target.closest('button') || e.target.closest('.emoji-btn-group') || e.target.closest('a')) {
      e.preventDefault();
      return;
    }
    setDraggedSongId(song.id);
    setDraggedLibrarySong(song);
    e.dataTransfer.setData('text/plain', String(song.id));
    e.dataTransfer.setData('application/x-ctrlaltlyrics-song-id', String(song.id));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragEnd = () => {
    setDraggedSongId(null);
    setDraggedLibrarySong(null);
  };

  return (
    <>
      <div className="library-header-row">
        <div className="library-title-area">
          <h2>Library</h2>
          <button
            className="btn upload-btn"
            title="Upload Local Audio File (MP3, WAV, M4A, FLAC, etc.)"
            onClick={openUploadModal}
          >
            <i className="icon-upload" style={{ marginRight: '0.3rem' }}></i> Upload
          </button>
        </div>

        <div className="library-controls-group">
          <input
            type="search"
            className="library-filter-input"
            placeholder="Filter..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            autoComplete="off"
          />

          <div className="sort-wrapper" ref={sortMenuRef} style={{ position: 'relative' }}>
            <button
              className="btn sort-btn"
              title="Sort Options"
              onClick={() => setShowSortMenu(!showSortMenu)}
            >
              <i className="icon-arrow-up-down" style={{ marginRight: '0.25rem' }}></i> Sort
            </button>

            {showSortMenu && (
              <div className="sort-menu" style={{ display: 'flex' }}>
                <div className="sort-menu-header">Sort By</div>
                <button
                  className={`sort-option ${sortKey === 'date' ? 'active' : ''}`}
                  onClick={() => { setSort('date'); setShowSortMenu(false); }}
                >
                  <i className="icon-calendar" style={{ marginRight: '0.35rem' }}></i> Date Added
                </button>
                <button
                  className={`sort-option ${sortKey === 'title' ? 'active' : ''}`}
                  onClick={() => { setSort('title'); setShowSortMenu(false); }}
                >
                  <i className="icon-type" style={{ marginRight: '0.35rem' }}></i> Song Title
                </button>
                <button
                  className={`sort-option ${sortKey === 'artist' ? 'active' : ''}`}
                  onClick={() => { setSort('artist'); setShowSortMenu(false); }}
                >
                  <i className="icon-user" style={{ marginRight: '0.35rem' }}></i> Artist Name
                </button>
                <button
                  className={`sort-option ${sortKey === 'missing' ? 'active' : ''}`}
                  onClick={() => { setSort('missing'); setShowSortMenu(false); }}
                >
                  <i className="icon-alert-triangle" style={{ marginRight: '0.35rem' }}></i> Missing / Errors
                </button>
                <div className="sort-menu-divider"></div>
                <div className="sort-order-row">
                  <button
                    className={`sort-order-btn ${sortOrder === 'desc' ? 'active' : ''}`}
                    onClick={() => { setSort(undefined, 'desc'); setShowSortMenu(false); }}
                  >
                    <i className="icon-arrow-down" style={{ marginRight: '0.2rem' }}></i> Descending
                  </button>
                  <button
                    className={`sort-order-btn ${sortOrder === 'asc' ? 'active' : ''}`}
                    onClick={() => { setSort(undefined, 'asc'); setShowSortMenu(false); }}
                  >
                    <i className="icon-arrow-up" style={{ marginRight: '0.2rem' }}></i> Ascending
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div id="libraryList" className="library-list">
        {songs.length === 0 ? (
          <div className="empty-state">
            {filterQuery
              ? `No library items match "${filterQuery}".`
              : 'No songs in library yet. Use search or upload to add tracks!'}
          </div>
        ) : (
          songs.map((song) => {
            const isActive = currentSong && currentSong.id === song.id;
            const isDragging = draggedSongId === song.id;

            return (
              <div
                key={song.id}
                id={`library-song-${song.id}`}
                className={`song-card library-card ${isActive ? 'active-playing' : ''} ${isDragging ? 'library-card-dragging' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, song)}
                onDragEnd={handleDragEnd}
              >
                {/* Row 1: Song Info & Playing Badge */}
                <div className="song-card-header">
                  <div className="song-card-meta">
                    <img
                      src={song.albumArt || '/ctrlaltlyrics-logo.webp'}
                      alt="art"
                      onError={(e) => { e.target.onerror = null; e.target.src = '/ctrlaltlyrics-logo.webp'; }}
                    />
                    <div className="song-info">
                      <div className="song-title">{song.title}</div>
                      <div className="song-artist">{song.artist}</div>
                    </div>
                  </div>
                  {isActive && (
                    <div className="currently-playing-badge" title="Currently Playing">
                      <i className="icon-play" style={{ marginRight: '0.2rem' }}></i>
                      <span className="currently-playing-label">Playing</span>
                    </div>
                  )}
                </div>

                {/* Row 2: Status Badges (Left) & Action Buttons (Right) */}
                <div className="song-card-actions-row">
                  <SongStatusBadges song={song} />
                  <div className="emoji-btn-group">
                    <button
                      className="emoji-btn emoji-btn-accent"
                      onClick={() => enqueue(song)}
                      title="Add to Queue"
                    >
                      <i className="icon-plus"></i>
                    </button>
                    <button
                      className="emoji-btn"
                      onClick={() => api.openFolder(song.id)}
                      title="Open Folder"
                    >
                      <i className="icon-folder"></i>
                    </button>
                    <button
                      className="emoji-btn"
                      onClick={() => openComponentManager(song.id)}
                      title="Component Status & Retry"
                    >
                      <i className="icon-bolt"></i>
                    </button>
                    <button
                      className="emoji-btn"
                      onClick={() => handleOpenSourceLink(song)}
                      title="Open Song Source (Spotify / YouTube)"
                    >
                      <i className="icon-external-link"></i>
                    </button>
                    <button
                      className="emoji-btn emoji-btn-danger"
                      onClick={() => handleDelete(song.id, song.title)}
                      title="Delete from Library"
                    >
                      <i className="icon-trash-2"></i>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
