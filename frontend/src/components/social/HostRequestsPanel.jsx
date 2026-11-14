import React, { useState } from 'react';
import { Check, X, Headphones, Clock, ArrowDown, ArrowUp, Music, Heart, MessageSquare, Mic } from 'lucide-react';
import { useSocialStore } from '../../stores/useSocialStore';
import * as socialApi from '../../services/socialApi';
import AudioPreviewPlayer from './AudioPreviewPlayer';

export default function HostRequestsPanel() {
  const requests = useSocialStore((state) => state.requests);
  const stageJoinRequests = useSocialStore((state) => state.stageJoinRequests);
  const hostToken = useSocialStore((state) => state.hostToken);
  const isHostAuthorized = useSocialStore((state) => state.isHostAuthorized);

  const [previewingSong, setPreviewingSong] = useState(null);
  const [processingId, setProcessingId] = useState(null);

  const pendingRequests = requests.filter((r) => r.status === 'pending_approval');
  const pastRequests = requests.filter((r) => r.status !== 'pending_approval');
  const pendingStageRequests = Array.isArray(stageJoinRequests) ? stageJoinRequests.filter(r => r.status === 'pending') : [];

  const handleApproveStage = async (requestId) => {
    try {
      await socialApi.approveStageJoinRequest(requestId, hostToken);
    } catch (err) {
      alert(`Approval failed: ${err.message}`);
    }
  };

  const handleRejectStage = async (requestId) => {
    try {
      await socialApi.rejectStageJoinRequest(requestId, hostToken);
    } catch (err) {
      alert(`Decline failed: ${err.message}`);
    }
  };

  const handleApprove = async (requestId, position = 'end') => {
    try {
      setProcessingId(requestId);
      await socialApi.approveSongRequest(requestId, position, hostToken);
    } catch (err) {
      alert(`Approval failed: ${err.message}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (requestId) => {
    const reason = prompt('Optional reason for declining request (or leave blank):', 'Declined by host');
    if (reason === null) return; // User cancelled
    try {
      setProcessingId(requestId);
      await socialApi.rejectSongRequest(requestId, reason || 'Declined', hostToken);
    } catch (err) {
      alert(`Decline failed: ${err.message}`);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="host-requests-panel">
      {/* Audio Preview Dock if active */}
      {previewingSong && (
        <AudioPreviewPlayer
          songId={previewingSong.id || previewingSong.songId}
          title={previewingSong.title}
          artist={previewingSong.artist}
          onClose={() => setPreviewingSong(null)}
        />
      )}

      {/* Live Stage Join Requests Section */}
      {pendingStageRequests.length > 0 && (
        <div className="stage-requests-section" style={{ marginBottom: '1.25rem' }}>
          <div className="requests-header">
            <div className="requests-title-group">
              <h3 style={{ color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Mic size={18} />
                Live Stage Join Requests
              </h3>
              <span className="requests-count-badge active">
                {pendingStageRequests.length} Live
              </span>
            </div>
          </div>

          <div className="requests-list" style={{ marginTop: '0.6rem' }}>
            {pendingStageRequests.map((stgReq) => (
              <div key={stgReq.id} className="request-card glass stage-request-card" style={{ borderColor: 'rgba(245, 158, 11, 0.4)' }}>
                <span
                  className="avatar-dot"
                  style={{ backgroundColor: stgReq.avatarColor || '#6366f1', width: 14, height: 14 }}
                />
                <div className="request-card-body">
                  <div className="request-song-info">
                    <strong className="request-song-title" dir="auto">
                      {stgReq.nickname} wants to join the stage!
                    </strong>
                    <span className="request-song-artist" dir="auto">Current Song: {stgReq.songTitle}</span>
                  </div>
                </div>
                <div className="request-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleApproveStage(stgReq.id)}
                    title="Welcome singer to stage"
                  >
                    <Check size={14} /> Welcome to Stage
                  </button>
                  <button
                    className="btn glass-btn btn-sm btn-reject"
                    onClick={() => handleRejectStage(stgReq.id)}
                    title="Decline request"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="requests-header">
        <div className="requests-title-group">
          <h3>Song Requests</h3>
          <span className={`requests-count-badge ${pendingRequests.length > 0 ? 'active' : ''}`}>
            {pendingRequests.length} Pending
          </span>
        </div>
      </div>

      {pendingRequests.length === 0 ? (
        <div className="requests-empty glass">
          <Music size={32} className="empty-icon" />
          <p>No pending song requests</p>
          <span className="empty-hint">Guest requests will appear here in real-time</span>
        </div>
      ) : (
        <div className="requests-list">
          {pendingRequests.map((reqItem) => {
            const song = reqItem.song || {};
            const songId = song.id || song.songId;
            const isProcessing = processingId === reqItem.requestId;

            return (
              <div key={reqItem.requestId} className="request-card glass">
                <img
                  src={song.albumArt || '/CtrlAltLyrics-logo.svg'}
                  alt="Cover"
                  className="request-card-art"
                  onError={(e) => { e.target.onerror = null; e.target.src = '/CtrlAltLyrics-logo.svg'; }}
                />

                <div className="request-card-body">
                  <div className="request-song-info">
                    <strong className="request-song-title" dir="auto">{song.title || 'Unknown Title'}</strong>
                    <span className="request-song-artist" dir="auto">{song.artist || 'Unknown Artist'}</span>
                  </div>

                  <div className="request-meta-row">
                    <span className="request-by-chip" dir="auto" style={{ borderColor: reqItem.requestedBy?.avatarColor || '#6366f1' }}>
                      👤 {reqItem.requestedBy?.nickname || 'Guest'}
                    </span>
                    {reqItem.notes && (
                      <span className="request-notes" dir="auto" title={reqItem.notes}>
                        <MessageSquare size={12} /> <span dir="auto">{reqItem.notes}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="request-actions">
                  <button
                    className="btn glass-btn request-action-btn btn-audition"
                    onClick={() => setPreviewingSong(song)}
                    title="Audition Preview"
                  >
                    <Headphones size={15} />
                    <span>Audition</span>
                  </button>

                  <div className="approve-button-split">
                    <button
                      className="btn btn-primary request-action-btn btn-approve-next"
                      disabled={isProcessing}
                      onClick={() => handleApprove(reqItem.requestId, 'next')}
                      title="Approve & Queue as Next Song"
                    >
                      <ArrowUp size={14} />
                      <span>Next</span>
                    </button>

                    <button
                      className="btn btn-primary request-action-btn btn-approve-end"
                      disabled={isProcessing}
                      onClick={() => handleApprove(reqItem.requestId, 'end')}
                      title="Approve & Append to Queue End"
                    >
                      <Check size={14} />
                      <span>Queue</span>
                    </button>
                  </div>

                  <button
                    className="btn glass-btn request-action-btn btn-reject"
                    disabled={isProcessing}
                    onClick={() => handleReject(reqItem.requestId)}
                    title="Decline Request"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pastRequests.length > 0 && (
        <details className="past-requests-toggle">
          <summary>Recent History ({pastRequests.length})</summary>
          <div className="past-requests-list">
            {pastRequests.slice(0, 10).map((r) => (
              <div key={r.requestId} className="past-request-item glass">
                <span className="past-title">{r.song?.title}</span>
                <span className={`status-pill ${r.status}`}>
                  {r.status === 'approved' ? '✓ Approved' : '✕ Declined'}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
