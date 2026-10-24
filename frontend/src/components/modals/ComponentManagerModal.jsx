import React, { useState, useEffect, useRef } from 'react';
import { useModalStore } from '../../stores/useModalStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import * as api from '../../services/api';

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

  const loadDetails = async () => {
    if (!songId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.fetchSongDetails(songId);
      setSong(data.song);
      setComponents(data.components || {});
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
    }
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
    setLyStatusMsg(`Fetching lyrics via ${lyricsProvider === 'auto' ? 'Auto providers' : lyricsProvider}... please wait...`);
    try {
      await api.retryLyrics(songId, lyricsProvider);
      await loadDetails();
      setLyStatusMsg(null);
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
      await api.importManualLyrics(songId, manualLyrics);
      await loadDetails();
      setLyStatusMsg(null);
      setManualLyrics('');
    } catch (err) {
      setLyStatusMsg(`Manual import failed: ${err.message}`);
    } finally {
      setLyLoading(false);
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
                  onClick={() => { close(); openMetadataModal(song); }}
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

              {/* 1. Audio Source Card */}
              <div className="component-card component-card-download">
                <div className="component-card-header">
                  <div className="component-title">
                    <i className="icon-music"></i> 1. Audio Source
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
                      <span>Source: <strong>{dl.method || song?.downloadMethod || 'SpotDL'}</strong></span>
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

              {/* Column 2 Top Editor Button Slot: Future Stems Editor Button */}
              <div className="component-editor-slot component-editor-slot-stems">
                {/* A new editor button related to stems will later be added here */}
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
                  onClick={() => { close(); openLyricsSyncModal(song); }}
                >
                  <i className="icon-music" style={{ marginRight: '0.35rem' }}></i> Lyrics &amp; Sync Editor
                </button>
              </div>

              {/* 3. Lyrics Fetching Card */}
              <div className="component-card component-card-lyrics">
                <div className="component-card-header">
                  <div className="component-title">
                    <i className="icon-file-text"></i> 3. Lyrics
                  </div>
                  {ly.hasLyrics || (song?.lyrics && song.lyrics.length > 0) ? (
                    !lyIsSynced ? (
                      <span className="status-badge success" style={{ background: 'rgba(147, 51, 234, 0.15)', color: '#c084fc', border: '1px solid rgba(147, 51, 234, 0.3)' }}>
                        <i className="icon-pencil"></i> Unsynced
                      </span>
                    ) : (
                      <span className="status-badge success"><i className="icon-check"></i> Synced Lyrics</span>
                    )
                  ) : ly.status === 'failed' || song?.lyricsError ? (
                    <span className="status-badge error"><i className="icon-x"></i> No Lyrics</span>
                  ) : (
                    <span className="status-badge pending"><i className="icon-loader-2 icon-spin"></i> Fetching</span>
                  )}
                </div>

                <div className="component-details">
                  <div className="component-meta-list">
                    <div>
                      Loaded <strong>{lyLineCount}</strong> lines via <strong>{ly.provider || song?.lyricsProvider || 'Auto'}</strong> {lyIsSynced ? '(Synced)' : '(Unsynced)'}
                    </div>
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
                  {lyricsProvider !== 'manual' && (
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
                  )}
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
                      placeholder="Paste song lyrics here... Each line will be split into unsynced lyrics."
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
                ) : lyStatusMsg && (lyStatusMsg.startsWith('Lyrics retry failed') || lyStatusMsg.startsWith('Subtitles re-fetch failed')) ? (
                  <div className="component-report-box" style={{ color: '#f87171' }}>
                    <i className="icon-alert-triangle" style={{ marginRight: '0.3rem' }}></i>
                    {lyStatusMsg}
                  </div>
                ) : lyAttempts.length > 0 ? (
                  <div className="component-report-box">
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
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* Full-width red Close button at bottom */}
        <button type="button" className="btn btn-comp-close" onClick={close}>
          Close
        </button>
      </div>
    </div>
  );
}
