import React, { useState, useEffect } from 'react';
import { Search, Music, Headphones, Send, Clock, Check, X, RefreshCw } from 'lucide-react';
import { searchTracks, fetchLibrary } from '../../services/api';
import { useSocialStore } from '../../stores/useSocialStore';
import * as socialApi from '../../services/socialApi';
import AudioPreviewPlayer from './AudioPreviewPlayer';

export default function GuestRequestView() {
  const guestId = useSocialStore((state) => state.guestId);
  const nickname = useSocialStore((state) => state.nickname);
  const avatarColor = useSocialStore((state) => state.avatarColor);
  const requests = useSocialStore((state) => state.requests);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [librarySongs, setLibrarySongs] = useState([]);
  const [previewSong, setPreviewSong] = useState(null);
  const [selectedForRequest, setSelectedForRequest] = useState(null);
  const [noteInput, setNoteInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load library on mount for instant searching
  useEffect(() => {
    fetchLibrary().then(lib => {
      if (Array.isArray(lib)) setLibrarySongs(lib);
    }).catch(() => {});
  }, []);

  const myRequests = requests.filter(r => r.requestedBy?.guestId === guestId);

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setIsSearching(true);
    try {
      // 1. Search local library
      const localMatches = librarySongs.filter(s =>
        (s.title && s.title.toLowerCase().includes(q.toLowerCase())) ||
        (s.artist && s.artist.toLowerCase().includes(q.toLowerCase()))
      ).map(s => ({ ...s, isLocal: true }));

      // 2. Search online tracks via backend
      let onlineResults = [];
      try {
        const searchRes = await searchTracks(q);
        if (Array.isArray(searchRes)) {
          onlineResults = searchRes.filter(on => !localMatches.some(loc => loc.id === on.id));
        }
      } catch (err) {
        console.warn('Online track search warning:', err);
      }

      setResults([...localMatches, ...onlineResults]);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleOpenRequestModal = (song) => {
    if (!nickname) {
      alert('Please set your nickname before requesting a song.');
      return;
    }
    setSelectedForRequest(song);
    setNoteInput('');
  };

  const handleSubmitRequest = async (e) => {
    if (e) e.preventDefault();
    if (!selectedForRequest) return;

    setIsSubmitting(true);
    try {
      await socialApi.submitSongRequest({
        song: selectedForRequest,
        requestedBy: { guestId, nickname, avatarColor },
        notes: noteInput.trim() || null
      });
      setSelectedForRequest(null);
      setNoteInput('');
    } catch (err) {
      alert(`Request failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRequest = async (requestId) => {
    try {
      await socialApi.deleteSongRequest(requestId, { guestId });
    } catch (err) {
      alert(`Could not cancel request: ${err.message}`);
    }
  };

  return (
    <div className="guest-request-view">
      {/* Local Audition Player */}
      {previewSong && (
        <AudioPreviewPlayer
          songId={previewSong.id || previewSong.songId}
          title={previewSong.title}
          artist={previewSong.artist}
          onClose={() => setPreviewSong(null)}
        />
      )}

      {/* Search Header */}
      <form onSubmit={handleSearch} className="guest-search-form">
        <div className="search-input-wrap">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Search song title, artist, or YouTube URL..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input-glass guest-search-input"
            dir="auto"
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={isSearching || !query.trim()}>
          {isSearching ? <RefreshCw size={16} className="icon-spin" /> : 'Search'}
        </button>
      </form>

      {/* Search Results */}
      {results.length > 0 && (
        <div className="search-results-section">
          <h4>Results ({results.length})</h4>
          <div className="search-results-list">
            {results.map((song) => {
              const songId = song.id || song.songId;
              const hasAudio = song.isLocal && song.status === 'ready';

              return (
                <div key={songId || song.title} className="search-result-card glass">
                  <img
                    src={song.albumArt || '/CtrlAltLyrics-logo.svg'}
                    alt="Art"
                    className="result-art"
                    onError={(e) => { e.target.onerror = null; e.target.src = '/CtrlAltLyrics-logo.svg'; }}
                  />
                  <div className="result-info">
                    <strong className="result-title" dir="auto">{song.title}</strong>
                    <span className="result-artist" dir="auto">{song.artist}</span>
                    {song.isLocal && <span className="local-badge">Ready in Library ⚡</span>}
                  </div>

                  <div className="result-actions">
                    {hasAudio && (
                      <button
                        className="btn glass-btn btn-sm btn-audition"
                        onClick={() => setPreviewSong(song)}
                        title="Audition Preview"
                      >
                        <Headphones size={13} />
                      </button>
                    )}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleOpenRequestModal(song)}
                    >
                      <Send size={13} />
                      <span>Request</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* My Requests Section */}
      <div className="my-requests-section">
        <h4>My Requests ({myRequests.length})</h4>
        {myRequests.length === 0 ? (
          <p className="no-requests-hint">You haven't requested any songs yet.</p>
        ) : (
          <div className="my-requests-list">
            {myRequests.map((r) => (
              <div key={r.requestId} className="my-request-card glass">
                <div className="my-request-info">
                  <strong dir="auto">{r.song?.title}</strong>
                  <span dir="auto">{r.song?.artist}</span>
                  {r.notes && <span className="request-dedication" dir="auto">"{r.notes}"</span>}
                </div>

                <div className="my-request-status">
                  {r.status === 'pending_approval' && (
                    <span className="status-pill status-pending">
                      <Clock size={11} /> Pending Host
                    </span>
                  )}
                  {r.status === 'approved' && (
                    <span className="status-pill status-approved">
                      <Check size={11} /> Approved
                    </span>
                  )}
                  {r.status === 'rejected' && (
                    <span className="status-pill status-rejected">
                      <X size={11} /> Declined
                    </span>
                  )}

                  {r.status === 'pending_approval' && (
                    <button
                      className="btn-cancel-request"
                      onClick={() => handleCancelRequest(r.requestId)}
                      title="Cancel Request"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Request Dedication Modal */}
      {selectedForRequest && (
        <div className="modal-backdrop glass">
          <div className="request-modal-card glass">
            <h3>Request Song</h3>
            <p className="request-song-target" dir="auto">
              <strong dir="auto">{selectedForRequest.title}</strong> by <span dir="auto">{selectedForRequest.artist}</span>
            </p>

            <form onSubmit={handleSubmitRequest}>
              <label htmlFor="reqNote">Optional Dedication / Note for Host & Display:</label>
              <input
                id="reqNote"
                type="text"
                placeholder="e.g. Duet with Alex! 🎂"
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                className="input-glass"
                maxLength={100}
                dir="auto"
                autoFocus
              />

              <div className="modal-actions-row">
                <button
                  type="button"
                  className="btn glass-btn"
                  onClick={() => setSelectedForRequest(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
