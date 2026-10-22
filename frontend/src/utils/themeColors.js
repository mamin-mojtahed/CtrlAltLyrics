// Theme color extraction & time formatting utilities

export function getHighResAlbumArt(url) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb\./i, '/600x600bb.').replace(/\/\d+x\d+\./i, '/600x600.');
}

export function formatTime(seconds) {
  if (seconds === undefined || seconds === null || isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function formatCentiseconds(totalSeconds) {
  if (totalSeconds === undefined || totalSeconds === null || isNaN(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const totalCs = Math.floor(totalSeconds * 100 + 1e-6);
  const m = Math.floor(totalCs / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function parseCentiseconds(str) {
  if (typeof str === 'number') return Math.max(0, Math.round(str * 100) / 100);
  if (!str || typeof str !== 'string') return 0;
  str = str.trim().replace(',', '.');
  if (str.includes(':')) {
    const parts = str.split(':');
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return Math.max(0, Math.round((m * 60 + s) * 100) / 100);
  }
  const s = parseFloat(str) || 0;
  return Math.max(0, Math.round(s * 100) / 100);
}

export function formatTimeDisplay(currentTime, duration) {
  if (!duration || isNaN(duration) || duration <= 0) {
    return '--:-- / --:--';
  }
  const curStr = (currentTime !== undefined && currentTime !== null && !isNaN(currentTime)) ? formatTime(currentTime) : '0:00';
  const durStr = formatTime(duration);
  return `${curStr} / ${durStr}`;
}

export function applyDashboardThemeColors(bgPrimary, bgSecondary, accent) {
  const bgPrimStr = `rgb(${bgPrimary.r}, ${bgPrimary.g}, ${bgPrimary.b})`;
  const bgSecStr = `rgb(${bgSecondary.r}, ${bgSecondary.g}, ${bgSecondary.b})`;
  const accentStr = `rgb(${accent.r}, ${accent.g}, ${accent.b})`;
  const accentHoverStr = `rgb(${Math.max(0, Math.round(accent.r * 0.85))}, ${Math.max(0, Math.round(accent.g * 0.85))}, ${Math.max(0, Math.round(accent.g * 0.85))})`;
  const accentGlowStr = `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.35)`;
  const panelBgStr = `rgba(${Math.round(bgPrimary.r * 1.3 + 10)}, ${Math.round(bgPrimary.g * 1.3 + 12)}, ${Math.round(bgPrimary.b * 1.3 + 18)}, 0.65)`;

  const root = document.documentElement;
  root.style.setProperty('--bg-color', bgPrimStr);
  root.style.setProperty('--dashboard-bg-primary', bgPrimStr);
  root.style.setProperty('--dashboard-bg-secondary', bgSecStr);
  root.style.setProperty('--accent', accentStr);
  root.style.setProperty('--accent-hover', accentHoverStr);
  root.style.setProperty('--accent-glow', accentGlowStr);
  root.style.setProperty('--panel-bg', panelBgStr);
}

export function extractColorsFromSongCover(imgUrl) {
  if (!imgUrl || imgUrl.includes('placeholder') || imgUrl.includes('logo')) {
    applyDashboardThemeColors({ r: 15, g: 17, b: 26 }, { r: 30, g: 27, b: 75 }, { r: 99, g: 102, b: 241 });
    return;
  }

  const img = new Image();
  img.crossOrigin = 'Anonymous';
  img.src = imgUrl;

  img.onload = () => {
    try {
      const offCanvas = document.createElement('canvas');
      const offCtx = offCanvas.getContext('2d');
      offCanvas.width = 32;
      offCanvas.height = 32;
      offCtx.drawImage(img, 0, 0, 32, 32);

      const imageData = offCtx.getImageData(0, 0, 32, 32).data;
      let totalR = 0, totalG = 0, totalB = 0, count = 0;
      let maxSat = -1;
      let vibrantColor = { r: 99, g: 102, b: 241 };

      for (let i = 0; i < imageData.length; i += 4) {
        const r = imageData[i];
        const g = imageData[i + 1];
        const b = imageData[i + 2];
        const a = imageData[i + 3];

        if (a < 128) continue;

        totalR += r;
        totalG += g;
        totalB += b;
        count++;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 510;
        const sat = max === 0 ? 0 : (max - min) / max;

        if (sat > maxSat && l > 0.2 && l < 0.85) {
          maxSat = sat;
          vibrantColor = { r, g, b };
        }
      }

      if (count > 0) {
        const avgR = Math.round(totalR / count);
        const avgG = Math.round(totalG / count);
        const avgB = Math.round(totalB / count);

        const darkColor = {
          r: Math.round(avgR * 0.25),
          g: Math.round(avgG * 0.25),
          b: Math.round(avgB * 0.25)
        };

        const secondaryBg = {
          r: Math.round(vibrantColor.r * 0.25),
          g: Math.round(vibrantColor.g * 0.25),
          b: Math.round(vibrantColor.b * 0.25)
        };

        applyDashboardThemeColors(darkColor, secondaryBg, vibrantColor);
      }
    } catch (e) {
      applyDashboardThemeColors({ r: 15, g: 17, b: 26 }, { r: 30, g: 27, b: 75 }, { r: 99, g: 102, b: 241 });
    }
  };

  img.onerror = () => {
    applyDashboardThemeColors({ r: 15, g: 17, b: 26 }, { r: 30, g: 27, b: 75 }, { r: 99, g: 102, b: 241 });
  };
}
