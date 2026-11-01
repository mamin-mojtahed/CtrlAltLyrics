/**
 * Extract an 11-character YouTube video ID from various URL formats or raw ID strings.
 * Supports standard watch URLs, youtu.be, music.youtube.com, embed, shorts, and live URLs.
 */
export function extractYoutubeId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const str = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  const match = str.match(/(?:youtu\.be\/|(?:www\.|music\.)?youtube\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i);
  return match ? match[1] : null;
}

