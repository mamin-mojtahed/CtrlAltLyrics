const express = require('express');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const util = require('util');
const execPromise = util.promisify(exec);

const router = express.Router();

const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history.json');

// Initialize directories and history file
if (!fs.existsSync(path.join(__dirname, '..', 'data'))) {
  fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
}
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify([]));
}

const readHistory = () => JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
const writeHistory = (data) => fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));

// In-memory queue & engine settings
let queue = [];
let currentEngineSettings = {
  mode: 'balanced',
  format: 'MP3',
  bitrate: '192k',
  isCustom: false
};

// --- Helper Functions for Per-Song Folder Lyrics Caching ---

function getLyricsFilePath(songId) {
  return path.join(DOWNLOADS_DIR, songId, 'lyrics.json');
}

function formatLrcTime(seconds) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return '00:00.00';
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(2);
  const mStr = String(mins).padStart(2, '0');
  const sStr = String(secs).padStart(5, '0');
  return `${mStr}:${sStr}`;
}

function readSongLyrics(songId) {
  try {
    const filePath = getLyricsFilePath(songId);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.error(`Error reading lyrics for song ${songId}:`, err);
  }
  return {
    lyrics: [],
    lyricsProvider: null,
    isSynced: true,
    lyricsAttempts: [],
    lyricsError: null
  };
}

function writeSongLyrics(songId, data) {
  try {
    const songDir = path.join(DOWNLOADS_DIR, songId);
    if (!fs.existsSync(songDir)) {
      fs.mkdirSync(songDir, { recursive: true });
    }
    const filePath = getLyricsFilePath(songId);
    const payload = {
      id: songId,
      title: data.title || '',
      artist: data.artist || '',
      lyricsProvider: data.lyricsProvider || null,
      isSynced: data.isSynced !== undefined ? data.isSynced : true,
      lyricsAttempts: data.lyricsAttempts || [],
      lyricsError: data.lyricsError || null,
      lyrics: data.lyrics || []
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

    // Remove legacy lyrics.txt if present to enforce lyrics.json as single source of truth
    const txtPath = path.join(songDir, 'lyrics.txt');
    if (fs.existsSync(txtPath)) {
      fs.unlinkSync(txtPath);
    }
  } catch (err) {
    console.error(`Error writing lyrics for song ${songId}:`, err);
  }
}

function saveLightweightHistoryItem(song) {
  // 1. Save lyrics to per-song folder
  writeSongLyrics(song.id, song);

  // 2. Save lightweight song metadata to history.json
  const history = readHistory();
  const hasAudio = (song.stems && (song.stems.inst || song.stems.lead)) || song.status === 'splitting' || song.status === 'fetching_lyrics' || song.status === 'ready';
  const hasSplitStems = (song.stems && song.stems.inst && song.stems.lead && song.stems.inst !== song.stems.lead) || song.status === 'fetching_lyrics' || song.status === 'ready';

  const lightItem = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    albumArt: song.albumArt,
    query: song.query,
    status: song.status,
    stems: song.stems || {},
    lyricsProvider: song.lyricsProvider || null,
    hasLyrics: Array.isArray(song.lyrics) && song.lyrics.length > 0
  };

  if (song.downloadError && !hasAudio) lightItem.downloadError = song.downloadError;
  if (song.splitError && !hasSplitStems) lightItem.splitError = song.splitError;
  if (song.lyricsError && !lightItem.hasLyrics) lightItem.lyricsError = song.lyricsError;

  const idx = history.findIndex(s => s.id === song.id);
  if (idx !== -1) {
    history[idx] = lightItem;
  } else {
    history.push(lightItem);
  }
  writeHistory(history);
}

// Migration function to strip embedded lyrics from history.json into per-song lyrics.json files
function migrateHistoryLyrics() {
  try {
    const history = readHistory();
    let modified = false;
    const cleanHistory = history.map(song => {
      if (song.lyrics !== undefined || song.lyricsAttempts !== undefined || song.lyricsError !== undefined) {
        modified = true;
        writeSongLyrics(song.id, {
          title: song.title,
          artist: song.artist,
          lyrics: song.lyrics || [],
          lyricsProvider: song.lyricsProvider || null,
          isSynced: song.isSynced !== undefined ? song.isSynced : true,
          lyricsAttempts: song.lyricsAttempts || [],
          lyricsError: song.lyricsError || null
        });

        const { lyrics, lyricsAttempts, lyricsError, ...lightSong } = song;
        lightSong.hasLyrics = Array.isArray(lyrics) && lyrics.length > 0;
        if (lyricsError) lightSong.lyricsError = lyricsError;
        return lightSong;
      }
      return song;
    });

    if (modified) {
      console.log('Successfully migrated inline lyrics from history.json into per-song downloads folders.');
      writeHistory(cleanHistory);
    }
  } catch (err) {
    console.error('Error during history lyrics migration:', err);
  }
}

// Clean up empty or orphaned download directories
function cleanupOrphanedDownloads() {
  try {
    if (!fs.existsSync(DOWNLOADS_DIR)) return;
    const history = readHistory();
    const historyIds = new Set(history.map(s => s.id));
    const queueIds = new Set(queue.map(s => s.id));

    const dirs = fs.readdirSync(DOWNLOADS_DIR);
    for (const dir of dirs) {
      const fullPath = path.join(DOWNLOADS_DIR, dir);
      if (fs.statSync(fullPath).isDirectory()) {
        const files = fs.readdirSync(fullPath);
        const hasAudioFiles = files.some(f => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav'));
        if (!hasAudioFiles || (!historyIds.has(dir) && !queueIds.has(dir))) {
          console.log(`Cleaning up empty/orphaned download directory: ${dir}`);
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
      }
    }
  } catch (err) {
    console.error('Error during download cleanup:', err);
  }
}

// Run cleanup and migration on module load
cleanupOrphanedDownloads();
migrateHistoryLyrics();

router.get('/engine_settings', (req, res) => {
  res.json(currentEngineSettings);
});

router.post('/engine_settings', (req, res) => {
  if (req.body) {
    currentEngineSettings = {
      ...currentEngineSettings,
      ...req.body
    };
  }
  res.json(currentEngineSettings);
});

router.get('/history', (req, res) => {
  cleanupOrphanedDownloads();
  const history = readHistory();
  let modified = false;
  const augmentedHistory = history.map(song => {
    const songDir = path.join(DOWNLOADS_DIR, song.id);
    const hasAudioOnDisk = fs.existsSync(songDir) && fs.readdirSync(songDir).some(f => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav'));
    const lyricsData = readSongLyrics(song.id);
    const hasLyrics = (Array.isArray(lyricsData.lyrics) && lyricsData.lyrics.length > 0) || song.hasLyrics === true;
    
    const cleanSong = { ...song };
    if (hasAudioOnDisk || song.status === 'ready') {
      if (cleanSong.downloadError) {
        delete cleanSong.downloadError;
        modified = true;
      }
      if (cleanSong.splitError) {
        delete cleanSong.splitError;
        modified = true;
      }
    }
    
    cleanSong.hasLyrics = hasLyrics;
    cleanSong.lyricsProvider = lyricsData.lyricsProvider || song.lyricsProvider || null;
    cleanSong.lyricsError = lyricsData.lyricsError || song.lyricsError || null;
    return cleanSong;
  });

  if (modified) {
    writeHistory(augmentedHistory);
  }
  res.json(augmentedHistory);
});

router.get('/queue', (req, res) => {
  res.json(queue);
});

router.get('/song/:id', (req, res) => {
  const songId = req.params.id;
  const history = readHistory();
  let song = queue.find(s => s.id === songId) || history.find(s => s.id === songId);
  if (!song) {
    return res.status(404).json({ error: 'Song not found' });
  }
  const lyricsData = readSongLyrics(songId);
  res.json({
    ...song,
    lyrics: lyricsData.lyrics || song.lyrics || [],
    lyricsProvider: lyricsData.lyricsProvider || song.lyricsProvider || null,
    isSynced: lyricsData.isSynced !== undefined ? lyricsData.isSynced : song.isSynced,
    lyricsAttempts: lyricsData.lyricsAttempts || song.lyricsAttempts || [],
    lyricsError: lyricsData.lyricsError || song.lyricsError || null
  });
});

router.post('/open_folder/:id', (req, res) => {
  const songDir = path.join(DOWNLOADS_DIR, req.params.id);
  if (fs.existsSync(songDir)) {
    exec(`open "${songDir}"`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Folder not found' });
  }
});

router.post('/search', async (req, res) => {
  const { query } = req.body;
  try {
    const response = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=3`);
    const results = response.data.results.map(item => ({
      id: item.trackId.toString(),
      title: item.trackName,
      artist: item.artistName,
      albumArt: item.artworkUrl100,
      query: `${item.trackName} ${item.artistName}`
    }));
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search' });
  }
});

router.post('/enqueue', async (req, res) => {
  const { song, engineSettings } = req.body;
  
  const history = readHistory();
  const existing = history.find(s => s.id === song.id);

  if (existing) {
    const songDir = path.join(DOWNLOADS_DIR, existing.id);
    const hasAudio = fs.existsSync(songDir) && fs.readdirSync(songDir).some(f => f.endsWith('.wav') || f.endsWith('.mp3') || f.endsWith('.m4a'));
    if (hasAudio && existing.status === 'ready') {
      const lyricsData = readSongLyrics(existing.id);
      const fullSong = {
        ...existing,
        ...lyricsData
      };
      queue.push(fullSong);
      res.json(fullSong);
      req.app.get('io').emit('queue_updated', queue);
      return;
    }
  }

  // Not in history or incomplete, add to queue as pending, save to library, and start processing
  const newSong = {
    ...song,
    engineSettings: engineSettings || currentEngineSettings,
    status: 'pending',
    stems: {},
    lyrics: []
  };
  saveLightweightHistoryItem(newSong);
  queue.push(newSong);
  const io = req.app.get('io');
  if (io) {
    io.emit('queue_updated', queue);
    io.emit('library_updated', readHistory());
  }
  res.json(newSong);

  // Background processing
  processSong(newSong, io).catch(err => console.error("Error processing song", err));
});

async function processSong(song, io) {
  const songDir = path.join(DOWNLOADS_DIR, song.id);
  if (fs.existsSync(songDir)) {
    const files = fs.readdirSync(songDir);
    const hasAudio = files.some(f => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav'));
    if (!hasAudio) {
      fs.rmSync(songDir, { recursive: true, force: true });
    }
  }
  if (!fs.existsSync(songDir)) {
    fs.mkdirSync(songDir, { recursive: true });
  }

  const updateStatus = (status) => {
    song.status = status;
    saveLightweightHistoryItem(song);
    
    const qIdx = queue.findIndex(s => s.id === song.id);
    if (qIdx !== -1) queue[qIdx] = song;
    if (io) {
      io.emit('queue_updated', queue);
      io.emit('library_updated', readHistory());
    }
  };

  delete song.downloadError;
  delete song.splitError;

  try {
    // 1. Download using spotdl
    updateStatus('downloading');
    const venvActivate = path.resolve(__dirname, '../../venv/bin/activate');
    const spotdlCmd = `source "${venvActivate}" && spotdl "${song.query}" --output "${songDir}/{title}.{output-ext}"`;
    await execPromise(spotdlCmd, { shell: '/bin/bash' });

    const files = fs.readdirSync(songDir);
    const audioFile = files.find(f => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav'));
    
    if (!audioFile) throw new Error("Downloaded file not found");

    delete song.downloadError;

    // 2. Split into 3 stems (Instrumental, Lead Vocal, Backing Vocal)
    updateStatus('splitting');
    const audioPath = path.join(songDir, audioFile);

    const engine = song.engineSettings || currentEngineSettings;
    const mode = engine.mode || 'balanced';
    const format = engine.format || 'MP3';
    const bitrate = engine.bitrate || '192k';
    
    try {
      const separateCmd = `source "${venvActivate}" && python "${path.join(__dirname, 'separate.py')}" --input "${audioPath}" --output_dir "${songDir}" --mode "${mode}" --format "${format}" --bitrate "${bitrate}"`;
      await execPromise(separateCmd, { shell: '/bin/bash' });

      const dirFiles = fs.readdirSync(songDir);
      const instFile = dirFiles.find(f => f.startsWith('instrumental.')) || audioFile;
      const leadFile = dirFiles.find(f => f.startsWith('lead_vocal.')) || audioFile;
      const backFile = dirFiles.find(f => f.startsWith('back_vocal.')) || audioFile;
      
      song.stems = {
        inst: `/audio/${song.id}/${instFile}`,
        lead: `/audio/${song.id}/${leadFile}`,
        back: `/audio/${song.id}/${backFile}`
      };
    } catch (e) {
      console.warn("Splitting failed. Using fallback stems.", e);
      song.stems = {
        inst: `/audio/${song.id}/${audioFile}`,
        lead: `/audio/${song.id}/${audioFile}`,
        back: `/audio/${song.id}/${audioFile}`
      };
    }

    // 3. Fetch Lyrics from providers with real-time status tracking
    updateStatus('fetching_lyrics');
    await fetchAndProcessLyrics(song, 'auto', io);

    // Done
    updateStatus('ready');

  } catch (error) {
    console.error("Processing error:", error);
    if (song.status === 'downloading') {
      song.downloadError = error.message || "Download failed";
    } else if (song.status === 'splitting') {
      song.splitError = error.message || "Splitting failed";
    }
    updateStatus('error');
  }
}

async function fetchAndProcessLyrics(song, requestedProvider = 'auto', io = null) {
  const updateLyricsStatus = (statusText) => {
    song.lyricsStatus = statusText;
    saveLightweightHistoryItem(song);

    const qIdx = queue.findIndex(s => s.id === song.id);
    if (qIdx !== -1) {
      queue[qIdx].lyricsStatus = statusText;
    }
    if (io) {
      io.emit('queue_updated', queue);
      io.emit('library_updated', readHistory());
    }
  };

  try {
    updateLyricsStatus('Starting search...');
    const venvPython = path.resolve(__dirname, '../../venv/bin/activate');
    const scriptPath = path.join(__dirname, 'fetch_lyrics.py');
    const safeTitle = (song.title || "").replace(/["\\]/g, " ");
    const safeArtist = (song.artist || "").replace(/["\\]/g, " ");
    const safeQuery = (song.query || `${song.title} ${song.artist}`).replace(/["\\]/g, " ");

    const cmd = `source "${venvPython}" && python "${scriptPath}" --title "${safeTitle}" --artist "${safeArtist}" --query "${safeQuery}" --provider "${requestedProvider}"`;
    
    const child = spawn('/bin/bash', ['-c', cmd]);

    let stdoutData = "";
    let stderrData = "";

    child.stdout.on('data', (data) => {
      const str = data.toString();
      stdoutData += str;
      const lines = str.split('\n');
      for (const line of lines) {
        if (line.startsWith('PROGRESS:')) {
          const statusText = line.replace('PROGRESS:', '').trim();
          updateLyricsStatus(statusText);
        }
      }
    });

    child.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    await new Promise((resolve, reject) => {
      child.on('close', (code) => resolve(code));
      child.on('error', (err) => reject(err));
    });

    const outLines = stdoutData.trim().split('\n').filter(l => l.trim() && !l.startsWith('PROGRESS:'));
    const jsonStr = outLines[outLines.length - 1] || "{}";
    let resData = { success: false, error: 'No response from lyrics engine' };
    try {
      resData = JSON.parse(jsonStr);
    } catch (e) {
      console.error("JSON parse error from fetch_lyrics.py:", e, stdoutData);
    }

async function fetchLyricsTranslationAndPronunciation(parsedLines) {
  if (!Array.isArray(parsedLines) || parsedLines.length === 0) {
    return parsedLines || [];
  }

  // 1. Check if lyrics contain non-ASCII characters
  const fullText = parsedLines.map(l => l.text || '').join(' ');
  const hasNonAscii = /[^\x00-\x7F]/.test(fullText);

  // If pure English/ASCII, return early with 0 network requests
  if (!hasNonAscii) {
    return parsedLines.map(l => ({
      ...l,
      translation: l.translation || '',
      transliteration: l.transliteration || ''
    }));
  }

  // 2. Fetch translation & pronunciation using single-request (dt=t&dt=rm) in pool of 5 workers
  const poolSize = 5;
  const missingTranslitIndices = [];
  const results = [];

  for (let i = 0; i < parsedLines.length; i += poolSize) {
    const chunk = parsedLines.slice(i, i + poolSize);
    const chunkResults = await Promise.all(chunk.map(async (line, indexInChunk) => {
      const globalIndex = i + indexInChunk;
      if (!line.text || !line.text.trim()) {
        return { ...line, translation: '', transliteration: '' };
      }

      // Skip pure ASCII lines
      if (!/[^\x00-\x7F]/.test(line.text)) {
        return {
          ...line,
          translation: line.translation || '',
          transliteration: line.transliteration || ''
        };
      }

      let translation = line.translation || '';
      let transliteration = line.transliteration || '';

      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=rm&q=${encodeURIComponent(line.text)}`;
        const res = await axios.get(url, { timeout: 4000 });
        if (res.data && res.data[0]) {
          if (Array.isArray(res.data[0])) {
            const transChunks = res.data[0]
              .filter(item => Array.isArray(item) && item[0])
              .map(item => item[0]);
            if (transChunks.length > 0) {
              translation = transChunks.join('').trim();
            }

            for (const item of res.data[0]) {
              if (Array.isArray(item) && item.length >= 4 && item[3]) {
                transliteration = item[3].trim();
                break;
              } else if (Array.isArray(item) && item.length >= 3 && item[2] && typeof item[2] === 'string' && !transChunks.includes(item[2])) {
                transliteration = item[2].trim();
                break;
              }
            }
          }
        }
      } catch (e) { }

      if (!transliteration && /[^\x00-\x7F]/.test(line.text)) {
        missingTranslitIndices.push(globalIndex);
      }

      return {
        ...line,
        translation,
        transliteration
      };
    }));

    results.push(...chunkResults);
  }

  // 3. Fallback for any non-English line missing transliteration using local python script
  if (missingTranslitIndices.length > 0) {
    try {
      const textsToFallback = missingTranslitIndices.map(idx => results[idx].text);
      const pythonScript = path.join(__dirname, 'transliterate.py');
      const venvPython = path.join(__dirname, '..', '..', 'venv', 'bin', 'python');
      const pythonPath = fs.existsSync(venvPython) ? venvPython : 'python3';

      const child = spawn(pythonPath, [pythonScript, '--stdin']);
      let stdout = '';

      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stdin.write(JSON.stringify(textsToFallback));
      child.stdin.end();

      await new Promise(resolve => child.on('close', resolve));

      const fallbackArr = JSON.parse(stdout.trim() || '[]');
      missingTranslitIndices.forEach((lineIdx, i) => {
        if (fallbackArr[i] && !results[lineIdx].transliteration) {
          results[lineIdx].transliteration = fallbackArr[i];
        }
      });
    } catch (err) {
      console.warn("Transliteration fallback error:", err);
    }
  }

  return results;
}

    if (resData.success && resData.lrc) {
      let parsed = parseLrc(resData.lrc);

      try {
        parsed = await fetchLyricsTranslationAndPronunciation(parsed);
      } catch (e) {
        console.warn("Translation/pronunciation processing failed", e);
      }

      song.lyrics = parsed;
      song.lyricsProvider = resData.provider || 'LRCLIB';
      song.isSynced = resData.is_synced !== undefined ? resData.is_synced : true;
      song.lyricsAttempts = resData.attempts || [];
      song.lyricsError = null;
      updateLyricsStatus(null);
    } else {
      song.lyrics = [];
      song.lyricsProvider = null;
      song.lyricsAttempts = resData.attempts || [];
      song.lyricsError = resData.error || "No lyrics found across any provider.";
      updateLyricsStatus(null);
    }
  } catch (e) {
    console.error("Lyrics fetch error:", e);
    song.lyrics = [];
    song.lyricsProvider = null;
    song.lyricsAttempts = [];
    song.lyricsError = "Lyrics fetch process failed.";
    updateLyricsStatus(null);
  }

  saveLightweightHistoryItem(song);
  return song;
}

router.post('/retry_lyrics/:id', async (req, res) => {
  const songId = req.params.id;
  const { provider = 'auto' } = req.body || {};
  
  let song = queue.find(s => s.id === songId);
  const history = readHistory();
  if (!song) {
    song = history.find(s => s.id === songId);
    if (song) {
      const lyricsData = readSongLyrics(songId);
      song = { ...song, ...lyricsData };
    }
  }
  
  if (!song) {
    return res.status(404).json({ error: 'Song not found' });
  }

  const io = req.app.get('io');
  if (provider === 'current' && Array.isArray(song.lyrics) && song.lyrics.length > 0) {
    song.lyrics = await fetchLyricsTranslationAndPronunciation(song.lyrics);
    saveLightweightHistoryItem(song);
  } else {
    await fetchAndProcessLyrics(song, provider, io);
  }

  if (io) {
    io.emit('queue_updated', queue);
    io.emit('lyrics_report', {
      songId: song.id,
      songTitle: song.title,
      attempts: song.lyricsAttempts || [],
      provider: song.lyricsProvider,
      lyricsCount: (song.lyrics || []).length,
      lyricsError: song.lyricsError
    });
  }

  res.json({
    success: true,
    song,
    attempts: song.lyricsAttempts || [],
    provider: song.lyricsProvider,
    lyricsCount: (song.lyrics || []).length,
    lyricsError: song.lyricsError
  });
});

function parseLrc(lrcString) {
  const lines = lrcString.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\]/;
  
  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseFloat(match[2]);
      const time = min * 60 + sec;
      const text = line.replace(timeRegex, '').trim();
      result.push({ time, text, translation: '', transliteration: '' });
    }
  }
  return result;
}

// Lyrics editing endpoint
router.post('/edit_lyrics', (req, res) => {
  const { songId, lyrics } = req.body;
  const history = readHistory();
  const idx = history.findIndex(s => s.id === songId);
  
  const existingLyricsData = readSongLyrics(songId);
  existingLyricsData.lyrics = lyrics;
  writeSongLyrics(songId, existingLyricsData);

  if (idx !== -1) {
    history[idx].hasLyrics = Array.isArray(lyrics) && lyrics.length > 0;
    writeHistory(history);
  }

  const qIdx = queue.findIndex(s => s.id === songId);
  if (qIdx !== -1) {
    queue[qIdx].lyrics = lyrics;
    req.app.get('io').emit('queue_updated', queue);
  }
  
  res.json({ success: true });
});

router.delete('/history/:id', (req, res) => {
  const songId = req.params.id;
  let history = readHistory();
  history = history.filter(s => s.id !== songId);
  writeHistory(history);

  const songDir = path.join(DOWNLOADS_DIR, songId);
  if (fs.existsSync(songDir)) {
    try {
      fs.rmSync(songDir, { recursive: true, force: true });
    } catch(e) {
      console.error('Failed to remove download folder:', e);
    }
  }

  // Also remove from queue if present
  queue = queue.filter(s => s.id !== songId);
  req.app.get('io').emit('queue_updated', queue);
  res.json({ success: true });
});

router.delete('/queue/:id', (req, res) => {
  queue = queue.filter(s => s.id !== req.params.id);
  req.app.get('io').emit('queue_updated', queue);
  res.json({ success: true });
});

router.post('/queue/reorder', (req, res) => {
  const { queueIds, songId, direction, fromIndex, toIndex } = req.body || {};

  if (Array.isArray(queueIds)) {
    const queueMap = new Map(queue.map(s => [s.id, s]));
    const newQueue = [];
    for (const id of queueIds) {
      if (queueMap.has(id)) {
        newQueue.push(queueMap.get(id));
        queueMap.delete(id);
      }
    }
    // Append any missing remaining items
    for (const song of queueMap.values()) {
      newQueue.push(song);
    }
    queue = newQueue;
  } else if (songId && direction) {
    const idx = queue.findIndex(s => s.id === songId);
    if (idx !== -1) {
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx >= 0 && targetIdx < queue.length) {
        const temp = queue[idx];
        queue[idx] = queue[targetIdx];
        queue[targetIdx] = temp;
      }
    }
  } else if (typeof fromIndex === 'number' && typeof toIndex === 'number') {
    if (fromIndex >= 0 && fromIndex < queue.length && toIndex >= 0 && toIndex < queue.length) {
      const [moved] = queue.splice(fromIndex, 1);
      queue.splice(toIndex, 0, moved);
    }
  }

  req.app.get('io').emit('queue_updated', queue);
  res.json({ success: true, queue });
});

module.exports = router;

