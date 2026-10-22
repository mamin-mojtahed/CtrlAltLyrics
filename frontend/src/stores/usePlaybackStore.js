import { create } from 'zustand';
import * as audioPlayer from '../services/audioPlayer';
import { emitPlayerCommand, emitUpdateState } from '../services/socket';
import { extractColorsFromSongCover, getHighResAlbumArt } from '../utils/themeColors';
import { fetchQueue, fetchSong } from '../services/api';

export const usePlaybackStore = create((set, get) => ({
  currentSong: null,
  currentQueueId: null,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  volumes: { inst: 1, back: 1, lead: 1 },
  prevFaderVolumes: { inst: 1, back: 1, lead: 1 },
  isInstBackLinked: false,
  isBackLeadLinked: false,
  showTranslit: false,
  showTranslat: false,
  showKaraokeSlide: true,
  audioBlocked: false,
  isDraggingSlider: false,
  audioMaster: 'dashboard',
  isEndingSong: false,

  setAudioBlocked: (blocked) => {
    set({ audioBlocked: blocked });
    emitUpdateState({ audioBlocked: blocked });
  },

  setDraggingSlider: (isDragging) => set({ isDraggingSlider: isDragging }),

  setLinkInstBack: (linked) => set({ isInstBackLinked: linked }),
  setLinkBackLead: (linked) => set({ isBackLeadLinked: linked }),

  setVolumes: (newVolumes, skipLinking = false, skipSync = false) => {
    const state = get();
    const updated = { ...state.volumes, ...newVolumes };

    // Handle linking
    if (!skipLinking) {
      if (state.isInstBackLinked && newVolumes.inst !== undefined) {
        updated.back = newVolumes.inst;
        if (state.isBackLeadLinked) updated.lead = newVolumes.inst;
      }
      if (state.isInstBackLinked && newVolumes.back !== undefined) {
        updated.inst = newVolumes.back;
      }
      if (state.isBackLeadLinked && newVolumes.back !== undefined) {
        updated.lead = newVolumes.back;
      }
      if (state.isBackLeadLinked && newVolumes.lead !== undefined) {
        updated.back = newVolumes.lead;
        if (state.isInstBackLinked) updated.inst = newVolumes.lead;
      }
    }

    // Save previous non-zero volume for unmute restoration
    const newPrev = { ...state.prevFaderVolumes };
    if (updated.inst > 0.001) newPrev.inst = updated.inst;
    if (updated.back > 0.001) newPrev.back = updated.back;
    if (updated.lead > 0.001) newPrev.lead = updated.lead;

    audioPlayer.setStemVolumes(updated);

    set({ volumes: updated, prevFaderVolumes: newPrev });
    if (!skipSync) {
      const fullVols = {
        vocals: updated.lead,
        instrumentals: updated.inst,
        lead: updated.lead,
        back: updated.back,
        inst: updated.inst
      };
      emitPlayerCommand({ command: 'set_volumes', volumes: fullVols });
      emitUpdateState({ volumes: fullVols });
    }
  },

  toggleStemMute: (stem) => {
    const state = get();
    const currentVal = state.volumes[stem] || 0;
    const shouldMute = currentVal > 0.001;

    // Determine target stems based on linking
    const targetStems = new Set([stem]);
    if (stem === 'inst') {
      if (state.isInstBackLinked) {
        targetStems.add('back');
        if (state.isBackLeadLinked) targetStems.add('lead');
      }
    } else if (stem === 'back') {
      if (state.isInstBackLinked) targetStems.add('inst');
      if (state.isBackLeadLinked) targetStems.add('lead');
    } else if (stem === 'lead') {
      if (state.isBackLeadLinked) {
        targetStems.add('back');
        if (state.isInstBackLinked) targetStems.add('inst');
      }
    }

    const updates = {};
    targetStems.forEach((s) => {
      if (shouldMute) {
        updates[s] = 0;
      } else {
        const restoreVal = state.prevFaderVolumes[s] > 0.01 ? state.prevFaderVolumes[s] : 1.0;
        updates[s] = restoreVal;
      }
    });

    get().setVolumes(updates, true);
  },

  setShowTranslit: (show) => {
    set({ showTranslit: show });
    emitUpdateState({ showTranslit: show });
  },

  setShowTranslat: (show) => {
    set({ showTranslat: show });
    emitUpdateState({ showTranslat: show });
  },

  setShowKaraokeSlide: (show) => {
    set({ showKaraokeSlide: show });
    emitUpdateState({ showKaraokeSlide: show });
  },

  selectSong: async (songOrId, forcePlay = null, queueId = null) => {
    let song = songOrId;
    const targetQueueId = queueId || (typeof songOrId === 'object' && songOrId ? songOrId.queueId : null) || null;

    if (typeof songOrId === 'string' || typeof songOrId === 'number') {
      try {
        song = await fetchSong(songOrId);
      } catch (e) {
        console.error("Failed to fetch song:", e);
        return;
      }
    }

    if (!song) return;

    const fullSong = { ...song, queueId: targetQueueId };
    const { volumes, isPlaying } = get();
    set({ currentSong: fullSong, currentQueueId: targetQueueId, currentTime: 0 });

    const colorSrc = fullSong.id ? `/api/cover/${fullSong.id}` : getHighResAlbumArt(fullSong.albumArt);
    extractColorsFromSongCover(colorSrc);

    const dur = await audioPlayer.setupAudio(fullSong, volumes);
    set({ duration: dur });

    emitPlayerCommand({ command: 'select_song', id: fullSong.id, queueId: targetQueueId });
    emitUpdateState({
      songId: fullSong.id,
      songData: fullSong,
      queueId: targetQueueId,
      currentTime: 0,
      duration: dur
    });

    const shouldPlay = forcePlay !== null ? forcePlay : isPlaying;
    if (shouldPlay) {
      await get().play(0);
    } else {
      set({ isPlaying: false });
      emitPlayerCommand({ command: 'pause', time: 0 });
    }
  },

  play: async (offset = 0) => {
    const state = get();
    if (!state.currentSong) return;

    await audioPlayer.playAudio(offset);
    const blocked = audioPlayer.isContextSuspended();
    set({ isPlaying: !blocked, currentTime: offset, audioBlocked: blocked, audioMaster: 'dashboard' });

    emitPlayerCommand({ command: 'play', time: offset, audioMaster: 'dashboard' });
    emitUpdateState({ isPlaying: !blocked, currentTime: offset, audioBlocked: blocked, audioMaster: 'dashboard' });
  },

  pause: () => {
    const state = get();
    const currentActualTime = (state.audioMaster === 'display')
      ? state.currentTime
      : audioPlayer.pauseAudio();
    if (state.audioMaster !== 'display') {
      audioPlayer.stopAllSources();
    }
    set({ isPlaying: false, currentTime: currentActualTime });
    emitPlayerCommand({ command: 'pause', time: currentActualTime });
    emitUpdateState({ isPlaying: false, currentTime: currentActualTime });
  },

  togglePlayPause: async () => {
    const state = get();
    if (audioPlayer.isContextSuspended()) {
      await audioPlayer.unlockAudio();
    }

    if (!state.currentSong) {
      // Pick first ready song in queue
      try {
        const queue = await fetchQueue();
        const readySong = (queue || []).find(s => s.status === 'ready');
        if (readySong) {
          await get().selectSong(readySong, true, readySong.queueId);
        }
      } catch (e) {
        console.error("Error picking track from queue:", e);
      }
      return;
    }

    if (state.isPlaying) {
      get().pause();
    } else {
      await get().play(state.currentTime);
    }
  },

  seek: (time) => {
    const state = get();
    if (!state.currentSong) return;
    const maxDur = state.duration || 0;
    const target = Math.max(0, maxDur > 0 ? Math.min(maxDur, time) : time);

    set({ currentTime: target });
    if (state.audioMaster !== 'display') {
      audioPlayer.seekAudio(target, state.isPlaying);
    }
    emitPlayerCommand({ command: 'seek', time: target, audioMaster: state.audioMaster });
    emitUpdateState({ currentTime: target });
  },

  jumpToNextLine: () => {
    const state = get();
    if (!state.currentSong?.lyrics?.length) return;
    const cur = (state.audioMaster === 'dashboard' && state.isPlaying)
      ? audioPlayer.getCurrentPlaybackTime(true)
      : state.currentTime;
    const nextLine = state.currentSong.lyrics.find(l => l.time > cur + 0.3);
    if (nextLine) {
      get().seek(nextLine.time);
    }
  },

  jumpToPrevLine: () => {
    const state = get();
    if (!state.currentSong?.lyrics?.length) return;
    const cur = (state.audioMaster === 'dashboard' && state.isPlaying)
      ? audioPlayer.getCurrentPlaybackTime(true)
      : state.currentTime;
    const pastLines = state.currentSong.lyrics.filter(l => l.time < cur - 0.5);
    if (pastLines.length > 0) {
      get().seek(pastLines[pastLines.length - 1].time);
    } else {
      get().seek(0);
    }
  },

  endQueue: (skipBroadcast = false) => {
    audioPlayer.resetAudio();
    extractColorsFromSongCover(null);
    set({
      currentSong: null,
      currentQueueId: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      isEndingSong: false
    });
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
  },

  handleSongEnd: async () => {
    const state = get();
    if (state.isEndingSong) return;
    set({ isEndingSong: true });
    try {
      audioPlayer.pauseAudio();
      audioPlayer.stopAllSources();

      const q = await fetchQueue();
      const readySongs = (q || []).filter(s => s.status === 'ready');
      if (readySongs.length === 0) {
        get().endQueue();
        return;
      }
      const { currentSong, currentQueueId } = get();
      if (!currentSong) {
        get().endQueue();
        return;
      }
      let idx = -1;
      const targetQId = currentQueueId || currentSong?.queueId;
      if (targetQId) {
        idx = readySongs.findIndex(s => String(s.queueId) === String(targetQId));
      }
      if (idx === -1 && currentSong?.id) {
        idx = readySongs.findIndex(s => String(s.id) === String(currentSong.id));
      }
      if (idx !== -1 && idx < readySongs.length - 1) {
        const next = readySongs[idx + 1];
        await get().selectSong(next, true, next.queueId);
      } else {
        // Last song in queue completed -> bland mode
        get().endQueue();
      }
    } catch (e) {
      console.error("Error in handleSongEnd:", e);
      get().endQueue();
    } finally {
      set({ isEndingSong: false });
    }
  },

  playNext: async () => {
    try {
      const q = await fetchQueue();
      const readySongs = (q || []).filter(s => s.status === 'ready');
      if (readySongs.length === 0) {
        get().endQueue();
        return;
      }
      const { currentSong, currentQueueId, isPlaying } = get();
      if (!currentSong) {
        return get().selectSong(readySongs[0], true, readySongs[0].queueId);
      }
      let idx = -1;
      const targetQId = currentQueueId || currentSong?.queueId;
      if (targetQId) {
        idx = readySongs.findIndex(s => String(s.queueId) === String(targetQId));
      }
      if (idx === -1 && currentSong?.id) {
        idx = readySongs.findIndex(s => String(s.id) === String(currentSong.id));
      }
      if (idx !== -1 && idx < readySongs.length - 1) {
        const next = readySongs[idx + 1];
        await get().selectSong(next, isPlaying, next.queueId);
      } else {
        // Reached end of queue via next button -> bland mode
        get().endQueue();
      }
    } catch (e) {
      console.error("playNext error:", e);
    }
  },

  playPrev: async () => {
    try {
      const q = await fetchQueue();
      const readySongs = (q || []).filter(s => s.status === 'ready');
      if (readySongs.length === 0) return;
      const { currentSong, currentQueueId, isPlaying } = get();
      if (!currentSong) {
        return get().selectSong(readySongs[0], true, readySongs[0].queueId);
      }
      let idx = -1;
      const targetQId = currentQueueId || currentSong?.queueId;
      if (targetQId) {
        idx = readySongs.findIndex(s => String(s.queueId) === String(targetQId));
      }
      if (idx === -1 && currentSong?.id) {
        idx = readySongs.findIndex(s => String(s.id) === String(currentSong.id));
      }
      if (idx > 0) {
        const prev = readySongs[idx - 1];
        await get().selectSong(prev, isPlaying, prev.queueId);
      } else {
        get().seek(0);
      }
    } catch (e) {
      console.error("playPrev error:", e);
    }
  },

  syncFromSocket: (state) => {
    if (!state) return;
    const current = get();
    const updates = {};

    if (state.showTranslit !== undefined) updates.showTranslit = !!state.showTranslit;
    if (state.showTranslat !== undefined) updates.showTranslat = !!state.showTranslat;
    if (state.showKaraokeSlide !== undefined) updates.showKaraokeSlide = !!state.showKaraokeSlide;
    if (state.audioBlocked !== undefined) updates.audioBlocked = !!state.audioBlocked;

    if (state.volumes) {
      const vols = {
        inst: state.volumes.inst ?? state.volumes.instrumentals ?? current.volumes.inst,
        lead: state.volumes.lead ?? state.volumes.vocals ?? current.volumes.lead,
        back: state.volumes.back ?? current.volumes.back
      };
      updates.volumes = vols;
      const newPrev = { ...current.prevFaderVolumes };
      if (vols.inst > 0.001) newPrev.inst = vols.inst;
      if (vols.back > 0.001) newPrev.back = vols.back;
      if (vols.lead > 0.001) newPrev.lead = vols.lead;
      updates.prevFaderVolumes = newPrev;
      audioPlayer.setStemVolumes(vols);
    }

    const incomingQueueId = state.queueId || state.songData?.queueId || null;
    if (incomingQueueId !== undefined) {
      updates.currentQueueId = incomingQueueId;
    }

    const isNewTrack = state.songData && (
      !current.currentSong ||
      current.currentSong.id !== state.songData.id ||
      (incomingQueueId && current.currentQueueId && String(incomingQueueId) !== String(current.currentQueueId))
    );

    if (isNewTrack) {
      const trackWithQueue = { ...state.songData, queueId: incomingQueueId };
      current.selectSong(trackWithQueue, state.isPlaying, incomingQueueId);
    } else if (('songId' in state && state.songId === null) || ('songData' in state && state.songData === null)) {
      audioPlayer.resetAudio();
      updates.currentSong = null;
      updates.currentQueueId = null;
      updates.currentTime = 0;
      updates.duration = 0;
      updates.isPlaying = false;
      extractColorsFromSongCover(null);
    }

    if (state.duration !== undefined) {
      if (state.duration > 0 || state.songId === null || state.songData === null) {
        updates.duration = state.duration;
      }
    }

    if (state.currentTime !== undefined && !current.isDraggingSlider) {
      if (!(current.isPlaying && current.audioMaster === 'dashboard')) {
        updates.currentTime = state.currentTime;
      }
    }

    if (state.isPlaying !== undefined && state.isPlaying !== current.isPlaying) {
      updates.isPlaying = state.isPlaying;
      if (!state.isPlaying) {
        audioPlayer.stopAllSources();
      }
    }

    if (state.audioMaster !== undefined) {
      updates.audioMaster = state.audioMaster;
      if (state.audioMaster === 'display' && (state.isPlaying || current.isPlaying)) {
        audioPlayer.stopAllSources();
      }
    }

    set(updates);
  }
}));

// Connect song finish auto-advance
audioPlayer.setOnSongEnd(() => {
  if (usePlaybackStore.getState().audioMaster !== 'display') {
    usePlaybackStore.getState().handleSongEnd();
  }
});
