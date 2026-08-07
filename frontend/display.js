import { io } from 'socket.io-client';

const socket = io('/');

const displayContainer = document.getElementById('displayContainer');
const lyricsContainer = document.getElementById('lyricsContainer');
const displaySongCover = document.getElementById('displaySongCover');
const displaySongTitle = document.getElementById('displaySongTitle');
const displaySongArtist = document.getElementById('displaySongArtist');

const displayPlayPauseBtn = document.getElementById('displayPlayPauseBtn');
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');

const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

let currentState = {
  currentTime: 0,
  isPlaying: false,
  volumes: { instrumentals: 1, back: 1, lead: 1 }
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
  if (!imgUrl || imgUrl.includes('placeholder')) {
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

  const fetchPromises = [];
  if (song && song.stems) {
    if (song.stems.lead) fetchPromises.push(fetch(song.stems.lead).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => displaySources.leadBuf = b));
    if (song.stems.back) fetchPromises.push(fetch(song.stems.back).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => displaySources.backBuf = b));
    if (song.stems.inst) fetchPromises.push(fetch(song.stems.inst).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => displaySources.instBuf = b));
  }

  displayAudioLoadingPromise = Promise.all(fetchPromises).catch(e => console.error("Error loading display audio:", e));
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

  if (displaySources.leadBuf) {
    displaySources.leadVoc = audioCtx.createBufferSource();
    displaySources.leadVoc.buffer = displaySources.leadBuf;
    displaySources.leadVoc.connect(displayGainNodes.leadVoc);
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
    displaySources.inst.start(0, offset);
  }

  displayAudioStartTime = audioCtx.currentTime - offset;
  currentState.isPlaying = true;
  updatePlaybackStatusUI();

  socket.emit('update_state', { isPlaying: true, currentTime: offset, audioMaster: 'display' });
  socket.emit('player_command', { command: 'toggle_play_from_display' });
}

function pauseDisplayAudio() {
  stopDisplayAudio();
  displayPauseTime = (currentState.isPlaying && audioCtx.state === 'running') ? (audioCtx.currentTime - displayAudioStartTime) : (currentState.currentTime || 0);
  currentState.isPlaying = false;
  updatePlaybackStatusUI();
  socket.emit('player_command', { command: 'pause' });
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
  });
}

// On display tab load/reload, ensure local state and UI are strictly paused
currentState.isPlaying = false;
stopDisplayAudio();
updatePlaybackStatusUI();
socket.emit('update_state', { isPlaying: false });

// Socket connection & Sync request
socket.on('connect', () => {
  socket.emit('update_state', { isPlaying: false });
  socket.emit('request_sync');
});
socket.emit('request_sync');

const audioBlockedBanner = document.getElementById('audioBlockedBanner');

function toggleAudioBlockedBanner(isBlocked) {
  if (!audioBlockedBanner) return;
  audioBlockedBanner.style.display = isBlocked ? 'block' : 'none';
}

// Sync state socket listener (Single Source of Truth)
socket.on('sync_state', (state) => {
  const previousSongId = currentState.songId;
  currentState = { ...currentState, ...state };

  if (state.isPlaying === false) {
    stopDisplayAudio();
  }

  if (state.volumes && displayGainNodes.inst) {
    if (state.volumes.instrumentals !== undefined) displayGainNodes.inst.gain.value = parseFloat(state.volumes.instrumentals);
    if (state.volumes.lead !== undefined && displayGainNodes.leadVoc) displayGainNodes.leadVoc.gain.value = parseFloat(state.volumes.lead);
    if (state.volumes.back !== undefined && displayGainNodes.backVoc) displayGainNodes.backVoc.gain.value = parseFloat(state.volumes.back);
  }

  if (state.songData) {
    if (state.songData.id !== previousSongId) {
      songData = state.songData;
      updateSidebarMeta(songData);
      renderLyrics(songData.lyrics);
      setupDisplayAudio(songData);
    } else {
      songData = state.songData;
      updateSidebarMeta(songData);
    }
  } else if (!state.songId || !state.songData) {
    songData = null;
    stopDisplayAudio();
    updateSidebarMeta(null);
    if (lyricsContainer) {
      lyricsContainer.innerHTML = '';
    }
  }

  updatePlaybackStatusUI();
  if (state.audioBlocked !== undefined) {
    toggleAudioBlockedBanner(state.audioBlocked);
  }

  if (songData && songData.lyrics) {
    updateLyrics(currentState.currentTime);
  }
});

socket.on('player_command', (cmd) => {
  if (!cmd) return;
  if (cmd.command === 'seek' && typeof cmd.time === 'number') {
    displayPauseTime = cmd.time;
    currentState.currentTime = cmd.time;
    updateLyrics(cmd.time);
    if (currentState.isPlaying && (displaySources.leadVoc || displaySources.inst)) {
      playDisplayAudio(cmd.time);
    }
  }
});

function getHighResAlbumArt(url) {
  if (!url) return 'https://via.placeholder.com/600/1e2235/ffffff?text=🎵';
  return url.replace(/\/\d+x\d+bb\./i, '/600x600bb.').replace(/\/\d+x\d+\./i, '/600x600.');
}

function updateSidebarMeta(data) {
  if (!displaySongTitle || !displaySongArtist || !displaySongCover) return;
  if (data) {
    displaySongTitle.innerText = data.title || '';
    displaySongArtist.innerText = data.artist || '';
    displaySongCover.style.display = 'block';
    const coverUrl = getHighResAlbumArt(data.albumArt);
    displaySongCover.src = coverUrl;
    extractColorsFromImage(coverUrl);
  } else {
    displaySongTitle.innerText = '';
    displaySongArtist.innerText = '';
    displaySongCover.style.display = 'none';
    extractColorsFromImage(null);
  }
}

function updatePlaybackStatusUI() {
  if (!displayPlayPauseBtn) return;
  if (currentState.isPlaying) {
    displayPlayPauseBtn.innerText = '⏸';
    displayPlayPauseBtn.className = 'btn glass-btn floating-control-btn playing';
    displayPlayPauseBtn.title = 'Pause (Space)';
  } else {
    displayPlayPauseBtn.innerText = '▶';
    displayPlayPauseBtn.className = 'btn glass-btn floating-control-btn paused';
    displayPlayPauseBtn.title = 'Play (Space)';
  }
}

function renderLyrics(lyrics) {
  if (!lyricsContainer) return;
  if (!lyrics || lyrics.length === 0) {
    lyricsContainer.innerHTML = '';
    return;
  }

  lyricsContainer.innerHTML = lyrics.map((l, i) => `
    <div class="lyric-line" id="lyric_${i}" data-time="${l.time}" data-index="${i}">
      <span class="lyric-text">${l.text}</span>
      ${l.transliteration ? `<span class="lyric-transliteration">${l.transliteration}</span>` : ''}
      ${l.translation ? `<span class="lyric-translation">${l.translation}</span>` : ''}
    </div>
  `).join('');
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
  if (!songData || !songData.lyrics) return;
  
  let activeIndex = -1;
  for (let i = 0; i < songData.lyrics.length; i++) {
    if (time >= songData.lyrics[i].time) {
      activeIndex = i;
    } else {
      break;
    }
  }
  
  document.querySelectorAll('.lyric-line').forEach((el, i) => {
    if (i === activeIndex) {
      if (!el.classList.contains('active')) {
        el.classList.add('active');
        // Smooth scroll into view centered inside scrollable lyrics container
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      el.classList.remove('active');
    }
  });

  // Handle subtitle toggles dynamically
  document.querySelectorAll('.lyric-transliteration').forEach(el => {
    el.style.display = currentState.showTranslit ? 'block' : 'none';
  });
  document.querySelectorAll('.lyric-translation').forEach(el => {
    el.style.display = currentState.showTranslat ? 'block' : 'none';
  });
}

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
    if (songData && songData.lyrics && songData.lyrics.length > 0) {
      const cur = currentState.currentTime || 0;
      const pastLines = songData.lyrics.filter(l => l.time < cur - 0.5);
      const targetTime = pastLines.length > 0 ? pastLines[pastLines.length - 1].time : 0;
      socket.emit('player_command', { command: 'seek', time: targetTime });
    }
    return;
  }
  if (!e.shiftKey && (e.key === '>' || e.key === '.')) {
    e.preventDefault();
    if (songData && songData.lyrics && songData.lyrics.length > 0) {
      const cur = currentState.currentTime || 0;
      const nextLine = songData.lyrics.find(l => l.time > cur + 0.3);
      if (nextLine) {
        socket.emit('player_command', { command: 'seek', time: nextLine.time });
      }
    }
    return;
  }

  // ArrowLeft / ArrowRight : Jump playback by 5 seconds
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    const cur = currentState.currentTime || 0;
    socket.emit('player_command', { command: 'seek', time: Math.max(0, cur - 5) });
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    const cur = currentState.currentTime || 0;
    socket.emit('player_command', { command: 'seek', time: cur + 5 });
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

// Update display lyric progress continuously if playing from display tab
setInterval(() => {
  if (currentState.isPlaying && audioCtx.state === 'running' && (displaySources.leadVoc || displaySources.inst)) {
    const curTime = audioCtx.currentTime - displayAudioStartTime;
    currentState.currentTime = curTime;
    updateLyrics(curTime);
    socket.emit('update_state', { currentTime: curTime });
  }
}, 100);
