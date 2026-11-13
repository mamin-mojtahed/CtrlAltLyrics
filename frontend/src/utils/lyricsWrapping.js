// Lyrics wrapping & aesthetic line balancing utilities

export function isRtlText(text) {
  if (!text) return false;
  const rtlRegex = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
  return rtlRegex.test(text);
}

export function isInstrumentalText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed === '') return true;
  if (trimmed.toUpperCase() === '#INSTRUMENTAL') return true;
  if (/^\[instrumental\]$/i.test(trimmed)) return true;
  if (/^instrumental$/i.test(trimmed)) return true;
  if (/^[🎵🎶\s]+$/u.test(trimmed)) return true;
  if (/^[🎵🎶\s]*instrumental[🎵🎶\s]*$/i.test(trimmed)) return true;
  if (/^[🎵🎶\s]*بی‌?کلام[🎵🎶\s]*$/i.test(trimmed)) return true;
  return false;
}

export function replaceMusicEmojisWithIcons(text) {
  if (!text) return '';
  return text.replace(/[\u{1F3B5}\u{1F3B6}]|🎵|🎶/gu, '<i class="icon-music"></i>');
}

export function prepareLyricsForDisplay(rawLyrics) {
  if (!rawLyrics || rawLyrics.length === 0) return [];
  const list = rawLyrics.map(l => ({ ...l }));

  list.forEach(l => {
    if (l.isInstrumental || isInstrumentalText(l.text)) {
      l.isInstrumental = true;
      l.text = '🎵🎵🎵';
    }
  });

  const firstTime = typeof list[0].time === 'number' ? list[0].time : parseFloat(list[0].time) || 0;
  if (firstTime > 3.5 && !list.some(l => (parseFloat(l.time) || 0) < 1.5)) {
    list.unshift({
      time: 0,
      text: '🎵🎵🎵',
      isInstrumental: true
    });
  }

  list.forEach(l => {
    if (isRtlText(l.text)) {
      l.direction = 'rtl';
    } else {
      l.direction = 'ltr';
    }
  });

  return list;
}

let lyricsMeasureCanvas = null;
let lyricsMeasureCtx = null;

export function getLyricsMeasureContext() {
  if (!lyricsMeasureCanvas && typeof document !== 'undefined') {
    lyricsMeasureCanvas = document.createElement('canvas');
    lyricsMeasureCtx = lyricsMeasureCanvas.getContext('2d');
  }
  return lyricsMeasureCtx;
}

/**
 * Balance lyric line wrapping to avoid orphaned words and ensure aesthetically
 * pleasing, balanced line lengths within available container width.
 */
export function balanceLyricLine(words, ctx, maxLineWidth) {
  if (!words || words.length === 0) return [];
  if (words.length <= 1) return [words.join('')];

  const spaceWidth = ctx.measureText(' ').width;
  const wordWidths = words.map(w => ctx.measureText(w).width);

  function getLineWidth(start, end) {
    let w = 0;
    for (let i = start; i < end; i++) {
      w += wordWidths[i];
      if (i < end - 1) w += spaceWidth;
    }
    return w;
  }

  const totalWidth = getLineWidth(0, words.length);
  // If the entire text fits comfortably on one line, never split!
  if (totalWidth <= maxLineWidth) {
    return [words.join(' ')];
  }

  const n = words.length;
  const minLines = Math.max(2, Math.ceil(totalWidth / maxLineWidth));
  let bestPartition = null;
  let bestCost = Infinity;

  const hardMax = maxLineWidth;

  // Search across line counts from minLines up to minLines + 3
  for (let k = minLines; k <= Math.min(n, minLines + 3); k++) {
    const targetWidth = totalWidth / k;
    const dp = Array.from({ length: n + 1 }, () => Array(k + 1).fill(Infinity));
    const backtrack = Array.from({ length: n + 1 }, () => Array(k + 1).fill(-1));
    dp[0][0] = 0;

    for (let j = 1; j <= k; j++) {
      for (let i = j; i <= n; i++) {
        for (let p = j - 1; p < i; p++) {
          if (dp[p][j - 1] === Infinity) continue;
          const w = getLineWidth(p, i);
          const wordCount = i - p;
          if (w > hardMax && wordCount > 1) continue;

          let cost = Math.pow(w - targetWidth, 2);
          if (w > maxLineWidth) {
            cost += Math.pow((w - maxLineWidth) * 20, 2);
          }

          // Heavy penalty against short orphaned single words (e.g. 'the', 'me')
          if (wordCount === 1 && wordWidths[p] < maxLineWidth * 0.7) {
            cost += 5000000;
          } else if (wordCount === 2) {
            cost += 800;
          }

          const total = dp[p][j - 1] + cost;
          if (total < dp[i][j]) {
            dp[i][j] = total;
            backtrack[i][j] = p;
          }
        }
      }
    }

    if (dp[n][k] < bestCost) {
      bestCost = dp[n][k];
      const lines = [];
      let curr = n;
      for (let j = k; j >= 1; j--) {
        const prev = backtrack[curr][j];
        lines.unshift(words.slice(prev, curr).join(' '));
        curr = prev;
      }
      bestPartition = lines;
      if (dp[n][k] < 2000000) break; // Found clean partition without orphans!
    }
  }

  // Fallback if no clean partition found
  if (!bestPartition) {
    const lines = [];
    let curLine = [];
    let curW = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const wordW = wordWidths[i];
      const addW = curLine.length > 0 ? (spaceWidth + wordW) : wordW;
      if (curLine.length > 0 && curW + addW > maxLineWidth) {
        lines.push(curLine.join(' '));
        curLine = [w];
        curW = wordW;
      } else {
        curLine.push(w);
        curW += addW;
      }
    }
    if (curLine.length > 0) lines.push(curLine.join(' '));
    bestPartition = lines;
  }

  // Final orphan prevention: Merge any short 1-word lines with adjacent lines if within maxLineWidth
  if (bestPartition.length > 1) {
    for (let idx = 0; idx < bestPartition.length; idx++) {
      const lineWords = bestPartition[idx].split(' ');
      if (lineWords.length === 1 && wordWidths[words.indexOf(lineWords[0])] < maxLineWidth * 0.6) {
        if (idx > 0) {
          const prevLine = bestPartition[idx - 1];
          const combined = prevLine + ' ' + lineWords[0];
          const combW = ctx.measureText(combined).width;
          if (combW <= maxLineWidth) {
            bestPartition[idx - 1] = combined;
            bestPartition.splice(idx, 1);
            idx--;
            continue;
          }
        }
        if (idx < bestPartition.length - 1) {
          const nextLine = bestPartition[idx + 1];
          const combined = lineWords[0] + ' ' + nextLine;
          const combW = ctx.measureText(combined).width;
          if (combW <= maxLineWidth) {
            bestPartition[idx] = combined;
            bestPartition.splice(idx + 1, 1);
            continue;
          }
        }
      }
    }
  }

  return bestPartition;
}

export function calculateMaxLineWidth(lyricsContainer) {
  if (!lyricsContainer || lyricsContainer.clientWidth <= 0) return 300;
  const computedContainer = window.getComputedStyle(lyricsContainer);
  const containerPadLeft = parseFloat(computedContainer.paddingLeft) || 24;
  const containerPadRight = parseFloat(computedContainer.paddingRight) || 24;
  const containerInnerWidth = lyricsContainer.clientWidth - containerPadLeft - containerPadRight;

  const sampleLine = lyricsContainer.querySelector('.lyric-line:not(.is-instrumental)') || lyricsContainer.querySelector('.lyric-line');
  let linePad = 48;
  let textPad = 18;
  if (sampleLine) {
    const lineStyle = window.getComputedStyle(sampleLine);
    linePad = (parseFloat(lineStyle.paddingLeft) || 24) + (parseFloat(lineStyle.paddingRight) || 24);
    const sampleText = sampleLine.querySelector('.lyric-text');
    if (sampleText) {
      const textStyle = window.getComputedStyle(sampleText);
      textPad = (parseFloat(textStyle.paddingLeft) || 0) + (parseFloat(textStyle.paddingRight) || 0);
    }
  }

  const maxLineBoxWidth = Math.min(containerInnerWidth, containerInnerWidth - 48);
  const availableWidth = Math.max(180, maxLineBoxWidth - linePad - textPad);
  return Math.max(180, Math.floor(availableWidth - 16));
}

export function configureMeasureContext(ctx, sampleEl) {
  if (!ctx || !sampleEl) return;
  const comp = window.getComputedStyle(sampleEl);
  const fontWeight = comp.fontWeight || '800';
  const fontSize = comp.fontSize || '35.2px';
  const fontFamily = comp.fontFamily || "'Inter', sans-serif";
  ctx.font = `${fontWeight} ${fontSize} ${fontFamily}`;
  if ('letterSpacing' in ctx) {
    const rawSpacing = (comp.letterSpacing && comp.letterSpacing !== 'normal') ? comp.letterSpacing : '0px';
    try {
      ctx.letterSpacing = rawSpacing;
    } catch (_) {}
  }
}

// Pre-cached ratio lookup per line at stable word boundaries using WeakMap to prevent object pollution and serialization anomalies
const lineRatioCache = new WeakMap();

/**
 * Calculates microsecond-accurate karaoke progress percentage (0-100)
 * supporting nested character/word sync points, in-line pauses, and RTL text.
 * Uses continuous word-boundary interpolation so Persian ligatures are never
 * split mid-word, producing a silky-smooth 60+ FPS slide animation.
 */
export function calculateKaraokeProgress(line, curTime, nextLineTime, songDuration, ctx) {
  try {
    if (!line) return 0;
    const start = typeof line.time === 'number' ? line.time : parseFloat(line.time) || 0;
    const rawEnd = line.endTime ? (typeof line.endTime === 'number' ? line.endTime : parseFloat(line.endTime)) : null;
    const end = rawEnd || (nextLineTime && nextLineTime > start ? nextLineTime : (songDuration && songDuration > start ? Math.min(start + 5, songDuration) : start + 3));

    if (curTime <= start) return 0;
    if (curTime >= end) return 100;

    const pts = Array.isArray(line.syncPoints) && line.syncPoints.length > 0 ? line.syncPoints : null;

    // Fallback to smooth linear line progression if no syncPoints or line is instrumental
    if (!pts || pts.length === 0 || line.isInstrumental || isInstrumentalText(line.text)) {
      const lineDur = Math.max(0.2, end - start);
      return Math.min(100, Math.max(0, ((curTime - start) / lineDur) * 100));
    }

    const text = line.text || '';
    const totalChars = Math.max(1, text.length);

    const firstPtTime = (pts[0] && typeof pts[0].time === 'number') ? pts[0].time : (pts[0] ? parseFloat(pts[0].time) : 0) || start;
    if (curTime < firstPtTime) return 0;

    const lastPt = pts[pts.length - 1];
    const lastEnd = (lastPt && typeof lastPt.endTime === 'number' ? lastPt.endTime : (lastPt ? parseFloat(lastPt.endTime) : 0)) ||
                    (lastPt && typeof lastPt.time === 'number' ? lastPt.time : (lastPt ? parseFloat(lastPt.time) : 0)) || end;
    if (curTime >= lastEnd) return 100;

    // Resolve ratio Map safely via WeakMap (handles frozen, cloned, or serialized line objects)
    const fontKey = ctx ? ctx.font : 'default';
    let ratioMap = null;
    if (typeof line === 'object' && line !== null) {
      const cached = lineRatioCache.get(line);
      if (cached && cached.fontKey === fontKey && cached.map instanceof Map) {
        ratioMap = cached.map;
      } else {
        ratioMap = new Map();
        try {
          lineRatioCache.set(line, { fontKey, map: ratioMap });
        } catch (_) {}
      }
    } else {
      ratioMap = new Map();
    }

    const getCharRatio = (charIdx) => {
      const c = Math.min(totalChars, Math.max(0, charIdx));
      if (c === 0) return 0;
      if (c >= totalChars) return 1;
      if (ratioMap && typeof ratioMap.has === 'function' && ratioMap.has(c)) {
        return ratioMap.get(c);
      }

      let ratio = c / totalChars;
      if (ctx && text) {
        try {
          const fullW = ctx.measureText(text).width;
          if (fullW > 0) {
            const subW = ctx.measureText(text.slice(0, c)).width;
            ratio = Math.min(1, Math.max(0, subW / fullW));
          }
        } catch (_) {}
      }
      if (ratioMap && typeof ratioMap.set === 'function') {
        ratioMap.set(c, ratio);
      }
      return ratio;
    };

    // Find active sync point or pause zone
    for (let k = 0; k < pts.length; k++) {
      const pt = pts[k];
      if (!pt) continue;
      const ptStart = typeof pt.time === 'number' ? pt.time : parseFloat(pt.time) || 0;
      const nextPt = k < pts.length - 1 ? pts[k + 1] : null;
      const nextPtStart = nextPt ? (typeof nextPt.time === 'number' ? nextPt.time : parseFloat(nextPt.time) || lastEnd) : lastEnd;
      const ptEnd = (typeof pt.endTime === 'number' ? pt.endTime : parseFloat(pt.endTime)) || nextPtStart;

      const charStart = typeof pt.charIndex === 'number' ? pt.charIndex : 0;
      const charEnd = (nextPt && typeof nextPt.charIndex === 'number') ? nextPt.charIndex : totalChars;

      if (pt.isPause) {
        // In-line pause zone: vocal progress is frozen at the pause position
        if (curTime >= ptStart && curTime <= ptEnd) {
          return Math.min(100, Math.max(0, getCharRatio(charStart) * 100));
        }
      } else if (curTime >= ptStart && curTime <= ptEnd) {
        // Actively singing this word: continuous float interpolation between word boundaries
        const wordDur = Math.max(0.02, ptEnd - ptStart);
        const frac = Math.min(1, Math.max(0, (curTime - ptStart) / wordDur));
        const rStart = getCharRatio(charStart);
        const rEnd = getCharRatio(charEnd);
        const progressRatio = rStart + frac * (rEnd - rStart);
        return Math.min(100, Math.max(0, progressRatio * 100));
      } else if (nextPt && curTime > ptEnd && curTime < nextPtStart) {
        // Inter-word vocal pause: maintain smooth progress frozen at completion of current word
        return Math.min(100, Math.max(0, getCharRatio(charEnd) * 100));
      }
    }

    // If time reached or exceeded the end of the last word
    return 100;
  } catch (err) {
    console.error('Error calculating karaoke progress:', err);
    return 0;
  }
}

/**
 * Calculates which words a pause timestamp falls between in a lyric line.
 * Automatically computes appropriate charIndex and descriptive labels for visual UI.
 */
export function calculatePauseWordPosition(lineText, syncPoints, pauseTime) {
  if (!lineText || typeof lineText !== 'string' || lineText.trim() === '') {
    return { slot: 0, charIndex: 0, prevWord: null, nextWord: null, badgeLabel: null };
  }

  // 1. Extract words from line text
  const words = [];
  const reg = /\S+/gu;
  let m;
  while ((m = reg.exec(lineText)) !== null) {
    words.push({ text: m[0], charIndex: m.index, endCharIndex: m.index + m[0].length });
  }

  if (words.length === 0) {
    return { slot: 0, charIndex: 0, prevWord: null, nextWord: null, badgeLabel: null };
  }

  // 2. Map word points (non-pauses) to words
  const wordPts = (Array.isArray(syncPoints) ? syncPoints : [])
    .filter((p) => p && !p.isPause && typeof p.time === 'number')
    .sort((a, b) => a.time - b.time);

  const wordTimes = words.map((w, idx) => {
    const matchByChar = wordPts.find((p) => typeof p.charIndex === 'number' && Math.abs(p.charIndex - w.charIndex) <= 1);
    if (matchByChar) return matchByChar.time;
    if (wordPts[idx]) return wordPts[idx].time;
    return null;
  });

  // Interpolate missing timestamps
  let knownTime = 0;
  for (let i = 0; i < words.length; i++) {
    if (wordTimes[i] !== null) {
      knownTime = wordTimes[i];
    } else {
      knownTime += 0.35;
      wordTimes[i] = knownTime;
    }
  }

  // 3. Determine slot relative to words
  if (pauseTime < wordTimes[0]) {
    return {
      slot: -1,
      charIndex: 0,
      prevWord: null,
      nextWord: words[0].text,
      badgeLabel: `Before "${words[0].text}"`
    };
  }

  let slot = words.length - 1;
  for (let i = 0; i < words.length - 1; i++) {
    if (pauseTime >= wordTimes[i] && pauseTime < wordTimes[i + 1]) {
      slot = i;
      break;
    }
  }

  if (slot < words.length - 1) {
    return {
      slot,
      charIndex: words[slot].endCharIndex,
      prevWord: words[slot].text,
      nextWord: words[slot + 1].text,
      badgeLabel: `"${words[slot].text}" ↔ "${words[slot + 1].text}"`
    };
  }

  return {
    slot: words.length - 1,
    charIndex: words[words.length - 1].endCharIndex,
    prevWord: words[words.length - 1].text,
    nextWord: null,
    badgeLabel: `After "${words[words.length - 1].text}"`
  };
}

/**
 * Migrates legacy syncPoints containing separate 'isPause' nodes into the
 * single-node-type architecture where each node is a word with a default 'time'
 * and an optional earlier 'endTime' defining any inter-word pause segment.
 */
export function migrateLegacySyncPoints(syncPoints) {
  if (!Array.isArray(syncPoints) || syncPoints.length === 0) return [];
  const cleaned = [];
  for (let i = 0; i < syncPoints.length; i++) {
    const pt = syncPoints[i];
    if (!pt) continue;
    if (pt.isPause) {
      if (cleaned.length > 0 && typeof pt.time === 'number') {
        const prev = cleaned[cleaned.length - 1];
        if (typeof prev.endTime !== 'number' || prev.endTime > pt.time) {
          prev.endTime = pt.time;
        }
      }
      continue;
    }
    const copy = { ...pt };
    delete copy.isPause;
    delete copy.duration;
    cleaned.push(copy);
  }

  // Clear accidental/phonetic micro-gap endTimes (< 0.18s) before non-terminal words
  // so legacy AI alignment micro-gaps are never misinterpreted as intentional pauses
  for (let i = 0; i < cleaned.length - 1; i++) {
    const cur = cleaned[i];
    const nxt = cleaned[i + 1];
    if (typeof cur.endTime === 'number' && typeof nxt.time === 'number') {
      if (cur.endTime > nxt.time - 0.18) {
        delete cur.endTime;
      }
    }
  }

  return cleaned;
}

/**
 * Structures a lyric line into clean word entities and inter-word pauses.
 * In this single-node architecture:
 * 1. syncPoints contains only words: each word has a default 'time' (start of word).
 * 2. An optional (earlier) 'endTime' on word[i] defines a paused segment [word[i].endTime, word[i+1].time].
 * 3. Pause duration is automatically computed (no separate pause node).
 */
export function getLineWordPairsWithPauses(lineText, syncPoints, lineStart = 0, lineEnd = null) {
  if (!lineText || typeof lineText !== 'string' || lineText.trim() === '') {
    return { words: [], pauses: [] };
  }

  // 1. Extract words from line text
  const rawWords = [];
  const reg = /\S+/gu;
  let m;
  while ((m = reg.exec(lineText)) !== null) {
    rawWords.push({
      text: m[0],
      charIndex: m.index,
      endCharIndex: m.index + m[0].length
    });
  }

  if (rawWords.length === 0) {
    return { words: [], pauses: [] };
  }

  // 2. Migrate any legacy points if present to ensure single-node structure
  const rawPts = Array.isArray(syncPoints) ? syncPoints : [];
  const pts = migrateLegacySyncPoints(rawPts);

  // 3. Associate each word with its sync point
  const hasCharIndices = pts.some((p) => typeof p.charIndex === 'number');
  const usedPtIndices = new Set();

  const words = rawWords.map((w, idx) => {
    let ptIdx = -1;
    if (hasCharIndices) {
      ptIdx = pts.findIndex((p, pI) => !usedPtIndices.has(pI) && typeof p.charIndex === 'number' && Math.abs(p.charIndex - w.charIndex) <= 1);
    } else {
      // Legacy points without char indices: match by text or position
      ptIdx = pts.findIndex((p, pI) => !usedPtIndices.has(pI) && p.text === w.text);
      if (ptIdx === -1 && pts[idx] && !usedPtIndices.has(idx)) {
        ptIdx = idx;
      }
    }

    const pt = ptIdx !== -1 ? pts[ptIdx] : null;
    if (ptIdx !== -1) usedPtIndices.add(ptIdx);
    const actualPtIdx = pt ? pts.indexOf(pt) : -1;

    const time = pt && typeof pt.time === 'number' ? pt.time : (pt ? parseFloat(pt.time) || null : null);
    const endTime = pt && typeof pt.endTime === 'number' ? pt.endTime : (pt && pt.endTime ? parseFloat(pt.endTime) || null : null);

    return {
      index: idx,
      text: w.text,
      charIndex: w.charIndex,
      endCharIndex: w.endCharIndex,
      ptIndex: actualPtIdx,
      pointId: pt ? (pt.id || pt._id || `word_${idx}`) : `word_${idx}`,
      time,
      endTime,
      hasPoint: pt !== null && time !== null
    };
  });

  // 4. Identify paused segments between pairs of words
  // A paused segment exists if and only if word[i] has an optional earlier endTime
  // with a musically perceptible gap (>= 0.18s) before the next word
  const pauses = [];
  for (let i = 0; i < words.length - 1; i++) {
    const wCur = words[i];
    const wNext = words[i + 1];
    if (!wCur.hasPoint || !wNext.hasPoint) continue;

    if (typeof wCur.endTime === 'number' && wCur.endTime <= (wNext.time - 0.18)) {
      const pStart = wCur.endTime;
      const pEnd = wNext.time;
      const pDur = Math.max(0.05, Math.round((pEnd - pStart) * 100) / 100);

      pauses.push({
        id: `pause_${i}_${i + 1}`,
        slot: i,
        prevWordIndex: i,
        nextWordIndex: i + 1,
        prevWord: wCur,
        nextWord: wNext,
        startTime: pStart,
        endTime: pEnd,
        duration: pDur,
        ptIndex: wCur.ptIndex,
        isExplicit: true,
        label: `"${wCur.text}" ↔ "${wNext.text}"`
      });
    }
  }

  return { words, pauses };
}
