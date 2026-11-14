const express = require('express');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function generateUuid() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `u_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Network Discovery: Find non-internal IPv4 address for local mobile access
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function createSocialRouter(options = {}) {
  const router = express.Router();
  const {
    getQueue = () => [],
    setQueue = () => {},
    enqueueSongCore = null,
    DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads'),
    readHistory = () => []
  } = options;

  // Single-host session state
  let hostSession = {
    activeSocketId: null,
    hostToken: null,
    claimedAt: null,
    lastHeartbeat: Date.now(),
    pin: '1234',
    clientName: null
  };

  // Party settings
  let partySettings = {
    allowGuestRequests: true,
    autoApproveLibrary: false,
    allowStageJoin: true,
    autoApproveStageJoin: false,
    maxRequestsPerGuest: 5,
    partyName: 'Ctrl+Alt+Lyrics Karaoke Party',
    requireApproval: true
  };

  // Active guests registry: Map of guestId -> guestObject
  const activeGuests = new Map();

  // Song requests queue
  let songRequests = [];

  // Live stage join requests
  let stageJoinRequests = [];

  // Helper: broadcast full social state to all connected clients
  function broadcastSocialState(io) {
    if (!io) return;
    io.emit('social_state', getFullSocialState(io));
  }

  function getFullSocialState(ioInstance) {
    const ip = getLocalIpAddress();
    const port = process.env.PORT || 3000;
    const now = Date.now();
    const isHostActive = Boolean(
      hostSession.hostToken && (
        (hostSession.activeSocketId && ioInstance?.sockets?.sockets?.has?.(hostSession.activeSocketId)) ||
        (now - hostSession.lastHeartbeat < 45000)
      )
    );
    const hostCount = isHostActive ? 1 : 0;
    const guestOnlyCount = activeGuests.size;
    const totalPartyCount = guestOnlyCount + hostCount;

    return {
      host: {
        isActive: isHostActive,
        claimedAt: hostSession.claimedAt,
        clientName: hostSession.clientName
      },
      partySettings,
      guestCount: totalPartyCount,
      guestOnlyCount,
      hostCount,
      guests: Array.from(activeGuests.values()),
      requests: songRequests,
      stageJoinRequests: stageJoinRequests.filter(r => r.status === 'pending'),
      networkInfo: {
        ip,
        port,
        guestUrl: `http://${ip}:5173/guest.html`,
        displayUrl: `http://${ip}:5173/display.html`
      }
    };
  }

  // Verify host token helper
  function isAuthorizedHost(token) {
    return Boolean(token && hostSession.hostToken && token === hostSession.hostToken);
  }

  // --- REST Routes ---

  // GET /api/social/state: Current social & party state
  router.get('/state', (req, res) => {
    const io = req.app.get('io');
    res.json(getFullSocialState(io));
  });

  // POST /api/social/host/claim: Claim host seat or take over using PIN
  router.post('/host/claim', (req, res) => {
    const { pin, hostToken, clientName, socketId } = req.body || {};
    const io = req.app.get('io');
    const now = Date.now();

    // Case 1: Client already has valid host token (session resume/reconnect)
    if (hostToken && isAuthorizedHost(hostToken)) {
      hostSession.activeSocketId = socketId || hostSession.activeSocketId;
      hostSession.lastHeartbeat = now;
      if (clientName) hostSession.clientName = clientName;
      broadcastSocialState(io);
      return res.json({ success: true, authorized: true, hostToken, isTakeover: false });
    }

    // Case 2: Host slot is vacant or old host disconnected beyond grace period (45s)
    const isOccupied = Boolean(hostSession.hostToken && (now - hostSession.lastHeartbeat < 45000));

    if (!isOccupied) {
      const newToken = generateUuid();
      hostSession.hostToken = newToken;
      hostSession.activeSocketId = socketId || null;
      hostSession.claimedAt = now;
      hostSession.lastHeartbeat = now;
      hostSession.clientName = clientName || 'Host';
      broadcastSocialState(io);
      return res.json({ success: true, authorized: true, hostToken: newToken, isTakeover: false });
    }

    // Case 3: Host slot is occupied by another client -> check PIN for takeover
    if (pin && String(pin).trim() === String(hostSession.pin).trim()) {
      const prevSocket = hostSession.activeSocketId;
      const newToken = generateUuid();
      hostSession.hostToken = newToken;
      hostSession.activeSocketId = socketId || null;
      hostSession.claimedAt = now;
      hostSession.lastHeartbeat = now;
      hostSession.clientName = clientName || 'Host (New Device)';

      if (io && prevSocket) {
        io.to(prevSocket).emit('host_taken_over', {
          message: 'Another device took over the Host session using the Host PIN.'
        });
      }
      broadcastSocialState(io);
      return res.json({ success: true, authorized: true, hostToken: newToken, isTakeover: true });
    }

    // Occupied and wrong/no PIN
    return res.status(403).json({
      success: false,
      conflict: true,
      error: 'Host Console is currently in use on another device. Enter the Host PIN to take over.'
    });
  });

  // POST /api/social/host/release: Voluntarily vacate host role
  router.post('/host/release', (req, res) => {
    const { hostToken } = req.body || {};
    const io = req.app.get('io');

    if (!isAuthorizedHost(hostToken)) {
      return res.status(403).json({ error: 'Unauthorized host token' });
    }

    hostSession.activeSocketId = null;
    hostSession.hostToken = null;
    hostSession.clientName = null;
    hostSession.lastHeartbeat = 0;
    broadcastSocialState(io);
    res.json({ success: true, message: 'Host session released' });
  });

  // POST /api/social/host/settings: Update party settings or PIN
  router.post('/host/settings', (req, res) => {
    const { hostToken, settings = {} } = req.body || {};
    const io = req.app.get('io');

    if (!isAuthorizedHost(hostToken)) {
      return res.status(403).json({ error: 'Unauthorized host' });
    }

    if (settings.allowGuestRequests !== undefined) partySettings.allowGuestRequests = Boolean(settings.allowGuestRequests);
    if (settings.autoApproveLibrary !== undefined) partySettings.autoApproveLibrary = Boolean(settings.autoApproveLibrary);
    if (settings.allowStageJoin !== undefined) partySettings.allowStageJoin = Boolean(settings.allowStageJoin);
    if (settings.autoApproveStageJoin !== undefined) partySettings.autoApproveStageJoin = Boolean(settings.autoApproveStageJoin);
    if (settings.partyName) partySettings.partyName = String(settings.partyName).trim();
    if (settings.pin) hostSession.pin = String(settings.pin).trim();

    broadcastSocialState(io);
    res.json({ success: true, partySettings, pinUpdated: Boolean(settings.pin) });
  });

  // POST /api/social/guest/register: Register or update guest profile
  router.post('/guest/register', (req, res) => {
    const { guestId, nickname, avatarColor, socketId, clientType } = req.body || {};
    const io = req.app.get('io');

    // Reject non-guest client registrations (e.g. display, dashboard, host)
    if (clientType && clientType !== 'guest') {
      return res.status(400).json({ error: 'Only guest clients can register as guests' });
    }

    if (!guestId || !nickname) {
      return res.status(400).json({ error: 'guestId and nickname are required' });
    }

    const cleanNick = String(nickname).trim().substring(0, 24);
    const existing = activeGuests.get(guestId) || {};
    const guestData = {
      guestId,
      nickname: cleanNick,
      avatarColor: avatarColor || existing.avatarColor || `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`,
      socketId: socketId || existing.socketId || null,
      joinedAt: existing.joinedAt || Date.now(),
      lastSeen: Date.now()
    };

    activeGuests.set(guestId, guestData);
    broadcastSocialState(io);
    res.json({ success: true, guest: guestData });
  });

  // POST /api/social/request_song: Guest submits a song request
  router.post('/request_song', async (req, res) => {
    const { song, requestedBy, notes } = req.body || {};
    const io = req.app.get('io');

    if (!partySettings.allowGuestRequests) {
      return res.status(403).json({ error: 'Guest song requests are currently paused by the host.' });
    }

    if (!song || (!song.id && !song.songId && !song.title)) {
      return res.status(400).json({ error: 'Invalid song metadata' });
    }

    const songId = song.id || song.songId || generateUuid();
    const normalizedSong = { ...song, id: songId };

    const reqData = {
      requestId: generateUuid(),
      song: normalizedSong,
      requestedBy: {
        guestId: requestedBy?.guestId || 'anon',
        nickname: requestedBy?.nickname || 'Guest',
        avatarColor: requestedBy?.avatarColor || '#6366f1'
      },
      singers: [requestedBy?.nickname || 'Guest'],
      notes: notes ? String(notes).trim().substring(0, 140) : null,
      upvotes: [],
      status: 'pending_approval',
      createdAt: Date.now()
    };

    // Auto-approval check: If autoApproveLibrary is true and song is already processed in history
    if (partySettings.autoApproveLibrary && enqueueSongCore) {
      const history = readHistory();
      const existing = history.find(s => String(s.id) === String(songId));
      if (existing && existing.status === 'ready') {
        reqData.status = 'approved';
        await enqueueSongCore({
          song: normalizedSong,
          requestedBy: reqData.requestedBy,
          singers: reqData.singers,
          notes: reqData.notes,
          io
        });
        songRequests.unshift(reqData);
        if (io) {
          io.emit('requests_updated', songRequests);
          io.emit('request_approved', reqData);
        }
        broadcastSocialState(io);
        return res.json({ success: true, request: reqData, autoApproved: true });
      }
    }

    songRequests.unshift(reqData);
    if (io) {
      io.emit('requests_updated', songRequests);
      io.emit('new_request_received', reqData);
    }
    broadcastSocialState(io);
    res.json({ success: true, request: reqData, autoApproved: false });
  });

  // POST /api/social/requests/:id/approve: Host approves song request
  router.post('/requests/:id/approve', async (req, res) => {
    const { hostToken, position = 'end' } = req.body || {};
    const requestId = req.params.id;
    const io = req.app.get('io');

    if (!isAuthorizedHost(hostToken)) {
      return res.status(403).json({ error: 'Unauthorized host' });
    }

    const reqItem = songRequests.find(r => r.requestId === requestId);
    if (!reqItem) {
      return res.status(404).json({ error: 'Request not found' });
    }

    reqItem.status = 'approved';

    let enqueuedSong = null;
    if (enqueueSongCore) {
      const currentQueue = getQueue();
      // If position === 'next', insert right after currently playing song (index 1)
      const insertIndex = position === 'next' ? Math.min(1, currentQueue.length) : currentQueue.length;
      enqueuedSong = await enqueueSongCore({
        song: reqItem.song,
        insertIndex,
        requestedBy: reqItem.requestedBy,
        singers: reqItem.singers,
        notes: reqItem.notes,
        io
      });
    }

    if (io) {
      io.emit('requests_updated', songRequests);
      io.emit('request_approved', { requestId, song: enqueuedSong || reqItem.song });
    }
    broadcastSocialState(io);
    res.json({ success: true, request: reqItem, enqueuedSong });
  });

  // POST /api/social/requests/:id/reject: Host declines request
  router.post('/requests/:id/reject', (req, res) => {
    const { hostToken, reason } = req.body || {};
    const requestId = req.params.id;
    const io = req.app.get('io');

    if (!isAuthorizedHost(hostToken)) {
      return res.status(403).json({ error: 'Unauthorized host' });
    }

    const reqItem = songRequests.find(r => r.requestId === requestId);
    if (!reqItem) {
      return res.status(404).json({ error: 'Request not found' });
    }

    reqItem.status = 'rejected';
    reqItem.rejectReason = reason ? String(reason).trim() : 'Declined by host';

    if (io) {
      io.emit('requests_updated', songRequests);
      io.emit('request_rejected', { requestId, reason: reqItem.rejectReason });
    }
    broadcastSocialState(io);
    res.json({ success: true, request: reqItem });
  });

  // DELETE /api/social/requests/:id: Cancel or delete a request
  router.delete('/requests/:id', (req, res) => {
    const { guestId, hostToken } = req.body || {};
    const requestId = req.params.id;
    const io = req.app.get('io');

    const idx = songRequests.findIndex(r => r.requestId === requestId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Request not found' });
    }

    const reqItem = songRequests[idx];
    const isOwner = guestId && reqItem.requestedBy?.guestId === guestId;
    const isHost = isAuthorizedHost(hostToken);

    if (!isOwner && !isHost) {
      return res.status(403).json({ error: 'Not authorized to delete this request' });
    }

    songRequests.splice(idx, 1);
    if (io) {
      io.emit('requests_updated', songRequests);
    }
    broadcastSocialState(io);
    res.json({ success: true, requestId });
  });

  // POST /api/social/upvote: Toggle crowd upvote on queue song or request
  router.post('/upvote', (req, res) => {
    const { targetType = 'queue', targetId, guestId } = req.body || {};
    const io = req.app.get('io');

    if (!targetId || !guestId) {
      return res.status(400).json({ error: 'targetId and guestId are required' });
    }

    if (targetType === 'request') {
      const reqItem = songRequests.find(r => r.requestId === targetId);
      if (!reqItem) return res.status(404).json({ error: 'Request not found' });
      if (!Array.isArray(reqItem.upvotes)) reqItem.upvotes = [];
      const hasUpvoted = reqItem.upvotes.includes(guestId);
      if (hasUpvoted) {
        reqItem.upvotes = reqItem.upvotes.filter(id => id !== guestId);
      } else {
        reqItem.upvotes.push(guestId);
      }
      if (io) io.emit('requests_updated', songRequests);
      broadcastSocialState(io);
      return res.json({ success: true, targetId, upvotes: reqItem.upvotes, count: reqItem.upvotes.length });
    } else {
      // Queue upvote
      const queue = getQueue();
      const song = queue.find(s => String(s.queueId || s.id) === String(targetId));
      if (!song) return res.status(404).json({ error: 'Queue item not found' });
      if (!Array.isArray(song.upvotes)) song.upvotes = [];
      const hasUpvoted = song.upvotes.includes(guestId);
      if (hasUpvoted) {
        song.upvotes = song.upvotes.filter(id => id !== guestId);
      } else {
        song.upvotes.push(guestId);
      }
      if (io) io.emit('queue_updated', queue);
      return res.json({ success: true, targetId, upvotes: song.upvotes, count: song.upvotes.length });
    }
  });

  // POST /api/social/queue/:queueId/singers: Join or leave as duet/group singer
  router.post('/queue/:queueId/singers', (req, res) => {
    const { queueId } = req.params;
    const { nickname, action } = req.body || {};
    const io = req.app.get('io');

    if (!nickname) {
      return res.status(400).json({ error: 'Nickname is required' });
    }

    const cleanNick = String(nickname).trim();
    const queue = getQueue();
    const song = queue.find(s => String(s.queueId || s.id) === String(queueId));

    if (!song) {
      return res.status(404).json({ error: 'Queue song not found' });
    }

    if (!Array.isArray(song.singers)) {
      song.singers = song.requestedBy?.nickname ? [song.requestedBy.nickname] : [];
    }

    if (action === 'leave') {
      song.singers = song.singers.filter(n => n.toLowerCase() !== cleanNick.toLowerCase());
    } else {
      // action === 'join'
      const exists = song.singers.some(n => n.toLowerCase() === cleanNick.toLowerCase());
      if (!exists) {
        song.singers.push(cleanNick);
      }
    }

    if (io) {
      io.emit('queue_updated', queue);
      io.emit('singers_updated', { queueId, singers: song.singers });
    }
    res.json({ success: true, queueId, singers: song.singers });
  });

  // Helper: add a singer to currently playing stage
  function addSingerToCurrentStage(cleanNick, io, app) {
    const getCurrentState = app ? app.get('getCurrentState') : null;
    const currentState = getCurrentState ? getCurrentState() : null;
    const queue = getQueue();

    let updatedSingers = [];

    if (currentState && currentState.songData) {
      if (!Array.isArray(currentState.songData.singers)) {
        currentState.songData.singers = currentState.songData.requestedBy?.nickname ? [currentState.songData.requestedBy.nickname] : [];
      }
      if (!currentState.songData.singers.some(s => s.toLowerCase() === cleanNick.toLowerCase())) {
        currentState.songData.singers.push(cleanNick);
      }
      updatedSingers = currentState.songData.singers;
    }

    if (queue.length > 0 && queue[0]) {
      if (!Array.isArray(queue[0].singers)) {
        queue[0].singers = queue[0].requestedBy?.nickname ? [queue[0].requestedBy.nickname] : [];
      }
      if (!queue[0].singers.some(s => s.toLowerCase() === cleanNick.toLowerCase())) {
        queue[0].singers.push(cleanNick);
      }
      if (updatedSingers.length === 0) {
        updatedSingers = queue[0].singers;
      }
    }

    // Mark pending stage requests for this nickname as approved
    stageJoinRequests.forEach(r => {
      if (r.nickname.toLowerCase() === cleanNick.toLowerCase() && r.status === 'pending') {
        r.status = 'approved';
      }
    });

    if (io) {
      io.emit('queue_updated', queue);
      io.emit('singers_updated', {
        songId: currentState?.songData?.id || queue[0]?.id,
        queueId: currentState?.songData?.queueId || queue[0]?.queueId,
        singers: updatedSingers
      });
      if (currentState?.songData) {
        io.emit('sync_state', { songData: currentState.songData });
      }
      io.emit('stage_joined', {
        nickname: cleanNick,
        songTitle: currentState?.songData?.title || queue[0]?.title || 'Current Song'
      });
      broadcastSocialState(io);
    }

    return updatedSingers;
  }

  // Helper: remove a singer from currently playing stage
  function removeSingerFromCurrentStage(cleanNick, io, app) {
    const getCurrentState = app ? app.get('getCurrentState') : null;
    const currentState = getCurrentState ? getCurrentState() : null;
    const queue = getQueue();

    let updatedSingers = [];

    if (currentState && currentState.songData && Array.isArray(currentState.songData.singers)) {
      currentState.songData.singers = currentState.songData.singers.filter(s => s.toLowerCase() !== cleanNick.toLowerCase());
      updatedSingers = currentState.songData.singers;
    }

    if (queue.length > 0 && queue[0] && Array.isArray(queue[0].singers)) {
      queue[0].singers = queue[0].singers.filter(s => s.toLowerCase() !== cleanNick.toLowerCase());
      if (updatedSingers.length === 0) {
        updatedSingers = queue[0].singers;
      }
    }

    if (io) {
      io.emit('queue_updated', queue);
      io.emit('singers_updated', {
        songId: currentState?.songData?.id || queue[0]?.id,
        queueId: currentState?.songData?.queueId || queue[0]?.queueId,
        singers: updatedSingers
      });
      if (currentState?.songData) {
        io.emit('sync_state', { songData: currentState.songData });
      }
      broadcastSocialState(io);
    }

    return updatedSingers;
  }

  // POST /api/social/stage/join_request: Guest requests to join the stage of current song
  router.post('/stage/join_request', (req, res) => {
    const { guestId, nickname, avatarColor } = req.body || {};
    const io = req.app.get('io');
    const getCurrentState = req.app.get('getCurrentState');

    if (!partySettings.allowStageJoin) {
      return res.status(403).json({ error: 'Stage joining is currently disabled by the host.' });
    }

    if (!nickname) {
      return res.status(400).json({ error: 'Nickname is required' });
    }

    const currentState = getCurrentState ? getCurrentState() : null;
    const currentSong = currentState?.songData;
    const queue = getQueue();
    const activeTrack = currentSong || queue[0];

    if (!activeTrack) {
      return res.status(400).json({ error: 'No song is currently playing on stage.' });
    }

    const cleanNick = String(nickname).trim();
    const songId = activeTrack.id || activeTrack.songId;
    const songTitle = activeTrack.title || 'Current Song';

    // Check if guest is already on stage
    const currentSingers = Array.isArray(activeTrack.singers)
      ? activeTrack.singers
      : (activeTrack.requestedBy?.nickname ? [activeTrack.requestedBy.nickname] : []);

    if (currentSingers.some(s => s.toLowerCase() === cleanNick.toLowerCase())) {
      return res.status(400).json({ error: 'You are already on stage for this song!' });
    }

    // Auto-approve if enabled
    if (partySettings.autoApproveStageJoin) {
      const singers = addSingerToCurrentStage(cleanNick, io, req.app);
      return res.json({ success: true, autoApproved: true, singers, message: `Welcome to the stage, ${cleanNick}!` });
    }

    // Otherwise, create a pending stage request
    // Remove previous pending request for this guest if any
    stageJoinRequests = stageJoinRequests.filter(r => r.guestId !== guestId || r.status !== 'pending');

    const requestItem = {
      id: generateUuid(),
      guestId: guestId || 'anon',
      nickname: cleanNick,
      avatarColor: avatarColor || '#6366f1',
      songId,
      songTitle,
      status: 'pending',
      requestedAt: Date.now()
    };

    stageJoinRequests.unshift(requestItem);

    if (io) {
      io.emit('stage_join_requested', requestItem);
      broadcastSocialState(io);
    }

    res.json({ success: true, request: requestItem, autoApproved: false });
  });

  // POST /api/social/stage/join_requests/:id/approve: Host approves stage join request
  router.post('/stage/join_requests/:id/approve', (req, res) => {
    const { hostToken } = req.body || {};
    const requestId = req.params.id;
    const io = req.app.get('io');

    if (!isAuthorizedHost(hostToken)) {
      return res.status(403).json({ error: 'Unauthorized host' });
    }

    const reqItem = stageJoinRequests.find(r => r.id === requestId);
    if (!reqItem) {
      return res.status(404).json({ error: 'Stage join request not found' });
    }

    reqItem.status = 'approved';
    const singers = addSingerToCurrentStage(reqItem.nickname, io, req.app);

    res.json({ success: true, request: reqItem, singers });
  });

  // POST /api/social/stage/join_requests/:id/reject: Host rejects stage join request
  router.post('/stage/join_requests/:id/reject', (req, res) => {
    const { hostToken } = req.body || {};
    const requestId = req.params.id;
    const io = req.app.get('io');

    if (!isAuthorizedHost(hostToken)) {
      return res.status(403).json({ error: 'Unauthorized host' });
    }

    const reqItem = stageJoinRequests.find(r => r.id === requestId);
    if (!reqItem) {
      return res.status(404).json({ error: 'Stage join request not found' });
    }

    reqItem.status = 'rejected';
    if (io) {
      io.emit('stage_request_rejected', { requestId, nickname: reqItem.nickname });
      broadcastSocialState(io);
    }

    res.json({ success: true, request: reqItem });
  });

  // DELETE /api/social/stage/join_requests/:id: Cancel stage join request
  router.delete('/stage/join_requests/:id', (req, res) => {
    const { guestId, hostToken } = req.body || {};
    const requestId = req.params.id;
    const io = req.app.get('io');

    const idx = stageJoinRequests.findIndex(r => r.id === requestId);
    if (idx === -1) {
      return res.status(404).json({ error: 'Stage join request not found' });
    }

    const reqItem = stageJoinRequests[idx];
    if (reqItem.guestId !== guestId && !isAuthorizedHost(hostToken)) {
      return res.status(403).json({ error: 'Not authorized to cancel this request' });
    }

    stageJoinRequests.splice(idx, 1);
    if (io) {
      broadcastSocialState(io);
    }
    res.json({ success: true, requestId });
  });

  // POST /api/social/stage/leave: Guest steps down from current stage
  router.post('/stage/leave', (req, res) => {
    const { nickname } = req.body || {};
    const io = req.app.get('io');
    if (!nickname) {
      return res.status(400).json({ error: 'Nickname is required' });
    }
    const singers = removeSingerFromCurrentStage(String(nickname).trim(), io, req.app);
    res.json({ success: true, singers });
  });

  // DELETE /api/social/queue/:queueId: Guest deletes their own song or Host deletes any
  router.delete('/queue/:queueId', (req, res) => {
    const { queueId } = req.params;
    const { guestId, hostToken } = req.body || {};
    const io = req.app.get('io');

    const queue = getQueue();
    const qIdx = queue.findIndex(s => String(s.queueId || s.id) === String(queueId));

    if (qIdx === -1) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    const song = queue[qIdx];
    const isOwner = guestId && song.requestedBy?.guestId === guestId;
    const isHost = isAuthorizedHost(hostToken);

    if (!isOwner && !isHost) {
      return res.status(403).json({ error: 'You can only remove songs that you requested.' });
    }

    queue.splice(qIdx, 1);
    setQueue(queue);

    if (io) {
      io.emit('queue_updated', queue);
    }
    res.json({ success: true, queueId, queue });
  });

  // POST /api/social/reaction: Send celebratory emoji reaction
  router.post('/reaction', (req, res) => {
    const { emoji, nickname, avatarColor } = req.body || {};
    const io = req.app.get('io');
    if (!emoji) return res.status(400).json({ error: 'Emoji is required' });

    const reactionPayload = {
      id: generateUuid(),
      emoji: String(emoji).trim(),
      nickname: nickname ? String(nickname).trim() : 'Guest',
      avatarColor: avatarColor || '#6366f1',
      timestamp: Date.now()
    };

    if (io) {
      io.emit('reaction_received', reactionPayload);
    }
    res.json({ success: true, reaction: reactionPayload });
  });

  // POST /api/social/announcement: Host broadcast message
  router.post('/announcement', (req, res) => {
    const { hostToken, message, durationMs = 6000 } = req.body || {};
    const io = req.app.get('io');

    if (!isAuthorizedHost(hostToken)) {
      return res.status(403).json({ error: 'Unauthorized host' });
    }

    if (!message) return res.status(400).json({ error: 'Message is required' });

    const announcement = {
      id: generateUuid(),
      message: String(message).trim().substring(0, 180),
      durationMs: Math.min(20000, Math.max(2000, durationMs)),
      timestamp: Date.now()
    };

    if (io) {
      io.emit('announcement_received', announcement);
    }
    res.json({ success: true, announcement });
  });

  // GET /api/social/preview_audio/:id: Stream audio snippet with HTTP 206 Range support
  router.get('/preview_audio/:id', (req, res) => {
    const songId = req.params.id;
    const songDir = path.join(DOWNLOADS_DIR, songId);

    if (!fs.existsSync(songDir)) {
      return res.status(404).json({ error: 'Song files not found' });
    }

    const files = fs.readdirSync(songDir);
    // Prefer instrumental stem if available, else original audio file
    const targetFile = files.find(f => f.startsWith('instrumental.')) ||
      files.find(f => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav'));

    if (!targetFile) {
      return res.status(404).json({ error: 'No audio stream available for this song' });
    }

    const filePath = path.join(songDir, targetFile);
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const ext = path.extname(targetFile).toLowerCase();
    const contentType = ext === '.wav' ? 'audio/wav' : (ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg');

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes'
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Socket event hook for clean disconnection
  router.handleSocketDisconnect = (socketId, io) => {
    let changed = false;
    if (hostSession.activeSocketId === socketId) {
      // Keep hostToken valid for 45s grace period so reload doesn't vacate host
      hostSession.activeSocketId = null;
      hostSession.lastHeartbeat = Date.now();
      changed = true;
    }

    for (const [guestId, guest] of activeGuests.entries()) {
      if (guest.socketId === socketId) {
        activeGuests.delete(guestId);
        changed = true;
        break;
      }
    }

    if (changed) {
      broadcastSocialState(io);
    }
  };

  router.clearStageRequestsForNewTrack = (io) => {
    stageJoinRequests = stageJoinRequests.filter(r => r.status !== 'pending');
    if (io) broadcastSocialState(io);
  };

  return router;
}

module.exports = {
  createSocialRouter,
  getLocalIpAddress
};
