import React, { useState, useEffect, useRef } from 'react';
import { useModalStore } from '../../stores/useModalStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import * as api from '../../services/api';
import socket from '../../services/socket';
import ScrollShadowWrapper from '../common/ScrollShadowWrapper';
import { WHISPER_LANGUAGES, WHISPER_MODELS, getWhisperLanguageLabel } from '../../utils/whisperLanguages';

const modeLabels = {
  balanced: 'Balanced (~30s)',
  fast: 'Fast (~10s)',
  high: 'High Precision (~60s)',
  ultra: 'Ultra Quality (~2m)'
};

const primaryModels = {
  fast: 'UVR-MDX-NET-Inst_1.onnx',
  balanced: 'UVR-MDX-NET-Inst_HQ_3.onnx',
  high: 'MDX23C-InstVoc HQ',
  ultra: 'BS-Roformer-Viperx-1297'
};

export default function ComponentManagerModal() {
  const songId = useModalStore((state) => state.componentManagerSongId);
  const close = useModalStore((state) => state.closeComponentManager);
  const openMetadataModal = useModalStore((state) => state.openMetadataModal);
  const openLyricsSyncModal = useModalStore((state) => state.openLyricsSyncModal);
  const openStemEditorModal = useModalStore((state) => state.openStemEditorModal);
  const currentSong = usePlaybackStore((state) => state.currentSong);

  const [song, setSong] = useState(null);
  const [components, setComponents] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Download options
  const [dlSource, setDlSource] = useState('auto');
  const [dlLoading, setDlLoading] = useState(false);
  const [dlStatusMsg, setDlStatusMsg] = useState(null);
  const reuploadInputRef = useRef(null);

  // Splitting options
  const [customSep, setCustomSep] = useState(false);
  const [sepMode, setSepMode] = useState('balanced');
  const [sepFormat, setSepFormat] = useState('MP3');
  const [sepBitrate, setSepBitrate] = useState('192k');
  const [spLoading, setSpLoading] = useState(false);
  const [spStatusMsg, setSpStatusMsg] = useState(null);

  // Lyrics options
  const [lyricsProvider, setLyricsProvider] = useState('auto');
  const [manualLyrics, setManualLyrics] = useState('');
  const [lyLoading, setLyLoading] = useState(false);
  const [lyStatusMsg, setLyStatusMsg] = useState(null);

  // AI Auto-Lyrics state (Whisper Engine)
  const [aiProcessingMap, setAiProcessingMap] = useState({}); // { [songId]: 'sync' | 'generate' }
  const [aiProgressMap, setAiProgressMap] = useState({}); // { [songId]: { percent, stage, message } }
  const aiProcessing = (songId && aiProcessingMap[songId]) || null;
  const aiProgress = (songId && aiProgressMap[songId]) || { percent: 0, stage: '', message: '' };

  const [whisperModel, setWhisperModel] = useState('small');
  const [whisperLanguage, setWhisperLanguage] = useState('auto');
  const [isSavingLang, setIsSavingLang] = useState(false);
  const [langSavedFeedback, setLangSavedFeedback] = useState(false);

  // Spotify session cookie options
  const [spotifyCookieStatus, setSpotifyCookieStatus] = useState({ configured: false, maskedCookie: null });
  const [showCookieInput, setShowCookieInput] = useState(false);
  const [cookieInputVal, setCookieInputVal] = useState('');
  const [savingCookie, setSavingCookie] = useState(false);
  const [cookieMsg, setCookieMsg] = useState(null);

  const checkSpotifyCookie = async () => {
    try {
      const status = await api.getSpotifyCookieStatus();
      setSpotifyCookieStatus(status);
    } catch (e) {
      console.error('Failed to load Spotify cookie status:', e);
    }
  };

  const handleSaveSpotifyCookie = async (valToSave = null) => {
    setSavingCookie(true);
    setCookieMsg(null);
    try {
      const val = valToSave !== null ? valToSave : cookieInputVal;
      const res = await api.saveSpotifyCookie(val);
      setSpotifyCookieStatus({ configured: res.configured, maskedCookie: res.maskedCookie });
      setCookieMsg({ type: 'success', text: res.configured ? 'Spotify cookie updated!' : 'Spotify cookie cleared.' });
      if (!res.configured) setCookieInputVal('');
      setTimeout(() => setCookieMsg(null), 3500);
      setShowCookieInput(false);
    } catch (err) {
      setCookieMsg({ type: 'error', text: err.message || 'Failed to save cookie' });
    } finally {
      setSavingCookie(false);
    }
  };

  const loadDetails = async () => {
    if (!songId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.fetchSongDetails(songId);
      setSong(data.song);
      setComponents(data.components || {});
      if (data.components?.lyrics?.activeJob) {
        const job = data.components.lyrics.activeJob;
        setAiProcessingMap(prev => ({ ...prev, [songId]: job.action || 'sync' }));
        if (job.progress) {
          setAiProgressMap(prev => ({
            ...prev,
            [songId]: {
              percent: job.progress.percent !== undefined ? job.progress.percent : 0,
              stage: job.progress.stage || '',
              message: job.progress.message || ''
            }
          }));
        }
      } else {
        setAiProcessingMap(prev => {
          if (!prev[songId]) return prev;
          const updated = { ...prev };
          delete updated[songId];
          return updated;
        });
      }
      if (data.song?.language) {
        setWhisperLanguage(data.song.language);
      } else {
        setWhisperLanguage('auto');
      }
      if (data.song?.engineSettings) {
        setSepMode(data.song.engineSettings.mode || 'balanced');
        setSepFormat(data.song.engineSettings.format || 'MP3');
        setSepBitrate(data.song.engineSettings.bitrate || '192k');
      }
      if (currentSong && currentSong.id === songId && data.song) {
        usePlaybackStore.setState({ currentSong: { ...currentSong, ...data.song } });
      }
    } catch (err) {
      setError(err.message || 'Error loading song details');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (songId) {
      loadDetails();
      checkSpotifyCookie();
    }
  }, [songId]);

  // Socket listener for AI Auto-Lyrics progress and completion
  useEffect(() => {
    const handleAutoProgress = (data) => {
      if (data && data.songId) {
        if (data.cancelled) {
          setAiProcessingMap(prev => {
            const next = { ...prev };
            delete next[data.songId];
            return next;
          });
          setAiProgressMap(prev => ({
            ...prev,
            [data.songId]: { percent: 0, stage: '', message: 'Cancelled' }
          }));
        } else {
          if (data.action) {
            setAiProcessingMap(prev => ({ ...prev, [data.songId]: data.action }));
          }
          setAiProgressMap(prev => ({
            ...prev,
            [data.songId]: {
              percent: data.percent !== undefined ? data.percent : 0,
              stage: data.stage || '',
              message: data.message || ''
            }
          }));
        }
      }
    };

    const handleLyricsUpdated = (data) => {
      if (data && data.songId) {
        setAiProcessingMap(prev => {
          const next = { ...prev };
          delete next[data.songId];
          return next;
        });
        if (data.songId === songId) {
          loadDetails();
        }
      }
    };

    socket.on('auto_lyrics_progress', handleAutoProgress);
    socket.on('lyrics_updated', handleLyricsUpdated);

    return () => {
      socket.off('auto_lyrics_progress', handleAutoProgress);
      socket.off('lyrics_updated', handleLyricsUpdated);
    };
  }, [songId]);

  if (!songId) return null;

  const handleRetryDl = async () => {
    if (dlSource === 'reupload') {
      if (reuploadInputRef.current) reuploadInputRef.current.click();
      return;
    }
    setDlLoading(true);
    const sourceDesc = dlSource === 'spotdl' ? 'SpotDL Studio' : (dlSource === 'ytdlp' ? 'yt-dlp backup' : 'SpotDL priority');
    setDlStatusMsg(`Downloading audio track (${sourceDesc})... please wait...`);
    try {
      await api.retryDownload(songId, dlSource);
      await loadDetails();
      setDlStatusMsg(null);
    } catch (err) {
      setDlStatusMsg(`Download failed: ${err.message}`);
    } finally {
      setDlLoading(false);
    }
  };

  const handleOpenSourceFile = async () => {
    try {
      await api.openAudioFile(songId);
    } catch (err) {
      console.warn('Could not locate audio file in file explorer:', err);
    }
  };

  const handleFileReuploadChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setDlLoading(true);
    setDlStatusMsg(`Reuploading audio file "${file.name}"... please wait...`);
    try {
      await api.reuploadAudio(songId, file);
      await loadDetails();
      setDlStatusMsg(null);
    } catch (err) {
      setDlStatusMsg(`Reupload failed: ${err.message}`);
    } finally {
      setDlLoading(false);
      if (reuploadInputRef.current) reuploadInputRef.current.value = '';
    }
  };

  const handleRetrySplitting = async () => {
    setSpLoading(true);
    setSpStatusMsg(`Running AI 3-stem separation [${sepMode.toUpperCase()}, ${sepFormat} ${sepBitrate}]... please wait...`);
    try {
      await api.retrySplitting(songId, {
        mode: sepMode,
        format: sepFormat,
        bitrate: sepBitrate,
        isCustom: customSep
      });
      await loadDetails();
      setSpStatusMsg(null);
    } catch (err) {
      setSpStatusMsg(`Splitting failed: ${err.message}`);
    } finally {
      setSpLoading(false);
    }
  };

  const handleRefetchSubtitles = async (mode = 'both') => {
    setLyLoading(true);
    const modeDesc = mode === 'translation'
      ? 'English translation'
      : (mode === 'transliteration' ? 'romanized transliteration' : 'translation & transliteration');
    setLyStatusMsg(`Re-fetching ${modeDesc}... please wait...`);
    try {
      await api.refetchLyricsSubtitles(songId, mode);
      await loadDetails();
      setLyStatusMsg(null);
    } catch (err) {
      setLyStatusMsg(`Subtitles re-fetch failed: ${err.message}`);
    } finally {
      setLyLoading(false);
    }
  };

  const handleRetryLyrics = async () => {
    if (lyricsProvider.startsWith('refetch_')) {
      const mode = lyricsProvider.replace('refetch_', '');
      return handleRefetchSubtitles(mode);
    }
    setLyLoading(true);
    const provLabel = lyricsProvider === 'auto' ? 'Auto providers' : lyricsProvider;
    setLyStatusMsg(`Fetching lyrics via ${provLabel}... please wait...`);
    try {
      const res = await api.retryLyrics(songId, lyricsProvider);
      await loadDetails();
      if (!res?.success || !res?.lyricsCount) {
        setLyStatusMsg(`Lyrics search failed: ${res?.lyricsError || 'No lyrics found across any provider.'}`);
      } else {
        setLyStatusMsg(`Lyrics found via ${res?.provider || provLabel}! (${res?.lyricsCount} lines)`);
        setTimeout(() => setLyStatusMsg(null), 4000);
      }
    } catch (err) {
      setLyStatusMsg(`Lyrics retry failed: ${err.message}`);
    } finally {
      setLyLoading(false);
    }
  };

  const handleImportManual = async () => {
    if (!manualLyrics.trim()) return;
    setLyLoading(true);
    setLyStatusMsg('Importing lyrics lines... please wait...');
    try {
      const res = await api.importManualLyrics(songId, manualLyrics);
      await loadDetails();
      if (res && res.song) {
        setSong(res.song);
        if (currentSong && currentSong.id === songId) {
          usePlaybackStore.setState({ currentSong: { ...currentSong, ...res.song } });
        }
      }
      setLyStatusMsg(null);
      setManualLyrics('');
    } catch (err) {
      setLyStatusMsg(`Manual import failed: ${err.message}`);
    } finally {
      setLyLoading(false);
    }
  };

  const handleWhisperLanguageChange = async (e) => {
    const val = e.target.value;
    setWhisperLanguage(val);
    const cleanLang = val === 'auto' ? null : val;
    // Optimistic state updates
    setSong((prev) => (prev ? { ...prev, language: cleanLang } : prev));
    if (currentSong && currentSong.id === songId) {
      usePlaybackStore.setState({ currentSong: { ...currentSong, language: cleanLang } });
    }
    setIsSavingLang(true);
    try {
      await api.updateSongLanguage(songId, cleanLang);
      setLangSavedFeedback(true);
      setTimeout(() => setLangSavedFeedback(false), 2000);
    } catch (err) {
      console.error('Failed to update song language:', err);
    } finally {
      setIsSavingLang(false);
    }
  };

  const handleAutoSync = async () => {
    if (!songId || aiProcessing) return;
    const targetSongId = songId;
    setAiProcessingMap(prev => ({ ...prev, [targetSongId]: 'sync' }));
    setAiProgressMap(prev => ({
      ...prev,
      [targetSongId]: { percent: 5, stage: 'starting', message: 'Initializing AI alignment...' }
    }));
    try {
      await api.autoSyncLyrics(targetSongId, { model: whisperModel, language: whisperLanguage });
      await loadDetails();
    } catch (err) {
      alert(`AI Auto-Sync failed: ${err.message}`);
    } finally {
      setAiProcessingMap(prev => {
        const next = { ...prev };
        delete next[targetSongId];
        return next;
      });
    }
  };

  const handleAutoGenerate = async () => {
    if (!songId || aiProcessing) return;
    const targetSongId = songId;
    setAiProcessingMap(prev => ({ ...prev, [targetSongId]: 'generate' }));
    setAiProgressMap(prev => ({
      ...prev,
      [targetSongId]: { percent: 5, stage: 'starting', message: 'Initializing Whisper speech-to-text...' }
    }));
    try {
      await api.autoGenerateLyrics(targetSongId, { model: whisperModel, language: whisperLanguage });
      await loadDetails();
    } catch (err) {
      alert(`AI Auto-Generate failed: ${err.message}`);
    } finally {
      setAiProcessingMap(prev => {
        const next = { ...prev };
        delete next[targetSongId];
        return next;
      });
    }
  };

  const handleCancelAutoLyrics = async () => {
    if (!songId) return;
    const targetSongId = songId;
    try {
      await api.cancelAutoLyrics(targetSongId);
    } catch (err) {
      console.error('Cancel failed:', err);
    } finally {
      setAiProcessingMap(prev => {
        const next = { ...prev };
        delete next[targetSongId];
        return next;
      });
      setAiProgressMap(prev => ({
        ...prev,
        [targetSongId]: { percent: 0, stage: '', message: 'Cancelled by user' }
      }));
    }
  };

  const dl = components.download || {};
  const sp = components.splitting || {};
  const ly = components.lyrics || {};

  const sepInfo = sp.separationInfo || song?.separationInfo || {};
  const currentSepMode = sepInfo.mode || song?.engineSettings?.mode || sepMode || 'balanced';
  const currentSepFormat = sepInfo.format || song?.engineSettings?.format || sepFormat || 'MP3';
  const currentSepBitrate = sepInfo.bitrate || song?.engineSettings?.bitrate || sepBitrate || '192k';
  const primaryModel = sepInfo.primaryModel || primaryModels[currentSepMode.toLowerCase()] || 'UVR-MDX-NET-Inst_HQ_3.onnx';
  const karaokeModel = sepInfo.karaokeModel || '5_HP-Karaoke-UVR.pth';

  const dlAttempts = Array.isArray(dl.attempts) ? dl.attempts : [];
  const lyAttempts = Array.isArray(ly.attempts) ? ly.attempts : [];
  const lyLineCount = ly.count !== undefined ? ly.count : (song?.lyrics ? song.lyrics.length : 0);
  const lyIsSynced = (ly.isSynced !== undefined ? ly.isSynced : (song?.isSynced !== false)) && ly.provider !== 'Manual Import' && song?.lyricsProvider !== 'Manual Import';

  return (
    <div id="componentManagerModal" className="modal-backdrop" style={{ display: 'flex' }} onClick={close}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h3>
            <i className="icon-file-text" style={{ marginRight: '0.4rem' }}></i>
            Component Manager: "{song?.title || 'Song'}"
          </h3>
          <button className="btn-close" onClick={close} title="Close">
            <i className="icon-x"></i>
          </button>
        </div>

        {/* Body Container (2-column layout in desktop via #componentManagerBody) */}
        <ScrollShadowWrapper className="component-manager-scroll-wrapper">
          <div id="componentManagerBody">
          {isLoading ? (
            <div className="empty-state" style={{ gridColumn: '1 / -1', padding: '3rem 1rem' }}>
              <i className="icon-loader-2 icon-spin" style={{ marginRight: '0.5rem', fontSize: '1.5rem' }}></i>
              Loading component status...
            </div>
          ) : error ? (
            <div className="error-state" style={{ gridColumn: '1 / -1', padding: '2rem 1rem' }}>
              <i className="icon-alert-triangle" style={{ marginRight: '0.5rem' }}></i>
              {error}
            </div>
          ) : (
            <>
              {/* Column 1 Top Editor Button: Edit Meta-data */}
              <div className="component-editor-slot component-editor-slot-meta">
                <button
                  type="button"
                  className="btn btn-primary component-editor-btn component-editor-btn-meta"
                  onClick={() => openMetadataModal(song)}
                >
                  <i className="icon-pencil" style={{ marginRight: '0.35rem' }}></i> Edit Meta-data
                </button>
              </div>

              {/* Hidden file input for audio reupload */}
              <input
                type="file"
                ref={reuploadInputRef}
                style={{ display: 'none' }}
                accept="audio/*,.mp3,.m4a,.wav,.flac,.aac,.ogg,.opus"
                onChange={handleFileReuploadChange}
              />

              {/* 1. Audio & Video Source Card */}
              <div className="component-card component-card-download">
                <div className="component-card-header">
                  <div className="component-title">
                    <i className="icon-music"></i> 1. Audio & Music Video Source
                  </div>
                  {dl.status === 'success' || dl.status === 'ready' || song?.status === 'ready' ? (
                    <span className="status-badge success"><i className="icon-check"></i> Ready</span>
                  ) : dl.status === 'error' || song?.downloadError ? (
                    <span className="status-badge error"><i className="icon-x"></i> Failed</span>
                  ) : (
                    <span className="status-badge pending"><i className="icon-loader-2 icon-spin"></i> Downloading</span>
                  )}
                </div>

                <div className="component-details">
                  <div className="component-meta-list">
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem' }}>
                      <span>Audio Source: <strong>{dl.method || song?.downloadMethod || 'SpotDL'}</strong></span>
                      <button
                        type="button"
                        className="mono-tag clickable open-source-btn"
                        onClick={handleOpenSourceFile}
                        title="Locate audio source file in Finder / File Explorer"
                      >
                        <i className="icon-folder"></i> Open Source
                      </button>
                      <span>• File:</span>
                      <code className="mono-tag">{dl.audioFile || 'audio.mp3'}</code>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <span>Music Video (Online YouTube):</span>
                      {song?.youtubeId ? (
                        <a
                          href={song.youtubeUrl || `https://www.youtube.com/watch?v=${song.youtubeId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mono-tag clickable"
                          style={{ color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                          title="Open video on YouTube"
                        >
                          <i className="icon-video"></i> Linked ({song.youtubeId})
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>None</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="component-action-row">
                  <select
                    className="select-input"
                    value={dlSource}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDlSource(val);
                      if (val === 'reupload' && reuploadInputRef.current) {
                        reuploadInputRef.current.click();
                      }
                    }}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
                  >
                    <option value="auto">Auto (SpotDL Preferred)</option>
                    <option value="spotdl">SpotDL Only (Spotify Studio)</option>
                    <option value="ytdlp">yt-dlp (YouTube Backup)</option>
                    <option value="reupload">📁 Reupload Audio File...</option>
                  </select>
                  <button
                    type="button"
                    className="btn btn-retry-component"
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                    onClick={handleRetryDl}
                    disabled={dlLoading}
                  >
                    <i className={dlLoading ? "icon-loader-2 icon-spin" : (dlSource === 'reupload' ? "icon-upload" : "icon-rotate-cw")}></i>
                    {dlLoading ? 'Processing...' : (dlSource === 'reupload' ? 'Choose File...' : 'Retry Download')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-reupload-quick"
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    onClick={() => {
                      if (reuploadInputRef.current) reuploadInputRef.current.click();
                    }}
                    disabled={dlLoading}
                    title="Upload a local audio file to replace current audio source"
                  >
                    <i className="icon-upload"></i>
                    <span>Reupload</span>
                  </button>
                </div>

                {/* Report Section */}
                {dlLoading ? (
                  <div className="component-report-box loading">
                    <i className="icon-loader-2 icon-spin" style={{ marginRight: '0.4rem' }}></i>
                    {dlStatusMsg || 'Processing audio source... please wait...'}
                  </div>
                ) : dlStatusMsg && (dlStatusMsg.startsWith('Download failed') || dlStatusMsg.startsWith('Reupload failed')) ? (
                  <div className="component-report-box" style={{ color: '#f87171' }}>
                    <i className="icon-alert-triangle" style={{ marginRight: '0.3rem' }}></i>
                    {dlStatusMsg}
                  </div>
                ) : dlAttempts.length > 0 ? (
                  <div className="component-report-box">
                    {dlAttempts.map((a, idx) => {
                      const isSuccess = a.status === 'success';
                      const isSkipped = a.status === 'skipped';
                      const isPartial = a.status === 'partial';
                      return (
                        <div key={idx} className={`attempt-row ${a.status}`}>
                          <div className="attempt-header">
                            <span className="attempt-provider">
                              <i
                                className={isSuccess ? 'icon-check' : (isSkipped ? 'icon-skip-forward' : (isPartial ? 'icon-alert-triangle' : 'icon-x'))}
                                style={{ color: isSuccess ? '#10b981' : (isSkipped ? '#94a3b8' : (isPartial ? '#f59e0b' : '#ef4444')) }}
                              ></i>
                              {a.provider}
                            </span>
                            <span className="attempt-badge">{a.status.toUpperCase()}</span>
                          </div>
                          {a.detail && <div className="attempt-detail">{a.detail}</div>}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              {/* Column 2 Top Editor Button Slot: Stem Editor Button */}
              <div className="component-editor-slot component-editor-slot-stems">
                <button
                  type="button"
                  className="btn btn-primary component-editor-btn component-editor-btn-stems"
                  onClick={() => openStemEditorModal(song)}
                  title="Open Stem Editor to visualize waveforms and correct stem separation"
                >
                  <i className="icon-sliders" style={{ marginRight: '0.35rem' }}></i> Stem Editor
                </button>
              </div>

              {/* 2. Stem Separation Card */}
              <div className="component-card component-card-splitting">
                <div className="component-card-header">
                  <div className="component-title">
                    <i className="icon-scissors"></i> 2. Stem Separation
                  </div>
                  {sp.status === 'separated' || (sp.status === 'ready' || (song?.status === 'ready' && !sp.isFallback && !song?.splitError)) ? (
                    <span className="status-badge success"><i className="icon-check"></i> 3 Stems Separated</span>
                  ) : sp.isFallback || sp.status === 'fallback' ? (
                    <span className="status-badge warning"><i className="icon-alert-triangle"></i> Fallback</span>
                  ) : sp.status === 'error' || song?.splitError ? (
                    <span className="status-badge error"><i className="icon-x"></i> Error</span>
                  ) : (
                    <span className="status-badge pending"><i className="icon-loader-2 icon-spin"></i> Splitting</span>
                  )}
                </div>

                <div className="component-details">
                  <div className="component-meta-list">
                    <div>
                      Status: <strong>
                        {sp.isFallback || sp.status === 'fallback' ? (
                          <><i className="icon-alert-triangle" style={{ color: '#f59e0b', marginRight: '0.25rem' }}></i> Full Track Fallback</>
                        ) : (
                          <><i className="icon-check" style={{ color: '#10b981', marginRight: '0.25rem' }}></i> 3 Distinct AI Stems</>
                        )}
                      </strong>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                      <i className="icon-settings" style={{ marginRight: '0.25rem' }}></i>
                      Mode: <strong>{modeLabels[currentSepMode] || currentSepMode}</strong> • Output: <strong>{currentSepFormat} {currentSepBitrate}</strong>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                      <i className="icon-bot" style={{ marginRight: '0.25rem' }}></i>
                      Stage 1 (Vocals/Inst): <code className="mono-tag" style={{ color: '#f87171' }}>{primaryModel}</code>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                      <i className="icon-mic" style={{ marginRight: '0.25rem' }}></i>
                      Stage 2 (Lead/Back): <code className="mono-tag" style={{ color: '#f87171' }}>{karaokeModel}</code>
                    </div>
                  </div>
                </div>

                <div className="component-action-row" style={{ justifyContent: 'space-between' }}>
                  <button
                    type="button"
                    className="btn btn-retry-component"
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                    onClick={handleRetrySplitting}
                    disabled={spLoading}
                  >
                    <i className={spLoading ? "icon-loader-2 icon-spin" : "icon-scissors"}></i>
                    {spLoading ? 'Splitting...' : 'Retry Stem Separation'}
                  </button>
                  <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', color: 'var(--text-secondary)', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={customSep}
                      onChange={(e) => setCustomSep(e.target.checked)}
                    />
                    Custom Settings
                  </label>
                </div>

                {/* Custom Settings Accordion */}
                {customSep && (
                  <div style={{ background: 'rgba(15, 23, 42, 0.85)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.5rem', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 120px' }}>
                        <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Mode &amp; Model:</label>
                        <select
                          value={sepMode}
                          onChange={(e) => setSepMode(e.target.value)}
                          style={{ width: '100%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.2rem', fontSize: '0.75rem' }}
                        >
                          <option value="balanced">Balanced (UVR-MDX-HQ-3)</option>
                          <option value="fast">Fast (UVR-MDX-Inst-1)</option>
                          <option value="high">High Precision (MDX23C)</option>
                          <option value="ultra">Ultra Quality (BS-Roformer)</option>
                        </select>
                      </div>
                      <div style={{ flex: '1 1 80px' }}>
                        <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Format:</label>
                        <select
                          value={sepFormat}
                          onChange={(e) => setSepFormat(e.target.value)}
                          style={{ width: '100%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.2rem', fontSize: '0.75rem' }}
                        >
                          <option value="MP3">MP3 (Compact)</option>
                          <option value="M4A">M4A (AAC)</option>
                          <option value="WAV">WAV (Uncompressed)</option>
                        </select>
                      </div>
                      <div style={{ flex: '1 1 80px' }}>
                        <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Bitrate:</label>
                        <select
                          value={sepBitrate}
                          onChange={(e) => setSepBitrate(e.target.value)}
                          style={{ width: '100%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.2rem', fontSize: '0.75rem' }}
                        >
                          <option value="192k">192 kbps (Default)</option>
                          <option value="320k">320 kbps (High)</option>
                          <option value="128k">128 kbps (Draft)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Report Section */}
                {spLoading ? (
                  <div className="component-report-box loading">
                    <i className="icon-loader-2 icon-spin" style={{ marginRight: '0.4rem' }}></i>
                    {spStatusMsg || 'Running AI stem separation... please wait...'}
                  </div>
                ) : (spStatusMsg && spStatusMsg.startsWith('Splitting failed')) || sp.error ? (
                  <div className="component-report-box" style={{ color: '#f87171' }}>
                    <i className="icon-alert-triangle" style={{ marginRight: '0.3rem' }}></i>
                    {spStatusMsg || sp.error}
                  </div>
                ) : null}
              </div>

              {/* Column 3 Top Editor Button: Lyrics & Sync Editor */}
              <div className="component-editor-slot component-editor-slot-lyrics">
                <button
                  type="button"
                  className="btn btn-primary component-editor-btn component-editor-btn-lyrics"
                  onClick={() => openLyricsSyncModal(song)}
                >
                  <i className="icon-music" style={{ marginRight: '0.35rem' }}></i> Lyrics &amp; Sync Editor
                </button>
              </div>

              {/* 3. Lyrics Fetching Card */}
              <div className="component-card component-card-lyrics">
                {/* AI Lockout Overlay while Auto-Syncing or Auto-Generating */}
                {aiProcessing && (
                  <div className="card-lockout-overlay" onClick={(e) => e.stopPropagation()}>
                    <div className="card-lockout-content">
                      <div className="lockout-pulse-icon">
                        <i className="icon-loader-2 icon-spin" style={{ fontSize: '1.8rem', color: '#c084fc' }}></i>
                      </div>
                      <h4 style={{ margin: '0.5rem 0 0.2rem', color: '#f3e8ff', fontSize: '1rem' }}>
                        {aiProcessing === 'sync' ? 'AI Synchronizing Lyrics...' : 'AI Generating Lyrics...'}
                      </h4>
                      <p style={{ margin: '0 0 0.8rem', color: '#d8b4fe', fontSize: '0.8rem', lineHeight: 1.4 }}>
                        {aiProgress.message || (aiProcessing === 'sync' ? 'Aligning lyric lines to vocal audio...' : 'Transcribing singing vocals with Whisper...')}
                      </p>
                      
                      <div className="ai-progress-bar-wrap">
                        <div className="ai-progress-bar-fill" style={{ width: `${Math.max(5, aiProgress.percent)}%` }}></div>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: '0.4rem', display: 'block' }}>
                        {aiProgress.percent > 0 ? `${aiProgress.percent}%` : 'Starting...'}
                      </span>

                      <button
                        type="button"
                        className="btn btn-lockout-cancel"
                        onClick={handleCancelAutoLyrics}
                      >
                        <i className="icon-x" style={{ marginRight: '0.3rem' }}></i> Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div className="component-card-header">
                  <div className="component-title">
                    <i className="icon-file-text"></i> 3. Lyrics
                  </div>
                  {lyLoading || aiProcessing !== null || song?.status === 'fetching_lyrics' || song?.lyricsStatus || ly?.status === 'pending' ? (
                    <span className="status-badge pending">
                      <i className="icon-loader-2 icon-spin"></i> {aiProcessing === 'sync' ? 'Synchronizing' : (aiProcessing === 'generate' ? 'Generating' : (song?.lyricsStatus || 'Fetching'))}
                    </span>
                  ) : ly.hasLyrics || (song?.lyrics && song.lyrics.length > 0) ? (
                    !lyIsSynced ? (
                      <span className="status-badge success" style={{ background: 'rgba(147, 51, 234, 0.15)', color: '#c084fc', border: '1px solid rgba(147, 51, 234, 0.3)' }}>
                        <i className="icon-pencil"></i> Unsynced
                      </span>
                    ) : (
                      <span className="status-badge success"><i className="icon-check"></i> Synced Lyrics</span>
                    )
                  ) : (
                    <span className="status-badge error"><i className="icon-x"></i> Failed</span>
                  )}
                </div>

                <div className="component-details">
                  <div className="component-meta-list">
                    {lyLineCount > 0 ? (
                      <div>
                        Loaded <strong>{lyLineCount}</strong> lines via <strong>{ly.provider || song?.lyricsProvider || 'Auto'}</strong> {lyIsSynced ? '(Synced)' : '(Unsynced)'}
                        {song?.language && (
                          <span> • Language: <strong>{getWhisperLanguageLabel(song.language)}</strong> ({song.language.toUpperCase()})</span>
                        )}
                      </div>
                    ) : (
                      <div style={{ color: '#f87171' }}>
                        <i className="icon-alert-triangle" style={{ marginRight: '0.35rem' }}></i>
                        <strong>No lyrics loaded</strong>
                        {(song?.lyricsError || ly.error) && (
                          <span style={{ color: '#cbd5e1', marginLeft: '0.35rem' }}>
                            ({song?.lyricsError || ly.error})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="component-action-row">
                  <select
                    className="select-input"
                    value={lyricsProvider}
                    onChange={(e) => setLyricsProvider(e.target.value)}
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
                  >
                    <optgroup label="Fetch Lyrics Providers">
                      <option value="auto">Auto (All Providers)</option>
                      <option value="Spotify">Spotify</option>
                      <option value="LRCLIB">LRCLIB</option>
                      <option value="Musixmatch">Musixmatch</option>
                      <option value="NetEase">NetEase</option>
                      <option value="Deezer">Deezer</option>
                      <option value="Lyricsify">Lyricsify</option>
                      <option value="Genius">Genius</option>
                      <option value="Megalobiz">Megalobiz</option>
                      <option value="manual">Manual Import</option>
                    </optgroup>
                    <optgroup label="Subtitles / Enhancements">
                      <option value="refetch_translation">Re-fetch Translation</option>
                      <option value="refetch_transliteration">Re-fetch Transliteration</option>
                      <option value="refetch_both">Re-fetch Both</option>
                    </optgroup>
                  </select>
                  {lyricsProvider !== 'manual' ? (
                    <button
                      type="button"
                      className="btn btn-retry-component"
                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                      onClick={handleRetryLyrics}
                      disabled={lyLoading || (lyricsProvider.startsWith('refetch_') && !lyLineCount)}
                    >
                      <i className={lyLoading ? "icon-loader-2 icon-spin" : (lyricsProvider.startsWith('refetch_') ? "icon-rotate-cw" : "icon-file-text")}></i>
                      {lyLoading
                        ? 'Processing...'
                        : lyricsProvider === 'refetch_translation'
                          ? 'Re-fetch Translation'
                          : lyricsProvider === 'refetch_transliteration'
                            ? 'Re-fetch Transliteration'
                            : lyricsProvider === 'refetch_both'
                              ? 'Re-fetch Both'
                              : 'Retry Lyrics'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                      onClick={handleImportManual}
                      disabled={lyLoading || !manualLyrics.trim()}
                      title={!manualLyrics.trim() ? "Type or paste lyrics in the box below first" : "Import and overwrite lyrics"}
                    >
                      <i className={lyLoading ? "icon-loader-2 icon-spin" : "icon-pencil"}></i>
                      {lyLoading ? 'Importing...' : 'Import Lyrics'}
                    </button>
                  )}
                </div>

                {/* Spotify Session Configuration Box */}
                {lyricsProvider === 'Spotify' && (
                  <div style={{
                    marginTop: '0.6rem',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '8px',
                    background: 'rgba(30, 215, 96, 0.08)',
                    border: '1px solid rgba(30, 215, 96, 0.25)',
                    fontSize: '0.8rem',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: spotifyCookieStatus.configured ? '#10b981' : '#f59e0b',
                        }}></span>
                        <span style={{ fontWeight: 600, color: spotifyCookieStatus.configured ? '#34d399' : '#fbbf24' }}>
                          {spotifyCookieStatus.configured
                            ? `Spotify Session Cookie Active (${spotifyCookieStatus.maskedCookie})`
                            : 'No Spotify Cookie (Partner Fallback Active)'}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          fontSize: '0.72rem',
                          padding: '0.2rem 0.5rem',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid rgba(255, 255, 255, 0.15)',
                          color: '#e2e8f0',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                        onClick={() => setShowCookieInput(!showCookieInput)}
                      >
                        <i className={showCookieInput ? "icon-chevron-up" : "icon-settings"} style={{ marginRight: '0.25rem' }}></i>
                        {showCookieInput ? 'Hide' : (spotifyCookieStatus.configured ? 'Change sp_dc' : 'Set sp_dc')}
                      </button>
                    </div>

                    {showCookieInput && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <div style={{ color: '#94a3b8', fontSize: '0.73rem', marginBottom: '0.35rem', lineHeight: 1.35 }}>
                          Paste your browser's <code>sp_dc</code> cookie to fetch official line-synced Color-Lyrics directly from Spotify. Without a cookie, it seamlessly uses Spotify's official Musixmatch partner.
                        </div>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <input
                            type="password"
                            className="text-input"
                            placeholder={spotifyCookieStatus.configured ? "Paste new sp_dc cookie to replace..." : "Paste sp_dc cookie value here..."}
                            value={cookieInputVal}
                            onChange={(e) => setCookieInputVal(e.target.value)}
                            style={{ flex: '1 1 180px', fontSize: '0.75rem', padding: '0.3rem 0.5rem', minWidth: 0 }}
                          />
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ fontSize: '0.75rem', padding: '0.3rem 0.65rem' }}
                            onClick={() => handleSaveSpotifyCookie()}
                            disabled={savingCookie}
                          >
                            <i className={savingCookie ? "icon-loader-2 icon-spin" : "icon-check"}></i>
                            {savingCookie ? 'Saving...' : 'Save'}
                          </button>
                          {spotifyCookieStatus.configured && (
                            <button
                              type="button"
                              className="btn btn-outline"
                              style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem', color: '#f87171' }}
                              onClick={() => {
                                setCookieInputVal('');
                                handleSaveSpotifyCookie('');
                              }}
                              disabled={savingCookie}
                              title="Clear stored Spotify cookie"
                            >
                              <i className="icon-trash-2"></i> Clear
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {cookieMsg && (
                      <div style={{
                        marginTop: '0.35rem',
                        fontSize: '0.72rem',
                        color: cookieMsg.type === 'success' ? '#34d399' : '#f87171',
                      }}>
                        {cookieMsg.text}
                      </div>
                    )}
                  </div>
                )}

                {/* AI Whisper Engine (Auto-Sync & Auto-Generate) */}
                <div className="component-sub-actions-row lyrics-ai-actions-row">
                  {/* Single-line Engine Label & Selectors */}
                  <div className="ai-engine-config-row">
                    <div className="ai-engine-badge" title="Local speech-to-text & forced alignment engine">
                      <i className="icon-cpu"></i>
                      <span>Engine</span>
                    </div>

                    <div className="ai-engine-field ai-engine-field-model">
                      <label className="ai-engine-field-label" htmlFor="whisper-model-select">Model:</label>
                      <select
                        id="whisper-model-select"
                        className="ai-engine-select"
                        value={whisperModel}
                        onChange={(e) => setWhisperModel(e.target.value)}
                        disabled={aiProcessing !== null}
                        title="Whisper AI model architecture and capacity"
                      >
                        {WHISPER_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="ai-engine-field ai-engine-field-lang">
                      <label className="ai-engine-field-label" htmlFor="whisper-lang-select">Lang:</label>
                      <select
                        id="whisper-lang-select"
                        className="ai-engine-select"
                        value={whisperLanguage}
                        onChange={handleWhisperLanguageChange}
                        disabled={aiProcessing !== null || isSavingLang}
                        title="Language for Whisper recognition (saved to song info)"
                      >
                        {WHISPER_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {lang.name}
                          </option>
                        ))}
                      </select>
                      {langSavedFeedback && (
                        <span className="ai-lang-saved-indicator" title="Saved to song info!">
                          <i className="icon-check"></i>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Vocal Stem Indicator */}
                  <div className={`ai-engine-stem-pill ${sp.status === 'separated' ? 'separated' : 'fallback'}`}>
                    <i className={sp.status === 'separated' ? "icon-check-circle" : "icon-info"}></i>
                    <span>
                      {sp.status === 'separated'
                        ? 'Using isolated lead vocal stem for optimal accuracy'
                        : 'Using full audio track (recommend vocal separation first)'}
                    </span>
                  </div>

                  <div className="sub-actions-buttons" style={{ display: 'flex', gap: '0.45rem', width: '100%' }}>
                    <button
                      type="button"
                      className="btn btn-ai-action btn-ai-auto-sync"
                      onClick={handleAutoSync}
                      disabled={aiProcessing !== null || lyLineCount === 0 || dl.status !== 'success'}
                      title={lyLineCount === 0 ? "No existing lyrics to synchronize. Use Auto-Generate first." : "Align existing lyrics text to vocal audio timestamps"}
                      style={{ flex: 1 }}
                    >
                      <i className="icon-timer"></i>
                      <span>AI Auto-Sync</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ai-action btn-ai-auto-generate"
                      onClick={handleAutoGenerate}
                      disabled={aiProcessing !== null || dl.status !== 'success'}
                      title="Transcribe audio into new timestamped lyrics with Whisper"
                      style={{ flex: 1 }}
                    >
                      <i className="icon-mic"></i>
                      <span>AI Auto-Generate</span>
                    </button>
                  </div>
                </div>

                {/* Subtitle Re-fetch Actions Row */}
                <div className="component-sub-actions-row">
                  <span className="sub-actions-label">Subtitles:</span>
                  <div className="sub-actions-buttons">
                    <button
                      type="button"
                      className="btn btn-sub-action"
                      onClick={() => handleRefetchSubtitles('translation')}
                      disabled={lyLoading || !lyLineCount}
                      title="Re-fetch English translation for current lyrics lines"
                    >
                      <i className="icon-languages"></i>
                      <span>Translation</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-sub-action"
                      onClick={() => handleRefetchSubtitles('transliteration')}
                      disabled={lyLoading || !lyLineCount}
                      title="Re-fetch romanized pronunciation / transliteration for current lyrics lines"
                    >
                      <i className="icon-ear"></i>
                      <span>Transliteration</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-sub-action"
                      onClick={() => handleRefetchSubtitles('both')}
                      disabled={lyLoading || !lyLineCount}
                      title="Re-fetch both translation and transliteration"
                    >
                      <i className="icon-refresh-cw"></i>
                      <span>Both</span>
                    </button>
                  </div>
                </div>

                {/* Manual Lyrics Paste Area */}
                {lyricsProvider === 'manual' && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <textarea
                      className="manual-lyrics-textarea"
                      placeholder="Paste song lyrics here (plain text or [mm:ss.xx] timestamped LRC)... Clicking 'Import Lyrics' will overwrite the song's lyrics."
                      rows={5}
                      value={manualLyrics}
                      onChange={(e) => setManualLyrics(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
                        onClick={handleImportManual}
                        disabled={lyLoading || !manualLyrics.trim()}
                      >
                        <i className="icon-pencil" style={{ marginRight: '0.25rem' }}></i> Import Lyrics
                      </button>
                    </div>
                  </div>
                )}

                {/* Report Section */}
                {lyLoading ? (
                  <div className="component-report-box loading">
                    <i className="icon-loader-2 icon-spin" style={{ marginRight: '0.4rem' }}></i>
                    {lyStatusMsg || 'Fetching synced lyrics from providers... please wait...'}
                  </div>
                ) : (
                  <>
                    {/* Status Alert Banner */}
                    {lyStatusMsg ? (
                      <div className="component-report-box" style={{
                        color: (lyStatusMsg.toLowerCase().includes('failed') || lyStatusMsg.toLowerCase().includes('no lyrics')) ? '#f87171' : '#34d399',
                        marginBottom: lyAttempts.length > 0 ? '0.5rem' : '0'
                      }}>
                        <i className={(lyStatusMsg.toLowerCase().includes('failed') || lyStatusMsg.toLowerCase().includes('no lyrics')) ? "icon-alert-triangle" : "icon-check"} style={{ marginRight: '0.3rem' }}></i>
                        {lyStatusMsg}
                      </div>
                    ) : (lyLineCount === 0 && (song?.lyricsError || ly.error)) ? (
                      <div className="component-report-box" style={{ color: '#f87171', marginBottom: lyAttempts.length > 0 ? '0.5rem' : '0' }}>
                        <i className="icon-alert-triangle" style={{ marginRight: '0.3rem' }}></i>
                        Lyrics search failed: {song?.lyricsError || ly.error}
                      </div>
                    ) : null}

                    {/* Attempts Breakdown */}
                    {lyAttempts.length > 0 ? (
                      <div className="component-report-box">
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#94a3b8', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Provider Search Report ({lyLineCount > 0 ? 'Lyrics Found' : 'Failed'})
                        </div>
                        {lyAttempts.map((a, idx) => {
                          const isSuccess = a.status === 'success';
                          const isSkipped = a.status === 'skipped';
                          const isPartial = a.status === 'partial';
                          return (
                            <div key={idx} className={`attempt-row ${a.status}`}>
                              <div className="attempt-header">
                                <span className="attempt-provider">
                                  <i
                                    className={isSuccess ? 'icon-check' : (isSkipped ? 'icon-skip-forward' : (isPartial ? 'icon-alert-triangle' : 'icon-x'))}
                                    style={{ color: isSuccess ? '#10b981' : (isSkipped ? '#94a3b8' : (isPartial ? '#f59e0b' : '#ef4444')) }}
                                  ></i>
                                  {a.provider}
                                </span>
                                <span className="attempt-badge">{a.status.toUpperCase()}</span>
                              </div>
                              {a.detail && <div className="attempt-detail">{a.detail}</div>}
                            </div>
                          );
                        })}
                      </div>
                    ) : (lyLineCount === 0 && !lyStatusMsg) ? (
                      <div className="component-report-box" style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                        <i className="icon-info" style={{ marginRight: '0.35rem' }}></i>
                        No lyrics found. Select a provider above and click &ldquo;Retry Lyrics&rdquo; or import manual lyrics.
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </>
          )}
          </div>
        </ScrollShadowWrapper>

        {/* Full-width red Close button at bottom */}
        <button type="button" className="btn btn-comp-close" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}
