import React, { useState } from 'react';
import { UserPlus, UserMinus, Trash2, Mic, Music, ThumbsUp } from 'lucide-react';
import { useQueueStore } from '../../stores/useQueueStore';
import { useSocialStore } from '../../stores/useSocialStore';
import * as socialApi from '../../services/socialApi';

export default function GuestQueueView() {
  const queue = useQueueStore((state) => state.queue);
  const nickname = useSocialStore((state) => state.nickname);
  const guestId = useSocialStore((state) => state.guestId);
  const avatarColor = useSocialStore((state) => state.avatarColor);

  const [loadingActionId, setLoadingActionId] = useState(null);

  const handleToggleSinger = async (queueId, isJoined, isCurrentSong = false) => {
    if (!nickname) {
      alert('Please set your nickname before joining a song.');
      return;
    }
    try {
      setLoadingActionId(queueId);
      if (isCurrentSong && !isJoined) {
        const res = await socialApi.requestJoinStage({ guestId, nickname, avatarColor });
        if (!res.autoApproved) {
          alert('Stage join request sent to the host! 🎤');
        }
      } else if (isCurrentSong && isJoined) {
        await socialApi.leaveStage(nickname);
      } else {
        await socialApi.updateQueueSingers(queueId, nickname, isJoined ? 'leave' : 'join');
      }
    } catch (err) {
      alert(`Could not update singer status: ${err.message}`);
    } finally {
      setLoadingActionId(null);
    }
  };

  const handleToggleUpvote = async (targetId) => {
    try {
      await socialApi.toggleUpvote({ targetType: 'queue', targetId, guestId });
    } catch (err) {
      console.warn('Upvote toggle failed:', err);
    }
  };

  const handleDeleteOwnSong = async (queueId, songTitle) => {
    if (!confirm(`Are you sure you want to remove "${songTitle}" from the queue?`)) return;
    try {
      setLoadingActionId(queueId);
      await socialApi.deleteQueueSong(queueId, { guestId });
    } catch (err) {
      alert(`Could not remove song: ${err.message}`);
    } finally {
      setLoadingActionId(null);
    }
  };

  if (!queue || queue.length === 0) {
    return (
      <div className="guest-queue-empty glass">
        <Music size={36} className="empty-icon" />
        <h3>The Queue is Empty!</h3>
        <p>Head to the Request tab to request the first party track.</p>
      </div>
    );
  }

  return (
    <div className="guest-queue-view">
      <div className="queue-list-header">
        <h3>Upcoming Songs ({queue.length})</h3>
        <span className="queue-header-hint">Tap "Join" to sing a duet!</span>
      </div>

      <div className="guest-queue-cards">
        {queue.map((song, idx) => {
          const qId = song.queueId || song.id;
          const singers = Array.isArray(song.singers) ? song.singers : [];
          const isUserSinging = Boolean(nickname && singers.some(s => s.toLowerCase() === nickname.toLowerCase()));
          const isOwner = Boolean(guestId && song.requestedBy?.guestId === guestId);
          const isLoading = loadingActionId === qId;
          const upvotes = Array.isArray(song.upvotes) ? song.upvotes : [];
          const hasUpvoted = Boolean(guestId && upvotes.includes(guestId));

          return (
            <div key={qId} className={`guest-queue-card glass ${idx === 0 ? 'now-playing-card' : ''}`}>
              <div className="queue-card-left">
                <span className="queue-order-num">{idx === 0 ? '▶' : `#${idx + 1}`}</span>
                <img
                  src={song.albumArt || '/CtrlAltLyrics-logo.svg'}
                  alt="Cover"
                  className="queue-card-art"
                  onError={(e) => { e.target.onerror = null; e.target.src = '/CtrlAltLyrics-logo.svg'; }}
                />
                <div className="queue-card-info">
                  <strong className="queue-song-title" dir="auto">{song.title}</strong>
                  <span className="queue-song-artist" dir="auto">{song.artist}</span>

                  <div className="queue-singers-row" dir="auto">
                    {singers.length > 0 ? (
                      <span className="singers-badge" dir="auto">
                        <Mic size={11} /> {singers.join(' & ')}
                      </span>
                    ) : song.requestedBy?.nickname ? (
                      <span className="singers-badge neutral" dir="auto">
                        👤 {song.requestedBy.nickname}
                      </span>
                    ) : (
                      <span className="singers-badge unassigned">🎤 Open Mic</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="queue-card-actions">
                {/* Crowd Upvote Button */}
                <button
                  className={`btn glass-btn btn-sm btn-upvote ${hasUpvoted ? 'upvoted' : ''}`}
                  onClick={() => handleToggleUpvote(qId)}
                  title={hasUpvoted ? 'Remove Upvote' : 'Hype this track!'}
                >
                  <ThumbsUp size={13} />
                  {upvotes.length > 0 && <span className="upvote-count">{upvotes.length}</span>}
                </button>

                {/* Join / Leave Singer Duet Button */}
                <button
                  className={`btn btn-sm ${isUserSinging ? 'btn-danger' : 'btn-primary'}`}
                  disabled={isLoading}
                  onClick={() => handleToggleSinger(qId, isUserSinging, idx === 0)}
                  title={isUserSinging ? (idx === 0 ? 'Step down from stage' : 'Leave Singer List') : (idx === 0 ? 'Join the live stage' : 'Join as Singer')}
                >
                  {isUserSinging ? (
                    <>
                      <UserMinus size={13} />
                      <span>{idx === 0 ? 'Leave Stage' : 'Leave'}</span>
                    </>
                  ) : (
                    <>
                      <UserPlus size={13} />
                      <span>{idx === 0 ? 'Join Stage' : 'Join Duet'}</span>
                    </>
                  )}
                </button>

                {/* Delete button: visible ONLY if guest requested this song */}
                {isOwner && (
                  <button
                    className="btn glass-btn btn-icon-only btn-delete-own"
                    disabled={isLoading}
                    onClick={() => handleDeleteOwnSong(qId, song.title)}
                    title="Delete your requested song"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
