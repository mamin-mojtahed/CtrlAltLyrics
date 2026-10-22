import { useEffect } from 'react';

export function useDisplayResizer() {
  useEffect(() => {
    const displayContainer = document.getElementById('displayContainer');
    const resizerDisplaySidebar = document.getElementById('resizerDisplaySidebar');
    if (!displayContainer || !resizerDisplaySidebar) return;

    // Restore saved splits from localStorage
    try {
      const savedSidebarWidth = localStorage.getItem('ctrlaltlyrics_resizer_sidebar_width');
      if (savedSidebarWidth) {
        const p = parseFloat(savedSidebarWidth);
        if (!isNaN(p) && p >= 18 && p <= 65) {
          displayContainer.style.setProperty('--sidebar-width', `${p}%`);
        }
      }

      const savedSidebarMobileH = localStorage.getItem('ctrlaltlyrics_resizer_sidebar_mobile_h');
      if (savedSidebarMobileH) {
        const h = parseFloat(savedSidebarMobileH);
        if (!isNaN(h) && h >= 100) {
          displayContainer.style.setProperty('--sidebar-sheet-height', `${h}px`);
        }
      }
    } catch (err) {
      console.warn('Could not restore display resizer:', err);
    }

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let movedEnough = false;

    const onReset = () => {
      displayContainer.style.removeProperty('--sidebar-width');
      displayContainer.style.removeProperty('--sidebar-sheet-height');
      try {
        localStorage.removeItem('ctrlaltlyrics_resizer_sidebar_width');
        localStorage.removeItem('ctrlaltlyrics_resizer_sidebar_mobile_h');
      } catch (_) {}
      window.dispatchEvent(new Event('resize'));
    };

    const onDrag = (e) => {
      const isMobile = window.innerWidth <= 768;
      if (isMobile) {
        const sheetHeight = window.innerHeight - e.clientY;
        const minH = 120;
        const maxH = window.innerHeight - 100;
        const clampedH = Math.max(minH, Math.min(maxH, sheetHeight));
        displayContainer.style.setProperty('--sidebar-sheet-height', `${clampedH}px`);
        try {
          localStorage.setItem('ctrlaltlyrics_resizer_sidebar_mobile_h', clampedH.toFixed(0));
        } catch (_) {}
      } else {
        const containerRect = displayContainer.getBoundingClientRect();
        const sidebarWidth = e.clientX - containerRect.left;
        let sidebarPercent = (sidebarWidth / containerRect.width) * 100;
        sidebarPercent = Math.max(18, Math.min(65, sidebarPercent));
        displayContainer.style.setProperty('--sidebar-width', `${sidebarPercent}%`);
        try {
          localStorage.setItem('ctrlaltlyrics_resizer_sidebar_width', sidebarPercent.toFixed(2));
        } catch (_) {}
      }
      window.dispatchEvent(new Event('resize'));
    };

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
        resizerDisplaySidebar.setPointerCapture(e.pointerId);
      } catch (_) {}

      const isMobile = window.innerWidth <= 768;
      document.body.classList.add(isMobile ? 'is-resizing-row' : 'is-resizing-col');
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
        resizerDisplaySidebar.releasePointerCapture(e.pointerId);
      } catch (_) {}
      document.body.classList.remove('is-resizing-row', 'is-resizing-col');
    };

    const handleDblClick = (e) => {
      e.preventDefault();
      onReset();
    };

    resizerDisplaySidebar.addEventListener('pointerdown', handlePointerDown);
    resizerDisplaySidebar.addEventListener('pointermove', handlePointerMove);
    resizerDisplaySidebar.addEventListener('pointerup', stopDragging);
    resizerDisplaySidebar.addEventListener('pointercancel', stopDragging);
    resizerDisplaySidebar.addEventListener('dblclick', handleDblClick);

    return () => {
      resizerDisplaySidebar.removeEventListener('pointerdown', handlePointerDown);
      resizerDisplaySidebar.removeEventListener('pointermove', handlePointerMove);
      resizerDisplaySidebar.removeEventListener('pointerup', stopDragging);
      resizerDisplaySidebar.removeEventListener('pointercancel', stopDragging);
      resizerDisplaySidebar.removeEventListener('dblclick', handleDblClick);
      document.body.classList.remove('is-resizing-row', 'is-resizing-col');
    };
  }, []);
}
