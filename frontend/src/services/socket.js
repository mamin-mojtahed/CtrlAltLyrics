import { io } from 'socket.io-client';

export const socket = io('/');
window.socket = socket;

export function emitUpdateState(state) {
  socket.emit('update_state', state);
}

export function emitPlayerCommand(cmd) {
  const payload = (cmd && typeof cmd === 'object') ? { sender: socket.id, ...cmd } : cmd;
  socket.emit('player_command', payload);
}

export function emitRequestSync() {
  socket.emit('request_sync');
}

export default socket;
