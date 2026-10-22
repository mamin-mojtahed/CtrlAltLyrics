import React from 'react';

export default function SongStatusBadges({ song }) {
  if (!song) return null;

  const hasAudio = (song.stems && (song.stems.inst || song.stems.lead)) ||
    song.status === 'splitting' ||
    song.status === 'fetching_lyrics' ||
    song.status === 'ready';

  const hasSplitStems = (song.stems && song.stems.inst && song.stems.lead && song.stems.inst !== song.stems.lead) ||
    song.status === 'fetching_lyrics' ||
    song.status === 'ready';

  const hasLyricsLoaded = (song.lyrics && song.lyrics.length > 0) || song.hasLyrics === true;

  // 1. Download Status
  let downloadTitle = 'Waiting to download audio...';
  let downloadPhaseClass = 'icon-x';
  let downloadPhaseColor = '#ef4444';

  if (song.status === 'downloading') {
    downloadTitle = 'Downloading audio...';
    downloadPhaseClass = 'icon-loader-2 icon-spin';
    downloadPhaseColor = undefined;
  } else if (song.downloadError || (song.status === 'error' && !hasAudio)) {
    downloadTitle = `Download Error: ${song.downloadError || 'Failed'}`;
    downloadPhaseClass = 'icon-x';
    downloadPhaseColor = '#ef4444';
  } else if (hasAudio || song.status === 'ready') {
    downloadTitle = 'Audio Downloaded';
    downloadPhaseClass = 'icon-check';
    downloadPhaseColor = '#10b981';
  }

  // 2. Split Status
  let splitTitle = 'Waiting to split stems...';
  let splitPhaseClass = 'icon-x';
  let splitPhaseColor = '#ef4444';

  if (song.status === 'splitting') {
    splitTitle = 'Splitting vocal and instrumental stems...';
    splitPhaseClass = 'icon-loader-2 icon-spin';
    splitPhaseColor = undefined;
  } else if (song.splitError) {
    splitTitle = `Stem Split Error: ${song.splitError || 'Failed'}`;
    splitPhaseClass = 'icon-x';
    splitPhaseColor = '#ef4444';
  } else if (hasSplitStems || (song.status === 'ready' && !song.splitError)) {
    splitTitle = 'Stems Separated';
    splitPhaseClass = 'icon-check';
    splitPhaseColor = '#10b981';
  }

  // 3. Lyrics Status
  let lyricsTitle = 'Waiting to fetch lyrics...';
  let lyricsPhaseClass = 'icon-x';
  let lyricsPhaseColor = '#ef4444';

  if (song.status === 'fetching_lyrics' || song.lyricsStatus) {
    lyricsTitle = `Fetching Lyrics: ${song.lyricsStatus || 'Searching...'}`;
    lyricsPhaseClass = 'icon-loader-2 icon-spin';
    lyricsPhaseColor = undefined;
  } else if (song.lyricsError || !hasLyricsLoaded) {
    lyricsTitle = `Lyrics: ${song.lyricsError || 'No lyrics found'}`;
    lyricsPhaseClass = 'icon-x';
    lyricsPhaseColor = '#ef4444';
  } else if (hasLyricsLoaded) {
    const prov = song.lyricsProvider ? ` (${song.lyricsProvider})` : '';
    lyricsTitle = `Lyrics Loaded${prov}`;
    lyricsPhaseClass = 'icon-check';
    lyricsPhaseColor = '#10b981';
  }

  return (
    <div className="emoji-badges-row">
      <span className="emoji-badge status-badge-download" title={downloadTitle}>
        <i className={`${downloadPhaseClass} status-phase-icon`} style={downloadPhaseColor ? { color: downloadPhaseColor } : {}}></i>
        <i className="icon-download status-component-icon"></i>
      </span>

      <span className="emoji-badge status-badge-split" title={splitTitle}>
        <i className={`${splitPhaseClass} status-phase-icon`} style={splitPhaseColor ? { color: splitPhaseColor } : {}}></i>
        <i className="icon-scissors status-component-icon"></i>
      </span>

      <span className="emoji-badge status-badge-lyrics" title={lyricsTitle}>
        <i className={`${lyricsPhaseClass} status-phase-icon`} style={lyricsPhaseColor ? { color: lyricsPhaseColor } : {}}></i>
        <i className="icon-file-text status-component-icon"></i>
      </span>
    </div>
  );
}
