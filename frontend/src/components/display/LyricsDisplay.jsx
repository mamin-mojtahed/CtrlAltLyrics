import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import socket from '../../services/socket';
import VisualizerCanvas from './VisualizerCanvas';
import {
  isRtlText,
  isInstrumentalText,
  getLyricsMeasureContext,
  balanceLyricLine,
  calculateMaxLineWidth,
  configureMeasureContext
} from '../../utils/lyricsWrapping';

function LyricsDisplay({
  song = null,
  lyrics = [],
  duration = 0,
  isPlaying = false,
  syncAnchorRef,
  accentColor = { r: 99, g: 102, b: 241 },
  showTranslit = false,
  showTranslat = false,
  showKaraokeSlide = true,
  showWaveform = true,
  onSeek
}) {
  const containerRef = useRef(null);
  const currentActiveIndexRef = useRef(-1);
  const [linePartitions, setLinePartitions] = useState({});

  const handleLineClick = (time) => {
    if (onSeek) {
      onSeek(time);
    }
  };

  // Re-calculate line breaks
  const updateLineBreaks = useCallback(() => {
    if (!containerRef.current) return;
    const maxLineWidth = calculateMaxLineWidth(containerRef.current);
    const ctx = getLyricsMeasureContext();
    const sampleLine = containerRef.current.querySelector('.lyric-line');
    configureMeasureContext(ctx, sampleLine || containerRef.current);

    const newPartitions = {};
    lyrics.forEach((line, idx) => {
      if (line.isInstrumental || isInstrumentalText(line.text)) return;
      const rawText = (line.text || '').trim();
      const words = rawText.split(/\s+/).filter(Boolean);
      if (words.length <= 1) return;

      const lines = balanceLyricLine(words, ctx, maxLineWidth);
      if (lines.length > 1) {
        newPartitions[idx] = lines;
      }
    });

    setLinePartitions(newPartitions);
  }, [lyrics]);

  // Observer and event listeners for container width changes
  useEffect(() => {
    let rafId = null;
    const debouncedUpdate = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        updateLineBreaks();
      });
    };

    debouncedUpdate();

    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      let lastWidth = 0;
      ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width;
          if (Math.abs(w - lastWidth) > 2) {
            lastWidth = w;
            debouncedUpdate();
          }
        }
      });
      ro.observe(containerRef.current);
      if (containerRef.current.parentElement) {
        ro.observe(containerRef.current.parentElement);
      }
    }

    window.addEventListener('resize', debouncedUpdate);

    // Re-check when custom fonts are ready
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(debouncedUpdate);
    }

    // Settle timeout for CSS flex/width transitions (e.g. sidebar toggle 0.4s)
    const timeout = setTimeout(debouncedUpdate, 420);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(timeout);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', debouncedUpdate);
    };
  }, [updateLineBreaks]);

  // Reset active line index tracking when lyrics or partitions change
  useEffect(() => {
    currentActiveIndexRef.current = -1;
  }, [lyrics, linePartitions]);

  // Dedicated 60/120/144 FPS animation frame loop for liquid-smooth karaoke slide-over fill
  useEffect(() => {
    let animId;

    const karaokeLoop = () => {
      animId = requestAnimationFrame(karaokeLoop);

      if (!lyrics || lyrics.length === 0 || !containerRef.current) return;

      // 1. Calculate microsecond-precise playback time from sync anchor
      const anchor = syncAnchorRef?.current;
      let curTime = anchor ? anchor.time : 0;
      if (anchor && anchor.isPlaying) {
        const now = performance.now();
        const elapsed = (now - anchor.timestamp) / 1000;
        curTime = Math.max(0, anchor.time + elapsed);
      }

      // 2. Find active lyric line index
      let activeIndex = -1;
      for (let i = 0; i < lyrics.length; i++) {
        if (curTime >= lyrics[i].time) {
          activeIndex = i;
        } else {
          break;
        }
      }

      // 3. Active line changed: update classes and scroll active line into center
      if (activeIndex !== currentActiveIndexRef.current) {
        currentActiveIndexRef.current = activeIndex;
        const lineElements = containerRef.current.querySelectorAll('.lyric-line');
        lineElements.forEach((el, i) => {
          if (i === activeIndex) {
            el.classList.add('active');
            el.classList.remove('past');
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else if (i < activeIndex) {
            el.classList.remove('active');
            el.classList.add('past');
            el.style.setProperty('--karaoke-progress', '100%');
            el.querySelectorAll('.lyric-subline').forEach((s) => s.style.setProperty('--karaoke-progress', '100%'));
          } else {
            el.classList.remove('active');
            el.classList.remove('past');
            el.style.setProperty('--karaoke-progress', '0%');
            el.querySelectorAll('.lyric-subline').forEach((s) => s.style.setProperty('--karaoke-progress', '0%'));
          }
        });
      }

      // 4. Update smooth continuous karaoke slide-over fill on active line
      if (activeIndex >= 0) {
        const activeEl = document.getElementById(`lyric_${activeIndex}`) ||
          containerRef.current.querySelector(`[data-index="${activeIndex}"]`);

        if (activeEl) {
          if (!showKaraokeSlide) {
            activeEl.style.removeProperty('--karaoke-progress');
            activeEl.querySelectorAll('.lyric-subline').forEach((s) => s.style.removeProperty('--karaoke-progress'));
            return;
          }

          const line = lyrics[activeIndex];
          const start = typeof line.time === 'number' ? line.time : parseFloat(line.time) || 0;
          let end;
          if (activeIndex < lyrics.length - 1) {
            const nextLine = lyrics[activeIndex + 1];
            const nextStart = typeof nextLine.time === 'number' ? nextLine.time : parseFloat(nextLine.time) || 0;
            end = nextStart > start ? nextStart : start + 3;
          } else {
            end = duration > start ? duration : start + 6;
          }

          const lineDur = Math.max(0.3, end - start);
          let progress = 0;
          if (curTime <= start) {
            progress = 0;
          } else if (curTime >= end) {
            progress = 100;
          } else {
            progress = Math.min(100, Math.max(0, ((curTime - start) / lineDur) * 100));
          }

          const sublines = activeEl.querySelectorAll('.lyric-subline');
          if (sublines.length > 1) {
            const totalChars = parseFloat(activeEl.getAttribute('data-total-chars')) || 1;
            let charAcc = 0;
            sublines.forEach((sub) => {
              const charCount = parseFloat(sub.getAttribute('data-chars')) || 1;
              const lineFraction = charCount / totalChars;
              const lineStartPct = (charAcc / totalChars) * 100;
              const lineEndPct = lineStartPct + lineFraction * 100;
              charAcc += charCount;

              let lineProg = 0;
              if (progress <= lineStartPct) {
                lineProg = 0;
              } else if (progress >= lineEndPct) {
                lineProg = 100;
              } else {
                lineProg = ((progress - lineStartPct) / (lineFraction * 100)) * 100;
              }
              sub.style.setProperty('--karaoke-progress', `${lineProg.toFixed(2)}%`);
            });
          } else {
            activeEl.style.setProperty('--karaoke-progress', `${progress.toFixed(2)}%`);
          }
        }
      }
    };

    animId = requestAnimationFrame(karaokeLoop);
    return () => cancelAnimationFrame(animId);
  }, [lyrics, duration, showKaraokeSlide, syncAnchorRef]);

  // Initial active index calculation for JSX layout
  const anchorTime = syncAnchorRef?.current ? syncAnchorRef.current.time : 0;
  let initialActive = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (anchorTime >= lyrics[i].time) {
      initialActive = i;
    } else {
      break;
    }
  }

  return (
    <main className="lyrics-main-content">
      {showWaveform && (
        <VisualizerCanvas
          song={song}
          duration={duration}
          isPlaying={isPlaying}
          syncAnchorRef={syncAnchorRef}
          accentColor={accentColor}
        />
      )}
      <div className="lyrics-container" id="lyricsContainer" ref={containerRef} dir="auto">
        {lyrics.length === 0 ? (
          <div className="lyrics-empty-state" style={{ textAlign: 'center', opacity: 0.5, marginTop: '20vh' }}>
            <h2>Ready to Play</h2>
            <p>Select a track from the Dashboard</p>
          </div>
        ) : (
          lyrics.map((line, idx) => {
            const isActive = idx === initialActive;
            const isPast = idx < initialActive;
            const isInst = !!line.isInstrumental || isInstrumentalText(line.text);
            const dir = isRtlText(line.text) ? 'rtl' : 'ltr';

            const sublines = linePartitions[idx];
            const hasSublines = !isInst && Array.isArray(sublines) && sublines.length > 1;

            const totalChars = hasSublines
              ? sublines.reduce((acc, s) => acc + Math.max(1, s.trim().length), 0)
              : 1;

            return (
              <div
                key={line.id || idx}
                id={`lyric_${idx}`}
                data-index={idx}
                data-time={line.time}
                data-total-chars={totalChars}
                className={`lyric-line ${dir} ${isActive ? 'active' : ''} ${isPast ? 'past' : ''} ${isInst ? 'is-instrumental' : ''}`}
                style={{
                  '--karaoke-progress': isPast ? '100%' : '0%',
                  cursor: 'pointer'
                }}
                dir={dir}
                onClick={() => handleLineClick(line.time)}
              >
                {showTranslit && line.transliteration && (
                  <span className="lyric-transliteration">{line.transliteration}</span>
                )}

                {hasSublines ? (
                  <span className="lyric-text has-sublines">
                    {sublines.map((sublineText, sIdx) => {
                      const charCount = Math.max(1, sublineText.trim().length);
                      return (
                        <div key={sIdx} className="lyric-subline-wrap">
                          <span
                            className="lyric-subline"
                            data-chars={charCount}
                            style={{ '--karaoke-progress': isPast ? '100%' : '0%' }}
                          >
                            {sublineText}
                          </span>
                        </div>
                      );
                    })}
                  </span>
                ) : (
                  <span className="lyric-text" data-raw-text={line.text || ''}>
                    {isInst ? (
                      <span className="instrumental-icons">
                        <i className="icon-music"></i> <i className="icon-music"></i> <i className="icon-music"></i>
                      </span>
                    ) : (
                      line.text
                    )}
                  </span>
                )}

                {showTranslat && line.translation && (
                  <span className="lyric-translation">{line.translation}</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}

export default memo(LyricsDisplay);
