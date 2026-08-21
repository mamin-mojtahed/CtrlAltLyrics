const express = require('express');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const util = require('util');
const multer = require('multer');
const mm = require('music-metadata');
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

// Multer storage for uploaded audio files
const UPLOAD_TEMP_DIR = path.join(__dirname, '..', 'data', 'temp_uploads');
if (!fs.existsSync(UPLOAD_TEMP_DIR)) {
  fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });
}

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOAD_TEMP_DIR)) {
      fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });
    }
    cb(null, UPLOAD_TEMP_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `upload-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 150 * 1024 * 1024 } // 150 MB max
});

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
    const existing = readSongLyrics(songId);
    
    // Preserve existing lyrics array if data.lyrics is empty or not provided
    const finalLyrics = (Array.isArray(data.lyrics) && data.lyrics.length > 0)
      ? data.lyrics
      : (Array.isArray(existing.lyrics) && existing.lyrics.length > 0 ? existing.lyrics : (data.lyrics || []));

    const payload = {
      id: songId,
      title: data.title || existing.title || '',
      artist: data.artist || existing.artist || '',
      lyricsProvider: data.lyricsProvider || existing.lyricsProvider || null,
      isSynced: data.isSynced !== undefined ? data.isSynced : (existing.isSynced !== undefined ? existing.isSynced : true),
      lyricsAttempts: (Array.isArray(data.lyricsAttempts) && data.lyricsAttempts.length > 0) ? data.lyricsAttempts : (existing.lyricsAttempts || []),
      lyricsError: data.lyricsError !== undefined ? data.lyricsError : (existing.lyricsError || null),
      lyrics: finalLyrics
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
  // 1. Save lyrics to per-song folder only if lyrics are explicitly provided or file missing
  if (Array.isArray(song.lyrics) && song.lyrics.length > 0) {
    writeSongLyrics(song.id, song);
  } else {
    const existingLyrics = readSongLyrics(song.id);
    if (!Array.isArray(existingLyrics.lyrics) || existingLyrics.lyrics.length === 0) {
      writeSongLyrics(song.id, song);
    }
  }

  // 2. Save lightweight song metadata to history.json
  const history = readHistory();
  const hasAudio = (song.stems && (song.stems.inst || song.stems.lead)) || song.status === 'splitting' || song.status === 'fetching_lyrics' || song.status === 'ready';
  const hasSplitStems = (song.stems && song.stems.inst && song.stems.lead && song.stems.inst !== song.stems.lead) || song.status === 'fetching_lyrics' || song.status === 'ready';
  const lyricsOnDisk = readSongLyrics(song.id);
  const hasLyrics = (Array.isArray(song.lyrics) && song.lyrics.length > 0) || (Array.isArray(lyricsOnDisk.lyrics) && lyricsOnDisk.lyrics.length > 0);

  const lightItem = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    albumArt: song.albumArt,
    query: song.query,
    status: song.status,
    stems: song.stems || {},
    downloadMethod: song.downloadMethod || 'SpotDL',
    downloadAttempts: song.downloadAttempts || [],
    engineSettings: song.engineSettings || null,
    separationInfo: song.separationInfo || null,
    lyricsProvider: song.lyricsProvider || lyricsOnDisk.lyricsProvider || null,
    isSynced: song.isSynced !== undefined ? song.isSynced : (lyricsOnDisk.isSynced !== undefined ? lyricsOnDisk.isSynced : true),
    hasLyrics: hasLyrics,
    spotifyUrl: song.spotifyUrl || null,
    spotifyTrackId: song.spotifyTrackId || null,
    isSpotify: !!song.spotifyUrl,
    isUploaded: !!(song.isUploaded || song.downloadMethod === 'Uploaded')
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
        if (Array.isArray(song.lyrics) && song.lyrics.length > 0) {
          writeSongLyrics(song.id, {
            title: song.title,
            artist: song.artist,
            lyrics: song.lyrics || [],
            lyricsProvider: song.lyricsProvider || null,
            isSynced: song.isSynced !== undefined ? song.isSynced : true,
            lyricsAttempts: song.lyricsAttempts || [],
            lyricsError: song.lyricsError || null
          });
        }

        const { lyrics, lyricsAttempts, lyricsError, ...lightSong } = song;
        const diskLyrics = readSongLyrics(song.id);
        lightSong.hasLyrics = (Array.isArray(lyrics) && lyrics.length > 0) || (Array.isArray(diskLyrics.lyrics) && diskLyrics.lyrics.length > 0);
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

    if (fs.existsSync(songDir)) {
      const files = fs.readdirSync(songDir);
      const coverFile = files.find(f => f.startsWith('cover.'));
      if (coverFile && (!cleanSong.albumArt || cleanSong.albumArt === '/ctrlaltlyrics-logo.webp')) {
        const localCoverUrl = `/audio/${song.id}/${coverFile}`;
        if (cleanSong.albumArt !== localCoverUrl) {
          cleanSong.albumArt = localCoverUrl;
          modified = true;
        }
      }
    }

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
  const songDir = path.join(DOWNLOADS_DIR, songId);
  let albumArt = song.albumArt;
  if (!albumArt || albumArt === '/ctrlaltlyrics-logo.webp') {
    if (fs.existsSync(songDir)) {
      const files = fs.readdirSync(songDir);
      const coverFile = files.find(f => f.startsWith('cover.'));
      if (coverFile) {
        albumArt = `/audio/${songId}/${coverFile}`;
      }
    }
  }
  const lyricsData = readSongLyrics(songId);
  res.json({
    ...song,
    albumArt: albumArt || song.albumArt || '/ctrlaltlyrics-logo.webp',
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

async function resolveSpotifyLink(query) {
  if (!query || typeof query !== 'string') return null;
  const trimmed = query.trim();

  let trackId = null;

  // Match spotify:track:{id} or open.spotify.com/(intl-.../)?track/{id}
  const directMatch = trimmed.match(/(?:open\.spotify\.com\/(?:intl-[a-zA-Z0-9-]+\/)?track\/|spotify:track:)([a-zA-Z0-9]{22})/i);
  if (directMatch) {
    trackId = directMatch[1];
  }

  // Short URL / redirect (e.g. spotify.link or spoti.fi)
  if (!trackId && (trimmed.startsWith('http://') || trimmed.startsWith('https://')) && (trimmed.includes('spotify') || trimmed.includes('spoti.fi'))) {
    try {
      const resp = await axios.get(trimmed, {
        maxRedirects: 5,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        timeout: 7000
      });
      const finalUrl = resp.request?.res?.responseUrl || resp.headers?.location || '';
      const redMatch = finalUrl.match(/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?track\/([a-zA-Z0-9]{22})/i);
      if (redMatch) {
        trackId = redMatch[1];
      }
    } catch (err) {
      console.warn('Spotify redirect resolution failed:', err.message);
    }
  }

  if (!trackId) return null;

  let title = '';
  let artist = '';
  let albumArt = '';
  let duration = 0;

  // Primary Metadata extraction: Spotify Embed Next.js data
  try {
    const embedUrl = `https://open.spotify.com/embed/track/${trackId}`;
    const embedRes = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 8000
    });

    const match = embedRes.data.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (match) {
      const json = JSON.parse(match[1]);
      const entity = json.props?.pageProps?.state?.data?.entity;
      if (entity) {
        title = entity.name || entity.title || '';
        artist = (entity.artists || []).map(a => a.name).join(', ');
        const images = entity.visualIdentity?.image || [];
        const bestImg = images.find(i => i.maxHeight === 640) || images[0];
        albumArt = bestImg?.url || '';
        duration = entity.duration ? Math.round(entity.duration / 1000) : 0;
      }
    }
  } catch (err) {
    console.warn('Spotify embed fetch error:', err.message);
  }

  // Fallback 1: Spotify oEmbed endpoint
  if (!title) {
    try {
      const oembedRes = await axios.get(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`, { timeout: 5000 });
      title = oembedRes.data?.title || '';
      if (!albumArt) albumArt = oembedRes.data?.thumbnail_url || '';
    } catch (err) {
      console.warn('Spotify oEmbed error:', err.message);
    }
  }

  // Fallback 2: iTunes search if artist is missing
  if (title && !artist) {
    try {
      const itunesRes = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=music&limit=1`, { timeout: 5000 });
      if (itunesRes.data?.results?.length > 0) {
        artist = itunesRes.data.results[0].artistName || '';
        if (!albumArt) albumArt = itunesRes.data.results[0].artworkUrl100 || '';
      }
    } catch (err) {}
  }

  if (!title) return null;

  return {
    id: `spotify_${trackId}`,
    title: title.trim(),
    artist: artist.trim(),
    albumArt: albumArt,
    duration: duration,
    query: `${title} ${artist}`.trim(),
    spotifyUrl: `https://open.spotify.com/track/${trackId}`,
    spotifyTrackId: trackId,
    isSpotify: true
  };
}

router.post('/search', async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== 'string') {
    return res.json([]);
  }

  try {
    // 1. Check if query is a Spotify link or Spotify URI
    const spotifySong = await resolveSpotifyLink(query);
    if (spotifySong) {
      return res.json([spotifySong]);
    }

    // 2. Default iTunes search
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

router.post('/upload', upload.single('audioFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded.' });
    }

    let { title, artist, engineSettings } = req.body;
    if (typeof engineSettings === 'string') {
      try {
        engineSettings = JSON.parse(engineSettings);
      } catch (e) {
        engineSettings = null;
      }
    }

    const songId = `upload_${Date.now()}`;
    const songDir = path.join(DOWNLOADS_DIR, songId);
    if (!fs.existsSync(songDir)) {
      fs.mkdirSync(songDir, { recursive: true });
    }

    // Copy uploaded file to song directory as audio.mp3
    const mainAudioPath = path.join(songDir, 'audio.mp3');
    fs.copyFileSync(req.file.path, mainAudioPath);

    const originalName = req.file.originalname || 'Uploaded Song.mp3';
    const origExt = path.extname(originalName).toLowerCase();
    if (origExt && origExt !== '.mp3') {
      fs.copyFileSync(req.file.path, path.join(songDir, `audio${origExt}`));
    }

    // Parse audio metadata & embedded cover art via music-metadata
    let tagTitle = '';
    let tagArtist = '';
    let albumArt = null;

    try {
      const metadata = await mm.parseFile(mainAudioPath);
      if (metadata && metadata.common) {
        if (metadata.common.title) tagTitle = metadata.common.title.trim();
        if (metadata.common.artist) tagArtist = metadata.common.artist.trim();

        if (Array.isArray(metadata.common.picture) && metadata.common.picture.length > 0) {
          const pic = metadata.common.picture[0];
          const ext = (pic.format && pic.format.includes('png')) ? '.png' : ((pic.format && pic.format.includes('webp')) ? '.webp' : '.jpg');
          const coverFileName = `cover${ext}`;
          const coverFilePath = path.join(songDir, coverFileName);
          fs.writeFileSync(coverFilePath, pic.data);
          albumArt = `/audio/${songId}/${coverFileName}`;
          console.log(`[Upload] Extracted embedded cover image (${ext}) for ${songId}`);
        }
      }
    } catch (mmErr) {
      console.warn('[Upload] Failed to parse ID3 tags:', mmErr.message);
    }

    // Clean up temporary upload file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (e) {}

    // Resolve title and artist
    const baseName = path.basename(originalName, path.extname(originalName));
    let resolvedTitle = (title && title.trim()) ? title.trim() : (tagTitle || '');
    let resolvedArtist = (artist && artist.trim()) ? artist.trim() : (tagArtist || '');

    if (!resolvedTitle) {
      if (baseName.includes(' - ')) {
        const parts = baseName.split(' - ');
        resolvedArtist = resolvedArtist || parts[0].trim();
        resolvedTitle = parts.slice(1).join(' - ').trim();
      } else {
        resolvedTitle = baseName.replace(/_/g, ' ').trim();
      }
    }
    if (!resolvedArtist) {
      resolvedArtist = 'Unknown Artist';
    }

    // Clean up typical noise from filenames
    resolvedTitle = resolvedTitle.replace(/\s*[\(\[](?:official\s*(?:audio|video|music\s*video|lyric\s*video|lyrics)?|hq|hd|320kbps|remastered)[\)\]]\s*/gi, ' ').trim();

    // If no embedded cover art, search online for high-res cover via iTunes
    if (!albumArt) {
      try {
        const searchTerms = `${resolvedTitle} ${resolvedArtist !== 'Unknown Artist' ? resolvedArtist : ''}`.trim();
        const itunesRes = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(searchTerms)}&media=music&limit=1`, { timeout: 4000 });
        if (itunesRes.data && Array.isArray(itunesRes.data.results) && itunesRes.data.results.length > 0) {
          const item = itunesRes.data.results[0];
          if (item.artworkUrl100) {
            const highResArt = item.artworkUrl100.replace(/100x100bb\./i, '600x600bb.');
            try {
              const imgRes = await axios.get(highResArt, { responseType: 'arraybuffer', timeout: 5000 });
              const coverFilePath = path.join(songDir, 'cover.jpg');
              fs.writeFileSync(coverFilePath, Buffer.from(imgRes.data));
              albumArt = `/audio/${songId}/cover.jpg`;
            } catch (dlErr) {
              albumArt = highResArt;
            }
          }
        }
      } catch (itErr) {
        console.warn('[Upload] Cover search fallback error:', itErr.message);
      }
    }

    if (!albumArt) {
      albumArt = '/ctrlaltlyrics-logo.webp';
    }

    const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);
    const newSong = {
      id: songId,
      title: resolvedTitle,
      artist: resolvedArtist,
      albumArt: albumArt,
      query: `${resolvedTitle} ${resolvedArtist}`.trim(),
      status: 'pending',
      downloadMethod: 'Uploaded',
      downloadAttempts: [
        { provider: 'Local File Upload', status: 'success', detail: `Uploaded "${originalName}" (${fileSizeMB} MB)` }
      ],
      engineSettings: engineSettings || currentEngineSettings,
      stems: {},
      lyrics: [],
      isUploaded: true
    };

    saveLightweightHistoryItem(newSong);
    queue.push(newSong);
    const io = req.app.get('io');
    if (io) {
      io.emit('queue_updated', queue);
      io.emit('library_updated', readHistory());
    }

    res.json(newSong);

    // Background processing through stem separation and lyrics retrieval
    processSong(newSong, io).catch(err => console.error("Error processing uploaded song:", err));

  } catch (error) {
    console.error('Upload handling error:', error);
    res.status(500).json({ error: error.message || 'Failed to process uploaded file' });
  }
});

router.get('/cover/:id', async (req, res) => {
  const songId = req.params.id;
  const history = readHistory();
  const song = history.find(s => s.id === songId) || queue.find(s => s.id === songId);
  const songDir = path.join(DOWNLOADS_DIR, songId);

  // If song has an explicit albumArt URL or custom local path
  if (song && song.albumArt && song.albumArt !== '/ctrlaltlyrics-logo.webp') {
    if (song.albumArt.startsWith('http')) {
      try {
        const imgRes = await axios.get(song.albumArt, { responseType: 'stream', timeout: 6000 });
        res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        return imgRes.data.pipe(res);
      } catch (e) {
        return res.redirect(song.albumArt);
      }
    } else if (song.albumArt.startsWith('/audio/')) {
      const cleanPath = song.albumArt.split('?')[0].replace(/^\/audio\//, '');
      const filePath = path.join(DOWNLOADS_DIR, cleanPath);
      if (fs.existsSync(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
        return res.sendFile(filePath);
      }
    }
  }

  // Fallback to disk scan
  if (fs.existsSync(songDir)) {
    const files = fs.readdirSync(songDir);
    const coverFile = files.find(f => f.startsWith('cover.'));
    if (coverFile) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(path.join(songDir, coverFile));
    }
  }

  res.redirect('/ctrlaltlyrics-logo.webp');
});

async function downloadSongAudio(song, requestedSource = 'auto') {
  const songDir = path.join(DOWNLOADS_DIR, song.id);
  if (!fs.existsSync(songDir)) {
    fs.mkdirSync(songDir, { recursive: true });
  }

  const venvActivate = path.resolve(__dirname, '../../venv/bin/activate');
  
  // Clean title & main artist extraction
  const cleanTitle = (song.title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/["\\]/g, ' ')
    .trim();

  const mainArtist = (song.artist || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/&|,|feat\.?|ft\.?/i)[0]
    .replace(/["\\]/g, ' ')
    .trim();

  const cleanQuery = `${cleanTitle} ${mainArtist}`.trim();
  const fullQuery = (song.query || `${song.title} ${song.artist}`).replace(/["\\]/g, ' ').trim();

  let audioDownloaded = false;
  let methodUsed = song.downloadMethod || 'SpotDL';
  const attemptsLog = [];

  const checkAndAdoptAudio = () => {
    if (!fs.existsSync(songDir)) return false;
    const currentFiles = fs.readdirSync(songDir);
    const downloadedAudio = currentFiles.find(f => 
      f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav') || 
      f.endsWith('.opus') || f.endsWith('.flac') || f.endsWith('.ogg')
    );
    if (downloadedAudio) {
      const mainAudioPath = path.join(songDir, 'audio.mp3');
      const downloadedPath = path.join(songDir, downloadedAudio);
      if (downloadedAudio !== 'audio.mp3') {
        fs.copyFileSync(downloadedPath, mainAudioPath);
      }
      return true;
    }
    return false;
  };

  // If this song was uploaded directly or audio file is already present
  if (song.downloadMethod === 'Uploaded' || song.isUploaded || checkAndAdoptAudio()) {
    attemptsLog.push({ provider: 'Local File Upload', status: 'success', detail: 'Audio file loaded from local upload' });
    return { success: true, audioFile: 'audio.mp3', method: 'Uploaded', attempts: attemptsLog };
  }

  const isInstRequested = /(?:karaoke|instrumental|backing track|off vocal|minus one)/i.test(song.title || '');

  const trySpotdlQuery = async (queryText, stageLabel) => {
    if (!queryText) return false;
    try {
      // SpotDL with verified results filter and direct mp3 output
      const spotdlCmd = `source "${venvActivate}" && spotdl "${queryText}" --only-verified-results --format mp3 --bitrate 192k --output "${songDir}/{title}.{output-ext}"`;
      const result = await execPromise(spotdlCmd, { shell: '/bin/bash', timeout: 35000 });
      const fullLog = (result.stdout || '') + ' ' + (result.stderr || '');
      
      // If SpotDL grabbed a karaoke/instrumental video when original song is not instrumental, reject it
      if (!isInstRequested && /(?:karaoke|instrumental|backing track|off vocal|minus one|piano cover)/i.test(fullLog)) {
        console.warn(`SpotDL downloaded an instrumental/karaoke version for "${song.title}", rejecting SpotDL output...`);
        if (fs.existsSync(songDir)) {
          const files = fs.readdirSync(songDir);
          for (const f of files) {
            if (f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav') || f.endsWith('.opus') || f.endsWith('.webm')) {
              fs.unlinkSync(path.join(songDir, f));
            }
          }
        }
        return false;
      }

      if (checkAndAdoptAudio()) {
        return true;
      }
    } catch (err) {
      console.warn(`SpotDL attempt (${stageLabel}: "${queryText}") error:`, err.message);
    }
    return checkAndAdoptAudio();
  };

  // ==========================================
  // STAGE 1: SpotDL (Spotify Official Studio Match)
  // ==========================================
  if (requestedSource !== 'ytdlp') {
    // Attempt 1A: Direct Spotify URL if song was searched/created from a Spotify link
    if (song.spotifyUrl) {
      const successUrl = await trySpotdlQuery(song.spotifyUrl, 'Direct Spotify URL');
      if (successUrl) {
        audioDownloaded = true;
        methodUsed = 'SpotDL (Spotify Link)';
        attemptsLog.push({ provider: 'SpotDL (Spotify Link)', status: 'success', detail: `Official studio track acquired directly via Spotify link` });
        attemptsLog.push({ provider: 'yt-dlp Direct (Title + Artist)', status: 'skipped', detail: 'Not needed (acquired via SpotDL)' });
        attemptsLog.push({ provider: 'yt-dlp Title Fallback', status: 'skipped', detail: 'Not needed (acquired via SpotDL)' });
      } else {
        attemptsLog.push({ provider: 'SpotDL (Spotify Link)', status: 'failed', detail: `SpotDL verified match not found for Spotify link` });
      }
    }

    if (!audioDownloaded && !song.spotifyUrl) {
      // Attempt 1B: Clean Title + Main Artist (only for non-Spotify URL searches)
      const success1A = await trySpotdlQuery(cleanQuery, 'Clean Title + Main Artist');
      if (success1A) {
        audioDownloaded = true;
        methodUsed = 'SpotDL';
        attemptsLog.push({ provider: 'SpotDL', status: 'success', detail: `Official studio track acquired via SpotDL for "${cleanQuery}"` });
        attemptsLog.push({ provider: 'yt-dlp Direct (Title + Artist)', status: 'skipped', detail: 'Not needed (acquired via SpotDL)' });
        attemptsLog.push({ provider: 'yt-dlp Title Fallback', status: 'skipped', detail: 'Not needed (acquired via SpotDL)' });
      } else {
        // Attempt 1C: Full Search Query
        if (fullQuery && fullQuery !== cleanQuery) {
          const success1B = await trySpotdlQuery(fullQuery, 'Full Query');
          if (success1B) {
            audioDownloaded = true;
            methodUsed = 'SpotDL';
            attemptsLog.push({ provider: 'SpotDL', status: 'success', detail: `Official studio track acquired via SpotDL for "${fullQuery}"` });
            attemptsLog.push({ provider: 'yt-dlp Direct (Title + Artist)', status: 'skipped', detail: 'Not needed (acquired via SpotDL)' });
            attemptsLog.push({ provider: 'yt-dlp Title Fallback', status: 'skipped', detail: 'Not needed (acquired via SpotDL)' });
          }
        }
      }

      if (!audioDownloaded) {
        attemptsLog.push({ provider: 'SpotDL', status: 'failed', detail: `SpotDL verified search failed on Spotify catalog for "${cleanQuery}"` });
      }
    }
  }

  // ==========================================
  // STAGE 2: Direct yt-dlp Search (Title + Main Artist Official Audio)
  // ==========================================
  const ytFilter = isInstRequested ? '!is_live' : `!is_live & title !~= '(?i)(karaoke|instrumental|backing track|off vocal|minus one|piano cover|8d audio)'`;

  if (!audioDownloaded && requestedSource !== 'spotdl') {
    try {
      methodUsed = 'yt-dlp Direct (Title + Artist)';
      const ytdlpCmd = `source "${venvActivate}" && yt-dlp --js-runtimes node --max-downloads 1 --match-filter "${ytFilter}" "ytsearch5:${cleanQuery} official audio" -x --audio-format mp3 -o "${songDir}/audio.%(ext)s"`;
      try {
        await execPromise(ytdlpCmd, { shell: '/bin/bash', timeout: 50000 });
      } catch (e) {
        // Exit code 101 is standard when reaching --max-downloads 1
      }

      if (checkAndAdoptAudio()) {
        audioDownloaded = true;
        attemptsLog.push({ provider: 'yt-dlp Direct (Title + Artist)', status: 'success', detail: `Audio extracted via YouTube audio search for "${cleanQuery}"` });
        attemptsLog.push({ provider: 'yt-dlp Title Fallback', status: 'skipped', detail: 'Not needed (acquired via yt-dlp Direct)' });
      } else {
        attemptsLog.push({ provider: 'yt-dlp Direct (Title + Artist)', status: 'failed', detail: 'yt-dlp completed but output audio file missing' });
      }
    } catch (ytdlpErr) {
      console.warn("yt-dlp direct audio search failed, trying title fallback...", ytdlpErr.message);
      attemptsLog.push({ provider: 'yt-dlp Direct (Title + Artist)', status: 'failed', detail: ytdlpErr.message || 'Direct YouTube search failed' });
    }
  }

  // ==========================================
  // STAGE 3: Direct yt-dlp Search (Title Only Fallback)
  // ==========================================
  if (!audioDownloaded && requestedSource !== 'spotdl') {
    if (cleanTitle) {
      try {
        methodUsed = 'yt-dlp Direct (Title Only)';
        const ytdlpCmd = `source "${venvActivate}" && yt-dlp --js-runtimes node --max-downloads 1 --match-filter "${ytFilter}" "ytsearch5:${cleanTitle} official audio" -x --audio-format mp3 -o "${songDir}/audio.%(ext)s"`;
        try {
          await execPromise(ytdlpCmd, { shell: '/bin/bash', timeout: 50000 });
        } catch (e) {
          // Exit code 101 is standard when reaching --max-downloads 1
        }

        if (checkAndAdoptAudio()) {
          audioDownloaded = true;
          attemptsLog.push({ provider: 'yt-dlp Title Fallback', status: 'success', detail: `Audio extracted for title "${cleanTitle}"` });
        } else {
          attemptsLog.push({ provider: 'yt-dlp Title Fallback', status: 'failed', detail: 'Title fallback completed but output audio missing' });
        }
      } catch (ytdlpTitleErr) {
        attemptsLog.push({ provider: 'yt-dlp Title Fallback', status: 'failed', detail: ytdlpTitleErr.message || 'Title fallback failed' });
      }
    } else {
      attemptsLog.push({ provider: 'yt-dlp Title Fallback', status: 'failed', detail: 'No title available for fallback' });
    }
  }

  const files = fs.readdirSync(songDir);
  const audioFile = files.find(f => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav'));
  
  if (!audioFile) {
    song.downloadError = "Audio download failed across all fallback stages (SpotDL & yt-dlp).";
    song.downloadAttempts = attemptsLog;
    return { success: false, error: song.downloadError, attempts: attemptsLog };
  }

  // Guarantee standard audio.mp3 exists
  const mainAudioPath = path.join(songDir, 'audio.mp3');
  if (!fs.existsSync(mainAudioPath)) {
    fs.copyFileSync(path.join(songDir, audioFile), mainAudioPath);
  }

  // Clean up any redundant downloaded file (e.g. <Title>.mp3) while preserving covers & main audio
  const allowedDownloadFiles = new Set(['audio.mp3', 'instrumental.mp3', 'lead_vocal.mp3', 'back_vocal.mp3', 'lyrics.json']);
  for (const f of fs.readdirSync(songDir)) {
    if (!allowedDownloadFiles.has(f) && !f.startsWith('cover.') && !f.startsWith('audio.')) {
      try { fs.unlinkSync(path.join(songDir, f)); } catch (e) {}
    }
  }

  // Guarantee all 4 expected audio files exist initially (fallback copies until split)
  const ext = '.mp3';
  for (const stemName of ['instrumental', 'lead_vocal', 'back_vocal']) {
    const stemPath = path.join(songDir, `${stemName}${ext}`);
    if (!fs.existsSync(stemPath)) {
      fs.copyFileSync(mainAudioPath, stemPath);
    }
  }

  delete song.downloadError;
  song.downloadAttempts = attemptsLog;
  song.audioFile = 'audio.mp3';
  song.downloadMethod = methodUsed;
  song.stems = {
    inst: `/audio/${song.id}/instrumental.mp3`,
    lead: `/audio/${song.id}/lead_vocal.mp3`,
    back: `/audio/${song.id}/back_vocal.mp3`,
    full: `/audio/${song.id}/audio.mp3`
  };

  return { success: true, audioFile: 'audio.mp3', method: methodUsed, attempts: attemptsLog };
}

async function splitSongAudio(song) {
  const songDir = path.join(DOWNLOADS_DIR, song.id);
  const venvActivate = path.resolve(__dirname, '../../venv/bin/activate');
  const files = fs.existsSync(songDir) ? fs.readdirSync(songDir) : [];
  let audioFile = files.find(f => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav'));

  if (!audioFile) {
    song.splitError = "No downloaded audio file found to perform stem separation.";
    song.stems = {};
    return { success: false, error: song.splitError };
  }

  // Ensure audio.mp3 exists
  const mainAudioPath = path.join(songDir, 'audio.mp3');
  if (!fs.existsSync(mainAudioPath)) {
    fs.copyFileSync(path.join(songDir, audioFile), mainAudioPath);
    audioFile = 'audio.mp3';
  }

  const audioPath = path.join(songDir, audioFile);
  const engine = song.engineSettings || currentEngineSettings;
  const mode = engine.mode || 'balanced';
  const format = engine.format || 'MP3';
  const bitrate = engine.bitrate || '192k';

  let splitFailed = false;
  let splitErrorMsg = null;

  try {
    const separateCmd = `source "${venvActivate}" && python "${path.join(__dirname, 'separate.py')}" --input "${audioPath}" --output_dir "${songDir}" --mode "${mode}" --format "${format}" --bitrate "${bitrate}"`;
    await execPromise(separateCmd, { shell: '/bin/bash' });
  } catch (e) {
    console.warn("Splitting failed. Using fallback stem copies.", e);
    splitFailed = true;
    splitErrorMsg = e.stderr || e.message || "Stem separation failed. Using full track fallback.";
  }

  // Guarantee ALL 4 files exist on disk
  const ext = '.mp3';
  for (const stemName of ['instrumental', 'lead_vocal', 'back_vocal']) {
    const stemPath = path.join(songDir, `${stemName}${ext}`);
    if (!fs.existsSync(stemPath)) {
      fs.copyFileSync(mainAudioPath, stemPath);
    }
  }

  // Clean up any extraneous files so strictly only the 4 audio files + lyrics.json + cover remain
  const allowedFiles = new Set(['audio.mp3', 'instrumental.mp3', 'lead_vocal.mp3', 'back_vocal.mp3', 'lyrics.json']);
  for (const f of fs.readdirSync(songDir)) {
    if (!allowedFiles.has(f) && !f.startsWith('cover.') && !f.startsWith('audio.')) {
      try { fs.unlinkSync(path.join(songDir, f)); } catch (e) {}
    }
  }

  const dirFiles = fs.readdirSync(songDir);
  const instFile = dirFiles.find(f => f.startsWith('instrumental.')) || 'instrumental.mp3';
  const leadFile = dirFiles.find(f => f.startsWith('lead_vocal.')) || 'lead_vocal.mp3';
  const backFile = dirFiles.find(f => f.startsWith('back_vocal.')) || 'back_vocal.mp3';

  // Compare file sizes to detect if true separation occurred vs fallback copies
  const instSize = fs.existsSync(path.join(songDir, instFile)) ? fs.statSync(path.join(songDir, instFile)).size : 0;
  const mainSize = fs.existsSync(mainAudioPath) ? fs.statSync(mainAudioPath).size : 0;
  const isSeparated = !splitFailed && instSize > 0 && Math.abs(instSize - mainSize) > 50000;

  const primaryModels = {
    fast: "UVR-MDX-NET-Inst_1.onnx",
    balanced: "UVR-MDX-NET-Inst_HQ_3.onnx",
    high: "MDX23C-InstVoc HQ",
    ultra: "BS-Roformer-Viperx-1297"
  };

  song.stems = {
    inst: `/audio/${song.id}/${instFile}`,
    lead: `/audio/${song.id}/${leadFile}`,
    back: `/audio/${song.id}/${backFile}`,
    full: `/audio/${song.id}/audio.mp3`
  };
  song.splitIsFallback = !isSeparated;
  song.separationInfo = {
    mode,
    format,
    bitrate,
    primaryModel: primaryModels[mode.toLowerCase()] || "UVR-MDX-NET-Inst_HQ_3.onnx",
    karaokeModel: "5_HP-Karaoke-UVR.pth",
    isCustom: !!(song.engineSettings && song.engineSettings.isCustom)
  };
  
  if (splitFailed) {
    song.splitError = splitErrorMsg;
    return { success: true, isFallback: true, stems: song.stems, separationInfo: song.separationInfo, error: splitErrorMsg };
  }

  delete song.splitError;
  return { success: true, isFallback: !isSeparated, stems: song.stems, separationInfo: song.separationInfo, mode, bitrate };
}

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
    // 1. Download Audio
    updateStatus('downloading');
    const dlResult = await downloadSongAudio(song);
    if (!dlResult.success) {
      throw new Error(dlResult.error || "Audio download failed");
    }

    // 2. Stem Separation
    updateStatus('splitting');
    await splitSongAudio(song);

    // 3. Lyrics Fetching
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

    const spotifyTrackArg = song.spotifyTrackId ? ` --spotify_track_id "${song.spotifyTrackId}"` : '';
    const cmd = `source "${venvPython}" && python "${scriptPath}" --title "${safeTitle}" --artist "${safeArtist}" --query "${safeQuery}" --provider "${requestedProvider}"${spotifyTrackArg}`;
    
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

router.post('/import_lyrics/:id', async (req, res) => {
  const songId = req.params.id;
  const { text = '' } = req.body || {};

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

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    return res.status(400).json({ error: 'No lyric lines provided. Please paste lyrics with at least one non-empty line.' });
  }

  const defaultGap = 4.0; // 4 seconds default gap per line for unsynced lyrics
  const rawLyrics = lines.map((line, idx) => ({
    time: parseFloat((idx * defaultGap).toFixed(1)),
    text: line
  }));
  const processedLyrics = await fetchLyricsTranslationAndPronunciation(rawLyrics);

  const attemptsLog = [{
    provider: 'Manual Import',
    status: 'success',
    detail: `Imported ${lines.length} lines (unsynced, 4s gap)`
  }];

  writeSongLyrics(songId, {
    id: songId,
    title: song.title,
    artist: song.artist,
    lyricsProvider: 'Manual Import',
    isSynced: false,
    lyricsAttempts: attemptsLog,
    lyricsError: null,
    lyrics: processedLyrics
  });

  song.hasLyrics = true;
  song.lyricsProvider = 'Manual Import';
  song.isSynced = false;
  song.lyrics = processedLyrics;
  song.lyricsAttempts = attemptsLog;
  delete song.lyricsError;

  saveLightweightHistoryItem(song);

  const io = req.app.get('io');
  if (io) {
    io.emit('queue_updated', queue);
  }

  res.json({
    success: true,
    song,
    count: lines.length,
    attempts: attemptsLog,
    provider: 'Manual Import'
  });
});

router.get('/song_details/:id', (req, res) => {
  const songId = req.params.id;
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

  const songDir = path.join(DOWNLOADS_DIR, song.id);
  const dirFiles = fs.existsSync(songDir) ? fs.readdirSync(songDir) : [];
  const audioFile = dirFiles.find(f => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav'));
  const instFile = dirFiles.find(f => f.startsWith('instrumental.'));
  const leadFile = dirFiles.find(f => f.startsWith('lead_vocal.'));
  const backFile = dirFiles.find(f => f.startsWith('back_vocal.'));

  const defaultDlAttempts = [];
  const dlMethod = song.downloadMethod || (song.isUploaded ? 'Uploaded' : 'SpotDL');
  if (dlMethod === 'Uploaded' || song.isUploaded) {
    defaultDlAttempts.push({ provider: 'Local File Upload', status: 'success', detail: 'Audio track provided via direct user upload' });
  } else if (dlMethod === 'SpotDL') {
    defaultDlAttempts.push({ provider: 'SpotDL', status: 'success', detail: 'Audio track acquired via SpotDL' });
    defaultDlAttempts.push({ provider: 'yt-dlp Direct (Title + Artist)', status: 'skipped', detail: 'Not needed (acquired via SpotDL)' });
    defaultDlAttempts.push({ provider: 'yt-dlp Title Fallback', status: 'skipped', detail: 'Not needed (acquired via SpotDL)' });
  } else if (dlMethod.includes('Title + Artist')) {
    defaultDlAttempts.push({ provider: 'SpotDL', status: 'failed', detail: 'No metadata match on SpotDL' });
    defaultDlAttempts.push({ provider: 'yt-dlp Direct (Title + Artist)', status: 'success', detail: 'Audio extracted via YouTube search' });
    defaultDlAttempts.push({ provider: 'yt-dlp Title Fallback', status: 'skipped', detail: 'Not needed (acquired via yt-dlp Direct)' });
  } else {
    defaultDlAttempts.push({ provider: 'SpotDL', status: 'failed', detail: 'No metadata match on SpotDL' });
    defaultDlAttempts.push({ provider: 'yt-dlp Direct (Title + Artist)', status: 'failed', detail: 'Direct match not found' });
    defaultDlAttempts.push({ provider: 'yt-dlp Title Fallback', status: 'success', detail: 'Audio extracted via title search' });
  }

  const primaryModels = {
    fast: "UVR-MDX-NET-Inst_1.onnx",
    balanced: "UVR-MDX-NET-Inst_HQ_3.onnx",
    high: "MDX23C-InstVoc HQ",
    ultra: "BS-Roformer-Viperx-1297"
  };
  const currentSepMode = (song.engineSettings && song.engineSettings.mode) || 'balanced';
  const currentSepFormat = (song.engineSettings && song.engineSettings.format) || 'MP3';
  const currentSepBitrate = (song.engineSettings && song.engineSettings.bitrate) || '192k';

  const separationInfo = song.separationInfo || {
    mode: currentSepMode,
    format: currentSepFormat,
    bitrate: currentSepBitrate,
    primaryModel: primaryModels[currentSepMode.toLowerCase()] || "UVR-MDX-NET-Inst_HQ_3.onnx",
    karaokeModel: "5_HP-Karaoke-UVR.pth",
    isCustom: !!(song.engineSettings && song.engineSettings.isCustom)
  };

  res.json({
    song,
    components: {
      download: {
        status: audioFile ? 'success' : (song.downloadError ? 'error' : 'pending'),
        audioFile: audioFile || null,
        method: dlMethod,
        error: song.downloadError || null,
        attempts: (song.downloadAttempts && song.downloadAttempts.length > 0) ? song.downloadAttempts : defaultDlAttempts
      },
      splitting: {
        status: (instFile && leadFile && backFile) ? 'separated' : (audioFile ? 'fallback' : 'pending'),
        isFallback: song.splitIsFallback || !instFile,
        stems: song.stems || {},
        separationInfo,
        error: song.splitError || null
      },
      lyrics: {
        status: song.lyricsProvider ? 'success' : (song.lyricsError ? 'failed' : 'pending'),
        provider: song.lyricsProvider || null,
        count: (song.lyrics || []).length,
        hasLyrics: !!song.hasLyrics,
        attempts: song.lyricsAttempts || [],
        error: song.lyricsError || null
      }
    }
  });
});

router.post('/retry_download/:id', async (req, res) => {
  const songId = req.params.id;
  const { source = 'auto' } = req.body || {};
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
  song.status = 'downloading';
  saveLightweightHistoryItem(song);
  if (io) {
    io.emit('queue_updated', queue);
    io.emit('library_updated', readHistory());
  }

  const result = await downloadSongAudio(song, source);
  
  if (result.success) {
    await splitSongAudio(song);
    song.status = 'ready';
  } else {
    song.status = 'error';
  }
  saveLightweightHistoryItem(song);

  if (io) {
    io.emit('queue_updated', queue);
    io.emit('library_updated', readHistory());
  }

  res.json({
    success: result.success,
    song,
    details: result
  });
});

router.post('/retry_splitting/:id', async (req, res) => {
  const songId = req.params.id;
  const { mode, format, bitrate, isCustom } = req.body || {};

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

  if (mode) {
    song.engineSettings = {
      mode: mode || 'balanced',
      format: format || 'MP3',
      bitrate: bitrate || '192k',
      isCustom: isCustom !== false
    };
  }

  const io = req.app.get('io');
  song.status = 'splitting';
  saveLightweightHistoryItem(song);
  if (io) {
    io.emit('queue_updated', queue);
    io.emit('library_updated', readHistory());
  }

  const result = await splitSongAudio(song);
  song.status = 'ready';
  saveLightweightHistoryItem(song);

  if (io) {
    io.emit('queue_updated', queue);
    io.emit('library_updated', readHistory());
  }

  res.json({
    success: result.success,
    song,
    separationInfo: song.separationInfo,
    details: result
  });
});

function parseLrc(lrcString) {
  if (!lrcString) return [];
  const lines = lrcString.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\]/;
  
  let hasTimestamps = false;
  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      hasTimestamps = true;
      const min = parseInt(match[1]);
      const sec = parseFloat(match[2]);
      const time = min * 60 + sec;
      const text = line.replace(timeRegex, '').trim();
      if (text) {
        result.push({ time, text, translation: '', transliteration: '' });
      }
    }
  }

  // Fallback for unsynced/plain lyrics without timestamps: spread out lines with default 4s gap
  if (!hasTimestamps) {
    const defaultGap = 4.0;
    let lineIdx = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        const time = parseFloat((lineIdx * defaultGap).toFixed(1));
        result.push({ time, text: trimmed, translation: '', transliteration: '' });
        lineIdx++;
      }
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

// Metadata editing endpoint
router.post('/edit_metadata', upload.single('coverImage'), (req, res) => {
  const { songId, title, artist, coverUrl } = req.body;
  const history = readHistory();
  const idx = history.findIndex(s => s.id === songId);

  let newAlbumArt = coverUrl;

  // Handle uploaded cover image
  if (req.file) {
    const songDir = path.join(DOWNLOADS_DIR, songId);
    if (!fs.existsSync(songDir)) {
      fs.mkdirSync(songDir, { recursive: true });
    }
    const ext = path.extname(req.file.originalname) || '.jpg';
    const newCoverName = `cover${ext}`;
    const newCoverPath = path.join(songDir, newCoverName);
    
    // Remove any existing cover files to avoid stale covers
    try {
      const existingFiles = fs.readdirSync(songDir);
      for (const f of existingFiles) {
        if (f.startsWith('cover.') || f.startsWith('cover-')) {
          try { fs.unlinkSync(path.join(songDir, f)); } catch(e){}
        }
      }
    } catch (e) {}

    // Move uploaded file
    try {
      fs.copyFileSync(req.file.path, newCoverPath);
      fs.unlinkSync(req.file.path);
      newAlbumArt = `/audio/${songId}/${newCoverName}?t=${Date.now()}`;
    } catch (e) {
      console.error('Error saving uploaded cover image:', e);
    }
  }

  const existingLyricsData = readSongLyrics(songId);
  if (title !== undefined) existingLyricsData.title = title;
  if (artist !== undefined) existingLyricsData.artist = artist;
  writeSongLyrics(songId, existingLyricsData);

  let updatedSong = null;

  if (idx !== -1) {
    if (title !== undefined) history[idx].title = title;
    if (artist !== undefined) history[idx].artist = artist;
    if (newAlbumArt !== undefined && newAlbumArt.trim() !== '') history[idx].albumArt = newAlbumArt;
    updatedSong = history[idx];
    writeHistory(history);
  }

  const qIdx = queue.findIndex(s => s.id === songId);
  if (qIdx !== -1) {
    if (title !== undefined) queue[qIdx].title = title;
    if (artist !== undefined) queue[qIdx].artist = artist;
    if (newAlbumArt !== undefined && newAlbumArt.trim() !== '') queue[qIdx].albumArt = newAlbumArt;
    if (!updatedSong) updatedSong = queue[qIdx];
  }

  // Notify all clients to refresh queue and library
  req.app.get('io').emit('queue_updated', queue);
  req.app.get('io').emit('library_updated');

  res.json({ success: true, updatedSong });
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

