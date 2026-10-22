import { io } from 'socket.io-client';

const socket = io('/');
window.socket = socket;

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
let draggedCard = null;
let dragDropped = false;
let isDraggingQueue = false;
let isDraggingLibrary = false;
let draggedLibrarySongId = null;
let draggedLibraryCard = null;
let queueDropPlaceholder = null;
let initialQueueIds = [];
let currentQueueData = [];
let queueContainerDragDropInitialized = false;

const playPauseBtn = document.getElementById('playPauseBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const prevLineBtn = document.getElementById('prevLineBtn');
const nextLineBtn = document.getElementById('nextLineBtn');

const timelineSlider = document.getElementById('timelineSlider');
if (timelineSlider) timelineSlider.step = 'any';
const currentSongTitle = document.getElementById('currentSongTitle');
const lyricsCounter = document.getElementById('lyricsCounter');

const volInst = document.getElementById('volInst');
const volLeadVoc = document.getElementById('volLeadVoc');
const volBackVoc = document.getElementById('volBackVoc');
const muteInstBtn = document.getElementById('muteInstBtn');
const muteBackBtn = document.getElementById('muteBackBtn');
const muteLeadBtn = document.getElementById('muteLeadBtn');

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
let currentQueueId = null;

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
    socket.emit('update_state', { duration: dur });
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
  playPauseBtn.innerHTML = '<i class="icon-pause"></i>';
  socket.emit('update_state', { isPlaying: true, currentTime: offset });
}

function pauseAudio() {
  const currentActualTime = (currentState.isPlaying && audioCtx && audioCtx.state === 'running') 
    ? (audioCtx.currentTime - audioStartTime) 
    : (pauseTime || currentState.currentTime || 0);
  stopSource(sources.leadVoc);
  stopSource(sources.backVoc);
  stopSource(sources.inst);
  sources.leadVoc = null;
  sources.backVoc = null;
  sources.inst = null;
  pauseTime = currentActualTime;
  currentState.currentTime = currentActualTime;
  currentState.isPlaying = false;
  playPauseBtn.innerHTML = '<i class="icon-play"></i>';
  socket.emit('player_command', { command: 'pause', time: currentActualTime });
  socket.emit('update_state', { isPlaying: false, currentTime: currentActualTime });
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
      await selectSong(readySong.id, true, readySong.queueId);
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
  if (!currentSong) return selectSong(readySongs[0].id, true, readySongs[0].queueId);
  let idx = -1;
  if (currentQueueId) {
    idx = readySongs.findIndex(s => s.queueId === currentQueueId);
  }
  if (idx === -1) {
    idx = readySongs.findIndex(s => s.id === currentSong.id);
  }
  if (idx !== -1 && idx < readySongs.length - 1) {
    const next = readySongs[idx + 1];
    await selectSong(next.id, currentState.isPlaying, next.queueId);
  }
}

async function playPrev() {
  const res = await fetch('/api/queue');
  const q = await res.json();
  const readySongs = q.filter(s => s.status === 'ready');
  if (readySongs.length === 0) return;
  if (!currentSong) return selectSong(readySongs[0].id, true, readySongs[0].queueId);
  let idx = -1;
  if (currentQueueId) {
    idx = readySongs.findIndex(s => s.queueId === currentQueueId);
  }
  if (idx === -1) {
    idx = readySongs.findIndex(s => s.id === currentSong.id);
  }
  if (idx > 0) {
    const prev = readySongs[idx - 1];
    await selectSong(prev.id, currentState.isPlaying, prev.queueId);
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
window.seekToTime = seekToTime;

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
    linkInstBackBtn.innerHTML = isInstBackLinked ? '<i class="icon-link-2"></i>' : '<i class="icon-unlink-2"></i>';
    linkInstBackBtn.style.opacity = isInstBackLinked ? '1' : '0.4';
    linkInstBackBtn.title = isInstBackLinked ? 'Linked Inst & Back (Click to Unlink)' : 'Unlinked Inst & Back (Click to Link)';
  });
}

if (linkBackLeadBtn) {
  linkBackLeadBtn.addEventListener('click', () => {
    isBackLeadLinked = !isBackLeadLinked;
    linkBackLeadBtn.innerHTML = isBackLeadLinked ? '<i class="icon-link-2"></i>' : '<i class="icon-unlink-2"></i>';
    linkBackLeadBtn.style.opacity = isBackLeadLinked ? '1' : '0.4';
    linkBackLeadBtn.title = isBackLeadLinked ? 'Linked Back & Lead (Click to Unlink)' : 'Unlinked Back & Lead (Click to Link)';
  });
}

const prevFaderVolumes = {
  inst: 1.0,
  back: 1.0,
  lead: 1.0
};

function updateMuteButtonUI(stem) {
  let slider, btn, shortcutKey;
  if (stem === 'inst') {
    slider = volInst;
    btn = muteInstBtn;
    shortcutKey = 'Z';
  } else if (stem === 'back') {
    slider = volBackVoc;
    btn = muteBackBtn;
    shortcutKey = 'X';
  } else if (stem === 'lead') {
    slider = volLeadVoc;
    btn = muteLeadBtn;
    shortcutKey = 'C';
  }
  if (!btn || !slider) return;

  const val = parseFloat(slider.value) || 0;
  const isMuted = val <= 0.001;
  const capitalized = stem === 'inst' ? 'Inst' : (stem === 'back' ? 'Back' : 'Lead');

  if (isMuted) {
    btn.classList.add('is-muted');
    btn.innerHTML = '<i class="icon-volume-x"></i>';
    btn.title = `Unmute ${capitalized} (${shortcutKey})`;
  } else {
    btn.classList.remove('is-muted');
    btn.innerHTML = '<i class="icon-volume-2"></i>';
    btn.title = `Mute ${capitalized} (${shortcutKey})`;
  }
}

function updateAllMuteButtonsUI() {
  updateMuteButtonUI('inst');
  updateMuteButtonUI('back');
  updateMuteButtonUI('lead');
}

function toggleStemMute(stem) {
  let slider;
  if (stem === 'inst') slider = volInst;
  else if (stem === 'back') slider = volBackVoc;
  else if (stem === 'lead') slider = volLeadVoc;
  if (!slider) return;

  const currentVal = parseFloat(slider.value) || 0;
  if (currentVal > 0.001) {
    // Currently playing/audible -> Mute
    prevFaderVolumes[stem] = currentVal;
    slider.value = 0;
    slider.dispatchEvent(new CustomEvent('input', { detail: { skipLinking: true } }));
  } else {
    // Currently muted -> Unmute (restore previous level, or bump if min level)
    let restoreVal = prevFaderVolumes[stem];
    if (!restoreVal || restoreVal <= 0.01) {
      restoreVal = 1.0;
    }
    slider.value = restoreVal;
    slider.dispatchEvent(new CustomEvent('input', { detail: { skipLinking: true } }));
  }
  updateMuteButtonUI(stem);
}

function updateFaderTrackFill(input) {
  if (!input) return;
  const val = parseFloat(input.value) || 0;
  const max = parseFloat(input.max) || 1;
  const min = parseFloat(input.min) || 0;
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  input.style.background = `linear-gradient(to top, var(--accent, #6366f1) ${pct}%, #ffffff ${pct}%)`;
  input.style.backgroundClip = 'content-box';

  if (val > 0.001) {
    if (input === volInst) prevFaderVolumes.inst = val;
    else if (input === volBackVoc) prevFaderVolumes.back = val;
    else if (input === volLeadVoc) prevFaderVolumes.lead = val;
  }
}

function updateAllFaderTrackFills() {
  updateFaderTrackFill(volInst);
  updateFaderTrackFill(volBackVoc);
  updateFaderTrackFill(volLeadVoc);
  updateAllMuteButtonsUI();
}

// Stem Volumes & Dual Linking
volInst.addEventListener('input', (e) => {
  const val = e.target.value;
  if (gainNodes.inst) gainNodes.inst.gain.value = val;
  
  if (isInstBackLinked && !(e.detail && e.detail.skipLinking)) {
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
  
  if (isInstBackLinked && !(e.detail && e.detail.skipLinking)) {
    volInst.value = val;
    if (gainNodes.inst) gainNodes.inst.gain.value = val;
  }
  if (isBackLeadLinked && !(e.detail && e.detail.skipLinking)) {
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
  
  if (isBackLeadLinked && !(e.detail && e.detail.skipLinking)) {
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

muteInstBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  toggleStemMute('inst');
});
muteBackBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  toggleStemMute('back');
});
muteLeadBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  toggleStemMute('lead');
});

updateAllFaderTrackFills();

// Stem Mixer Keyboard Shortcuts Toggle
const toggleMixerShortcutsBtn = document.getElementById('toggleMixerShortcutsBtn');
const mixerCard = document.querySelector('.mixer-card');

function setMixerShortcutsVisible(visible) {
  if (mixerCard) {
    mixerCard.classList.toggle('mixer-shortcuts-hidden', !visible);
  }
  if (toggleMixerShortcutsBtn) {
    toggleMixerShortcutsBtn.classList.toggle('active', visible);
    toggleMixerShortcutsBtn.title = visible
      ? 'Hide Mixer Keyboard Shortcuts'
      : 'Show Mixer Keyboard Shortcuts';
  }
  try {
    localStorage.setItem('ctrlaltlyrics_mixer_shortcuts_visible', visible ? '1' : '0');
  } catch (_) {}
}

if (toggleMixerShortcutsBtn) {
  // Restore saved state (default: visible)
  try {
    const saved = localStorage.getItem('ctrlaltlyrics_mixer_shortcuts_visible');
    if (saved === '0') {
      setMixerShortcutsVisible(false);
    } else {
      setMixerShortcutsVisible(true);
    }
  } catch (_) {
    setMixerShortcutsVisible(true);
  }

  toggleMixerShortcutsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const isCurrentlyHidden = mixerCard ? mixerCard.classList.contains('mixer-shortcuts-hidden') : false;
    setMixerShortcutsVisible(isCurrentlyHidden);
  });
}

// Magic Mouse Stem Fader Control (Multi-Button Drag)
const magicMouseFaderBtn = document.getElementById('magicMouseFaderBtn');
const magicMouseBtnLeft = document.getElementById('magicMouseBtnLeft');
const magicMouseBtnMiddle = document.getElementById('magicMouseBtnMiddle');
const magicMouseBtnRight = document.getElementById('magicMouseBtnRight');

if (magicMouseFaderBtn) {
  let isMagicActive = false;
  let activePointerId = null;
  let lastClientY = null;
  let isLeftHeld = false;
  let isMiddleHeld = false;
  let isRightHeld = false;

  function updateSvgButtons(left, middle, right) {
    isLeftHeld = left;
    isMiddleHeld = middle;
    isRightHeld = right;
    if (magicMouseBtnLeft) magicMouseBtnLeft.classList.toggle('active', left);
    if (magicMouseBtnMiddle) magicMouseBtnMiddle.classList.toggle('active', middle);
    if (magicMouseBtnRight) magicMouseBtnRight.classList.toggle('active', right);
  }

  function applyMagicMovement(dy) {
    if (!isMagicActive || dy === 0) return;
    if (!isLeftHeld && !isMiddleHeld && !isRightHeld) return;

    // dy > 0: dragged down (decrease volume)
    // dy < 0: dragged up (increase volume)
    const delta = -dy * 0.006;

    let instVal = parseFloat(volInst.value) || 0;
    let backVal = parseFloat(volBackVoc.value) || 0;
    let leadVal = parseFloat(volLeadVoc.value) || 0;

    const clamp = (v) => Math.max(0, Math.min(1, Math.round(v * 1000) / 1000));

    let instChanged = false;
    let backChanged = false;
    let leadChanged = false;

    // Apply delta to directly held channels
    if (isLeftHeld) {
      instVal = clamp(instVal + delta);
      instChanged = true;
    }
    if (isMiddleHeld) {
      backVal = clamp(backVal + delta);
      backChanged = true;
    }
    if (isRightHeld) {
      leadVal = clamp(leadVal + delta);
      leadChanged = true;
    }

    // Apply linking constraints
    if (isInstBackLinked && isBackLeadLinked) {
      // All three linked
      if (instChanged) {
        backVal = instVal;
        leadVal = instVal;
      } else if (backChanged) {
        instVal = backVal;
        leadVal = backVal;
      } else if (leadChanged) {
        instVal = leadVal;
        backVal = leadVal;
      }
    } else if (isInstBackLinked) {
      // Inst & Back linked
      if (instChanged && !backChanged) {
        backVal = instVal;
      } else if (backChanged && !instChanged) {
        instVal = backVal;
      } else if (instChanged && backChanged) {
        backVal = instVal;
      }
    } else if (isBackLeadLinked) {
      // Back & Lead linked
      if (backChanged && !leadChanged) {
        leadVal = backVal;
      } else if (leadChanged && !backChanged) {
        backVal = leadVal;
      } else if (backChanged && leadChanged) {
        leadVal = backVal;
      }
    }

    volInst.value = instVal;
    volBackVoc.value = backVal;
    volLeadVoc.value = leadVal;

    if (gainNodes.inst) gainNodes.inst.gain.value = instVal;
    if (gainNodes.backVoc) gainNodes.backVoc.gain.value = backVal;
    if (gainNodes.leadVoc) gainNodes.leadVoc.gain.value = leadVal;

    updateAllFaderTrackFills();

    socket.emit('update_state', {
      volumes: {
        ...currentState.volumes,
        instrumentals: instVal,
        back: backVal,
        lead: leadVal
      }
    });
  }

  function startMagicMode(e) {
    e.preventDefault();
    e.stopPropagation();

    isMagicActive = true;
    magicMouseFaderBtn.classList.add('active');
    lastClientY = e.clientY;
    activePointerId = e.pointerId ?? null;

    // Determine pressed buttons
    let buttons = e.buttons;
    if (!buttons) {
      if (e.button === 0) buttons = 1;
      else if (e.button === 1) buttons = 4;
      else if (e.button === 2) buttons = 2;
    }

    const left = (buttons & 1) !== 0;
    const right = (buttons & 2) !== 0;
    const middle = (buttons & 4) !== 0;
    updateSvgButtons(left, middle, right);

    // Request pointer lock to hold pointer in place
    if (magicMouseFaderBtn.requestPointerLock) {
      try {
        const p = magicMouseFaderBtn.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (err) {}
    }

    // Pointer capture fallback/supplement
    if (typeof e.pointerId === 'number' && magicMouseFaderBtn.setPointerCapture) {
      try {
        magicMouseFaderBtn.setPointerCapture(e.pointerId);
      } catch (err) {}
    }
  }

  function updateHeldButtonsFromEvent(e) {
    if (!isMagicActive) return;

    let buttons = e.buttons;
    if (e.type === 'pointerup' || e.type === 'mouseup') {
      if (e.button === 0) buttons &= ~1;
      else if (e.button === 1) buttons &= ~4;
      else if (e.button === 2) buttons &= ~2;
    } else if (e.type === 'pointerdown' || e.type === 'mousedown') {
      if (e.button === 0) buttons |= 1;
      else if (e.button === 1) buttons |= 4;
      else if (e.button === 2) buttons |= 2;
    }

    if (buttons === 0) {
      endMagicMode();
      return;
    }

    const left = (buttons & 1) !== 0;
    const right = (buttons & 2) !== 0;
    const middle = (buttons & 4) !== 0;
    updateSvgButtons(left, middle, right);
  }

  function endMagicMode() {
    if (!isMagicActive) return;
    isMagicActive = false;
    magicMouseFaderBtn.classList.remove('active');
    updateSvgButtons(false, false, false);

    if (document.pointerLockElement === magicMouseFaderBtn) {
      try {
        document.exitPointerLock?.();
      } catch (err) {}
    }

    if (activePointerId !== null && magicMouseFaderBtn.releasePointerCapture) {
      try {
        magicMouseFaderBtn.releasePointerCapture(activePointerId);
      } catch (err) {}
      activePointerId = null;
    }
    lastClientY = null;
  }

  magicMouseFaderBtn.addEventListener('pointerdown', (e) => {
    startMagicMode(e);
  });

  magicMouseFaderBtn.addEventListener('mousedown', (e) => {
    if (!isMagicActive) startMagicMode(e);
  });

  window.addEventListener('pointerdown', (e) => {
    if (isMagicActive) {
      e.preventDefault();
      updateHeldButtonsFromEvent(e);
    }
  });

  window.addEventListener('mousedown', (e) => {
    if (isMagicActive) {
      e.preventDefault();
      updateHeldButtonsFromEvent(e);
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!isMagicActive) return;
    e.preventDefault();

    let dy = 0;
    if (document.pointerLockElement === magicMouseFaderBtn && typeof e.movementY === 'number' && e.movementY !== 0) {
      dy = e.movementY;
    } else if (lastClientY !== null && typeof e.clientY === 'number') {
      dy = e.clientY - lastClientY;
    }
    if (typeof e.clientY === 'number') {
      lastClientY = e.clientY;
    }

    updateHeldButtonsFromEvent(e);
    applyMagicMovement(dy);
  });

  window.addEventListener('mousemove', (e) => {
    if (!isMagicActive) return;
    if (!window.PointerEvent) {
      e.preventDefault();
      let dy = 0;
      if (document.pointerLockElement === magicMouseFaderBtn && typeof e.movementY === 'number') {
        dy = e.movementY;
      } else if (lastClientY !== null) {
        dy = e.clientY - lastClientY;
      }
      lastClientY = e.clientY;
      updateHeldButtonsFromEvent(e);
      applyMagicMovement(dy);
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (isMagicActive) {
      e.preventDefault();
      updateHeldButtonsFromEvent(e);
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (isMagicActive) {
      e.preventDefault();
      updateHeldButtonsFromEvent(e);
    }
  });

  window.addEventListener('pointercancel', () => {
    if (isMagicActive) endMagicMode();
  });

  magicMouseFaderBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });
  window.addEventListener('contextmenu', (e) => {
    if (isMagicActive) e.preventDefault();
  }, { capture: true });

  magicMouseFaderBtn.addEventListener('auxclick', (e) => {
    e.preventDefault();
  });
  window.addEventListener('auxclick', (e) => {
    if (isMagicActive) e.preventDefault();
  }, { capture: true });

  window.addEventListener('blur', () => {
    if (isMagicActive) endMagicMode();
  });
}

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  // Escape key always resets search/filter and escapes/blurs any focused text field
  if (e.key === 'Escape') {
    const isTextInput = (e.target && (
      (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'button' && e.target.type !== 'submit' && e.target.type !== 'checkbox' && e.target.type !== 'radio') ||
      e.target.tagName === 'TEXTAREA' ||
      e.target.isContentEditable
    ));
    if (isTextInput) {
      // If escaping library filter, clear query and re-render full library
      if (e.target === libraryFilterInput || e.target.id === 'libraryFilterInput') {
        if (libraryFilterInput.value) {
          libraryFilterInput.value = '';
          libraryFilterQuery = '';
          renderLibrary();
        }
      }
      // If escaping search input, clear search input and close search dropdown
      if (e.target === searchInput || e.target.id === 'searchInput') {
        if (searchInput.value) {
          searchInput.value = '';
        }
      }
      if (searchResults) searchResults.style.display = 'none';

      if (typeof e.target.blur === 'function') {
        e.target.blur();
      }
      return;
    }

    // Close open dropdowns/menus if open
    if (searchResults && searchResults.style.display !== 'none') {
      searchResults.style.display = 'none';
      return;
    }
    if (librarySortMenu && librarySortMenu.style.display !== 'none') {
      librarySortMenu.style.display = 'none';
      return;
    }
    if (engineSettingsPanel && engineSettingsPanel.style.display !== 'none') {
      engineSettingsPanel.style.display = 'none';
      return;
    }

    // Close open modals (in order of topmost/nested first) if no pending save or action
    const metadataModal = document.getElementById('metadataModal');
    if (metadataModal && metadataModal.style.display !== 'none') {
      metadataModal.style.display = 'none';
      return;
    }

    const syncModal = document.getElementById('syncEditorModal');
    if (syncModal && syncModal.style.display !== 'none') {
      // If tap to sync is actively running, escape exits tap-to-sync mode
      if (tapSyncState && tapSyncState.active) {
        window.toggleTapToSyncMode(tapSyncState.songId);
        return;
      }
      // closeLyricsSyncModal checks if there are unsaved changes and prompts if dirty
      if (typeof window.closeLyricsSyncModal === 'function') {
        window.closeLyricsSyncModal();
      } else {
        syncModal.style.display = 'none';
      }
      return;
    }

    const compModal = document.getElementById('componentManagerModal');
    if (compModal && compModal.style.display !== 'none') {
      compModal.style.display = 'none';
      return;
    }

    const uploadModal = document.getElementById('uploadSongModal');
    if (uploadModal && uploadModal.style.display !== 'none') {
      // If an upload is actively progressing (submit button says Uploading... or is disabled while progress bar visible), don't close
      const isUploading = uploadProgressBarContainer && uploadProgressBarContainer.style.display !== 'none';
      if (!isUploading) {
        closeUploadModal();
        return;
      }
    }
  }

  if ((e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'TEXTAREA') return;

  const syncModal = document.getElementById('syncEditorModal');
  const compModal = document.getElementById('componentManagerModal');
  const metaModal = document.getElementById('metadataModal');
  const uploadModal = document.getElementById('uploadSongModal');
  if ((syncModal && syncModal.style.display !== 'none') ||
      (compModal && compModal.style.display !== 'none') ||
      (metaModal && metaModal.style.display !== 'none') ||
      (uploadModal && uploadModal.style.display !== 'none')) {
    return;
  }

  // Allow browser/system combinations (e.g. Cmd+C, Cmd+Z, Ctrl+C) to pass through
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  
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

  // Stem Volume & Mute Shortcuts:
  // Q/A (Inst up/down), Z (Inst mute/unmute)
  // W/S (Back up/down), X (Back mute/unmute)
  // E/D (Lead up/down), C (Lead mute/unmute)
  // Holding Shift makes increase/decrease faster (step 0.15 vs 0.05)
  const key = e.key.toLowerCase();
  const step = e.shiftKey ? 0.15 : 0.05;

  if (key === 'q') {
    e.preventDefault();
    volInst.value = Math.min(1, parseFloat(volInst.value) + step);
    volInst.dispatchEvent(new Event('input'));
    return;
  }
  if (key === 'a') {
    e.preventDefault();
    volInst.value = Math.max(0, parseFloat(volInst.value) - step);
    volInst.dispatchEvent(new Event('input'));
    return;
  }
  if (key === 'z') {
    e.preventDefault();
    toggleStemMute('inst');
    return;
  }

  if (key === 'w') {
    e.preventDefault();
    volBackVoc.value = Math.min(1, parseFloat(volBackVoc.value) + step);
    volBackVoc.dispatchEvent(new Event('input'));
    return;
  }
  if (key === 's') {
    e.preventDefault();
    volBackVoc.value = Math.max(0, parseFloat(volBackVoc.value) - step);
    volBackVoc.dispatchEvent(new Event('input'));
    return;
  }
  if (key === 'x') {
    e.preventDefault();
    toggleStemMute('back');
    return;
  }

  if (key === 'e') {
    e.preventDefault();
    volLeadVoc.value = Math.min(1, parseFloat(volLeadVoc.value) + step);
    volLeadVoc.dispatchEvent(new Event('input'));
    return;
  }
  if (key === 'd') {
    e.preventDefault();
    volLeadVoc.value = Math.max(0, parseFloat(volLeadVoc.value) - step);
    volLeadVoc.dispatchEvent(new Event('input'));
    return;
  }
  if (key === 'c') {
    e.preventDefault();
    toggleStemMute('lead');
    return;
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

  // 1. Download Status (Aspect: icon-download, Phase: icon-loader-2 | icon-check | icon-x)
  if (song.status === 'downloading') {
    downloadBadge = `<span class="emoji-badge status-badge-download" title="Downloading audio..."><i class="icon-loader-2 icon-spin status-phase-icon"></i><i class="icon-download status-component-icon"></i></span>`;
  } else if (song.downloadError || (song.status === 'error' && !hasAudio)) {
    downloadBadge = `<span class="emoji-badge status-badge-download" title="Download Error: ${escapeHtml(song.downloadError || 'Failed')}"><i class="icon-x status-phase-icon" style="color:#ef4444;"></i><i class="icon-download status-component-icon"></i></span>`;
  } else if (hasAudio || song.status === 'ready') {
    downloadBadge = `<span class="emoji-badge status-badge-download" title="Audio Downloaded"><i class="icon-check status-phase-icon" style="color:#10b981;"></i><i class="icon-download status-component-icon"></i></span>`;
  } else {
    downloadBadge = `<span class="emoji-badge status-badge-download" title="Waiting to download audio..."><i class="icon-x status-phase-icon" style="color:#ef4444;"></i><i class="icon-download status-component-icon"></i></span>`;
  }

  // 2. Split Status (Aspect: icon-scissors, Phase: icon-loader-2 | icon-check | icon-x)
  if (song.status === 'splitting') {
    splitBadge = `<span class="emoji-badge status-badge-split" title="Splitting vocal and instrumental stems..."><i class="icon-loader-2 icon-spin status-phase-icon"></i><i class="icon-scissors status-component-icon"></i></span>`;
  } else if (song.splitError) {
    splitBadge = `<span class="emoji-badge status-badge-split" title="Stem Split Error: ${escapeHtml(song.splitError || 'Failed')}"><i class="icon-x status-phase-icon" style="color:#ef4444;"></i><i class="icon-scissors status-component-icon"></i></span>`;
  } else if (hasSplitStems || (song.status === 'ready' && !song.splitError)) {
    splitBadge = `<span class="emoji-badge status-badge-split" title="Stems Separated"><i class="icon-check status-phase-icon" style="color:#10b981;"></i><i class="icon-scissors status-component-icon"></i></span>`;
  } else {
    splitBadge = `<span class="emoji-badge status-badge-split" title="Waiting to split stems..."><i class="icon-x status-phase-icon" style="color:#ef4444;"></i><i class="icon-scissors status-component-icon"></i></span>`;
  }

  // 3. Lyrics Status (Aspect: icon-file-text, Phase: icon-loader-2 | icon-check | icon-x)
  if (song.status === 'fetching_lyrics' || song.lyricsStatus) {
    lyricsBadge = `<span class="emoji-badge status-badge-lyrics" title="Fetching Lyrics: ${escapeHtml(song.lyricsStatus || 'Searching...')}"><i class="icon-loader-2 icon-spin status-phase-icon"></i><i class="icon-file-text status-component-icon"></i></span>`;
  } else if (song.lyricsError || !hasLyricsLoaded) {
    lyricsBadge = `<span class="emoji-badge status-badge-lyrics" title="Lyrics: ${escapeHtml(song.lyricsError || 'No lyrics found')}"><i class="icon-x status-phase-icon" style="color:#ef4444;"></i><i class="icon-file-text status-component-icon"></i></span>`;
  } else if (hasLyricsLoaded) {
    const prov = song.lyricsProvider ? ` (${song.lyricsProvider})` : '';
    lyricsBadge = `<span class="emoji-badge status-badge-lyrics" title="Lyrics Loaded${escapeHtml(prov)}"><i class="icon-check status-phase-icon" style="color:#10b981;"></i><i class="icon-file-text status-component-icon"></i></span>`;
  } else {
    lyricsBadge = `<span class="emoji-badge status-badge-lyrics" title="Waiting to fetch lyrics..."><i class="icon-x status-phase-icon" style="color:#ef4444;"></i><i class="icon-file-text status-component-icon"></i></span>`;
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
      container.innerHTML = '<div class="error-state"><i class="icon-alert-triangle"></i> Connection error. <button class="btn" onclick="fetchLibrary()" style="padding:0.2rem 0.5rem; font-size:0.7rem;">Retry</button></div>';
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
      <div class="song-card library-card ${isActive ? 'active-playing' : ''}" 
           draggable="true" 
           data-song-id="${song.id}">
        <!-- Row 1: Song Info & Top-Right Playing Badge -->
        <div class="song-card-header">
          <div class="song-card-meta">
            <img src="${escapeHtml(song.albumArt || '/ctrlaltlyrics-logo.webp')}" alt="art" onerror="this.onerror=null; this.src='/ctrlaltlyrics-logo.webp';">
            <div class="song-info">
              <div class="song-title">${escapeHtml(song.title)}</div>
              <div class="song-artist">${escapeHtml(song.artist)}</div>
            </div>
          </div>
          ${isActive ? `
            <div class="currently-playing-badge" title="Currently Playing">
              <i class="icon-play"></i>
              <span class="currently-playing-label">Playing</span>
            </div>
          ` : ''}
        </div>
        <!-- Row 2: Status Badges (Left) & Action Buttons (Right) -->
        <div class="song-card-actions-row">
          ${renderEmojiStatusesHtml(song)}
          <div class="emoji-btn-group">
            <button class="emoji-btn emoji-btn-accent" onclick="enqueueSong('${song.id}')" title="Add to Queue"><i class="icon-plus"></i></button>
            <button class="emoji-btn" onclick="openFolder('${song.id}')" title="Open Folder"><i class="icon-folder"></i></button>
            <button class="emoji-btn" onclick="openComponentManagerModal('${song.id}')" title="Component Status & Retry"><i class="icon-bolt"></i></button>
            <button class="emoji-btn" onclick="openSongSourceLink('${song.id}')" title="Open Song Source (Spotify / YouTube)"><i class="icon-external-link"></i></button>
            <button class="emoji-btn emoji-btn-danger" onclick="confirmRemoveFromLibrary('${song.id}')" title="Delete from Library"><i class="icon-trash-2"></i></button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  setupLibraryDragAndDrop();
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
    queueList.innerHTML = '<div class="error-state"><i class="icon-alert-triangle"></i> Connection error. <button class="btn" onclick="fetchQueue()" style="padding:0.2rem 0.5rem; font-size:0.7rem;">Retry</button></div>';
  }
}
function renderQueueStatusBadge(song) {
  let iconClass = 'icon-loader-2 icon-spin';
  let label = 'Processing';
  let statusClass = 'status-processing';
  let tooltip = 'Processing track...';

  if (song.status === 'downloading') {
    iconClass = 'icon-loader-2 icon-spin';
    label = 'Downloading';
    statusClass = 'status-downloading';
    tooltip = 'Downloading audio...';
  } else if (song.status === 'splitting') {
    iconClass = 'icon-loader-2 icon-spin';
    label = 'Splitting';
    statusClass = 'status-splitting';
    tooltip = 'Separating stems...';
  } else if (song.status === 'fetching_lyrics') {
    iconClass = 'icon-loader-2 icon-spin';
    label = 'Lyrics';
    statusClass = 'status-lyrics';
    tooltip = 'Fetching lyrics...';
  } else if (song.status === 'error') {
    iconClass = 'icon-alert-triangle';
    label = 'Error';
    statusClass = 'status-error';
    tooltip = escapeHtml(song.downloadError || song.splitError || song.lyricsError || 'Processing error');
  } else if (song.status === 'pending') {
    iconClass = 'icon-clock';
    label = 'Queued';
    statusClass = 'status-pending';
    tooltip = 'Queued for processing...';
  }

  return `
    <div class="queue-status-badge queue-processing-badge ${statusClass}" title="${tooltip}">
      <i class="${iconClass}"></i>
      <span class="queue-processing-label">${label}</span>
    </div>
  `;
}

function renderQueue(data) {
  currentQueueData = data || [];
  if (!data || data.length === 0) {
    queueList.innerHTML = '<div class="empty-state">No songs in queue. Use the search bar above to add a track!</div>';
    if (currentSong) {
      clearCurrentSong();
    }
    return;
  }

  const readySongs = (data || []).filter(s => s.status === 'ready');
  if (currentQueueId && !data.some(s => s.queueId === currentQueueId)) {
    if (readySongs.length > 0) {
      selectSong(readySongs[0].id, false, readySongs[0].queueId);
    } else {
      clearCurrentSong();
    }
  } else if (!currentQueueId && currentSong && !readySongs.some(s => s.id === currentSong.id)) {
    if (readySongs.length > 0) {
      selectSong(readySongs[0].id, false, readySongs[0].queueId);
    } else {
      clearCurrentSong();
    }
  }

  queueList.innerHTML = data.map((song, idx) => {
    const isActive = currentQueueId ? (song.queueId === currentQueueId) : (currentSong && currentSong.id === song.id);
    const isProcessing = song.status !== 'ready';
    const qId = song.queueId || song.id;
    return `
      <div class="song-card queue-card ${isActive ? 'active-playing' : ''} ${isProcessing ? 'queue-card-processing' : ''}" 
           draggable="true" 
           data-index="${idx}"
           data-id="${song.id}"
           data-queue-id="${qId}"
           onclick="handleQueueCardClick('${song.id}', '${qId}', event)">
        <!-- Row 1: Song Info & Queue Management Icons -->
        <div style="display:flex; align-items:center; justify-content:space-between; gap: 0.5rem; width: 100%;">
          <div style="display:flex; align-items:center; gap: 0.6rem; flex: 1; min-width: 0;">
            <div class="queue-reorder-col" onclick="event.stopPropagation();">
              <button class="queue-arrow-btn" onclick="reorderQueueItem('${qId}', 'up', event)" title="Move Up" ${idx === 0 ? 'disabled' : ''} aria-label="Move Up">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
              </button>
              <span class="queue-drag-handle" title="Drag to reorder"><i class="icon-grip-vertical"></i></span>
              <button class="queue-arrow-btn" onclick="reorderQueueItem('${qId}', 'down', event)" title="Move Down" ${idx === data.length - 1 ? 'disabled' : ''} aria-label="Move Down">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
            </div>
            <img src="${escapeHtml(song.albumArt || '/ctrlaltlyrics-logo.webp')}" alt="art" onerror="this.onerror=null; this.src='/ctrlaltlyrics-logo.webp';">
            <div class="song-info">
              <div class="song-title">${escapeHtml(song.title)}</div>
              <div class="song-artist">${escapeHtml(song.artist)}</div>
            </div>
          </div>

          <div style="display:flex; align-items:center; gap: 0.5rem; flex-shrink: 0;">
            ${isActive ? `
              <div class="currently-playing-badge" title="Currently Playing">
                <i class="icon-play"></i>
                <span class="currently-playing-label">Playing</span>
              </div>
            ` : ''}
            ${!isActive && isProcessing ? renderQueueStatusBadge(song) : ''}
            <!-- Queue Management Controls (Icons Only) -->
            <div class="queue-controls-group" onclick="event.stopPropagation();">
              <button class="queue-icon-btn" onclick="removeFromQueue('${qId}', event)" title="Remove from Queue"><i class="icon-x"></i></button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  setupQueueDragAndDrop();
}

window.handleQueueCardClick = (songId, queueId, event) => {
  if (isDraggingQueue) {
    return;
  }
  if (event.target.closest('.queue-controls-group') || event.target.closest('.queue-reorder-col') || event.target.closest('.queue-drag-handle')) {
    return;
  }
  selectSong(songId, true, queueId);
};

window.reorderQueueItem = async (queueId, direction, event) => {
  if (event) event.stopPropagation();
  await fetch('/api/queue/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId, direction })
  });
  fetchQueue();
};

function updateQueueArrowButtons() {
  const allCards = queueList.querySelectorAll('.queue-card');
  allCards.forEach((c, i) => {
    const upBtn = c.querySelector('.queue-arrow-btn[title="Move Up"]');
    const downBtn = c.querySelector('.queue-arrow-btn[title="Move Down"]');
    if (upBtn) upBtn.disabled = (i === 0);
    if (downBtn) downBtn.disabled = (i === allCards.length - 1);
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.queue-card:not(.dragging):not(.queue-drop-placeholder)')];
  if (draggableElements.length === 0) return null;

  // Clamping checks:
  const firstBox = draggableElements[0].getBoundingClientRect();
  if (y < firstBox.top + firstBox.height / 2) {
    return draggableElements[0];
  }
  const lastBox = draggableElements[draggableElements.length - 1].getBoundingClientRect();
  if (y > lastBox.top + lastBox.height / 2) {
    return null; // Append at end of list
  }

  // Rounding check between elements based on midpoints:
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - (box.top + box.height / 2);
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element || null;
}

function getOrCreateQueueDropPlaceholder(songId) {
  if (!queueDropPlaceholder) {
    queueDropPlaceholder = document.createElement('div');
    queueDropPlaceholder.className = 'song-card queue-card queue-drop-placeholder';
  }
  const song = (rawLibraryData || []).find(s => s.id === songId);
  const title = song ? song.title : 'Track';
  const artist = song ? song.artist : '';
  queueDropPlaceholder.innerHTML = `
    <i class="icon-plus"></i>
    <span class="placeholder-text">Insert: <strong>${escapeHtml(title)}</strong> ${artist ? `– ${escapeHtml(artist)}` : ''}</span>
  `;
  return queueDropPlaceholder;
}

function removeQueueDropPlaceholder() {
  if (queueDropPlaceholder && queueDropPlaceholder.parentNode) {
    queueDropPlaceholder.parentNode.removeChild(queueDropPlaceholder);
  }
}

function showQueueDragOutHint() {
  const hint = document.getElementById('queueDragOutHint');
  if (hint) {
    hint.style.display = 'inline-flex';
    hint.classList.remove('active');
  }
}

function hideQueueDragOutHint() {
  const hint = document.getElementById('queueDragOutHint');
  if (hint) {
    hint.style.display = 'none';
    hint.classList.remove('active');
  }
}

function showQueueRemoveToast() {
  const toast = document.getElementById('queueRemoveToast');
  if (toast) {
    toast.style.display = 'flex';
  }
}

function hideQueueRemoveToast() {
  const toast = document.getElementById('queueRemoveToast');
  if (toast) {
    toast.style.display = 'none';
  }
}

function setupLibraryDragAndDrop() {
  const container = document.getElementById('libraryList');
  if (!container) return;
  const cards = container.querySelectorAll('.library-card');
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      // Don't initiate drag if clicking buttons, action groups or links
      if (e.target.closest('button') || e.target.closest('.emoji-btn-group') || e.target.closest('a')) {
        e.preventDefault();
        return;
      }

      isDraggingLibrary = true;
      draggedLibraryCard = card;
      draggedLibrarySongId = card.dataset.songId;

      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', card.dataset.songId);
      e.dataTransfer.setData('application/x-ctrlaltlyrics-song-id', card.dataset.songId);

      setTimeout(() => {
        if (draggedLibraryCard) {
          draggedLibraryCard.classList.add('library-card-dragging');
        }
      }, 0);
    });

    card.addEventListener('dragend', () => {
      if (draggedLibraryCard) {
        draggedLibraryCard.classList.remove('library-card-dragging');
      }
      removeQueueDropPlaceholder();
      if (!currentQueueData || currentQueueData.length === 0) {
        if (queueList && !queueList.querySelector('.queue-card')) {
          queueList.innerHTML = '<div class="empty-state">No songs in queue. Use the search bar above to add a track!</div>';
        }
      }
      setTimeout(() => {
        isDraggingLibrary = false;
      }, 100);
      draggedLibrarySongId = null;
      draggedLibraryCard = null;
    });
  });
}

function initQueueContainerDragDrop() {
  if (queueContainerDragDropInitialized || !queueList) return;
  queueContainerDragDropInitialized = true;

  // Global document dragover to track dragging out of queue to remove
  document.addEventListener('dragover', (e) => {
    if (!isDraggingQueue || !draggedCard) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const isOverQueue = queueList && queueList.contains(e.target);
    const hint = document.getElementById('queueDragOutHint');
    if (!isOverQueue) {
      draggedCard.classList.add('dragging-remove');
      if (hint) hint.classList.add('active');
      showQueueRemoveToast();
    } else {
      draggedCard.classList.remove('dragging-remove');
      if (hint) hint.classList.remove('active');
      hideQueueRemoveToast();
    }
  });

  // Global document drop for removing when dropped outside queue
  document.addEventListener('drop', async (e) => {
    if (!isDraggingQueue || !draggedCard) return;
    const isOverQueue = queueList && queueList.contains(e.target);
    if (!isOverQueue) {
      e.preventDefault();
      dragDropped = true;
      const qId = draggedCard.dataset.queueId || draggedCard.dataset.id;
      hideQueueRemoveToast();
      hideQueueDragOutHint();
      if (draggedCard) {
        draggedCard.classList.remove('dragging', 'dragging-remove');
      }
      if (qId) {
        await removeFromQueue(qId);
      }
      draggedCard = null;
      isDraggingQueue = false;
    }
  });

  queueList.addEventListener('dragover', (e) => {
    e.preventDefault();

    // Auto-scroll when dragging near container boundaries
    const containerRect = queueList.getBoundingClientRect();
    const scrollThreshold = 45;
    if (e.clientY < containerRect.top + scrollThreshold) {
      queueList.scrollTop -= 8;
    } else if (e.clientY > containerRect.bottom - scrollThreshold) {
      queueList.scrollTop += 8;
    }

    // Case 1: Dragging a song from Library to insert into Queue
    if (isDraggingLibrary && draggedLibrarySongId) {
      e.dataTransfer.dropEffect = 'copy';
      const placeholder = getOrCreateQueueDropPlaceholder(draggedLibrarySongId);
      
      // If queue is currently showing empty state, clear empty state for insertion preview
      const emptyState = queueList.querySelector('.empty-state');
      if (emptyState) {
        emptyState.remove();
      }

      const afterElement = getDragAfterElement(queueList, e.clientY);
      if (afterElement) {
        if (placeholder.nextElementSibling !== afterElement) {
          queueList.insertBefore(placeholder, afterElement);
        }
      } else {
        if (placeholder.nextElementSibling !== null || !placeholder.parentNode) {
          queueList.appendChild(placeholder);
        }
      }
      return;
    }

    // Case 2: Dragging a Queue card to reorder inside Queue
    if (!draggedCard) return;
    e.dataTransfer.dropEffect = 'move';
    draggedCard.classList.remove('dragging-remove');
    hideQueueRemoveToast();
    const hint = document.getElementById('queueDragOutHint');
    if (hint) hint.classList.remove('active');

    const afterElement = getDragAfterElement(queueList, e.clientY);
    if (afterElement) {
      if (draggedCard.nextElementSibling !== afterElement) {
        queueList.insertBefore(draggedCard, afterElement);
        updateQueueArrowButtons();
      }
    } else {
      if (draggedCard.nextElementSibling !== null) {
        queueList.appendChild(draggedCard);
        updateQueueArrowButtons();
      }
    }
  });

  queueList.addEventListener('drop', async (e) => {
    e.preventDefault();

    // Case 1: Drop from Library into Queue
    if (isDraggingLibrary) {
      dragDropped = true;
      let insertIndex = 0;
      if (queueDropPlaceholder && queueDropPlaceholder.parentNode === queueList) {
        let sib = queueDropPlaceholder.previousElementSibling;
        while (sib) {
          if (sib.classList.contains('queue-card') && !sib.classList.contains('queue-drop-placeholder')) {
            insertIndex++;
          }
          sib = sib.previousElementSibling;
        }
      }
      const songIdToEnqueue = draggedLibrarySongId || e.dataTransfer.getData('application/x-ctrlaltlyrics-song-id') || e.dataTransfer.getData('text/plain');
      removeQueueDropPlaceholder();

      if (songIdToEnqueue) {
        await enqueueSong(songIdToEnqueue, insertIndex);
      }
      isDraggingLibrary = false;
      draggedLibrarySongId = null;
      draggedLibraryCard = null;
      return;
    }

    // Case 2: Drop Queue card inside Queue (reorder)
    if (!draggedCard) return;
    dragDropped = true;

    const currentCards = [...queueList.querySelectorAll('.queue-card:not(.queue-drop-placeholder)')];
    const newQueueIds = currentCards.map(c => c.dataset.queueId || c.dataset.id);

    draggedCard.classList.remove('dragging', 'dragging-remove');
    hideQueueRemoveToast();
    hideQueueDragOutHint();

    const hasChanged = newQueueIds.length === initialQueueIds.length && 
      newQueueIds.some((id, idx) => id !== initialQueueIds[idx]);

    if (hasChanged) {
      try {
        await fetch('/api/queue/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queueIds: newQueueIds })
        });
      } catch (err) {
        console.error('Failed to reorder queue:', err);
      }
      fetchQueue();
    }
  });
}

function setupQueueDragAndDrop() {
  initQueueContainerDragDrop();

  const cards = queueList.querySelectorAll('.queue-card');
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      // Don't initiate drag if clicking buttons or controls
      if (e.target.closest('button') || e.target.closest('.queue-controls-group')) {
        e.preventDefault();
        return;
      }

      isDraggingQueue = true;
      draggedCard = card;
      dragDropped = false;
      initialQueueIds = [...queueList.querySelectorAll('.queue-card:not(.queue-drop-placeholder)')].map(c => c.dataset.queueId || c.dataset.id);

      showQueueDragOutHint();

      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.queueId || card.dataset.id);

      // Defer adding dragging class so drag snapshot captures full card
      setTimeout(() => {
        if (draggedCard) {
          draggedCard.classList.add('dragging');
        }
      }, 0);
    });

    card.addEventListener('dragend', () => {
      if (draggedCard) {
        draggedCard.classList.remove('dragging', 'dragging-remove');
      }
      hideQueueDragOutHint();
      hideQueueRemoveToast();
      removeQueueDropPlaceholder();

      setTimeout(() => {
        isDraggingQueue = false;
      }, 100);

      if (!dragDropped) {
        // Drag was cancelled (e.g. Escape key) or dropped in cancelled state
        renderQueue(currentQueueData);
      }
      draggedCard = null;
      dragDropped = false;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
  });
}

// Attach Library Filter & Sort Listeners
if (libraryFilterInput) {
  const updateLibraryFilter = () => {
    libraryFilterQuery = libraryFilterInput.value.trim().toLowerCase();
    renderLibrary();
  };

  libraryFilterInput.addEventListener('input', updateLibraryFilter);
  // Support webkit search cancel ('x' icon click) & change
  libraryFilterInput.addEventListener('search', updateLibraryFilter);
  libraryFilterInput.addEventListener('change', updateLibraryFilter);
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
      <span>${isSpotifyLink ? '<i class="icon-disc"></i> Fetching Spotify Track...' : '<i class="icon-search"></i> Searching songs...'}</span>
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
        artImg.src = song.albumArt || '/ctrlaltlyrics-logo.webp';
        artImg.alt = 'art';
        artImg.onerror = () => { artImg.onerror = null; artImg.src = '/ctrlaltlyrics-logo.webp'; };

        const infoDiv = document.createElement('div');
        infoDiv.className = 'song-info';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'song-title';
        titleDiv.textContent = song.title || 'Unknown Title';
        if (song.isSpotify || song.spotifyUrl) {
          const badge = document.createElement('span');
          badge.className = 'spotify-badge';
          badge.title = 'Spotify Direct Track';
          badge.innerHTML = '<i class="icon-disc"></i> Spotify';
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
    searchResults.innerHTML = `<div style="padding:0.75rem; text-align:center; color:#f87171; font-size:0.85rem;"><i class="icon-alert-triangle"></i> Search failed: ${escapeHtml(err.message)}</div>`;
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

searchInput.addEventListener('search', () => {
  if (!searchInput.value.trim()) {
    searchResults.style.display = 'none';
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
    balanced: 'Balanced (~30s)',
    fast: 'Fast (~10s)',
    high: 'High Precision (~60s)',
    ultra: 'Ultra Quality (~2m)'
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
        uploadTagNotice.innerHTML = '<i class="icon-sparkles"></i> Embedded cover & ID3 tags detected';
        uploadTagNotice.style.display = 'block';
      }
    } else {
      if (uploadCoverPreview) uploadCoverPreview.src = '/ctrlaltlyrics-logo.webp';
      if (uploadTagNotice) {
        uploadTagNotice.innerHTML = '<i class="icon-music"></i> Audio file loaded';
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
            uploadErrorMsg.innerHTML = `<i class="icon-alert-triangle"></i> ${escapeHtml(errText)}`;
            uploadErrorMsg.style.display = 'block';
          }
          submitUploadBtn.disabled = false;
          submitUploadBtn.innerText = 'Upload & Process';
        }
      };

      xhr.onerror = () => {
        if (uploadErrorMsg) {
          uploadErrorMsg.innerHTML = '<i class="icon-alert-triangle"></i> Network error during upload.';
          uploadErrorMsg.style.display = 'block';
        }
        submitUploadBtn.disabled = false;
        submitUploadBtn.innerText = 'Upload & Process';
      };

      xhr.send(formData);

    } catch (err) {
      if (uploadErrorMsg) {
        uploadErrorMsg.innerHTML = `<i class="icon-alert-triangle"></i> ${escapeHtml(err.message || 'Upload error')}`;
        uploadErrorMsg.style.display = 'block';
      }
      submitUploadBtn.disabled = false;
      submitUploadBtn.innerText = 'Upload & Process';
    }
  });
}

window.enqueueNewSong = async (song, insertIndex = undefined) => {
  if (searchResults) searchResults.style.display = 'none';
  if (searchInput) searchInput.value = '';
  const payloadSettings = engineSettings.isCustom ? engineSettings : { mode: 'balanced', format: 'MP3', bitrate: '192k', isCustom: false };
  const payload = {
    song,
    engineSettings: payloadSettings
  };
  if (typeof insertIndex === 'number' && Number.isInteger(insertIndex)) {
    payload.insertIndex = insertIndex;
  }
  await fetch('/api/enqueue', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
};

window.enqueueSong = async (id, insertIndex = undefined) => {
  try {
    const res = await fetch(`/api/song/${id}`);
    if (res.ok) {
      const song = await res.json();
      await window.enqueueNewSong(song, insertIndex);
    }
  } catch (e) {
    console.error("Error enqueuing song:", e);
  }
};

window.selectSong = async (id, forcePlay = null, queueId = null) => {
  try {
    const res = await fetch(`/api/song/${id}`);
    if (!res.ok) return;
    const song = await res.json();
    if (song && song.status === 'ready') {
      const shouldPlay = (forcePlay !== null) ? forcePlay : currentState.isPlaying;
      pauseAudio(); // Stop any active playing audio nodes from the previous song
      
      currentSong = song;
      currentQueueId = queueId || (song.queueId || null);
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
      socket.emit('update_state', { songId: song.id, queueId: currentQueueId, currentTime: 0, isPlaying: false, songData: song });
      
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
  currentQueueId = null;
  extractColorsFromSongCover(null);
  pauseTime = 0;
  currentState.isPlaying = false;
  currentState.currentTime = 0;
  currentState.songId = null;
  currentState.queueId = null;
  currentState.songData = null;
  playPauseBtn.innerHTML = '<i class="icon-play"></i>';
  if (currentSongTitle) currentSongTitle.innerText = 'None';
  timelineSlider.value = 0;
  timelineSlider.max = 0;
  timelineSlider.disabled = true;
  if (timeDisplay) timeDisplay.innerText = '--:-- / --:--';
  updateLyricsCounter(0);
  renderLyricsEditor([]);
  socket.emit('update_state', { songId: null, queueId: null, currentTime: 0, isPlaying: false, songData: null });
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
      await selectSong(readySongs[0].id, true, readySongs[0].queueId);
      return;
    }

    let idx = -1;
    if (currentQueueId) {
      idx = readySongs.findIndex(s => s.queueId === currentQueueId);
    }
    if (idx === -1) {
      idx = readySongs.findIndex(s => s.id === currentSong.id);
    }
    if (idx !== -1 && idx < readySongs.length - 1) {
      // Autoplay next song in queue
      const next = readySongs[idx + 1];
      await selectSong(next.id, true, next.queueId);
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

  if (titleEl) titleEl.innerHTML = `<i class="icon-file-text"></i> Component Status & Manager`;
  bodyEl.innerHTML = `<div class="empty-state"><i class="icon-loader-2 icon-spin"></i> Loading component status...</div>`;
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/song_details/${id}`);
    if (!res.ok) throw new Error("Failed to load song details");
    const data = await res.json();
    renderComponentManagerModal(data.song, data.components);
  } catch (err) {
    bodyEl.innerHTML = `<div class="error-state"><i class="icon-alert-triangle"></i> Error loading song details: ${escapeHtml(err.message)}</div>`;
  }
};

function renderComponentManagerModal(song, components = {}) {
  const titleEl = document.getElementById('componentManagerTitle');
  const bodyEl = document.getElementById('componentManagerBody');
  if (!bodyEl) return;

  if (titleEl) titleEl.innerHTML = `<i class="icon-file-text"></i> Component Manager: "${escapeHtml(song.title || 'Song')}"`;

  const dl = components.download || {};
  const sp = components.splitting || {};
  const ly = components.lyrics || {};

  // 1. Audio Download Card
  let dlBadge = '<span class="status-badge success"><i class="icon-check"></i> Ready</span>';
  let dlDetails = `
    <div class="component-meta-list">
      <div>Source: <strong>${escapeHtml(dl.method || song.downloadMethod || 'SpotDL')}</strong></div>
      <div>File: <code class="mono-tag">${escapeHtml(dl.audioFile || 'audio.mp3')}</code></div>
    </div>
  `;
  if (dl.status === 'error' || song.downloadError) {
    dlBadge = '<span class="status-badge error"><i class="icon-x"></i> Failed</span>';
    dlDetails = `<div style="color:#f87171; font-size:0.8rem;">Error: ${escapeHtml(dl.error || song.downloadError || 'Audio file missing')}</div>`;
  } else if (dl.status === 'pending' || song.status === 'downloading') {
    dlBadge = '<span class="status-badge pending"><i class="icon-loader-2 icon-spin"></i> Downloading</span>';
  }

  let dlAttemptsHtml = '';
  if (dl.attempts && dl.attempts.length > 0) {
    dlAttemptsHtml = dl.attempts.map(a => {
      let icon = '<i class="icon-x" style="color:#ef4444;"></i>';
      let rowClass = 'failed';
      if (a.status === 'success') { icon = '<i class="icon-check" style="color:#10b981;"></i>'; rowClass = 'success'; }
      else if (a.status === 'partial') { icon = '<i class="icon-alert-triangle" style="color:#f59e0b;"></i>'; rowClass = 'partial'; }
      else if (a.status === 'skipped') { icon = '<i class="icon-skip-forward" style="color:#94a3b8;"></i>'; rowClass = 'skipped'; }
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
    balanced: 'Balanced (~30s)',
    fast: 'Fast (~10s)',
    high: 'High Precision (~60s)',
    ultra: 'Ultra Quality (~2m)'
  };

  let spBadge = '<span class="status-badge success"><i class="icon-check"></i> 3 Stems</span>';
  let spDetails = `
    <div class="component-meta-list">
      <div>Status: <strong>${sp.isFallback || sp.status === 'fallback' ? '<i class="icon-alert-triangle"></i> Full Track Fallback' : '<i class="icon-check"></i> 3 Distinct AI Stems'}</strong></div>
    </div>
    <details class="component-report-details"><summary>View Stem Details</summary>
      <div class="stem-details-grid">
        <div class="stem-detail-item">
          <span class="stem-detail-label"><i class="icon-settings"></i> Separation Mode:</span>
          <span class="stem-detail-val">${escapeHtml(modeLabels[sepMode] || sepMode)}</span>
        </div>
        <div class="stem-detail-item">
          <span class="stem-detail-label"><i class="icon-music"></i> Output Format:</span>
          <span class="stem-detail-val">${escapeHtml(sepFormat)} (${escapeHtml(sepBitrate)})</span>
        </div>
        <div class="stem-detail-item">
          <span class="stem-detail-label"><i class="icon-bot"></i> Stage 1 (Vocals/Inst):</span>
          <code class="stem-detail-code">${escapeHtml(primaryModel)}</code>
        </div>
        <div class="stem-detail-item">
          <span class="stem-detail-label"><i class="icon-mic"></i> Stage 2 (Lead/Back):</span>
          <code class="stem-detail-code">${escapeHtml(karaokeModel)}</code>
        </div>
      </div>
    </details>
  `;
  if (sp.isFallback || sp.status === 'fallback') {
    spBadge = '<span class="status-badge warning"><i class="icon-alert-triangle"></i> Fallback</span>';
  } else if (sp.status === 'error' || song.splitError) {
    spBadge = '<span class="status-badge error"><i class="icon-x"></i> Error</span>';
  } else if (sp.status === 'pending' || song.status === 'splitting') {
    spBadge = '<span class="status-badge pending"><i class="icon-loader-2 icon-spin"></i> Splitting</span>';
  }

  // 3. Lyrics Card
  const lineCount = ly.count || (song.lyrics ? song.lyrics.length : 0);
  const isManual = (ly.provider === 'Manual Import' || song.lyricsProvider === 'Manual Import');
  let lyBadge = '<span class="status-badge success"><i class="icon-check"></i> Synced</span>';
  if (isManual || song.isSynced === false || ly.isSynced === false) {
    lyBadge = '<span class="status-badge success" style="background: rgba(147, 51, 234, 0.15); color: #c084fc; border: 1px solid rgba(147, 51, 234, 0.3);"><i class="icon-pencil"></i> Unsynced</span>';
  }
  let lyDetails = `
    <div class="component-meta-list">
      <div>Lines: <strong>${lineCount}</strong> lines</div>
      <div>Provider: <strong>${escapeHtml(ly.provider || song.lyricsProvider || 'LRC Provider')}</strong></div>
    </div>
  `;
  
  if (!ly.hasLyrics && lineCount === 0) {
    if (ly.status === 'failed' || song.lyricsError) {
      lyBadge = '<span class="status-badge error"><i class="icon-x"></i> No Lyrics</span>';
      lyDetails = `<div style="color:#f87171; font-size:0.8rem;">Error: ${escapeHtml(ly.error || song.lyricsError || 'Lyrics fetch failed across all providers')}</div>`;
    } else {
      lyBadge = '<span class="status-badge warning"><i class="icon-alert-triangle"></i> None</span>';
      lyDetails = `<div class="component-meta-list"><div>No lyrics currently loaded</div></div>`;
    }
  }

  let lyAttemptsHtml = '';
  if (ly.attempts && ly.attempts.length > 0) {
    lyAttemptsHtml = ly.attempts.map(a => {
      let icon = '<i class="icon-x" style="color:#ef4444;"></i>';
      let rowClass = 'failed';
      if (a.status === 'success') { icon = '<i class="icon-check" style="color:#10b981;"></i>'; rowClass = 'success'; }
      else if (a.status === 'partial') { icon = '<i class="icon-alert-triangle" style="color:#f59e0b;"></i>'; rowClass = 'partial'; }
      else if (a.status === 'skipped') { icon = '<i class="icon-skip-forward" style="color:#94a3b8;"></i>'; rowClass = 'skipped'; }
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
      <button class="btn btn-primary" style="flex:1; background:rgba(147, 51, 234, 0.2); border:1px solid #9333ea; color:#d8b4fe;" onclick="openMetadataModal('${song.id}')"><i class="icon-pencil"></i> Edit Meta-data</button>
      <button class="btn btn-primary" style="flex:1; background:rgba(59, 130, 246, 0.2); border:1px solid #3b82f6; color:#93c5fd;" onclick="openSyncEditorModal('${song.id}')"><i class="icon-music"></i> Lyrics & Sync Editor</button>
    </div>

    <!-- Component 1: Audio Download -->
    <div class="component-card component-card-download">
      <div class="component-card-header">
        <div class="component-title"><i class="icon-download"></i> 1. Audio Download</div>
        ${dlBadge}
      </div>
      <div class="component-details">${dlDetails}</div>
      <div class="component-action-row" style="margin-top:0.5rem;">
        <select id="dlSourceSelect_${song.id}" class="select-input" style="font-size:0.8rem; padding:0.35rem 0.6rem;">
          <option value="auto" selected>Auto (SpotDL Preferred)</option>
          <option value="spotdl">SpotDL Only (Spotify Studio)</option>
          <option value="ytdlp">yt-dlp (YouTube Backup)</option>
        </select>
        <button id="retryDlBtn_${song.id}" class="btn btn-secondary" style="font-size:0.8rem; padding:0.4rem 0.8rem;" onclick="retryComponentDownload('${song.id}', this)"><i class="icon-rotate-cw"></i> Retry Audio Download</button>
      </div>
      <div id="dlReportContainer_${song.id}">
        ${dlAttemptsHtml ? `<details class="component-report-details"><summary>View Report</summary><div class="component-report-box">${dlAttemptsHtml}</div></details>` : ''}
      </div>
    </div>

    <!-- Component 2: Stem Separation -->
    <div class="component-card component-card-splitting">
      <div class="component-card-header">
        <div class="component-title"><i class="icon-scissors"></i> 2. Stem Separation</div>
        ${spBadge}
      </div>
      <div class="component-details">${spDetails}</div>
      <div class="component-action-row" style="justify-content: space-between; align-items: center; margin-top: 0.5rem;">
        <button id="retrySpBtn_${song.id}" class="btn btn-secondary" style="font-size:0.8rem; padding:0.4rem 0.8rem;" onclick="retryComponentSplitting('${song.id}', this)"><i class="icon-scissors"></i> Retry Stem Separation</button>
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
              <option value="balanced" ${sepMode === 'balanced' ? 'selected' : ''}>Balanced (UVR-MDX-HQ-3)</option>
              <option value="fast" ${sepMode === 'fast' ? 'selected' : ''}>Fast (UVR-MDX-Inst-1)</option>
              <option value="high" ${sepMode === 'high' ? 'selected' : ''}>High Precision (MDX23C)</option>
              <option value="ultra" ${sepMode === 'ultra' ? 'selected' : ''}>Ultra Quality (BS-Roformer)</option>
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
        <div class="component-title"><i class="icon-file-text"></i> 3. Lyrics</div>
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
          <option value="manual">Manual Import</option>
        </select>
        <button id="retryLyBtn_${song.id}" class="btn btn-secondary" style="font-size:0.8rem; padding:0.4rem 0.8rem;" onclick="retryComponentLyrics('${song.id}', this)"><i class="icon-rotate-cw"></i> Retry Lyrics</button>
      </div>
      
      <!-- Manual Lyrics Paste Area (Shown when Manual Import is chosen) -->
      <div id="manualLyricsContainer_${song.id}" style="display: none; margin-top: 0.75rem;">
        <textarea id="manualLyricsText_${song.id}" class="manual-lyrics-textarea" placeholder="Paste song lyrics here... Each line will be split into unsynced lyrics." rows="5"></textarea>
        <div style="display: flex; justify-content: flex-end; margin-top: 0.5rem;">
          <button id="importManualBtn_${song.id}" class="btn btn-primary" style="font-size:0.8rem; padding:0.4rem 0.9rem;" onclick="importManualLyrics('${song.id}', this)"><i class="icon-pencil"></i> Import Lyrics</button>
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
    container.innerHTML = `<div class="component-report-box loading"><i class="icon-loader-2 icon-spin"></i> Downloading audio track (${sourceDesc})... please wait...</div>`;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="icon-loader-2 icon-spin"></i> Downloading...';
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
      container.innerHTML = `<div class="component-report-box" style="color:#f87171;"><i class="icon-alert-triangle"></i> Download failed: ${escapeHtml(err.message)}</div>`;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="icon-rotate-cw"></i> Retry Audio Download';
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
    container.innerHTML = `<div class="component-report-box loading"><i class="icon-loader-2 icon-spin"></i> Running AI 3-stem separation [${mode.toUpperCase()}, ${format} ${bitrate}]... please wait...</div>`;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="icon-loader-2 icon-spin"></i> Splitting...';
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
      container.innerHTML = `<div class="component-report-box" style="color:#f87171;"><i class="icon-alert-triangle"></i> Splitting failed: ${escapeHtml(err.message)}</div>`;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="icon-scissors"></i> Retry Stem Separation';
    }
  } finally {
    fetchLibrary();
    fetchQueue();
  }
};

window.retryComponentLyrics = async (id, btn) => {
  const container = document.getElementById(`lyReportContainer_${id}`);
  if (container) {
    container.innerHTML = `<div class="component-report-box loading"><i class="icon-loader-2 icon-spin"></i> Fetching synced lyrics from providers... please wait...</div>`;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="icon-loader-2 icon-spin"></i> Fetching...';
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
      container.innerHTML = `<div class="component-report-box" style="color:#f87171;"><i class="icon-alert-triangle"></i> Lyrics retry failed: ${escapeHtml(err.message)}</div>`;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="icon-rotate-cw"></i> Retry Lyrics';
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
    container.innerHTML = `<div class="component-report-box loading"><i class="icon-loader-2 icon-spin"></i> Importing lyrics lines, transliterating & translating... please wait...</div>`;
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="icon-loader-2 icon-spin"></i> Importing...';
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
      container.innerHTML = `<div class="component-report-box" style="color:#f87171;"><i class="icon-alert-triangle"></i> Manual import failed: ${escapeHtml(err.message)}</div>`;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="icon-pencil"></i> Import Lyrics';
    }
  } finally {
    fetchLibrary();
    fetchQueue();
  }
};

window.retryLyrics = async (id, provider = 'auto', e) => {
  if (e && e.target) {
    e.target.disabled = true;
    e.target.innerHTML = '<i class="icon-loader-2 icon-spin"></i>';
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

window.removeFromQueue = async (queueId, event) => {
  if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
  await fetch(`/api/queue/${queueId}`, { method: 'DELETE' });
  if (currentQueueId === queueId || (!currentQueueId && currentSong && currentSong.id === queueId)) {
    const res = await fetch('/api/queue');
    const queueData = await res.json();
    const readySongs = (queueData || []).filter(s => s.status === 'ready');
    if (readySongs.length > 0) {
      await selectSong(readySongs[0].id, currentState.isPlaying, readySongs[0].queueId);
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
    toggleLyricsExpandBtn.innerHTML = isExpanded ? '<i class="icon-minimize-2"></i> Collapse' : '<i class="icon-maximize-2"></i> Expand';
  });
}

// Toggles
const toggleTranslit = document.getElementById('toggleTranslit');
const toggleTranslat = document.getElementById('toggleTranslat');
const toggleKaraokeSlide = document.getElementById('toggleKaraokeSlide');

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
if (toggleKaraokeSlide) {
  toggleKaraokeSlide.addEventListener('change', (e) => {
    socket.emit('update_state', { showKaraokeSlide: e.target.checked });
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
  if (toggleKaraokeSlide) {
    toggleKaraokeSlide.checked = state.showKaraokeSlide !== undefined ? !!state.showKaraokeSlide : true;
  }

  if (state.isPlaying === false) {
    stopSource(sources.leadVoc);
    stopSource(sources.backVoc);
    stopSource(sources.inst);
    sources.leadVoc = null;
    sources.backVoc = null;
    sources.inst = null;
  }

  const isNewTrack = !currentSong || (currentSong.id !== state.songData.id) || (state.queueId && currentQueueId && state.queueId !== currentQueueId);
  if (state.songData && isNewTrack) {
    currentSong = state.songData;
    if (state.queueId) currentQueueId = state.queueId;
    if (currentSongTitle) currentSongTitle.innerText = currentSong.title || 'None';
    const colorSrc = currentSong.id ? `/api/cover/${currentSong.id}` : getHighResAlbumArt(currentSong.albumArt);
    extractColorsFromSongCover(colorSrc);
    setupAudio(currentSong);
    renderLyricsEditor(currentSong.lyrics || []);
    updateLyricsCounter(state.currentTime || 0);
  } else if (!state.songId || !state.songData) {
    currentSong = null;
    currentQueueId = null;
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
    playPauseBtn.innerHTML = '<i class="icon-pause"></i>';
  } else {
    playPauseBtn.innerHTML = '<i class="icon-play"></i>';
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
  } else if (cmd.command === 'pause') {
    if (typeof cmd.time === 'number' && !isNaN(cmd.time)) {
      pauseTime = cmd.time;
      currentState.currentTime = cmd.time;
      if (!isDraggingSlider) {
        timelineSlider.value = cmd.time;
        const maxDur = parseFloat(timelineSlider.max) || 0;
        if (timeDisplay) timeDisplay.innerText = formatTimeDisplay(cmd.time, maxDur);
        updateLyricsCounter(cmd.time);
      }
    }
    if (currentState.isPlaying) {
      pauseAudio();
    }
  } else if (cmd.command === 'toggle_play') {
    togglePlayPause();
  } else if (cmd.command === 'play_prev') {
    playPrev();
  } else if (cmd.command === 'play_next') {
    playNext();
  } else if (cmd.command === 'select_song' && cmd.id) {
    selectSong(cmd.id, true, cmd.queueId);
  } else if (cmd.command === 'set_volumes' && cmd.volumes) {
    if (cmd.volumes.instrumentals !== undefined) volInst.value = cmd.volumes.instrumentals;
    if (cmd.volumes.back !== undefined) volBackVoc.value = cmd.volumes.back;
    if (cmd.volumes.lead !== undefined) volLeadVoc.value = cmd.volumes.lead;
    volInst.dispatchEvent(new Event('input'));
  }
});

// Update timeline slider and lyrics editor tracker continuously
setInterval(() => {
  const modal = document.getElementById('syncEditorModal');
  if (modal && modal.style.display !== 'none' && typeof window.updateSyncEditorTimeIndicator === 'function') {
    window.updateSyncEditorTimeIndicator();
  }

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
}, 50);

fetchLibrary();
fetchQueue();

// Auto-load first available ready song on startup if no song active, or broadcast empty state if queue empty
(async () => {
  try {
    const qRes = await fetch('/api/queue');
    const queue = await qRes.json();
    let readySong = (queue || []).find(s => s.status === 'ready');
    if (readySong) {
      await selectSong(readySong.id, false, readySong.queueId);
    } else {
      clearCurrentSong();
    }
    // Ensure state and UI are strictly paused on tab reload
    currentState.isPlaying = false;
    if (playPauseBtn) playPauseBtn.innerHTML = '<i class="icon-play"></i>';
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

window.lastFocusedSyncRow = null;

window.bulkShiftLyrics = (songId, direction) => {
  if (window.syncEditorBulkShift) {
    window.syncEditorBulkShift(songId, direction);
  }
};

window.addSyncEditorLine = (songId) => {
  if (window.syncEditorAddLineAt) {
    const idx = (window.lyricsEditorState && window.lyricsEditorState.selectedRowIndex >= 0)
      ? window.lyricsEditorState.selectedRowIndex
      : 0;
    window.syncEditorAddLineAt(idx, 'below');
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
        <button type="submit" id="metaSaveBtn_${song.id}" class="btn btn-primary" style="padding:0.4rem 1.2rem; font-size:0.85rem;"><i class="icon-save"></i> Save Changes</button>
      </div>
    </form>
  `;

  modal.style.display = 'flex';
};

// ==========================================================================
// Lyrics & Sync Editor Engine
// ==========================================================================
window.lyricsEditorState = {
  songId: null,
  undoStack: [],
  redoStack: [],
  savedSnapshotJson: '',
  showTranslation: false,
  showTransliteration: false,
  selectedRowIndex: -1,
  typingTimer: null,
  keyHandler: null
};

// Lucide icons using imported styling classes
const LUCIDE_METRONOME_ICON = `<i class="icon-metronome"></i>`;
const LUCIDE_UNDO_ICON = `<i class="icon-undo"></i>`;
const LUCIDE_REDO_ICON = `<i class="icon-redo"></i>`;
const LUCIDE_LANGUAGES_ICON = `<i class="icon-languages"></i>`;
const LUCIDE_SAVE_ICON = `<i class="icon-save"></i>`;
const LUCIDE_PLUS_ICON = `<i class="icon-plus"></i>`;
const LUCIDE_MINUS_ICON = `<i class="icon-minus"></i>`;
const LUCIDE_X_ICON = `<i class="icon-x"></i>`;
const LUCIDE_PLAY_ICON = `<i class="icon-play"></i>`;
const LUCIDE_EAR_ICON = `<i class="icon-ear"></i>`;

window.formatCentiseconds = (totalSeconds) => {
  if (totalSeconds === undefined || totalSeconds === null || isNaN(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  // Compute exact integer centiseconds (100 ticks per second) without floating point modulo inaccuracies
  const totalCs = Math.floor(totalSeconds * 100 + 1e-6);
  const m = Math.floor(totalCs / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

window.parseCentiseconds = (str) => {
  if (typeof str === 'number') return Math.max(0, Math.round(str * 100) / 100);
  if (!str || typeof str !== 'string') return 0;
  str = str.trim().replace(',', '.');
  if (str.includes(':')) {
    const parts = str.split(':');
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return Math.max(0, Math.round((m * 60 + s) * 100) / 100);
  }
  const s = parseFloat(str) || 0;
  return Math.max(0, Math.round(s * 100) / 100);
};

window.updateSyncEditorTimeIndicator = () => {
  const curEl = document.getElementById('syncEditorCurTime');
  const durEl = document.getElementById('syncEditorDurTime');
  if (!curEl || !durEl) return;
  const rawCurTime = getCurrentTime();
  const maxDur = parseFloat(timelineSlider.max) || (currentSong && currentSong.duration ? currentSong.duration : 0);
  const curTime = maxDur > 0 ? Math.min(Math.max(0, rawCurTime), maxDur) : Math.max(0, rawCurTime);
  const formattedCur = window.formatCentiseconds(curTime);
  const formattedDur = window.formatCentiseconds(maxDur);
  if (curEl.innerText !== formattedCur) curEl.innerText = formattedCur;
  if (durEl.innerText !== formattedDur) durEl.innerText = formattedDur;
};

let syncEditorRafId = null;

function startSyncEditorTimeLoop() {
  if (syncEditorRafId) {
    cancelAnimationFrame(syncEditorRafId);
    syncEditorRafId = null;
  }
  const tick = () => {
    const modal = document.getElementById('syncEditorModal');
    if (!modal || modal.style.display === 'none') {
      syncEditorRafId = null;
      return;
    }
    window.updateSyncEditorTimeIndicator();
    syncEditorRafId = requestAnimationFrame(tick);
  };
  syncEditorRafId = requestAnimationFrame(tick);
}

function stopSyncEditorTimeLoop() {
  if (syncEditorRafId) {
    cancelAnimationFrame(syncEditorRafId);
    syncEditorRafId = null;
  }
}

window.jumpSongToTime = async (t, shouldPlay = false) => {
  const songId = lyricsEditorState.songId;
  if (!currentSong || currentSong.id !== songId) {
    if (window.selectSong && songId) {
      await window.selectSong(songId, shouldPlay);
      setTimeout(() => {
        seekToTime(t);
        if (shouldPlay && !currentState.isPlaying) {
          socket.emit('player_command', { command: 'play' });
          playAudio(t);
        }
      }, 400);
      return;
    }
  }
  seekToTime(t);
  if (shouldPlay && !currentState.isPlaying) {
    socket.emit('player_command', { command: 'play' });
    playAudio(t);
  }
};

window.syncEditorPlayLine = (idx) => {
  const songId = lyricsEditorState.songId;
  if (!songId) return;
  const list = document.getElementById(`syncEditorList_${songId}`);
  if (!list) return;
  const wrappers = list.querySelectorAll('.sync-row-wrapper');
  if (!wrappers[idx]) return;
  const timeInp = wrappers[idx].querySelector('.sync-time');
  const t = window.parseCentiseconds(timeInp ? timeInp.value : 0);
  selectSyncRow(idx);
  window.jumpSongToTime(t, true);
};

window.serializeLinesFromDom = (songId) => {
  const list = document.getElementById(`syncEditorList_${songId}`);
  if (!list) return [];
  const wrappers = list.querySelectorAll('.sync-row-wrapper');
  const lines = [];
  wrappers.forEach(w => {
    const timeInput = w.querySelector('.sync-time');
    const textInput = w.querySelector('.sync-text');
    const tlInput = w.querySelector('.sync-tl');
    const trInput = w.querySelector('.sync-tr');
    const t = window.parseCentiseconds(timeInput ? timeInput.value : 0);
    lines.push({
      time: Math.round(t * 100) / 100,
      text: textInput ? textInput.value : '',
      transliteration: tlInput ? tlInput.value : '',
      translation: trInput ? trInput.value : ''
    });
  });
  return lines;
};

window.updateEditorDirtyState = () => {
  const songId = lyricsEditorState.songId;
  if (!songId) return;
  const currentLines = serializeLinesFromDom(songId);
  const isDirty = JSON.stringify(currentLines) !== lyricsEditorState.savedSnapshotJson;

  const badge = document.getElementById('syncEditorStatusBadge');
  if (badge) {
    if (isDirty) {
      badge.className = 'sync-status-badge unsaved';
      badge.innerHTML = `<span class="sync-status-dot"></span><span class="sync-status-text">Unsaved changes</span>`;
    } else {
      badge.className = 'sync-status-badge saved';
      badge.innerHTML = `<span class="sync-status-dot"></span><span class="sync-status-text">Saved</span>`;
    }
  }

  const saveBtn = document.getElementById(`syncSaveBtn_${songId}`);
  if (saveBtn) {
    saveBtn.disabled = !isDirty;
  }
};

window.updateHistoryButtonsState = () => {
  const songId = lyricsEditorState.songId;
  if (!songId) return;
  const undoBtn = document.getElementById(`syncUndoBtn_${songId}`);
  const redoBtn = document.getElementById(`syncRedoBtn_${songId}`);
  if (undoBtn) undoBtn.disabled = lyricsEditorState.undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = lyricsEditorState.redoStack.length === 0;
};

window.pushUndoSnapshot = () => {
  const songId = lyricsEditorState.songId;
  if (!songId) return;
  const currentLines = serializeLinesFromDom(songId);
  const snapStr = JSON.stringify(currentLines);
  if (lyricsEditorState.undoStack.length > 0) {
    const lastSnap = JSON.stringify(lyricsEditorState.undoStack[lyricsEditorState.undoStack.length - 1]);
    if (lastSnap === snapStr) return;
  }
  lyricsEditorState.undoStack.push(currentLines);
  if (lyricsEditorState.undoStack.length > 50) lyricsEditorState.undoStack.shift();
  lyricsEditorState.redoStack = [];
  updateHistoryButtonsState();
};

window.syncEditorUndo = () => {
  if (lyricsEditorState.undoStack.length === 0) return;
  const songId = lyricsEditorState.songId;
  const currentLines = serializeLinesFromDom(songId);
  lyricsEditorState.redoStack.push(currentLines);
  const prevLines = lyricsEditorState.undoStack.pop();
  renderSyncEditorRows(songId, prevLines);
  updateHistoryButtonsState();
  updateEditorDirtyState();
};

window.syncEditorRedo = () => {
  if (lyricsEditorState.redoStack.length === 0) return;
  const songId = lyricsEditorState.songId;
  const currentLines = serializeLinesFromDom(songId);
  lyricsEditorState.undoStack.push(currentLines);
  const nextLines = lyricsEditorState.redoStack.pop();
  renderSyncEditorRows(songId, nextLines);
  updateHistoryButtonsState();
  updateEditorDirtyState();
};

window.selectSyncRow = (idx, options = {}) => {
  const songId = lyricsEditorState.songId;
  if (!songId) return;
  const list = document.getElementById(`syncEditorList_${songId}`);
  if (!list) return;
  const wrappers = list.querySelectorAll('.sync-row-wrapper');
  lyricsEditorState.selectedRowIndex = idx;
  wrappers.forEach((w, i) => {
    if (i === idx) {
      w.classList.add('is-selected');
      window.lastFocusedSyncRow = w.querySelector('.sync-editor-row');
      if (options.scroll) {
        w.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    } else {
      w.classList.remove('is-selected');
    }
  });
};

window.syncEditorAddLineAt = (idx, position) => {
  const songId = lyricsEditorState.songId;
  if (!songId) return;
  pushUndoSnapshot();
  const lines = serializeLinesFromDom(songId);
  let insertIndex = 0;

  if (lines.length === 0) {
    lines.push({ time: 0, text: '', transliteration: '', translation: '' });
    insertIndex = 0;
  } else if (position === 'above') {
    const curTime = lines[idx] ? lines[idx].time : 0;
    let newTime = 0;
    if (idx <= 0) {
      newTime = Math.max(0, curTime - 2);
    } else {
      newTime = (lines[idx - 1].time + curTime) / 2;
    }
    lines.splice(idx, 0, {
      time: Math.round(newTime * 100) / 100,
      text: '',
      transliteration: '',
      translation: ''
    });
    insertIndex = idx;
  } else {
    const curTime = lines[idx] ? lines[idx].time : 0;
    let newTime = 0;
    if (idx >= lines.length - 1) {
      newTime = curTime + 2;
    } else {
      newTime = (curTime + lines[idx + 1].time) / 2;
    }
    lines.splice(idx + 1, 0, {
      time: Math.round(newTime * 100) / 100,
      text: '',
      transliteration: '',
      translation: ''
    });
    insertIndex = idx + 1;
  }

  renderSyncEditorRows(songId, lines);
  selectSyncRow(insertIndex, { scroll: true });
  updateEditorDirtyState();

  const list = document.getElementById(`syncEditorList_${songId}`);
  if (list) {
    const wrappers = list.querySelectorAll('.sync-row-wrapper');
    if (wrappers[insertIndex]) {
      const textInp = wrappers[insertIndex].querySelector('.sync-text');
      if (textInp) textInp.focus();
    }
  }
};

window.syncEditorDeleteLine = (idx) => {
  const songId = lyricsEditorState.songId;
  if (!songId) return;
  pushUndoSnapshot();
  const lines = serializeLinesFromDom(songId);
  lines.splice(idx, 1);
  renderSyncEditorRows(songId, lines);
  if (lines.length > 0) {
    const newIdx = Math.max(0, Math.min(idx, lines.length - 1));
    selectSyncRow(newIdx);
  } else {
    lyricsEditorState.selectedRowIndex = -1;
  }
  updateEditorDirtyState();
};

window.syncEditorBulkShift = (songId, direction) => {
  const shiftVal = parseFloat(document.getElementById(`syncShiftVal_${songId}`).value) || 0.1;
  const amount = shiftVal * direction;
  const list = document.getElementById(`syncEditorList_${songId}`);
  if (!list) return;
  pushUndoSnapshot();
  const rows = list.querySelectorAll('.sync-editor-row');
  rows.forEach(row => {
    const timeInput = row.querySelector('.sync-time');
    let t = window.parseCentiseconds(timeInput.value);
    t += amount;
    if (t < 0) t = 0;
    t = Math.round(t * 100) / 100;
    timeInput.value = window.formatCentiseconds(t);
  });
  updateEditorDirtyState();
};
window.bulkShiftLyrics = window.syncEditorBulkShift;

window.toggleSyncColumn = (type) => {
  const songId = lyricsEditorState.songId;
  if (!songId) return;
  const container = document.getElementById(`syncEditorContainer_${songId}`);
  if (type === 'transliteration') {
    lyricsEditorState.showTransliteration = !lyricsEditorState.showTransliteration;
    localStorage.setItem('lyricsEditor_showTransliteration', lyricsEditorState.showTransliteration);
    if (container) container.classList.toggle('hide-transliteration', !lyricsEditorState.showTransliteration);
    const btn = document.getElementById(`syncToggleTlBtn_${songId}`);
    if (btn) btn.classList.toggle('active', lyricsEditorState.showTransliteration);
  } else if (type === 'translation') {
    lyricsEditorState.showTranslation = !lyricsEditorState.showTranslation;
    localStorage.setItem('lyricsEditor_showTranslation', lyricsEditorState.showTranslation);
    if (container) container.classList.toggle('hide-translation', !lyricsEditorState.showTranslation);
    const btn = document.getElementById(`syncToggleTrBtn_${songId}`);
    if (btn) btn.classList.toggle('active', lyricsEditorState.showTranslation);
  }
};

window.saveSyncEditorLyrics = async (songId) => {
  const list = document.getElementById(`syncEditorList_${songId}`);
  if (!list) return;

  const newLyrics = serializeLinesFromDom(songId);
  newLyrics.sort((a, b) => a.time - b.time);
  newLyrics.forEach(l => l.time = Math.round(l.time * 100) / 100);

  const saveBtn = document.getElementById(`syncSaveBtn_${songId}`);
  if (saveBtn) saveBtn.disabled = true;

  try {
    const res = await fetch('/api/edit_lyrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId, lyrics: newLyrics })
    });
    const data = await res.json();
    if (data.success) {
      lyricsEditorState.savedSnapshotJson = JSON.stringify(newLyrics);
      updateEditorDirtyState();

      if (window.currentManagerSong && window.currentManagerSong.id === songId) {
        window.currentManagerSong.lyrics = newLyrics;
      }

      if (currentSong && currentSong.id === songId) {
        currentSong.lyrics = newLyrics;
        socket.emit('update_state', { songId: currentSong.id, songData: currentSong });
      }

      alert('Lyrics & sync saved successfully!');
    } else {
      alert('Failed to save lyrics.');
      updateEditorDirtyState();
    }
  } catch (e) {
    console.error('Error saving sync editor lyrics:', e);
    alert('Error saving synced lyrics.');
    updateEditorDirtyState();
  }
};

window.renderSyncEditorRows = (songId, lines) => {
  const list = document.getElementById(`syncEditorList_${songId}`);
  if (!list) return;

  const countEl = document.getElementById(`syncLineCount_${songId}`);
  if (countEl) countEl.innerText = `${lines.length} lines`;

  if (lines.length === 0) {
    list.innerHTML = `
      <div class="sync-empty-state">
        <p>No lyrics found for this song.</p>
        <button type="button" class="btn btn-primary" onclick="syncEditorAddLineAt(0, 'below')" style="font-size:0.75rem; padding:0.35rem 0.8rem; display:inline-flex; align-items:center; gap:0.35rem;">
          ${LUCIDE_PLUS_ICON} Add First Line
        </button>
      </div>
    `;
    return;
  }

  const selectedIdx = lyricsEditorState.selectedRowIndex >= 0 ? Math.min(lyricsEditorState.selectedRowIndex, lines.length - 1) : 0;
  lyricsEditorState.selectedRowIndex = selectedIdx;

  let html = '';
  lines.forEach((line, idx) => {
    const isSel = idx === selectedIdx;
    const t = parseFloat(line.time) || 0;
    html += `
      <div class="sync-row-wrapper ${isSel ? 'is-selected' : ''}" data-idx="${idx}">
        <button type="button" class="btn-add-line-strip btn-add-line-top" onclick="syncEditorAddLineAt(${idx}, 'above')" title="Add line above">
          ${LUCIDE_PLUS_ICON} <span>Add line above</span>
        </button>
        <div class="sync-editor-row" data-idx="${idx}">
          <button type="button" class="sync-line-play-btn sync-col-play" onclick="syncEditorPlayLine(${idx})" title="Jump song to this line">
            ${LUCIDE_PLAY_ICON}
          </button>
          <input type="text" inputmode="decimal" class="sync-time sync-col-time" value="${formatCentiseconds(t)}" title="Time (mm:ss.cs)">
          <input type="text" class="sync-text sync-col-text" value="${escapeHtml(line.text || '')}" placeholder="#INSTRUMENTAL">
          <input type="text" class="sync-tl sync-col-tl" value="${escapeHtml(line.transliteration || '')}" placeholder="Transliteration...">
          <input type="text" class="sync-tr sync-col-tr" value="${escapeHtml(line.translation || '')}" placeholder="Translation...">
          <button type="button" class="sync-del-btn sync-col-actions" onclick="syncEditorDeleteLine(${idx})" title="Delete line">
            ${LUCIDE_X_ICON}
          </button>
        </div>
        <button type="button" class="btn-add-line-strip btn-add-line-bottom" onclick="syncEditorAddLineAt(${idx}, 'below')" title="Add line below">
          ${LUCIDE_PLUS_ICON} <span>Add line below</span>
        </button>
      </div>
    `;
  });

  list.innerHTML = html;

  const wrappers = list.querySelectorAll('.sync-row-wrapper');
  wrappers.forEach((w, idx) => {
    w.addEventListener('click', (e) => {
      if (!e.target.closest('.btn-add-line-strip') && !e.target.closest('.sync-del-btn') && !e.target.closest('.sync-line-play-btn')) {
        selectSyncRow(idx);
      }
    });

    const timeInp = w.querySelector('.sync-time');
    const textInp = w.querySelector('.sync-text');
    const tlInp = w.querySelector('.sync-tl');
    const trInp = w.querySelector('.sync-tr');

    [timeInp, textInp, tlInp, trInp].forEach(inp => {
      if (!inp) return;
      inp.addEventListener('focus', () => selectSyncRow(idx));
      inp.addEventListener('input', () => {
        updateEditorDirtyState();
        clearTimeout(lyricsEditorState.typingTimer);
        lyricsEditorState.typingTimer = setTimeout(() => {
          pushUndoSnapshot();
        }, 500);
      });
    });

    if (timeInp) {
      const commitTimeInput = () => {
        const val = window.parseCentiseconds(timeInp.value);
        timeInp.value = window.formatCentiseconds(val);
        window.jumpSongToTime(val);
        updateEditorDirtyState();
      };

      timeInp.addEventListener('change', commitTimeInput);
      timeInp.addEventListener('blur', commitTimeInput);
      timeInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitTimeInput();
          timeInp.blur();
        }
      });
    }
  });

  if (tapSyncState.active) {
    tapSyncState.rows = Array.from(list.querySelectorAll('.sync-row-wrapper'));
  }
};

window.openSyncEditorModal = async (songId) => {
  let song = window.currentManagerSong;
  if (!song || song.id !== songId || !song.lyrics) {
    try {
      const res = await fetch(`/api/song_details/${songId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.song) {
          song = data.song;
          window.currentManagerSong = song;
        }
      }
    } catch (e) {
      console.warn('Failed to fetch song details for sync editor:', e);
    }
  }

  if (!song && window.currentSong && window.currentSong.id === songId) {
    song = window.currentSong;
  }

  if (!song) return;

  const modal = document.getElementById('syncEditorModal');
  const bodyEl = document.getElementById('syncEditorModalBody');
  if (!modal || !bodyEl) return;

  const existingLyrics = (song.lyrics || []).map(l => ({
    time: Math.round((parseFloat(l.time) || 0) * 100) / 100,
    text: l.text || '',
    transliteration: l.transliteration || '',
    translation: l.translation || ''
  }));

  const hasTranslit = existingLyrics.some(l => l.transliteration && l.transliteration.trim() !== '');
  const hasTrans = existingLyrics.some(l => l.translation && l.translation.trim() !== '');

  const savedTlPref = localStorage.getItem('lyricsEditor_showTransliteration');
  const savedTrPref = localStorage.getItem('lyricsEditor_showTranslation');

  lyricsEditorState.songId = songId;
  lyricsEditorState.undoStack = [];
  lyricsEditorState.redoStack = [];
  lyricsEditorState.showTransliteration = savedTlPref !== null ? (savedTlPref === 'true') : hasTranslit;
  lyricsEditorState.showTranslation = savedTrPref !== null ? (savedTrPref === 'true') : hasTrans;
  lyricsEditorState.selectedRowIndex = existingLyrics.length > 0 ? 0 : -1;
  lyricsEditorState.savedSnapshotJson = JSON.stringify(existingLyrics);

  bodyEl.innerHTML = `
    <div id="syncEditorContainer_${song.id}" class="${!lyricsEditorState.showTransliteration ? 'hide-transliteration' : ''} ${!lyricsEditorState.showTranslation ? 'hide-translation' : ''}">
      <div class="sync-toolbar">
        <div class="sync-toolbar-left">
          <div class="sync-shift-group">
            <span class="sync-shift-label">Shift:</span>
            <button type="button" class="sync-shift-btn" onclick="syncEditorBulkShift('${song.id}', -1)" title="Shift earlier (-)">
              ${LUCIDE_MINUS_ICON}
            </button>
            <input type="text" id="syncShiftVal_${song.id}" value="0.10" class="sync-shift-input" title="Bulk shift amount in seconds">
            <span class="sync-unit-label">(s)</span>
            <button type="button" class="sync-shift-btn" onclick="syncEditorBulkShift('${song.id}', 1)" title="Shift later (+)">
              ${LUCIDE_PLUS_ICON}
            </button>
          </div>
          <div class="sync-playback-tracker" title="Current Playback Time / Total Duration">
            <span class="sync-tracker-icon"><i class="icon-timer"></i></span>
            <span id="syncEditorCurTime">00:00.00</span>
            <span class="sync-tracker-slash">/</span>
            <span id="syncEditorDurTime">00:00.00</span>
          </div>
          <span id="syncLineCount_${song.id}" class="sync-line-count-badge">${existingLyrics.length} lines</span>
        </div>

        <div class="sync-toolbar-right">
          <!-- Undo / Redo -->
          <div class="sync-btn-group">
            <button type="button" id="syncUndoBtn_${song.id}" class="sync-btn-icon" onclick="syncEditorUndo()" title="Undo (Ctrl+Z)" disabled>
              ${LUCIDE_UNDO_ICON}
            </button>
            <button type="button" id="syncRedoBtn_${song.id}" class="sync-btn-icon" onclick="syncEditorRedo()" title="Redo (Ctrl+Y / Ctrl+Shift+Z)" disabled>
              ${LUCIDE_REDO_ICON}
            </button>
          </div>

          <div class="sync-toolbar-divider"></div>

          <!-- Column Toggles -->
          <div class="sync-btn-group">
            <button type="button" id="syncToggleTlBtn_${song.id}" class="sync-btn-icon ${lyricsEditorState.showTransliteration ? 'active' : ''}" onclick="toggleSyncColumn('transliteration')" title="Toggle Transliteration Column">
              ${LUCIDE_EAR_ICON}
            </button>
            <button type="button" id="syncToggleTrBtn_${song.id}" class="sync-btn-icon ${lyricsEditorState.showTranslation ? 'active' : ''}" onclick="toggleSyncColumn('translation')" title="Toggle Translation Column">
              ${LUCIDE_LANGUAGES_ICON}
            </button>
          </div>

          <div class="sync-toolbar-divider"></div>

          <!-- Tap to Sync -->
          <div class="sync-btn-group">
            <button type="button" id="tapSyncBtn_${song.id}" class="sync-btn-icon sync-metronome-btn" onclick="toggleTapToSyncMode('${song.id}')" title="Tap to Sync Mode">
              ${LUCIDE_METRONOME_ICON}
            </button>
          </div>

          <div class="sync-toolbar-divider"></div>

          <!-- Save Button -->
          <div class="sync-btn-group">
            <button type="button" id="syncSaveBtn_${song.id}" class="sync-btn-icon sync-save-btn" onclick="saveSyncEditorLyrics('${song.id}')" title="Save Lyrics & Sync (Ctrl+S)" disabled>
              ${LUCIDE_SAVE_ICON}
            </button>
          </div>
        </div>
      </div>

      <!-- Column Headers -->
      <div class="sync-col-headers">
        <div class="sync-col-hdr sync-col-play"></div>
        <div class="sync-col-hdr sync-col-time" title="Minutes:Seconds.Centiseconds (mm:ss.cs)">Time</div>
        <div class="sync-col-hdr sync-col-text">Lyrics</div>
        <div class="sync-col-hdr sync-col-tl">Transliteration</div>
        <div class="sync-col-hdr sync-col-tr">Translation</div>
        <div class="sync-col-hdr sync-col-actions"></div>
      </div>

      <!-- Rows List -->
      <div id="syncEditorList_${song.id}" class="sync-editor-list"></div>
    </div>
  `;

  modal.style.display = 'flex';
  renderSyncEditorRows(song.id, existingLyrics);
  updateEditorDirtyState();
  updateHistoryButtonsState();
  updateSyncEditorTimeIndicator();
  startSyncEditorTimeLoop();

  if (lyricsEditorState.keyHandler) {
    document.removeEventListener('keydown', lyricsEditorState.keyHandler);
  }

  lyricsEditorState.keyHandler = (e) => {
    const m = document.getElementById('syncEditorModal');
    if (!m || m.style.display === 'none') return;

    if (e.key === 'Escape' && !tapSyncState.active) {
      e.preventDefault();
      closeLyricsSyncModal();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      syncEditorUndo();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault();
      syncEditorRedo();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      const saveBtn = document.getElementById(`syncSaveBtn_${lyricsEditorState.songId}`);
      if (saveBtn && !saveBtn.disabled) {
        saveSyncEditorLyrics(lyricsEditorState.songId);
      }
      return;
    }
  };

  document.addEventListener('keydown', lyricsEditorState.keyHandler);
};

window.closeLyricsSyncModal = () => {
  const modal = document.getElementById('syncEditorModal');
  if (!modal || modal.style.display === 'none') return;

  if (lyricsEditorState.songId) {
    const currentLines = serializeLinesFromDom(lyricsEditorState.songId);
    if (JSON.stringify(currentLines) !== lyricsEditorState.savedSnapshotJson) {
      if (!confirm('You have unsaved changes in Lyrics & Sync Editor. Discard and close?')) {
        return;
      }
    }
  }

  stopSyncEditorTimeLoop();

  if (tapSyncState.active) {
    window.toggleTapToSyncMode(tapSyncState.songId);
  }

  if (lyricsEditorState.keyHandler) {
    document.removeEventListener('keydown', lyricsEditorState.keyHandler);
    lyricsEditorState.keyHandler = null;
  }

  modal.style.display = 'none';
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
      closeLyricsSyncModal();
    }
  });
}

const closeSyncEditorModalBtn = document.getElementById('closeSyncEditorModalBtn');
if (closeSyncEditorModalBtn) {
  closeSyncEditorModalBtn.addEventListener('click', () => {
    closeLyricsSyncModal();
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
      btn.classList.remove('active');
      btn.title = 'Tap to Sync Mode';
    }
    return;
  }

  tapSyncState.active = true;
  tapSyncState.songId = songId;
  tapSyncState.currentIndex = lyricsEditorState.selectedRowIndex >= 0 ? lyricsEditorState.selectedRowIndex : 0;

  const list = document.getElementById(`syncEditorList_${songId}`);
  if (!list) return;

  tapSyncState.rows = Array.from(list.querySelectorAll('.sync-row-wrapper'));
  if (tapSyncState.rows.length === 0) {
    tapSyncState.active = false;
    alert('No lyrics to sync. Add some lines first.');
    return;
  }

  const btn = document.getElementById(`tapSyncBtn_${songId}`);
  if (btn) {
    btn.classList.add('active');
    btn.title = 'Stop Syncing (Escape)';
  }

  if (!currentSong || currentSong.id !== songId) {
    selectSong(songId, true);
  } else if (!currentState.isPlaying) {
    playAudio(getCurrentTime());
  }

  highlightTapSyncRow();

  tapSyncState.keyHandler = (e) => {
    if (e.target && e.target.tagName && e.target.tagName.toUpperCase() === 'INPUT' && e.target.type === 'text') return;

    const modal = document.getElementById('syncEditorModal');
    if (!modal || modal.style.display === 'none') {
      window.toggleTapToSyncMode(songId);
      return;
    }

    const handledKeys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Escape', '<', '>', ',', '.'];
    const handledCodes = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Escape', 'Comma', 'Period'];
    if (handledKeys.includes(e.key) || handledCodes.includes(e.code)) {
      e.stopPropagation();
      e.stopImmediatePropagation();
    }

    if (e.code === 'ArrowDown') {
      e.preventDefault();
      const rowWrapper = tapSyncState.rows[tapSyncState.currentIndex];
      if (rowWrapper) {
        pushUndoSnapshot();
        const timeInput = rowWrapper.querySelector('.sync-time');
        const stamp = window.formatCentiseconds(Math.max(0, getCurrentTime()));
        timeInput.value = stamp;
        timeInput.style.background = 'rgba(59, 130, 246, 0.4)';
        setTimeout(() => timeInput.style.background = 'rgba(0,0,0,0.45)', 400);
        updateEditorDirtyState();
      }

      tapSyncState.currentIndex++;
      if (tapSyncState.currentIndex >= tapSyncState.rows.length) {
        window.toggleTapToSyncMode(songId);
      } else {
        highlightTapSyncRow();
      }
    } else if (e.code === 'ArrowUp' || e.key === ',' || e.key === '<') {
      e.preventDefault();
      if (tapSyncState.currentIndex > 0) {
        tapSyncState.currentIndex--;
        highlightTapSyncRow();
        const rowWrapper = tapSyncState.rows[tapSyncState.currentIndex];
        if (rowWrapper) {
          const timeInput = rowWrapper.querySelector('.sync-time');
          const t = window.parseCentiseconds(timeInput.value);
          seekToTime(t);
        }
      }
    } else if (e.key === '.' || e.key === '>') {
      e.preventDefault();
      if (tapSyncState.currentIndex < tapSyncState.rows.length - 1) {
        tapSyncState.currentIndex++;
        highlightTapSyncRow();
        const rowWrapper = tapSyncState.rows[tapSyncState.currentIndex];
        if (rowWrapper) {
          const timeInput = rowWrapper.querySelector('.sync-time');
          const t = window.parseCentiseconds(timeInput.value);
          seekToTime(t);
        }
      }
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const rowWrapper = tapSyncState.rows[tapSyncState.currentIndex];
      if (rowWrapper) {
        pushUndoSnapshot();
        const timeInput = rowWrapper.querySelector('.sync-time');
        let val = window.parseCentiseconds(timeInput.value);
        const shiftAmount = e.shiftKey ? 0.05 : 0.5;
        if (e.code === 'ArrowLeft') {
          val -= shiftAmount;
        } else {
          val += shiftAmount;
        }
        val = Math.max(0, Math.round(val * 100) / 100);
        timeInput.value = window.formatCentiseconds(val);
        timeInput.style.background = 'rgba(16, 185, 129, 0.4)';
        setTimeout(() => timeInput.style.background = 'rgba(0,0,0,0.45)', 400);
        seekToTime(val);
        updateEditorDirtyState();
      }
    } else if (e.code === 'Escape') {
      window.toggleTapToSyncMode(songId);
    }
  };

  document.addEventListener('keydown', tapSyncState.keyHandler);
};

function highlightTapSyncRow() {
  selectSyncRow(tapSyncState.currentIndex, { scroll: true });
}

// ============================================================================
// Panel Border Resizing & Double-Tap Reset (Dashboard)
// ============================================================================
function initDashboardResizers() {
  const app = document.getElementById('app');
  const upperPanel = document.querySelector('.upper-panel');
  const lowerPanel = document.querySelector('.lower-panel');
  const upperLeft = document.querySelector('.upper-left');
  const upperRight = document.querySelector('.upper-right');
  const lowerContainer = document.querySelector('.lower-container');
  const audioControlsCard = document.querySelector('.audio-controls-card');
  const mixerCard = document.querySelector('.mixer-card');

  const resizerDashVertical = document.getElementById('resizerDashVertical');
  const resizerUpperSplit = document.getElementById('resizerUpperSplit');
  const resizerLowerSplit = document.getElementById('resizerLowerSplit');

  if (!app) return;

  // Restore saved splits from localStorage
  try {
    const savedDashVert = localStorage.getItem('ctrlaltlyrics_resizer_dash_vert');
    if (savedDashVert) {
      const p = parseFloat(savedDashVert);
      if (!isNaN(p) && p >= 20 && p <= 80) {
        app.style.setProperty('--upper-panel-flex', `${p} 1 0px`);
        app.style.setProperty('--lower-panel-flex', `${100 - p} 1 0px`);
      }
    }

    const savedUpperSplit = localStorage.getItem('ctrlaltlyrics_resizer_upper_split');
    if (savedUpperSplit) {
      const p = parseFloat(savedUpperSplit);
      if (!isNaN(p) && p >= 20 && p <= 80) {
        app.style.setProperty('--upper-left-flex', `${p} 1 0px`);
        app.style.setProperty('--upper-right-flex', `${100 - p} 1 0px`);
      }
    }

    const savedUpperMobileH = localStorage.getItem('ctrlaltlyrics_resizer_upper_mobile_h');
    if (savedUpperMobileH) {
      const h = parseFloat(savedUpperMobileH);
      if (!isNaN(h) && h >= 60) {
        app.style.setProperty('--upper-left-height', `${h}px`);
      }
    }

    const savedLowerSplit = localStorage.getItem('ctrlaltlyrics_resizer_lower_split');
    if (savedLowerSplit) {
      const p = parseFloat(savedLowerSplit);
      if (!isNaN(p) && p >= 30 && p <= 75) {
        app.style.setProperty('--audio-controls-flex', `${p} 1 0px`);
        app.style.setProperty('--mixer-card-flex', `${100 - p} 1 0px`);
        app.style.setProperty('--mixer-card-width', 'auto');
        app.style.setProperty('--mixer-card-max-width', 'none');
      }
    }
  } catch (err) {
    console.warn('Could not restore dashboard resizers:', err);
  }

  // Helper to attach pointer drag + double tap reset
  function attachResizer(el, { getDirection, onDrag, onReset }) {
    if (!el) return;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let movedEnough = false;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      const now = Date.now();
      const tapDist = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY);
      if (now - lastTapTime < 380 && tapDist < 25) {
        e.preventDefault();
        onReset();
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;

      isDragging = true;
      movedEnough = false;
      startX = e.clientX;
      startY = e.clientY;

      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {}

      const dir = typeof getDirection === 'function' ? getDirection() : 'col';
      document.body.classList.add(dir === 'row' ? 'is-resizing-row' : 'is-resizing-col');
    });

    el.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      if (!movedEnough && Math.hypot(e.clientX - startX, e.clientY - startY) > 3) {
        movedEnough = true;
      }
      if (movedEnough) {
        onDrag(e);
      }
    });

    const stopDragging = (e) => {
      if (!isDragging) return;
      isDragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch (_) {}
      document.body.classList.remove('is-resizing-row', 'is-resizing-col');
    };

    el.addEventListener('pointerup', stopDragging);
    el.addEventListener('pointercancel', stopDragging);

    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      onReset();
    });
  }

  // 1. Vertical Split: Upper Panel vs Lower Panel
  attachResizer(resizerDashVertical, {
    getDirection: () => 'row',
    onDrag: (e) => {
      const appRect = app.getBoundingClientRect();
      const minUpperPx = 140;
      const minLowerPx = 120;
      let upperHeight = e.clientY - appRect.top;
      upperHeight = Math.max(minUpperPx, Math.min(appRect.height - minLowerPx, upperHeight));
      let upperPercent = (upperHeight / appRect.height) * 100;
      upperPercent = Math.max(15, Math.min(85, upperPercent));
      const lowerPercent = 100 - upperPercent;
      app.style.setProperty('--upper-panel-flex', `${upperPercent} 1 0px`);
      app.style.setProperty('--lower-panel-flex', `${lowerPercent} 1 0px`);
      try {
        localStorage.setItem('ctrlaltlyrics_resizer_dash_vert', upperPercent.toFixed(2));
      } catch (_) {}
    },
    onReset: () => {
      app.style.removeProperty('--upper-panel-flex');
      app.style.removeProperty('--lower-panel-flex');
      app.style.removeProperty('--upper-panel-height');
      app.style.removeProperty('--lower-panel-height');
      try {
        localStorage.removeItem('ctrlaltlyrics_resizer_dash_vert');
      } catch (_) {}
    }
  });

  // 2. Upper Split: Search/Queue vs Library
  attachResizer(resizerUpperSplit, {
    getDirection: () => (window.innerWidth <= 900 ? 'row' : 'col'),
    onDrag: (e) => {
      if (!upperPanel) return;
      const upperRect = upperPanel.getBoundingClientRect();
      if (window.innerWidth <= 900) {
        const leftHeight = e.clientY - upperRect.top;
        const minH = 80;
        const maxH = Math.max(minH, upperRect.height - 80);
        const clampedH = Math.max(minH, Math.min(maxH, leftHeight));
        app.style.setProperty('--upper-left-height', `${clampedH}px`);
        try {
          localStorage.setItem('ctrlaltlyrics_resizer_upper_mobile_h', clampedH.toFixed(0));
        } catch (_) {}
      } else {
        const leftWidth = e.clientX - upperRect.left;
        let leftPercent = (leftWidth / upperRect.width) * 100;
        leftPercent = Math.max(15, Math.min(85, leftPercent));
        const rightPercent = 100 - leftPercent;
        app.style.setProperty('--upper-left-flex', `${leftPercent} 1 0px`);
        app.style.setProperty('--upper-right-flex', `${rightPercent} 1 0px`);
        try {
          localStorage.setItem('ctrlaltlyrics_resizer_upper_split', leftPercent.toFixed(2));
        } catch (_) {}
      }
    },
    onReset: () => {
      app.style.removeProperty('--upper-left-flex');
      app.style.removeProperty('--upper-right-flex');
      app.style.removeProperty('--upper-left-height');
      try {
        localStorage.removeItem('ctrlaltlyrics_resizer_upper_split');
        localStorage.removeItem('ctrlaltlyrics_resizer_upper_mobile_h');
      } catch (_) {}
    }
  });

  // 3. Lower Split: Audio Controls vs Mixer Card
  attachResizer(resizerLowerSplit, {
    getDirection: () => 'col',
    onDrag: (e) => {
      if (!lowerContainer) return;
      const containerRect = lowerContainer.getBoundingClientRect();
      const minControlsPx = 180;
      const minMixerPx = 180;
      let controlsWidth = e.clientX - containerRect.left;
      controlsWidth = Math.max(minControlsPx, Math.min(containerRect.width - minMixerPx, controlsWidth));
      let controlsPercent = (controlsWidth / containerRect.width) * 100;
      controlsPercent = Math.max(20, Math.min(80, controlsPercent));
      const mixerPercent = 100 - controlsPercent;
      app.style.setProperty('--audio-controls-flex', `${controlsPercent} 1 0px`);
      app.style.setProperty('--mixer-card-flex', `${mixerPercent} 1 0px`);
      app.style.setProperty('--mixer-card-width', 'auto');
      app.style.setProperty('--mixer-card-max-width', 'none');
      try {
        localStorage.setItem('ctrlaltlyrics_resizer_lower_split', controlsPercent.toFixed(2));
      } catch (_) {}
    },
    onReset: () => {
      app.style.removeProperty('--audio-controls-flex');
      app.style.removeProperty('--mixer-card-flex');
      app.style.removeProperty('--mixer-card-width');
      app.style.removeProperty('--mixer-card-max-width');
      try {
        localStorage.removeItem('ctrlaltlyrics_resizer_lower_split');
      } catch (_) {}
    }
  });
}

initDashboardResizers();
