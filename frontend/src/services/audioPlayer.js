// Web Audio API Player for Stems (Inst, Lead Vocals, Back Vocals)

let audioCtx = null;
let sources = {};
let gainNodes = {};
let buffers = {};
let audioStartTime = 0;
let pauseTime = 0;
let currentSongId = null;
let audioLoadingPromise = null;
let onSongEndCallback = null;
let songEndFired = false;

export function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

export function isContextSuspended() {
  return audioCtx && audioCtx.state === 'suspended';
}

export async function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    try {
      await ctx.resume();
      return true;
    } catch (e) {
      console.warn("Failed to unlock audio context:", e);
      return false;
    }
  }
  return true;
}

export function setOnSongEnd(cb) {
  onSongEndCallback = cb;
}

function stopSource(sourceNode) {
  if (sourceNode) {
    try {
      sourceNode.onended = null;
      sourceNode.stop();
    } catch (e) {}
  }
}

export function stopAllSources() {
  stopSource(sources.leadVoc);
  stopSource(sources.backVoc);
  stopSource(sources.inst);
  sources.leadVoc = null;
  sources.backVoc = null;
  sources.inst = null;
}

export function resetAudio() {
  stopAllSources();
  audioStartTime = 0;
  pauseTime = 0;
  currentSongId = null;
  buffers = {};
  songEndFired = false;
}

export async function setupAudio(song, initialVolumes = { inst: 1, back: 1, lead: 1 }) {
  const ctx = getAudioContext();
  stopAllSources();
  buffers = {};
  currentSongId = song ? song.id : null;

  gainNodes = {
    inst: ctx.createGain(),
    leadVoc: ctx.createGain(),
    backVoc: ctx.createGain()
  };

  gainNodes.inst.connect(ctx.destination);
  gainNodes.leadVoc.connect(ctx.destination);
  gainNodes.backVoc.connect(ctx.destination);

  gainNodes.inst.gain.value = parseFloat(initialVolumes.inst ?? 1);
  gainNodes.leadVoc.gain.value = parseFloat(initialVolumes.lead ?? 1);
  gainNodes.backVoc.gain.value = parseFloat(initialVolumes.back ?? 1);

  if (!song || !song.stems) {
    return 0;
  }

  const loadingSongId = song.id;
  const fetchPromises = [];

  if (song.stems.lead) {
    fetchPromises.push(
      fetch(song.stems.lead)
        .then(r => r.arrayBuffer())
        .then(b => ctx.decodeAudioData(b))
        .then(b => { if (currentSongId === loadingSongId) buffers.leadBuf = b; })
    );
  }
  if (song.stems.back) {
    fetchPromises.push(
      fetch(song.stems.back)
        .then(r => r.arrayBuffer())
        .then(b => ctx.decodeAudioData(b))
        .then(b => { if (currentSongId === loadingSongId) buffers.backBuf = b; })
    );
  }
  if (song.stems.inst) {
    fetchPromises.push(
      fetch(song.stems.inst)
        .then(r => r.arrayBuffer())
        .then(b => ctx.decodeAudioData(b))
        .then(b => { if (currentSongId === loadingSongId) buffers.instBuf = b; })
    );
  }

  audioLoadingPromise = Promise.all(fetchPromises)
    .then(() => {
      if (currentSongId !== loadingSongId) return 0;
      const dur = buffers.leadBuf ? buffers.leadBuf.duration
        : (buffers.instBuf ? buffers.instBuf.duration
        : (buffers.backBuf ? buffers.backBuf.duration : 0));
      return dur;
    })
    .catch(err => {
      console.error("Error loading stem audio buffers:", err);
      return 0;
    });

  return audioLoadingPromise;
}

export async function playAudio(offset = 0) {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (e) {}
  }

  if (audioLoadingPromise) {
    await audioLoadingPromise;
  }

  stopAllSources();
  songEndFired = false;

  let maxDuration = 0;
  let primaryStem = null;
  if (buffers.leadBuf && buffers.leadBuf.duration > maxDuration) {
    maxDuration = buffers.leadBuf.duration;
    primaryStem = 'leadVoc';
  }
  if (buffers.instBuf && buffers.instBuf.duration > maxDuration) {
    maxDuration = buffers.instBuf.duration;
    primaryStem = 'inst';
  }
  if (buffers.backBuf && buffers.backBuf.duration > maxDuration) {
    maxDuration = buffers.backBuf.duration;
    primaryStem = 'backVoc';
  }

  const onEndedHandler = () => {
    if (songEndFired) return;
    const curTime = ctx.currentTime - audioStartTime;
    if (maxDuration > 0 && curTime >= maxDuration - 0.5) {
      songEndFired = true;
      if (typeof onSongEndCallback === 'function') {
        onSongEndCallback();
      }
    }
  };

  if (buffers.leadBuf && gainNodes.leadVoc) {
    sources.leadVoc = ctx.createBufferSource();
    sources.leadVoc.buffer = buffers.leadBuf;
    sources.leadVoc.connect(gainNodes.leadVoc);
    if (primaryStem === 'leadVoc') sources.leadVoc.onended = onEndedHandler;
    sources.leadVoc.start(0, offset);
  }

  if (buffers.backBuf && gainNodes.backVoc) {
    sources.backVoc = ctx.createBufferSource();
    sources.backVoc.buffer = buffers.backBuf;
    sources.backVoc.connect(gainNodes.backVoc);
    if (primaryStem === 'backVoc') sources.backVoc.onended = onEndedHandler;
    sources.backVoc.start(0, offset);
  }

  if (buffers.instBuf && gainNodes.inst) {
    sources.inst = ctx.createBufferSource();
    sources.inst.buffer = buffers.instBuf;
    sources.inst.connect(gainNodes.inst);
    if (primaryStem === 'inst') sources.inst.onended = onEndedHandler;
    sources.inst.start(0, offset);
  }

  audioStartTime = ctx.currentTime - offset;
  pauseTime = offset;
}

export function pauseAudio() {
  const ctx = getAudioContext();
  const currentActualTime = (ctx && ctx.state === 'running')
    ? (ctx.currentTime - audioStartTime)
    : pauseTime;

  stopAllSources();
  pauseTime = currentActualTime;
  return currentActualTime;
}

export function seekAudio(time, wasPlaying) {
  pauseTime = time;
  if (wasPlaying && (buffers.leadBuf || buffers.instBuf || buffers.backBuf)) {
    playAudio(time);
  }
}

export function getCurrentPlaybackTime(isPlaying) {
  const ctx = getAudioContext();
  const hasActiveSources = !!(sources.leadVoc || sources.inst || sources.backVoc);
  if (isPlaying && hasActiveSources && ctx && ctx.state === 'running') {
    return Math.max(0, ctx.currentTime - audioStartTime);
  }
  return pauseTime || 0;
}

export function setStemVolumes({ inst, back, lead }) {
  if (inst !== undefined && gainNodes.inst) {
    gainNodes.inst.gain.value = parseFloat(inst);
  }
  if (back !== undefined && gainNodes.backVoc) {
    gainNodes.backVoc.gain.value = parseFloat(back);
  }
  if (lead !== undefined && gainNodes.leadVoc) {
    gainNodes.leadVoc.gain.value = parseFloat(lead);
  }
}

export function getLoadedDuration() {
  return buffers.leadBuf?.duration || buffers.instBuf?.duration || buffers.backBuf?.duration || 0;
}
