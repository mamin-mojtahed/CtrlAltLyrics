import { create } from 'zustand';
import socket from '../services/socket';
import * as socialApi from '../services/socialApi';

// Helpers to read/write persistent guest identity
function getOrGenerateGuestId() {
  try {
    let id = localStorage.getItem('ctrl_alt_lyrics_guest_id');
    if (!id) {
      id = 'g_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
      localStorage.setItem('ctrl_alt_lyrics_guest_id', id);
    }
    return id;
  } catch {
    return 'g_' + Date.now().toString(36);
  }
}

function getStoredNickname() {
  try {
    return localStorage.getItem('ctrl_alt_lyrics_guest_nickname') || '';
  } catch {
    return '';
  }
}

function getStoredAvatarColor() {
  try {
    let color = localStorage.getItem('ctrl_alt_lyrics_guest_color');
    if (!color) {
      const hue = Math.floor(Math.random() * 360);
      color = `hsl(${hue}, 70%, 55%)`;
      localStorage.setItem('ctrl_alt_lyrics_guest_color', color);
    }
    return color;
  } catch {
    return '#6366f1';
  }
}

function getStoredHostToken() {
  try {
    return localStorage.getItem('ctrl_alt_lyrics_host_token') || sessionStorage.getItem('ctrl_alt_lyrics_host_token') || '';
  } catch {
    return '';
  }
}

export const useSocialStore = create((set, get) => ({
  // Guest Profile
  guestId: getOrGenerateGuestId(),
  nickname: getStoredNickname(),
  avatarColor: getStoredAvatarColor(),
  isGuestProfileModalOpen: false,

  // Host state
  hostToken: getStoredHostToken(),
  isHostAuthorized: false,
  isHostOccupiedByOther: false,
  hostClaimError: null,

  // Room / Party State
  requests: [],
  stageJoinRequests: [],
  guests: [],
  guestCount: 0,
  guestOnlyCount: 0,
  hostCount: 0,
  isGuestClient: false,
  partySettings: {
    allowGuestRequests: true,
    autoApproveLibrary: false,
    allowStageJoin: true,
    autoApproveStageJoin: false,
    partyName: 'Ctrl+Alt+Lyrics Karaoke Party'
  },
  networkInfo: {
    ip: 'localhost',
    port: 5173,
    guestUrl: '/guest.html',
    displayUrl: '/display.html'
  },

  // Dynamic party animations
  floatingReactions: [],
  activeAnnouncement: null,

  // Setters
  setGuestNickname: (nick) => {
    const clean = String(nick || '').trim();
    try {
      localStorage.setItem('ctrl_alt_lyrics_guest_nickname', clean);
    } catch {}
    set({ nickname: clean });
    const isGuestPortal = get().isGuestClient || (typeof window !== 'undefined' && window.location.pathname.includes('guest'));
    if (clean && isGuestPortal) {
      const { guestId, avatarColor } = get();
      socialApi.registerGuestProfile({
        guestId,
        nickname: clean,
        avatarColor,
        socketId: socket?.id,
        clientType: 'guest'
      }).catch(err => console.warn('Failed to sync guest profile:', err));
    }
  },

  setGuestAvatarColor: (color) => {
    try {
      localStorage.setItem('ctrl_alt_lyrics_guest_color', color);
    } catch {}
    set({ avatarColor: color });
    const { guestId, nickname } = get();
    const isGuestPortal = get().isGuestClient || (typeof window !== 'undefined' && window.location.pathname.includes('guest'));
    if (nickname && isGuestPortal) {
      socialApi.registerGuestProfile({ guestId, nickname, avatarColor: color, socketId: socket?.id, clientType: 'guest' })
        .catch(err => console.warn('Failed to sync avatar color:', err));
    }
  },

  setGuestProfileModalOpen: (open) => set({ isGuestProfileModalOpen: Boolean(open) }),

  // Initialize socket listeners & fetch initial state
  initSocialSync: async (isGuest = false) => {
    const isGuestPortal = Boolean(isGuest) || (typeof window !== 'undefined' && window.location.pathname.includes('guest'));
    set({ isGuestClient: isGuestPortal });

    try {
      const state = await socialApi.fetchSocialState();
      set({
        requests: state.requests || [],
        stageJoinRequests: state.stageJoinRequests || [],
        guests: state.guests || [],
        guestCount: state.guestCount || 0,
        guestOnlyCount: state.guestOnlyCount || 0,
        hostCount: state.hostCount || 0,
        partySettings: state.partySettings || get().partySettings,
        networkInfo: state.networkInfo || get().networkInfo,
        isHostOccupiedByOther: Boolean(state.host?.isActive && state.host?.hostToken !== get().hostToken)
      });
    } catch (err) {
      console.warn('Initial social state fetch failed:', err);
    }

    // Only register guest profile if this is explicitly a guest portal client!
    // Display, Dashboard, and other tabs MUST NEVER register as guests.
    if (isGuestPortal) {
      const { guestId, nickname, avatarColor } = get();
      if (nickname) {
        socialApi.registerGuestProfile({
          guestId,
          nickname,
          avatarColor,
          socketId: socket?.id,
          clientType: 'guest'
        }).catch(() => {});
      }
    }

    // Socket listeners
    socket.off('social_state');
    socket.on('social_state', (data) => {
      if (!data) return;
      const currentToken = get().hostToken;
      const isOccupiedByOther = Boolean(data.host?.isActive && data.host?.hostToken !== currentToken);
      set({
        requests: data.requests || [],
        stageJoinRequests: data.stageJoinRequests || [],
        guests: data.guests || [],
        guestCount: data.guestCount || 0,
        guestOnlyCount: data.guestOnlyCount || 0,
        hostCount: data.hostCount || 0,
        partySettings: data.partySettings || get().partySettings,
        networkInfo: data.networkInfo || get().networkInfo,
        isHostOccupiedByOther: isOccupiedByOther
      });
    });

    socket.off('stage_join_requested');
    socket.on('stage_join_requested', (reqItem) => {
      if (!reqItem) return;
      set((s) => ({
        stageJoinRequests: [reqItem, ...s.stageJoinRequests.filter(r => r.id !== reqItem.id)]
      }));
    });

    socket.off('stage_request_rejected');
    socket.on('stage_request_rejected', ({ requestId }) => {
      if (!requestId) return;
      set((s) => ({
        stageJoinRequests: s.stageJoinRequests.filter(r => r.id !== requestId)
      }));
    });

    socket.off('requests_updated');
    socket.on('requests_updated', (reqs) => {
      if (Array.isArray(reqs)) {
        set({ requests: reqs });
      }
    });

    socket.off('reaction_received');
    socket.on('reaction_received', (reaction) => {
      if (!reaction || !reaction.emoji) return;
      set((state) => ({
        floatingReactions: [...state.floatingReactions, { ...reaction, id: reaction.id || Math.random() }]
      }));
      // Remove reaction after 4.5 seconds
      setTimeout(() => {
        set((state) => ({
          floatingReactions: state.floatingReactions.filter(r => r.id !== reaction.id)
        }));
      }, 4500);
    });

    socket.off('announcement_received');
    socket.on('announcement_received', (announcement) => {
      if (!announcement) return;
      set({ activeAnnouncement: announcement });
      setTimeout(() => {
        set((state) => (state.activeAnnouncement?.id === announcement.id ? { activeAnnouncement: null } : {}));
      }, announcement.durationMs || 6000);
    });

    socket.off('host_taken_over');
    socket.on('host_taken_over', (info) => {
      set({ isHostAuthorized: false, hostToken: '', hostClaimError: info?.message || 'Session taken over by another device.' });
      try {
        localStorage.removeItem('ctrl_alt_lyrics_host_token');
        sessionStorage.removeItem('ctrl_alt_lyrics_host_token');
      } catch {}
    });
  },

  // Host Actions
  claimHostStation: async (pin = '') => {
    try {
      set({ hostClaimError: null });
      const currentToken = get().hostToken;
      const res = await socialApi.claimHost({
        pin,
        hostToken: currentToken,
        clientName: 'Host Console',
        socketId: socket?.id
      });
      if (res && res.authorized) {
        try {
          localStorage.setItem('ctrl_alt_lyrics_host_token', res.hostToken);
        } catch {}
        set({ hostToken: res.hostToken, isHostAuthorized: true, isHostOccupiedByOther: false, hostClaimError: null });
        return true;
      }
      return false;
    } catch (err) {
      set({ hostClaimError: err.message, isHostOccupiedByOther: Boolean(err.conflict) });
      return false;
    }
  },

  releaseHostStation: async () => {
    const { hostToken } = get();
    if (hostToken) {
      await socialApi.releaseHost(hostToken).catch(() => {});
    }
    try {
      localStorage.removeItem('ctrl_alt_lyrics_host_token');
    } catch {}
    set({ hostToken: '', isHostAuthorized: false });
  },

  // Guest Cheer Reaction
  sendEmojiReaction: (emoji) => {
    const { nickname, avatarColor } = get();
    socialApi.sendReaction({ emoji, nickname: nickname || 'Guest', avatarColor })
      .catch(err => console.warn('Failed to send reaction:', err));
  }
}));
