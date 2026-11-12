import React, { useState, useRef, useEffect, useCallback } from 'react';
import { usePlaybackStore } from '../../stores/usePlaybackStore';

export default function StemMixer() {
  const volumes = usePlaybackStore((state) => state.volumes);
  const setVolumes = usePlaybackStore((state) => state.setVolumes);
  const toggleStemMute = usePlaybackStore((state) => state.toggleStemMute);

  const isInstBackLinked = usePlaybackStore((state) => state.isInstBackLinked);
  const setLinkInstBack = usePlaybackStore((state) => state.setLinkInstBack);
  const isBackLeadLinked = usePlaybackStore((state) => state.isBackLeadLinked);
  const setLinkBackLead = usePlaybackStore((state) => state.setLinkBackLead);

  const showTranslit = usePlaybackStore((state) => state.showTranslit);
  const setShowTranslit = usePlaybackStore((state) => state.setShowTranslit);
  const showTranslat = usePlaybackStore((state) => state.showTranslat);
  const setShowTranslat = usePlaybackStore((state) => state.setShowTranslat);
  const showKaraokeSlide = usePlaybackStore((state) => state.showKaraokeSlide);
  const setShowKaraokeSlide = usePlaybackStore((state) => state.setShowKaraokeSlide);
  const showWaveform = usePlaybackStore((state) => state.showWaveform);
  const setShowWaveform = usePlaybackStore((state) => state.setShowWaveform);
  const showMusicVideo = usePlaybackStore((state) => state.showMusicVideo);
  const setShowMusicVideo = usePlaybackStore((state) => state.setShowMusicVideo);

  const [showShortcuts, setShowShortcuts] = useState(() => (typeof window !== 'undefined' ? window.innerWidth > 768 : true));

  // Revealed panel state: 'visual' (eye icon), 'controls' (gear icon), or null (off by default)
  const [revealedPanel, setRevealedPanel] = useState(() => {
    try {
      const saved = localStorage.getItem('ctrl_alt_lyrics_mixer_revealed_panel');
      if (saved === 'visual' || saved === 'controls') return saved;
      return null;
    } catch {
      return null;
    }
  });

  // Track currently displayed panel content for smooth close animation
  const [displayedPanel, setDisplayedPanel] = useState(revealedPanel || 'visual');

  useEffect(() => {
    if (revealedPanel) {
      setDisplayedPanel(revealedPanel);
    }
  }, [revealedPanel]);

  const handleTogglePanel = (panel) => {
    setRevealedPanel((prev) => {
      const next = prev === panel ? null : panel;
      try {
        if (next) {
          localStorage.setItem('ctrl_alt_lyrics_mixer_revealed_panel', next);
        } else {
          localStorage.removeItem('ctrl_alt_lyrics_mixer_revealed_panel');
        }
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  // Magic Mouse Fader state
  const [magicButtons, setMagicButtons] = useState({ left: false, middle: false, right: false });
  const magicActiveRef = useRef(false);
  const magicMouseBtnRef = useRef(null);
  const lastClientYRef = useRef(null);
  const activePointerIdRef = useRef(null);

  // Dynamic track gradient calculation
  const getFaderStyle = (val) => {
    const v = Math.max(0, Math.min(1, parseFloat(val) || 0));
    const pct = v * 100;
    return {
      background: `linear-gradient(to top, var(--accent, #6366f1) ${pct}%, #ffffff ${pct}%)`,
      backgroundClip: 'content-box'
    };
  };

  const endMagicMode = useCallback(() => {
    if (!magicActiveRef.current) return;
    magicActiveRef.current = false;
    lastClientYRef.current = null;
    setMagicButtons({ left: false, middle: false, right: false });

    if (document.pointerLockElement === magicMouseBtnRef.current) {
      try {
        document.exitPointerLock?.();
      } catch {
        // ignore pointer lock errors
      }
    }

    if (activePointerIdRef.current !== null && magicMouseBtnRef.current?.releasePointerCapture) {
      try {
        magicMouseBtnRef.current.releasePointerCapture(activePointerIdRef.current);
      } catch {
        // ignore capture release errors
      }
      activePointerIdRef.current = null;
    }
  }, []);

  const updateHeldButtonsFromEvent = useCallback((e) => {
    if (!magicActiveRef.current) return false;

    let buttons = e.buttons;
    if (e.type === 'pointerup' || e.type === 'mouseup') {
      if (e.button === 0) buttons &= ~1;
      else if (e.button === 1) buttons &= ~4;
      else if (e.button === 2) buttons &= ~2;
    } else if (e.type === 'pointerdown' || e.type === 'mousedown') {
      if (e.button === 0) buttons |= 1;
      else if (e.button === 1) buttons |= 4;
      else if (e.button === 2) buttons |= 2;
    }

    if (buttons === 0) {
      endMagicMode();
      return false;
    }

    const left = (buttons & 1) !== 0;
    const right = (buttons & 2) !== 0;
    const middle = (buttons & 4) !== 0;
    setMagicButtons({ left, middle, right });
    return true;
  }, [endMagicMode]);

  // Magic Mouse Fader pointer handling
  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!magicActiveRef.current) return;
      e.preventDefault();

      let dy = 0;
      if (document.pointerLockElement === magicMouseBtnRef.current && typeof e.movementY === 'number' && e.movementY !== 0) {
        dy = e.movementY;
      } else if (lastClientYRef.current !== null && typeof e.clientY === 'number') {
        dy = e.clientY - lastClientYRef.current;
      }
      if (typeof e.clientY === 'number') {
        lastClientYRef.current = e.clientY;
      }

      if (!updateHeldButtonsFromEvent(e)) return;
      if (dy === 0) return;

      const delta = -dy * 0.006;
      const clamp = (v) => Math.max(0, Math.min(1, Math.round(v * 1000) / 1000));
      const curVols = usePlaybackStore.getState().volumes;
      const newVols = { ...curVols };

      let buttons = e.buttons;
      const left = (buttons & 1) !== 0;
      const right = (buttons & 2) !== 0;
      const middle = (buttons & 4) !== 0;

      if (left) newVols.inst = clamp(curVols.inst + delta);
      if (middle) newVols.back = clamp(curVols.back + delta);
      if (right) newVols.lead = clamp(curVols.lead + delta);

      setVolumes(newVols);
    };

    const handlePointerUp = (e) => {
      if (magicActiveRef.current) {
        e.preventDefault();
        updateHeldButtonsFromEvent(e);
      }
    };

    const handleWindowPointerDown = (e) => {
      if (magicActiveRef.current) {
        e.preventDefault();
        updateHeldButtonsFromEvent(e);
      }
    };

    const handleWindowContextMenu = (e) => {
      if (magicActiveRef.current) {
        e.preventDefault();
      }
    };

    const handleWindowAuxClick = (e) => {
      if (magicActiveRef.current) {
        e.preventDefault();
      }
    };

    const handleWindowBlur = () => {
      if (magicActiveRef.current) {
        endMagicMode();
      }
    };

    const handlePointerLockChange = () => {
      if (document.pointerLockElement !== magicMouseBtnRef.current && magicActiveRef.current) {
        endMagicMode();
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('mousedown', handleWindowPointerDown);
    window.addEventListener('pointercancel', endMagicMode);
    window.addEventListener('contextmenu', handleWindowContextMenu, { capture: true });
    window.addEventListener('auxclick', handleWindowAuxClick, { capture: true });
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('mousedown', handleWindowPointerDown);
      window.removeEventListener('pointercancel', endMagicMode);
      window.removeEventListener('contextmenu', handleWindowContextMenu, { capture: true });
      window.removeEventListener('auxclick', handleWindowAuxClick, { capture: true });
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, [setVolumes, updateHeldButtonsFromEvent, endMagicMode]);

  const handleMagicMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();

    magicActiveRef.current = true;
    lastClientYRef.current = e.clientY;
    activePointerIdRef.current = typeof e.pointerId === 'number' ? e.pointerId : null;

    let buttons = e.buttons;
    if (!buttons) {
      if (e.button === 0) buttons = 1;
      else if (e.button === 1) buttons = 4;
      else if (e.button === 2) buttons = 2;
    }

    const left = (buttons & 1) !== 0;
    const right = (buttons & 2) !== 0;
    const middle = (buttons & 4) !== 0;
    setMagicButtons({ left, middle, right });

    // Request pointer lock to lock mouse pointer in its place
    if (magicMouseBtnRef.current?.requestPointerLock) {
      try {
        const p = magicMouseBtnRef.current.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // ignore pointer lock errors
      }
    }

    // Pointer capture fallback/supplement
    if (typeof e.pointerId === 'number' && magicMouseBtnRef.current?.setPointerCapture) {
      try {
        magicMouseBtnRef.current.setPointerCapture(e.pointerId);
      } catch {
        // ignore pointer capture errors
      }
    }
  };

  return (
    <div className={`mixer-card ${!showShortcuts ? 'mixer-shortcuts-hidden' : ''}`}>
      <div
        className="panel-border-resizer resizer-lower-split"
        id="resizerLowerSplit"
        aria-hidden="true"
        title="Drag border to resize, double-tap to reset"
      />
      {/* Top Bar: STEM MIXER title and Eye / Gear action buttons */}
      <div className="stem-mixer-top-bar">
        <span className="stem-mixer-title">STEM MIXER</span>
        <div className="stem-mixer-actions">
          <button
            type="button"
            className={`mixer-action-btn ${revealedPanel === 'visual' ? 'active' : ''}`}
            onClick={() => handleTogglePanel('visual')}
            title={revealedPanel === 'visual' ? 'Hide Visual Show Toggles' : 'Show Visual Show Toggles'}
            aria-label="Visual Toggles"
          >
            <i className="icon-eye"></i>
          </button>
          <button
            type="button"
            className={`mixer-action-btn ${revealedPanel === 'controls' ? 'active' : ''}`}
            onClick={() => handleTogglePanel('controls')}
            title={revealedPanel === 'controls' ? 'Hide Mixer Controls' : 'Show Mixer Controls'}
            aria-label="Mixer Controls"
          >
            <i className="icon-settings"></i>
          </button>
        </div>
      </div>

      {/* Dynamic Animated Revealed Tray (Visual Toggles or Controls) */}
      <div className={`mixer-revealed-tray ${revealedPanel ? 'is-open' : 'is-closed'}`}>
        <div className="mixer-revealed-track">
          <div className="mixer-revealed-inner">
            {displayedPanel === 'visual' && (
              <div key="visual" className="mixer-tray-content mixer-visual-toggles-row">
                <label className="subtitle-toggle-btn" title="Pronunciation">
                  <input
                    type="checkbox"
                    checked={showTranslit}
                    onChange={(e) => setShowTranslit(e.target.checked)}
                  />
                  <span className="toggle-content"><i className="icon-ear"></i></span>
                </label>
                <label className="subtitle-toggle-btn" title="Translation">
                  <input
                    type="checkbox"
                    checked={showTranslat}
                    onChange={(e) => setShowTranslat(e.target.checked)}
                  />
                  <span className="toggle-content"><i className="icon-languages"></i></span>
                </label>
                <label className="subtitle-toggle-btn" title="Karaoke Slide Fill">
                  <input
                    type="checkbox"
                    checked={showKaraokeSlide}
                    onChange={(e) => setShowKaraokeSlide(e.target.checked)}
                  />
                  <span className="toggle-content"><i className="icon-clock-fading"></i></span>
                </label>
                <label className="subtitle-toggle-btn" title="Audio Waveform Visualization">
                  <input
                    type="checkbox"
                    checked={showWaveform}
                    onChange={(e) => setShowWaveform(e.target.checked)}
                  />
                  <span className="toggle-content"><i className="icon-audio-waveform"></i></span>
                </label>
                <label className="subtitle-toggle-btn" title="YouTube Music Video Background">
                  <input
                    type="checkbox"
                    checked={showMusicVideo}
                    onChange={(e) => setShowMusicVideo(e.target.checked)}
                  />
                  <span className="toggle-content"><i className="icon-video"></i></span>
                </label>
              </div>
            )}

            {displayedPanel === 'controls' && (
              <div key="controls" className="mixer-tray-content mixer-controls-row">
                <button
                  type="button"
                  className={`mixer-shortcuts-toggle-btn ${showShortcuts ? 'active' : ''}`}
                  title="Toggle Mixer Keyboard Shortcuts"
                  onClick={() => setShowShortcuts(!showShortcuts)}
                >
                  <i className="icon-keyboard"></i>
                </button>

                <button
                  type="button"
                  ref={magicMouseBtnRef}
                  className={`magic-mouse-fader-btn magicMouseFaderBtn ${magicButtons.left || magicButtons.middle || magicButtons.right ? 'active' : ''}`}
                  title="Stem Mouse Fader: Hold Left (Inst), Middle (Back), Right (Lead) & Drag to Adjust"
                  onPointerDown={handleMagicMouseDown}
                  onMouseDown={handleMagicMouseDown}
                  onContextMenu={(e) => e.preventDefault()}
                  onAuxClick={(e) => e.preventDefault()}
                >
                  <svg viewBox="0 0 24 30" className="magic-mouse-svg" xmlns="http://www.w3.org/2000/svg">
                    <path
                      className={`mouse-btn mouse-btn-left ${magicButtons.left ? 'active' : ''}`}
                      d="M 3,12.5 L 3,7 C 3,4.2 5.2,2 8.4,2 L 8.4,12.5 Z"
                    />
                    <path
                      className={`mouse-btn mouse-btn-middle ${magicButtons.middle ? 'active' : ''}`}
                      d="M 9.3,2 L 14.7,2 L 14.7,12.5 L 9.3,12.5 Z"
                    />
                    <path
                      className={`mouse-btn mouse-btn-right ${magicButtons.right ? 'active' : ''}`}
                      d="M 15.6,2 C 18.8,2 21,4.2 21,7 L 21,12.5 L 15.6,12.5 Z"
                    />
                    <path className="mouse-body" d="M 3,13.8 L 21,13.8 L 21,21 C 21,25.5 17.5,28 12,28 C 6.5,28 3,25.5 3,21 Z" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mixer">
        {/* Inst Fader */}
        <div className="fader-container">
          <span className="fader-shortcut-key" title="Keyboard Shortcuts: Q (Vol +), A (Vol -), Z (Mute)">
            <span>Q +</span><span>A -</span><span>Z ×</span>
          </span>
          <input
            type="range"
            id="volInst"
            min="0"
            max="1"
            step="0.01"
            value={volumes.inst}
            style={getFaderStyle(volumes.inst)}
            onChange={(e) => setVolumes({ inst: parseFloat(e.target.value) })}
          />
          <div className="fader-bottom">
            <button
              type="button"
              className={`fader-mute-btn ${volumes.inst <= 0.001 ? 'is-muted' : ''}`}
              title={`Mute/Unmute Inst (Z)`}
              onClick={() => toggleStemMute('inst')}
            >
              <i className={volumes.inst <= 0.001 ? 'icon-volume-x' : 'icon-volume-2'}></i>
            </button>
            <span className="fader-label">Inst</span>
          </div>
        </div>

        {/* Link Inst & Back */}
        <button
          className="btn mixer-link-btn"
          style={{ opacity: isInstBackLinked ? 1 : 0.4 }}
          title={isInstBackLinked ? 'Linked Inst & Back (Click to Unlink)' : 'Unlinked Inst & Back (Click to Link)'}
          onClick={() => setLinkInstBack(!isInstBackLinked)}
        >
          <i className={isInstBackLinked ? 'icon-link-2' : 'icon-unlink-2'}></i>
        </button>

        {/* Back Fader */}
        <div className="fader-container">
          <span className="fader-shortcut-key" title="Keyboard Shortcuts: W (Vol +), S (Vol -), X (Mute)">
            <span>W +</span><span>S -</span><span>X ×</span>
          </span>
          <input
            type="range"
            id="volBackVoc"
            min="0"
            max="1"
            step="0.01"
            value={volumes.back}
            style={getFaderStyle(volumes.back)}
            onChange={(e) => setVolumes({ back: parseFloat(e.target.value) })}
          />
          <div className="fader-bottom">
            <button
              type="button"
              className={`fader-mute-btn ${volumes.back <= 0.001 ? 'is-muted' : ''}`}
              title={`Mute/Unmute Back (X)`}
              onClick={() => toggleStemMute('back')}
            >
              <i className={volumes.back <= 0.001 ? 'icon-volume-x' : 'icon-volume-2'}></i>
            </button>
            <span className="fader-label">Back</span>
          </div>
        </div>

        {/* Link Back & Lead */}
        <button
          className="btn mixer-link-btn"
          style={{ opacity: isBackLeadLinked ? 1 : 0.4 }}
          title={isBackLeadLinked ? 'Linked Back & Lead (Click to Unlink)' : 'Unlinked Back & Lead (Click to Link)'}
          onClick={() => setLinkBackLead(!isBackLeadLinked)}
        >
          <i className={isBackLeadLinked ? 'icon-link-2' : 'icon-unlink-2'}></i>
        </button>

        {/* Lead Fader */}
        <div className="fader-container">
          <span className="fader-shortcut-key" title="Keyboard Shortcuts: E (Vol +), D (Vol -), C (Mute)">
            <span>E +</span><span>D -</span><span>C ×</span>
          </span>
          <input
            type="range"
            id="volLeadVoc"
            min="0"
            max="1"
            step="0.01"
            value={volumes.lead}
            style={getFaderStyle(volumes.lead)}
            onChange={(e) => setVolumes({ lead: parseFloat(e.target.value) })}
          />
          <div className="fader-bottom">
            <button
              type="button"
              className={`fader-mute-btn ${volumes.lead <= 0.001 ? 'is-muted' : ''}`}
              title={`Mute/Unmute Lead (C)`}
              onClick={() => toggleStemMute('lead')}
            >
              <i className={volumes.lead <= 0.001 ? 'icon-volume-x' : 'icon-volume-2'}></i>
            </button>
            <span className="fader-label">Lead</span>
          </div>
        </div>
      </div>
    </div>
  );
}
