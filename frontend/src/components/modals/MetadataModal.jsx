import React, { useState, useEffect } from 'react';
import { useModalStore } from '../../stores/useModalStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useQueueStore } from '../../stores/useQueueStore';
import socket, { emitUpdateState } from '../../services/socket';
import { extractColorsFromSongCover, getHighResAlbumArt } from '../../utils/themeColors';
import ScrollShadowWrapper from '../common/ScrollShadowWrapper';

function extractYoutubeId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const str = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i);
  return match ? match[1] : null;
}

export default function MetadataModal() {
  const song = useModalStore((state) => state.metadataModalSong);
  const close = useModalStore((state) => state.closeMetadataModal);

  const currentSong = usePlaybackStore((state) => state.currentSong);
  const loadLibrary = useLibraryStore((state) => state.loadLibrary);
  const loadQueue = useQueueStore((state) => state.loadQueue);

  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeId, setYoutubeId] = useState('');
  const [isFetchingVideo, setIsFetchingVideo] = useState(false);
  const [videoMsg, setVideoMsg] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (song) {
      setTitle(song.title || '');
      setArtist(song.artist || '');
      setCoverUrl(song.albumArt || '');
      const ytId = song.youtubeId || extractYoutubeId(song.youtubeUrl) || '';
      setYoutubeId(ytId);
      setYoutubeUrl(song.youtubeUrl || (ytId ? `https://www.youtube.com/watch?v=${ytId}` : ''));
      setVideoMsg(null);
      setErrorMsg(null);
      setIsFetchingVideo(song.videoStatus === 'fetching');
    }
  }, [song]);

  // Real-time synchronization for parallel background queries across songs
  useEffect(() => {
    if (!song?.id) return;

    const handleSyncState = (state) => {
      if (!state) return;
      const sData = state.songData;
      if (sData && sData.id === song.id) {
        if (sData.videoStatus === 'fetching') {
          setIsFetchingVideo(true);
        } else if (sData.videoStatus === 'ready' || sData.youtubeId) {
          setIsFetchingVideo(false);
          const newYtId = sData.youtubeId || extractYoutubeId(sData.youtubeUrl) || '';
          setYoutubeId(newYtId);
          setYoutubeUrl(sData.youtubeUrl || (newYtId ? `https://www.youtube.com/watch?v=${newYtId}` : ''));
          setVideoMsg({ type: 'success', text: `Linked YouTube video (${newYtId})` });
        } else if (sData.videoStatus === 'error') {
          setIsFetchingVideo(false);
          if (sData.videoError) {
            setVideoMsg({ type: 'error', text: sData.videoError });
          }
        }
      }
    };

    socket.on('sync_state', handleSyncState);
    return () => {
      socket.off('sync_state', handleSyncState);
    };
  }, [song?.id]);

  if (!song) return null;

  const handleFetchVideo = async () => {
    setIsFetchingVideo(true);
    setVideoMsg(null);
    setErrorMsg(null);

    const songName = (title || song.title || '').trim();
    const artistName = (artist || song.artist || '').trim();
    let queryToSend = (youtubeUrl || '').trim();
    const directId = extractYoutubeId(queryToSend);

    // If not a direct YouTube link or 11-char ID, automatically use the song name as part of the query
    if (!directId) {
      if (!queryToSend) {
        queryToSend = `${songName} ${artistName}`.trim();
      } else if (songName && !queryToSend.toLowerCase().includes(songName.toLowerCase())) {
        queryToSend = `${songName} ${queryToSend}`.trim();
      }
    }

    try {
      const res = await fetch(`/api/fetch_video/${song.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          youtubeUrl: queryToSend || undefined,
          title: songName || undefined,
          artist: artistName || undefined
        })
      });
      const data = await res.json();
      if (data.cancelled) {
        return;
      }
      if (data.success && (data.youtubeId || data.youtubeUrl)) {
        const newId = data.youtubeId || extractYoutubeId(data.youtubeUrl);
        setYoutubeId(newId);
        setYoutubeUrl(data.youtubeUrl || `https://www.youtube.com/watch?v=${newId}`);
        setVideoMsg({ type: 'success', text: `Linked YouTube video (${newId})` });
        await loadLibrary();
        await loadQueue();
        if (currentSong && currentSong.id === song.id) {
          const updated = { ...currentSong, youtubeId: newId, youtubeUrl: data.youtubeUrl };
          usePlaybackStore.setState({ currentSong: updated });
          emitUpdateState({ songId: song.id, songData: updated });
        }
      } else {
        setVideoMsg({ type: 'error', text: data.error || 'Failed to find matching YouTube music video' });
      }
    } catch (err) {
      setVideoMsg({ type: 'error', text: err.message || 'Error resolving YouTube video' });
    } finally {
      setIsFetchingVideo(false);
    }
  };

  const handleDeleteVideo = async () => {
    setIsFetchingVideo(true);
    setVideoMsg(null);
    try {
      const res = await fetch(`/api/video/${song.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setYoutubeId('');
        setYoutubeUrl('');
        setVideoMsg({ type: 'info', text: 'Music video unlinked.' });
        await loadLibrary();
        await loadQueue();
        if (currentSong && currentSong.id === song.id) {
          const updated = { ...currentSong, youtubeId: null, youtubeUrl: null, videoStatus: null };
          usePlaybackStore.setState({ currentSong: updated });
          emitUpdateState({ songId: song.id, songData: updated });
        }
      }
    } catch (err) {
      setVideoMsg({ type: 'error', text: err.message || 'Failed to remove video' });
    } finally {
      setIsFetchingVideo(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg(null);

    const formData = new FormData();
    formData.append('songId', song.id);
    formData.append('title', title);
    formData.append('artist', artist);
    formData.append('coverUrl', coverUrl);
    formData.append('youtubeUrl', youtubeUrl.trim());

    try {
      const res = await fetch('/api/edit_metadata', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        // If current playing song, update active state
        if (currentSong && currentSong.id === song.id) {
          const ytId = extractYoutubeId(youtubeUrl);
          const updatedSong = {
            ...currentSong,
            title,
            artist,
            albumArt: coverUrl || currentSong.albumArt,
            youtubeUrl: youtubeUrl.trim() || null,
            youtubeId: ytId || null
          };
          usePlaybackStore.setState({ currentSong: updatedSong });
          const colorSrc = updatedSong.id ? `/api/cover/${updatedSong.id}?t=${Date.now()}` : getHighResAlbumArt(coverUrl);
          extractColorsFromSongCover(colorSrc);
          emitUpdateState({ songId: updatedSong.id, songData: updatedSong });
        }
        await loadLibrary();
        await loadQueue();
        close();
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
      <div className="modal-box modal-metadata-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><i className="icon-pencil" style={{ marginRight: '0.4rem' }}></i> Edit Meta-data</h3>
          <button className="btn-close" onClick={close} title="Close (Esc)"><i className="icon-x"></i></button>
        </div>

        <ScrollShadowWrapper className="modal-body-scroll-wrapper">
          <div className="modal-body">
            {/* Cover Art and Basic Info */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
              <img
                src={coverUrl || '/CtrlAltLyrics-logo.svg'}
                alt="cover preview"
                style={{ width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover', border: '1px solid var(--border)' }}
                onError={(e) => { e.target.onerror = null; e.target.src = '/CtrlAltLyrics-logo.svg'; }}
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

            {/* YouTube Music Video (Online Stream) Section */}
            <div className="metadata-video-section" style={{
              marginTop: '1.25rem',
              padding: '1rem',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.9rem' }}>
                  <i className="icon-video" style={{ color: 'var(--accent)' }}></i> Music Video (Online YouTube)
                </div>
                {isFetchingVideo ? (
                  <span className="status-badge pending"><i className="icon-loader-2 icon-spin"></i> Searching...</span>
                ) : youtubeId ? (
                  <span className="status-badge success"><i className="icon-check"></i> Linked</span>
                ) : (
                  <span className="status-badge" style={{ opacity: 0.6 }}>No Video</span>
                )}
              </div>

              {/* YouTube Video Preview if linked */}
              {youtubeId && (
                <div style={{ marginBottom: '0.85rem' }}>
                  <div style={{
                    position: 'relative',
                    width: '100%',
                    height: '140px',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    backgroundColor: '#000'
                  }}>
                    <img
                      src={`https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`}
                      alt="YouTube thumbnail"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8 }}
                    />
                    <a
                      href={`https://www.youtube.com/watch?v=${youtubeId}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.4rem 0.8rem',
                        borderRadius: '20px',
                        background: 'rgba(0, 0, 0, 0.75)',
                        color: '#fff',
                        textDecoration: 'none',
                        fontSize: '0.8rem',
                        backdropFilter: 'blur(4px)'
                      }}
                    >
                      <i className="icon-play" style={{ color: '#ef4444' }}></i> Watch on YouTube
                    </a>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleDeleteVideo}
                      disabled={isFetchingVideo}
                      style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', color: '#ef4444' }}
                    >
                      <i className="icon-trash-2" style={{ marginRight: '0.3rem' }}></i> Unlink Video
                    </button>
                  </div>
                </div>
              )}

              {/* YouTube Link or Search Query */}
              <div className="form-group" style={{ marginBottom: '0.3rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                  YouTube Link, Video ID, or Search Query:
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={youtubeUrl}
                    onChange={(e) => {
                      const val = e.target.value;
                      setYoutubeUrl(val);
                      const id = extractYoutubeId(val);
                      if (id) setYoutubeId(id);
                    }}
                    placeholder={song?.title ? `Search "${song.title}" or paste YouTube link` : "https://www.youtube.com/watch?v=... or search query"}
                    style={{ flex: 1 }}
                    disabled={isFetchingVideo}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleFetchVideo}
                    disabled={isFetchingVideo}
                    title="Search YouTube for official music video"
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    <i className="icon-search" style={{ marginRight: '0.3rem' }}></i> Search
                  </button>
                </div>
              </div>

              {/* Video feedback message */}
              {videoMsg && (
                <div style={{
                  marginTop: '0.6rem',
                  fontSize: '0.8rem',
                  padding: '0.4rem 0.6rem',
                  borderRadius: '4px',
                  backgroundColor: videoMsg.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : (videoMsg.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.05)'),
                  color: videoMsg.type === 'success' ? '#10b981' : (videoMsg.type === 'error' ? '#ef4444' : 'var(--text-secondary)')
                }}>
                  <i className={videoMsg.type === 'success' ? 'icon-check' : (videoMsg.type === 'error' ? 'icon-alert-triangle' : 'icon-info')} style={{ marginRight: '0.3rem' }}></i>
                  {videoMsg.text}
                </div>
              )}
            </div>

            {errorMsg && (
              <div className="error-state" style={{ marginTop: '0.75rem' }}>
                <i className="icon-alert-triangle" style={{ marginRight: '0.35rem' }}></i> {errorMsg}
              </div>
            )}
          </div>
        </ScrollShadowWrapper>

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
