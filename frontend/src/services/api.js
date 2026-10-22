// REST API Client for Ctrl+Alt+Lyrics Backend

export async function fetchLibrary() {
  const res = await fetch('/api/history');
  if (!res.ok) throw new Error(`Failed to fetch library: ${res.statusText}`);
  return res.json();
}

export async function fetchQueue() {
  const res = await fetch('/api/queue');
  if (!res.ok) throw new Error(`Failed to fetch queue: ${res.statusText}`);
  return res.json();
}

export async function fetchSong(id) {
  const res = await fetch(`/api/song/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch song ${id}: ${res.statusText}`);
  return res.json();
}

export async function fetchSongDetails(id) {
  const res = await fetch(`/api/song_details/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch song details ${id}: ${res.statusText}`);
  return res.json();
}

export async function searchTracks(query) {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
  return res.json();
}

export async function enqueueSong(song, insertIndex = undefined) {
  const res = await fetch('/api/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      song,
      insertIndex
    })
  });
  if (!res.ok) throw new Error(`Enqueue failed: ${res.statusText}`);
  return res.json();
}

export async function reorderQueueItem(queueId, direction) {
  const res = await fetch('/api/queue/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId, direction })
  });
  if (!res.ok) throw new Error(`Reorder failed: ${res.statusText}`);
  return res.json();
}

export async function reorderQueueList(queueIds) {
  const res = await fetch('/api/queue/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueIds })
  });
  if (!res.ok) throw new Error(`Reorder failed: ${res.statusText}`);
  return res.json();
}

export async function removeFromQueue(queueId) {
  const res = await fetch(`/api/queue/${queueId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to remove queue item: ${res.statusText}`);
  return res.json();
}

export async function removeFromLibrary(id) {
  const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to remove song: ${res.statusText}`);
  return res.json();
}

export async function openFolder(id) {
  return fetch(`/api/open_folder/${id}`, { method: 'POST' });
}

export async function retryDownload(id, source = 'auto') {
  const res = await fetch(`/api/retry_download/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source })
  });
  if (!res.ok) throw new Error(`Retry download failed: ${res.statusText}`);
  return res.json();
}

export async function retrySplitting(id, engineSettings = null) {
  const res = await fetch(`/api/retry_splitting/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(engineSettings || {})
  });
  if (!res.ok) throw new Error(`Retry splitting failed: ${res.statusText}`);
  return res.json();
}

export async function retryLyrics(id, provider = 'auto') {
  const res = await fetch(`/api/retry_lyrics/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider })
  });
  if (!res.ok) throw new Error(`Retry lyrics failed: ${res.statusText}`);
  return res.json();
}

export async function importManualLyrics(id, lyricsText) {
  const res = await fetch(`/api/import_lyrics/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lyricsText })
  });
  if (!res.ok) throw new Error(`Import lyrics failed: ${res.statusText}`);
  return res.json();
}

export async function editLyrics(id, lyrics) {
  const res = await fetch('/api/edit_lyrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, lyrics })
  });
  if (!res.ok) throw new Error(`Save lyrics failed: ${res.statusText}`);
  return res.json();
}

export async function editMetadata(id, title, artist, albumArt) {
  const res = await fetch('/api/edit_metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, title, artist, albumArt })
  });
  if (!res.ok) throw new Error(`Save metadata failed: ${res.statusText}`);
  return res.json();
}
