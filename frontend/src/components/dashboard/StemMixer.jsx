import React, { useState, useRef, useEffect } from 'react';
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

  const [showShortcuts, setShowShortcuts] = useState(() => (typeof window !== 'undefined' ? window.innerWidth > 768 : true));

  // Magic Mouse Fader state
  const [magicButtons, setMagicButtons] = useState({ left: false, middle: false, right: false });
  const magicActiveRef = useRef(false);
  const lastClientYRef = useRef(null);

  // Dynamic track gradient calculation
  const getFaderStyle = (val) => {
    const v = Math.max(0, Math.min(1, parseFloat(val) || 0));
    const pct = v * 100;
    return {
      background: `linear-gradient(to top, var(--accent, #6366f1) ${pct}%, #ffffff ${pct}%)`,
      backgroundClip: 'content-box'
    };
  };

  // Magic Mouse Fader pointer handling
  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!magicActiveRef.current || lastClientYRef.current === null) return;
      const dy = e.clientY - lastClientYRef.current;
      lastClientYRef.current = e.clientY;
      if (dy === 0) return;

      const delta = -dy * 0.006;
      const clamp = (v) => Math.max(0, Math.min(1, Math.round(v * 1000) / 1000));
      const curVols = usePlaybackStore.getState().volumes;
      const newVols = { ...curVols };

      if (magicButtons.left) newVols.inst = clamp(curVols.inst + delta);
      if (magicButtons.middle) newVols.back = clamp(curVols.back + delta);
      if (magicButtons.right) newVols.lead = clamp(curVols.lead + delta);

      setVolumes(newVols);
    };

    const handlePointerUp = () => {
      if (magicActiveRef.current) {
        magicActiveRef.current = false;
        lastClientYRef.current = null;
        setMagicButtons({ left: false, middle: false, right: false });
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [magicButtons, setVolumes]);

  const handleMagicMouseDown = (e) => {
    e.preventDefault();
    magicActiveRef.current = true;
    lastClientYRef.current = e.clientY;

    const left = (e.buttons & 1) !== 0;
    const right = (e.buttons & 2) !== 0;
    const middle = (e.buttons & 4) !== 0;
    setMagicButtons({ left, middle, right });
  };

  return (
    <div className={`mixer-card ${!showShortcuts ? 'mixer-shortcuts-hidden' : ''}`}>
      <div
        className="panel-border-resizer resizer-lower-split"
        id="resizerLowerSplit"
        aria-hidden="true"
        title="Drag border to resize, double-tap to reset"
      />
      {/* Toggles for Pronunciation, Translation, Karaoke on top */}
      <div className="mixer-toggles-row">
        <span className="mixer-toggles-label">Show:</span>
        <div className="mixer-toggles-group">
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
        </div>
      </div>

      {/* Stem Audio Title, Shortcuts toggle & Magic Mouse Fader */}
      <div className="stem-mixer-header-container">
        <div className="stem-mixer-header-row">
          <button
            className={`mixer-shortcuts-toggle-btn ${showShortcuts ? 'active' : ''}`}
            title="Toggle Mixer Keyboard Shortcuts"
            onClick={() => setShowShortcuts(!showShortcuts)}
          >
            <i className="icon-keyboard"></i>
          </button>

          <h3>Stem Mixer</h3>

          <button
            className="magic-mouse-fader-btn magicMouseFaderBtn"
            title="Stem Mouse Fader: Hold Left (Inst), Middle (Back), Right (Lead) & Drag to Adjust"
            onPointerDown={handleMagicMouseDown}
            onContextMenu={(e) => e.preventDefault()}
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
