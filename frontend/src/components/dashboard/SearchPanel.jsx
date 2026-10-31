import React, { useState, useRef, useEffect } from 'react';
import * as api from '../../services/api';
import { useQueueStore } from '../../stores/useQueueStore';
import ScrollShadowWrapper from '../common/ScrollShadowWrapper';

export default function SearchPanel() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [lastSearchedQuery, setLastSearchedQuery] = useState('');
  const activeSearchRef = useRef(null);

  // Engine Settings state
  const [showEngineSettings, setShowEngineSettings] = useState(false);
  const [isCustomEngine, setIsCustomEngine] = useState(false);
  const [engineMode, setEngineMode] = useState('balanced');
  const [engineFormat, setEngineFormat] = useState('MP3');
  const [engineBitrate, setEngineBitrate] = useState('192k');

  const enqueue = useQueueStore((state) => state.enqueue);
  const searchContainerRef = useRef(null);

  const isUrl = (str) => {
    if (!str) return false;
    const trimmed = str.trim();
    if (/^https?:\/\//i.test(trimmed)) return true;
    if (/^spotify:/i.test(trimmed)) return true;
    if (/(?:spotify\.com|spotify\.link|youtube\.com|youtu\.be|soundcloud\.com)/i.test(trimmed)) return true;
    return false;
  };

  // Close search popup & engine settings when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setShowResults(false);
        setShowEngineSettings(false);
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const executeSearch = (searchQuery) => {
    const q = (searchQuery !== undefined ? searchQuery : query).trim();
    if (!q) {
      setShowResults(false);
      return Promise.resolve([]);
    }

    if (activeSearchRef.current && activeSearchRef.current.query === q) {
      return activeSearchRef.current.promise;
    }

    setIsSearching(true);
    setSearchError(null);
    setShowResults(true);

    const promise = (async () => {
      try {
        const data = await api.searchTracks(q);
        const res = Array.isArray(data) ? data : (data ? [data] : []);
        setResults(res);
        setLastSearchedQuery(q);
        return res;
      } catch (err) {
        setSearchError(err.message || 'Search failed');
        setResults([]);
        return [];
      } finally {
        setIsSearching(false);
        activeSearchRef.current = null;
      }
    })();

    activeSearchRef.current = { query: q, promise };
    return promise;
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    if (!val.trim()) {
      setShowResults(false);
      setResults(null);
      setLastSearchedQuery('');
      return;
    }
    // Auto search on Spotify URLs
    if (val.includes('spotify.com') || val.includes('spotify.link') || val.startsWith('spotify:track:')) {
      executeSearch(val);
    }
  };

  const handleEnqueue = async (song) => {
    if (!song) return;
    const songPayload = isCustomEngine
      ? { ...song, engineSettings: { mode: engineMode, format: engineFormat, bitrate: engineBitrate } }
      : song;
    await enqueue(songPayload);
    setShowResults(false);
    setResults(null);
    setLastSearchedQuery('');
    setQuery('');
  };

  const handleKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;

      // 1. If from previous enter/go only one result is shown, immediately queue it
      if (showResults && results && results.length === 1 && !isSearching && lastSearchedQuery === trimmed) {
        await handleEnqueue(results[0]);
        return;
      }

      // 2. If it's a URL, immediately queue
      if (isUrl(trimmed)) {
        if (showResults && results && results.length > 0 && !isSearching && lastSearchedQuery === trimmed) {
          await handleEnqueue(results[0]);
          return;
        }

        const searchRes = await executeSearch(trimmed);
        if (Array.isArray(searchRes) && searchRes.length > 0) {
          await handleEnqueue(searchRes[0]);
        }
        return;
      }

      // 3. Regular search query: execute search
      await executeSearch(trimmed);
    } else if (e.key === 'Escape') {
      setShowResults(false);
      setShowEngineSettings(false);
    }
  };

  const engineBadgeText = isCustomEngine
    ? `Custom (${engineMode}, ${engineFormat} ${engineBitrate})`
    : 'Balanced (MP3 192k)';

  const isSpotifyLink = query.includes('spotify.com') || query.includes('spotify.link') || query.startsWith('spotify:track:');

  return (
    <div className="search-header-block" ref={searchContainerRef}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
        <h2>Search</h2>
        <button
          className="btn"
          style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem', background: 'rgba(255,255,255,0.12)' }}
          title="Separation Settings"
          onClick={() => setShowEngineSettings(!showEngineSettings)}
        >
          <i className="icon-settings" style={{ marginRight: '0.25rem' }}></i>
          <span>{engineBadgeText}</span>
        </button>
      </div>

      {/* Separation Engine Settings Panel */}
      {showEngineSettings && (
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0.6rem',
            marginBottom: '0.5rem',
            fontSize: '0.8rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <strong style={{ color: 'var(--accent)', fontSize: '0.75rem' }}>
              <i className="icon-settings" style={{ marginRight: '0.3rem' }}></i>
              Stem Separation Options
            </strong>
            <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isCustomEngine}
                onChange={(e) => setIsCustomEngine(e.target.checked)}
              />
              Custom Settings
            </label>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '0.4rem',
              flexWrap: 'wrap',
              opacity: isCustomEngine ? 1 : 0.5,
              pointerEvents: isCustomEngine ? 'auto' : 'none',
              transition: 'opacity 0.2s'
            }}
          >
            <div>
              <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Mode:</label>
              <select
                value={engineMode}
                onChange={(e) => setEngineMode(e.target.value)}
                style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.2rem', fontSize: '0.75rem' }}
              >
                <option value="balanced">Balanced (~30s)</option>
                <option value="fast">Fast (~10s)</option>
                <option value="high">High Precision (~60s)</option>
                <option value="ultra">Ultra Quality (~2m)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Format:</label>
              <select
                value={engineFormat}
                onChange={(e) => setEngineFormat(e.target.value)}
                style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.2rem', fontSize: '0.75rem' }}
              >
                <option value="MP3">MP3 (Compact)</option>
                <option value="M4A">M4A (AAC)</option>
                <option value="WAV">WAV (Uncompressed)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Bitrate:</label>
              <select
                value={engineBitrate}
                onChange={(e) => setEngineBitrate(e.target.value)}
                style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.2rem', fontSize: '0.75rem' }}
              >
                <option value="192k">192 kbps (Default)</option>
                <option value="320k">320 kbps (High)</option>
                <option value="128k">128 kbps (Draft)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Search Input Bar */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            id="searchInput"
            type="search"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Search song title or paste Spotify link..."
            autoComplete="off"
          />
          <button
            id="searchBtn"
            className="btn search-go-btn"
            onClick={() => executeSearch()}
            disabled={!query.trim() || isSearching}
          >
            Go
          </button>
        </div>

        {/* Search Results Dropdown Popup */}
        {showResults && (
          <ScrollShadowWrapper className="search-results-scroll-wrapper">
            <div className="search-results-popup" style={{ display: 'flex' }}>
              {isSearching ? (
                <div style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <i className={isSpotifyLink ? 'icon-disc' : 'icon-loader-2 icon-spin'}></i>
                  <span>{isSpotifyLink ? 'Fetching Spotify Track...' : 'Searching songs...'}</span>
                </div>
              ) : searchError ? (
                <div style={{ padding: '0.75rem', textAlign: 'center', color: '#f87171', fontSize: '0.85rem' }}>
                  <i className="icon-alert-triangle" style={{ marginRight: '0.35rem' }}></i>
                  Search failed: {searchError}
                </div>
              ) : results && results.length > 0 ? (
                results.map((song, idx) => (
                  <div
                    key={song.id || idx}
                    className="song-card search-card"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleEnqueue(song)}
                  >
                    <img
                      src={song.albumArt || '/CtrlAltLyrics-logo.svg'}
                      alt="art"
                      onError={(e) => { e.target.onerror = null; e.target.src = '/CtrlAltLyrics-logo.svg'; }}
                    />
                    <div className="song-info">
                      <div className="song-title">
                        {song.title || 'Unknown Title'}
                        {(song.isSpotify || song.spotifyUrl) && (
                          <span className="spotify-badge" title="Spotify Direct Track">
                            <i className="icon-disc" style={{ marginRight: '0.2rem' }}></i> Spotify
                          </span>
                        )}
                      </div>
                      <div className="song-artist">{song.artist || 'Unknown Artist'}</div>
                    </div>
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEnqueue(song);
                      }}
                    >
                      Queue
                    </button>
                  </div>
                ))
              ) : (
                <div style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  No tracks found
                </div>
              )}
            </div>
          </ScrollShadowWrapper>
        )}
      </div>
    </div>
  );
}
