import React, { useState, useEffect, useRef, useMemo } from 'react';
import socket, { emitRequestSync, emitPlayerCommand, emitUpdateState } from './services/socket';
import * as audioPlayer from './services/audioPlayer';
import { fetchQueue, fetchSong } from './services/api';
import SongSidebar from './components/display/SongSidebar';
import LyricsDisplay from './components/display/LyricsDisplay';
import { useDisplayResizer } from './hooks/useDisplayResizer';
import { extractColorsFromSongCover, getHighResAlbumArt } from './utils/themeColors';
import { prepareLyricsForDisplay } from './utils/lyricsWrapping';
import { extractYoutubeId } from './utils/youtube';

export default function DisplayApp() {
  const [song, setSong] = useState(null);
  const [queue, setQueue] = useState([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volumes, setVolumes] = useState({ inst: 1, back: 1, lead: 1 });
  const [audioMaster, setAudioMaster] = useState(null);
  const [showTranslit, setShowTranslit] = useState(false);
  const [showTranslat, setShowTranslat] = useState(false);
  const [showKaraokeSlide, setShowKaraokeSlide] = useState(true);
  const [showWaveform, setShowWaveform] = useState(true);
  const [showMusicVideo, setShowMusicVideo] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [accentColor, setAccentColor] = useState({ r: 99, g: 102, b: 241 });

  // Refs for callbacks & keyboard handlers
  const songRef = useRef(null);
  const queueRef = useRef([]);
  const volumesRef = useRef({ inst: 1, back: 1, lead: 1 });
  const prevFaderVolumesRef = useRef({ inst: 1, back: 1, lead: 1 });
  const audioMasterRef = useRef(null);

  // High-precision sync anchor for 60/120fps liquid smooth karaoke sliding
  const syncAnchorRef = useRef({ time: 0, timestamp: performance.now(), isPlaying: false });

  // Initialize display sidebar border resizer
  useDisplayResizer();

  // Socket setup & initial data sync
  useEffect(() => {
    emitRequestSync();

    fetchQueue()
      .then(q => {
        if (Array.isArray(q)) {
          setQueue(q);
          queueRef.current = q;
        }
      })
      .catch(err => console.warn("Could not prefetch queue for display:", err));

    socket.on('sync_state', (state) => {
      if (!state) return;

      if (state.songData) {
        const resolvedSongId = state.songData.id || state.songData.songId || state.songId;
        const currentSongId = songRef.current?.id || songRef.current?.songId;
        const queueId = state.queueId || state.songData.queueId || (currentSongId === resolvedSongId ? songRef.current.queueId : null);
        const incomingLyrics = Array.isArray(state.songData.lyrics) && state.songData.lyrics.length > 0 ? state.songData.lyrics : null;
        const currentLyrics = songRef.current?.lyrics || [];
        const resolvedYtId = state.songData.youtubeId || state.songData.youtube_id || extractYoutubeId(state.songData.youtubeUrl) || extractYoutubeId(state.songData.youtube_url) || null;
        const resolvedYtUrl = state.songData.youtubeUrl || state.songData.youtube_url || (resolvedYtId ? `https://www.youtube.com/watch?v=${resolvedYtId}` : null);

        const fullSong = {
          ...state.songData,
          id: resolvedSongId,
          youtubeId: resolvedYtId,
          youtubeUrl: resolvedYtUrl,
          queueId,
          lyrics: incomingLyrics || currentLyrics
        };
        const isNewTrack = !songRef.current ||
          currentSongId !== resolvedSongId ||
          (queueId && songRef.current.queueId && String(songRef.current.queueId) !== String(queueId));

        if (isNewTrack) {
          audioPlayer.stopAllSources();

          const initialTime = typeof state.currentTime === 'number' ? state.currentTime : 0;
          const initialPlaying = typeof state.isPlaying === 'boolean' ? state.isPlaying : false;
          syncAnchorRef.current.time = initialTime;
          syncAnchorRef.current.timestamp = performance.now();
          syncAnchorRef.current.isPlaying = initialPlaying;
          setCurrentTime(initialTime);
          setIsPlaying(initialPlaying);

          if (state.audioMaster !== undefined) {
            audioMasterRef.current = state.audioMaster;
            setAudioMaster(state.audioMaster);
          }

          setSong(fullSong);
          songRef.current = fullSong;
          const colorSrc = fullSong.id ? `/api/cover/${fullSong.id}` : getHighResAlbumArt(fullSong.albumArt);
          extractColorsFromSongCover(colorSrc);

          audioPlayer.setupAudio(fullSong, volumesRef.current).then((dur) => {
            if (dur > 0) setDuration(dur);
            if (audioMasterRef.current === 'display' && (state.isPlaying || syncAnchorRef.current.isPlaying)) {
              audioPlayer.playAudio(syncAnchorRef.current.time);
            }
          });
        } else {
          setSong(fullSong);
          songRef.current = fullSong;
          const colorSrc = fullSong.id ? `/api/cover/${fullSong.id}` : getHighResAlbumArt(fullSong.albumArt);
          extractColorsFromSongCover(colorSrc);
        }
      } else if (('songId' in state && state.songId === null) || ('songData' in state && state.songData === null)) {
        handleEndQueue(true);
      }

      if (state.currentTime !== undefined) {
        if (!syncAnchorRef.current.isPlaying || audioMasterRef.current !== 'display') {
          setCurrentTime(state.currentTime);
          const now = performance.now();
          syncAnchorRef.current.time = state.currentTime;
          syncAnchorRef.current.timestamp = now;
        } else {
          const now = performance.now();
          const curAnchor = syncAnchorRef.current;
          const currentEstimated = curAnchor.time + (now - curAnchor.timestamp) / 1000;
          const delta = state.currentTime - currentEstimated;
          // Only snap anchor if delta is significant (e.g. user sought or jumped lines)
          if (Math.abs(delta) > 0.45) {
            curAnchor.time = state.currentTime;
            curAnchor.timestamp = now;
            setCurrentTime(state.currentTime);
          }
        }
      }

      if (state.duration !== undefined) {
        if (state.duration > 0 || state.songId === null || state.songData === null) {
          setDuration(state.duration);
        }
      }

      if (state.isPlaying !== undefined && state.isPlaying !== syncAnchorRef.current.isPlaying) {
        setIsPlaying(state.isPlaying);
        const now = performance.now();
        if (state.isPlaying) {
          syncAnchorRef.current.isPlaying = true;
          syncAnchorRef.current.timestamp = now;
        } else {
          const elapsed = (now - syncAnchorRef.current.timestamp) / 1000;
          syncAnchorRef.current.time = Math.max(0, syncAnchorRef.current.time + elapsed);
          syncAnchorRef.current.isPlaying = false;
          syncAnchorRef.current.timestamp = now;
          audioPlayer.stopAllSources();
        }
      }

      if (state.volumes) {
        const v = {
          inst: state.volumes.inst ?? state.volumes.instrumentals ?? volumesRef.current.inst,
          back: state.volumes.back ?? volumesRef.current.back,
          lead: state.volumes.lead ?? state.volumes.vocals ?? volumesRef.current.lead
        };
        if (v.inst > 0.001) prevFaderVolumesRef.current.inst = v.inst;
        if (v.back > 0.001) prevFaderVolumesRef.current.back = v.back;
        if (v.lead > 0.001) prevFaderVolumesRef.current.lead = v.lead;
        setVolumes(v);
        volumesRef.current = v;
        audioPlayer.setStemVolumes(v);
      }

      if (state.audioMaster !== undefined) {
        audioMasterRef.current = state.audioMaster;
        setAudioMaster(state.audioMaster);
        // If Dashboard is active master, do not output duplicate audio from Display
        if (state.audioMaster === 'dashboard' && (state.isPlaying || syncAnchorRef.current.isPlaying)) {
          audioPlayer.stopAllSources();
        }
      }

      if (state.showTranslit !== undefined) setShowTranslit(state.showTranslit);
      if (state.showTranslat !== undefined) setShowTranslat(state.showTranslat);
      if (state.showKaraokeSlide !== undefined) setShowKaraokeSlide(state.showKaraokeSlide);
      if (state.showWaveform !== undefined) setShowWaveform(state.showWaveform);
      if (state.showMusicVideo !== undefined) setShowMusicVideo(state.showMusicVideo);
    });

    socket.on('player_command', (cmd) => {
      if (!cmd) return;
      if (cmd.sender && socket.id && cmd.sender === socket.id) return;

      if (cmd.command === 'seek' && typeof cmd.time === 'number') {
        setCurrentTime(cmd.time);
        syncAnchorRef.current.time = cmd.time;
        syncAnchorRef.current.timestamp = performance.now();
        if (audioMasterRef.current === 'display') {
          audioPlayer.seekAudio(cmd.time, syncAnchorRef.current.isPlaying);
        }
      } else if (cmd.command === 'play') {
        setIsPlaying(true);
        syncAnchorRef.current.isPlaying = true;
        if (typeof cmd.time === 'number') {
          setCurrentTime(cmd.time);
          syncAnchorRef.current.time = cmd.time;
        }
        syncAnchorRef.current.timestamp = performance.now();
        if (cmd.audioMaster === 'display' || (audioMasterRef.current === 'display' && cmd.audioMaster !== 'dashboard')) {
          audioPlayer.playAudio(syncAnchorRef.current.time);
        } else {
          audioPlayer.stopAllSources();
        }
      } else if (cmd.command === 'pause') {
        setIsPlaying(false);
        syncAnchorRef.current.isPlaying = false;
        if (typeof cmd.time === 'number') {
          setCurrentTime(cmd.time);
          syncAnchorRef.current.time = cmd.time;
        }
        syncAnchorRef.current.timestamp = performance.now();
        audioPlayer.pauseAudio();
      } else if (cmd.command === 'set_volumes' && cmd.volumes) {
        const v = {
          inst: cmd.volumes.inst ?? cmd.volumes.instrumentals ?? volumesRef.current.inst,
          back: cmd.volumes.back ?? volumesRef.current.back,
          lead: cmd.volumes.lead ?? cmd.volumes.vocals ?? volumesRef.current.lead
        };
        if (v.inst > 0.001) prevFaderVolumesRef.current.inst = v.inst;
        if (v.back > 0.001) prevFaderVolumesRef.current.back = v.back;
        if (v.lead > 0.001) prevFaderVolumesRef.current.lead = v.lead;
        setVolumes(v);
        volumesRef.current = v;
        audioPlayer.setStemVolumes(v);
      } else if (cmd.command === 'toggle_play') {
        handleTogglePlayPause();
      } else if (cmd.command === 'end_queue') {
        handleEndQueue(true);
      } else if (cmd.command === 'select_song' && cmd.id) {
        if (cmd.audioMaster === 'dashboard') {
          audioPlayer.stopAllSources();
          audioMasterRef.current = 'dashboard';
          setAudioMaster('dashboard');
        }
        syncAnchorRef.current.time = 0;
        syncAnchorRef.current.timestamp = performance.now();
        syncAnchorRef.current.isPlaying = false;
        setCurrentTime(0);
        setIsPlaying(false);
      }
    });

    const handleLyricsUpdated = (data) => {
      if (!data || !data.songId) return;
      if (songRef.current && songRef.current.id === data.songId) {
        setSong(prev => {
          if (!prev || prev.id !== data.songId) return prev;
          const updated = {
            ...prev,
            lyrics: data.lyrics || [],
            lyricsProvider: data.lyricsProvider || prev.lyricsProvider,
            isSynced: data.isSynced !== undefined ? data.isSynced : prev.isSynced
          };
          songRef.current = updated;
          return updated;
        });
      }
    };
    socket.on('lyrics_updated', handleLyricsUpdated);

    socket.on('queue_updated', (q) => {
      if (Array.isArray(q)) {
        setQueue(q);
        queueRef.current = q;

        // If currently playing song is missing lyrics or video, check if queue item has resolved
        if (songRef.current) {
          const currentSongId = songRef.current.id || songRef.current.songId;
          const currentInQueue = q.find(item =>
            (songRef.current.queueId && item.queueId === songRef.current.queueId) ||
            item.id === currentSongId ||
            item.songId === currentSongId
          );
          if (currentInQueue) {
            const hasNoLyrics = !Array.isArray(songRef.current.lyrics) || songRef.current.lyrics.length === 0;
            if (hasNoLyrics && Array.isArray(currentInQueue.lyrics) && currentInQueue.lyrics.length > 0) {
              setSong(prev => {
                if (!prev) return prev;
                const updated = {
                  ...prev,
                  lyrics: currentInQueue.lyrics,
                  lyricsProvider: currentInQueue.lyricsProvider || prev.lyricsProvider,
                  isSynced: currentInQueue.isSynced !== undefined ? currentInQueue.isSynced : prev.isSynced
                };
                songRef.current = updated;
                return updated;
              });
            } else if (hasNoLyrics && (currentInQueue.status === 'ready' || currentInQueue.hasLyrics)) {
              fetchSong(currentSongId).then(fresh => {
                if (fresh && Array.isArray(fresh.lyrics) && fresh.lyrics.length > 0 && (songRef.current?.id === fresh.id || songRef.current?.songId === fresh.id)) {
                  setSong(prev => {
                    if (!prev || (prev.id !== fresh.id && prev.songId !== fresh.id)) return prev;
                    const updated = {
                      ...prev,
                      lyrics: fresh.lyrics,
                      lyricsProvider: fresh.lyricsProvider || prev.lyricsProvider,
                      isSynced: fresh.isSynced !== undefined ? fresh.isSynced : prev.isSynced
                    };
                    songRef.current = updated;
                    return updated;
                  });
                }
              }).catch(() => {});
            }

            const currentYt = songRef.current.youtubeId || songRef.current.youtube_id || extractYoutubeId(songRef.current.youtubeUrl) || extractYoutubeId(songRef.current.youtube_url);
            const queueYt = currentInQueue.youtubeId || currentInQueue.youtube_id || extractYoutubeId(currentInQueue.youtubeUrl) || extractYoutubeId(currentInQueue.youtube_url);
            if (!currentYt && queueYt) {
              setSong(prev => {
                if (!prev) return prev;
                const prevId = prev.id || prev.songId;
                const inQueueId = currentInQueue.id || currentInQueue.songId;
                if (prevId !== inQueueId) return prev;
                const updated = {
                  ...prev,
                  youtubeId: queueYt,
                  youtubeUrl: currentInQueue.youtubeUrl || `https://www.youtube.com/watch?v=${queueYt}`,
                  videoStatus: currentInQueue.videoStatus || 'ready'
                };
                songRef.current = updated;
                return updated;
              });
            }
          }
        }
      }
    });

    return () => {
      socket.off('sync_state');
      socket.off('player_command');
      socket.off('queue_updated');
      socket.off('lyrics_updated', handleLyricsUpdated);
    };
  }, []);

  // Update timer counter every 100ms using accurate elapsed time without drift
  useEffect(() => {
    if (!isPlaying || !song) return;
    const interval = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - syncAnchorRef.current.timestamp) / 1000;
      const accurateTime = Math.min(duration || Infinity, syncAnchorRef.current.time + elapsed);
      if (duration > 0 && accurateTime >= duration && audioMasterRef.current === 'display') {
        handlePlayNext();
        return;
      }
      setCurrentTime(accurateTime);
      if (audioMasterRef.current === 'display') {
        emitUpdateState({ currentTime: accurateTime });
      }
    }, 100);
    return () => clearInterval(interval);
  }, [isPlaying, duration, song]);

  // Connect song completion auto-advance
  useEffect(() => {
    audioPlayer.setOnSongEnd(() => {
      if (audioMasterRef.current === 'display') {
        handlePlayNext();
      }
    });
  }, []);

  const handleEndQueue = (skipBroadcast = false) => {
    audioPlayer.resetAudio();
    setSong(null);
    songRef.current = null;
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    syncAnchorRef.current.time = 0;
    syncAnchorRef.current.isPlaying = false;
    syncAnchorRef.current.timestamp = performance.now();
    extractColorsFromSongCover(null);

    if (!skipBroadcast) {
      emitPlayerCommand({ command: 'end_queue' });
      emitUpdateState({
        songId: null,
        queueId: null,
        songData: null,
        currentTime: 0,
        duration: 0,
        isPlaying: false
      });
    }
  };

  const handleSelectSong = async (itemOrId, maybeQueueId) => {
    const id = (itemOrId && typeof itemOrId === 'object') ? itemOrId.id : itemOrId;
    const queueId = (itemOrId && typeof itemOrId === 'object') ? (itemOrId.queueId || null) : (maybeQueueId || null);

    try {
      // 1. Immediately halt existing audio and reset timeline anchor to 0
      audioPlayer.stopAllSources();
      audioMasterRef.current = 'display';
      setAudioMaster('display');
      syncAnchorRef.current.time = 0;
      syncAnchorRef.current.timestamp = performance.now();
      syncAnchorRef.current.isPlaying = false;
      setCurrentTime(0);
      setIsPlaying(false);

      emitPlayerCommand({ command: 'select_song', id, queueId, audioMaster: 'display' });
      const fullSong = await fetchSong(id);
      fullSong.queueId = queueId;

      const colorSrc = fullSong.id ? `/api/cover/${fullSong.id}` : getHighResAlbumArt(fullSong.albumArt);
      extractColorsFromSongCover(colorSrc);

      // Reset anchor once more right before setting song state
      syncAnchorRef.current.time = 0;
      syncAnchorRef.current.timestamp = performance.now();
      syncAnchorRef.current.isPlaying = true;

      setSong(fullSong);
      songRef.current = fullSong;

      const dur = await audioPlayer.setupAudio(fullSong, volumesRef.current);
      if (dur > 0) setDuration(dur);

      await audioPlayer.unlockAudio();
      audioPlayer.playAudio(0);

      setIsPlaying(true);
      setCurrentTime(0);
      syncAnchorRef.current.time = 0;
      syncAnchorRef.current.isPlaying = true;
      syncAnchorRef.current.timestamp = performance.now();

      audioMasterRef.current = 'display';
      setAudioMaster('display');

      emitUpdateState({
        songId: id,
        songData: fullSong,
        queueId,
        currentTime: 0,
        duration: dur,
        isPlaying: true,
        audioMaster: 'display'
      });
    } catch (e) {
      console.error("Error selecting song from display tab:", e);
    }
  };

  const handleTogglePlayPause = async () => {
    await audioPlayer.unlockAudio();
    const willPlay = !syncAnchorRef.current.isPlaying;
    const now = performance.now();
    let cur = syncAnchorRef.current.time;
    if (syncAnchorRef.current.isPlaying) {
      cur += (now - syncAnchorRef.current.timestamp) / 1000;
    }
    cur = Math.max(0, duration > 0 ? Math.min(duration, cur) : cur);

    if (willPlay) {
      if (!songRef.current) {
        const q = queueRef.current || [];
        const ready = q.find(s => s.status === 'ready' || !s.status);
        if (ready) {
          await handleSelectSong(ready.id, ready.queueId);
          return;
        }
      }

      audioMasterRef.current = 'display';
      setAudioMaster('display');
      audioPlayer.playAudio(cur);

      syncAnchorRef.current.time = cur;
      syncAnchorRef.current.isPlaying = true;
      syncAnchorRef.current.timestamp = now;
      setIsPlaying(true);
      setCurrentTime(cur);

      emitPlayerCommand({ command: 'play', time: cur, audioMaster: 'display' });
      emitUpdateState({
        isPlaying: true,
        currentTime: cur,
        audioMaster: 'display',
        queueId: songRef.current?.queueId || null,
        songId: songRef.current?.id || null
      });
    } else {
      audioPlayer.pauseAudio();

      syncAnchorRef.current.time = cur;
      syncAnchorRef.current.isPlaying = false;
      syncAnchorRef.current.timestamp = now;
      setIsPlaying(false);
      setCurrentTime(cur);

      emitPlayerCommand({ command: 'pause', time: cur });
      emitUpdateState({
        isPlaying: false,
        currentTime: cur,
        queueId: songRef.current?.queueId || null,
        songId: songRef.current?.id || null
      });
    }
  };

  const handleSeek = (time) => {
    const target = Math.max(0, duration > 0 ? Math.min(duration, time) : time);
    setCurrentTime(target);
    syncAnchorRef.current.time = target;
    syncAnchorRef.current.timestamp = performance.now();
    if (audioMasterRef.current === 'display') {
      audioPlayer.seekAudio(target, syncAnchorRef.current.isPlaying);
    }
    emitPlayerCommand({ command: 'seek', time: target, audioMaster: audioMasterRef.current });
    emitUpdateState({ currentTime: target });
  };

  const handlePlayNext = async () => {
    const q = queueRef.current || [];
    const readySongs = q.filter(s => s.status === 'ready' || !s.status);
    let curIdx = -1;
    const targetQId = songRef.current?.queueId;
    if (targetQId) {
      curIdx = readySongs.findIndex(s => String(s.queueId) === String(targetQId));
    }
    if (curIdx === -1 && songRef.current?.id) {
      curIdx = readySongs.findIndex(s => String(s.id) === String(songRef.current.id));
    }
    if (curIdx !== -1 && curIdx + 1 < readySongs.length) {
      const nextSong = readySongs[curIdx + 1];
      handleSelectSong(nextSong.id, nextSong.queueId);
    } else {
      // Reached end of queue in display tab -> bland mode
      handleEndQueue();
    }
  };

  const handlePlayPrev = async () => {
    const q = queueRef.current || [];
    const readySongs = q.filter(s => s.status === 'ready' || !s.status);
    let curIdx = -1;
    const targetQId = songRef.current?.queueId;
    if (targetQId) {
      curIdx = readySongs.findIndex(s => String(s.queueId) === String(targetQId));
    }
    if (curIdx === -1 && songRef.current?.id) {
      curIdx = readySongs.findIndex(s => String(s.id) === String(songRef.current.id));
    }
    if (curIdx > 0) {
      const prevSong = readySongs[curIdx - 1];
      handleSelectSong(prevSong.id, prevSong.queueId);
    } else {
      handleSeek(0);
    }
  };

  const handleJumpPrevLine = () => {
    const list = displayLyrics;
    if (!list?.length) return;
    const cur = syncAnchorRef.current.isPlaying
      ? syncAnchorRef.current.time + (performance.now() - syncAnchorRef.current.timestamp) / 1000
      : syncAnchorRef.current.time;
    const pastLines = list.filter(l => l.time < cur - 0.5);
    const target = pastLines.length > 0 ? pastLines[pastLines.length - 1].time : 0;
    handleSeek(target);
  };

  const handleJumpNextLine = () => {
    const list = displayLyrics;
    if (!list?.length) return;
    const cur = syncAnchorRef.current.isPlaying
      ? syncAnchorRef.current.time + (performance.now() - syncAnchorRef.current.timestamp) / 1000
      : syncAnchorRef.current.time;
    const nextLine = list.find(l => l.time > cur + 0.3);
    if (nextLine) {
      handleSeek(nextLine.time);
    }
  };

  const handleSetVolumes = (partialVols, skipSync = false) => {
    const nextVols = { ...volumesRef.current, ...partialVols };
    if (partialVols.inst !== undefined && partialVols.inst > 0.001) prevFaderVolumesRef.current.inst = partialVols.inst;
    if (partialVols.back !== undefined && partialVols.back > 0.001) prevFaderVolumesRef.current.back = partialVols.back;
    if (partialVols.lead !== undefined && partialVols.lead > 0.001) prevFaderVolumesRef.current.lead = partialVols.lead;

    setVolumes(nextVols);
    volumesRef.current = nextVols;
    audioPlayer.setStemVolumes(nextVols);

    if (!skipSync) {
      const fullVols = {
        inst: nextVols.inst,
        instrumentals: nextVols.inst,
        lead: nextVols.lead,
        vocals: nextVols.lead,
        back: nextVols.back
      };
      emitPlayerCommand({ command: 'set_volumes', volumes: fullVols });
      emitUpdateState({ volumes: fullVols });
    }
  };

  const handleToggleStemMute = (stem) => {
    const currentVal = volumesRef.current[stem] ?? 1;
    const shouldMute = currentVal > 0.001;
    let targetVal;
    if (shouldMute) {
      prevFaderVolumesRef.current[stem] = currentVal;
      targetVal = 0;
    } else {
      const restore = prevFaderVolumesRef.current[stem];
      targetVal = (restore && restore > 0.01) ? restore : 1.0;
    }
    handleSetVolumes({ [stem]: targetVal });
  };

  // Keyboard shortcuts listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape key blurs any focused text field
      if (e.key === 'Escape') {
        const isTextInput = (e.target && (
          (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'button' && e.target.type !== 'submit' && e.target.type !== 'checkbox' && e.target.type !== 'radio') ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable
        ));
        if (isTextInput && typeof e.target.blur === 'function') {
          e.target.blur();
          return;
        }
      }

      // Ignore other shortcuts when typing in inputs/textareas
      if ((e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'TEXTAREA') {
        return;
      }

      // Skip system combinations (Cmd+C, Ctrl+R, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Space: Toggle Play/Pause
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.target && typeof e.target.blur === 'function') e.target.blur();
        handleTogglePlayPause();
        return;
      }

      // Shift + < / >: Prev / Next Song
      if (e.shiftKey && (e.key === '<' || e.key === ',')) {
        e.preventDefault();
        handlePlayPrev();
        return;
      }
      if (e.shiftKey && (e.key === '>' || e.key === '.')) {
        e.preventDefault();
        handlePlayNext();
        return;
      }

      // < / > without Shift: Prev / Next Lyric Line
      if (!e.shiftKey && (e.key === '<' || e.key === ',')) {
        e.preventDefault();
        handleJumpPrevLine();
        return;
      }
      if (!e.shiftKey && (e.key === '>' || e.key === '.')) {
        e.preventDefault();
        handleJumpNextLine();
        return;
      }

      // ArrowLeft / ArrowRight: Seek +/- 5s
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const cur = syncAnchorRef.current.isPlaying
          ? syncAnchorRef.current.time + (performance.now() - syncAnchorRef.current.timestamp) / 1000
          : syncAnchorRef.current.time;
        handleSeek(Math.max(0, cur - 5));
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const cur = syncAnchorRef.current.isPlaying
          ? syncAnchorRef.current.time + (performance.now() - syncAnchorRef.current.timestamp) / 1000
          : syncAnchorRef.current.time;
        handleSeek(Math.min(duration || Infinity, cur + 5));
        return;
      }

      const key = e.key.toLowerCase();

      // 'i': Toggle song info sidebar
      if (key === 'i') {
        e.preventDefault();
        setSidebarOpen(prev => !prev);
        return;
      }

      // 'v': Toggle YouTube music video background
      if (key === 'v') {
        e.preventDefault();
        setShowMusicVideo(prev => {
          const next = !prev;
          emitUpdateState({ showMusicVideo: next });
          return next;
        });
        return;
      }

      // Stem Volume & Mute Shortcuts
      const step = e.shiftKey ? 0.15 : 0.05;
      const v = volumesRef.current;

      if (key === 'q') {
        e.preventDefault();
        handleSetVolumes({ inst: Math.min(1, (v.inst ?? 1) + step) });
      } else if (key === 'a') {
        e.preventDefault();
        handleSetVolumes({ inst: Math.max(0, (v.inst ?? 1) - step) });
      } else if (key === 'z') {
        e.preventDefault();
        handleToggleStemMute('inst');
      } else if (key === 'w') {
        e.preventDefault();
        handleSetVolumes({ back: Math.min(1, (v.back ?? 1) + step) });
      } else if (key === 's') {
        e.preventDefault();
        handleSetVolumes({ back: Math.max(0, (v.back ?? 1) - step) });
      } else if (key === 'x') {
        e.preventDefault();
        handleToggleStemMute('back');
      } else if (key === 'e') {
        e.preventDefault();
        handleSetVolumes({ lead: Math.min(1, (v.lead ?? 1) + step) });
      } else if (key === 'd') {
        e.preventDefault();
        handleSetVolumes({ lead: Math.max(0, (v.lead ?? 1) - step) });
      } else if (key === 'c') {
        e.preventDefault();
        handleToggleStemMute('lead');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [duration]);

  // Prepare display lyrics: mark instrumental sections, detect direction, and insert intro instrumental if needed
  const displayLyrics = useMemo(() => {
    return prepareLyricsForDisplay(song?.lyrics || []);
  }, [song?.lyrics]);

  return (
    <div
      className={`display-container ${!sidebarOpen ? 'sidebar-hidden' : ''} ${!showKaraokeSlide ? 'disable-karaoke-slide' : ''}`}
      id="displayContainer"
    >
      {/* Song Info Sidebar */}
      <SongSidebar
        song={song}
        queue={queue}
        currentTime={currentTime}
        duration={duration}
        isOpen={sidebarOpen}
        onSeek={handleSeek}
        onSelectSong={handleSelectSong}
      />

      {/* Border Resizer between sidebar and main lyrics */}
      <div
        className="panel-border-resizer resizer-display-sidebar"
        id="resizerDisplaySidebar"
        aria-hidden="true"
        title="Drag border to resize, double-tap to reset"
      />

      {/* Main Lyrics Content with background waveform visualizer */}
      <LyricsDisplay
        song={song}
        lyrics={displayLyrics}
        duration={duration}
        isPlaying={isPlaying}
        syncAnchorRef={syncAnchorRef}
        accentColor={accentColor}
        showTranslit={showTranslit}
        showTranslat={showTranslat}
        showKaraokeSlide={showKaraokeSlide}
        showWaveform={showWaveform}
        showMusicVideo={showMusicVideo}
        onSeek={handleSeek}
      />

      {/* Bottom-Left Floating Control Buttons */}
      <div className="display-floating-controls">
        <button
          id="displayPlayPauseBtn"
          className="btn glass-btn floating-control-btn"
          title="Play / Pause (Space)"
          onClick={handleTogglePlayPause}
        >
          <i className={isPlaying ? 'icon-pause' : 'icon-play'}></i>
        </button>

        <button
          id="toggleSidebarBtn"
          className={`btn glass-btn floating-control-btn disk-btn ${!sidebarOpen ? 'disk-hidden-mode' : ''}`}
          title="Toggle Song Info (i)"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <i className="icon-disc"></i>
        </button>
      </div>
    </div>
  );
}
