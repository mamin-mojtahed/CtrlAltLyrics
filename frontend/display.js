import { io } from 'socket.io-client';

const socket = io('/');

const displayContainer = document.getElementById('displayContainer');
const lyricsContainer = document.getElementById('lyricsContainer');
const displaySongCover = document.getElementById('displaySongCover');
const displaySongTitle = document.getElementById('displaySongTitle');
const displaySongArtist = document.getElementById('displaySongArtist');

const displayPlayPauseBtn = document.getElementById('displayPlayPauseBtn');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
const songSidebar = document.getElementById('songSidebar');

const displayTimelineSlider = document.getElementById('displayTimelineSlider');
const displayTimeDisplay = document.getElementById('displayTimeDisplay');
const displayQueueSection = document.getElementById('displayQueueSection');
const displayQueueList = document.getElementById('displayQueueList');
const displayQueueMore = document.getElementById('displayQueueMore');

if (displayTimelineSlider) {
  displayTimelineSlider.step = 'any';
}

const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

let currentState = {
  currentTime: 0,
  isPlaying: false,
  volumes: { instrumentals: 1, back: 1, lead: 1 },
  showKaraokeSlide: true
};
let songData = null;

// Resize canvas
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Visualizer & Dynamic Theme logic
let fakeAmplitude = 0.5;
let dynamicAccentColor = { r: 99, g: 102, b: 241 }; // Default accent RGB

function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  fakeAmplitude = 0.5 + Math.sin(Date.now() / 500) * 0.2;
  
  const gradient = ctx.createRadialGradient(
    canvas.width/2, canvas.height/2, 0,
    canvas.width/2, canvas.height/2, canvas.width * fakeAmplitude
  );
  const { r, g, b } = dynamicAccentColor;
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.18 * fakeAmplitude})`);
  gradient.addColorStop(1, 'transparent');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
drawVisualizer();

function applyThemeColors(bgPrimary, bgSecondary, accent) {
  dynamicAccentColor = accent;
  if (!displayContainer) return;

  const bgPrimStr = `rgb(${bgPrimary.r}, ${bgPrimary.g}, ${bgPrimary.b})`;
  const bgSecStr = `rgb(${bgSecondary.r}, ${bgSecondary.g}, ${bgSecondary.b})`;
  const accentStr = `rgb(${accent.r}, ${accent.g}, ${accent.b})`;
  const accentGlowStr = `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.35)`;

  displayContainer.style.setProperty('--display-bg-primary', bgPrimStr);
  displayContainer.style.setProperty('--display-bg-secondary', bgSecStr);
  displayContainer.style.setProperty('--display-accent', accentStr);
  displayContainer.style.setProperty('--display-accent-glow', accentGlowStr);
}

function extractColorsFromImage(imgUrl) {
  if (!imgUrl || imgUrl.includes('placeholder') || imgUrl.includes('logo')) {
    applyThemeColors({ r: 15, g: 17, b: 26 }, { r: 30, g: 27, b: 75 }, { r: 99, g: 102, b: 241 });
    return;
  }

  const img = new Image();
  img.crossOrigin = 'Anonymous';
  img.src = imgUrl;

  img.onload = () => {
    try {
      const offCanvas = document.createElement('canvas');
      const offCtx = offCanvas.getContext('2d');
      offCanvas.width = 32;
      offCanvas.height = 32;
      offCtx.drawImage(img, 0, 0, 32, 32);

      const imageData = offCtx.getImageData(0, 0, 32, 32).data;
      let totalR = 0, totalG = 0, totalB = 0, count = 0;
      let maxSat = -1;
      let vibrantColor = { r: 99, g: 102, b: 241 };

      for (let i = 0; i < imageData.length; i += 4) {
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];
        const a = imageData[i + 3];

        if (a < 128) continue;

        totalR += r;
        totalG += g;
        totalB += b;
        count++;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 510;
        const sat = max === 0 ? 0 : (max - min) / max;

        if (sat > maxSat && l > 0.2 && l < 0.85) {
          maxSat = sat;
          vibrantColor = { r, g, b };
        }
      }

      if (count > 0) {
        const avgR = Math.round(totalR / count);
        const avgG = Math.round(totalG / count);
        const avgB = Math.round(totalB / count);

        const darkColor = {
          r: Math.round(avgR * 0.25),
          g: Math.round(avgG * 0.25),
          b: Math.round(avgB * 0.25)
        };

        const secondaryBg = {
          r: Math.round(vibrantColor.r * 0.25),
          g: Math.round(vibrantColor.g * 0.25),
          b: Math.round(vibrantColor.b * 0.25)
        };

        applyThemeColors(darkColor, secondaryBg, vibrantColor);
      }
    } catch (e) {
      applyThemeColors({ r: 15, g: 17, b: 26 }, { r: 30, g: 27, b: 75 }, { r: 99, g: 102, b: 241 });
    }
  };

  img.onerror = () => {
    applyThemeColors({ r: 15, g: 17, b: 26 }, { r: 30, g: 27, b: 75 }, { r: 99, g: 102, b: 241 });
  };
}

// Audio Engine for Display Tab Direct Playback
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let displaySources = {};
let displayGainNodes = {};
let displayAudioStartTime = 0;
let displayPauseTime = 0;
let displayAudioLoadingPromise = null;
let lastRenderedDisplayTime = 0;

function getDisplayCurrentTime() {
  if (currentState.isPlaying && audioCtx.state === 'running' && (displaySources.leadVoc || displaySources.inst)) {
    return Math.max(0, audioCtx.currentTime - displayAudioStartTime);
  } else if (currentState.isPlaying) {
    const now = performance.now();
    const elapsed = lastSyncTimestamp > 0 ? (now - lastSyncTimestamp) / 1000 : 0;
    return Math.max(0, (currentState.currentTime || 0) + elapsed);
  }
  return currentState.currentTime || 0;
}

function stopDisplayAudio() {
  if (displaySources.leadVoc) { try { displaySources.leadVoc.onended = null; displaySources.leadVoc.stop(); } catch(e){} }
  if (displaySources.backVoc) { try { displaySources.backVoc.onended = null; displaySources.backVoc.stop(); } catch(e){} }
  if (displaySources.inst) { try { displaySources.inst.onended = null; displaySources.inst.stop(); } catch(e){} }
  displaySources.leadVoc = null;
  displaySources.backVoc = null;
  displaySources.inst = null;
}

function setupDisplayAudio(song) {
  stopDisplayAudio();
  displaySources = {};
  displayGainNodes = {
    inst: audioCtx.createGain(),
    leadVoc: audioCtx.createGain(),
    backVoc: audioCtx.createGain()
  };

  displayGainNodes.inst.connect(audioCtx.destination);
  displayGainNodes.leadVoc.connect(audioCtx.destination);
  displayGainNodes.backVoc.connect(audioCtx.destination);

  const vols = currentState.volumes || { instrumentals: 1, back: 1, lead: 1 };
  displayGainNodes.inst.gain.value = parseFloat(vols.instrumentals || 1);
  displayGainNodes.leadVoc.gain.value = parseFloat(vols.lead || 1);
  displayGainNodes.backVoc.gain.value = parseFloat(vols.back || 1);

  const currentLoadingSongId = song ? song.id : null;
  const fetchPromises = [];
  if (song && song.stems) {
    if (song.stems.lead) fetchPromises.push(fetch(song.stems.lead).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => { if (songData && songData.id === currentLoadingSongId) displaySources.leadBuf = b; }));
    if (song.stems.back) fetchPromises.push(fetch(song.stems.back).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => { if (songData && songData.id === currentLoadingSongId) displaySources.backBuf = b; }));
    if (song.stems.inst) fetchPromises.push(fetch(song.stems.inst).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => { if (songData && songData.id === currentLoadingSongId) displaySources.instBuf = b; }));
  }

  displayAudioLoadingPromise = Promise.all(fetchPromises).then(() => {
    if (songData && songData.id === currentLoadingSongId) {
      const dur = displaySources.leadBuf ? displaySources.leadBuf.duration : (displaySources.instBuf ? displaySources.instBuf.duration : (displaySources.backBuf ? displaySources.backBuf.duration : 0));
      if (dur > 0) {
        displayDuration = dur;
        if (displayTimelineSlider) {
          displayTimelineSlider.max = dur;
          displayTimelineSlider.disabled = false;
        }
        if (displayTimeDisplay) {
          displayTimeDisplay.innerText = formatDisplayTimeDisplay(currentState.currentTime || 0, dur);
        }
        checkAndRenderNextUpQueue(currentState.currentTime || 0, dur);
      }
    }
  }).catch(e => console.error("Error loading display audio:", e));
  return displayAudioLoadingPromise;
}

async function playDisplayAudio(offset = 0) {
  if (!songData) return;

  if (!displaySources.leadBuf && !displaySources.instBuf && !displaySources.backBuf) {
    if (displayAudioLoadingPromise) {
      await displayAudioLoadingPromise;
    } else {
      await setupDisplayAudio(songData);
    }
  }

  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch(e) {}
  }

  stopDisplayAudio();

  const onDisplayEndedHandler = () => {
    const curTime = audioCtx.currentTime - displayAudioStartTime;
    const dur = displaySources.leadBuf ? displaySources.leadBuf.duration : (displaySources.instBuf ? displaySources.instBuf.duration : (displaySources.backBuf ? displaySources.backBuf.duration : 0));
    if (dur > 0 && curTime >= dur - 0.5) {
      socket.emit('player_command', { command: 'play_next' });
    }
  };

  if (displaySources.leadBuf) {
    displaySources.leadVoc = audioCtx.createBufferSource();
    displaySources.leadVoc.buffer = displaySources.leadBuf;
    displaySources.leadVoc.connect(displayGainNodes.leadVoc);
    displaySources.leadVoc.onended = onDisplayEndedHandler;
    displaySources.leadVoc.start(0, offset);
  }

  if (displaySources.backBuf) {
    displaySources.backVoc = audioCtx.createBufferSource();
    displaySources.backVoc.buffer = displaySources.backBuf;
    displaySources.backVoc.connect(displayGainNodes.backVoc);
    displaySources.backVoc.start(0, offset);
  }

  if (displaySources.instBuf) {
    displaySources.inst = audioCtx.createBufferSource();
    displaySources.inst.buffer = displaySources.instBuf;
    displaySources.inst.connect(displayGainNodes.inst);
    if (!displaySources.leadBuf) displaySources.inst.onended = onDisplayEndedHandler;
    displaySources.inst.start(0, offset);
  }

  displayAudioStartTime = audioCtx.currentTime - offset;
  currentState.isPlaying = true;
  updatePlaybackStatusUI();

  socket.emit('update_state', { isPlaying: true, currentTime: offset, audioMaster: 'display' });
  socket.emit('player_command', { command: 'toggle_play_from_display' });
}

function pauseDisplayAudio() {
  const currentActualTime = getDisplayCurrentTime();
  stopDisplayAudio();
  displayPauseTime = currentActualTime;
  currentState.currentTime = currentActualTime;
  currentState.isPlaying = false;
  lastRenderedDisplayTime = currentActualTime;
  lastSyncTimestamp = 0;
  updatePlaybackStatusUI();
  const dur = getResolvedDuration();
  if (displayTimelineSlider && !isDraggingDisplaySlider) {
    displayTimelineSlider.value = currentActualTime;
  }
  if (displayTimeDisplay) {
    displayTimeDisplay.innerText = formatDisplayTimeDisplay(currentActualTime, dur);
  }
  updateLyrics(currentActualTime);
  socket.emit('player_command', { command: 'pause', time: currentActualTime });
  socket.emit('update_state', { isPlaying: false, currentTime: currentActualTime });
}

async function toggleDisplayPlayPause() {
  if (!songData) {
    socket.emit('player_command', { command: 'toggle_play' });
    return;
  }

  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch(e) {}
  }

  if (currentState.isPlaying) {
    pauseDisplayAudio();
  } else {
    await playDisplayAudio(currentState.currentTime || 0);
  }
}

// Floating Play / Pause Control Button Handler
if (displayPlayPauseBtn) {
  displayPlayPauseBtn.addEventListener('click', toggleDisplayPlayPause);
}

// Toggle Sidebar (Song Info) Handler via Music Disk Button
if (toggleSidebarBtn) {
  toggleSidebarBtn.addEventListener('click', () => {
    const isHidden = displayContainer.classList.toggle('sidebar-hidden');
    toggleSidebarBtn.classList.toggle('disk-hidden-mode', isHidden);
    setTimeout(handleLyricsContainerResize, 350);
  });
}



// On narrow screens (phone), default sidebar to collapsed so lyrics are fully visible
if (window.innerWidth <= 768) {
  displayContainer.classList.add('sidebar-hidden');
  if (toggleSidebarBtn) toggleSidebarBtn.classList.add('disk-hidden-mode');
}

// On display tab load/reload, ensure local state and UI are strictly paused
currentState.isPlaying = false;
stopDisplayAudio();
updatePlaybackStatusUI();
socket.emit('update_state', { isPlaying: false });

fetchDisplayQueue();

// Socket connection & Sync request
socket.on('connect', () => {
  socket.emit('update_state', { isPlaying: false });
  socket.emit('request_sync');
  fetchDisplayQueue();
});
socket.emit('request_sync');
socket.on('queue_updated', (q) => {
  displayQueue = q;
  renderDisplayQueue();
});

const audioBlockedBanner = document.getElementById('audioBlockedBanner');

function toggleAudioBlockedBanner(isBlocked) {
  if (!audioBlockedBanner) return;
  audioBlockedBanner.style.display = isBlocked ? 'block' : 'none';
}

// Sync state socket listener (Single Source of Truth)
socket.on('sync_state', (state) => {
  const previousSongId = currentState.songId;
  const previousQueueId = currentState.queueId;
  const wasPlaying = currentState.isPlaying;
  const prevRenderedTime = lastRenderedDisplayTime || getDisplayCurrentTime();
  currentState = { ...currentState, ...state };

  if (state.showKaraokeSlide !== undefined) {
    updateKaraokeSlideVisibility();
  }
  if (state.showTranslit !== undefined || state.showTranslat !== undefined) {
    updateSubtitleVisibility();
  }

  if (state.isPlaying !== undefined) {
    if (state.isPlaying) {
      lastSyncTimestamp = performance.now();
    } else {
      lastSyncTimestamp = 0;
    }
  }

  if (state.currentTime !== undefined) {
    if (currentState.isPlaying) {
      const now = performance.now();
      const localElapsed = lastSyncTimestamp > 0 ? (now - lastSyncTimestamp) / 1000 : 0;
      const currentInterpolated = (currentState.currentTime || 0) + localElapsed;
      const delta = state.currentTime - currentInterpolated;
      if (Math.abs(delta) > 0.45) {
        currentState.currentTime = state.currentTime;
        lastSyncTimestamp = now;
      } else {
        // Soft clock correction: nudge base time to eliminate accumulated drift without visual jitter
        currentState.currentTime = currentInterpolated + delta * 0.2;
        lastSyncTimestamp = now;
      }
    } else {
      // Paused state: if transitioning from playing, do not trim backward by a few pixels
      if (wasPlaying && prevRenderedTime > state.currentTime && (prevRenderedTime - state.currentTime) < 0.35) {
        currentState.currentTime = prevRenderedTime;
      } else {
        currentState.currentTime = state.currentTime;
      }
      lastRenderedDisplayTime = currentState.currentTime;
      lastSyncTimestamp = 0;
    }
  } else if (state.isPlaying === false && wasPlaying) {
    currentState.currentTime = prevRenderedTime;
    lastRenderedDisplayTime = prevRenderedTime;
    lastSyncTimestamp = 0;
  }

  if (state.volumes && displayGainNodes.inst) {
    if (state.volumes.instrumentals !== undefined) displayGainNodes.inst.gain.value = parseFloat(state.volumes.instrumentals);
    if (state.volumes.lead !== undefined && displayGainNodes.leadVoc) displayGainNodes.leadVoc.gain.value = parseFloat(state.volumes.lead);
    if (state.volumes.back !== undefined && displayGainNodes.backVoc) displayGainNodes.backVoc.gain.value = parseFloat(state.volumes.back);
  }

  if (state.songData) {
    if (state.duration !== undefined && state.duration > 0) {
      displayDuration = state.duration;
    }
    const isNewInstance = (state.queueId && state.queueId !== previousQueueId) || (state.songData.id !== previousSongId);
    if (isNewInstance) {
      songData = state.songData;
      updateSidebarMeta(songData);
      renderLyrics(songData.lyrics);
      setupDisplayAudio(songData);
    } else {
      const prevMeta = songData;
      songData = state.songData;
      // Only update meta UI if something visible actually changed (cover, title, artist)
      const metaChanged = !prevMeta ||
        prevMeta.albumArt !== songData.albumArt ||
        prevMeta.title !== songData.title ||
        prevMeta.artist !== songData.artist;
      if (metaChanged) updateSidebarMeta(songData);
      renderLyrics(songData.lyrics); // Re-render in case of live sync edit
    }

    const dur = getResolvedDuration();
    if (dur > 0 && displayTimelineSlider) {
      displayTimelineSlider.max = dur;
      displayTimelineSlider.disabled = false;
    }
    if (state.currentTime !== undefined && !isDraggingDisplaySlider) {
      if (displayTimelineSlider) displayTimelineSlider.value = state.currentTime;
      if (displayTimeDisplay) displayTimeDisplay.innerText = formatDisplayTimeDisplay(state.currentTime, dur);
    }
    checkAndRenderNextUpQueue(state.currentTime || 0, dur);
  } else if (state.songId === null || state.songData === null) {
    songData = null;
    displayDuration = 0;
    if (displayTimelineSlider) {
      displayTimelineSlider.value = 0;
      displayTimelineSlider.max = 0;
      displayTimelineSlider.disabled = true;
    }
    if (displayTimeDisplay) {
      displayTimeDisplay.innerText = '--:-- / --:--';
    }
    stopDisplayAudio();
    updateSidebarMeta(null);
    if (lyricsContainer) {
      lyricsContainer.innerHTML = '';
    }
    renderDisplayQueue();
  }

  updatePlaybackStatusUI();
  if (state.audioBlocked !== undefined) {
    toggleAudioBlockedBanner(state.audioBlocked);
  }

  if (songData && songData.lyrics && !currentState.isPlaying) {
    updateLyrics(currentState.currentTime || 0);
  }
});

socket.on('player_command', (cmd) => {
  if (!cmd) return;
  if (cmd.command === 'seek' && typeof cmd.time === 'number') {
    displayPauseTime = cmd.time;
    currentState.currentTime = cmd.time;
    lastRenderedDisplayTime = cmd.time;
    if (currentState.isPlaying) {
      lastSyncTimestamp = performance.now();
    }
    const dur = getResolvedDuration();
    if (displayTimelineSlider && !isDraggingDisplaySlider) {
      displayTimelineSlider.value = cmd.time;
    }
    if (displayTimeDisplay) {
      displayTimeDisplay.innerText = formatDisplayTimeDisplay(cmd.time, dur);
    }
    updateLyrics(cmd.time);
    checkAndRenderNextUpQueue(cmd.time, dur);
    if (currentState.isPlaying && (displaySources.leadVoc || displaySources.inst)) {
      playDisplayAudio(cmd.time);
    }
  } else if (cmd.command === 'pause') {
    stopDisplayAudio();
    const prevRenderedTime = lastRenderedDisplayTime || getDisplayCurrentTime();
    let targetTime = prevRenderedTime;
    if (typeof cmd.time === 'number' && !isNaN(cmd.time)) {
      if (cmd.time >= prevRenderedTime || (prevRenderedTime - cmd.time) >= 0.35) {
        targetTime = cmd.time;
      }
    }
    displayPauseTime = targetTime;
    currentState.currentTime = targetTime;
    currentState.isPlaying = false;
    lastRenderedDisplayTime = targetTime;
    lastSyncTimestamp = 0;
    updatePlaybackStatusUI();
    const dur = getResolvedDuration();
    if (displayTimelineSlider && !isDraggingDisplaySlider) {
      displayTimelineSlider.value = targetTime;
    }
    if (displayTimeDisplay) {
      displayTimeDisplay.innerText = formatDisplayTimeDisplay(targetTime, dur);
    }
    updateLyrics(targetTime);
  }
});

const DEFAULT_ALBUM_COVER = '/ctrlaltlyrics-logo.webp';

function getHighResAlbumArt(url) {
  if (!url || url.includes('placeholder.com') || url === DEFAULT_ALBUM_COVER) return DEFAULT_ALBUM_COVER;
  return url.replace(/\/\d+x\d+bb\./i, '/600x600bb.').replace(/\/\d+x\d+\./i, '/600x600.');
}

function updateSidebarMeta(data) {
  if (!displaySongTitle || !displaySongArtist || !displaySongCover) return;
  if (data) {
    displaySongTitle.innerText = data.title || '';
    displaySongArtist.innerText = data.artist || '';
    displaySongCover.style.display = 'block';
    const coverUrl = getHighResAlbumArt(data.albumArt);
    // Only set src (and trigger a network request) if the URL actually changed
    if (displaySongCover.src !== coverUrl && displaySongCover.getAttribute('data-cover-url') !== coverUrl) {
      displaySongCover.setAttribute('data-cover-url', coverUrl);
      displaySongCover.src = coverUrl;
      displaySongCover.onerror = function() {
        this.onerror = null;
        this.src = DEFAULT_ALBUM_COVER;
        this.setAttribute('data-cover-url', DEFAULT_ALBUM_COVER);
      };
      const colorSrc = (data.id && data.albumArt && data.albumArt !== DEFAULT_ALBUM_COVER) ? `/api/cover/${data.id}` : coverUrl;
      extractColorsFromImage(colorSrc);
    }
  } else {
    displaySongTitle.innerText = '';
    displaySongArtist.innerText = '';
    if (displaySongCover.getAttribute('data-cover-url') !== DEFAULT_ALBUM_COVER) {
      displaySongCover.setAttribute('data-cover-url', DEFAULT_ALBUM_COVER);
      displaySongCover.src = DEFAULT_ALBUM_COVER;
    }
    displaySongCover.style.display = 'none';
    extractColorsFromImage(null);
  }
}

function updatePlaybackStatusUI() {
  if (!displayPlayPauseBtn) return;
  if (currentState.isPlaying) {
    displayPlayPauseBtn.innerHTML = '<i class="icon-pause"></i>';
    displayPlayPauseBtn.className = 'btn glass-btn floating-control-btn playing';
    displayPlayPauseBtn.title = 'Pause (Space)';
  } else {
    displayPlayPauseBtn.innerHTML = '<i class="icon-play"></i>';
    displayPlayPauseBtn.className = 'btn glass-btn floating-control-btn paused';
    displayPlayPauseBtn.title = 'Play (Space)';
  }
}

let displayLyrics = [];
let currentActiveLyricIndex = -1;
let lastSyncTimestamp = 0;
let lastRenderedLyricsJson = '';

function isRtlText(text) {
  if (!text) return false;
  const rtlRegex = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
  return rtlRegex.test(text);
}

function isInstrumentalText(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.toUpperCase() === '#INSTRUMENTAL') return true;
  if (/^\[instrumental\]$/i.test(trimmed)) return true;
  if (/^instrumental$/i.test(trimmed)) return true;
  if (/^[🎵🎶\s]+$/u.test(trimmed)) return true;
  if (/^[🎵🎶\s]*instrumental[🎵🎶\s]*$/i.test(trimmed)) return true;
  if (/^[🎵🎶\s]*بی‌?کلام[🎵🎶\s]*$/i.test(trimmed)) return true;
  return false;
}

function replaceMusicEmojisWithIcons(text) {
  if (!text) return '';
  return text.replace(/[\u{1F3B5}\u{1F3B6}]|🎵|🎶/gu, '<i class="icon-music"></i>');
}

function prepareLyricsForDisplay(rawLyrics) {
  if (!rawLyrics || rawLyrics.length === 0) return [];
  const list = rawLyrics.map(l => ({ ...l }));

  list.forEach(l => {
    if (l.isInstrumental || isInstrumentalText(l.text)) {
      l.isInstrumental = true;
      l.text = '🎵🎵🎵';
    }
  });

  const firstTime = typeof list[0].time === 'number' ? list[0].time : parseFloat(list[0].time) || 0;
  if (firstTime > 3.5 && !list.some(l => (parseFloat(l.time) || 0) < 1.5)) {
    list.unshift({
      time: 0,
      text: '🎵🎵🎵',
      isInstrumental: true
    });
  }

  list.forEach(l => {
    if (isRtlText(l.text)) {
      l.direction = 'rtl';
    } else {
      l.direction = 'ltr';
    }
  });

  return list;
}

function renderLyrics(lyrics) {
  if (!lyricsContainer) return;
  
  displayLyrics = prepareLyricsForDisplay(lyrics);
  const currentLyricsJson = JSON.stringify(displayLyrics);
  if (lastRenderedLyricsJson === currentLyricsJson) return;
  lastRenderedLyricsJson = currentLyricsJson;
  currentActiveLyricIndex = -1;

  if (displayLyrics.length === 0) {
    lyricsContainer.innerHTML = '';
    return;
  }

  lyricsContainer.innerHTML = displayLyrics.map((l, i) => {
    const isInst = !!l.isInstrumental;
    const dir = l.direction || 'ltr';
    const textHtml = isInst 
      ? '<i class="icon-music"></i> <i class="icon-music"></i> <i class="icon-music"></i>'
      : replaceMusicEmojisWithIcons(escapeHtml(l.text));

    return `
      <div class="lyric-line ${dir} ${isInst ? 'is-instrumental' : ''}" 
           id="lyric_${i}" 
           data-time="${l.time}" 
           data-index="${i}" 
           dir="${dir}">
        ${l.transliteration ? `<span class="lyric-transliteration">${escapeHtml(l.transliteration)}</span>` : ''}
        <span class="lyric-text" data-raw-text="${escapeHtml(l.text || '')}">${textHtml}</span>
        ${l.translation ? `<span class="lyric-translation">${escapeHtml(l.translation)}</span>` : ''}
      </div>
    `;
  }).join('');

  calculateLyricsLineBreaks();
  updateSubtitleVisibility();
  updateKaraokeSlideVisibility();
  updateLyrics(currentState.currentTime || 0);
}

function getLyricLineInterval(index) {
  if (!displayLyrics || index < 0 || index >= displayLyrics.length) {
    return { start: 0, end: 0, duration: 3 };
  }
  const line = displayLyrics[index];
  const start = typeof line.time === 'number' ? line.time : parseFloat(line.time) || 0;
  
  let end;
  if (index < displayLyrics.length - 1) {
    const nextLine = displayLyrics[index + 1];
    const nextStart = typeof nextLine.time === 'number' ? nextLine.time : parseFloat(nextLine.time) || 0;
    end = (nextStart > start) ? nextStart : (start + 3);
  } else {
    const totalDur = getResolvedDuration();
    end = (totalDur > start) ? totalDur : (start + 6);
  }

  const duration = Math.max(0.3, end - start);
  return { start, end, duration };
}

// Click to select lyric line & seek
if (lyricsContainer) {
  lyricsContainer.addEventListener('click', (e) => {
    const lineEl = e.target.closest('.lyric-line');
    if (!lineEl) return;
    const timeAttr = lineEl.getAttribute('data-time');
    if (timeAttr !== null) {
      const targetTime = parseFloat(timeAttr);
      if (!isNaN(targetTime)) {
        displayPauseTime = targetTime;
        currentState.currentTime = targetTime;
        if (currentState.isPlaying) lastSyncTimestamp = performance.now();
        updateLyrics(targetTime);
        socket.emit('player_command', { command: 'seek', time: targetTime });
        if (currentState.isPlaying && (displaySources.leadVoc || displaySources.inst)) {
          playDisplayAudio(targetTime);
        }
      }
    }
  });
}

function updateLyrics(time) {
  if (!displayLyrics || displayLyrics.length === 0) return;
  
  let activeIndex = -1;
  for (let i = 0; i < displayLyrics.length; i++) {
    if (time >= displayLyrics[i].time) {
      activeIndex = i;
    } else {
      break;
    }
  }
  
  if (activeIndex !== currentActiveLyricIndex) {
    currentActiveLyricIndex = activeIndex;
    if (lyricsContainer) {
      const lineElements = lyricsContainer.querySelectorAll('.lyric-line');
      lineElements.forEach((el, i) => {
        if (i === activeIndex) {
          if (!el.classList.contains('active')) {
            el.classList.add('active');
            el.classList.remove('past');
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } else if (i < activeIndex) {
          el.classList.remove('active');
          el.classList.add('past');
          el.style.setProperty('--karaoke-progress', '100%');
          el.querySelectorAll('.lyric-subline').forEach(s => s.style.setProperty('--karaoke-progress', '100%'));
        } else {
          el.classList.remove('active');
          el.classList.remove('past');
          el.style.setProperty('--karaoke-progress', '0%');
          el.querySelectorAll('.lyric-subline').forEach(s => s.style.setProperty('--karaoke-progress', '0%'));
        }
      });
    }
  }

  // Update karaoke slide-over takeover on active line
  if (activeIndex >= 0) {
    const activeEl = document.getElementById(`lyric_${activeIndex}`);
    if (activeEl) {
      if (currentState.showKaraokeSlide === false) {
        activeEl.style.removeProperty('--karaoke-progress');
        activeEl.querySelectorAll('.lyric-subline').forEach(s => s.style.removeProperty('--karaoke-progress'));
        return;
      }
      const { start, end, duration } = getLyricLineInterval(activeIndex);
      let progress = 0;
      if (time <= start) {
        progress = 0;
      } else if (time >= end) {
        progress = 100;
      } else {
        progress = ((time - start) / duration) * 100;
      }

      const sublines = activeEl.querySelectorAll('.lyric-subline');
      if (sublines.length > 1) {
        const totalChars = parseFloat(activeEl.getAttribute('data-total-chars')) || 1;
        let charAcc = 0;
        sublines.forEach(sub => {
          const charCount = parseFloat(sub.getAttribute('data-chars')) || 1;
          const lineFraction = charCount / totalChars;
          const lineStartPct = (charAcc / totalChars) * 100;
          const lineEndPct = lineStartPct + (lineFraction * 100);
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
}

// Shared offscreen canvas for high-performance subpixel text measurement
let lyricsMeasureCanvas = null;
let lyricsMeasureCtx = null;

function getLyricsMeasureContext() {
  if (!lyricsMeasureCanvas) {
    lyricsMeasureCanvas = document.createElement('canvas');
    lyricsMeasureCtx = lyricsMeasureCanvas.getContext('2d');
  }
  return lyricsMeasureCtx;
}

/**
 * Balance lyric line wrapping to avoid orphaned words and ensure aesthetically
 * pleasing, balanced line lengths within available container width.
 */
function balanceLyricLine(words, ctx, maxLineWidth) {
  if (!words || words.length === 0) return [];
  if (words.length <= 1) return [words.join('')];

  const spaceWidth = ctx.measureText(' ').width;
  const wordWidths = words.map(w => ctx.measureText(w).width);

  function getLineWidth(start, end) {
    let w = 0;
    for (let i = start; i < end; i++) {
      w += wordWidths[i];
      if (i < end - 1) w += spaceWidth;
    }
    return w;
  }

  const totalWidth = getLineWidth(0, words.length);
  // If the entire text fits comfortably on one line, never split!
  if (totalWidth <= maxLineWidth) {
    return [words.join(' ')];
  }

  const n = words.length;
  const minLines = Math.max(2, Math.ceil(totalWidth / maxLineWidth));
  let bestPartition = null;
  let bestCost = Infinity;

  // Multi-word lines must strictly fit within maxLineWidth.
  // Single words that exceed maxLineWidth are permitted as an absolute fallback.
  const hardMax = maxLineWidth;

  // Search across line counts from minLines up to minLines + 3
  for (let k = minLines; k <= Math.min(n, minLines + 3); k++) {
    const targetWidth = totalWidth / k;
    const dp = Array.from({ length: n + 1 }, () => Array(k + 1).fill(Infinity));
    const backtrack = Array.from({ length: n + 1 }, () => Array(k + 1).fill(-1));
    dp[0][0] = 0;

    for (let j = 1; j <= k; j++) {
      for (let i = j; i <= n; i++) {
        for (let p = j - 1; p < i; p++) {
          if (dp[p][j - 1] === Infinity) continue;
          const w = getLineWidth(p, i);
          const wordCount = i - p;
          if (w > hardMax && wordCount > 1) continue;

          let cost = Math.pow(w - targetWidth, 2);
          if (w > maxLineWidth) {
            cost += Math.pow((w - maxLineWidth) * 20, 2);
          }

          // Heavy penalty against short orphaned single words (e.g. 'the', 'me')
          if (wordCount === 1 && wordWidths[p] < maxLineWidth * 0.7) {
            cost += 5000000;
          } else if (wordCount === 2) {
            cost += 800;
          }

          const total = dp[p][j - 1] + cost;
          if (total < dp[i][j]) {
            dp[i][j] = total;
            backtrack[i][j] = p;
          }
        }
      }
    }

    if (dp[n][k] < bestCost) {
      bestCost = dp[n][k];
      const lines = [];
      let curr = n;
      for (let j = k; j >= 1; j--) {
        const prev = backtrack[curr][j];
        lines.unshift(words.slice(prev, curr).join(' '));
        curr = prev;
      }
      bestPartition = lines;
      if (dp[n][k] < 2000000) break; // Found clean partition without orphans!
    }
  }

  // Fallback if no clean partition found
  if (!bestPartition) {
    const lines = [];
    let curLine = [];
    let curW = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const wordW = wordWidths[i];
      const addW = curLine.length > 0 ? (spaceWidth + wordW) : wordW;
      if (curLine.length > 0 && curW + addW > maxLineWidth) {
        lines.push(curLine.join(' '));
        curLine = [w];
        curW = wordW;
      } else {
        curLine.push(w);
        curW += addW;
      }
    }
    if (curLine.length > 0) lines.push(curLine.join(' '));
    bestPartition = lines;
  }

  // Final orphan prevention: Merge any short 1-word lines with adjacent lines if within maxLineWidth
  if (bestPartition.length > 1) {
    for (let idx = 0; idx < bestPartition.length; idx++) {
      const lineWords = bestPartition[idx].split(' ');
      if (lineWords.length === 1 && wordWidths[words.indexOf(lineWords[0])] < maxLineWidth * 0.6) {
        if (idx > 0) {
          const prevLine = bestPartition[idx - 1];
          const combined = prevLine + ' ' + lineWords[0];
          const combW = ctx.measureText(combined).width;
          if (combW <= maxLineWidth) {
            bestPartition[idx - 1] = combined;
            bestPartition.splice(idx, 1);
            idx--;
            continue;
          }
        }
        if (idx < bestPartition.length - 1) {
          const nextLine = bestPartition[idx + 1];
          const combined = lineWords[0] + ' ' + nextLine;
          const combW = ctx.measureText(combined).width;
          if (combW <= maxLineWidth) {
            bestPartition[idx] = combined;
            bestPartition.splice(idx + 1, 1);
            continue;
          }
        }
      }
    }
  }

  return bestPartition;
}

function calculateLyricsLineBreaks() {
  if (!lyricsContainer || lyricsContainer.clientWidth <= 0) {
    requestAnimationFrame(() => calculateLyricsLineBreaks());
    return;
  }
  const lineEls = lyricsContainer.querySelectorAll('.lyric-line');
  if (lineEls.length === 0) return;

  // Clean up legacy DOM measure container if present
  const oldMeasureBox = document.getElementById('lyricsLineMeasureBox');
  if (oldMeasureBox) oldMeasureBox.remove();

  // Calculate maximum line width available within lyricsContainer
  const computedContainer = window.getComputedStyle(lyricsContainer);
  const containerPadLeft = parseFloat(computedContainer.paddingLeft) || 24;
  const containerPadRight = parseFloat(computedContainer.paddingRight) || 24;
  const containerInnerWidth = lyricsContainer.clientWidth - containerPadLeft - containerPadRight;

  const sampleLine = lyricsContainer.querySelector('.lyric-line:not(.is-instrumental)') || lyricsContainer.querySelector('.lyric-line');
  let linePad = 48; // default 1.5rem (24px) each side
  let textPad = 18; // default 0.25em each side
  if (sampleLine) {
    const lineStyle = window.getComputedStyle(sampleLine);
    linePad = (parseFloat(lineStyle.paddingLeft) || 24) + (parseFloat(lineStyle.paddingRight) || 24);
    const sampleText = sampleLine.querySelector('.lyric-text');
    if (sampleText) {
      const textStyle = window.getComputedStyle(sampleText);
      textPad = (parseFloat(textStyle.paddingLeft) || 0) + (parseFloat(textStyle.paddingRight) || 0);
    }
  }

  // Available width accounting for container limits, line limits (3rem = 48px), and inner text padding
  const maxLineBoxWidth = Math.min(containerInnerWidth, containerInnerWidth - 48);
  const availableWidth = Math.max(180, maxLineBoxWidth - linePad - textPad);

  // Available content width minus breathing margin (16px)
  const maxLineWidth = Math.max(180, Math.floor(availableWidth - 16));

  const ctx = getLyricsMeasureContext();
  const sampleComputed = sampleLine ? window.getComputedStyle(sampleLine) : window.getComputedStyle(lyricsContainer);
  const fontWeight = sampleComputed.fontWeight || '800';
  const fontSize = sampleComputed.fontSize || '35.2px';
  const fontFamily = sampleComputed.fontFamily || "'Inter', sans-serif";
  ctx.font = `${fontWeight} ${fontSize} ${fontFamily}`;
  if ('letterSpacing' in ctx) {
    const rawSpacing = (sampleComputed.letterSpacing && sampleComputed.letterSpacing !== 'normal')
      ? sampleComputed.letterSpacing
      : '0px';
    try {
      ctx.letterSpacing = rawSpacing;
    } catch (_) {}
  }

  lineEls.forEach(lineEl => {
    if (lineEl.classList.contains('is-instrumental')) return;
    const textEl = lineEl.querySelector('.lyric-text');
    if (!textEl) return;
    const rawText = textEl.getAttribute('data-raw-text');
    if (!rawText || !rawText.trim()) return;

    const words = rawText.split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
      if (textEl.classList.contains('has-sublines')) {
        textEl.classList.remove('has-sublines');
        lineEl.removeAttribute('data-total-chars');
        textEl.innerHTML = replaceMusicEmojisWithIcons(escapeHtml(rawText));
      }
      return;
    }

    const lines = balanceLyricLine(words, ctx, maxLineWidth);

    // If fits on a single line
    if (lines.length <= 1) {
      if (textEl.classList.contains('has-sublines')) {
        textEl.classList.remove('has-sublines');
        lineEl.removeAttribute('data-total-chars');
        textEl.innerHTML = replaceMusicEmojisWithIcons(escapeHtml(rawText));
      }
    } else {
      // Multi-line check: if sublines already match, DO NOT TOUCH LIVE DOM!
      const currentSubs = Array.from(textEl.querySelectorAll('.lyric-subline')).map(s => s.textContent.trim());
      const isIdentical = textEl.classList.contains('has-sublines') &&
        currentSubs.length === lines.length &&
        currentSubs.every((s, idx) => s === lines[idx]);

      if (isIdentical) {
        return;
      }

      textEl.classList.add('has-sublines');
      textEl.innerHTML = lines.map(lineText => {
        const escaped = escapeHtml(lineText);
        const iconified = replaceMusicEmojisWithIcons(escaped);
        const charLen = Math.max(1, lineText.trim().length);
        return `<div class="lyric-subline-wrap"><span class="lyric-subline" data-chars="${charLen}">${iconified}</span></div>`;
      }).join('');

      let totalChars = 0;
      textEl.querySelectorAll('.lyric-subline').forEach(s => {
        totalChars += (parseFloat(s.getAttribute('data-chars')) || 1);
      });
      lineEl.setAttribute('data-total-chars', totalChars);
    }
  });
}

function updateSubtitleVisibility() {
  if (!lyricsContainer) return;
  lyricsContainer.querySelectorAll('.lyric-transliteration').forEach(el => {
    el.style.display = currentState.showTranslit ? 'block' : 'none';
  });
  lyricsContainer.querySelectorAll('.lyric-translation').forEach(el => {
    el.style.display = currentState.showTranslat ? 'block' : 'none';
  });
}

function updateKaraokeSlideVisibility() {
  if (displayContainer) {
    const isEnabled = currentState.showKaraokeSlide !== false;
    displayContainer.classList.toggle('disable-karaoke-slide', !isEnabled);
  }
}

let currentQueueFillProgress = 0;

// Dedicated 60 FPS loop for karaoke text slide-over takeover
function karaokeLoop() {
  requestAnimationFrame(karaokeLoop);

  if (!songData || !displayLyrics || displayLyrics.length === 0) return;

  const curTime = getDisplayCurrentTime();
  lastRenderedDisplayTime = curTime;

  updateLyrics(curTime);

  if (isQueueExpanded && displayQueueList) {
    const dur = getResolvedDuration();
    const remainingTime = (dur > 0) ? (dur - curTime) : Infinity;
    if (remainingTime <= 10 && remainingTime >= 0) {
      const targetProgress = Math.max(0, Math.min(100, ((10 - remainingTime) / 10) * 100));
      currentQueueFillProgress += (targetProgress - currentQueueFillProgress) * 0.12;
      const firstExpanded = displayQueueList.querySelector('.display-queue-item.expanded');
      if (firstExpanded) {
        firstExpanded.style.setProperty('--queue-fill-progress', `${currentQueueFillProgress.toFixed(2)}%`);
      }
    } else {
      currentQueueFillProgress = 0;
    }
  } else {
    currentQueueFillProgress = 0;
  }
}
requestAnimationFrame(karaokeLoop);

// Keyboard shortcuts (Parity with Audio Controls Card)
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  
  // Space: Toggle Play/Pause
  if (e.code === 'Space') {
    e.preventDefault();
    if (e.target && typeof e.target.blur === 'function') e.target.blur();
    toggleDisplayPlayPause();
    return;
  }

  // Shift + < / > : Prev / Next Song
  if (e.shiftKey && (e.key === '<' || e.key === ',')) {
    e.preventDefault();
    socket.emit('player_command', { command: 'play_prev' });
    return;
  }
  if (e.shiftKey && (e.key === '>' || e.key === '.')) {
    e.preventDefault();
    socket.emit('player_command', { command: 'play_next' });
    return;
  }

  // < / > without Shift : Prev / Next Lyric Line
  if (!e.shiftKey && (e.key === '<' || e.key === ',')) {
    e.preventDefault();
    if (displayLyrics && displayLyrics.length > 0) {
      const cur = currentState.currentTime || 0;
      const pastLines = displayLyrics.filter(l => l.time < cur - 0.5);
      const targetTime = pastLines.length > 0 ? pastLines[pastLines.length - 1].time : 0;
      displayPauseTime = targetTime;
      currentState.currentTime = targetTime;
      if (currentState.isPlaying) lastSyncTimestamp = performance.now();
      updateLyrics(targetTime);
      socket.emit('player_command', { command: 'seek', time: targetTime });
      if (currentState.isPlaying && (displaySources.leadVoc || displaySources.inst)) {
        playDisplayAudio(targetTime);
      }
    }
    return;
  }
  if (!e.shiftKey && (e.key === '>' || e.key === '.')) {
    e.preventDefault();
    if (displayLyrics && displayLyrics.length > 0) {
      const cur = currentState.currentTime || 0;
      const nextLine = displayLyrics.find(l => l.time > cur + 0.3);
      if (nextLine) {
        displayPauseTime = nextLine.time;
        currentState.currentTime = nextLine.time;
        if (currentState.isPlaying) lastSyncTimestamp = performance.now();
        updateLyrics(nextLine.time);
        socket.emit('player_command', { command: 'seek', time: nextLine.time });
        if (currentState.isPlaying && (displaySources.leadVoc || displaySources.inst)) {
          playDisplayAudio(nextLine.time);
        }
      }
    }
    return;
  }

  // ArrowLeft / ArrowRight : Jump playback by 5 seconds
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    const cur = currentState.currentTime || 0;
    const targetTime = Math.max(0, cur - 5);
    displayPauseTime = targetTime;
    currentState.currentTime = targetTime;
    updateLyrics(targetTime);
    socket.emit('player_command', { command: 'seek', time: targetTime });
    if (currentState.isPlaying && (displaySources.leadVoc || displaySources.inst)) {
      playDisplayAudio(targetTime);
    }
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    const cur = currentState.currentTime || 0;
    const targetTime = cur + 5;
    displayPauseTime = targetTime;
    currentState.currentTime = targetTime;
    updateLyrics(targetTime);
    socket.emit('player_command', { command: 'seek', time: targetTime });
    if (currentState.isPlaying && (displaySources.leadVoc || displaySources.inst)) {
      playDisplayAudio(targetTime);
    }
    return;
  }

  // Stem Volume Shortcuts: Q/A (Inst), W/S (Back), E/D (Lead)
  const step = 0.05;
  const currentVols = currentState.volumes || { instrumentals: 1, back: 1, lead: 1 };
  let updated = false;
  let newVols = { ...currentVols };

  if (e.key === 'q') {
    newVols.instrumentals = Math.min(1, parseFloat(newVols.instrumentals || 1) + step);
    updated = true;
  }
  if (e.key === 'a') {
    newVols.instrumentals = Math.max(0, parseFloat(newVols.instrumentals || 1) - step);
    updated = true;
  }
  if (e.key === 'w') {
    newVols.back = Math.min(1, parseFloat(newVols.back || 1) + step);
    updated = true;
  }
  if (e.key === 's') {
    newVols.back = Math.max(0, parseFloat(newVols.back || 1) - step);
    updated = true;
  }
  if (e.key === 'e') {
    newVols.lead = Math.min(1, parseFloat(newVols.lead || 1) + step);
    updated = true;
  }
  if (e.key === 'd') {
    newVols.lead = Math.max(0, parseFloat(newVols.lead || 1) - step);
    updated = true;
  }

  // toggle song info display
  if (e.key === 'i') {
    const isHidden = displayContainer.classList.toggle('sidebar-hidden');
    toggleSidebarBtn.classList.toggle('disk-hidden-mode', isHidden);
  }

  if (updated) {
    currentState.volumes = newVols;
    socket.emit('player_command', { command: 'set_volumes', volumes: newVols });
  }
});

// Update display lyric progress continuously if playing from display tab or dashboard
setInterval(() => {
  const dur = getResolvedDuration();
  if (currentState.isPlaying && audioCtx.state === 'running' && (displaySources.leadVoc || displaySources.inst)) {
    const curTime = audioCtx.currentTime - displayAudioStartTime;
    if (dur > 0 && curTime >= dur) {
      socket.emit('player_command', { command: 'play_next' });
    } else {
      currentState.currentTime = curTime;
      updateLyrics(curTime);
      if (!isDraggingDisplaySlider && displayTimelineSlider) {
        displayTimelineSlider.value = curTime;
      }
      if (displayTimeDisplay) {
        displayTimeDisplay.innerText = formatDisplayTimeDisplay(curTime, dur);
      }
      checkAndRenderNextUpQueue(curTime, dur);
      socket.emit('update_state', { currentTime: curTime });
    }
  } else if (currentState.isPlaying) {
    const curTime = getDisplayCurrentTime();
    if (!isDraggingDisplaySlider && displayTimelineSlider) {
      displayTimelineSlider.value = curTime;
    }
    if (displayTimeDisplay) {
      displayTimeDisplay.innerText = formatDisplayTimeDisplay(curTime, dur);
    }
    checkAndRenderNextUpQueue(curTime, dur);
  }
}, 100);

// Helper Utilities & Queue Management for Display Tab
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let displayDuration = 0;
let isDraggingDisplaySlider = false;
let displayQueue = [];
let isQueueExpanded = false;
let lastRenderedCountdown = -1;
let lastRenderedQueueKey = '';

function formatTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m < 10 ? '0' : ''}${m}:${sec < 10 ? '0' : ''}${sec}`;
}

function formatDisplayTimeDisplay(currentTime, duration) {
  if (!songData) return '--:-- / --:--';
  const curStr = (currentTime !== undefined && currentTime !== null && !isNaN(currentTime)) ? formatTime(currentTime) : '--:--';
  const durStr = (duration && !isNaN(duration) && duration > 0) ? formatTime(duration) : '--:--';
  return `${curStr} / ${durStr}`;
}

function getResolvedDuration() {
  if (displayDuration > 0) return displayDuration;
  if (displaySources.leadBuf && displaySources.leadBuf.duration > 0) {
    displayDuration = displaySources.leadBuf.duration;
    return displayDuration;
  }
  if (displaySources.instBuf && displaySources.instBuf.duration > 0) {
    displayDuration = displaySources.instBuf.duration;
    return displayDuration;
  }
  if (displaySources.backBuf && displaySources.backBuf.duration > 0) {
    displayDuration = displaySources.backBuf.duration;
    return displayDuration;
  }
  if (songData && songData.duration > 0) {
    displayDuration = songData.duration;
    return displayDuration;
  }
  if (currentState.duration > 0) {
    displayDuration = currentState.duration;
    return displayDuration;
  }
  if (songData && songData.lyrics && songData.lyrics.length > 0) {
    const lastLyric = songData.lyrics[songData.lyrics.length - 1];
    if (lastLyric && lastLyric.time > 0) {
      return lastLyric.time + 5;
    }
  }
  return 0;
}

function seekDisplayToTime(targetTime) {
  if (!songData) return;
  const dur = getResolvedDuration();
  targetTime = Math.max(0, Math.min(dur > 0 ? dur : Infinity, targetTime));
  displayPauseTime = targetTime;
  currentState.currentTime = targetTime;
  if (displayTimelineSlider) displayTimelineSlider.value = targetTime;
  if (displayTimeDisplay) displayTimeDisplay.innerText = formatDisplayTimeDisplay(targetTime, dur);
  updateLyrics(targetTime);
  checkAndRenderNextUpQueue(targetTime, dur);

  socket.emit('player_command', { command: 'seek', time: targetTime });

  if (currentState.isPlaying && (displaySources.leadVoc || displaySources.inst)) {
    playDisplayAudio(targetTime);
  }
}

if (displayTimelineSlider) {
  displayTimelineSlider.addEventListener('input', (e) => {
    isDraggingDisplaySlider = true;
    const target = parseFloat(e.target.value);
    if (currentState.isPlaying && audioCtx.state === 'running') {
      displayAudioStartTime = audioCtx.currentTime - target;
    }
    displayPauseTime = target;
    const dur = getResolvedDuration();
    if (displayTimeDisplay) displayTimeDisplay.innerText = formatDisplayTimeDisplay(target, dur);
    updateLyrics(target);
    checkAndRenderNextUpQueue(target, dur);
  });

  displayTimelineSlider.addEventListener('change', (e) => {
    isDraggingDisplaySlider = false;
    const target = parseFloat(e.target.value);
    seekDisplayToTime(target);
  });
}

async function fetchDisplayQueue() {
  try {
    const res = await fetch('/api/queue');
    if (res.ok) {
      displayQueue = await res.json();
      renderDisplayQueue();
    }
  } catch (err) {
    console.error('Error fetching queue in display tab:', err);
  }
}

function getUpcomingQueueSongs() {
  if (!displayQueue || displayQueue.length === 0) return [];
  const readySongs = displayQueue.filter(s => s.status === 'ready');
  if (readySongs.length === 0) return [];

  let curIdx = -1;
  if (currentState.queueId) {
    curIdx = readySongs.findIndex(s => s.queueId === currentState.queueId);
  }
  if (curIdx === -1 && songData) {
    curIdx = readySongs.findIndex(s => s.id === songData.id);
  }

  if (curIdx !== -1) {
    return readySongs.slice(curIdx + 1);
  }
  return readySongs;
}

function getNextUpSongs() {
  return getUpcomingQueueSongs().slice(0, 3);
}

function getRemainingQueueCount() {
  const all = getUpcomingQueueSongs();
  return Math.max(0, all.length - 3);
}

function createQueueItemInnerHtml(song) {
  const art = song.albumArt || DEFAULT_ALBUM_COVER;
  return `
    <div class="queue-compact-row">
      <span class="queue-item-text">
        <strong class="queue-item-title">${escapeHtml(song.title)}</strong>
        <span class="queue-item-sep">•</span>
        <span class="queue-item-artist">${escapeHtml(song.artist)}</span>
      </span>
    </div>
    <div class="queue-expanded-container">
      <div class="queue-expanded-body">
        <img class="queue-expanded-art" src="${escapeHtml(art)}" alt="art" onerror="this.onerror=null; this.src='${DEFAULT_ALBUM_COVER}';">
        <div class="queue-expanded-info">
          <div class="queue-expanded-title">${escapeHtml(song.title)}</div>
          <div class="queue-expanded-artist">${escapeHtml(song.artist)}</div>
        </div>
      </div>
    </div>
  `;
}

function updateQueueItemContent(el, song) {
  const titleEls = el.querySelectorAll('.queue-item-title, .queue-expanded-title');
  titleEls.forEach(t => {
    if (t.innerText !== song.title) t.innerText = song.title;
  });
  const artistEls = el.querySelectorAll('.queue-item-artist, .queue-expanded-artist');
  artistEls.forEach(a => {
    if (a.innerText !== song.artist) a.innerText = song.artist;
  });
  const artImg = el.querySelector('.queue-expanded-art');
  const targetArt = song.albumArt || DEFAULT_ALBUM_COVER;
  if (artImg && artImg.getAttribute('src') !== targetArt) {
    artImg.src = targetArt;
  }
}

function renderDisplayQueue(explicitTime = null) {
  if (!displayQueueList) return;
  const nextSongs = getNextUpSongs();

  if (nextSongs.length === 0) {
    if (displayQueueMore) {
      displayQueueMore.style.display = 'none';
      displayQueueMore.innerText = '';
    }
    const existing = displayQueueList.querySelectorAll('.display-queue-item:not(.leaving)');
    if (existing.length > 0) {
      existing.forEach(el => {
        el.classList.add('leaving');
        setTimeout(() => { if (el.parentNode) el.remove(); }, 420);
      });
      setTimeout(() => {
        if (!displayQueueList.querySelector('.display-queue-empty') && displayQueueList.querySelectorAll('.display-queue-item:not(.leaving)').length === 0) {
          displayQueueList.innerHTML = '<div class="display-queue-empty">No upcoming songs</div>';
        }
      }, 350);
    } else if (!displayQueueList.querySelector('.display-queue-empty')) {
      displayQueueList.innerHTML = '<div class="display-queue-empty">No upcoming songs</div>';
    }
    return;
  }

  // Remove empty notice if present
  const emptyEl = displayQueueList.querySelector('.display-queue-empty');
  if (emptyEl) emptyEl.remove();

  const curTime = (explicitTime !== null && explicitTime !== undefined) ? explicitTime : (currentState.currentTime || 0);
  const dur = getResolvedDuration();
  const remainingTime = dur > 0 ? (dur - curTime) : Infinity;
  const shouldExpand = (dur > 0 && remainingTime <= 10 && remainingTime >= 0);

  // Map existing items
  const existingMap = new Map();
  displayQueueList.querySelectorAll('.display-queue-item').forEach(el => {
    const key = el.getAttribute('data-queue-id') || el.getAttribute('data-id');
    if (key) existingMap.set(key, el);
  });

  const nextKeys = new Set(nextSongs.map(s => String(s.queueId || s.id)));

  // Animate removal for items that are no longer in next up
  existingMap.forEach((el, key) => {
    if (!nextKeys.has(key)) {
      if (!el.classList.contains('leaving')) {
        el.classList.add('leaving');
        setTimeout(() => {
          if (el.parentNode) el.remove();
        }, 420);
      }
    }
  });

  // Reconcile and position active items
  nextSongs.forEach((song, idx) => {
    const key = String(song.queueId || song.id);
    const isFirst = (idx === 0);
    const expandThis = isFirst && shouldExpand;
    let el = existingMap.get(key);

    if (el) {
      el.classList.remove('leaving');
      el.classList.toggle('expanded', expandThis);
      el.setAttribute('title', `Click to play: ${song.title}`);
      if (expandThis) {
        const fillProgress = Math.max(0, Math.min(100, ((10 - remainingTime) / 10) * 100));
        el.style.setProperty('--queue-fill-progress', `${fillProgress.toFixed(2)}%`);
      } else {
        el.style.setProperty('--queue-fill-progress', '0%');
      }
      updateQueueItemContent(el, song);
    } else {
      el = document.createElement('div');
      el.className = `display-queue-item entering ${expandThis ? 'expanded' : ''}`;
      el.setAttribute('data-id', song.id);
      el.setAttribute('data-queue-id', song.queueId || song.id);
      el.setAttribute('title', `Click to play: ${song.title}`);
      if (expandThis) {
        const fillProgress = Math.max(0, Math.min(100, ((10 - remainingTime) / 10) * 100));
        el.style.setProperty('--queue-fill-progress', `${fillProgress.toFixed(2)}%`);
      }
      el.innerHTML = createQueueItemInnerHtml(song);
      el.addEventListener('animationend', () => {
        el.classList.remove('entering');
      }, { once: true });
    }

    // Place element at current index (ignoring leaving elements in index count)
    const nonLeaving = Array.from(displayQueueList.children).filter(c => !c.classList.contains('leaving') && !c.classList.contains('display-queue-empty'));
    const targetSibling = nonLeaving[idx] || null;
    if (el !== targetSibling) {
      displayQueueList.insertBefore(el, targetSibling);
    }
  });

  const remainingCount = getRemainingQueueCount();
  if (displayQueueMore) {
    if (remainingCount > 0) {
      displayQueueMore.innerText = `+${remainingCount} more`;
      displayQueueMore.style.display = 'flex';
    } else {
      displayQueueMore.style.display = 'none';
      displayQueueMore.innerText = '';
    }
  }
}

function checkAndRenderNextUpQueue(currentTime, duration) {
  if (!displayQueueList) return;
  const allUpcoming = getUpcomingQueueSongs();
  const nextSongs = allUpcoming.slice(0, 3);
  const queueKey = allUpcoming.map(s => (s.queueId || s.id)).join('|');
  const remainingTime = (duration > 0) ? (duration - currentTime) : Infinity;
  const shouldExpand = (duration > 0 && remainingTime <= 10 && remainingTime >= 0 && nextSongs.length > 0);

  if (queueKey !== lastRenderedQueueKey || shouldExpand !== isQueueExpanded) {
    lastRenderedQueueKey = queueKey;
    isQueueExpanded = shouldExpand;
    renderDisplayQueue(currentTime);
  }

  if (shouldExpand) {
    const firstExpanded = displayQueueList.querySelector('.display-queue-item.expanded');
    if (firstExpanded) {
      const fillProgress = Math.max(0, Math.min(100, ((10 - remainingTime) / 10) * 100));
      firstExpanded.style.setProperty('--queue-fill-progress', `${fillProgress.toFixed(2)}%`);
    }
  }
}

if (displayQueueList) {
  displayQueueList.addEventListener('click', (e) => {
    const item = e.target.closest('.display-queue-item');
    if (!item) return;
    const songId = item.getAttribute('data-id');
    const queueId = item.getAttribute('data-queue-id');
    if (songId) {
      socket.emit('player_command', { command: 'select_song', id: songId, queueId: queueId });
    }
  });
}

updateKaraokeSlideVisibility();

let lyricsResizeRaf = null;
let lyricsResizeTimeout = null;
function handleLyricsContainerResize() {
  if (lyricsResizeRaf) cancelAnimationFrame(lyricsResizeRaf);
  lyricsResizeRaf = requestAnimationFrame(() => {
    calculateLyricsLineBreaks();
    updateLyrics(currentState.currentTime || 0);
  });
  // Settle timeout to catch completion of 0.4s CSS width/flex transitions on sidebar toggle
  clearTimeout(lyricsResizeTimeout);
  lyricsResizeTimeout = setTimeout(() => {
    calculateLyricsLineBreaks();
    updateLyrics(currentState.currentTime || 0);
  }, 420);
}

const mainContent = document.querySelector('.lyrics-main-content');
if (mainContent) {
  mainContent.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'width' || e.propertyName === 'flex') {
      handleLyricsContainerResize();
    }
  });
}

if (window.ResizeObserver && (mainContent || lyricsContainer)) {
  const targetToObserve = mainContent || lyricsContainer;
  let lastObservedWidth = 0;
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const cr = entry.contentRect;
      if (Math.abs(cr.width - lastObservedWidth) > 2) {
        lastObservedWidth = cr.width;
        handleLyricsContainerResize();
      }
    }
  });
  ro.observe(targetToObserve);
} else {
  window.addEventListener('resize', handleLyricsContainerResize);
}

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    calculateLyricsLineBreaks();
    updateLyrics(currentState.currentTime || 0);
  });
}

window.__displayCtrl = {
  socket,
  getCurrentState: () => currentState,
  setCurrentState: (s) => { currentState = { ...currentState, ...s }; },
  setSongData: (d) => { songData = d; },
  renderLyrics,
  updateLyrics,
  calculateLyricsLineBreaks,
  balanceLyricLine,
  getLyricsMeasureContext,
  updateKaraokeSlideVisibility,
  getDisplayCurrentTime,
  pauseDisplayAudio
};

