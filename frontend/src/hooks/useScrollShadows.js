import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * Custom hook to detect whether a scrollable container has content left to scroll to
 * at its upper and/or lower borders, dynamically managing shadow state and CSS classes.
 *
 * @param {React.RefObject|HTMLElement|Function} scrollTarget - Ref or element of the scrollable container
 * @param {Object} options
 * @param {React.RefObject|HTMLElement} [options.wrapperRef] - Target element to receive .has-shadow-top/.has-shadow-bottom classes (defaults to scrollTarget)
 * @param {Function} [options.findScrollElement] - Optional resolver to locate the scrollable child from wrapper
 * @param {number} [options.threshold=2] - Pixel threshold to trigger top shadow
 * @param {number} [options.bottomThreshold=2] - Pixel threshold to trigger bottom shadow
 * @param {Function} [options.onShadowChange] - Callback with { hasTop, hasBottom }
 * @param {boolean} [options.autoClasses=true] - Whether to automatically toggle CSS classes
 */
export function useScrollShadows(scrollTarget, options = {}) {
  const {
    wrapperRef,
    findScrollElement,
    threshold = 2,
    bottomThreshold = 2,
    onShadowChange,
    autoClasses = true
  } = options;

  const [shadows, setShadows] = useState({ hasTop: false, hasBottom: false });
  const shadowsRef = useRef(shadows);
  shadowsRef.current = shadows;

  const onShadowChangeRef = useRef(onShadowChange);
  onShadowChangeRef.current = onShadowChange;

  const resolveScrollElement = useCallback(() => {
    if (!scrollTarget) return null;
    if (typeof scrollTarget === 'function') return scrollTarget();
    if (scrollTarget.current) return scrollTarget.current;
    if (scrollTarget instanceof HTMLElement) return scrollTarget;
    if (findScrollElement && wrapperRef?.current) {
      return findScrollElement(wrapperRef.current);
    }
    return null;
  }, [scrollTarget, findScrollElement, wrapperRef]);

  useEffect(() => {
    let animFrameId = null;
    let retryId = null;
    let cleanupFn = null;

    let scrollEl = resolveScrollElement();
    if (!scrollEl && wrapperRef?.current && findScrollElement) {
      scrollEl = findScrollElement(wrapperRef.current);
    }

    if (scrollEl) {
      cleanupFn = setupListeners(scrollEl);
    } else {
      // Retry on next frame in case child ref is delayed
      retryId = requestAnimationFrame(() => {
        const retryEl = resolveScrollElement() || (wrapperRef?.current && findScrollElement ? findScrollElement(wrapperRef.current) : null);
        if (retryEl) {
          cleanupFn = setupListeners(retryEl);
        }
      });
    }

    return () => {
      if (retryId) cancelAnimationFrame(retryId);
      if (cleanupFn) cleanupFn();
    };

    function setupListeners(el) {
      if (!el) return;

      const checkScroll = () => {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        animFrameId = requestAnimationFrame(() => {
          if (!el) return;
          const { scrollTop, scrollHeight, clientHeight } = el;
          const maxScroll = Math.max(0, scrollHeight - clientHeight);
          const canScroll = maxScroll > 1;

          const hasTop = canScroll && scrollTop > threshold;
          const hasBottom = canScroll && scrollTop < (maxScroll - bottomThreshold);

          const targetClassHolder = (wrapperRef && wrapperRef.current) || el;
          if (autoClasses && targetClassHolder) {
            targetClassHolder.classList.toggle('has-shadow-top', hasTop);
            targetClassHolder.classList.toggle('has-shadow-bottom', hasBottom);
          }

          if (shadowsRef.current.hasTop !== hasTop || shadowsRef.current.hasBottom !== hasBottom) {
            const next = { hasTop, hasBottom };
            shadowsRef.current = next;
            setShadows(next);
            if (typeof onShadowChangeRef.current === 'function') {
              onShadowChangeRef.current(next);
            }
          }
        });
      };

      // Initial check
      checkScroll();

      // Listen to scroll events on container
      el.addEventListener('scroll', checkScroll, { passive: true });

      // Observe size changes on scroll container and its wrapper
      let ro = null;
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => checkScroll());
        ro.observe(el);
        if (wrapperRef?.current && wrapperRef.current !== el) {
          ro.observe(wrapperRef.current);
        }
      }

      // Observe DOM mutations inside container (items added/removed)
      let mo = null;
      if (typeof MutationObserver !== 'undefined') {
        mo = new MutationObserver(() => checkScroll());
        mo.observe(el, { childList: true, subtree: true, attributes: false });
      }

      // Window resize
      window.addEventListener('resize', checkScroll, { passive: true });

      return () => {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        el.removeEventListener('scroll', checkScroll);
        if (ro) ro.disconnect();
        if (mo) mo.disconnect();
        window.removeEventListener('resize', checkScroll);
      };
    }
  }, [resolveScrollElement, wrapperRef, findScrollElement, threshold, bottomThreshold, autoClasses]);

  return shadows;
}
