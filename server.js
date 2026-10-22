const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./backend/src/api');

const app = express();
app.use(cors());
app.use(express.json());

// Serve backend downloads as static files
app.use('/audio', express.static(path.join(__dirname, 'backend', 'downloads')));

app.use('/api', apiRoutes);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

// Socket.io logic for syncing (Single Source of Truth)
let currentState = {
  songId: null,
  songData: null,
  queueId: null,
  currentTime: 0,
  isPlaying: false,
  volumes: {
    vocals: 1,
    instrumentals: 1,
    lead: 1,
    back: 1
  },
  showKaraokeSlide: true
};

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.emit('sync_state', currentState);

  socket.on('request_sync', () => {
    socket.emit('sync_state', currentState);
  });

  socket.on('update_state', (newState) => {
    if (newState && newState.volumes) {
      const inst = newState.volumes.inst ?? newState.volumes.instrumentals;
      const lead = newState.volumes.lead ?? newState.volumes.vocals;
      const back = newState.volumes.back;
      const normalized = { ...newState.volumes };
      if (inst !== undefined) {
        normalized.inst = inst;
        normalized.instrumentals = inst;
      }
      if (lead !== undefined) {
        normalized.lead = lead;
        normalized.vocals = lead;
      }
      if (back !== undefined) {
        normalized.back = back;
      }
      newState.volumes = { ...(currentState.volumes || {}), ...normalized };
    }
    currentState = { ...currentState, ...newState };
    if (newState.isPlaying !== undefined) {
      io.emit('sync_state', currentState);
    } else {
      socket.broadcast.emit('sync_state', newState);
    }
  });

  socket.on('player_command', (cmd) => {
    if (!cmd) return;

    if (cmd.command === 'toggle_play') {
      currentState.isPlaying = !currentState.isPlaying;
    } else if (cmd.command === 'play') {
      currentState.isPlaying = true;
      if (typeof cmd.time === 'number' && !isNaN(cmd.time)) {
        currentState.currentTime = cmd.time;
      }
    } else if (cmd.command === 'pause') {
      currentState.isPlaying = false;
      if (typeof cmd.time === 'number' && !isNaN(cmd.time)) {
        currentState.currentTime = cmd.time;
      }
    } else if (cmd.command === 'seek' && typeof cmd.time === 'number') {
      currentState.currentTime = cmd.time;
    } else if (cmd.command === 'select_song') {
      currentState.songId = cmd.id;
      currentState.queueId = cmd.queueId || null;
    } else if (cmd.command === 'set_volumes' && cmd.volumes) {
      const inst = cmd.volumes.inst ?? cmd.volumes.instrumentals;
      const lead = cmd.volumes.lead ?? cmd.volumes.vocals;
      const back = cmd.volumes.back;
      const normalized = { ...cmd.volumes };
      if (inst !== undefined) {
        normalized.inst = inst;
        normalized.instrumentals = inst;
      }
      if (lead !== undefined) {
        normalized.lead = lead;
        normalized.vocals = lead;
      }
      if (back !== undefined) {
        normalized.back = back;
      }
      currentState.volumes = { ...(currentState.volumes || {}), ...normalized };
    }
    if (cmd.audioMaster) {
      currentState.audioMaster = cmd.audioMaster;
    }

    if (cmd.command === 'set_volumes' && cmd.volumes) {
      socket.broadcast.emit('sync_state', { volumes: currentState.volumes });
    } else if (['toggle_play', 'play', 'pause', 'seek'].includes(cmd.command)) {
      socket.broadcast.emit('sync_state', currentState);
    }
    socket.broadcast.emit('player_command', cmd);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Pass IO to routes if needed
app.set('io', io);

const PORT = process.env.PORT || 3000;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`⚠️ Port ${PORT} is already in use by another process.`);
    console.error(`Run 'kill -9 $(lsof -t -i:${PORT})' to free the port.`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
  }
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
