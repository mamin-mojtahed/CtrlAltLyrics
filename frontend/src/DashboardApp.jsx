import React, { useEffect, useState } from 'react';
import socket, { emitRequestSync, emitUpdateState } from './services/socket';
import * as audioPlayer from './services/audioPlayer';
import { usePlaybackStore } from './stores/usePlaybackStore';
import { useQueueStore } from './stores/useQueueStore';
import { useLibraryStore } from './stores/useLibraryStore';
import { useModalStore } from './stores/useModalStore';

import AudioBlockBanner from './components/common/AudioBlockBanner';
import SearchPanel from './components/dashboard/SearchPanel';
import QueueList from './components/dashboard/QueueList';
import LibraryList from './components/dashboard/LibraryList';
import PlaybackControls from './components/dashboard/PlaybackControls';
import StemMixer from './components/dashboard/StemMixer';
import { useDashboardResizers } from './hooks/useDashboardResizers';

import UploadSongModal from './components/modals/UploadSongModal';
import ComponentManagerModal from './components/modals/ComponentManagerModal';
import MetadataModal from './components/modals/MetadataModal';
import LyricsSyncModal from './components/modals/LyricsSyncModal';

export default function DashboardApp() {
  const syncFromSocket = usePlaybackStore((state) => state.syncFromSocket);
  const togglePlayPause = usePlaybackStore((state) => state.togglePlayPause);
  const playNext = usePlaybackStore((state) => state.playNext);
  const playPrev = usePlaybackStore((state) => state.playPrev);
  const jumpToNextLine = usePlaybackStore((state) => state.jumpToNextLine);
  const jumpToPrevLine = usePlaybackStore((state) => state.jumpToPrevLine);
  const seek = usePlaybackStore((state) => state.seek);
  const selectSong = usePlaybackStore((state) => state.selectSong);
  const play = usePlaybackStore((state) => state.play);
  const pause = usePlaybackStore((state) => state.pause);
  const currentTime = usePlaybackStore((state) => state.currentTime);
  const duration = usePlaybackStore((state) => state.duration);
  const volumes = usePlaybackStore((state) => state.volumes);
  const setVolumes = usePlaybackStore((state) => state.setVolumes);
  const toggleStemMute = usePlaybackStore((state) => state.toggleStemMute);

  const loadQueue = useQueueStore((state) => state.loadQueue);
  const setQueue = useQueueStore((state) => state.setQueue);

  const loadLibrary = useLibraryStore((state) => state.loadLibrary);
  const setLibrary = useLibraryStore((state) => state.setLibrary);

  const closeAllModals = useModalStore((state) => state.closeAllModals);

  // Hook for all dashboard border dividers and persistent CSS variables
  useDashboardResizers();

  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const currentSong = usePlaybackStore((state) => state.currentSong);

  // Update progress continuously during dashboard playback
  useEffect(() => {
    if (!isPlaying || !currentSong) return;

    const interval = setInterval(() => {
      const state = usePlaybackStore.getState();
      if (state.audioMaster === 'dashboard' && !state.isDraggingSlider && state.isPlaying && state.currentSong) {
        const curTime = audioPlayer.getCurrentPlaybackTime(true);
        if (state.duration > 0 && curTime >= state.duration) {
          usePlaybackStore.getState().handleSongEnd();
          return;
        }
        usePlaybackStore.setState({ currentTime: curTime });
        emitUpdateState({ currentTime: curTime });
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, currentSong]);

  // Socket setup & initial data fetch
  useEffect(() => {
    loadLibrary();
    loadQueue();
    emitRequestSync();

    const handlePlayerCommand = (cmd) => {
      if (!cmd) return;
      if (cmd.sender && socket.id && cmd.sender === socket.id) return;

      if (cmd.command === 'toggle_play') {
        togglePlayPause();
      } else if (cmd.command === 'play') {
        if (cmd.audioMaster === 'display') {
          audioPlayer.stopAllSources();
          usePlaybackStore.setState({
            isPlaying: true,
            currentTime: typeof cmd.time === 'number' ? cmd.time : usePlaybackStore.getState().currentTime,
            audioMaster: 'display'
          });
        } else {
          const offset = typeof cmd.time === 'number' ? cmd.time : usePlaybackStore.getState().currentTime;
          audioPlayer.playAudio(offset);
          usePlaybackStore.setState({ isPlaying: true, currentTime: offset, audioMaster: 'dashboard' });
        }
      } else if (cmd.command === 'pause') {
        audioPlayer.stopAllSources();
        const targetTime = typeof cmd.time === 'number' ? cmd.time : usePlaybackStore.getState().currentTime;
        usePlaybackStore.setState({ isPlaying: false, currentTime: targetTime });
      } else if (cmd.command === 'seek' && typeof cmd.time === 'number') {
        const state = usePlaybackStore.getState();
        const maxDur = state.duration || 0;
        const target = Math.max(0, maxDur > 0 ? Math.min(maxDur, cmd.time) : cmd.time);
        usePlaybackStore.setState({ currentTime: target });
        if (state.audioMaster !== 'display') {
          audioPlayer.seekAudio(target, state.isPlaying);
        }
      } else if (cmd.command === 'play_prev') {
        playPrev();
      } else if (cmd.command === 'play_next') {
        playNext();
      } else if (cmd.command === 'end_queue') {
        usePlaybackStore.getState().endQueue(true);
      } else if (cmd.command === 'select_song' && cmd.id) {
        selectSong(cmd.id, true, cmd.queueId);
      } else if (cmd.command === 'set_volumes' && cmd.volumes) {
        const v = {
          inst: cmd.volumes.inst ?? cmd.volumes.instrumentals,
          back: cmd.volumes.back,
          lead: cmd.volumes.lead ?? cmd.volumes.vocals
        };
        setVolumes(v, true, true);
      } else if (cmd.command === 'jump_next_line') {
        jumpToNextLine();
      } else if (cmd.command === 'jump_prev_line') {
        jumpToPrevLine();
      }
    };

    socket.on('sync_state', syncFromSocket);
    socket.on('player_command', handlePlayerCommand);
    socket.on('queue_updated', (data) => {
      if (Array.isArray(data)) {
        setQueue(data);
        const { currentSong, currentQueueId } = usePlaybackStore.getState();
        const readySongs = data.filter(s => s.status === 'ready');
        if (currentQueueId && !data.some(s => String(s.queueId) === String(currentQueueId))) {
          if (readySongs.length > 0) {
            selectSong(readySongs[0].id, false, readySongs[0].queueId);
          } else {
            usePlaybackStore.getState().endQueue();
          }
        }
      } else {
        loadQueue();
      }
    });
    socket.on('library_updated', (data) => {
      if (Array.isArray(data)) setLibrary(data);
      else loadLibrary();
    });

    return () => {
      socket.off('sync_state', syncFromSocket);
      socket.off('player_command', handlePlayerCommand);
      socket.off('queue_updated');
      socket.off('library_updated');
    };
  }, [togglePlayPause, playNext, playPrev, selectSong, setVolumes, toggleStemMute, jumpToNextLine, jumpToPrevLine]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape closes modals
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
        closeAllModals();
        return;
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
        togglePlayPause();
        return;
      }

      // Shift + < / >: Prev / Next Song
      if (e.shiftKey && (e.key === '<' || e.key === ',')) {
        e.preventDefault();
        playPrev();
        return;
      }
      if (e.shiftKey && (e.key === '>' || e.key === '.')) {
        e.preventDefault();
        playNext();
        return;
      }

      // < / > without Shift: Prev / Next Lyric Line
      if (!e.shiftKey && (e.key === '<' || e.key === ',')) {
        e.preventDefault();
        jumpToPrevLine();
        return;
      }
      if (!e.shiftKey && (e.key === '>' || e.key === '.')) {
        e.preventDefault();
        jumpToNextLine();
        return;
      }

      // ArrowLeft / ArrowRight: Seek +/- 5s
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(Math.max(0, currentTime - 5));
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek(Math.min(duration || 0, currentTime + 5));
        return;
      }

      // Stem Volume & Mute Shortcuts
      const key = e.key.toLowerCase();
      const step = e.shiftKey ? 0.15 : 0.05;

      if (key === 'q') {
        e.preventDefault();
        setVolumes({ inst: Math.min(1, volumes.inst + step) });
      } else if (key === 'a') {
        e.preventDefault();
        setVolumes({ inst: Math.max(0, volumes.inst - step) });
      } else if (key === 'z') {
        e.preventDefault();
        toggleStemMute('inst');
      } else if (key === 'w') {
        e.preventDefault();
        setVolumes({ back: Math.min(1, volumes.back + step) });
      } else if (key === 's') {
        e.preventDefault();
        setVolumes({ back: Math.max(0, volumes.back - step) });
      } else if (key === 'x') {
        e.preventDefault();
        toggleStemMute('back');
      } else if (key === 'e') {
        e.preventDefault();
        setVolumes({ lead: Math.min(1, volumes.lead + step) });
      } else if (key === 'd') {
        e.preventDefault();
        setVolumes({ lead: Math.max(0, volumes.lead - step) });
      } else if (key === 'c') {
        e.preventDefault();
        toggleStemMute('lead');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause, playNext, playPrev, jumpToNextLine, jumpToPrevLine, seek, currentTime, duration, volumes, setVolumes, toggleStemMute, closeAllModals]);

  return (
    <div id="app" className="dashboard-vertical">
      <AudioBlockBanner />

      {/* Upper Panel: Search, Queue & Library */}
      <div className="panel glass upper-panel">
        {/* Left Column: Search & Queue */}
        <div className="upper-left">
          <SearchPanel />
          <QueueList />
        </div>

        {/* Right Column: Library */}
        <div className="upper-right">
          <div
            id="resizerUpperSplit"
            className="panel-border-resizer resizer-upper-split"
            aria-hidden="true"
            title="Drag border to resize, double-tap to reset"
          />
          <LibraryList />
        </div>
      </div>

      {/* Lower Panel: Controls & Mixer */}
      <div className="panel glass lower-panel">
        <div
          id="resizerDashVertical"
          className="panel-border-resizer resizer-dash-vertical"
          aria-hidden="true"
          title="Drag border to resize, double-tap to reset"
        />
        <div className="lower-container">
          <PlaybackControls />
          <StemMixer />
        </div>
      </div>

      {/* Modals */}
      <UploadSongModal />
      <ComponentManagerModal />
      <MetadataModal />
      <LyricsSyncModal />
    </div>
  );
}
