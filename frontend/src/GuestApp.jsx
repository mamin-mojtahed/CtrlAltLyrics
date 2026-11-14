import React, { useEffect, useState } from 'react';
import { Mic, Music, ListMusic, X } from 'lucide-react';
import socket, { emitRequestSync } from './services/socket';
import { useSocialStore } from './stores/useSocialStore';
import { useQueueStore } from './stores/useQueueStore';
import { usePlaybackStore, getAccuratePlaybackTime, updateSyncAnchor } from './stores/usePlaybackStore';

import PerformerMixer from './components/social/PerformerMixer';
import MobileTeleprompter from './components/social/MobileTeleprompter';
import GuestQueueView from './components/social/GuestQueueView';
import GuestRequestView from './components/social/GuestRequestView';
import FloatingReactions from './components/social/FloatingReactions';
import AnnouncementBanner from './components/social/AnnouncementBanner';

export default function GuestApp() {
  const guestId = useSocialStore((state) => state.guestId);
  const nickname = useSocialStore((state) => state.nickname);
  const avatarColor = useSocialStore((state) => state.avatarColor);
  const setGuestNickname = useSocialStore((state) => state.setGuestNickname);
  const initSocialSync = useSocialStore((state) => state.initSocialSync);
  const sendEmojiReaction = useSocialStore((state) => state.sendEmojiReaction);

  const loadQueue = useQueueStore((state) => state.loadQueue);
  const queue = useQueueStore((state) => state.queue);
  const currentSong = usePlaybackStore((state) => state.currentSong);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);

  const [activeTab, setActiveTab] = useState('stage'); // 'stage' | 'queue' | 'request'
  const [nickInput, setNickInput] = useState('');
  const [showNickModal, setShowNickModal] = useState(false);

  // Compute if current guest is on deck for the next song
  const nextSong = queue.length > 1 ? queue[1] : (currentSong ? null : queue[0]);
  const isNextPerformer = Boolean(
    nextSong && nickname &&
    (
      (Array.isArray(nextSong.singers) && nextSong.singers.some(s => s.toLowerCase() === nickname.toLowerCase())) ||
      (nextSong.requestedBy?.guestId && nextSong.requestedBy.guestId === guestId)
    )
  );

  useEffect(() => {
    initSocialSync(true);
    loadQueue();
    emitRequestSync();

    if (!nickname) {
      setShowNickModal(true);
    }

    const handleConnect = () => {
      const { guestId, nickname: curNick, avatarColor: curColor } = useSocialStore.getState();
      if (curNick) {
        import('./services/socialApi').then(({ registerGuestProfile }) => {
          registerGuestProfile({
            guestId,
            nickname: curNick,
            avatarColor: curColor,
            socketId: socket?.id,
            clientType: 'guest'
          }).catch(() => {});
        });
      }
    };
    socket.on('connect', handleConnect);

    const handleQueueUpdated = (q) => {
      if (Array.isArray(q)) {
        useQueueStore.getState().setQueue(q);
      }
    };
    socket.on('queue_updated', handleQueueUpdated);

    const handleSyncState = (state) => {
      if (state) {
        usePlaybackStore.getState().syncFromSocket(state);
      }
    };
    socket.on('sync_state', handleSyncState);

    const handlePlayerCommand = (cmd) => {
      if (!cmd) return;
      if (cmd.command === 'play') {
        const t = typeof cmd.time === 'number' ? cmd.time : usePlaybackStore.getState().currentTime;
        usePlaybackStore.setState({ isPlaying: true, currentTime: t });
        updateSyncAnchor(t, true);
      } else if (cmd.command === 'pause') {
        const t = typeof cmd.time === 'number' ? cmd.time : usePlaybackStore.getState().currentTime;
        usePlaybackStore.setState({ isPlaying: false, currentTime: t });
        updateSyncAnchor(t, false);
      } else if (cmd.command === 'seek' && typeof cmd.time === 'number') {
        usePlaybackStore.setState({ currentTime: cmd.time });
        updateSyncAnchor(cmd.time, usePlaybackStore.getState().isPlaying);
      } else if (cmd.command === 'set_volumes' && cmd.volumes) {
        const v = {
          inst: cmd.volumes.inst ?? cmd.volumes.instrumentals,
          back: cmd.volumes.back,
          lead: cmd.volumes.lead ?? cmd.volumes.vocals
        };
        usePlaybackStore.setState({ volumes: v });
      }
    };
    socket.on('player_command', handlePlayerCommand);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('queue_updated', handleQueueUpdated);
      socket.off('sync_state', handleSyncState);
      socket.off('player_command', handlePlayerCommand);
    };
  }, []);

  // Smooth playback time ticker for mobile view
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      const cur = getAccuratePlaybackTime();
      usePlaybackStore.setState({ currentTime: cur });
    }, 100);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const handleSaveNickname = (e) => {
    if (e) e.preventDefault();
    if (nickInput.trim()) {
      setGuestNickname(nickInput.trim());
      setShowNickModal(false);
    }
  };

  return (
    <div className="guest-portal-layout">
      {/* Floating Overlays */}
      <FloatingReactions />
      <AnnouncementBanner />

      {/* Top Header */}
      <header className="guest-header glass">
        <div className="guest-brand">
          <Mic size={20} className="guest-brand-icon" />
          <span className="guest-brand-name">Ctrl+Alt+Lyrics</span>
        </div>
        <div
          className="guest-profile-chip"
          onClick={() => { setNickInput(nickname); setShowNickModal(true); }}
          title="Tap to change Nickname"
        >
          <span className="avatar-dot" style={{ backgroundColor: avatarColor || '#6366f1' }} />
          <span className="nickname-label">{nickname || 'Set Nickname'}</span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="guest-main">
        {activeTab === 'stage' && (
          <div className="guest-tab-content stage-tab">
            {/* "You're Up Next!" Alert Toast */}
            {isNextPerformer && (
              <div className="up-next-alert-banner glass">
                <div className="up-next-icon-wrap">🎤</div>
                <div className="up-next-text" dir="auto">
                  <strong>You're Up Next!</strong>
                  <span dir="auto">"{nextSong.title}" is next in the queue. Head to the stage!</span>
                </div>
              </div>
            )}

            {/* Live Teleprompter (Prompts word-by-word lyrics directly on smartphone, non-seekable) */}
            <MobileTeleprompter allowSeek={false} />

            {/* Dynamic Performer Stem Mixer (Touch sliders, unlocked only when on stage) */}
            <PerformerMixer />

            {/* Quick Party Reactions Bar */}
            <div className="guest-reactions-bar glass">
              <button className="reaction-btn" onClick={() => sendEmojiReaction('🔥')} title="Fire">🔥</button>
              <button className="reaction-btn" onClick={() => sendEmojiReaction('👏')} title="Applause">👏</button>
              <button className="reaction-btn" onClick={() => sendEmojiReaction('🎤')} title="Mic Drop">🎤</button>
              <button className="reaction-btn" onClick={() => sendEmojiReaction('❤️')} title="Love">❤️</button>
              <button className="reaction-btn" onClick={() => sendEmojiReaction('🥳')} title="Party">🥳</button>
              <button className="reaction-btn" onClick={() => sendEmojiReaction('🙌')} title="Highfive">🙌</button>
            </div>
          </div>
        )}

        {activeTab === 'queue' && (
          <div className="guest-tab-content queue-tab">
            <GuestQueueView />
          </div>
        )}

        {activeTab === 'request' && (
          <div className="guest-tab-content request-tab">
            <GuestRequestView />
          </div>
        )}
      </main>

      {/* Bottom Mobile Tab Bar */}
      <nav className="guest-nav glass">
        <button
          className={`nav-item ${activeTab === 'stage' ? 'active' : ''}`}
          onClick={() => setActiveTab('stage')}
        >
          <Mic size={20} />
          <span>Stage</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          <ListMusic size={20} />
          <span>Queue</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'request' ? 'active' : ''}`}
          onClick={() => setActiveTab('request')}
        >
          <Music size={20} />
          <span>Request</span>
        </button>
      </nav>

      {/* Nickname Setup Modal */}
      {showNickModal && (
        <div
          className="modal-backdrop"
          style={{ display: 'flex', zIndex: 3000 }}
          onClick={() => { if (nickname) setShowNickModal(false); }}
        >
          <div className="modal-box guest-nick-modal glass" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <Mic size={18} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
                Welcome to Karaoke!
              </h3>
              {nickname && (
                <button
                  className="btn-close"
                  onClick={() => setShowNickModal(false)}
                  title="Close"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="modal-body" style={{ textAlign: 'center', padding: '1rem 0' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
                Pick a nickname so the host and crowd know who is singing.
              </p>
              <form onSubmit={handleSaveNickname}>
                <input
                  type="text"
                  placeholder="Enter your nickname (e.g. Rockstar)"
                  value={nickInput}
                  onChange={(e) => setNickInput(e.target.value)}
                  className="input-glass"
                  maxLength={20}
                  dir="auto"
                  autoFocus
                />
                <button type="submit" className="btn btn-primary btn-block" disabled={!nickInput.trim()}>
                  Join Party
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
