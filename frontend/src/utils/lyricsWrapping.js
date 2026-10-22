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
