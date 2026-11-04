import React, { useState, useEffect, useRef } from 'react';
import { useModalStore } from '../../stores/useModalStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useQueueStore } from '../../stores/useQueueStore';
import socket, { emitUpdateState } from '../../services/socket';
import { extractColorsFromSongCover, getHighResAlbumArt } from '../../utils/themeColors';
import ScrollShadowWrapper from '../common/ScrollShadowWrapper';
import { WHISPER_LANGUAGES } from '../../utils/whisperLanguages';

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
  const [language, setLanguage] = useState('auto');
  const [coverUrl, setCoverUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeId, setYoutubeId] = useState('');
  const [videoOffset, setVideoOffset] = useState(0);
  const videoOffsetRef = useRef(0);
  videoOffsetRef.current = videoOffset;

  const committedOffsetRef = useRef(null);
  const prevSongIdRef = useRef(null);

  const [videoDuration, setVideoDuration] = useState(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isFetchingVideo, setIsFetchingVideo] = useState(false);
  const [videoMsg, setVideoMsg] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  // Reset committed reference when opening a different song
  useEffect(() => {
    if (song?.id !== prevSongIdRef.current) {
      prevSongIdRef.current = song?.id;
      committedOffsetRef.current = null;
      setSaveSuccess(false);
    }
  }, [song?.id]);

  useEffect(() => {
    if (song) {
      setTitle(song.title || '');
      setArtist(song.artist || '');
      setLanguage(song.language || 'auto');
      setCoverUrl(song.albumArt || '');
      const ytId = song.youtubeId || extractYoutubeId(song.youtubeUrl) || '';
      setYoutubeId(ytId);
      setYoutubeUrl(song.youtubeUrl || (ytId ? `https://www.youtube.com/watch?v=${ytId}` : ''));
      setVideoMsg(null);
      setErrorMsg(null);
      setIsFetchingVideo(song.videoStatus === 'fetching');

      const aDur = song.duration || (currentSong && currentSong.id === song.id ? currentSong.duration : 0) || 0;
      setAudioDuration(aDur);

      const vDur = song.videoDuration || null;
      setVideoDuration(vDur);

      const songStoredOffset = (typeof song.videoOffset === 'number')
        ? song.videoOffset
        : ((song.videoOffset !== undefined && song.videoOffset !== null && song.videoOffset !== '')
            ? parseFloat(song.videoOffset)
            : null);

      const activeOffset = (currentSong && currentSong.id === song.id && typeof currentSong.videoOffset === 'number')
        ? currentSong.videoOffset
        : null;

      const initialOffset = activeOffset !== null
        ? activeOffset
        : (songStoredOffset !== null && !isNaN(songStoredOffset)
            ? songStoredOffset
            : (vDur && aDur > 0 ? Number((vDur - aDur).toFixed(2)) : 0));

      setVideoOffset(initialOffset);
      videoOffsetRef.current = initialOffset;

      if (committedOffsetRef.current === null) {
        committedOffsetRef.current = initialOffset;
      }

      // If YouTube ID is linked, query /api/video_url/:id to get accurate stream duration and endsMatchOffset
      if (ytId) {
        fetch(`/api/video_url/${ytId}?songId=${song.id}`)
          .then((res) => res.json())
          .then((data) => {
            if (data && data.success) {
              if (data.videoDuration) {
                setVideoDuration(data.videoDuration);
              }
              if (data.audioDuration && !aDur) {
                setAudioDuration(data.audioDuration);
              }
              if (songStoredOffset === null && activeOffset === null && data.endsMatchOffset !== null && data.endsMatchOffset !== undefined) {
                setVideoOffset(data.endsMatchOffset);
                videoOffsetRef.current = data.endsMatchOffset;
                if (committedOffsetRef.current === null) {
                  committedOffsetRef.current = data.endsMatchOffset;
                }
              }
            }
          })
          .catch(() => {});
      }
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
          if (sData.videoDuration) {
            setVideoDuration(sData.videoDuration);
          }
          if (typeof sData.videoOffset === 'number') {
            setVideoOffset(sData.videoOffset);
          }
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

  // When youtubeId changes and videoDuration is not known yet, retrieve stream info
  useEffect(() => {
    if (!youtubeId || !song?.id) {
      return;
    }
    fetch(`/api/video_url/${youtubeId}?songId=${song.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success) {
          if (data.videoDuration) {
            setVideoDuration(data.videoDuration);
          }
          if (data.audioDuration && !audioDuration) {
            setAudioDuration(data.audioDuration);
          }
          if ((song?.videoOffset === undefined || song?.videoOffset === null) && data.endsMatchOffset !== null && data.endsMatchOffset !== undefined) {
            setVideoOffset(data.endsMatchOffset);
          }
        }
      })
      .catch(() => {});
  }, [youtubeId, song?.id]);

  // Revert offset if editor exits/unmounts without saving (e.g. Escape key in DashboardApp)
  useEffect(() => {
    return () => {
      const committed = committedOffsetRef.current;
      const cur = videoOffsetRef.current;
      if (committed !== null && cur !== committed && song?.id) {
        const activeCurrentSong = usePlaybackStore.getState().currentSong;
        if (activeCurrentSong && activeCurrentSong.id === song.id) {
          const reverted = {
            ...activeCurrentSong,
            videoOffset: committed
          };
          usePlaybackStore.setState({ currentSong: reverted });
          emitUpdateState({
            songId: activeCurrentSong.id,
            queueId: activeCurrentSong.queueId || usePlaybackStore.getState().currentQueueId || null,
            songData: reverted
          });
        }
      }
    };
  }, [song?.id]);

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

        if (data.videoDuration) {
          setVideoDuration(data.videoDuration);
        }
        const effAudio = audioDuration || song.duration || (currentSong && currentSong.id === song.id ? currentSong.duration : 0) || 0;
        let newOffset = videoOffset;
        if (typeof data.videoOffset === 'number') {
          newOffset = data.videoOffset;
        } else if (data.videoDuration && effAudio > 0) {
          newOffset = Number((data.videoDuration - effAudio).toFixed(2));
        }

        applyOffsetChange(newOffset);
        committedOffsetRef.current = newOffset;

        await loadLibrary();
        await loadQueue();
        if (currentSong && currentSong.id === song.id) {
          const updated = {
            ...currentSong,
            youtubeId: newId,
            youtubeUrl: data.youtubeUrl,
            videoDuration: data.videoDuration || currentSong.videoDuration,
            videoOffset: newOffset
          };
          usePlaybackStore.setState({ currentSong: updated });
          emitUpdateState({
            songId: song.id,
            queueId: currentSong.queueId || usePlaybackStore.getState().currentQueueId || null,
            songData: updated
          });
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
        setVideoDuration(null);
        committedOffsetRef.current = 0;
        applyOffsetChange(0);
        setVideoMsg({ type: 'info', text: 'Music video unlinked.' });
        await loadLibrary();
        await loadQueue();
        if (currentSong && currentSong.id === song.id) {
          const updated = {
            ...currentSong,
            youtubeId: null,
            youtubeUrl: null,
            videoStatus: null,
            videoDuration: null,
            videoOffset: 0
          };
          usePlaybackStore.setState({ currentSong: updated });
          emitUpdateState({
            songId: song.id,
            queueId: currentSong.queueId || usePlaybackStore.getState().currentQueueId || null,
            songData: updated
          });
        }
      }
    } catch (err) {
      setVideoMsg({ type: 'error', text: err.message || 'Failed to remove video' });
    } finally {
      setIsFetchingVideo(false);
    }
  };

  const applyOffsetChange = (newVal) => {
    const parsed = Number(Number(newVal).toFixed(2));
    videoOffsetRef.current = parsed;
    setVideoOffset(parsed);
    setSaveSuccess(false);

    // Live preview on active playing song (noticed in display as saves are)
    const activeCurrentSong = usePlaybackStore.getState().currentSong;
    if (activeCurrentSong && activeCurrentSong.id === song?.id) {
      const updated = {
        ...activeCurrentSong,
        videoOffset: parsed
      };
      usePlaybackStore.setState({ currentSong: updated });
      emitUpdateState({
        songId: activeCurrentSong.id,
        queueId: activeCurrentSong.queueId || usePlaybackStore.getState().currentQueueId || null,
        songData: updated
      });
    }
  };

  const handleExitModal = () => {
    const committed = committedOffsetRef.current;
    if (committed !== null && videoOffsetRef.current !== committed) {
      const activeCurrentSong = usePlaybackStore.getState().currentSong;
      if (activeCurrentSong && activeCurrentSong.id === song?.id) {
        const reverted = {
          ...activeCurrentSong,
          videoOffset: committed
        };
        usePlaybackStore.setState({ currentSong: reverted });
        emitUpdateState({
          songId: activeCurrentSong.id,
          queueId: activeCurrentSong.queueId || usePlaybackStore.getState().currentQueueId || null,
          songData: reverted
        });
      }
    }
    close();
  };

  // Dedicated captured keyboard listener for modal
  useEffect(() => {
    if (!song) return;

    const handleKeyDown = (e) => {
      // Escape: Close and revert if unsaved
      if (e.key === 'Escape') {
        const isTextInput = e.target && (
          (e.target.tagName === 'INPUT' && e.target.type !== 'range') ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable
        );
        if (isTextInput) {
          e.target.blur();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        handleExitModal();
        return;
      }

      // Space: Toggle play/pause only if not inside text input
      if (e.code === 'Space') {
        const isTextInput = e.target && (
          (e.target.tagName === 'INPUT' && e.target.type !== 'range') ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable
        );
        if (isTextInput) return;

        e.preventDefault();
        e.stopPropagation();
        if (e.target && typeof e.target.blur === 'function') {
          e.target.blur();
        }
        usePlaybackStore.getState().togglePlayPause();
        return;
      }

      // Stop range slider Arrow keys from seeking audio or triggering other shortcuts
      if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'range') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [song, handleExitModal]);

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMsg(null);
    setSaveSuccess(false);

    const formData = new FormData();
    formData.append('songId', song.id);
    formData.append('title', title);
    formData.append('artist', artist);
    formData.append('language', language);
    formData.append('coverUrl', coverUrl);
    formData.append('youtubeUrl', youtubeUrl.trim());
    formData.append('videoOffset', videoOffset !== undefined && videoOffset !== null ? videoOffset : 0);
    if (videoDuration !== null && videoDuration !== undefined) {
      formData.append('videoDuration', videoDuration);
    }

    try {
      const res = await fetch('/api/edit_metadata', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        // Finalize metadata offset: committing prevents reversion on exit
        committedOffsetRef.current = videoOffset;

        // If current playing song, update active state
        if (currentSong && currentSong.id === song.id) {
          const ytId = extractYoutubeId(youtubeUrl);
          const updatedSong = {
            ...currentSong,
            title,
            artist,
            language: language === 'auto' ? null : language,
            albumArt: coverUrl || currentSong.albumArt,
            youtubeUrl: youtubeUrl.trim() || null,
            youtubeId: ytId || null,
            videoOffset: typeof videoOffset === 'number' ? videoOffset : (parseFloat(videoOffset) || 0),
            videoDuration: videoDuration || null
          };
          usePlaybackStore.setState({ currentSong: updatedSong });
          const colorSrc = updatedSong.id ? `/api/cover/${updatedSong.id}?t=${Date.now()}` : getHighResAlbumArt(coverUrl);
          extractColorsFromSongCover(colorSrc);
          emitUpdateState({
            songId: updatedSong.id,
            queueId: updatedSong.queueId || usePlaybackStore.getState().currentQueueId || null,
            songData: updatedSong
          });
        }
        await loadLibrary();
        await loadQueue();

        // Finalize without exiting editor
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      } else {
        setErrorMsg('Failed to save metadata');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Error saving metadata');
    } finally {
      setIsSaving(false);
    }
  };

  const endsMatch = (videoDuration && audioDuration > 0)
    ? Number((videoDuration - audioDuration).toFixed(2))
    : null;

  const minSlider = Math.min(-60, Math.floor(Math.min(0, endsMatch ?? 0, videoOffset ?? 0) - 15));
  const maxSlider = Math.max(60, Math.ceil(Math.max(0, endsMatch ?? 0, videoOffset ?? 0) + 15));

  const formatDurationSec = (sec) => {
    if (!sec || isNaN(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleSliderChange = (rawVal) => {
    const val = parseFloat(rawVal);
    if (isNaN(val)) return;

    const SNAP_THRESHOLD = 1.2;
    let snapped = val;

    const distZero = Math.abs(val - 0);
    const distEnds = endsMatch !== null ? Math.abs(val - endsMatch) : Infinity;

    if (distZero <= SNAP_THRESHOLD && distZero <= distEnds) {
      snapped = 0;
    } else if (distEnds <= SNAP_THRESHOLD && distEnds < distZero) {
      snapped = endsMatch;
    }

    applyOffsetChange(Number(snapped.toFixed(2)));
  };

  const nudgeOffset = (delta) => {
    const cur = typeof videoOffsetRef.current === 'number' ? videoOffsetRef.current : (parseFloat(videoOffsetRef.current) || 0);
    applyOffsetChange(Number((cur + delta).toFixed(2)));
  };

  if (!song) return null;

  return (
    <div className="modal-backdrop" style={{ display: 'flex', zIndex: 3000 }} onClick={handleExitModal}>
      <div className="modal-box modal-metadata-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><i className="icon-pencil" style={{ marginRight: '0.4rem' }}></i> Edit Meta-data</h3>
          <button className="btn-close" onClick={handleExitModal} title="Close (Esc)"><i className="icon-x"></i></button>
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

            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Song Language (Whisper AI):</label>
              <select
                className="select-input"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                style={{ width: '100%' }}
              >
                {WHISPER_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
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

              {/* Music Video Start Offset Control */}
              {youtubeId && (
                <div className="video-offset-controls" style={{
                  marginBottom: '1rem',
                  padding: '0.75rem 0.85rem',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                    fontSize: '0.8rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500 }}>
                      <i className="icon-sliders" style={{ color: 'var(--accent)' }}></i>
                      <span>Video Start Offset:</span>
                      <span style={{
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        fontSize: '0.88rem',
                        color: 'var(--accent)',
                        background: 'rgba(255, 255, 255, 0.06)',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '4px'
                      }}>
                        {videoOffset > 0 ? `+${videoOffset.toFixed(1)}s` : `${videoOffset.toFixed(1)}s`}
                      </span>
                    </div>

                    {(videoDuration || audioDuration > 0) && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                        {videoDuration ? `Video: ${formatDurationSec(videoDuration)}` : ''}
                        {videoDuration && audioDuration > 0 ? ' · ' : ''}
                        {audioDuration > 0 ? `Audio: ${formatDurationSec(audioDuration)}` : ''}
                      </div>
                    )}
                  </div>

                  {/* Slider Input with Magnetic Snapping */}
                  <div style={{ position: 'relative', margin: '0.35rem 0' }}>
                    <input
                      type="range"
                      min={minSlider}
                      max={maxSlider}
                      step="0.1"
                      value={videoOffset}
                      onChange={(e) => handleSliderChange(e.target.value)}
                      style={{
                        width: '100%',
                        cursor: 'pointer',
                        accentColor: 'var(--accent)'
                      }}
                    />
                  </div>

                  {/* Snap points (calculated values only) & fine-tune nudges */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '0.4rem',
                    flexWrap: 'wrap',
                    gap: '0.4rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginRight: '0.1rem' }}>Snap:</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => applyOffsetChange(0)}
                        style={{
                          fontSize: '0.72rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontFamily: 'monospace',
                          fontWeight: Math.abs(videoOffset) < 0.05 ? 700 : 400,
                          borderColor: Math.abs(videoOffset) < 0.05 ? 'var(--accent)' : 'var(--border)',
                          color: Math.abs(videoOffset) < 0.05 ? 'var(--accent)' : 'inherit',
                          backgroundColor: Math.abs(videoOffset) < 0.05 ? 'rgba(99, 102, 241, 0.15)' : 'transparent'
                        }}
                        title="Snap to 0.0s"
                      >
                        0.0s
                      </button>

                      {endsMatch !== null && Math.abs(endsMatch) >= 0.05 && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => applyOffsetChange(endsMatch)}
                          style={{
                            fontSize: '0.72rem',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            fontFamily: 'monospace',
                            fontWeight: Math.abs(videoOffset - endsMatch) < 0.05 ? 700 : 400,
                            borderColor: Math.abs(videoOffset - endsMatch) < 0.05 ? 'var(--accent)' : 'var(--border)',
                            color: Math.abs(videoOffset - endsMatch) < 0.05 ? 'var(--accent)' : 'inherit',
                            backgroundColor: Math.abs(videoOffset - endsMatch) < 0.05 ? 'rgba(99, 102, 241, 0.15)' : 'transparent'
                          }}
                          title={`Snap to calculated offset: ${endsMatch > 0 ? '+' : ''}${endsMatch.toFixed(1)}s`}
                        >
                          {endsMatch > 0 ? `+${endsMatch.toFixed(1)}s` : `${endsMatch.toFixed(1)}s`}
                        </button>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => nudgeOffset(-0.5)}
                        style={{ fontSize: '0.7rem', padding: '0.15rem 0.35rem', minWidth: 'auto' }}
                        title="-0.5s"
                      >
                        -0.5s
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => nudgeOffset(-0.1)}
                        style={{ fontSize: '0.7rem', padding: '0.15rem 0.35rem', minWidth: 'auto' }}
                        title="-0.1s"
                      >
                        -0.1s
                      </button>
                      <input
                        type="number"
                        step="0.1"
                        value={videoOffset}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          applyOffsetChange(isNaN(val) ? 0 : Number(val.toFixed(2)));
                        }}
                        style={{
                          width: '56px',
                          fontSize: '0.72rem',
                          padding: '0.15rem 0.25rem',
                          textAlign: 'center',
                          fontFamily: 'monospace',
                          borderRadius: '4px',
                          border: '1px solid var(--border)'
                        }}
                        title="Direct offset in seconds"
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => nudgeOffset(0.1)}
                        style={{ fontSize: '0.7rem', padding: '0.15rem 0.35rem', minWidth: 'auto' }}
                        title="+0.1s"
                      >
                        +0.1s
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => nudgeOffset(0.5)}
                        style={{ fontSize: '0.7rem', padding: '0.15rem 0.35rem', minWidth: 'auto' }}
                        title="+0.5s"
                      >
                        +0.5s
                      </button>
                    </div>
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

        <div className="modal-footer" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
          <div>
            {saveSuccess && (
              <span style={{
                color: '#10b981',
                fontSize: '0.82rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontWeight: 500
              }}>
                <i className="icon-check"></i> Meta-data finalized
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={handleExitModal} disabled={isSaving}>
              Close
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isSaving}
              style={{
                backgroundColor: saveSuccess ? '#10b981' : undefined,
                borderColor: saveSuccess ? '#10b981' : undefined,
                transition: 'all 0.2s ease'
              }}
            >
              {isSaving ? (
                <>
                  <i className="icon-loader-2 icon-spin" style={{ marginRight: '0.35rem' }}></i>
                  Saving...
                </>
              ) : saveSuccess ? (
                <>
                  <i className="icon-check" style={{ marginRight: '0.35rem' }}></i>
                  Finalized
                </>
              ) : (
                'Save Meta-data'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
