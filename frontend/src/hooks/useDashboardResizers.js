import { useEffect } from 'react';

export function useDashboardResizers() {
  useEffect(() => {
    const app = document.getElementById('app');
    const upperPanel = document.querySelector('.upper-panel');
    const lowerContainer = document.querySelector('.lower-container');
    const resizerDashVertical = document.getElementById('resizerDashVertical');
    const resizerUpperSplit = document.getElementById('resizerUpperSplit');
    const resizerLowerSplit = document.getElementById('resizerLowerSplit');

    if (!app) return;

    // Restore saved splits from localStorage on mount
    try {
      const savedDashVert = localStorage.getItem('ctrlaltlyrics_resizer_dash_vert');
      if (savedDashVert && !['50', '50.00', '66.67', '66.66', '66.6667', '75', '75.00'].includes(savedDashVert)) {
        const p = parseFloat(savedDashVert);
        if (!isNaN(p) && p >= 15 && p <= 85) {
          app.style.setProperty('--upper-panel-flex', `${p} 1 0px`);
          app.style.setProperty('--lower-panel-flex', `${100 - p} 1 0px`);
        }
      } else {
        // Clear cached default/legacy values so CSS 75% / 25% (3/4 ratio from up) takes effect
        app.style.removeProperty('--upper-panel-flex');
        app.style.removeProperty('--lower-panel-flex');
        if (['50', '50.00', '66.67', '66.66', '66.6667'].includes(savedDashVert)) {
          try {
            localStorage.removeItem('ctrlaltlyrics_resizer_dash_vert');
          } catch (_) {}
        }
      }

      const savedUpperSplit = localStorage.getItem('ctrlaltlyrics_resizer_upper_split');
      if (savedUpperSplit) {
        const p = parseFloat(savedUpperSplit);
        if (!isNaN(p) && p >= 15 && p <= 85) {
          app.style.setProperty('--upper-left-flex', `${p} 1 0px`);
          app.style.setProperty('--upper-right-flex', `${100 - p} 1 0px`);
        }
      }

      const savedUpperMobileH = localStorage.getItem('ctrlaltlyrics_resizer_upper_mobile_h');
      if (savedUpperMobileH) {
        const h = parseFloat(savedUpperMobileH);
        if (!isNaN(h) && h >= 60) {
          app.style.setProperty('--upper-left-height', `${h}px`);
        }
      }

      const savedLowerSplit = localStorage.getItem('ctrlaltlyrics_resizer_lower_split');
      if (savedLowerSplit) {
        const p = parseFloat(savedLowerSplit);
        if (!isNaN(p) && p >= 20 && p <= 80) {
          app.style.setProperty('--audio-controls-flex', `${p} 1 0px`);
          app.style.setProperty('--mixer-card-flex', `${100 - p} 1 0px`);
          app.style.setProperty('--mixer-card-width', 'auto');
          app.style.setProperty('--mixer-card-max-width', 'none');
        }
      }
    } catch (err) {
      console.warn('Could not restore dashboard resizers:', err);
    }

    // Helper to attach pointer drag + double tap/click reset
    function attachResizer(el, { getDirection, onDrag, onReset }) {
      if (!el) return;
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let lastTapTime = 0;
      let lastTapX = 0;
      let lastTapY = 0;
      let movedEnough = false;

      const handlePointerDown = (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;

        const now = Date.now();
        const tapDist = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY);
        if (now - lastTapTime < 380 && tapDist < 25) {
          e.preventDefault();
          onReset();
          lastTapTime = 0;
          return;
        }
        lastTapTime = now;
        lastTapX = e.clientX;
        lastTapY = e.clientY;

        isDragging = true;
        movedEnough = false;
        startX = e.clientX;
        startY = e.clientY;

        try {
          el.setPointerCapture(e.pointerId);
        } catch (_) {}

        const dir = typeof getDirection === 'function' ? getDirection() : 'col';
        document.body.classList.add(dir === 'row' ? 'is-resizing-row' : 'is-resizing-col');
      };

      const handlePointerMove = (e) => {
        if (!isDragging) return;
        if (!movedEnough && Math.hypot(e.clientX - startX, e.clientY - startY) > 3) {
          movedEnough = true;
        }
        if (movedEnough) {
          onDrag(e);
        }
      };

      const stopDragging = (e) => {
        if (!isDragging) return;
        isDragging = false;
        try {
          el.releasePointerCapture(e.pointerId);
        } catch (_) {}
        document.body.classList.remove('is-resizing-row', 'is-resizing-col');
      };

      const handleDblClick = (e) => {
        e.preventDefault();
        onReset();
      };

      el.addEventListener('pointerdown', handlePointerDown);
      el.addEventListener('pointermove', handlePointerMove);
      el.addEventListener('pointerup', stopDragging);
      el.addEventListener('pointercancel', stopDragging);
      el.addEventListener('dblclick', handleDblClick);

      return () => {
        el.removeEventListener('pointerdown', handlePointerDown);
        el.removeEventListener('pointermove', handlePointerMove);
        el.removeEventListener('pointerup', stopDragging);
        el.removeEventListener('pointercancel', stopDragging);
        el.removeEventListener('dblclick', handleDblClick);
      };
    }

    // 1. Vertical Split: Upper Panel vs Lower Panel
    const cleanupDashVert = attachResizer(resizerDashVertical, {
      getDirection: () => 'row',
      onDrag: (e) => {
        const appRect = app.getBoundingClientRect();
        const minUpperPx = 140;
        const minLowerPx = 100;
        let upperHeight = e.clientY - appRect.top;
        upperHeight = Math.max(minUpperPx, Math.min(appRect.height - minLowerPx, upperHeight));
        let upperPercent = (upperHeight / appRect.height) * 100;
        upperPercent = Math.max(15, Math.min(85, upperPercent));
        if (Math.abs(upperPercent - 75) < 1.5) {
          upperPercent = 75;
        }
        const lowerPercent = 100 - upperPercent;
        app.style.setProperty('--upper-panel-flex', `${upperPercent} 1 0px`);
        app.style.setProperty('--lower-panel-flex', `${lowerPercent} 1 0px`);
        try {
          localStorage.setItem('ctrlaltlyrics_resizer_dash_vert', upperPercent.toFixed(2));
        } catch (_) {}
      },
      onReset: () => {
        app.style.removeProperty('--upper-panel-flex');
        app.style.removeProperty('--lower-panel-flex');
        app.style.removeProperty('--upper-panel-height');
        app.style.removeProperty('--lower-panel-height');
        try {
          localStorage.removeItem('ctrlaltlyrics_resizer_dash_vert');
        } catch (_) {}
      }
    });

    // 2. Upper Split: Search/Queue vs Library
    const cleanupUpperSplit = attachResizer(resizerUpperSplit, {
      getDirection: () => (window.innerWidth <= 900 ? 'row' : 'col'),
      onDrag: (e) => {
        if (!upperPanel) return;
        const upperRect = upperPanel.getBoundingClientRect();
        if (window.innerWidth <= 900) {
          const upperLeft = upperPanel.querySelector('.upper-left');
          const leftRect = upperLeft ? upperLeft.getBoundingClientRect() : upperRect;
          const leftHeight = e.clientY - leftRect.top;
          const minH = 70;
          const maxH = Math.max(minH, upperRect.height - 70);
          const clampedH = Math.max(minH, Math.min(maxH, leftHeight));
          app.style.setProperty('--upper-left-height', `${clampedH}px`);
          try {
            localStorage.setItem('ctrlaltlyrics_resizer_upper_mobile_h', clampedH.toFixed(0));
          } catch (_) {}
        } else {
          const leftWidth = e.clientX - upperRect.left;
          let leftPercent = (leftWidth / upperRect.width) * 100;
          leftPercent = Math.max(15, Math.min(85, leftPercent));
          const rightPercent = 100 - leftPercent;
          app.style.setProperty('--upper-left-flex', `${leftPercent} 1 0px`);
          app.style.setProperty('--upper-right-flex', `${rightPercent} 1 0px`);
          try {
            localStorage.setItem('ctrlaltlyrics_resizer_upper_split', leftPercent.toFixed(2));
          } catch (_) {}
        }
      },
      onReset: () => {
        app.style.removeProperty('--upper-left-flex');
        app.style.removeProperty('--upper-right-flex');
        app.style.removeProperty('--upper-left-height');
        try {
          localStorage.removeItem('ctrlaltlyrics_resizer_upper_split');
          localStorage.removeItem('ctrlaltlyrics_resizer_upper_mobile_h');
        } catch (_) {}
      }
    });

    // 3. Lower Split: Audio Controls vs Mixer Card
    const cleanupLowerSplit = attachResizer(resizerLowerSplit, {
      getDirection: () => 'col',
      onDrag: (e) => {
        if (!lowerContainer) return;
        const containerRect = lowerContainer.getBoundingClientRect();
        const minControlsPx = 180;
        const minMixerPx = 180;
        let controlsWidth = e.clientX - containerRect.left;
        controlsWidth = Math.max(minControlsPx, Math.min(containerRect.width - minMixerPx, controlsWidth));
        let controlsPercent = (controlsWidth / containerRect.width) * 100;
        controlsPercent = Math.max(20, Math.min(80, controlsPercent));
        const mixerPercent = 100 - controlsPercent;
        app.style.setProperty('--audio-controls-flex', `${controlsPercent} 1 0px`);
        app.style.setProperty('--mixer-card-flex', `${mixerPercent} 1 0px`);
        app.style.setProperty('--mixer-card-width', 'auto');
        app.style.setProperty('--mixer-card-max-width', 'none');
        try {
          localStorage.setItem('ctrlaltlyrics_resizer_lower_split', controlsPercent.toFixed(2));
        } catch (_) {}
      },
      onReset: () => {
        app.style.removeProperty('--audio-controls-flex');
        app.style.removeProperty('--mixer-card-flex');
        app.style.removeProperty('--mixer-card-width');
        app.style.removeProperty('--mixer-card-max-width');
        try {
          localStorage.removeItem('ctrlaltlyrics_resizer_lower_split');
        } catch (_) {}
      }
    });

    return () => {
      if (cleanupDashVert) cleanupDashVert();
      if (cleanupUpperSplit) cleanupUpperSplit();
      if (cleanupLowerSplit) cleanupLowerSplit();
      document.body.classList.remove('is-resizing-row', 'is-resizing-col');
    };
  }, []);
}
