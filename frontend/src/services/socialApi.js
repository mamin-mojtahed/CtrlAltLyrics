// REST API Client for Social, Host, and Guest features

export async function fetchSocialState() {
  const res = await fetch('/api/social/state');
  if (!res.ok) throw new Error(`Failed to fetch social state: ${res.statusText}`);
  return res.json();
}

export async function claimHost({ pin, hostToken, clientName, socketId }) {
  const res = await fetch('/api/social/host/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, hostToken, clientName, socketId })
  });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || 'Failed to claim host');
    error.conflict = data.conflict;
    throw error;
  }
  return data;
}

export async function releaseHost(hostToken) {
  const res = await fetch('/api/social/host/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostToken })
  });
  if (!res.ok) throw new Error(`Failed to release host: ${res.statusText}`);
  return res.json();
}

export async function updateHostSettings(settings, hostToken) {
  const res = await fetch('/api/social/host/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings, hostToken })
  });
  if (!res.ok) throw new Error(`Failed to update settings: ${res.statusText}`);
  return res.json();
}

export async function registerGuestProfile({ guestId, nickname, avatarColor, socketId, clientType = 'guest' }) {
  const res = await fetch('/api/social/guest/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId, nickname, avatarColor, socketId, clientType })
  });
  if (!res.ok) throw new Error(`Failed to register guest: ${res.statusText}`);
  return res.json();
}

export async function submitSongRequest({ song, requestedBy, notes }) {
  const res = await fetch('/api/social/request_song', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ song, requestedBy, notes })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to submit song request');
  return data;
}

export async function approveSongRequest(requestId, position, hostToken) {
  const res = await fetch(`/api/social/requests/${requestId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position, hostToken })
  });
  if (!res.ok) throw new Error(`Failed to approve request: ${res.statusText}`);
  return res.json();
}

export async function rejectSongRequest(requestId, reason, hostToken) {
  const res = await fetch(`/api/social/requests/${requestId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, hostToken })
  });
  if (!res.ok) throw new Error(`Failed to decline request: ${res.statusText}`);
  return res.json();
}

export async function deleteSongRequest(requestId, { guestId, hostToken }) {
  const res = await fetch(`/api/social/requests/${requestId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId, hostToken })
  });
  if (!res.ok) throw new Error(`Failed to cancel request: ${res.statusText}`);
  return res.json();
}

export async function updateQueueSingers(queueId, nickname, action = 'join') {
  const res = await fetch(`/api/social/queue/${queueId}/singers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname, action })
  });
  if (!res.ok) throw new Error(`Failed to update singers: ${res.statusText}`);
  return res.json();
}

export async function deleteQueueSong(queueId, { guestId, hostToken }) {
  const res = await fetch(`/api/social/queue/${queueId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId, hostToken })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to remove song');
  return data;
}

export async function sendReaction({ emoji, nickname, avatarColor }) {
  const res = await fetch('/api/social/reaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji, nickname, avatarColor })
  });
  if (!res.ok) throw new Error(`Failed to send reaction: ${res.statusText}`);
  return res.json();
}

export async function sendAnnouncement(message, hostToken, durationMs = 6000) {
  const res = await fetch('/api/social/announcement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, hostToken, durationMs })
  });
  if (!res.ok) throw new Error(`Failed to send announcement: ${res.statusText}`);
  return res.json();
}

export async function toggleUpvote({ targetType = 'queue', targetId, guestId }) {
  const res = await fetch('/api/social/upvote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetType, targetId, guestId })
  });
  if (!res.ok) throw new Error(`Failed to toggle upvote: ${res.statusText}`);
  return res.json();
}

export async function requestJoinStage({ guestId, nickname, avatarColor }) {
  const res = await fetch('/api/social/stage/join_request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId, nickname, avatarColor })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to request joining stage');
  return data;
}

export async function approveStageJoinRequest(requestId, hostToken) {
  const res = await fetch(`/api/social/stage/join_requests/${requestId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostToken })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to approve stage request');
  return data;
}

export async function rejectStageJoinRequest(requestId, hostToken) {
  const res = await fetch(`/api/social/stage/join_requests/${requestId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostToken })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to reject stage request');
  return data;
}

export async function cancelStageJoinRequest(requestId, guestId) {
  const res = await fetch(`/api/social/stage/join_requests/${requestId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to cancel stage request');
  return data;
}

export async function leaveStage(nickname) {
  const res = await fetch('/api/social/stage/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to leave stage');
  return data;
}
