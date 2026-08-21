import { io } from 'socket.io-client';

const socket = io('/');

const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchResults = document.getElementById('searchResults');
const queueList = document.getElementById('queueList');
const historyList = document.getElementById('historyList');
const libraryList = document.getElementById('libraryList') || historyList;
const libraryFilterInput = document.getElementById('libraryFilterInput');
const librarySortBtn = document.getElementById('librarySortBtn');
const librarySortMenu = document.getElementById('librarySortMenu');

let rawLibraryData = [];
let libraryFilterQuery = '';
let librarySortKey = 'date';
let librarySortOrder = 'desc';
let draggedQueueIndex = null;

const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const prevLineBtn = document.getElementById('prevLineBtn');
const nextLineBtn = document.getElementById('nextLineBtn');

const timelineSlider = document.getElementById('timelineSlider');
const currentSongTitle = document.getElementById('currentSongTitle');
const lyricsCounter = document.getElementById('lyricsCounter');

const volInst = document.getElementById('volInst');
const volLeadVoc = document.getElementById('volLeadVoc');
const volBackVoc = document.getElementById('volBackVoc');

const timeDisplay = document.getElementById('timeDisplay');
const linkInstBackBtn = document.getElementById('linkInstBackBtn');
const linkBackLeadBtn = document.getElementById('linkBackLeadBtn');

let isInstBackLinked = false;
let isBackLeadLinked = false;
let isHandlingSongEnd = false;
let isDraggingSlider = false;

const lyricsTbody = document.getElementById('lyricsTbody');
const saveLyricsBtn = document.getElementById('saveLyricsBtn');

const lyricsSection = document.getElementById('lyricsSection');
const toggleLyricsExpandBtn = document.getElementById('toggleLyricsExpandBtn');

let currentState = {};
let currentSong = null;

function formatTime(seconds) {
  if (seconds === undefined || seconds === null || isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function formatTimeDisplay(currentTime, duration) {
  if (!currentSong) return '--:-- / --:--';
  const curStr = (currentTime !== undefined && currentTime !== null && !isNaN(currentTime)) ? formatTime(currentTime) : '--:--';
  const durStr = (duration && !isNaN(duration) && duration > 0) ? formatTime(duration) : '--:--';
  return `${curStr} / ${durStr}`;
}

// Adaptive Dynamic Theme Colors (matches Display Tab)
function getHighResAlbumArt(url) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb\./i, '/600x600bb.').replace(/\/\d+x\d+\./i, '/600x600.');
}

function applyDashboardThemeColors(bgPrimary, bgSecondary, accent) {
  const bgPrimStr = `rgb(${bgPrimary.r}, ${bgPrimary.g}, ${bgPrimary.b})`;
  const bgSecStr = `rgb(${bgSecondary.r}, ${bgSecondary.g}, ${bgSecondary.b})`;
  const accentStr = `rgb(${accent.r}, ${accent.g}, ${accent.b})`;
  const accentHoverStr = `rgb(${Math.max(0, Math.round(accent.r * 0.85))}, ${Math.max(0, Math.round(accent.g * 0.85))}, ${Math.max(0, Math.round(accent.b * 0.85))})`;
  const accentGlowStr = `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.35)`;
  const panelBgStr = `rgba(${Math.round(bgPrimary.r * 1.3 + 10)}, ${Math.round(bgPrimary.g * 1.3 + 12)}, ${Math.round(bgPrimary.b * 1.3 + 18)}, 0.65)`;

  const root = document.documentElement;
  root.style.setProperty('--bg-color', bgPrimStr);
  root.style.setProperty('--dashboard-bg-primary', bgPrimStr);
  root.style.setProperty('--dashboard-bg-secondary', bgSecStr);
  root.style.setProperty('--accent', accentStr);
  root.style.setProperty('--accent-hover', accentHoverStr);
  root.style.setProperty('--accent-glow', accentGlowStr);
  root.style.setProperty('--panel-bg', panelBgStr);

  updateAllFaderTrackFills();
}

function extractColorsFromSongCover(imgUrl) {
  if (!imgUrl || imgUrl.includes('placeholder') || imgUrl.includes('logo')) {
    applyDashboardThemeColors({ r: 15, g: 17, b: 26 }, { r: 30, g: 27, b: 75 }, { r: 99, g: 102, b: 241 });
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

        applyDashboardThemeColors(darkColor, secondaryBg, vibrantColor);
      }
    } catch (e) {
      applyDashboardThemeColors({ r: 15, g: 17, b: 26 }, { r: 30, g: 27, b: 75 }, { r: 99, g: 102, b: 241 });
    }
  };

  img.onerror = () => {
    applyDashboardThemeColors({ r: 15, g: 17, b: 26 }, { r: 30, g: 27, b: 75 }, { r: 99, g: 102, b: 241 });
  };
}

function updateLyricsCounter(time = 0) {
  if (!lyricsCounter) return;
  if (!currentSong || !currentSong.lyrics || currentSong.lyrics.length === 0) {
    lyricsCounter.innerText = 'Lyrics 0/0';
    return;
  }
  const total = currentSong.lyrics.length;
  let activeIndex = -1;
  for (let i = 0; i < total; i++) {
    if (time >= currentSong.lyrics[i].time) {
      activeIndex = i;
    } else {
      break;
    }
  }
  const currentLineNum = activeIndex >= 0 ? activeIndex + 1 : 0;
  lyricsCounter.innerText = `Lyrics ${currentLineNum}/${total}`;
}

// Audio Context Setup
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let sources = {};
let gainNodes = {};
let audioStartTime = 0;
let pauseTime = 0;

const audioBlockedBanner = document.getElementById('audioBlockedBanner');

function toggleAudioBlockedBanner(isBlocked) {
  if (!audioBlockedBanner) return;
  audioBlockedBanner.style.display = isBlocked ? 'block' : 'none';
}

function unlockAudio() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => {
      toggleAudioBlockedBanner(false);
      socket.emit('update_state', { audioBlocked: false });
    }).catch(() => {});
  }
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
window.addEventListener('click', unlockAudio);

function stopSource(sourceNode) {
  if (sourceNode) {
    try {
      sourceNode.onended = null;
      sourceNode.stop();
    } catch(e){}
  }
}

let audioLoadingPromise = null;

function setupAudio(song) {
  stopSource(sources.leadVoc);
  stopSource(sources.backVoc);
  stopSource(sources.inst);
  
  sources = {};
  gainNodes = {
    inst: audioCtx.createGain(),
    leadVoc: audioCtx.createGain(),
    backVoc: audioCtx.createGain()
  };

  gainNodes.inst.connect(audioCtx.destination);
  gainNodes.leadVoc.connect(audioCtx.destination);
  gainNodes.backVoc.connect(audioCtx.destination);

  gainNodes.inst.gain.value = parseFloat(volInst.value || 1);
  gainNodes.leadVoc.gain.value = parseFloat(volLeadVoc.value || 1);
  gainNodes.backVoc.gain.value = parseFloat(volBackVoc.value || 1);

  const currentLoadingSongId = song.id;
  const fetchPromises = [];
  if (song.stems && song.stems.lead) fetchPromises.push(fetch(song.stems.lead).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => { if (currentSong && currentSong.id === currentLoadingSongId) sources.leadBuf = b; }));
  if (song.stems && song.stems.back) fetchPromises.push(fetch(song.stems.back).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => { if (currentSong && currentSong.id === currentLoadingSongId) sources.backBuf = b; }));
  if (song.stems && song.stems.inst) fetchPromises.push(fetch(song.stems.inst).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => { if (currentSong && currentSong.id === currentLoadingSongId) sources.instBuf = b; }));

  audioLoadingPromise = Promise.all(fetchPromises).then(() => {
    if (!currentSong || currentSong.id !== currentLoadingSongId) return;
    playPauseBtn.disabled = false;
    timelineSlider.disabled = false;
    const dur = sources.leadBuf ? sources.leadBuf.duration : (sources.instBuf ? sources.instBuf.duration : (sources.backBuf ? sources.backBuf.duration : 0));
    timelineSlider.max = dur;
    if (timeDisplay) timeDisplay.innerText = formatTimeDisplay(pauseTime || 0, dur);
    updateLyricsCounter(pauseTime || 0);
  }).catch(e => console.error("Error loading audio:", e));

  return audioLoadingPromise;
}

async function playAudio(offset = 0) {
  if (!currentSong) return;

  if (audioCtx && audioCtx.state === 'suspended') {
    try {
      audioCtx.resume();
    } catch(e) {}
  }

  if (!sources.leadBuf && !sources.instBuf && !sources.backBuf) {
    if (audioLoadingPromise) {
      await audioLoadingPromise;
    } else {
      await setupAudio(currentSong);
    }
  }

  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch(e) {}
  }

  if (audioCtx.state === 'suspended') {
    console.warn("AudioContext suspended by browser autoplay policy.");
    toggleAudioBlockedBanner(true);
    socket.emit('update_state', { audioBlocked: true });
  } else {
    toggleAudioBlockedBanner(false);
    socket.emit('update_state', { audioBlocked: false });
  }
  
  // Clean up any existing active playing buffer sources
  stopSource(sources.leadVoc);
  stopSource(sources.backVoc);
  stopSource(sources.inst);

  const onEndedHandler = () => {
    const curTime = audioCtx.currentTime - audioStartTime;
    const maxDur = parseFloat(timelineSlider.max) || 0;
    if (maxDur > 0 && curTime >= maxDur - 0.5) {
      handleSongFinished();
    }
  };

  if (sources.leadBuf) {
    sources.leadVoc = audioCtx.createBufferSource();
    sources.leadVoc.buffer = sources.leadBuf;
    sources.leadVoc.connect(gainNodes.leadVoc);
    sources.leadVoc.onended = onEndedHandler;
    sources.leadVoc.start(0, offset);
  }
  
  if (sources.backBuf) {
    sources.backVoc = audioCtx.createBufferSource();
    sources.backVoc.buffer = sources.backBuf;
    sources.backVoc.connect(gainNodes.backVoc);
    sources.backVoc.start(0, offset);
  }

  if (sources.instBuf) {
    sources.inst = audioCtx.createBufferSource();
    sources.inst.buffer = sources.instBuf;
    sources.inst.connect(gainNodes.inst);
    if (!sources.leadBuf) sources.inst.onended = onEndedHandler;
    sources.inst.start(0, offset);
  }
  
  audioStartTime = audioCtx.currentTime - offset;
  pauseTime = offset;
  currentState.isPlaying = true;
  playPauseBtn.innerText = '⏸';
  socket.emit('update_state', { isPlaying: true, currentTime: offset });
}

function pauseAudio() {
  stopSource(sources.leadVoc);
  stopSource(sources.backVoc);
  stopSource(sources.inst);
  sources.leadVoc = null;
  sources.backVoc = null;
  sources.inst = null;
  pauseTime = (currentState.isPlaying && audioCtx.state === 'running') ? (audioCtx.currentTime - audioStartTime) : pauseTime;
  currentState.isPlaying = false;
  playPauseBtn.innerText = '▶';
  socket.emit('player_command', { command: 'pause' });
}

async function togglePlayPause() {
  if (audioCtx && audioCtx.state === 'suspended') {
    try {
      audioCtx.resume();
    } catch(e) {}
  }

  if (!currentSong) {
    let readySong = null;
    try {
      const qRes = await fetch('/api/queue');
      const queue = await qRes.json();
      readySong = (queue || []).find(s => s.status === 'ready');
    } catch(e) {
      console.error("Error fetching queue for togglePlayPause:", e);
    }

    if (readySong) {
      await selectSong(readySong.id, true);
    }
    return;
  }

  if (!sources.leadBuf && !sources.instBuf && !sources.backBuf) {
    if (audioLoadingPromise) {
      await audioLoadingPromise;
    } else if (currentSong) {
      await setupAudio(currentSong);
    }
  }

  if (currentState.isPlaying) {
    pauseAudio();
  } else {
    await playAudio(pauseTime || parseFloat(timelineSlider.value) || 0);
  }
}

playPauseBtn.addEventListener('click', togglePlayPause);

// Song Navigation
async function playNext() {
  const res = await fetch('/api/queue');
  const q = await res.json();
  const readySongs = q.filter(s => s.status === 'ready');
  if (readySongs.length === 0) return;
  if (!currentSong) return selectSong(readySongs[0].id, true);
  const idx = readySongs.findIndex(s => s.id === currentSong.id);
  if (idx !== -1 && idx < readySongs.length - 1) {
    await selectSong(readySongs[idx + 1].id, currentState.isPlaying);
  }
}

async function playPrev() {
  const res = await fetch('/api/queue');
  const q = await res.json();
  const readySongs = q.filter(s => s.status === 'ready');
  if (readySongs.length === 0) return;
  if (!currentSong) return selectSong(readySongs[0].id, true);
  const idx = readySongs.findIndex(s => s.id === currentSong.id);
  if (idx > 0) {
    await selectSong(readySongs[idx - 1].id, currentState.isPlaying);
  }
}

nextBtn.addEventListener('click', playNext);
prevBtn.addEventListener('click', playPrev);

// Lyric Line Navigation
function getCurrentTime() {
  if (currentState.isPlaying && audioCtx.state === 'running') {
    return audioCtx.currentTime - audioStartTime;
  }
  return pauseTime || 0;
}

function jumpToNextLine() {
  if (!currentSong || !currentSong.lyrics || currentSong.lyrics.length === 0) return;
  const cur = getCurrentTime();
  const nextLine = currentSong.lyrics.find(l => l.time > cur + 0.3);
  if (nextLine) {
    seekToTime(nextLine.time);
  }
}

function jumpToPrevLine() {
  if (!currentSong || !currentSong.lyrics || currentSong.lyrics.length === 0) return;
  const cur = getCurrentTime();
  const pastLines = currentSong.lyrics.filter(l => l.time < cur - 0.5);
  if (pastLines.length > 0) {
    const prevLine = pastLines[pastLines.length - 1];
    seekToTime(prevLine.time);
  } else {
    seekToTime(0);
  }
}

function seekToTime(time) {
  if (!currentSong) return;
  const maxDur = parseFloat(timelineSlider.max) || 0;
  const targetTime = Math.max(0, Math.min(maxDur > 0 ? maxDur : time, time));

  pauseTime = targetTime;
  timelineSlider.value = targetTime;
  if (timeDisplay) timeDisplay.innerText = formatTimeDisplay(targetTime, maxDur);
  updateLyricsCounter(targetTime);

  socket.emit('player_command', { command: 'seek', time: targetTime });

  if (currentState.isPlaying && (sources.leadVoc || sources.inst || sources.backVoc)) {
    playAudio(targetTime);
  }
}

prevLineBtn.addEventListener('click', jumpToPrevLine);
nextLineBtn.addEventListener('click', jumpToNextLine);

timelineSlider.addEventListener('input', (e) => {
  isDraggingSlider = true;
  const target = parseFloat(e.target.value);
  if (currentState.isPlaying) {
    audioStartTime = audioCtx.currentTime - target;
  }
  pauseTime = target;
  if (timeDisplay) timeDisplay.innerText = formatTimeDisplay(target, parseFloat(timelineSlider.max) || 0);
  updateLyricsCounter(target);
});

timelineSlider.addEventListener('change', (e) => {
  isDraggingSlider = false;
  const target = parseFloat(e.target.value);
  seekToTime(target);
});

// Dual Link Icon Toggle Button Handlers (Off by default)
if (linkInstBackBtn) {
  linkInstBackBtn.addEventListener('click', () => {
    isInstBackLinked = !isInstBackLinked;
    linkInstBackBtn.innerText = isInstBackLinked ? '🔗' : '🔓';
    linkInstBackBtn.style.opacity = isInstBackLinked ? '1' : '0.4';
    linkInstBackBtn.title = isInstBackLinked ? 'Linked Inst & Back (Click to Unlink)' : 'Unlinked Inst & Back (Click to Link)';
  });
}

if (linkBackLeadBtn) {
  linkBackLeadBtn.addEventListener('click', () => {
    isBackLeadLinked = !isBackLeadLinked;
    linkBackLeadBtn.innerText = isBackLeadLinked ? '🔗' : '🔓';
    linkBackLeadBtn.style.opacity = isBackLeadLinked ? '1' : '0.4';
    linkBackLeadBtn.title = isBackLeadLinked ? 'Linked Back & Lead (Click to Unlink)' : 'Unlinked Back & Lead (Click to Link)';
  });
}

function updateFaderTrackFill(input) {
  if (!input) return;
  const val = parseFloat(input.value) || 0;
  const max = parseFloat(input.max) || 1;
  const min = parseFloat(input.min) || 0;
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  input.style.background = `linear-gradient(to top, var(--accent, #6366f1) ${pct}%, #ffffff ${pct}%)`;
  input.style.backgroundClip = 'content-box';
}

function updateAllFaderTrackFills() {
  updateFaderTrackFill(volInst);
  updateFaderTrackFill(volBackVoc);
  updateFaderTrackFill(volLeadVoc);
}

// Stem Volumes & Dual Linking
volInst.addEventListener('input', (e) => {
  const val = e.target.value;
  if (gainNodes.inst) gainNodes.inst.gain.value = val;
  
  if (isInstBackLinked) {
    volBackVoc.value = val;
    if (gainNodes.backVoc) gainNodes.backVoc.gain.value = val;
    if (isBackLeadLinked) {
      volLeadVoc.value = val;
      if (gainNodes.leadVoc) gainNodes.leadVoc.gain.value = val;
    }
  }
  updateAllFaderTrackFills();
  socket.emit('update_state', { 
    volumes: { 
      ...currentState.volumes, 
      instrumentals: volInst.value, 
      back: volBackVoc.value,
      lead: volLeadVoc.value
    } 
  });
});

volBackVoc.addEventListener('input', (e) => {
  const val = e.target.value;
  if (gainNodes.backVoc) gainNodes.backVoc.gain.value = val;
  
  if (isInstBackLinked) {
    volInst.value = val;
    if (gainNodes.inst) gainNodes.inst.gain.value = val;
  }
  if (isBackLeadLinked) {
    volLeadVoc.value = val;
    if (gainNodes.leadVoc) gainNodes.leadVoc.gain.value = val;
  }
  updateAllFaderTrackFills();
  socket.emit('update_state', { 
    volumes: { 
      ...currentState.volumes, 
      instrumentals: volInst.value, 
      back: volBackVoc.value,
      lead: volLeadVoc.value
    } 
  });
});

volLeadVoc.addEventListener('input', (e) => {
  const val = e.target.value;
  if (gainNodes.leadVoc) gainNodes.leadVoc.gain.value = val;
  
  if (isBackLeadLinked) {
    volBackVoc.value = val;
    if (gainNodes.backVoc) gainNodes.backVoc.gain.value = val;
    if (isInstBackLinked) {
      volInst.value = val;
      if (gainNodes.inst) gainNodes.inst.gain.value = val;
    }
  }
  updateAllFaderTrackFills();
  socket.emit('update_state', { 
    volumes: { 
      ...currentState.volumes, 
      instrumentals: volInst.value, 
      back: volBackVoc.value,
      lead: volLeadVoc.value
    } 
  });
});

updateAllFaderTrackFills();

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  
  // Space: Toggle Play/Pause
  if (e.code === 'Space') {
    e.preventDefault();
    if (e.target && typeof e.target.blur === 'function') {
      e.target.blur();
    }
    togglePlayPause();
    return;
  }

  // Shift + < / > : Prev / Next Song
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

  // < / > without Shift : Prev / Next Lyric Line
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

  // ArrowLeft / ArrowRight : Jump playback by 5 seconds
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    const cur = getCurrentTime();
    seekToTime(Math.max(0, cur - 5));
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    const cur = getCurrentTime();
    const maxDur = parseFloat(timelineSlider.max) || 0;
    seekToTime(Math.min(maxDur, cur + 5));
    return;
  }

  // Stem Volume Shortcuts: Q/A (Inst), W/S (Back), E/D (Lead)
  const step = 0.05;
  if (e.key === 'q') {
    volInst.value = Math.min(1, parseFloat(volInst.value) + step);
    volInst.dispatchEvent(new Event('input'));
  }
  if (e.key === 'a') {
    volInst.value = Math.max(0, parseFloat(volInst.value) - step);
    volInst.dispatchEvent(new Event('input'));
  }
  if (e.key === 'w') {
    volBackVoc.value = Math.min(1, parseFloat(volBackVoc.value) + step);
    volBackVoc.dispatchEvent(new Event('input'));
  }
  if (e.key === 's') {
    volBackVoc.value = Math.max(0, parseFloat(volBackVoc.value) - step);
    volBackVoc.dispatchEvent(new Event('input'));
  }
  if (e.key === 'e') {
    volLeadVoc.value = Math.min(1, parseFloat(volLeadVoc.value) + step);
    volLeadVoc.dispatchEvent(new Event('input'));
  }
  if (e.key === 'd') {
    volLeadVoc.value = Math.max(0, parseFloat(volLeadVoc.value) - step);
    volLeadVoc.dispatchEvent(new Event('input'));
  }
});

// APIs & Render Functions
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderEmojiStatusesHtml(song) {
  let downloadBadge = '';
  let splitBadge = '';
  let lyricsBadge = '';

  const hasAudio = (song.stems && (song.stems.inst || song.stems.lead)) || song.status === 'splitting' || song.status === 'fetching_lyrics' || song.status === 'ready';
  const hasSplitStems = (song.stems && song.stems.inst && song.stems.lead && song.stems.inst !== song.stems.lead) || song.status === 'fetching_lyrics' || song.status === 'ready';
  const hasLyricsLoaded = (song.lyrics && song.lyrics.length > 0) || song.hasLyrics === true;

  // 1. Download Status (Aspect: ⬇️, Phase: ⏳ | ⚙️ | ✅ | ❌)
  if (song.status === 'downloading') {
    downloadBadge = `<span class="emoji-badge" title="Downloading audio...">⚙️⬇️</span>`;
  } else if (hasAudio || song.status === 'ready') {
    downloadBadge = `<span class="emoji-badge" title="Audio Downloaded">✅⬇️</span>`;
  } else if (song.downloadError || song.status === 'error') {
    downloadBadge = `<span class="emoji-badge" title="Download Error: ${escapeHtml(song.downloadError || 'Failed')}">❌⬇️</span>`;
  } else {
    downloadBadge = `<span class="emoji-badge" title="Waiting to download audio...">⏳⬇️</span>`;
  }

  // 2. Split Status (Aspect: ✂️, Phase: ⏳ | ⚙️ | ✅ | ❌)
  if (song.status === 'splitting') {
    splitBadge = `<span class="emoji-badge" title="Splitting vocal and instrumental stems...">⚙️✂️</span>`;
  } else if (hasSplitStems || song.status === 'ready') {
    splitBadge = `<span class="emoji-badge" title="Stems Separated">✅✂️</span>`;
  } else if (song.splitError || song.status === 'error') {
    splitBadge = `<span class="emoji-badge" title="Stem Split Error: ${escapeHtml(song.splitError || 'Failed')}">❌✂️</span>`;
  } else {
    splitBadge = `<span class="emoji-badge" title="Waiting to split stems...">⏳✂️</span>`;
  }

  // 3. Lyrics Status (Aspect: 🎼, Phase: ⏳ | ⚙️ | ✅ | ❌)
  if (song.status === 'fetching_lyrics' || song.lyricsStatus) {
    lyricsBadge = `<span class="emoji-badge" title="Fetching Lyrics: ${escapeHtml(song.lyricsStatus || 'Searching...')}">⚙️🎼</span>`;
  } else if (hasLyricsLoaded) {
    const prov = song.lyricsProvider ? ` (${song.lyricsProvider})` : '';
    lyricsBadge = `<span class="emoji-badge" title="Lyrics Loaded${escapeHtml(prov)}">✅🎼</span>`;
  } else if (song.lyricsError || (song.status === 'ready' && !hasLyricsLoaded)) {
    lyricsBadge = `<span class="emoji-badge" title="Lyrics Error: ${escapeHtml(song.lyricsError || 'No lyrics found')}">❌🎼</span>`;
  } else {
    lyricsBadge = `<span class="emoji-badge" title="Waiting to fetch lyrics...">⏳🎼</span>`;
  }

  return `
    <div class="emoji-badges-row">
      ${downloadBadge}
      ${splitBadge}
      ${lyricsBadge}
    </div>
  `;
}

async function fetchLibrary() {
  try {
    const res = await fetch('/api/history');
    rawLibraryData = await res.json();
    renderLibrary();
  } catch (err) {
    const container = libraryList || historyList;
    if (container) {
      container.innerHTML = '<div class="error-state">⚠️ Connection error. <button class="btn" onclick="fetchLibrary()" style="padding:0.2rem 0.5rem; font-size:0.7rem;">Retry</button></div>';
    }
  }
}

function renderLibrary() {
  const container = libraryList || historyList;
  if (!container) return;
  if (!rawLibraryData || rawLibraryData.length === 0) {
    container.innerHTML = '<div class="empty-state">No songs in library yet. Use search to add songs!</div>';
    return;
  }

  let filtered = rawLibraryData.filter(song => {
    if (!libraryFilterQuery) return true;
    const titleMatch = (song.title || '').toLowerCase().includes(libraryFilterQuery);
    const artistMatch = (song.artist || '').toLowerCase().includes(libraryFilterQuery);
    return titleMatch || artistMatch;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">No library items match "${escapeHtml(libraryFilterQuery)}".</div>`;
    return;
  }

  // Sort
  filtered.sort((a, b) => {
    let cmp = 0;
    if (librarySortKey === 'title') {
      cmp = (a.title || '').localeCompare(b.title || '');
    } else if (librarySortKey === 'artist') {
      cmp = (a.artist || '').localeCompare(b.artist || '');
    } else if (librarySortKey === 'missing') {
      const aMissing = (a.status === 'error' || a.downloadError || a.splitError || a.lyricsError || !a.hasLyrics) ? 1 : 0;
      const bMissing = (b.status === 'error' || b.downloadError || b.splitError || b.lyricsError || !b.hasLyrics) ? 1 : 0;
      cmp = bMissing - aMissing;
    } else {
      // Date added (preserve array order)
      const aIdx = rawLibraryData.indexOf(a);
      const bIdx = rawLibraryData.indexOf(b);
      cmp = aIdx - bIdx;
    }
    return librarySortOrder === 'desc' ? -cmp : cmp;
  });

  container.innerHTML = filtered.map(song => {
    const isActive = currentSong && currentSong.id === song.id;
    return `
      <div class="song-card ${isActive ? 'active-playing' : ''}">
        <!-- Row 1: Song Info -->
        <div style="display:flex; align-items:center; gap: 0.75rem;">
          <img src="${escapeHtml(song.albumArt)}" alt="art" onerror="this.onerror=null; this.src='https://via.placeholder.com/44/1e2235/ffffff?text=🎵';">
          <div class="song-info">
            <div class="song-title">${escapeHtml(song.title)} ${isActive ? '<span style="font-size:0.7rem; color:var(--accent); margin-left:0.3rem;">▶ Playing</span>' : ''}</div>
            <div class="song-artist">${escapeHtml(song.artist)}</div>
          </div>
        </div>
        <!-- Row 2: Status Emojis Only -->
        ${renderEmojiStatusesHtml(song)}
        <!-- Row 3: Action Buttons (Emojis Only) -->
        <div class="emoji-btn-group">
          <button class="emoji-btn emoji-btn-accent" onclick="enqueueSong('${song.id}')" title="Add to Queue">➕</button>
          <button class="emoji-btn" onclick="openFolder('${song.id}')" title="Open Folder">📁</button>
          <button class="emoji-btn" onclick="openComponentManagerModal('${song.id}')" title="Component Status & Retry">📝</button>
          <button class="emoji-btn" onclick="openSongSourceLink('${song.id}')" title="Open Song Source (Spotify / YouTube)">🔗</button>
          <button class="emoji-btn emoji-btn-danger" onclick="confirmRemoveFromLibrary('${song.id}')" title="Delete from Library">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

window.openSongSourceLink = (id) => {
  const song = (rawLibraryData || []).find(s => s.id === id) || (currentSong && currentSong.id === id ? currentSong : null);
  if (!song) return;
  if (song.spotifyUrl) {
    window.open(song.spotifyUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  const query = `${song.title || ''} ${song.artist || ''}`.trim();
  let url;
  if (song.isUploaded || song.downloadMethod === 'Uploaded') {
    url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  } else if (song.downloadMethod && song.downloadMethod.toLowerCase().includes('yt-dlp')) {
    url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  } else {
    url = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
};

async function fetchQueue() {
  try {
    const res = await fetch('/api/queue');
    const data = await res.json();
    renderQueue(data);
  } catch (err) {
    queueList.innerHTML = '<div class="error-state">⚠️ Connection error. <button class="btn" onclick="fetchQueue()" style="padding:0.2rem 0.5rem; font-size:0.7rem;">Retry</button></div>';
  }
}

function renderQueue(data) {
  if (!data || data.length === 0) {
    queueList.innerHTML = '<div class="empty-state">No songs in queue. Use the search bar above to add a track!</div>';
    if (currentSong) {
      clearCurrentSong();
    }
    return;
  }

  const readySongs = (data || []).filter(s => s.status === 'ready');
  if (currentSong && !readySongs.some(s => s.id === currentSong.id)) {
    if (readySongs.length > 0) {
      selectSong(readySongs[0].id, false);
    } else {
      clearCurrentSong();
    }
  }

  queueList.innerHTML = data.map((song, idx) => {
    const isActive = currentSong && currentSong.id === song.id;
    const isProcessing = song.status !== 'ready';
    return `
      <div class="song-card queue-card ${isActive ? 'active-playing' : ''} ${isProcessing ? 'queue-card-processing' : ''}" 
           draggable="true" 
           data-index="${idx}"
           data-id="${song.id}"
           onclick="handleQueueCardClick('${song.id}', event)">
        <!-- Row 1: Song Info & Queue Management Icons -->
        <div style="display:flex; align-items:center; justify-content:space-between; gap: 0.5rem; width: 100%;">
          <div style="display:flex; align-items:center; gap: 0.6rem; flex: 1; min-width: 0;">
            <span class="queue-drag-handle" title="Drag to reorder">☰</span>
            <img src="${escapeHtml(song.albumArt)}" alt="art" onerror="this.onerror=null; this.src='https://via.placeholder.com/44/1e2235/ffffff?text=🎵';">
            <div class="song-info">
              <div class="song-title">${escapeHtml(song.title)} ${isActive ? '<span style="font-size:0.7rem; color:var(--accent); margin-left:0.3rem;">▶ Playing</span>' : ''} ${isProcessing ? '<span style="font-size:0.7rem; color:#fbbf24; margin-left:0.3rem;">⏳ Processing</span>' : ''}</div>
              <div class="song-artist">${escapeHtml(song.artist)}</div>
            </div>
          </div>

          <!-- Queue Management Controls (Icons Only) -->
          <div class="queue-controls-group" onclick="event.stopPropagation();">
            <button class="queue-icon-btn" onclick="reorderQueueItem('${song.id}', 'up', event)" title="Move Up" ${idx === 0 ? 'disabled style="opacity:0.3;"' : ''}>⬆️</button>
            <button class="queue-icon-btn" onclick="reorderQueueItem('${song.id}', 'down', event)" title="Move Down" ${idx === data.length - 1 ? 'disabled style="opacity:0.3;"' : ''}>⬇️</button>
            <button class="queue-icon-btn" onclick="removeFromQueue('${song.id}', event)" title="Remove from Queue">❌</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  setupQueueDragAndDrop();
}

window.handleQueueCardClick = (songId, event) => {
  if (event.target.closest('.queue-controls-group') || event.target.closest('.queue-drag-handle')) {
    return;
  }
  selectSong(songId, true);
};

window.reorderQueueItem = async (songId, direction, event) => {
  if (event) event.stopPropagation();
  await fetch('/api/queue/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, direction })
  });
  fetchQueue();
};

function setupQueueDragAndDrop() {
  const cards = queueList.querySelectorAll('.queue-card');
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedQueueIndex = parseInt(card.dataset.index);
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetIndex = parseInt(card.dataset.index);
      if (draggedQueueIndex !== null && draggedQueueIndex !== targetIndex) {
        await fetch('/api/queue/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromIndex: draggedQueueIndex, toIndex: targetIndex })
        });
        fetchQueue();
      }
    });
  });
}

// Attach Library Filter & Sort Listeners
if (libraryFilterInput) {
  libraryFilterInput.addEventListener('input', (e) => {
    libraryFilterQuery = e.target.value.trim().toLowerCase();
    renderLibrary();
  });
}

if (librarySortBtn && librarySortMenu) {
  librarySortBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = librarySortMenu.style.display === 'none';
    librarySortMenu.style.display = isHidden ? 'flex' : 'none';
  });

  document.addEventListener('click', (e) => {
    if (librarySortMenu && !librarySortMenu.contains(e.target) && e.target !== librarySortBtn) {
      librarySortMenu.style.display = 'none';
    }
  });

  const sortOptionBtns = librarySortMenu.querySelectorAll('.sort-option');
  sortOptionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sortOptionBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      librarySortKey = btn.dataset.key;
      renderLibrary();
    });
  });

  const sortOrderBtns = librarySortMenu.querySelectorAll('.sort-order-btn');
  sortOrderBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sortOrderBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      librarySortOrder = btn.dataset.order;
      renderLibrary();
    });
  });
}

window.fetchLibrary = fetchLibrary;
window.fetchHistory = fetchLibrary;
window.fetchQueue = fetchQueue;

// Search Functionality & Popup Hide Behavior
let searchDebounceTimeout = null;

async function executeSearch() {
  const q = searchInput.value.trim();
  if (!q) {
    searchResults.style.display = 'none';
    return;
  }

  const isSpotifyLink = q.includes('spotify.com') || q.includes('spotify.link') || q.startsWith('spotify:track:');
  searchResults.style.display = 'flex';
  searchResults.innerHTML = `
    <div style="padding: 0.75rem; text-align: center; color: var(--text-secondary); font-size: 0.85rem; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
      <span>${isSpotifyLink ? '🟢 Fetching Spotify Track...' : '🔍 Searching songs...'}</span>
    </div>
  `;

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query: q})
    });
    const data = await res.json();
    if (data && data.length > 0) {
      searchResults.style.display = 'flex';
      searchResults.innerHTML = '';
      data.forEach(song => {
        const card = document.createElement('div');
        card.className = 'song-card search-card';
        card.tabIndex = 0;
        card.style.outline = 'none';

        const artImg = document.createElement('img');
        artImg.src = song.albumArt || '';
        artImg.alt = 'art';
        artImg.onerror = () => { artImg.onerror = null; artImg.src = 'https://via.placeholder.com/44/1e2235/ffffff?text=🎵'; };

        const infoDiv = document.createElement('div');
        infoDiv.className = 'song-info';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'song-title';
        titleDiv.textContent = song.title || 'Unknown Title';
        if (song.isSpotify || song.spotifyUrl) {
          const badge = document.createElement('span');
          badge.className = 'spotify-badge';
          badge.title = 'Spotify Direct Track';
          badge.textContent = '🟢 Spotify';
          titleDiv.appendChild(badge);
        }

        const artistDiv = document.createElement('div');
        artistDiv.className = 'song-artist';
        artistDiv.textContent = song.artist || 'Unknown Artist';

        infoDiv.appendChild(titleDiv);
        infoDiv.appendChild(artistDiv);

        const queueBtn = document.createElement('button');
        queueBtn.className = 'btn';
        queueBtn.textContent = 'Queue';
        queueBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          enqueueNewSong(song);
        });

        card.appendChild(artImg);
        card.appendChild(infoDiv);
        card.appendChild(queueBtn);

        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            enqueueNewSong(song);
          }
        });

        searchResults.appendChild(card);
      });
    } else {
      searchResults.innerHTML = '<div style="padding:0.75rem; text-align:center; color:var(--text-secondary); font-size:0.85rem;">No tracks found</div>';
    }
  } catch (err) {
    searchResults.innerHTML = `<div style="padding:0.75rem; text-align:center; color:#f87171; font-size:0.85rem;">⚠️ Search failed: ${escapeHtml(err.message)}</div>`;
  }
}

searchBtn.addEventListener('click', executeSearch);

searchInput.addEventListener('input', (e) => {
  const val = e.target.value.trim();
  if (!val) {
    searchResults.style.display = 'none';
    return;
  }
  // If user pasted or typed a Spotify URL, auto-trigger search
  if (val.includes('spotify.com') || val.includes('spotify.link') || val.startsWith('spotify:track:')) {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      executeSearch();
    }, 250);
  }
});

searchInput.addEventListener('paste', () => {
  setTimeout(() => {
    const val = searchInput.value.trim();
    if (val.includes('spotify.com') || val.includes('spotify.link') || val.startsWith('spotify:track:')) {
      executeSearch();
    }
  }, 50);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    executeSearch();
  } else if (e.key === 'ArrowDown') {
    const firstCard = searchResults.querySelector('.search-card');
    if (firstCard) firstCard.focus();
  }
});

document.addEventListener('click', (e) => {
  if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
    searchResults.style.display = 'none';
  }
});

// Engine Settings Panel Logic
const engineSettingsToggleBtn = document.getElementById('engineSettingsToggleBtn');
const engineSettingsPanel = document.getElementById('engineSettingsPanel');
const engineBadgeText = document.getElementById('engineBadgeText');
const customEngineToggle = document.getElementById('customEngineToggle');
const engineControls = document.getElementById('engineControls');
const engineModeSelect = document.getElementById('engineModeSelect');
const engineFormatSelect = document.getElementById('engineFormatSelect');
const engineBitrateSelect = document.getElementById('engineBitrateSelect');

let engineSettings = {
  mode: 'balanced',
  format: 'MP3',
  bitrate: '192k',
  isCustom: false
};

function updateEngineUI() {
  if (!customEngineToggle) return;
  const isCustom = customEngineToggle.checked;
  engineSettings.isCustom = isCustom;
  engineSettings.mode = engineModeSelect.value;
  engineSettings.format = engineFormatSelect.value;
  engineSettings.bitrate = engineBitrateSelect.value;

  if (isCustom) {
    engineControls.style.opacity = '1';
    engineControls.style.pointerEvents = 'auto';
    engineBadgeText.innerText = `Custom (${engineSettings.mode}, ${engineSettings.format} ${engineSettings.bitrate})`;
  } else {
    engineControls.style.opacity = '0.5';
    engineControls.style.pointerEvents = 'none';
    engineBadgeText.innerText = `Balanced (MP3 192k)`;
  }
}

if (engineSettingsToggleBtn) {
  engineSettingsToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const show = engineSettingsPanel.style.display === 'none';
    engineSettingsPanel.style.display = show ? 'block' : 'none';
  });
}

if (customEngineToggle) customEngineToggle.addEventListener('change', updateEngineUI);
if (engineModeSelect) engineModeSelect.addEventListener('change', updateEngineUI);
if (engineFormatSelect) engineFormatSelect.addEventListener('change', updateEngineUI);
if (engineBitrateSelect) engineBitrateSelect.addEventListener('change', updateEngineUI);

// --- Upload Song Modal Logic ---
const uploadSongBtn = document.getElementById('uploadSongBtn');
const uploadSongModal = document.getElementById('uploadSongModal');
const closeUploadModalBtn = document.getElementById('closeUploadModalBtn');
const cancelUploadBtn = document.getElementById('cancelUploadBtn');
const submitUploadBtn = document.getElementById('submitUploadBtn');
const uploadDropZone = document.getElementById('uploadDropZone');
const songFileInput = document.getElementById('songFileInput');
const uploadFileInfo = document.getElementById('uploadFileInfo');
const uploadFileName = document.getElementById('uploadFileName');
const uploadFileSize = document.getElementById('uploadFileSize');
const clearSelectedFileBtn = document.getElementById('clearSelectedFileBtn');
const uploadSongTitle = document.getElementById('uploadSongTitle');
const uploadSongArtist = document.getElementById('uploadSongArtist');
const uploadEngineSummaryBadge = document.getElementById('uploadEngineSummaryBadge');
const uploadEngineModeSelect = document.getElementById('uploadEngineModeSelect');
const uploadProgressBarContainer = document.getElementById('uploadProgressBarContainer');
const uploadProgressBar = document.getElementById('uploadProgressBar');
const uploadProgressText = document.getElementById('uploadProgressText');
const uploadProgressStatus = document.getElementById('uploadProgressStatus');
const uploadErrorMsg = document.getElementById('uploadErrorMsg');

const uploadCoverPreview = document.getElementById('uploadCoverPreview');
const uploadTagNotice = document.getElementById('uploadTagNotice');

let selectedUploadFile = null;
let currentPreviewBlobUrl = null;

function decodeId3Text(data) {
  if (!data || data.length <= 1) return '';
  const encoding = data[0];
  const bytes = data.subarray(1);
  try {
    if (encoding === 0) { // ISO-8859-1
      return new TextDecoder('latin1').decode(bytes).replace(/\0.*$/g, '').trim();
    } else if (encoding === 1 || encoding === 2) { // UTF-16
      return new TextDecoder('utf-16').decode(bytes).replace(/\0.*$/g, '').trim();
    } else if (encoding === 3) { // UTF-8
      return new TextDecoder('utf-8').decode(bytes).replace(/\0.*$/g, '').trim();
    }
  } catch (e) {}
  return '';
}

function parseApicFrame(data) {
  if (!data || data.length < 10) return null;
  const encoding = data[0];
  let offset = 1;
  let mimeEnd = offset;
  while (mimeEnd < data.length && data[mimeEnd] !== 0) mimeEnd++;
  const mimeType = new TextDecoder('latin1').decode(data.subarray(offset, mimeEnd)) || 'image/jpeg';
  offset = mimeEnd + 1;
  if (offset >= data.length) return null;
  offset += 1; // Skip picture type byte
  if (encoding === 1 || encoding === 2) {
    while (offset + 1 < data.length && !(data[offset] === 0 && data[offset+1] === 0)) offset += 2;
    offset += 2;
  } else {
    while (offset < data.length && data[offset] !== 0) offset++;
    offset += 1;
  }
  if (offset >= data.length) return null;
  const imgData = data.subarray(offset);
  const blob = new Blob([imgData], { type: mimeType });
  return URL.createObjectURL(blob);
}

function extractClientAudioTags(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    const slice = file.slice(0, Math.min(file.size, 1024 * 1024));
    reader.onload = function(e) {
      try {
        const buffer = new Uint8Array(e.target.result);
        let title = '';
        let artist = '';
        let coverUrl = null;

        if (buffer.length > 10 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
          const version = buffer[3];
          const tagSize = ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);
          const maxOffset = Math.min(buffer.length, tagSize + 10);
          let offset = 10;

          while (offset + 10 < maxOffset) {
            const frameId = String.fromCharCode(buffer[offset], buffer[offset+1], buffer[offset+2], buffer[offset+3]);
            if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

            let frameSize = 0;
            if (version === 4) {
              frameSize = ((buffer[offset+4] & 0x7f) << 21) | ((buffer[offset+5] & 0x7f) << 14) | ((buffer[offset+6] & 0x7f) << 7) | (buffer[offset+7] & 0x7f);
            } else {
              frameSize = (buffer[offset+4] << 24) | (buffer[offset+5] << 16) | (buffer[offset+6] << 8) | buffer[offset+7];
            }

            if (frameSize <= 0 || offset + 10 + frameSize > buffer.length) break;

            const frameData = buffer.subarray(offset + 10, offset + 10 + frameSize);

            if (frameId === 'TIT2' && !title) {
              title = decodeId3Text(frameData);
            } else if (frameId === 'TPE1' && !artist) {
              artist = decodeId3Text(frameData);
            } else if (frameId === 'APIC' && !coverUrl) {
              coverUrl = parseApicFrame(frameData);
            }

            offset += 10 + frameSize;
          }
        }

        resolve({ title, artist, coverUrl });
      } catch (err) {
        resolve({ title: '', artist: '', coverUrl: null });
      }
    };
    reader.onerror = () => resolve({ title: '', artist: '', coverUrl: null });
    reader.readAsArrayBuffer(slice);
  });
}

function parseFilenameForMetadata(filename) {
  if (!filename) return { title: '', artist: '' };
  // Remove file extension
  const cleanName = filename.replace(/\.[^/.]+$/, '').trim();
  
  // Clean tags like [Official Audio], (Lyrics), etc.
  const strippedTags = cleanName.replace(/\s*[\(\[](?:official\s*(?:audio|video|music\s*video|lyric\s*video|lyrics)?|hq|hd|320kbps|remastered|flac|wav|mp3)[\)\]]\s*/gi, ' ').trim();
  
  let artist = '';
  let title = strippedTags;

  if (strippedTags.includes(' - ')) {
    const parts = strippedTags.split(' - ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' - ').trim();
  } else if (strippedTags.includes(' _ ')) {
    const parts = strippedTags.split(' _ ');
    artist = parts[0].trim();
    title = parts.slice(1).join(' _ ').trim();
  }

  // Replace remaining underscores with spaces if no hyphens were found
  title = title.replace(/_/g, ' ').trim();
  artist = artist.replace(/_/g, ' ').trim();

  return { title, artist };
}

function updateUploadEngineBadge() {
  if (!uploadEngineModeSelect || !uploadEngineSummaryBadge) return;
  const mode = uploadEngineModeSelect.value;
  const modeLabels = {
    balanced: '⚖️ Balanced (~30s)',
    fast: '⚡ Fast (~10s)',
    high: '🎯 High Precision (~60s)',
    ultra: '👑 Ultra Quality (~2m)'
  };
  uploadEngineSummaryBadge.innerText = modeLabels[mode] || mode;
}

async function handleSelectedFile(file) {
  if (!file) return;
  selectedUploadFile = file;
  
  if (uploadFileName) uploadFileName.innerText = file.name;
  if (uploadFileSize) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    uploadFileSize.innerText = `(${sizeMb} MB)`;
  }
  
  if (uploadFileInfo) uploadFileInfo.style.display = 'block';
  if (uploadDropZone) uploadDropZone.style.display = 'none';
  if (uploadErrorMsg) uploadErrorMsg.style.display = 'none';
  
  const parsed = parseFilenameForMetadata(file.name);
  let resolvedTitle = parsed.title;
  let resolvedArtist = parsed.artist || '';

  // Attempt client-side ID3 tag extraction for instant cover art & metadata preview
  try {
    const id3 = await extractClientAudioTags(file);
    if (id3.title) resolvedTitle = id3.title;
    if (id3.artist) resolvedArtist = id3.artist;

    if (id3.coverUrl) {
      if (currentPreviewBlobUrl) URL.revokeObjectURL(currentPreviewBlobUrl);
      currentPreviewBlobUrl = id3.coverUrl;
      if (uploadCoverPreview) uploadCoverPreview.src = id3.coverUrl;
      if (uploadTagNotice) {
        uploadTagNotice.innerText = '✨ Embedded cover & ID3 tags detected';
        uploadTagNotice.style.display = 'block';
      }
    } else {
      if (uploadCoverPreview) uploadCoverPreview.src = '/ctrlaltlyrics-logo.webp';
      if (uploadTagNotice) {
        uploadTagNotice.innerText = '🎵 Audio file loaded';
        uploadTagNotice.style.display = 'block';
      }
    }
  } catch (err) {
    if (uploadCoverPreview) uploadCoverPreview.src = '/ctrlaltlyrics-logo.webp';
  }

  if (uploadSongTitle) {
    uploadSongTitle.value = resolvedTitle;
  }
  if (uploadSongArtist) {
    uploadSongArtist.value = resolvedArtist || 'Unknown Artist';
  }

  if (submitUploadBtn) submitUploadBtn.disabled = false;
}

function resetUploadModalState() {
  selectedUploadFile = null;
  if (currentPreviewBlobUrl) {
    URL.revokeObjectURL(currentPreviewBlobUrl);
    currentPreviewBlobUrl = null;
  }
  if (uploadCoverPreview) uploadCoverPreview.src = '/ctrlaltlyrics-logo.webp';
  if (uploadTagNotice) uploadTagNotice.style.display = 'none';
  if (songFileInput) songFileInput.value = '';
  if (uploadSongTitle) uploadSongTitle.value = '';
  if (uploadSongArtist) uploadSongArtist.value = '';
  if (uploadFileInfo) uploadFileInfo.style.display = 'none';
  if (uploadDropZone) {
    uploadDropZone.style.display = 'block';
    uploadDropZone.classList.remove('dragover');
  }
  if (uploadProgressBarContainer) uploadProgressBarContainer.style.display = 'none';
  if (uploadProgressBar) uploadProgressBar.style.width = '0%';
  if (uploadErrorMsg) {
    uploadErrorMsg.innerText = '';
    uploadErrorMsg.style.display = 'none';
  }
  if (submitUploadBtn) {
    submitUploadBtn.disabled = true;
    submitUploadBtn.innerText = 'Upload & Process';
  }
  if (uploadEngineModeSelect) {
    uploadEngineModeSelect.value = (engineSettings && engineSettings.mode) || 'balanced';
    updateUploadEngineBadge();
  }
}

function openUploadModal() {
  resetUploadModalState();
  if (uploadSongModal) uploadSongModal.style.display = 'flex';
}

function closeUploadModal() {
  if (uploadSongModal) uploadSongModal.style.display = 'none';
  resetUploadModalState();
}

if (uploadSongBtn) uploadSongBtn.addEventListener('click', openUploadModal);
if (closeUploadModalBtn) closeUploadModalBtn.addEventListener('click', closeUploadModal);
if (cancelUploadBtn) cancelUploadBtn.addEventListener('click', closeUploadModal);

if (uploadDropZone) {
  uploadDropZone.addEventListener('click', () => {
    if (songFileInput) songFileInput.click();
  });

  uploadDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadDropZone.classList.add('dragover');
  });

  uploadDropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadDropZone.classList.remove('dragover');
  });

  uploadDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadDropZone.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });
}

if (songFileInput) {
  songFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleSelectedFile(e.target.files[0]);
    }
  });
}

if (clearSelectedFileBtn) {
  clearSelectedFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedUploadFile = null;
    if (songFileInput) songFileInput.value = '';
    if (uploadFileInfo) uploadFileInfo.style.display = 'none';
    if (uploadDropZone) uploadDropZone.style.display = 'block';
    if (submitUploadBtn) submitUploadBtn.disabled = true;
  });
}

if (uploadEngineModeSelect) {
  uploadEngineModeSelect.addEventListener('change', updateUploadEngineBadge);
}

if (submitUploadBtn) {
  submitUploadBtn.addEventListener('click', async () => {
    if (!selectedUploadFile) return;

    const title = (uploadSongTitle && uploadSongTitle.value.trim()) || selectedUploadFile.name.replace(/\.[^/.]+$/, '').trim();
    const artist = (uploadSongArtist && uploadSongArtist.value.trim()) || 'Unknown Artist';
    const mode = (uploadEngineModeSelect && uploadEngineModeSelect.value) || 'balanced';

    const customEngine = {
      mode: mode,
      format: (engineSettings && engineSettings.format) || 'MP3',
      bitrate: (engineSettings && engineSettings.bitrate) || '192k',
      isCustom: true
    };

    const formData = new FormData();
    formData.append('audioFile', selectedUploadFile);
    formData.append('title', title);
    formData.append('artist', artist);
    formData.append('engineSettings', JSON.stringify(customEngine));

    submitUploadBtn.disabled = true;
    submitUploadBtn.innerText = 'Uploading...';
    if (uploadProgressBarContainer) uploadProgressBarContainer.style.display = 'block';
    if (uploadProgressBar) uploadProgressBar.style.width = '0%';
    if (uploadErrorMsg) uploadErrorMsg.style.display = 'none';

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload', true);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          if (uploadProgressBar) uploadProgressBar.style.width = `${percent}%`;
          if (uploadProgressText) uploadProgressText.innerText = `Uploading: ${percent}%`;
          if (percent >= 100) {
            if (uploadProgressStatus) uploadProgressStatus.innerText = 'Processing file...';
          }
        }
      };

      xhr.onload = async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const resSong = JSON.parse(xhr.responseText);
          closeUploadModal();
          await fetchQueue();
          await fetchLibrary();
        } else {
          let errText = 'Upload failed.';
          try {
            const errData = JSON.parse(xhr.responseText);
            if (errData.error) errText = errData.error;
          } catch(e){}
          if (uploadErrorMsg) {
            uploadErrorMsg.innerText = `⚠️ ${errText}`;
            uploadErrorMsg.style.display = 'block';
          }
          submitUploadBtn.disabled = false;
          submitUploadBtn.innerText = 'Upload & Process';
        }
      };

      xhr.onerror = () => {
        if (uploadErrorMsg) {
          uploadErrorMsg.innerText = '⚠️ Network error during upload.';
          uploadErrorMsg.style.display = 'block';
        }
        submitUploadBtn.disabled = false;
        submitUploadBtn.innerText = 'Upload & Process';
      };

      xhr.send(formData);

    } catch (err) {
      if (uploadErrorMsg) {
        uploadErrorMsg.innerText = `⚠️ ${err.message || 'Upload error'}`;
        uploadErrorMsg.style.display = 'block';
      }
      submitUploadBtn.disabled = false;
      submitUploadBtn.innerText = 'Upload & Process';
    }
  });
}

window.enqueueNewSong = async (song) => {
  searchResults.style.display = 'none';
  searchInput.value = '';
  const payloadSettings = engineSettings.isCustom ? engineSettings : { mode: 'balanced', format: 'MP3', bitrate: '192k', isCustom: false };
  await fetch('/api/enqueue', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      song,
      engineSettings: payloadSettings
    })
  });
};

window.enqueueSong = async (id) => {
  try {
    const res = await fetch(`/api/song/${id}`);
    if (res.ok) {
      const song = await res.json();
      await window.enqueueNewSong(song);
    }
  } catch (e) {
    console.error("Error enqueuing song:", e);
  }
};

window.selectSong = async (id, forcePlay = null) => {
  try {
    const res = await fetch(`/api/song/${id}`);
    if (!res.ok) return;
    const song = await res.json();
    if (song && song.status === 'ready') {
      const shouldPlay = (forcePlay !== null) ? forcePlay : currentState.isPlaying;
      pauseAudio(); // Stop any active playing audio nodes from the previous song
      
      currentSong = song;
      isHandlingSongEnd = false;
      currentSongTitle.innerText = song.title;
      const colorSrc = song.id ? `/api/cover/${song.id}` : getHighResAlbumArt(song.albumArt);
      extractColorsFromSongCover(colorSrc);
      pauseTime = 0;
      currentState.currentTime = 0;
      currentState.isPlaying = false;
      timelineSlider.value = 0;
      timelineSlider.max = 0;
      if (timeDisplay) timeDisplay.innerText = '--:-- / --:--';
      socket.emit('update_state', { songId: song.id, currentTime: 0, isPlaying: false, songData: song });
      
      await setupAudio(song);
      updateLyricsCounter(0);
      renderLyricsEditor(song.lyrics || []);
      fetchHistory();
      fetchQueue();
      
      if (shouldPlay) {
        playAudio(0);
      }
    }
  } catch (e) {
    console.error("Error selecting song:", e);
  }
};

function clearCurrentSong() {
  stopSource(sources.leadVoc);
  stopSource(sources.backVoc);
  stopSource(sources.inst);
  sources.leadVoc = null;
  sources.backVoc = null;
  sources.inst = null;
  currentSong = null;
  extractColorsFromSongCover(null);
  pauseTime = 0;
  currentState.isPlaying = false;
  currentState.currentTime = 0;
  currentState.songId = null;
  currentState.songData = null;
  playPauseBtn.innerText = '▶';
  if (currentSongTitle) currentSongTitle.innerText = 'None';
  timelineSlider.value = 0;
  timelineSlider.max = 0;
  timelineSlider.disabled = true;
  if (timeDisplay) timeDisplay.innerText = '--:-- / --:--';
  updateLyricsCounter(0);
  renderLyricsEditor([]);
  socket.emit('update_state', { songId: null, currentTime: 0, isPlaying: false, songData: null });
}

async function handleSongFinished() {
  if (isHandlingSongEnd) return;
  isHandlingSongEnd = true;
  try {
    pauseAudio();
    
    const maxDur = parseFloat(timelineSlider.max) || 0;
    timelineSlider.value = maxDur;
    if (timeDisplay) {
      timeDisplay.innerText = formatTimeDisplay(maxDur, maxDur);
    }
    updateLyricsCounter(maxDur);

    const res = await fetch('/api/queue');
    const queueData = await res.json();
    renderQueue(queueData);
    
    const readySongs = (queueData || []).filter(s => s.status === 'ready');
    if (readySongs.length === 0) {
      clearCurrentSong();
      return;
    }

    if (!currentSong) {
      await selectSong(readySongs[0].id, true);
      return;
    }

    const idx = readySongs.findIndex(s => s.id === currentSong.id);
    if (idx !== -1 && idx < readySongs.length - 1) {
      // Autoplay next song in queue
      await selectSong(readySongs[idx + 1].id, true);
    } else {
      // Reached end of queue - reset to beginning of current track paused
      pauseTime = 0;
      currentState.currentTime = 0;
      currentState.isPlaying = false;
      timelineSlider.value = 0;
      if (timeDisplay) timeDisplay.innerText = formatTimeDisplay(0, maxDur);
      updateLyricsCounter(0);
      socket.emit('update_state', { currentTime: 0, isPlaying: false });
    }
  } catch(e) {
    console.error("Error in handleSongFinished:", e);
  } finally {
    isHandlingSongEnd = false;
  }
}

window.openFolder = (id) => {
  fetch(`/api/open_folder/${id}`, { method: 'POST' });
};

// Component Manager Modal Event Listeners
const closeCompManagerBtn = document.getElementById('closeComponentManagerBtn');
const dismissCompManagerBtn = document.getElementById('dismissComponentManagerBtn');
const compManagerModalOverlay = document.getElementById('componentManagerModal');

if (closeCompManagerBtn) closeCompManagerBtn.addEventListener('click', () => compManagerModalOverlay.style.display = 'none');
if (dismissCompManagerBtn) dismissCompManagerBtn.addEventListener('click', () => compManagerModalOverlay.style.display = 'none');
if (compManagerModalOverlay) {
  compManagerModalOverlay.addEventListener('click', (e) => {
    if (e.target === compManagerModalOverlay) compManagerModalOverlay.style.display = 'none';
  });
}

window.openComponentManagerModal = async (id) => {
  const modal = document.getElementById('componentManagerModal');
  const titleEl = document.getElementById('componentManagerTitle');
  const bodyEl = document.getElementById('componentManagerBody');
  if (!modal || !bodyEl) return;

  if (titleEl) titleEl.innerText = `📝 Component Status & Manager`;
  bodyEl.innerHTML = `<div class="empty-state">⏳ Loading component status...</div>`;
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/song_details/${id}`);
    if (!res.ok) throw new Error("Failed to load song details");
    const data = await res.json();
    renderComponentManagerModal(data.song, data.components);
  } catch (err) {
    bodyEl.innerHTML = `<div class="error-state">⚠️ Error loading song details: ${escapeHtml(err.message)}</div>`;
  }
};

function renderComponentManagerModal(song, components = {}) {
  const titleEl = document.getElementById('componentManagerTitle');
  const bodyEl = document.getElementById('componentManagerBody');
  if (!bodyEl) return;

  if (titleEl) titleEl.innerText = `📝 Component Manager: "${escapeHtml(song.title || 'Song')}"`;

  const dl = components.download || {};
  const sp = components.splitting || {};
  const ly = components.lyrics || {};

  // 1. Audio Download Card
  let dlBadge = '<span class="status-badge success">✅ Ready</span>';
  let dlDetails = `
    <div class="component-meta-list">
      <div>Source: <strong>${escapeHtml(dl.method || song.downloadMethod || 'SpotDL')}</strong></div>
      <div>File: <code class="mono-tag">${escapeHtml(dl.audioFile || 'audio.mp3')}</code></div>
    </div>
  `;
  if (dl.status === 'error' || song.downloadError) {
    dlBadge = '<span class="status-badge error">❌ Failed</span>';
    dlDetails = `<div style="color:#f87171; font-size:0.8rem;">Error: ${escapeHtml(dl.error || song.downloadError || 'Audio file missing')}</div>`;
  } else if (dl.status === 'pending' || song.status === 'downloading') {
    dlBadge = '<span class="status-badge pending">⏳ Downloading</span>';
  }

  let dlAttemptsHtml = '';
  if (dl.attempts && dl.attempts.length > 0) {
    dlAttemptsHtml = dl.attempts.map(a => {
      let icon = '❌';
      let rowClass = 'failed';
      if (a.status === 'success') { icon = '✅'; rowClass = 'success'; }
      else if (a.status === 'partial') { icon = '⚠️'; rowClass = 'partial'; }
      else if (a.status === 'skipped') { icon = '⏭️'; rowClass = 'skipped'; }
      return `
        <div class="attempt-row ${rowClass}">
          <div class="attempt-header">
            <span class="attempt-provider">${icon} ${escapeHtml(a.provider)}</span>
            <span class="attempt-badge">${escapeHtml(a.status.toUpperCase())}</span>
          </div>
          ${a.detail ? `<div class="attempt-detail">${escapeHtml(a.detail)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  // 2. Stem Separation Card
  const sepInfo = sp.separationInfo || song.separationInfo || {};
  const sepMode = sepInfo.mode || (song.engineSettings && song.engineSettings.mode) || 'balanced';
  const sepFormat = sepInfo.format || (song.engineSettings && song.engineSettings.format) || 'MP3';
  const sepBitrate = sepInfo.bitrate || (song.engineSettings && song.engineSettings.bitrate) || '192k';
  const primaryModel = sepInfo.primaryModel || (sepMode === 'fast' ? 'UVR-MDX-NET-Inst_1.onnx' : (sepMode === 'high' ? 'MDX23C-InstVoc HQ' : (sepMode === 'ultra' ? 'BS-Roformer-Viperx-1297' : 'UVR-MDX-NET-Inst_HQ_3.onnx')));
  const karaokeModel = sepInfo.karaokeModel || '5_HP-Karaoke-UVR.pth';

  const modeLabels = {
    balanced: '⚖️ Balanced (~30s)',
    fast: '⚡ Fast (~10s)',
    high: '🎯 High Precision (~60s)',
    ultra: '👑 Ultra Quality (~2m)'
  };

  let spBadge = '<span class="status-badge success">✅ 3 Stems</span>';
  let spDetails = `
    <div class="component-meta-list">
      <div>Status: <strong>${sp.isFallback || sp.status === 'fallback' ? '⚠️ Full Track Fallback' : '✅ 3 Distinct AI Stems'}</strong></div>
    </div>
    <details class="component-report-details"><summary>View Stem Details</summary>
      <div class="stem-details-grid">
        <div class="stem-detail-item">
          <span class="stem-detail-label">⚙️ Separation Mode:</span>
          <span class="stem-detail-val">${escapeHtml(modeLabels[sepMode] || sepMode)}</span>
        </div>
        <div class="stem-detail-item">
          <span class="stem-detail-label">🎵 Output Format:</span>
          <span class="stem-detail-val">${escapeHtml(sepFormat)} (${escapeHtml(sepBitrate)})</span>
        </div>
        <div class="stem-detail-item">
          <span class="stem-detail-label">🤖 Stage 1 (Vocals/Inst):</span>
          <code class="stem-detail-code">${escapeHtml(primaryModel)}</code>
        </div>
        <div class="stem-detail-item">
          <span class="stem-detail-label">🎙️ Stage 2 (Lead/Back):</span>
          <code class="stem-detail-code">${escapeHtml(karaokeModel)}</code>
        </div>
      </div>
    </details>
  `;
  if (sp.isFallback || sp.status === 'fallback') {
    spBadge = '<span class="status-badge warning">⚠️ Fallback</span>';
  } else if (sp.status === 'error' || song.splitError) {
    spBadge = '<span class="status-badge error">❌ Error</span>';
  } else if (sp.status === 'pending' || song.status === 'splitting') {
    spBadge = '<span class="status-badge pending">⏳ Splitting</span>';
  }

  // 3. Lyrics Card
  const lineCount = ly.count || (song.lyrics ? song.lyrics.length : 0);
  const isManual = (ly.provider === 'Manual Import' || song.lyricsProvider === 'Manual Import');
  let lyBadge = '<span class="status-badge success">✅ Synced</span>';
  if (isManual || song.isSynced === false || ly.isSynced === false) {
    lyBadge = '<span class="status-badge success" style="background: rgba(147, 51, 234, 0.15); color: #c084fc; border: 1px solid rgba(147, 51, 234, 0.3);">✍️ Unsynced</span>';
  }
  let lyDetails = `
    <div class="component-meta-list">
      <div>Lines: <strong>${lineCount}</strong> lines</div>
      <div>Provider: <strong>${escapeHtml(ly.provider || song.lyricsProvider || 'LRC Provider')}</strong></div>
    </div>
  `;
  
  if (!ly.hasLyrics && lineCount === 0) {
    if (ly.status === 'failed' || song.lyricsError) {
      lyBadge = '<span class="status-badge error">❌ No Lyrics</span>';
      lyDetails = `<div style="color:#f87171; font-size:0.8rem;">Error: ${escapeHtml(ly.error || song.lyricsError || 'Lyrics fetch failed across all providers')}</div>`;
    } else {
      lyBadge = '<span class="status-badge warning">⚠️ None</span>';
      lyDetails = `<div class="component-meta-list"><div>No lyrics currently loaded</div></div>`;
    }
  }

  let lyAttemptsHtml = '';
  if (ly.attempts && ly.attempts.length > 0) {
    lyAttemptsHtml = ly.attempts.map(a => {
      let icon = '❌';
      let rowClass = 'failed';
      if (a.status === 'success') { icon = '✅'; rowClass = 'success'; }
      else if (a.status === 'partial') { icon = '⚠️'; rowClass = 'partial'; }
      else if (a.status === 'skipped') { icon = '⏭️'; rowClass = 'skipped'; }
      return `
        <div class="attempt-row ${rowClass}">
          <div class="attempt-header">
            <span class="attempt-provider">${icon} ${escapeHtml(a.provider)}</span>
            <span class="attempt-badge">${escapeHtml(a.status.toUpperCase())}</span>
          </div>
          ${a.detail ? `<div class="attempt-detail">${escapeHtml(a.detail)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  window.currentManagerSong = song;

  bodyEl.innerHTML = `
    <div class="component-manager-top-menu" style="display:flex; gap:0.5rem; margin-bottom: 1rem;">
      <button class="btn btn-primary" style="flex:1; background:rgba(147, 51, 234, 0.2); border:1px solid #9333ea; color:#d8b4fe;" onclick="openMetadataModal('${song.id}')">✏️ Edit Meta-data</button>
      <button class="btn btn-primary" style="flex:1; background:rgba(59, 130, 246, 0.2); border:1px solid #3b82f6; color:#93c5fd;" onclick="openSyncEditorModal('${song.id}')">⏱️ Sync Editor</button>
    </div>

    <!-- Component 1: Audio Download -->
    <div class="component-card component-card-download">
      <div class="component-card-header">
        <div class="component-title">📥 1. Audio Download</div>
        ${dlBadge}
      </div>
      <div class="component-details">${dlDetails}</div>
      <div class="component-action-row" style="margin-top:0.5rem;">
        <select id="dlSourceSelect_${song.id}" class="select-input" style="font-size:0.8rem; padding:0.35rem 0.6rem;">
          <option value="auto" selected>Auto (SpotDL Preferred)</option>
          <option value="spotdl">SpotDL Only (Spotify Studio)</option>
          <option value="ytdlp">yt-dlp (YouTube Backup)</option>
        </select>
        <button id="retryDlBtn_${song.id}" class="btn btn-secondary" style="font-size:0.8rem; padding:0.4rem 0.8rem;" onclick="retryComponentDownload('${song.id}', this)">🔄 Retry Audio Download</button>
      </div>
      <div id="dlReportContainer_${song.id}">
        ${dlAttemptsHtml ? `<details class="component-report-details"><summary>View Report</summary><div class="component-report-box">${dlAttemptsHtml}</div></details>` : ''}
      </div>
    </div>

    <!-- Component 2: Stem Separation -->
    <div class="component-card component-card-splitting">
      <div class="component-card-header">
        <div class="component-title">✂️ 2. Stem Separation</div>
        ${spBadge}
      </div>
      <div class="component-details">${spDetails}</div>
      <div class="component-action-row" style="justify-content: space-between; align-items: center; margin-top: 0.5rem;">
        <button id="retrySpBtn_${song.id}" class="btn btn-secondary" style="font-size:0.8rem; padding:0.4rem 0.8rem;" onclick="retryComponentSplitting('${song.id}', this)">✂️ Retry Stem Separation</button>
        <label style="font-size: 0.75rem; display: flex; align-items: center; gap: 0.3rem; cursor: pointer; color: var(--text-secondary); white-space: nowrap;">
          <input type="checkbox" id="customSepToggle_${song.id}" onchange="toggleCustomSepSettings('${song.id}')"> Custom Settings
        </label>
      </div>

      <!-- Separation Settings Accordion -->
      <div id="customSepPanel_${song.id}" style="display: none; background: rgba(15, 23, 42, 0.85); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem; margin-top: 0.5rem; font-size: 0.8rem;">
        <div style="display:flex; gap: 0.4rem; flex-wrap: wrap;">
          <div style="flex: 1 1 120px;">
            <label style="display:block; font-size: 0.65rem; color: var(--text-secondary);">Mode & Model:</label>
            <select id="sepModeSelect_${song.id}" style="width: 100%; background: rgba(0,0,0,0.6); color: #fff; border: 1px solid var(--border); border-radius: 4px; padding: 0.2rem; font-size: 0.75rem;">
              <option value="balanced" ${sepMode === 'balanced' ? 'selected' : ''}>⚖️ Balanced (UVR-MDX-HQ-3)</option>
              <option value="fast" ${sepMode === 'fast' ? 'selected' : ''}>⚡ Fast (UVR-MDX-Inst-1)</option>
              <option value="high" ${sepMode === 'high' ? 'selected' : ''}>🎯 High Precision (MDX23C)</option>
              <option value="ultra" ${sepMode === 'ultra' ? 'selected' : ''}>👑 Ultra Quality (BS-Roformer)</option>
            </select>
          </div>
          <div style="flex: 1 1 80px;">
            <label style="display:block; font-size: 0.65rem; color: var(--text-secondary);">Format:</label>
            <select id="sepFormatSelect_${song.id}" style="width: 100%; background: rgba(0,0,0,0.6); color: #fff; border: 1px solid var(--border); border-radius: 4px; padding: 0.2rem; font-size: 0.75rem;">
              <option value="MP3" ${sepFormat === 'MP3' ? 'selected' : ''}>MP3 (Compact)</option>
              <option value="M4A" ${sepFormat === 'M4A' ? 'selected' : ''}>M4A (AAC)</option>
              <option value="WAV" ${sepFormat === 'WAV' ? 'selected' : ''}>WAV (Uncompressed)</option>
            </select>
          </div>
          <div style="flex: 1 1 80px;">
            <label style="display:block; font-size: 0.65rem; color: var(--text-secondary);">Bitrate:</label>
            <select id="sepBitrateSelect_${song.id}" style="width: 100%; background: rgba(0,0,0,0.6); color: #fff; border: 1px solid var(--border); border-radius: 4px; padding: 0.2rem; font-size: 0.75rem;">
              <option value="192k" ${sepBitrate === '192k' ? 'selected' : ''}>192 kbps (Default)</option>
              <option value="320k" ${sepBitrate === '320k' ? 'selected' : ''}>320 kbps (High)</option>
              <option value="128k" ${sepBitrate === '128k' ? 'selected' : ''}>128 kbps (Draft)</option>
            </select>
          </div>
        </div>
      </div>

      <div id="spReportContainer_${song.id}">
        ${sp.error ? `<details class="component-report-details"><summary>View Report</summary><div class="component-report-box" style="color:#f87171;">${escapeHtml(sp.error)}</div></details>` : ''}
      </div>
    </div>

    <!-- Component 3: Lyrics Fetching -->
    <div class="component-card component-card-lyrics">
      <div class="component-card-header">
        <div class="component-title">📜 3. Lyrics</div>
        ${lyBadge}
      </div>
      <div class="component-details">${lyDetails}</div>
      <div class="component-action-row">
        <select id="lyricsProviderSelect_${song.id}" class="select-input" onchange="toggleManualLyricsInput('${song.id}', this.value)" style="font-size:0.8rem; padding:0.35rem 0.6rem;">
          <option value="auto">Auto (All Providers)</option>
          <option value="LRCLIB">LRCLIB</option>
          <option value="Musixmatch">Musixmatch</option>
          <option value="NetEase">NetEase</option>
          <option value="Genius">Genius</option>
          <option value="Megalobiz">Megalobiz</option>
          <option value="manual">✍️ Manual Import</option>
        </select>
        <button id="retryLyBtn_${song.id}" class="btn btn-secondary" style="font-size:0.8rem; padding:0.4rem 0.8rem;" onclick="retryComponentLyrics('${song.id}', this)">📜 Retry Lyrics</button>
      </div>
      
      <!-- Manual Lyrics Paste Area (Shown when Manual Import is chosen) -->
      <div id="manualLyricsContainer_${song.id}" style="display: none; margin-top: 0.75rem;">
        <textarea id="manualLyricsText_${song.id}" class="manual-lyrics-textarea" placeholder="Paste song lyrics here... Each line will be split into unsynced lyrics." rows="5"></textarea>
        <div style="display: flex; justify-content: flex-end; margin-top: 0.5rem;">
          <button id="importManualBtn_${song.id}" class="btn btn-primary" style="font-size:0.8rem; padding:0.4rem 0.9rem;" onclick="importManualLyrics('${song.id}', this)">✍️ Import Lyrics</button>
        </div>
      </div>

      <div id="lyReportContainer_${song.id}">
        ${lyAttemptsHtml ? `<details class="component-report-details"><summary>View Report</summary><div class="component-report-box">${lyAttemptsHtml}</div></details>` : ''}
      </div>
    </div>
  `;
}

window.toggleCustomSepSettings = (songId) => {
  const toggle = document.getElementById(`customSepToggle_${songId}`);
  const panel = document.getElementById(`customSepPanel_${songId}`);
  if (panel && toggle) {
    panel.style.display = toggle.checked ? 'block' : 'none';
  }
};

window.toggleManualLyricsInput = (songId, val) => {
  const manualBox = document.getElementById(`manualLyricsContainer_${songId}`);
  const retryBtn = document.getElementById(`retryLyBtn_${songId}`);
  if (val === 'manual') {
    if (manualBox) {
      manualBox.style.display = 'block';
      const ta = document.getElementById(`manualLyricsText_${songId}`);
      if (ta) ta.focus();
    }
    if (retryBtn) retryBtn.style.display = 'none';
  } else {
    if (manualBox) manualBox.style.display = 'none';
    if (retryBtn) retryBtn.style.display = 'inline-block';
  }
};

window.retryComponentDownload = async (id, btn) => {
  const container = document.getElementById(`dlReportContainer_${id}`);
  const sourceSel = document.getElementById(`dlSourceSelect_${id}`);
  const source = sourceSel ? sourceSel.value : 'auto';

  const sourceDesc = source === 'spotdl' ? 'SpotDL Studio' : (source === 'ytdlp' ? 'yt-dlp backup' : 'SpotDL priority');
  if (container) {
    container.innerHTML = `<div class="component-report-box loading">⏳ Downloading audio track (${sourceDesc})... please wait...</div>`;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Downloading...';
  }

  try {
    const res = await fetch(`/api/retry_download/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source })
    });
    await res.json();
    const detailsRes = await fetch(`/api/song_details/${id}`);
    const detailsData = await detailsRes.json();
    renderComponentManagerModal(detailsData.song, detailsData.components);
    if (currentSong && currentSong.id === id) {
      currentSong = detailsData.song;
      setupAudio(currentSong);
    }
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="component-report-box" style="color:#f87171;">⚠️ Download failed: ${escapeHtml(err.message)}</div>`;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerText = '🔄 Retry Audio Download';
    }
  } finally {
    fetchLibrary();
    fetchQueue();
  }
};

window.retryComponentSplitting = async (id, btn) => {
  const container = document.getElementById(`spReportContainer_${id}`);
  const customToggle = document.getElementById(`customSepToggle_${id}`);
  const modeSel = document.getElementById(`sepModeSelect_${id}`);
  const formatSel = document.getElementById(`sepFormatSelect_${id}`);
  const bitrateSel = document.getElementById(`sepBitrateSelect_${id}`);

  const isCustom = customToggle && customToggle.checked;
  const mode = isCustom && modeSel ? modeSel.value : 'balanced';
  const format = isCustom && formatSel ? formatSel.value : 'MP3';
  const bitrate = isCustom && bitrateSel ? bitrateSel.value : '192k';

  if (container) {
    container.innerHTML = `<div class="component-report-box loading">⏳ Running AI 3-stem separation [${mode.toUpperCase()}, ${format} ${bitrate}]... please wait...</div>`;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Splitting...';
  }

  try {
    const res = await fetch(`/api/retry_splitting/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, format, bitrate, isCustom })
    });
    await res.json();
    const detailsRes = await fetch(`/api/song_details/${id}`);
    const detailsData = await detailsRes.json();
    renderComponentManagerModal(detailsData.song, detailsData.components);
    if (currentSong && currentSong.id === id) {
      currentSong = detailsData.song;
      setupAudio(currentSong);
    }
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="component-report-box" style="color:#f87171;">⚠️ Splitting failed: ${escapeHtml(err.message)}</div>`;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerText = '✂️ Retry Stem Separation';
    }
  } finally {
    fetchLibrary();
    fetchQueue();
  }
};

window.retryComponentLyrics = async (id, btn) => {
  const container = document.getElementById(`lyReportContainer_${id}`);
  if (container) {
    container.innerHTML = `<div class="component-report-box loading">⏳ Fetching synced lyrics from providers... please wait...</div>`;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Fetching...';
  }

  const sel = document.getElementById(`lyricsProviderSelect_${id}`);
  const provider = sel ? sel.value : 'auto';

  try {
    const res = await fetch(`/api/retry_lyrics/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    await res.json();
    const detailsRes = await fetch(`/api/song_details/${id}`);
    const detailsData = await detailsRes.json();
    renderComponentManagerModal(detailsData.song, detailsData.components);
    if (currentSong && currentSong.id === id) {
      currentSong = detailsData.song;
      socket.emit('update_state', { songId: currentSong.id, songData: currentSong });
      renderLyricsEditor(currentSong.lyrics || []);
    }
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="component-report-box" style="color:#f87171;">⚠️ Lyrics retry failed: ${escapeHtml(err.message)}</div>`;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerText = '📜 Retry Lyrics';
    }
  } finally {
    fetchLibrary();
    fetchQueue();
  }
};

window.importManualLyrics = async (id, btn) => {
  const ta = document.getElementById(`manualLyricsText_${id}`);
  const text = ta ? ta.value : '';
  if (!text.trim()) {
    alert('Please paste some lyrics text first.');
    return;
  }

  const container = document.getElementById(`lyReportContainer_${id}`);
  if (container) {
    container.innerHTML = `<div class="component-report-box loading">⏳ Importing lyrics lines, transliterating & translating... please wait...</div>`;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Importing...';
  }

  try {
    const res = await fetch(`/api/import_lyrics/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to import lyrics');

    const detailsRes = await fetch(`/api/song_details/${id}`);
    const detailsData = await detailsRes.json();
    renderComponentManagerModal(detailsData.song, detailsData.components);

    if (currentSong && currentSong.id === id) {
      currentSong = detailsData.song;
      socket.emit('update_state', { songId: currentSong.id, songData: currentSong });
      renderLyricsEditor(currentSong.lyrics || []);
    }
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="component-report-box" style="color:#f87171;">⚠️ Manual import failed: ${escapeHtml(err.message)}</div>`;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerText = '✍️ Import Lyrics';
    }
  } finally {
    fetchLibrary();
    fetchQueue();
  }
};

window.retryLyrics = async (id, provider = 'auto', e) => {
  if (e && e.target) {
    e.target.disabled = true;
    e.target.innerText = '⏳';
  }
  try {
    const res = await fetch(`/api/retry_lyrics/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    const data = await res.json();
    if (data.success && data.song) {
      if (currentSong && currentSong.id === id) {
        currentSong = data.song;
        socket.emit('update_state', { songId: currentSong.id, songData: currentSong });
        renderLyricsEditor(currentSong.lyrics || []);
      }
    }
  } catch (err) {
    console.error("Retry lyrics fetch error:", err);
  } finally {
    fetchLibrary();
    fetchQueue();
  }
};

window.removeFromHistory = async (id) => {
  await fetch(`/api/history/${id}`, { method: 'DELETE' });
  fetchLibrary();
  fetchQueue();
};

window.confirmRemoveFromLibrary = async (id) => {
  if (confirm('Are you sure you want to remove this song from your library?')) {
    await window.removeFromHistory(id);
  }
};

window.confirmRemoveFromHistory = window.confirmRemoveFromLibrary;

window.removeFromQueue = async (id) => {
  await fetch(`/api/queue/${id}`, { method: 'DELETE' });
  if (currentSong && currentSong.id === id) {
    const res = await fetch('/api/queue');
    const queueData = await res.json();
    const nextSong = (queueData || []).find(s => s.status === 'ready');
    if (nextSong) {
      await selectSong(nextSong.id, currentState.isPlaying);
    } else {
      clearCurrentSong();
    }
  }
  fetchQueue();
};

function renderLyricsEditor(lyrics) {
  if (lyricsTbody) {
    lyricsTbody.innerHTML = lyrics.map((l, i) => `
      <tr>
        <td><input type="number" step="0.1" value="${l.time}" id="lyric_time_${i}" style="width: 70px;"></td>
        <td><input type="text" value="${l.text}" id="lyric_text_${i}"></td>
        <td><input type="text" value="${l.transliteration || ''}" id="lyric_tl_${i}"></td>
        <td><input type="text" value="${l.translation || ''}" id="lyric_tr_${i}"></td>
      </tr>
    `).join('');
  }
}

if (saveLyricsBtn) {
  saveLyricsBtn.addEventListener('click', async () => {
    if(!currentSong) return;
    const newLyrics = (currentSong.lyrics || []).map((l, i) => ({
      time: parseFloat(document.getElementById(`lyric_time_${i}`).value),
      text: document.getElementById(`lyric_text_${i}`).value,
      transliteration: document.getElementById(`lyric_tl_${i}`).value,
      translation: document.getElementById(`lyric_tr_${i}`).value,
    }));
    
    await fetch('/api/edit_lyrics', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({songId: currentSong.id, lyrics: newLyrics})
    });
    alert('Lyrics saved!');
  });
}

// Expand Lyrics Editor Section (if present)
if (toggleLyricsExpandBtn && lyricsSection) {
  toggleLyricsExpandBtn.addEventListener('click', () => {
    const isExpanded = lyricsSection.classList.toggle('expanded');
    toggleLyricsExpandBtn.innerText = isExpanded ? '↙ Collapse' : '↔ Expand';
  });
}

// Toggles
const toggleTranslit = document.getElementById('toggleTranslit');
const toggleTranslat = document.getElementById('toggleTranslat');

if (toggleTranslit) {
  toggleTranslit.addEventListener('change', (e) => {
    socket.emit('update_state', { showTranslit: e.target.checked });
  });
}
if (toggleTranslat) {
  toggleTranslat.addEventListener('change', (e) => {
    socket.emit('update_state', { showTranslat: e.target.checked });
  });
}

// Socket Events
socket.on('queue_updated', renderQueue);
socket.on('library_updated', (data) => {
  if (Array.isArray(data)) {
    rawLibraryData = data;
    renderLibrary();
  } else {
    fetchLibrary();
  }
});
socket.on('sync_state', (state) => {
  currentState = { ...currentState, ...state };

  if (state.showTranslit !== undefined && toggleTranslit) {
    toggleTranslit.checked = !!state.showTranslit;
  }
  if (state.showTranslat !== undefined && toggleTranslat) {
    toggleTranslat.checked = !!state.showTranslat;
  }

  if (state.isPlaying === false) {
    stopSource(sources.leadVoc);
    stopSource(sources.backVoc);
    stopSource(sources.inst);
    sources.leadVoc = null;
    sources.backVoc = null;
    sources.inst = null;
  }

  if (state.songData && (!currentSong || currentSong.id !== state.songData.id)) {
    currentSong = state.songData;
    if (currentSongTitle) currentSongTitle.innerText = currentSong.title || 'None';
    const colorSrc = currentSong.id ? `/api/cover/${currentSong.id}` : getHighResAlbumArt(currentSong.albumArt);
    extractColorsFromSongCover(colorSrc);
    setupAudio(currentSong);
    renderLyricsEditor(currentSong.lyrics || []);
    updateLyricsCounter(state.currentTime || 0);
  } else if (!state.songId || !state.songData) {
    currentSong = null;
    extractColorsFromSongCover(null);
    if (currentSongTitle) currentSongTitle.innerText = 'None';
    timelineSlider.value = 0;
    timelineSlider.max = 0;
    timelineSlider.disabled = true;
    if (timeDisplay) timeDisplay.innerText = '--:-- / --:--';
    updateLyricsCounter(0);
    renderLyricsEditor([]);
  }

  if (state.currentTime !== undefined && !isDraggingSlider) {
    pauseTime = state.currentTime;
    timelineSlider.value = state.currentTime;
    const maxDur = parseFloat(timelineSlider.max) || 0;
    if (timeDisplay) timeDisplay.innerText = formatTimeDisplay(state.currentTime, maxDur);
    updateLyricsCounter(state.currentTime);
  }

  if (state.isPlaying) {
    playPauseBtn.innerText = '⏸';
  } else {
    playPauseBtn.innerText = '▶';
  }

  if (state.audioBlocked !== undefined) {
    toggleAudioBlockedBanner(state.audioBlocked);
  }
});

socket.on('player_command', (cmd) => {
  if (!cmd) return;
  if (cmd.command === 'seek' && typeof cmd.time === 'number') {
    pauseTime = cmd.time;
    timelineSlider.value = cmd.time;
    const maxDur = parseFloat(timelineSlider.max) || 0;
    if (timeDisplay) timeDisplay.innerText = formatTimeDisplay(cmd.time, maxDur);
    updateLyricsCounter(cmd.time);
    if (currentState.isPlaying && (sources.leadVoc || sources.inst || sources.backVoc)) {
      playAudio(cmd.time);
    }
  } else if (cmd.command === 'toggle_play') {
    togglePlayPause();
  } else if (cmd.command === 'play_prev') {
    playPrev();
  } else if (cmd.command === 'play_next') {
    playNext();
  } else if (cmd.command === 'set_volumes' && cmd.volumes) {
    if (cmd.volumes.instrumentals !== undefined) volInst.value = cmd.volumes.instrumentals;
    if (cmd.volumes.back !== undefined) volBackVoc.value = cmd.volumes.back;
    if (cmd.volumes.lead !== undefined) volLeadVoc.value = cmd.volumes.lead;
    volInst.dispatchEvent(new Event('input'));
  }
});

// Update timeline slider continuously if playing from dashboard tab
setInterval(() => {
  if (currentState.isPlaying && (sources.leadVoc || sources.inst)) {
    const curTime = audioCtx.currentTime - audioStartTime;
    const maxDur = parseFloat(timelineSlider.max) || 0;

    if (maxDur > 0 && curTime >= maxDur) {
      handleSongFinished();
    } else {
      pauseTime = curTime;
      if (!isDraggingSlider) {
        timelineSlider.value = curTime;
        if (timeDisplay) {
          timeDisplay.innerText = formatTimeDisplay(curTime, maxDur);
        }
        updateLyricsCounter(curTime);
      }
      socket.emit('update_state', { currentTime: curTime });
    }
  }
}, 100);

fetchLibrary();
fetchQueue();

// Auto-load first available ready song on startup if no song active, or broadcast empty state if queue empty
(async () => {
  try {
    const qRes = await fetch('/api/queue');
    const queue = await qRes.json();
    let readySong = (queue || []).find(s => s.status === 'ready');
    if (readySong) {
      await selectSong(readySong.id, false);
    } else {
      clearCurrentSong();
    }
    // Ensure state and UI are strictly paused on tab reload
    currentState.isPlaying = false;
    if (playPauseBtn) playPauseBtn.innerText = '▶';
    socket.emit('update_state', { isPlaying: false });
  } catch(e){}
})();

window.submitMetadata = async (e, songId) => {
  e.preventDefault();
  const btn = document.getElementById(`metaSaveBtn_${songId}`);
  if (btn) btn.disabled = true;

  const title = document.getElementById(`metaTitle_${songId}`).value;
  const artist = document.getElementById(`metaArtist_${songId}`).value;
  const coverUrl = document.getElementById(`metaCoverUrl_${songId}`).value;
  const coverFile = document.getElementById(`metaCoverFile_${songId}`).files[0];

  const formData = new FormData();
  formData.append('songId', songId);
  if (title !== undefined) formData.append('title', title);
  if (artist !== undefined) formData.append('artist', artist);
  if (coverUrl !== undefined) formData.append('coverUrl', coverUrl);
  if (coverFile) formData.append('coverImage', coverFile);

  try {
    const res = await fetch('/api/edit_metadata', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      const updated = data.updatedSong || {};
      const newCover = updated.albumArt || coverUrl;

      // Update in-memory currentManagerSong
      if (window.currentManagerSong && window.currentManagerSong.id === songId) {
        window.currentManagerSong = {
          ...window.currentManagerSong,
          title: title || window.currentManagerSong.title,
          artist: artist || window.currentManagerSong.artist,
          albumArt: newCover || window.currentManagerSong.albumArt
        };
      }

      // If active current playing song, update state and player bar UI immediately
      if (currentSong && currentSong.id === songId) {
        currentSong.title = title || currentSong.title;
        currentSong.artist = artist || currentSong.artist;
        if (newCover) currentSong.albumArt = newCover;
        if (currentSongTitle) currentSongTitle.innerText = currentSong.title;
        const colorSrc = currentSong.id ? `/api/cover/${currentSong.id}?t=${Date.now()}` : getHighResAlbumArt(currentSong.albumArt);
        extractColorsFromSongCover(colorSrc);
        socket.emit('update_state', { songId: currentSong.id, songData: currentSong });
      }

      // Update library and queue
      fetchLibrary();
      fetchQueue();

      // Close metadata modal and re-render component manager modal
      const metaModal = document.getElementById('metadataModal');
      if (metaModal) metaModal.style.display = 'none';
      openComponentManagerModal(songId);

      alert('Meta-data and cover updated successfully!');
    } else {
      alert('Failed to save meta-data.');
    }
  } catch (err) {
    console.error('Meta-data save error:', err);
    alert('Error saving meta-data.');
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.bulkShiftLyrics = (songId, direction) => {
  const shiftVal = parseFloat(document.getElementById(`syncShiftVal_${songId}`).value) || 0.1;
  const amount = shiftVal * direction;
  
  const list = document.getElementById(`syncEditorList_${songId}`);
  if (!list) return;
  const rows = list.querySelectorAll('.sync-editor-row');
  rows.forEach(row => {
    const timeInput = row.querySelector('.sync-time');
    let t = parseFloat(timeInput.value) || 0;
    t += amount;
    if (t < 0) t = 0;
    timeInput.value = t.toFixed(2);
  });
};

window.lastFocusedSyncRow = null;

window.addSyncEditorLine = (songId) => {
  const list = document.getElementById(`syncEditorList_${songId}`);
  if (!list) return;
  const emptyState = list.querySelector('.sync-empty');
  if (emptyState) emptyState.remove();

  const idx = list.children.length;
  const div = document.createElement('div');
  div.className = 'sync-editor-row';
  div.dataset.idx = idx;
  div.style.cssText = 'display:flex; gap:0.3rem; align-items:center;';
  
  let lastTime = 0;
  let insertBeforeNode = null;

  if (window.lastFocusedSyncRow && window.lastFocusedSyncRow.parentElement === list) {
    lastTime = parseFloat(window.lastFocusedSyncRow.querySelector('.sync-time').value) || 0;
    insertBeforeNode = window.lastFocusedSyncRow.nextSibling;
  } else if (list.children.length > 0) {
    const lastRow = list.children[list.children.length - 1];
    if (lastRow) {
      lastTime = parseFloat(lastRow.querySelector('.sync-time').value) || 0;
    }
  }
  
  div.innerHTML = `
    <input type="number" class="sync-time" value="${(lastTime + 2).toFixed(2)}" step="0.01" style="width:80px; padding:0.25rem; font-size:0.75rem; background:rgba(0,0,0,0.4); border:1px solid var(--border); color:#fff;">
    <input type="text" class="sync-text" placeholder="#INSTRUMENTAL" style="flex:1; padding:0.25rem; font-size:0.75rem; background:rgba(0,0,0,0.4); border:1px solid var(--border); color:#fff;">
    <button class="btn" style="padding:0.2rem 0.4rem; font-size:0.7rem; background:rgba(239,68,68,0.2); color:#ef4444;" onclick="this.parentElement.remove()">✕</button>
  `;
  
  if (insertBeforeNode) {
    list.insertBefore(div, insertBeforeNode);
  } else {
    list.appendChild(div);
  }
  
  window.lastFocusedSyncRow = div;
  div.querySelector('.sync-text').focus();
};

window.saveSyncEditorLyrics = async (songId) => {
  const list = document.getElementById(`syncEditorList_${songId}`);
  if (!list) return;
  
  const newLyrics = [];
  const rows = list.querySelectorAll('.sync-editor-row');
  rows.forEach(row => {
    const timeStr = row.querySelector('.sync-time').value;
    const textStr = row.querySelector('.sync-text').value;
    newLyrics.push({
      time: parseFloat(timeStr) || 0,
      text: textStr
    });
  });
  
  // Sort by time
  newLyrics.sort((a, b) => a.time - b.time);

  try {
    const res = await fetch('/api/edit_lyrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId, lyrics: newLyrics })
    });
    const data = await res.json();
    if (data.success) {
      alert('Synced lyrics saved successfully!');
      
      // Update in-memory currentManagerSong
      if (window.currentManagerSong && window.currentManagerSong.id === songId) {
        window.currentManagerSong.lyrics = newLyrics;
      }

      // If active current playing song, update state and player bar UI immediately
      if (currentSong && currentSong.id === songId) {
        currentSong.lyrics = newLyrics;
        socket.emit('update_state', { songId: currentSong.id, songData: currentSong });
      }

      openComponentManagerModal(songId); // reload component modal
    } else {
      alert('Failed to save synced lyrics.');
    }
  } catch(e) {
    console.error('Error saving sync editor lyrics:', e);
    alert('Error saving synced lyrics.');
  }
};

window.updateCoverPreviewFromUrl = (songId, url) => {
  const preview = document.getElementById(`metaCoverPreview_${songId}`);
  if (!preview) return;
  if (url && url.trim() !== '') {
    preview.src = url.trim();
  } else {
    const song = window.currentManagerSong;
    preview.src = (song && song.albumArt) ? song.albumArt : '/ctrlaltlyrics-logo.webp';
  }
};

window.updateCoverPreviewFromFile = (songId, input) => {
  const preview = document.getElementById(`metaCoverPreview_${songId}`);
  if (!preview) return;
  if (input.files && input.files[0]) {
    preview.src = URL.createObjectURL(input.files[0]);
  }
};

window.openMetadataModal = (songId) => {
  const song = window.currentManagerSong;
  if (!song || song.id !== songId) return;

  const modal = document.getElementById('metadataModal');
  const bodyEl = document.getElementById('metadataModalBody');
  if (!modal || !bodyEl) return;

  const currentCover = song.albumArt || '/ctrlaltlyrics-logo.webp';

  bodyEl.innerHTML = `
    <form id="metadataForm_${song.id}" onsubmit="submitMetadata(event, '${song.id}')" style="display:flex; flex-direction:column; gap:0.85rem; margin-top:0.25rem;">
      
      <div class="meta-editor-top-row">
        <img id="metaCoverPreview_${song.id}" class="meta-editor-cover" src="${escapeHtml(currentCover)}" alt="Cover" onerror="this.onerror=null; this.src='/ctrlaltlyrics-logo.webp';">
        <div class="meta-editor-fields">
          <div>
            <label style="font-size:0.72rem; color:var(--text-secondary); display:block; margin-bottom: 2px;">Song Title</label>
            <input type="text" id="metaTitle_${song.id}" value="${escapeHtml(song.title || '')}" placeholder="Title" style="width:100%; padding:0.4rem 0.6rem; border-radius:6px; border:1px solid var(--border); background:rgba(0,0,0,0.4); color:#fff; box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:0.72rem; color:var(--text-secondary); display:block; margin-bottom: 2px;">Artist Name</label>
            <input type="text" id="metaArtist_${song.id}" value="${escapeHtml(song.artist || '')}" placeholder="Artist" style="width:100%; padding:0.4rem 0.6rem; border-radius:6px; border:1px solid var(--border); background:rgba(0,0,0,0.4); color:#fff; box-sizing:border-box;">
          </div>
        </div>
      </div>

      <div>
        <label style="font-size:0.72rem; color:var(--text-secondary); display:block; margin-bottom: 3px;">Cover Source</label>
        <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap: wrap;">
          <input type="text" id="metaCoverUrl_${song.id}" placeholder="Image URL..." value="${escapeHtml(song.albumArt || '')}" oninput="updateCoverPreviewFromUrl('${song.id}', this.value)" style="flex:1; min-width: 160px; padding:0.4rem 0.6rem; border-radius:6px; border:1px solid var(--border); background:rgba(0,0,0,0.4); color:#fff; box-sizing:border-box;">
          <span style="font-size:0.7rem; color:var(--text-secondary); font-weight: 600;">OR</span>
          <input type="file" id="metaCoverFile_${song.id}" accept="image/*" onchange="updateCoverPreviewFromFile('${song.id}', this)" style="font-size:0.75rem; flex: 1; min-width: 140px;">
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.25rem;">
        <button type="button" class="btn btn-secondary" onclick="document.getElementById('metadataModal').style.display='none'">Cancel</button>
        <button type="submit" id="metaSaveBtn_${song.id}" class="btn btn-primary" style="padding:0.4rem 1.2rem; font-size:0.85rem;">💾 Save Changes</button>
      </div>
    </form>
  `;

  modal.style.display = 'flex';
};

window.openSyncEditorModal = (songId) => {
  const song = window.currentManagerSong;
  if (!song || song.id !== songId) return;

  const modal = document.getElementById('syncEditorModal');
  const bodyEl = document.getElementById('syncEditorModalBody');
  if (!modal || !bodyEl) return;

  let syncEditorHtml = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem; padding-bottom:0.5rem; border-bottom:1px solid var(--border);">
      <div style="display:flex; align-items:center; gap:0.3rem;">
        <button class="btn btn-secondary" onclick="bulkShiftLyrics('${song.id}', -1)" style="padding:0.2rem 0.5rem;" title="Shift earlier">-</button>
        <input type="number" id="syncShiftVal_${song.id}" value="0.1" step="0.1" style="width:60px; padding:0.2rem; background:rgba(0,0,0,0.4); border:1px solid var(--border); color:#fff; text-align:center;">
        <button class="btn btn-secondary" onclick="bulkShiftLyrics('${song.id}', 1)" style="padding:0.2rem 0.5rem;" title="Shift later">+</button>
        <span style="font-size:0.75rem; color:var(--text-secondary); margin-left:0.3rem;">Bulk Shift (s)</span>
      </div>
      <div>
        <button id="tapSyncBtn_${song.id}" class="btn btn-secondary" onclick="toggleTapToSyncMode('${song.id}')" style="font-size:0.75rem; padding:0.3rem 0.6rem; margin-right:0.3rem;">👇 Tap to Sync</button>
        <button class="btn btn-secondary" onclick="addSyncEditorLine('${song.id}')" style="font-size:0.75rem; padding:0.3rem 0.6rem;">➕ Add Line</button>
        <button class="btn btn-primary" onclick="saveSyncEditorLyrics('${song.id}')" style="font-size:0.75rem; padding:0.3rem 0.6rem; margin-left:0.3rem;">💾 Save Sync</button>
      </div>
    </div>
    <div id="syncEditorList_${song.id}" style="max-height: 400px; overflow-y: auto; display:flex; flex-direction:column; gap:0.25rem;">
  `;
  const existingLyrics = song.lyrics || [];
  if (existingLyrics.length > 0) {
    existingLyrics.forEach((line, idx) => {
      syncEditorHtml += `
        <div class="sync-editor-row" data-idx="${idx}" style="display:flex; gap:0.3rem; align-items:center;">
          <input type="number" class="sync-time" value="${line.time}" step="0.01" style="width:80px; padding:0.25rem; font-size:0.75rem; background:rgba(0,0,0,0.4); border:1px solid var(--border); color:#fff;">
          <input type="text" class="sync-text" value="${escapeHtml(line.text)}" placeholder="#INSTRUMENTAL" style="flex:1; padding:0.25rem; font-size:0.75rem; background:rgba(0,0,0,0.4); border:1px solid var(--border); color:#fff;">
          <button class="btn" style="padding:0.2rem 0.4rem; font-size:0.7rem; background:rgba(239,68,68,0.2); color:#ef4444;" onclick="this.parentElement.remove()">✕</button>
        </div>
      `;
    });
  } else {
    syncEditorHtml += `<div class="empty-state sync-empty" style="font-size:0.75rem;">No lyrics to edit. Click "Add Line" to start.</div>`;
  }
  syncEditorHtml += `</div>`;

  bodyEl.innerHTML = syncEditorHtml;
  modal.style.display = 'flex';

  window.lastFocusedSyncRow = null;
  const createdList = document.getElementById(`syncEditorList_${song.id}`);
  if (createdList) {
    createdList.addEventListener('focusin', (e) => {
      const row = e.target.closest('.sync-editor-row');
      if (row) window.lastFocusedSyncRow = row;
    });
  }
};

const metadataModal = document.getElementById('metadataModal');
if (metadataModal) {
  metadataModal.addEventListener('click', (e) => {
    if (e.target === metadataModal) metadataModal.style.display = 'none';
  });
}


const syncEditorModal = document.getElementById('syncEditorModal');
if (syncEditorModal) {
  syncEditorModal.addEventListener('click', (e) => {
    if (e.target === syncEditorModal) {
      if (tapSyncState.active) window.toggleTapToSyncMode(tapSyncState.songId);
      syncEditorModal.style.display = 'none';
    }
  });
}

const closeSyncEditorModalBtn = document.getElementById('closeSyncEditorModalBtn');
if (closeSyncEditorModalBtn) {
  closeSyncEditorModalBtn.addEventListener('click', () => {
    if (tapSyncState.active) window.toggleTapToSyncMode(tapSyncState.songId);
  });
}

window.tapSyncState = {
  active: false,
  songId: null,
  currentIndex: 0,
  rows: [],
  keyHandler: null
};

window.toggleTapToSyncMode = (songId) => {
  if (tapSyncState.active) {
    tapSyncState.active = false;
    if (tapSyncState.keyHandler) {
      document.removeEventListener('keydown', tapSyncState.keyHandler);
      tapSyncState.keyHandler = null;
    }
    const btn = document.getElementById(`tapSyncBtn_${songId}`);
    if (btn) {
      btn.innerText = '👇 Tap to Sync';
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-secondary');
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
    }
    tapSyncState.rows.forEach(r => r.style.outline = 'none');
    return;
  }

  tapSyncState.active = true;
  tapSyncState.songId = songId;
  tapSyncState.currentIndex = 0;
  
  const list = document.getElementById(`syncEditorList_${songId}`);
  if (!list) return;
  
  tapSyncState.rows = Array.from(list.querySelectorAll('.sync-editor-row'));
  if (tapSyncState.rows.length === 0) {
    tapSyncState.active = false;
    alert('No lyrics to sync. Add some lines first.');
    return;
  }

  const btn = document.getElementById(`tapSyncBtn_${songId}`);
  if (btn) {
    btn.innerText = '🛑 Stop Syncing';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
    btn.style.background = 'rgba(239,68,68,0.2)';
    btn.style.borderColor = '#ef4444';
    btn.style.color = '#fca5a5';
  }

  if (!currentSong || currentSong.id !== songId) {
    selectSong(songId, true);
  } else if (!currentState.isPlaying) {
    playAudio(getCurrentTime());
  }

  highlightTapSyncRow();

  tapSyncState.keyHandler = (e) => {
    // Check if target is not a text input to avoid typing space in text fields triggering sync
    if (e.target.tagName.toLowerCase() === 'input' && e.target.type === 'text') return;

    const modal = document.getElementById('syncEditorModal');
    if (!modal || modal.style.display === 'none') {
      window.toggleTapToSyncMode(songId);
      return;
    }

    // Stop global listeners from interfering when we handle these specific keys
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key) || 
        ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.code)) {
      e.stopPropagation();
    }

    if (e.code === 'ArrowDown') {
      e.preventDefault();
      const row = tapSyncState.rows[tapSyncState.currentIndex];
      if (row) {
        const timeInput = row.querySelector('.sync-time');
        timeInput.value = Math.max(0, getCurrentTime()).toFixed(2);
        // Optionally update the input's visual state to show it was edited
        timeInput.style.background = 'rgba(59, 130, 246, 0.4)';
        setTimeout(() => timeInput.style.background = 'rgba(0,0,0,0.4)', 500);
      }

      tapSyncState.currentIndex++;
      if (tapSyncState.currentIndex >= tapSyncState.rows.length) {
        window.toggleTapToSyncMode(songId); // done
      } else {
        highlightTapSyncRow();
      }
    } else if (e.code === 'ArrowUp' || e.key === ',' || e.key === '<') {
      e.preventDefault();
      if (tapSyncState.currentIndex > 0) {
        tapSyncState.currentIndex--;
        highlightTapSyncRow();
      }
    } else if (e.key === '.' || e.key === '>') {
      e.preventDefault();
      if (tapSyncState.currentIndex < tapSyncState.rows.length - 1) {
        tapSyncState.currentIndex++;
        highlightTapSyncRow();
      }
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const row = tapSyncState.rows[tapSyncState.currentIndex];
      if (row) {
        const timeInput = row.querySelector('.sync-time');
        let val = parseFloat(timeInput.value) || 0;
        const shiftAmount = e.shiftKey ? 0.05 : 0.5;
        if (e.code === 'ArrowLeft') {
          val -= shiftAmount;
        } else {
          val += shiftAmount;
        }
        val = Math.max(0, val);
        timeInput.value = val.toFixed(2);
        timeInput.style.background = 'rgba(16, 185, 129, 0.4)'; // green flash
        setTimeout(() => timeInput.style.background = 'rgba(0,0,0,0.4)', 500);
        seekToTime(val);
      }
    } else if (e.code === 'Escape') {
      window.toggleTapToSyncMode(songId);
    }
  };

  document.addEventListener('keydown', tapSyncState.keyHandler);
};

function highlightTapSyncRow() {
  tapSyncState.rows.forEach((r, idx) => {
    if (idx === tapSyncState.currentIndex) {
      r.style.outline = '2px solid #3b82f6';
      r.style.outlineOffset = '-1px';
      r.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.lastFocusedSyncRow = r;
    } else {
      r.style.outline = 'none';
    }
  });
}
