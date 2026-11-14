import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  Crown,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Sliders,
  Users,
  Megaphone,
  Settings,
  Trash2,
  ChevronUp,
  ChevronDown,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Mic,
  Music,
  Volume2,
  VolumeX,
  Link2,
  Unlink2,
  ExternalLink,
  Check,
  X
} from 'lucide-react';
import socket, { emitPlayerCommand, emitUpdateState, emitRequestSync } from './services/socket';
import { useSocialStore } from './stores/useSocialStore';
import { useQueueStore } from './stores/useQueueStore';
import { usePlaybackStore, getAccuratePlaybackTime, updateSyncAnchor } from './stores/usePlaybackStore';
import * as socialApi from './services/socialApi';
import { formatTime } from './utils/themeColors';

import HostRequestsPanel from './components/social/HostRequestsPanel';
import HostSettingsModal from './components/social/HostSettingsModal';
import AnnouncementBanner from './components/social/AnnouncementBanner';
import MobileTeleprompter from './components/social/MobileTeleprompter';
import {
  isRtlText,
  isInstrumentalText,
  prepareLyricsForDisplay,
  calculateKaraokeProgress,
  getLyricsMeasureContext
} from './utils/lyricsWrapping';

export default function HostApp() {
  const isHostAuthorized = useSocialStore((state) => state.isHostAuthorized);
  const isHostOccupiedByOther = useSocialStore((state) => state.isHostOccupiedByOther);
  const hostClaimError = useSocialStore((state) => state.hostClaimError);
  const hostToken = useSocialStore((state) => state.hostToken);
  const stageJoinRequests = useSocialStore((state) => state.stageJoinRequests);
  const guests = useSocialStore((state) => state.guests);
  const guestCount = useSocialStore((state) => state.guestCount);
  const partySettings = useSocialStore((state) => state.partySettings);
  const claimHostStation = useSocialStore((state) => state.claimHostStation);
  const releaseHostStation = useSocialStore((state) => state.releaseHostStation);
  const initSocialSync = useSocialStore((state) => state.initSocialSync);

  const pendingStageRequests = Array.isArray(stageJoinRequests)
    ? stageJoinRequests.filter((r) => r.status === 'pending')
    : [];

  const handleApproveStageRequest = async (requestId) => {
    try {
      await socialApi.approveStageJoinRequest(requestId, hostToken);
    } catch (err) {
      alert(`Approval failed: ${err.message}`);
    }
  };

  const handleRejectStageRequest = async (requestId) => {
    try {
      await socialApi.rejectStageJoinRequest(requestId, hostToken);
    } catch (err) {
      alert(`Decline failed: ${err.message}`);
    }
  };

  // Playback state
  const currentSong = usePlaybackStore((state) => state.currentSong);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const currentTime = usePlaybackStore((state) => state.currentTime);
  const duration = usePlaybackStore((state) => state.duration);
  const volumes = usePlaybackStore((state) => state.volumes);
  const setVolumes = usePlaybackStore((state) => state.setVolumes);
  const toggleStemMute = usePlaybackStore((state) => state.toggleStemMute);
  const isInstBackLinked = usePlaybackStore((state) => state.isInstBackLinked);
  const setLinkInstBack = usePlaybackStore((state) => state.setLinkInstBack);
  const isBackLeadLinked = usePlaybackStore((state) => state.isBackLeadLinked);
  const setLinkBackLead = usePlaybackStore((state) => state.setLinkBackLead);

  // Queue state
  const queue = useQueueStore((state) => state.queue);
  const loadQueue = useQueueStore((state) => state.loadQueue);
  const reorderItem = useQueueStore((state) => state.reorderItem);
  const removeQueueItem = useQueueStore((state) => state.remove);

  // Local state
  const [pinInput, setPinInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeHostTab, setActiveHostTab] = useState('stage'); // 'stage' | 'requests' | 'queue' | 'mixer' | 'guests'
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showTeleprompterDrawer, setShowTeleprompterDrawer] = useState(false);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [sliderDragVal, setSliderDragVal] = useState(0);

  // Translation & Transliteration toggles for Host console - strictly OFF by default
  const [showTranslit, setShowTranslit] = useState(false);
  const [showTranslat, setShowTranslat] = useState(false);

  // Active lyric and real-time 60fps/120fps continuous karaoke progress calculation
  // using the exact same requestAnimationFrame accurate playback time loop as Guest's MobileTeleprompter
  const rawLyrics = Array.isArray(currentSong?.lyrics) ? currentSong.lyrics : [];
  const displayLyrics = useMemo(() => {
    return prepareLyricsForDisplay(rawLyrics);
  }, [rawLyrics]);

  const [hostActiveIdx, setHostActiveIdx] = useState(-1);
  const [hostProgressPct, setHostProgressPct] = useState(0);
  const hostAnimFrameRef = useRef(null);
  const hostLyricTextRef = useRef(null);

  const updateHostActiveLine = (curTime) => {
    if (displayLyrics.length === 0) {
      setHostActiveIdx(-1);
      setHostProgressPct(0);
      return;
    }

    let foundIdx = -1;
    for (let i = 0; i < displayLyrics.length; i++) {
      const lineTime = typeof displayLyrics[i].time === 'number' ? displayLyrics[i].time : parseFloat(displayLyrics[i].time) || 0;
      if (curTime >= lineTime) {
        foundIdx = i;
      } else {
        break;
      }
    }

    setHostActiveIdx(foundIdx);

    if (foundIdx >= 0) {
      const line = displayLyrics[foundIdx];
      const nextLine = foundIdx < displayLyrics.length - 1 ? displayLyrics[foundIdx + 1] : null;
      const nextTime = nextLine ? (typeof nextLine.time === 'number' ? nextLine.time : parseFloat(nextLine.time) || 0) : null;
      const ctx = getLyricsMeasureContext();
      const pct = calculateKaraokeProgress(line, curTime, nextTime, duration, ctx);
      setHostProgressPct(pct);
      if (hostLyricTextRef.current) {
        hostLyricTextRef.current.style.setProperty('--karaoke-progress', `${pct.toFixed(1)}%`);
      }
    } else {
      setHostProgressPct(0);
      if (hostLyricTextRef.current) {
        hostLyricTextRef.current.style.setProperty('--karaoke-progress', '0%');
      }
    }
  };

  useEffect(() => {
    if (!isPlaying || displayLyrics.length === 0) {
      if (!isPlaying && displayLyrics.length > 0) {
        const time = usePlaybackStore.getState().currentTime || 0;
        updateHostActiveLine(time);
      }
      return;
    }

    const updateLoop = () => {
      const time = usePlaybackStore.getState().getAccuratePlaybackTime();
      updateHostActiveLine(time);
      hostAnimFrameRef.current = requestAnimationFrame(updateLoop);
    };

    hostAnimFrameRef.current = requestAnimationFrame(updateLoop);
    return () => {
      if (hostAnimFrameRef.current) cancelAnimationFrame(hostAnimFrameRef.current);
    };
  }, [isPlaying, displayLyrics, duration]);

  const activeHostLine = hostActiveIdx >= 0 ? displayLyrics[hostActiveIdx] : null;
  const activeLyricText = activeHostLine?.text || '';
  const activeLyricTranslit = activeHostLine?.transliteration || '';
  const activeLyricTranslat = activeHostLine?.translation || '';
  const isCurLyricInstrumental = Boolean(activeHostLine?.isInstrumental || isInstrumentalText(activeLyricText));
  const isCurLyricRtl = isRtlText(activeLyricText);
  const activeLyricProgress = hostProgressPct;

  useEffect(() => {
    initSocialSync(false);
    loadQueue();
    emitRequestSync();

    // Auto-claim if host token is present in storage
    claimHostStation();

    const handleConnect = () => {
      claimHostStation();
    };
    socket.on('connect', handleConnect);

    const handleQueueUpdated = (q) => {
      if (Array.isArray(q)) {
        useQueueStore.getState().setQueue(q);
      }
    };
    socket.on('queue_updated', handleQueueUpdated);

    const handleSyncState = (state) => {
      if (state) {
        usePlaybackStore.getState().syncFromSocket(state);
      }
    };
    socket.on('sync_state', handleSyncState);

    const handlePlayerCommand = (cmd) => {
      if (!cmd) return;
      if (cmd.command === 'play') {
        const t = typeof cmd.time === 'number' ? cmd.time : usePlaybackStore.getState().currentTime;
        usePlaybackStore.setState({ isPlaying: true, currentTime: t });
        updateSyncAnchor(t, true);
      } else if (cmd.command === 'pause') {
        const t = typeof cmd.time === 'number' ? cmd.time : usePlaybackStore.getState().currentTime;
        usePlaybackStore.setState({ isPlaying: false, currentTime: t });
        updateSyncAnchor(t, false);
      } else if (cmd.command === 'seek' && typeof cmd.time === 'number') {
        usePlaybackStore.setState({ currentTime: cmd.time });
        updateSyncAnchor(cmd.time, usePlaybackStore.getState().isPlaying);
      } else if (cmd.command === 'set_volumes' && cmd.volumes) {
        const v = {
          inst: cmd.volumes.inst ?? cmd.volumes.instrumentals ?? 1,
          back: cmd.volumes.back ?? 1,
          lead: cmd.volumes.lead ?? cmd.volumes.vocals ?? 1
        };
        usePlaybackStore.setState({ volumes: v });
      }
    };
    socket.on('player_command', handlePlayerCommand);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('queue_updated', handleQueueUpdated);
      socket.off('sync_state', handleSyncState);
      socket.off('player_command', handlePlayerCommand);
    };
  }, []);

  // Smooth scrubber ticker for Host view
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      const cur = getAccuratePlaybackTime();
      usePlaybackStore.setState({ currentTime: cur });
    }, 100);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Host Keyboard Shortcuts matching Dashboard (Space, Q/A/Z, W/S/X, E/D/C)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || showSettingsModal || !isHostAuthorized) {
        return;
      }

      const key = e.key.toLowerCase();
      const step = 0.05;

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlayPause();
      } else if (key === 'q') {
        e.preventDefault();
        setVolumes({ inst: Math.min(1, (volumes?.inst ?? 1) + step) });
      } else if (key === 'a') {
        e.preventDefault();
        setVolumes({ inst: Math.max(0, (volumes?.inst ?? 1) - step) });
      } else if (key === 'z') {
        e.preventDefault();
        toggleStemMute('inst');
      } else if (key === 'w') {
        e.preventDefault();
        setVolumes({ back: Math.min(1, (volumes?.back ?? 1) + step) });
      } else if (key === 's') {
        e.preventDefault();
        setVolumes({ back: Math.max(0, (volumes?.back ?? 1) - step) });
      } else if (key === 'x') {
        e.preventDefault();
        toggleStemMute('back');
      } else if (key === 'e') {
        e.preventDefault();
        setVolumes({ lead: Math.min(1, (volumes?.lead ?? 1) + step) });
      } else if (key === 'd') {
        e.preventDefault();
        setVolumes({ lead: Math.max(0, (volumes?.lead ?? 1) - step) });
      } else if (key === 'c') {
        e.preventDefault();
        toggleStemMute('lead');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isHostAuthorized, showSettingsModal, volumes, setVolumes, toggleStemMute, isPlaying, currentTime]);

  const handleClaim = async (e) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    await claimHostStation(pinInput);
    setIsSubmitting(false);
  };

  const handleSendAnnouncement = async () => {
    const msg = prompt('Enter announcement message to display on all screens:');
    if (!msg || !msg.trim()) return;
    try {
      await socialApi.sendAnnouncement(msg.trim(), hostToken);
    } catch (err) {
      alert(`Could not send announcement: ${err.message}`);
    }
  };

  const handleTogglePlayPause = () => {
    const willPlay = !isPlaying;
    emitPlayerCommand({ command: willPlay ? 'play' : 'pause', time: currentTime });
  };

  const handleSkipNext = () => {
    emitPlayerCommand({ command: 'play_next' });
  };

  const handleRestartSong = () => {
    emitPlayerCommand({ command: 'seek', time: 0 });
    emitPlayerCommand({ command: 'play', time: 0 });
    usePlaybackStore.setState({ currentTime: 0, isPlaying: true });
    updateSyncAnchor(0, true);
  };

  const handleSeek = (e) => {
    const t = parseFloat(e.target.value) || 0;
    setIsDraggingSlider(false);
    emitPlayerCommand({ command: 'seek', time: t });
    usePlaybackStore.setState({ currentTime: t });
    updateSyncAnchor(t, isPlaying);
  };

  const getFaderStyle = (val) => {
    const v = Math.max(0, Math.min(1, parseFloat(val) || 0));
    const pct = v * 100;
    return {
      background: `linear-gradient(to top, var(--accent, #6366f1) ${pct}%, #ffffff ${pct}%)`,
      backgroundClip: 'content-box'
    };
  };

  // Lock Screen if not authorized
  if (!isHostAuthorized) {
    return (
      <div className="host-portal-container">
        <div className="host-lock-card glass">
          <div className="host-lock-header">
            <Crown size={42} className="host-icon-glow" />
            <h2>Host Console</h2>
            <p className="host-lock-subtitle">
              {isHostOccupiedByOther
                ? 'An active host session is currently running on another device.'
                : 'Take control of the party queue, approvals, and live audio mix.'}
            </p>
          </div>

          {hostClaimError && (
            <div className="host-error-banner">
              <AlertTriangle size={18} />
              <span>{hostClaimError}</span>
            </div>
          )}

          <form onSubmit={handleClaim} className="host-claim-form">
            {isHostOccupiedByOther && (
              <div className="form-group">
                <label htmlFor="hostPinInput">Enter Host PIN to Take Over</label>
                <input
                  id="hostPinInput"
                  type="password"
                  placeholder="Default PIN: 1234"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  className="input-glass"
                  autoFocus
                />
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-block" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <RefreshCw size={18} className="icon-spin" />
                  <span>Connecting...</span>
                </>
              ) : isHostOccupiedByOther ? (
                <>
                  <ShieldCheck size={18} />
                  <span>Take Over Host Console</span>
                </>
              ) : (
                <>
                  <Crown size={18} />
                  <span>Claim Host Station</span>
                </>
              )}
            </button>
          </form>

          <div className="host-footer-links">
            <a href="/dashboard.html" className="text-link">Go to Dashboard</a>
            <span className="dot-sep">•</span>
            <a href="/display.html" className="text-link" target="_blank" rel="noreferrer">Open Display</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="host-portal-container">
      <AnnouncementBanner />

      {/* Host Top Navigation Header */}
      <header className="host-header glass">
        <div className="host-brand">
          <Crown size={22} className="host-icon-active" />
          <div className="host-title-meta">
            <h1>{partySettings?.partyName || 'Host Console'}</h1>
            <span className="badge badge-success">Host Station Active</span>
          </div>
        </div>

        <div className="host-actions">
          <button
            className="btn glass-btn btn-sm"
            onClick={handleSendAnnouncement}
            title="Broadcast Alert to All Screens"
          >
            <Megaphone size={15} />
            <span className="host-action-label">Shoutout</span>
          </button>

          <button
            className="btn glass-btn btn-sm"
            onClick={() => setShowSettingsModal(true)}
            title="Party Settings & PIN"
          >
            <Settings size={15} />
            <span className="host-action-label">Settings</span>
          </button>

          <a
            href="/dashboard.html"
            className="btn glass-btn btn-sm"
            title="Switch to Full Dashboard"
          >
            <ExternalLink size={14} />
            <span className="host-action-label">Dashboard</span>
          </a>

          <a
            href="/display.html"
            target="_blank"
            rel="noreferrer"
            className="btn glass-btn btn-sm"
            title="Open Live Display Window"
          >
            <ExternalLink size={14} />
            <span className="host-action-label">Display</span>
          </a>

          <button
            className="btn glass-btn btn-sm btn-release"
            onClick={releaseHostStation}
            title="Vacate Host Role"
          >
            Release Host
          </button>
        </div>
      </header>

      {/* Live Stage Join Request Alert for Host */}
      {pendingStageRequests.length > 0 && (
        <div className="host-stage-request-banner glass">
          <div className="stage-request-icon-pulse">
            <Mic size={18} />
          </div>
          <div className="stage-request-info" dir="auto">
            <strong>Stage Join Request:</strong>
            <span>
              <span className="highlight-singer" dir="auto">{pendingStageRequests[0].nickname}</span> wants to join the stage for <em dir="auto">"{pendingStageRequests[0].songTitle}"</em>!
            </span>
          </div>
          <div className="stage-request-actions">
            <button
              className="btn btn-primary btn-sm btn-approve-stage"
              onClick={() => handleApproveStageRequest(pendingStageRequests[0].id)}
            >
              <Check size={14} />
              <span>Welcome to Stage</span>
            </button>
            <button
              className="btn glass-btn btn-sm btn-reject-stage"
              onClick={() => handleRejectStageRequest(pendingStageRequests[0].id)}
            >
              <X size={14} />
              <span>Decline</span>
            </button>
          </div>
        </div>
      )}

      {/* Now Playing Quick Control Bar */}
      <div className="host-now-playing-bar glass">
        <div className="host-track-info">
          <img
            src={currentSong?.albumArt || '/CtrlAltLyrics-logo.svg'}
            alt="Art"
            className="host-track-art"
            onError={(e) => { e.target.onerror = null; e.target.src = '/CtrlAltLyrics-logo.svg'; }}
          />
          <div className="host-track-meta">
            <strong dir="auto">{currentSong?.title || 'Ready for Playback'}</strong>
            <span dir="auto">{currentSong?.artist || 'Select a track from the queue'}</span>
            {currentSong?.singers?.length > 0 && (
              <span className="performer-badge" dir="auto">🎤 {currentSong.singers.join(' & ')}</span>
            )}
          </div>
        </div>

        <div className="host-transport-controls">
          <button className="btn glass-btn btn-icon-round" onClick={handleRestartSong} title="Restart (0:00)">
            <RotateCcw size={16} />
          </button>
          <button className="btn btn-primary btn-play-round" onClick={handleTogglePlayPause} title="Play/Pause (Space)">
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="btn glass-btn btn-icon-round" onClick={handleSkipNext} title="Next Track">
            <SkipForward size={16} />
          </button>
        </div>

        <div className="host-timeline-wrap">
          <span className="timeline-num">{formatTime(isDraggingSlider ? sliderDragVal : currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.5"
            value={isDraggingSlider ? sliderDragVal : (currentTime || 0)}
            onPointerDown={(e) => {
              setIsDraggingSlider(true);
              setSliderDragVal(parseFloat(e.target.value) || 0);
            }}
            onInput={(e) => {
              setIsDraggingSlider(true);
              setSliderDragVal(parseFloat(e.target.value) || 0);
            }}
            onChange={handleSeek}
            className="host-timeline-slider"
            disabled={!currentSong || duration <= 0}
            aria-label="Track progress slider"
          />
          <span className="timeline-num">{formatTime(duration)}</span>
        </div>

        {/* Live Stage Lyric Preview with Real-Time Karaoke Sweep Animation & Subtitle Toggles */}
        <div className="host-lyric-row">
          <div
            className={`host-lyric-preview glass ${isCurLyricRtl ? 'rtl' : 'ltr'}`}
            dir={isCurLyricRtl ? 'rtl' : 'ltr'}
            title="Click to view full Stage Teleprompter"
            onClick={() => setActiveHostTab('stage')}
            style={{ cursor: 'pointer' }}
          >
            <Music size={14} className="host-lyric-icon" aria-hidden="true" />
            <div className="host-lyric-text-wrap">
              {isCurLyricInstrumental ? (
                <div className="host-instrumental-row">
                  <span className="instrumental-icons" title="Instrumental section">
                    <i className="icon-music" aria-hidden="true"></i>
                    <i className="icon-music" aria-hidden="true"></i>
                    <i className="icon-music" aria-hidden="true"></i>
                  </span>
                </div>
              ) : (
                <span
                  ref={hostLyricTextRef}
                  className={`host-lyric-text ${!activeLyricText ? 'is-placeholder' : ''} ${isCurLyricRtl ? 'rtl' : 'ltr'}`}
                  style={{
                    '--karaoke-progress': `${activeLyricProgress.toFixed(1)}%`
                  }}
                  dir={isCurLyricRtl ? 'rtl' : 'ltr'}
                >
                  {activeLyricText || (currentSong ? (displayLyrics.length > 0 ? (
                    <span className="instrumental-icons">
                      <i className="icon-music" aria-hidden="true"></i>
                      <i className="icon-music" aria-hidden="true"></i>
                      <i className="icon-music" aria-hidden="true"></i>
                    </span>
                  ) : 'No lyrics synced') : 'No track loaded')}
                </span>
              )}
              {showTranslit && activeLyricTranslit && (
                <span className="host-lyric-subline translit" dir="ltr">{activeLyricTranslit}</span>
              )}
              {showTranslat && activeLyricTranslat && (
                <span className="host-lyric-subline translat" dir="auto">{activeLyricTranslat}</span>
              )}
            </div>
          </div>

          <div className="host-lyric-toggles">
            <button
              type="button"
              className={`subtitle-toggle-btn compact ${showTeleprompterDrawer ? 'active' : ''}`}
              title={showTeleprompterDrawer ? "Collapse Live Teleprompter Monitor" : "Expand Live Teleprompter Monitor"}
              aria-label="Toggle Teleprompter Monitor"
              onClick={() => setShowTeleprompterDrawer(!showTeleprompterDrawer)}
            >
              <i className="icon-file-text" aria-hidden="true"></i>
            </button>

            <label
              className="subtitle-toggle-btn compact"
              title={showTranslit ? "Hide Pronunciation / Transliteration" : "Show Pronunciation / Transliteration"}
            >
              <input
                type="checkbox"
                checked={showTranslit}
                onChange={(e) => setShowTranslit(e.target.checked)}
              />
              <span className="toggle-content">
                <i className="icon-ear" aria-hidden="true"></i>
              </span>
            </label>
            <label
              className="subtitle-toggle-btn compact"
              title={showTranslat ? "Hide Translation" : "Show Translation"}
            >
              <input
                type="checkbox"
                checked={showTranslat}
                onChange={(e) => setShowTranslat(e.target.checked)}
              />
              <span className="toggle-content">
                <i className="icon-languages" aria-hidden="true"></i>
              </span>
            </label>
          </div>
        </div>

        {/* Collapsible Full Stage Teleprompter Monitor with Smooth Lyrics Scroll Animation */}
        {showTeleprompterDrawer && (
          <div className="host-teleprompter-drawer glass" style={{ marginTop: '0.65rem' }}>
            <MobileTeleprompter
              showTranslit={showTranslit}
              setShowTranslit={setShowTranslit}
              showTranslat={showTranslat}
              setShowTranslat={setShowTranslat}
              title="Live Stage Teleprompter"
              allowSeek={true}
            />
          </div>
        )}
      </div>

      {/* Host Navigation Tabs */}
      <div className="host-tabs-nav glass">
        <button
          className={`host-tab-btn ${activeHostTab === 'stage' ? 'active' : ''}`}
          onClick={() => setActiveHostTab('stage')}
        >
          <Mic size={16} />
          <span>Stage</span>
        </button>
        <button
          className={`host-tab-btn ${activeHostTab === 'requests' ? 'active' : ''}`}
          onClick={() => setActiveHostTab('requests')}
        >
          <Music size={16} />
          <span>Requests</span>
        </button>
        <button
          className={`host-tab-btn ${activeHostTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveHostTab('queue')}
        >
          <Crown size={16} />
          <span>Queue ({queue.length})</span>
        </button>
        <button
          className={`host-tab-btn ${activeHostTab === 'mixer' ? 'active' : ''}`}
          onClick={() => setActiveHostTab('mixer')}
        >
          <Sliders size={16} />
          <span>Live Mixer</span>
        </button>
        <button
          className={`host-tab-btn ${activeHostTab === 'guests' ? 'active' : ''}`}
          onClick={() => setActiveHostTab('guests')}
        >
          <Users size={16} />
          <span>Guests ({guestCount})</span>
        </button>
      </div>

      {/* Main Tab View */}
      <main className="host-main-view">
        {activeHostTab === 'stage' && (
          <div className="host-stage-panel">
            <MobileTeleprompter
              showTranslit={showTranslit}
              setShowTranslit={setShowTranslit}
              showTranslat={showTranslat}
              setShowTranslat={setShowTranslat}
              title="Live Stage Teleprompter"
              allowSeek={true}
            />
          </div>
        )}

        {activeHostTab === 'requests' && <HostRequestsPanel />}

        {activeHostTab === 'queue' && (
          <div className="host-queue-panel">
            <div className="host-queue-header">
              <h3>Live Queue ({queue.length})</h3>
              <span className="queue-hint">Reorder songs or remove tracks</span>
            </div>

            {queue.length === 0 ? (
              <div className="requests-empty glass">
                <Music size={32} className="empty-icon" />
                <p>The queue is empty.</p>
              </div>
            ) : (
              <div className="host-queue-items">
                {queue.map((song, idx) => {
                  const qId = song.queueId || song.id;
                  const singers = Array.isArray(song.singers) ? song.singers : [];

                  return (
                    <div key={qId} className="host-queue-row glass">
                      <div className="host-reorder-buttons">
                        <button
                          className="btn-arrow"
                          disabled={idx === 0}
                          onClick={() => reorderItem(qId, 'up')}
                          title="Move Up"
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          className="btn-arrow"
                          disabled={idx === queue.length - 1}
                          onClick={() => reorderItem(qId, 'down')}
                          title="Move Down"
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>

                      <img
                        src={song.albumArt || '/CtrlAltLyrics-logo.svg'}
                        alt="Art"
                        className="host-queue-art"
                        onError={(e) => { e.target.onerror = null; e.target.src = '/CtrlAltLyrics-logo.svg'; }}
                      />

                      <div className="host-queue-info">
                        <strong dir="auto">{song.title}</strong>
                        <span dir="auto">{song.artist}</span>
                        {singers.length > 0 && (
                          <span className="singers-badge" dir="auto">🎤 {singers.join(' & ')}</span>
                        )}
                        {song.requestedBy?.nickname && (
                          <span className="queue-requester-tag" dir="auto">👤 {song.requestedBy.nickname}</span>
                        )}
                      </div>

                      <div className="host-queue-item-actions" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <button
                          className="btn glass-btn"
                          style={{ width: '32px', height: '32px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onClick={() => emitPlayerCommand({ command: 'select_song', id: song.id, queueId: qId })}
                          title="Play Track Now"
                        >
                          <Play size={14} />
                        </button>
                        <button
                          className="btn glass-btn btn-reject"
                          onClick={() => removeQueueItem(qId)}
                          title="Remove from Queue"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Master Vertical Stem Mixer Tab Matching Dashboard Layout */}
        {activeHostTab === 'mixer' && (
          <div className="host-mixer-panel glass">
            {/* Live Teleprompter Stage Monitor */}
            <div className="host-stage-teleprompter-wrap" style={{ marginBottom: '1.25rem' }}>
              <MobileTeleprompter
                showTranslit={showTranslit}
                setShowTranslit={setShowTranslit}
                showTranslat={showTranslat}
                setShowTranslat={setShowTranslat}
                allowSeek={true}
              />
            </div>

            <div className="host-mixer-header">
              <div className="host-mixer-title-row">
                <h3>Master Stem Mixer</h3>
                <span className="badge badge-success">Live Audio</span>
              </div>
              <p className="mixer-panel-subtitle">
                Vertical live stem faders matching the main Dashboard console
              </p>
            </div>

            <div className="mixer host-mixer-track-area">
              {/* Inst Fader */}
              <div className="fader-container">
                <span className="fader-shortcut-key" title="Keyboard Shortcuts: Q (+), A (-), Z (Mute)">
                  <span>Q +</span><span>A -</span><span>Z ×</span>
                </span>
                <span className="fader-val-tag" title="Instrumental Volume">
                  {Math.round((volumes?.inst ?? 1) * 100)}%
                </span>
                <input
                  type="range"
                  id="hostVolInst"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volumes?.inst ?? 1}
                  style={getFaderStyle(volumes?.inst ?? 1)}
                  onChange={(e) => setVolumes({ inst: parseFloat(e.target.value) })}
                  aria-label="Instrumental stem volume"
                />
                <div className="fader-bottom">
                  <button
                    type="button"
                    className={`fader-mute-btn ${(volumes?.inst ?? 1) <= 0.001 ? 'is-muted' : ''}`}
                    title="Mute/Unmute Inst (Z)"
                    onClick={() => toggleStemMute('inst')}
                  >
                    {(volumes?.inst ?? 1) <= 0.001 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <span className="fader-label">Inst</span>
                </div>
              </div>

              {/* Link Inst & Back */}
              <button
                type="button"
                className={`btn mixer-link-btn ${isInstBackLinked ? 'is-linked' : ''}`}
                style={{ opacity: isInstBackLinked ? 1 : 0.4 }}
                title={isInstBackLinked ? 'Linked Inst & Back (Click to Unlink)' : 'Unlinked Inst & Back (Click to Link)'}
                aria-label={isInstBackLinked ? 'Unlink instrumental and backing vocals' : 'Link instrumental and backing vocals'}
                onClick={() => setLinkInstBack(!isInstBackLinked)}
              >
                {isInstBackLinked ? <Link2 size={15} /> : <Unlink2 size={15} />}
              </button>

              {/* Back Fader */}
              <div className="fader-container">
                <span className="fader-shortcut-key" title="Keyboard Shortcuts: W (+), S (-), X (Mute)">
                  <span>W +</span><span>S -</span><span>X ×</span>
                </span>
                <span className="fader-val-tag" title="Backing Vocals Volume">
                  {Math.round((volumes?.back ?? 1) * 100)}%
                </span>
                <input
                  type="range"
                  id="hostVolBack"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volumes?.back ?? 1}
                  style={getFaderStyle(volumes?.back ?? 1)}
                  onChange={(e) => setVolumes({ back: parseFloat(e.target.value) })}
                  aria-label="Backing vocals stem volume"
                />
                <div className="fader-bottom">
                  <button
                    type="button"
                    className={`fader-mute-btn ${(volumes?.back ?? 1) <= 0.001 ? 'is-muted' : ''}`}
                    title="Mute/Unmute Back (X)"
                    onClick={() => toggleStemMute('back')}
                  >
                    {(volumes?.back ?? 1) <= 0.001 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <span className="fader-label">Back</span>
                </div>
              </div>

              {/* Link Back & Lead */}
              <button
                type="button"
                className={`btn mixer-link-btn ${isBackLeadLinked ? 'is-linked' : ''}`}
                style={{ opacity: isBackLeadLinked ? 1 : 0.4 }}
                title={isBackLeadLinked ? 'Linked Back & Lead (Click to Unlink)' : 'Unlinked Back & Lead (Click to Link)'}
                aria-label={isBackLeadLinked ? 'Unlink backing vocals and lead vocals' : 'Link backing vocals and lead vocals'}
                onClick={() => setLinkBackLead(!isBackLeadLinked)}
              >
                {isBackLeadLinked ? <Link2 size={15} /> : <Unlink2 size={15} />}
              </button>

              {/* Lead Fader */}
              <div className="fader-container">
                <span className="fader-shortcut-key" title="Keyboard Shortcuts: E (+), D (-), C (Mute)">
                  <span>E +</span><span>D -</span><span>C ×</span>
                </span>
                <span className="fader-val-tag" title="Lead Vocals Volume">
                  {Math.round((volumes?.lead ?? 1) * 100)}%
                </span>
                <input
                  type="range"
                  id="hostVolLead"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volumes?.lead ?? 1}
                  style={getFaderStyle(volumes?.lead ?? 1)}
                  onChange={(e) => setVolumes({ lead: parseFloat(e.target.value) })}
                  aria-label="Lead vocals stem volume"
                />
                <div className="fader-bottom">
                  <button
                    type="button"
                    className={`fader-mute-btn ${(volumes?.lead ?? 1) <= 0.001 ? 'is-muted' : ''}`}
                    title="Mute/Unmute Lead (C)"
                    onClick={() => toggleStemMute('lead')}
                  >
                    {(volumes?.lead ?? 1) <= 0.001 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <span className="fader-label">Lead</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeHostTab === 'guests' && (
          <div className="host-guests-panel glass">
            <h3>Connected Party Guests ({guests.length})</h3>
            <p className="mixer-panel-subtitle">Audience members connected via mobile QR code</p>

            {guests.length === 0 ? (
              <p className="no-requests-hint">No guests connected yet. Point your friends to the QR code on the Display screen!</p>
            ) : (
              <div className="guests-roster-list">
                {guests.map((g) => (
                  <div key={g.guestId} className="guest-roster-item glass">
                    <span className="avatar-dot" style={{ backgroundColor: g.avatarColor || '#6366f1', width: 14, height: 14 }} />
                    <div className="guest-roster-info">
                      <strong>{g.nickname}</strong>
                      <span>Joined {new Date(g.joinedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Host Settings Modal */}
      <HostSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />
    </div>
  );
}
