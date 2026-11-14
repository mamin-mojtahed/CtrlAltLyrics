const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const apiRoutes = require('./backend/src/api');

const app = express();
app.use(cors());
app.use(express.json());

// Serve backend downloads as static files
app.use('/audio', express.static(path.join(__dirname, 'backend', 'downloads')));

app.use('/api', apiRoutes);

// Frontend routes: redirect to Vite dev server in development or serve built dist
const distPath = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}
app.get(['/dashboard', '/dashboard.html'], (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    return res.redirect('http://localhost:5173/dashboard.html');
  }
  if (fs.existsSync(path.join(distPath, 'dashboard.html'))) {
    return res.sendFile(path.join(distPath, 'dashboard.html'));
  }
  res.redirect('http://localhost:5173/dashboard.html');
});
app.get(['/display', '/display.html'], (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    return res.redirect('http://localhost:5173/display.html');
  }
  if (fs.existsSync(path.join(distPath, 'display.html'))) {
    return res.sendFile(path.join(distPath, 'display.html'));
  }
  res.redirect('http://localhost:5173/display.html');
});
app.get(['/host', '/host.html'], (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    return res.redirect('http://localhost:5173/host.html');
  }
  if (fs.existsSync(path.join(distPath, 'host.html'))) {
    return res.sendFile(path.join(distPath, 'host.html'));
  }
  res.redirect('http://localhost:5173/host.html');
});
app.get(['/guest', '/guest.html'], (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    return res.redirect('http://localhost:5173/guest.html');
  }
  if (fs.existsSync(path.join(distPath, 'guest.html'))) {
    return res.sendFile(path.join(distPath, 'guest.html'));
  }
  res.redirect('http://localhost:5173/guest.html');
});
app.get('/', (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    return res.redirect('http://localhost:5173/');
  }
  if (fs.existsSync(path.join(distPath, 'index.html'))) {
    return res.sendFile(path.join(distPath, 'index.html'));
  }
  res.redirect('http://localhost:5173/');
});

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
  isInstBackLinked: false,
  isBackLeadLinked: false,
  showKaraokeSlide: true,
  showWaveform: true,
  showMusicVideo: true,
  audioMaster: 'display'
};

let lastServerSeekTimestamp = 0;
let lastServerSeekTime = 0;

io.getCurrentState = () => currentState;
io.updateCurrentState = (updater) => {
  if (typeof updater === 'function') {
    currentState = updater(currentState);
  } else if (updater && typeof updater === 'object') {
    currentState = { ...currentState, ...updater };
  }
  return currentState;
};

app.set('io', io);
app.set('getCurrentState', io.getCurrentState);
app.set('updateCurrentState', io.updateCurrentState);

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

    if (
      newState &&
      typeof newState.currentTime === 'number' &&
      Date.now() - lastServerSeekTimestamp < 600 &&
      Math.abs(newState.currentTime - lastServerSeekTime) > 1.2
    ) {
      delete newState.currentTime;
    }

    if (newState.isInstBackLinked !== undefined) {
      currentState.isInstBackLinked = Boolean(newState.isInstBackLinked);
    }
    if (newState.isBackLeadLinked !== undefined) {
      currentState.isBackLeadLinked = Boolean(newState.isBackLeadLinked);
    }

    currentState = { ...currentState, ...newState };
    if (
      newState.isPlaying !== undefined ||
      newState.isInstBackLinked !== undefined ||
      newState.isBackLeadLinked !== undefined
    ) {
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
      lastServerSeekTimestamp = Date.now();
      lastServerSeekTime = cmd.time;
    } else if (cmd.command === 'select_song') {
      currentState.songId = cmd.id;
      currentState.queueId = cmd.queueId || null;
      apiRoutes.socialRouter?.clearStageRequestsForNewTrack?.(io);
    } else if (cmd.command === 'play_next') {
      apiRoutes.socialRouter?.clearStageRequestsForNewTrack?.(io);
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

    socket.broadcast.emit('player_command', cmd);
  });

  socket.on('social_reaction', (reaction) => {
    io.emit('reaction_received', reaction);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (apiRoutes.socialRouter && typeof apiRoutes.socialRouter.handleSocketDisconnect === 'function') {
      apiRoutes.socialRouter.handleSocketDisconnect(socket.id, io);
    }
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
