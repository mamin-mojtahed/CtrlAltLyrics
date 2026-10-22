import React, { useState, useEffect, useRef } from 'react';
import { useModalStore } from '../../stores/useModalStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { formatCentiseconds, parseCentiseconds } from '../../utils/themeColors';
import { isInstrumentalText } from '../../utils/lyricsWrapping';
import * as audioPlayer from '../../services/audioPlayer';
import { emitUpdateState } from '../../services/socket';

export default function LyricsSyncModal() {
  const rawModalSong = useModalStore((state) => state.lyricsSyncModalSong);
  const close = useModalStore((state) => state.closeLyricsSyncModal);
  const currentSong = usePlaybackStore((state) => state.currentSong);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const duration = usePlaybackStore((state) => state.duration) || 0;
  const seek = usePlaybackStore((state) => state.seek);
  const togglePlayPause = usePlaybackStore((state) => state.togglePlayPause);

  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState([]);
  const [timeStrings, setTimeStrings] = useState({});
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [activeTapIndex, setActiveTapIndex] = useState(0);
  const [isTapMode, setIsTapMode] = useState(false);
  const [nudgeUnit, setNudgeUnit] = useState('0.10');
  const [showTranslit, setShowTranslit] = useState(false);
  const [showTranslat, setShowTranslat] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [playbackTime, setPlaybackTime] = useState(0);

  const savedSnapshotRef = useRef('');
  const nudgeStep = Math.max(0.01, parseFloat(nudgeUnit) || 0.1);

  // Expose global helper for backward compatibility
  useEffect(() => {
    window.openSyncEditorModal = (songOrId) => {
      useModalStore.getState().openLyricsSyncModal(songOrId);
    };
  }, []);

  // Smooth 60 FPS playback time ticker for live tracker
  useEffect(() => {
    if (!rawModalSong) return;
    let rafId;
    const tick = () => {
      const cur = audioPlayer.getCurrentPlaybackTime(isPlaying) || 0;
      setPlaybackTime(cur);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, rawModalSong]);

  // Resolve song details when rawModalSong changes (supports ID string or song object)
  useEffect(() => {
    if (!rawModalSong) {
      setSong(null);
      setLines([]);
      return;
    }

    const songId = typeof rawModalSong === 'string' ? rawModalSong : rawModalSong.id;

    // Check if passed object already has lyrics populated
    if (typeof rawModalSong === 'object' && Array.isArray(rawModalSong.lyrics) && rawModalSong.lyrics.length > 0) {
      setSong(rawModalSong);
      return;
    }

    // Check if current playing song in store matches and has lyrics
    if (currentSong && currentSong.id === songId && Array.isArray(currentSong.lyrics) && currentSong.lyrics.length > 0) {
      setSong(currentSong);
      return;
    }

    // Fetch full song details with lyrics
    setLoading(true);
    fetch(`/api/song_details/${songId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.song) {
          setSong(data.song);
        } else if (typeof rawModalSong === 'object') {
          setSong(rawModalSong);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch song details for sync editor:', err);
        if (typeof rawModalSong === 'object') {
          setSong(rawModalSong);
        }
      })
      .finally(() => setLoading(false));
  }, [rawModalSong, currentSong]);

  // Initialize lines when resolved song is available
  useEffect(() => {
    if (song) {
      const initial = (song.lyrics || []).map((l, i) => {
        const isInst = !!l.isInstrumental || isInstrumentalText(l.text);
        let textVal = l.text || '';
        if (textVal === '🎵🎵🎵') {
          textVal = '';
        }
        return {
          id: i,
          time: typeof l.time === 'number' ? l.time : parseFloat(l.time) || 0,
          text: textVal,
          transliteration: l.transliteration || '',
          translation: l.translation || '',
          isInstrumental: isInst
        };
      });

      const hasTl = initial.some((l) => l.transliteration && l.transliteration.trim() !== '');
      const hasTr = initial.some((l) => l.translation && l.translation.trim() !== '');
      setShowTranslit(hasTl);
      setShowTranslat(hasTr);

      setLines(initial);
      setTimeStrings({});
      setUndoStack([]);
      setRedoStack([]);
      setSelectedRowIndex(initial.length > 0 ? 0 : -1);
      setActiveTapIndex(0);
      setIsTapMode(false);
      setIsDirty(false);
      savedSnapshotRef.current = JSON.stringify(initial);
    }
  }, [song]);

  const pushUndo = (newLines) => {
    setUndoStack((prev) => [...prev.slice(-40), lines]);
    setRedoStack([]);
    setLines(newLines);
    setIsDirty(true);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, lines]);
    setLines(prev);
    setTimeStrings({});
    setIsDirty(true);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, lines]);
    setLines(next);
    setTimeStrings({});
    setIsDirty(true);
  };

  const handleLineChange = (index, field, value) => {
    const next = [...lines];
    next[index] = { ...next[index], [field]: value };
    if (field === 'text') {
      const trimmed = (value || '').trim();
      next[index].isInstrumental = !trimmed || trimmed.toUpperCase() === '#INSTRUMENTAL';
    }
    pushUndo(next);
  };

  const handleTimeInputChange = (index, val) => {
    setTimeStrings((prev) => ({ ...prev, [index]: val }));
  };

  const handleTimeInputCommit = (index) => {
    const raw = timeStrings[index];
    if (raw !== undefined) {
      const parsed = parseCentiseconds(raw);
      const next = [...lines];
      next[index] = { ...next[index], time: parsed };
      pushUndo(next);
      setTimeStrings((prev) => {
        const copy = { ...prev };
        delete copy[index];
        return copy;
      });
    }
  };

  const handleTimeNudge = (index, delta) => {
    const next = [...lines];
    const cur = parseFloat(next[index].time) || 0;
    const target = Math.max(0, Math.round((cur + delta) * 100) / 100);
    next[index] = { ...next[index], time: target };
    pushUndo(next);
    setTimeStrings((prev) => {
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });
  };

  const handleBulkShift = (delta) => {
    const next = lines.map((l) => ({
      ...l,
      time: Math.max(0, Math.round(((parseFloat(l.time) || 0) + delta) * 100) / 100)
    }));
    pushUndo(next);
    setTimeStrings({});
  };

  const handleAddLine = (afterIndex) => {
    const prevTime = afterIndex >= 0 && lines[afterIndex] ? lines[afterIndex].time + 2 : 0;
    const newLine = {
      id: Date.now(),
      time: prevTime,
      text: '',
      transliteration: '',
      translation: '',
      isInstrumental: true
    };
    const next = [...lines];
    next.splice(afterIndex + 1, 0, newLine);
    pushUndo(next);
    setSelectedRowIndex(afterIndex + 1);
  };

  const handleDeleteLine = (index) => {
    const next = lines.filter((_, i) => i !== index);
    pushUndo(next);
    setTimeStrings({});
    if (next.length > 0) {
      setSelectedRowIndex(Math.max(0, Math.min(index, next.length - 1)));
    } else {
      setSelectedRowIndex(-1);
    }
  };

  const handlePlayLine = (time) => {
    seek(time);
    if (!isPlaying) {
      togglePlayPause();
    }
  };

  const handleStampCurrentLine = () => {
    const curTime = audioPlayer.getCurrentPlaybackTime(isPlaying) || 0;
    const stamped = Math.round(curTime * 100) / 100;
    const next = [...lines];
    if (next[activeTapIndex]) {
      next[activeTapIndex] = { ...next[activeTapIndex], time: stamped };
      pushUndo(next);
      setTimeStrings((prev) => {
        const copy = { ...prev };
        delete copy[activeTapIndex];
        return copy;
      });
    }
    if (activeTapIndex < lines.length - 1) {
      const nextIdx = activeTapIndex + 1;
      setActiveTapIndex(nextIdx);
      setSelectedRowIndex(nextIdx);
    } else {
      setIsTapMode(false);
    }
  };

  const handleSave = async () => {
    if (!song?.id) return;
    setIsSaving(true);
    const sorted = [...lines].sort((a, b) => a.time - b.time);
    const cleanPayload = sorted.map((l) => {
      const trimmed = (l.text || '').trim();
      const isInst = !trimmed || trimmed.toUpperCase() === '#INSTRUMENTAL' || l.isInstrumental;
      return {
        time: Math.round(l.time * 100) / 100,
        text: trimmed || '#INSTRUMENTAL',
        transliteration: l.transliteration?.trim() || undefined,
        translation: l.translation?.trim() || undefined,
        isInstrumental: isInst || undefined
      };
    });

    try {
      const res = await fetch('/api/edit_lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: song.id, lyrics: cleanPayload })
      });
      const data = await res.json();
      if (data.success) {
        savedSnapshotRef.current = JSON.stringify(lines);
        setIsDirty(false);
        if (currentSong && currentSong.id === song.id) {
          usePlaybackStore.setState({
            currentSong: { ...currentSong, lyrics: cleanPayload }
          });
          emitUpdateState({
            songId: song.id,
            songData: { ...currentSong, lyrics: cleanPayload }
          });
        }
      } else {
        alert('Failed to save lyrics.');
      }
    } catch (err) {
      console.error('Error saving lyrics:', err);
      alert('Error saving synced lyrics.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (isDirty) {
      if (!window.confirm('You have unsaved changes in Lyrics & Sync Editor. Discard and exit?')) {
        return;
      }
    }
    close();
  };

  // Keyboard navigation & shortcuts
  useEffect(() => {
    if (!rawModalSong) return;
    const handleKeyDown = (e) => {
      const isInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

      // Save shortcut: Ctrl+S / Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

      // Undo: Ctrl+Z / Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!isInput) {
          e.preventDefault();
          handleUndo();
        }
        return;
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        if (!isInput) {
          e.preventDefault();
          handleRedo();
        }
        return;
      }

      // Escape
      if (e.key === 'Escape') {
        if (isTapMode) {
          e.preventDefault();
          setIsTapMode(false);
        } else {
          handleClose();
        }
        return;
      }

      // Tap-to-sync shortcuts (when not typing in an input)
      if (isTapMode && !isInput) {
        if (e.code === 'ArrowDown') {
          e.preventDefault();
          handleStampCurrentLine();
        } else if (e.code === 'ArrowUp' || e.key === '<' || e.key === ',') {
          e.preventDefault();
          if (activeTapIndex > 0) {
            const newIdx = activeTapIndex - 1;
            setActiveTapIndex(newIdx);
            setSelectedRowIndex(newIdx);
            if (lines[newIdx]) seek(lines[newIdx].time);
          }
        } else if (e.key === '>' || e.key === '.') {
          e.preventDefault();
          if (activeTapIndex < lines.length - 1) {
            const newIdx = activeTapIndex + 1;
            setActiveTapIndex(newIdx);
            setSelectedRowIndex(newIdx);
            if (lines[newIdx]) seek(lines[newIdx].time);
          }
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          handleTimeNudge(activeTapIndex, -nudgeStep);
        } else if (e.code === 'ArrowRight') {
          e.preventDefault();
          handleTimeNudge(activeTapIndex, nudgeStep);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rawModalSong, isDirty, lines, activeTapIndex, isTapMode, nudgeStep, undoStack, redoStack]);

  if (!rawModalSong) return null;

  const songTitle = song?.title || (typeof rawModalSong === 'object' ? rawModalSong.title : 'Loading...');

  return (
    <div className="modal-backdrop" style={{ display: 'flex', zIndex: 3000 }} onClick={handleClose}>
      <div
        className="modal-box lyrics-sync-modal-box"
        style={{ maxWidth: '880px', width: '95vw', maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="sync-editor-title-wrap">
            <h3 style={{ margin: 0 }}>Lyrics &amp; Sync Editor: "{songTitle}"</h3>
            <span className={`sync-status-badge ${isDirty ? 'unsaved' : 'saved'}`}>
              <span className="sync-status-dot"></span>
              <span className="sync-status-text">{isDirty ? 'Unsaved' : 'Saved'}</span>
            </span>
          </div>
          <button className="btn-close" onClick={handleClose}><i className="icon-x"></i></button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
            <i className="icon-loader-2 icon-spin" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}></i>
            <p>Loading song lyrics...</p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="sync-toolbar">
              <div className="sync-toolbar-left">
                {/* Shift group with editable unit and - / + buttons */}
                <div className="sync-shift-group">
                  <span className="sync-shift-label">Shift:</span>
                  <button
                    type="button"
                    className="sync-shift-btn"
                    onClick={() => handleBulkShift(-nudgeStep)}
                    title={`Shift all earlier (-${nudgeStep}s)`}
                  >
                    <i className="icon-minus"></i>
                  </button>
                  <input
                    type="text"
                    className="sync-shift-input"
                    value={nudgeUnit}
                    onChange={(e) => setNudgeUnit(e.target.value)}
                    title="Adjustment unit in seconds"
                  />
                  <span className="sync-unit-label">(s)</span>
                  <button
                    type="button"
                    className="sync-shift-btn"
                    onClick={() => handleBulkShift(nudgeStep)}
                    title={`Shift all later (+${nudgeStep}s)`}
                  >
                    <i className="icon-plus"></i>
                  </button>
                </div>

                {/* Playback time tracker in mm:ss.cs */}
                <div className="sync-playback-tracker" title="Current Playback Time / Total Duration">
                  <span className="sync-tracker-icon"><i className="icon-clock"></i></span>
                  <span id="syncEditorCurTime">{formatCentiseconds(playbackTime)}</span>
                  <span className="sync-tracker-slash">/</span>
                  <span id="syncEditorDurTime">{formatCentiseconds(duration)}</span>
                </div>

                <span className="sync-line-count-badge">{lines.length} lines</span>
              </div>

              <div className="sync-toolbar-right">
                {/* Undo / Redo */}
                <div className="sync-btn-group">
                  <button
                    type="button"
                    className="sync-btn-icon"
                    onClick={handleUndo}
                    disabled={undoStack.length === 0}
                    title="Undo (Ctrl+Z)"
                  >
                    <i className="icon-undo-2"></i>
                  </button>
                  <button
                    type="button"
                    className="sync-btn-icon"
                    onClick={handleRedo}
                    disabled={redoStack.length === 0}
                    title="Redo (Ctrl+Y)"
                  >
                    <i className="icon-redo-2"></i>
                  </button>
                </div>

                <div className="sync-toolbar-divider"></div>

                {/* Column Toggles */}
                <div className="sync-btn-group">
                  <button
                    type="button"
                    className={`sync-btn-icon ${showTranslit ? 'active' : ''}`}
                    onClick={() => setShowTranslit(!showTranslit)}
                    title="Toggle Transliteration Column"
                  >
                    <i className="icon-ear"></i>
                  </button>
                  <button
                    type="button"
                    className={`sync-btn-icon ${showTranslat ? 'active' : ''}`}
                    onClick={() => setShowTranslat(!showTranslat)}
                    title="Toggle Translation Column"
                  >
                    <i className="icon-languages"></i>
                  </button>
                </div>

                <div className="sync-toolbar-divider"></div>

                {/* Tap-to-Sync Mode Toggle */}
                <div className="sync-btn-group">
                  <button
                    type="button"
                    className={`sync-btn-icon sync-metronome-btn ${isTapMode ? 'active' : ''}`}
                    onClick={() => setIsTapMode(!isTapMode)}
                    title={isTapMode ? "Exit Tap-to-Sync" : "Tap-to-Sync Mode"}
                  >
                    <i className="icon-clock"></i>
                  </button>
                </div>

                <div className="sync-toolbar-divider"></div>

                {/* Save Button */}
                <div className="sync-btn-group">
                  <button
                    type="button"
                    className="sync-btn-icon sync-save-btn"
                    onClick={handleSave}
                    disabled={isSaving || !isDirty}
                    title="Save Lyrics & Sync (Ctrl+S)"
                  >
                    <i className="icon-save"></i>
                  </button>
                </div>
              </div>
            </div>

            {/* Tap-to-Sync Active Banner */}
            {isTapMode && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.45rem 0.75rem',
                  background: 'rgba(59, 130, 246, 0.16)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  borderRadius: '8px',
                  marginBottom: '0.65rem'
                }}
              >
                <span style={{ fontSize: '0.78rem', color: '#93c5fd' }}>
                  <strong>Tap-to-Sync Active:</strong> Row {activeTapIndex + 1} of {lines.length} |
                  Press <strong>ArrowDown</strong> to stamp &amp; advance, <strong>ArrowUp</strong> to seek back,
                  <strong>ArrowLeft / Right</strong> to nudge by ±{nudgeStep}s.
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                  onClick={handleStampCurrentLine}
                >
                  <i className="icon-check" style={{ marginRight: '0.25rem' }}></i>
                  Stamp [{formatCentiseconds(playbackTime)}] &amp; Next (Row {activeTapIndex + 1})
                </button>
              </div>
            )}

            {/* Column Headers */}
            <div className="sync-col-headers">
              <div className="sync-col-hdr sync-col-play" style={{ width: '25px', flex: '0 0 25px' }}></div>
              <div
                className="sync-col-hdr sync-col-time"
                style={{ width: '150px', flex: '0 0 150px', textAlign: 'center' }}
                title="Minutes:Seconds.Centiseconds (mm:ss.cs)"
              >
                Time (mm:ss.cs)
              </div>
              <div className="sync-col-hdr sync-col-text">Lyrics</div>
              {showTranslit && <div className="sync-col-hdr sync-col-tl">Transliteration</div>}
              {showTranslat && <div className="sync-col-hdr sync-col-tr">Translation</div>}
              <div className="sync-col-hdr sync-col-actions" style={{ width: '26px', flex: '0 0 26px' }}></div>
            </div>

            {/* Rows List */}
            <div className="sync-editor-list" style={{ maxHeight: '56vh', overflowY: 'auto' }}>
              {lines.length === 0 ? (
                <div className="sync-empty-state">
                  <p>No lyrics found for this song.</p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleAddLine(-1)}
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <i className="icon-plus"></i> Add First Line
                  </button>
                </div>
              ) : (
                lines.map((line, idx) => {
                  const isSel = selectedRowIndex === idx || (isTapMode && activeTapIndex === idx);
                  return (
                    <div
                      key={line.id || idx}
                      className={`sync-row-wrapper ${isSel ? 'is-selected' : ''}`}
                      onClick={() => {
                        setSelectedRowIndex(idx);
                        if (isTapMode) setActiveTapIndex(idx);
                      }}
                    >
                      {/* Strip button to add line above */}
                      <button
                        type="button"
                        className="btn-add-line-strip btn-add-line-top"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddLine(idx - 1);
                        }}
                        title="Add line above"
                      >
                        <i className="icon-plus"></i> <span>Add line above</span>
                      </button>

                      <div className="sync-editor-row">
                        {/* Play Button */}
                        <button
                          type="button"
                          className="sync-line-play-btn sync-col-play"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayLine(line.time);
                          }}
                          title="Jump audio to this line"
                        >
                          <i className="icon-play"></i>
                        </button>

                        {/* Minus Icon Button */}
                        <button
                          type="button"
                          className="sync-shift-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTimeNudge(idx, -nudgeStep);
                          }}
                          title={`Nudge line earlier (-${nudgeStep}s)`}
                        >
                          <i className="icon-minus"></i>
                        </button>

                        {/* Time Input in MM:SS.cs */}
                        <input
                          type="text"
                          inputMode="decimal"
                          className="sync-time sync-col-time"
                          value={timeStrings[idx] !== undefined ? timeStrings[idx] : formatCentiseconds(line.time)}
                          onChange={(e) => handleTimeInputChange(idx, e.target.value)}
                          onBlur={() => handleTimeInputCommit(idx)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              e.target.blur();
                            }
                          }}
                          title="Time (mm:ss.cs)"
                        />

                        {/* Plus Icon Button */}
                        <button
                          type="button"
                          className="sync-shift-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTimeNudge(idx, nudgeStep);
                          }}
                          title={`Nudge line later (+${nudgeStep}s)`}
                        >
                          <i className="icon-plus"></i>
                        </button>

                        {/* Lyrics Text with #INSTRUMENTAL placeholder */}
                        <input
                          type="text"
                          className="sync-text sync-col-text"
                          value={line.text}
                          placeholder="#INSTRUMENTAL"
                          onChange={(e) => handleLineChange(idx, 'text', e.target.value)}
                        />

                        {/* Transliteration Column */}
                        {showTranslit && (
                          <input
                            type="text"
                            className="sync-tl sync-col-tl"
                            value={line.transliteration || ''}
                            placeholder="Transliteration..."
                            onChange={(e) => handleLineChange(idx, 'transliteration', e.target.value)}
                          />
                        )}

                        {/* Translation Column */}
                        {showTranslat && (
                          <input
                            type="text"
                            className="sync-tr sync-col-tr"
                            value={line.translation || ''}
                            placeholder="Translation..."
                            onChange={(e) => handleLineChange(idx, 'translation', e.target.value)}
                          />
                        )}

                        {/* Delete Line */}
                        <button
                          type="button"
                          className="sync-del-btn sync-col-actions"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteLine(idx);
                          }}
                          title="Delete line"
                        >
                          <i className="icon-x"></i>
                        </button>
                      </div>

                      {/* Strip button to add line below */}
                      <button
                        type="button"
                        className="btn-add-line-strip btn-add-line-bottom"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddLine(idx);
                        }}
                        title="Add line below"
                      >
                        <i className="icon-plus"></i> <span>Add line below</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
