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
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
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

  const fetchPromises = [];
  if (song.stems && song.stems.lead) fetchPromises.push(fetch(song.stems.lead).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => sources.leadBuf = b));
  if (song.stems && song.stems.back) fetchPromises.push(fetch(song.stems.back).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => sources.backBuf = b));
  if (song.stems && song.stems.inst) fetchPromises.push(fetch(song.stems.inst).then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(b => sources.instBuf = b));

  audioLoadingPromise = Promise.all(fetchPromises).then(() => {
    playPauseBtn.disabled = false;
    timelineSlider.disabled = false;
    const dur = sources.leadBuf ? sources.leadBuf.duration : (sources.instBuf ? sources.instBuf.duration : (sources.backBuf ? sources.backBuf.duration : 0));
    timelineSlider.max = dur;
    if (timeDisplay) timeDisplay.innerText = `0:00 / ${formatTime(dur)}`;
    updateLyricsCounter(0);
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
  if (timeDisplay) timeDisplay.innerText = `${formatTime(targetTime)} / ${formatTime(timelineSlider.max)}`;
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
  if (timeDisplay) timeDisplay.innerText = `${formatTime(target)} / ${formatTime(timelineSlider.max)}`;
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
  socket.emit('update_state', { 
    volumes: { 
      ...currentState.volumes, 
      instrumentals: volInst.value, 
      back: volBackVoc.value,
      lead: volLeadVoc.value
    } 
  });
});

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
          <button class="emoji-btn" onclick="retryLyrics('${song.id}', 'auto', event)" title="Retry Lyrics">🔄</button>
          <button class="emoji-btn emoji-btn-danger" onclick="confirmRemoveFromLibrary('${song.id}')" title="Delete from Library">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

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
searchBtn.addEventListener('click', async () => {
  const q = searchInput.value.trim();
  if(!q) {
    searchResults.style.display = 'none';
    return;
  }
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query: q})
  });
  const data = await res.json();
  if (data && data.length > 0) {
    searchResults.style.display = 'flex';
    searchResults.innerHTML = data.map(song => `
      <div class="song-card search-card" tabindex="0" data-song='${JSON.stringify(song).replace(/'/g, "&#39;")}' style="outline: none;">
        <img src="${song.albumArt}" alt="art">
        <div class="song-info">
          <div class="song-title">${song.title}</div>
          <div class="song-artist">${song.artist}</div>
        </div>
        <button class="btn" onclick='enqueueNewSong(${JSON.stringify(song).replace(/'/g, "&#39;")})'>Queue</button>
      </div>
    `).join('');
  } else {
    searchResults.style.display = 'none';
  }
});

searchInput.addEventListener('input', (e) => {
  if (!e.target.value.trim()) {
    searchResults.style.display = 'none';
  }
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    searchBtn.click();
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
      pauseTime = 0;
      currentState.currentTime = 0;
      currentState.isPlaying = false;
      timelineSlider.value = 0;
      if (timeDisplay) timeDisplay.innerText = `0:00 / ${formatTime(timelineSlider.max)}`;
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
  pauseTime = 0;
  currentState.isPlaying = false;
  currentState.currentTime = 0;
  currentState.songId = null;
  currentState.songData = null;
  playPauseBtn.innerText = '▶';
  if (currentSongTitle) currentSongTitle.innerText = 'None';
  timelineSlider.value = 0;
  timelineSlider.disabled = true;
  if (timeDisplay) timeDisplay.innerText = '0:00 / 0:00';
  updateLyricsCounter(0);
  renderLyricsEditor([]);
  socket.emit('update_state', { songId: null, currentTime: 0, isPlaying: false, songData: null });
}

async function handleSongFinished() {
  if (isHandlingSongEnd) return;
  isHandlingSongEnd = true;
  pauseAudio();
  
  const maxDur = parseFloat(timelineSlider.max) || 0;
  timelineSlider.value = maxDur;
  if (timeDisplay) {
    timeDisplay.innerText = `${formatTime(maxDur)} / ${formatTime(maxDur)}`;
  }
  updateLyricsCounter(maxDur);

  if (currentSong) {
    const finishedId = currentSong.id;
    // Remove finished song from queue
    try {
      await fetch(`/api/queue/${finishedId}`, { method: 'DELETE' });
    } catch(e) {
      console.error("Error removing finished song from queue:", e);
    }
    
    // Fetch updated queue
    const res = await fetch('/api/queue');
    const queueData = await res.json();
    renderQueue(queueData);
    
    const nextSong = (queueData || []).find(s => s.status === 'ready');
    if (nextSong) {
      await selectSong(nextSong.id, true);
    } else {
      clearCurrentSong();
    }
  }
  isHandlingSongEnd = false;
}

window.openFolder = (id) => {
  fetch(`/api/open_folder/${id}`, { method: 'POST' });
};

function showLyricsReportModal(songTitle, attempts = [], provider = null, lyricsCount = 0, lyricsError = null) {
  const modal = document.getElementById('lyricsReportModal');
  const titleEl = document.getElementById('lyricsReportTitle');
  const bodyEl = document.getElementById('lyricsReportBody');

  if (!modal || !bodyEl) return;

  // 1. Console Logging Report
  console.group(`🎵 Lyrics Search Report: "${songTitle}"`);
  console.log(`Final Outcome: ${provider ? 'SUCCESS via ' + provider : 'FAILED (' + (lyricsError || 'No lyrics found') + ')'}`);
  console.log(`Lyrics count: ${lyricsCount} lines`);
  console.log("Provider attempts checklist:");
  (attempts || []).forEach((a, i) => {
    const icon = a.status === 'success' ? '✅' : (a.status === 'failed' ? '❌' : (a.status === 'partial' ? '⚠️' : '⏭️'));
    console.log(`  ${i + 1}. [${icon} ${a.status.toUpperCase()}] ${a.provider}: ${a.detail}`);
  });
  console.groupEnd();

  // 2. UI Pop-Up Modal
  if (titleEl) titleEl.innerText = `🎵 Lyrics Report: "${songTitle}"`;

  const outcomeStyle = provider ? 'color: #34d399; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3);' : 'color: #f87171; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3);';
  const outcomeText = provider 
    ? `✅ Successfully loaded <strong>${lyricsCount}</strong> lyric lines via <strong>${escapeHtml(provider)}</strong>`
    : `❌ Failed to fetch lyrics (${escapeHtml(lyricsError || 'No match across any provider')})`;

  let attemptsHtml = '';
  if (attempts && attempts.length > 0) {
    attemptsHtml = attempts.map(a => {
      let icon = '❌';
      let rowClass = 'failed';
      if (a.status === 'success') {
        icon = '✅';
        rowClass = 'success';
      } else if (a.status === 'partial') {
        icon = '⚠️';
        rowClass = 'partial';
      } else if (a.status === 'skipped') {
        icon = '⏭️';
        rowClass = 'skipped';
      }
      return `
        <div class="attempt-row ${rowClass}">
          <div>
            <strong>${icon} ${escapeHtml(a.provider)}</strong>
            <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">${escapeHtml(a.detail)}</div>
          </div>
          <span style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing: 0.05em;">${escapeHtml(a.status)}</span>
        </div>
      `;
    }).join('');
  } else {
    attemptsHtml = `<div class="empty-state">No attempt details logged.</div>`;
  }

  bodyEl.innerHTML = `
    <div style="margin-bottom: 1rem; padding: 0.75rem 1rem; border-radius: 8px; ${outcomeStyle} font-size: 0.9rem;">
      ${outcomeText}
    </div>
    <h4 style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em;">Provider Attempt History</h4>
    ${attemptsHtml}
  `;

  modal.style.display = 'flex';
}

// Modal Event Listeners
const closeModalBtn = document.getElementById('closeLyricsReportBtn');
const dismissModalBtn = document.getElementById('dismissLyricsReportBtn');
const modalOverlay = document.getElementById('lyricsReportModal');

if (closeModalBtn) closeModalBtn.addEventListener('click', () => modalOverlay.style.display = 'none');
if (dismissModalBtn) dismissModalBtn.addEventListener('click', () => modalOverlay.style.display = 'none');
if (modalOverlay) {
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) modalOverlay.style.display = 'none';
  });
}

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
      showLyricsReportModal(
        data.song.title || 'Song',
        data.attempts || [],
        data.provider,
        data.lyricsCount || (data.song.lyrics ? data.song.lyrics.length : 0),
        data.lyricsError
      );
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
socket.on('lyrics_report', (report) => {
  if (report) {
    showLyricsReportModal(
      report.songTitle || 'Song',
      report.attempts || [],
      report.provider,
      report.lyricsCount || 0,
      report.lyricsError
    );
  }
});
socket.on('sync_state', (state) => {
  currentState = { ...currentState, ...state };

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
    setupAudio(currentSong);
    renderLyricsEditor(currentSong.lyrics || []);
    updateLyricsCounter(state.currentTime || 0);
  } else if (!state.songId || !state.songData) {
    currentSong = null;
    if (currentSongTitle) currentSongTitle.innerText = 'None';
    timelineSlider.value = 0;
    timelineSlider.disabled = true;
    if (timeDisplay) timeDisplay.innerText = '0:00 / 0:00';
    updateLyricsCounter(0);
    renderLyricsEditor([]);
  }

  if (state.currentTime !== undefined && !isDraggingSlider) {
    pauseTime = state.currentTime;
    timelineSlider.value = state.currentTime;
    const maxDur = parseFloat(timelineSlider.max) || 0;
    if (timeDisplay) timeDisplay.innerText = `${formatTime(state.currentTime)} / ${formatTime(maxDur)}`;
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
    if (timeDisplay) timeDisplay.innerText = `${formatTime(cmd.time)} / ${formatTime(maxDur)}`;
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
          timeDisplay.innerText = `${formatTime(curTime)} / ${formatTime(maxDur)}`;
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
