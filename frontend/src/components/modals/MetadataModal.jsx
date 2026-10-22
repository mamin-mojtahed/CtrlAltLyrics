import React, { useState, useEffect } from 'react';
import { useModalStore } from '../../stores/useModalStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useQueueStore } from '../../stores/useQueueStore';
import { emitUpdateState } from '../../services/socket';
import { extractColorsFromSongCover, getHighResAlbumArt } from '../../utils/themeColors';

export default function MetadataModal() {
  const song = useModalStore((state) => state.metadataModalSong);
  const close = useModalStore((state) => state.closeMetadataModal);
  const openComponentManager = useModalStore((state) => state.openComponentManager);

  const currentSong = usePlaybackStore((state) => state.currentSong);
  const selectSong = usePlaybackStore((state) => state.selectSong);
  const loadLibrary = useLibraryStore((state) => state.loadLibrary);
  const loadQueue = useQueueStore((state) => state.loadQueue);

  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (song) {
      setTitle(song.title || '');
      setArtist(song.artist || '');
      setCoverUrl(song.albumArt || '');
      setErrorMsg(null);
    }
  }, [song]);

  if (!song) return null;

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg(null);

    const formData = new FormData();
    formData.append('songId', song.id);
    formData.append('title', title);
    formData.append('artist', artist);
    formData.append('coverUrl', coverUrl);

    try {
      const res = await fetch('/api/edit_metadata', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        // If current playing song, update active state
        if (currentSong && currentSong.id === song.id) {
          const updatedSong = { ...currentSong, title, artist, albumArt: coverUrl || currentSong.albumArt };
          usePlaybackStore.setState({ currentSong: updatedSong });
          const colorSrc = updatedSong.id ? `/api/cover/${updatedSong.id}?t=${Date.now()}` : getHighResAlbumArt(coverUrl);
          extractColorsFromSongCover(colorSrc);
          emitUpdateState({ songId: updatedSong.id, songData: updatedSong });
        }
        await loadLibrary();
        await loadQueue();
        close();
        openComponentManager(song.id);
      } else {
        setErrorMsg('Failed to save metadata');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Error saving metadata');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{ display: 'flex', zIndex: 3000 }} onClick={close}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><i className="icon-pencil" style={{ marginRight: '0.4rem' }}></i> Edit Meta-data</h3>
          <button className="btn-close" onClick={close}><i className="icon-x"></i></button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
            <img
              src={coverUrl || '/ctrlaltlyrics-logo.webp'}
              alt="cover preview"
              style={{ width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover', border: '1px solid var(--border)' }}
              onError={(e) => { e.target.onerror = null; e.target.src = '/ctrlaltlyrics-logo.webp'; }}
            />
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Cover Art URL:</label>
              <input
                type="text"
                value={coverUrl}
                onChange={(e) => setCoverUrl(e.target.value)}
                placeholder="https://example.com/cover.jpg"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Song Title:</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Song title"
              style={{ width: '100%' }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Artist Name:</label>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Artist name"
              style={{ width: '100%' }}
            />
          </div>

          {errorMsg && (
            <div className="error-state" style={{ marginTop: '0.5rem' }}>
              <i className="icon-alert-triangle" style={{ marginRight: '0.35rem' }}></i> {errorMsg}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={close} disabled={isSaving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Meta-data'}
          </button>
        </div>
      </div>
    </div>
  );
}
