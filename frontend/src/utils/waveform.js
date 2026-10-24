import * as audioPlayer from '../services/audioPlayer.js';

// Precomputed twiddle factors, bit-reversal, and Hann window for 256-point real FFT
const FFT_SIZE = 256;
const cosTable = new Float32Array(FFT_SIZE / 2);
const sinTable = new Float32Array(FFT_SIZE / 2);
const bitRev = new Uint16Array(FFT_SIZE);
const hannWindow = new Float32Array(FFT_SIZE);

for (let i = 0; i < FFT_SIZE / 2; i++) {
  cosTable[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE);
  sinTable[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE);
}

let j = 0;
for (let i = 0; i < FFT_SIZE; i++) {
  bitRev[i] = j;
  let bit = FFT_SIZE >> 1;
  while (j & bit) {
    j ^= bit;
    bit >>= 1;
  }
  j ^= bit;
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
}

// Module-level static buffers to eliminate per-frame GC allocations
const staticReal = new Float32Array(FFT_SIZE);
const staticImag = new Float32Array(FFT_SIZE);
const staticSamples = new Float32Array(FFT_SIZE);
const staticRawMagnitudes = new Uint8Array(128);

const MAX_BARS = 160;
const MAX_WAVE_POINTS = 128;
const staticOutBands = new Float32Array(MAX_BARS);
const staticWaveSamples = new Float32Array(MAX_WAVE_POINTS);

// Cached buffer channel to avoid repeated Web Audio C++ crossing
let cachedBufferRef = null;
let cachedChannelData = null;

const staticAudioResult = {
  frequencies: staticOutBands,
  waveSamples: staticWaveSamples,
  amplitude: 0
};

/**
 * Computes 128 frequency magnitudes from 256 time-domain audio samples using Radix-2 Real FFT.
 * Zero-allocation in-place execution.
 */
export function computeFFTMagnitudes(samples, outMagnitudes) {
  const len = Math.min(samples.length, FFT_SIZE);
  for (let i = 0; i < len; i++) {
    const rev = bitRev[i];
    staticReal[rev] = samples[i] * hannWindow[i];
    staticImag[rev] = 0;
  }
  for (let i = len; i < FFT_SIZE; i++) {
    const rev = bitRev[i];
    staticReal[rev] = 0;
    staticImag[rev] = 0;
  }

  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const step = FFT_SIZE / size;
    for (let i = 0; i < FFT_SIZE; i += size) {
      for (let k = 0; k < half; k++) {
        const twiddleIdx = k * step;
        const c = cosTable[twiddleIdx];
        const s = sinTable[twiddleIdx];
        const tr = staticReal[i + k + half] * c - staticImag[i + k + half] * s;
        const ti = staticReal[i + k + half] * s + staticImag[i + k + half] * c;
        staticReal[i + k + half] = staticReal[i + k] - tr;
        staticImag[i + k + half] = staticImag[i + k] - ti;
        staticReal[i + k] += tr;
        staticImag[i + k] += ti;
      }
    }
  }

  const numBins = Math.min(FFT_SIZE / 2, outMagnitudes.length);
  for (let i = 0; i < numBins; i++) {
    const r = staticReal[i];
    const im = staticImag[i];
    const mag = Math.sqrt(r * r + im * im) * 4.5;
    outMagnitudes[i] = Math.min(255, Math.floor(mag * 255));
  }
}

/**
 * Extracts live momentary audio frequency spectrum, instantaneous time-domain wave samples,
 * and amplitude for the current moment in playback.
 * Fully zero-allocation per frame.
 */
export function getMomentaryAudioData(curTime, isPlaying, buffer, numBars = 64, wavePoints = 48) {
  const safeBars = Math.min(numBars, MAX_BARS);
  const safePoints = Math.min(wavePoints, MAX_WAVE_POINTS);

  if (!isPlaying) {
    staticOutBands.fill(0, 0, safeBars);
    staticWaveSamples.fill(0, 0, safePoints);
    staticAudioResult.frequencies = staticOutBands.subarray(0, safeBars);
    staticAudioResult.waveSamples = staticWaveSamples.subarray(0, safePoints);
    staticAudioResult.amplitude = 0;
    return staticAudioResult;
  }

  // 1. Check local Web Audio AnalyserNode
  const isLocal = audioPlayer.isPlayingLocally && audioPlayer.isPlayingLocally();
  const localFreq = audioPlayer.getFrequencyData();
  const localTime = audioPlayer.getTimeDomainData();
  let hasLocalAudio = false;

  if (isLocal && localFreq && localFreq.length > 0) {
    hasLocalAudio = true;
  } else if (localFreq && localFreq.length > 0) {
    let sum = 0;
    const checkLen = Math.min(32, localFreq.length);
    for (let i = 0; i < checkLen; i++) {
      sum += localFreq[i];
    }
    if (sum > 2) {
      hasLocalAudio = true;
    }
  }

  staticRawMagnitudes.fill(0);
  let momentaryAmplitude = 0;

  if (hasLocalAudio && localFreq) {
    const copyLen = Math.min(localFreq.length, staticRawMagnitudes.length);
    let total = 0;
    for (let i = 0; i < copyLen; i++) {
      const val = localFreq[i];
      staticRawMagnitudes[i] = val;
      total += val;
    }
    momentaryAmplitude = Math.min(1.0, total / (copyLen * 150));

    // Extract real time-domain wave samples from Web Audio Analyser
    if (localTime && localTime.length > 0) {
      const step = localTime.length / safePoints;
      for (let i = 0; i < safePoints; i++) {
        const idx = Math.min(localTime.length - 1, Math.floor(i * step));
        staticWaveSamples[i] = (localTime[idx] - 128) / 128;
      }
    } else {
      staticWaveSamples.fill(0, 0, safePoints);
    }
  } else if (buffer) {
    // 2. Sample AudioBuffer at current playback timestamp
    try {
      if (buffer !== cachedBufferRef) {
        cachedBufferRef = buffer;
        cachedChannelData = buffer.getChannelData(0);
      }
      const channel = cachedChannelData;
      if (channel) {
        const sampleRate = buffer.sampleRate || 44100;
        const center = Math.floor(curTime * sampleRate);
        const halfWin = FFT_SIZE >> 1;
        let sumSq = 0;
        let count = 0;

        for (let i = 0; i < FFT_SIZE; i++) {
          const sIdx = center - halfWin + i;
          if (sIdx >= 0 && sIdx < channel.length) {
            const s = channel[sIdx];
            staticSamples[i] = s;
            sumSq += s * s;
            count++;
          } else {
            staticSamples[i] = 0;
          }
        }

        computeFFTMagnitudes(staticSamples, staticRawMagnitudes);
        momentaryAmplitude = count > 0 ? Math.min(1.0, Math.sqrt(sumSq / count) * 3.2) : 0;

        // Extract real time-domain wave samples from buffer
        const step = FFT_SIZE / safePoints;
        for (let i = 0; i < safePoints; i++) {
          const idx = Math.min(FFT_SIZE - 1, Math.floor(i * step));
          staticWaveSamples[i] = staticSamples[idx];
        }
      } else {
        staticWaveSamples.fill(0, 0, safePoints);
      }
    } catch (e) {
      staticWaveSamples.fill(0, 0, safePoints);
    }
  } else {
    staticWaveSamples.fill(0, 0, safePoints);
  }

  // 3. Map 128 raw frequency bins to safeBars across the audible musical spectrum (40 Hz - 9.5 kHz)
  // Symmetrical layout: Center = Bass/kick/punch, Edges = Vocals/stereo percussion/air
  // Uses fractional bin interpolation and balanced acoustic weighting to prevent clamping or over-stretching
  for (let i = 0; i < safeBars; i++) {
    // Distance from center: 0 in middle, 1 at left/right edges
    const norm = Math.abs((i / (safeBars - 1)) - 0.5) * 2;
    // Map logarithmically from bin 1 (core bass ~170Hz) to bin 48 (treble/air ~8.2kHz)
    const binFloat = 1.0 + Math.pow(norm, 1.42) * 46;
    const b0 = Math.floor(binFloat);
    const b1 = Math.min(60, b0 + 1);
    const frac = binFloat - b0;
    const mag = (staticRawMagnitudes[b0] || 0) * (1 - frac) + (staticRawMagnitudes[b1] || 0) * frac;

    // Gentle, natural treble tilt (+0.50 max) to preserve balance without clipping or clamping
    const trebleTilt = 1.0 + Math.pow(norm, 1.15) * 0.50;
    // Smooth edge taper so outer boundaries fit naturally within the frame
    const edgeEnvelope = 1.0 - Math.pow(norm, 3.5) * 0.18;

    staticOutBands[i] = Math.min(1.0, (mag / 255) * trebleTilt * edgeEnvelope);
  }

  staticAudioResult.frequencies = staticOutBands.subarray(0, safeBars);
  staticAudioResult.waveSamples = staticWaveSamples.subarray(0, safePoints);
  staticAudioResult.amplitude = momentaryAmplitude;
  return staticAudioResult;
}
