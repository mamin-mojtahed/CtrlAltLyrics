import React, { useState, useEffect, useRef, useMemo } from 'react';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import {
  calculateKaraokeProgress,
  getLyricsMeasureContext,
  isRtlText,
  isInstrumentalText,
  prepareLyricsForDisplay
} from '../../utils/lyricsWrapping';

export default function MobileTeleprompter({
  showTranslit: propShowTranslit,
  setShowTranslit: propSetShowTranslit,
  showTranslat: propShowTranslat,
  setShowTranslat: propSetShowTranslat,
  title = "Live Mic Teleprompter",
  allowSeek = false,
} = {}) {
  const currentSong = usePlaybackStore((state) => state.currentSong);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const duration = usePlaybackStore((state) => state.duration);

  // Translation & Transliteration toggles - strictly OFF by default
  const [internalTranslit, setInternalTranslit] = useState(false);
  const [internalTranslat, setInternalTranslat] = useState(false);

  const showTranslit = propShowTranslit !== undefined ? propShowTranslit : internalTranslit;
  const setShowTranslit = propSetShowTranslit || setInternalTranslit;

  const showTranslat = propShowTranslat !== undefined ? propShowTranslat : internalTranslat;
  const setShowTranslat = propSetShowTranslat || setInternalTranslat;

  const [activeIdx, setActiveIdx] = useState(-1);
  const [progressPct, setProgressPct] = useState(0);

  const animFrameRef = useRef(null);
  const viewportRef = useRef(null);
  const lineRefs = useRef({});
  const isUserScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef(null);

  // Prepare display lyrics: inserts intro instrumental if needed & detects instrumental sections
  const rawLyrics = Array.isArray(currentSong?.lyrics) ? currentSong.lyrics : [];
  const lyrics = useMemo(() => {
    return prepareLyricsForDisplay(rawLyrics);
  }, [rawLyrics]);

  useEffect(() => {
    if (!isPlaying || lyrics.length === 0) {
      if (!isPlaying && lyrics.length > 0) {
        const time = usePlaybackStore.getState().currentTime || 0;
        updateActiveLine(time);
      }
      return;
    }

    const updateLoop = () => {
      const time = usePlaybackStore.getState().getAccuratePlaybackTime();
      updateActiveLine(time);
      animFrameRef.current = requestAnimationFrame(updateLoop);
    };

    animFrameRef.current = requestAnimationFrame(updateLoop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, lyrics, duration]);

  const updateActiveLine = (curTime) => {
    if (lyrics.length === 0) return;

    let foundIdx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      const lineTime = typeof lyrics[i].time === 'number' ? lyrics[i].time : parseFloat(lyrics[i].time) || 0;
      if (curTime >= lineTime) {
        foundIdx = i;
      } else {
        break;
      }
    }

    setActiveIdx(foundIdx);

    if (foundIdx >= 0) {
      const line = lyrics[foundIdx];
      const nextLine = foundIdx < lyrics.length - 1 ? lyrics[foundIdx + 1] : null;
      const nextTime = nextLine ? (typeof nextLine.time === 'number' ? nextLine.time : parseFloat(nextLine.time) || 0) : null;
      const ctx = getLyricsMeasureContext();
      const pct = calculateKaraokeProgress(line, curTime, nextTime, duration, ctx);
      setProgressPct(pct);
    } else {
      setProgressPct(0);
    }
  };

  // Smoothly scroll active line into center view when active line changes
  useEffect(() => {
    if (activeIdx >= 0 && lineRefs.current[activeIdx] && viewportRef.current) {
      if (!isUserScrollingRef.current) {
        lineRefs.current[activeIdx].scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    }
  }, [activeIdx]);

  const handleViewportScroll = () => {
    isUserScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
    }, 1800);
  };

  const isGuestTab = typeof window !== 'undefined' && (
    window.location.pathname.includes('guest') ||
    window.location.search.includes('guest') ||
    window.location.hash.includes('guest')
  );
  const canSeek = Boolean(allowSeek && !isGuestTab);

  const handleLineClick = (time) => {
    if (!canSeek) return;
    if (typeof time === 'number' && time >= 0) {
      usePlaybackStore.getState().seek(time);
    }
  };

  if (!currentSong) {
    return (
      <div className="mobile-teleprompter-empty glass">
        <p>No track currently playing</p>
      </div>
    );
  }

  if (lyrics.length === 0) {
    return (
      <div className="mobile-teleprompter-empty glass">
        <p>No timestamped lyrics available for this track</p>
      </div>
    );
  }

  const curLine = activeIdx >= 0 ? lyrics[activeIdx] : lyrics[0];
  const isCurRtl = isRtlText(curLine?.text);

  return (
    <div className={`mobile-teleprompter-card glass ${isCurRtl ? 'rtl' : 'ltr'}`} dir={isCurRtl ? 'rtl' : 'ltr'}>
      <div className="teleprompter-header">
        <span className="teleprompter-badge">{title}</span>
        <div className="teleprompter-toggles">
          <label
            className="subtitle-toggle-btn teleprompter-toggle-btn"
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
            className="subtitle-toggle-btn teleprompter-toggle-btn"
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

      <div
        className="teleprompter-scroll-viewport"
        ref={viewportRef}
        onScroll={handleViewportScroll}
      >
        <div className={`teleprompter-lines ${isCurRtl ? 'rtl' : 'ltr'}`} dir={isCurRtl ? 'rtl' : 'ltr'}>
          {lyrics.map((line, idx) => {
            const isActive = idx === activeIdx;
            const isPast = idx < activeIdx;
            const isFuture = idx > activeIdx;
            const isInst = Boolean(line.isInstrumental || isInstrumentalText(line.text));
            const lineIsRtl = isRtlText(line.text);

            return (
              <div
                key={line.id || idx}
                ref={(el) => (lineRefs.current[idx] = el)}
                id={`teleprompter_line_${idx}`}
                className={`teleprompter-line ${isActive ? 'active-line' : (isPast ? 'past-line' : 'future-line')} ${lineIsRtl ? 'rtl' : 'ltr'} ${isInst ? 'is-instrumental' : ''} ${canSeek ? 'can-seek' : ''}`}
                dir={lineIsRtl ? 'rtl' : 'ltr'}
                onClick={canSeek ? () => handleLineClick(line.time) : undefined}
                role={canSeek ? 'button' : undefined}
                tabIndex={canSeek ? 0 : undefined}
                onKeyDown={canSeek ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleLineClick(line.time);
                  }
                } : undefined}
              >
                {isInst ? (
                  <div className="teleprompter-instrumental-wrap">
                    <span className="instrumental-icons" title="Instrumental break / Solo">
                      <i className="icon-music" aria-hidden="true"></i>
                      <i className="icon-music" aria-hidden="true"></i>
                      <i className="icon-music" aria-hidden="true"></i>
                    </span>
                  </div>
                ) : (
                  <span
                    className={`teleprompter-active-text ${lineIsRtl ? 'rtl' : 'ltr'}`}
                    dir={lineIsRtl ? 'rtl' : 'ltr'}
                    style={{
                      '--karaoke-progress': isActive ? `${progressPct.toFixed(1)}%` : (isPast ? '100%' : '0%')
                    }}
                  >
                    {line.text}
                  </span>
                )}

                {showTranslit && line.transliteration && (
                  <span className="teleprompter-subline transliteration" dir="ltr">{line.transliteration}</span>
                )}
                {showTranslat && line.translation && (
                  <span className="teleprompter-subline translation" dir="auto">{line.translation}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
