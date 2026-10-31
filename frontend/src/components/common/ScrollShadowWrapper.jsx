import React, { useRef } from 'react';
import { useScrollShadows } from '../../hooks/useScrollShadows';

/**
 * Reusable wrapper that provides upper and lower border shadow overlays
 * indicating whether there is content remaining to scroll to.
 */
export default function ScrollShadowWrapper({
  children,
  className = '',
  style = {},
  scrollRef: customScrollRef,
  topShadow = true,
  bottomShadow = true,
  shadowSize,
  threshold = 2,
  bottomThreshold = 2,
  ...rest
}) {
  const wrapperRef = useRef(null);
  const internalScrollRef = useRef(null);

  useScrollShadows(customScrollRef || internalScrollRef, {
    wrapperRef,
    threshold,
    bottomThreshold,
    findScrollElement: (wrapper) =>
      wrapper.querySelector(
        '.queue-list, .library-list, .sync-editor-list, .search-results-popup, .modal-body, #componentManagerBody, .stem-editor-workspace, [data-scrollable="true"]'
      ) || wrapper.firstElementChild
  });

  const wrapperStyle = shadowSize
    ? { ...style, '--scroll-shadow-size': typeof shadowSize === 'number' ? `${shadowSize}px` : shadowSize }
    : style;

  return (
    <div
      ref={wrapperRef}
      className={`scroll-shadow-wrapper ${className}`}
      style={wrapperStyle}
      {...rest}
    >
      {topShadow && <div className="scroll-shadow-overlay scroll-shadow-top" aria-hidden="true" />}
      {React.isValidElement(children)
        ? React.cloneElement(children, {
            ref: (node) => {
              internalScrollRef.current = node;
              const childRef = children.props?.ref || children.ref;
              if (typeof childRef === 'function') {
                childRef(node);
              } else if (childRef && typeof childRef === 'object') {
                childRef.current = node;
              }
            }
          })
        : children}
      {bottomShadow && <div className="scroll-shadow-overlay scroll-shadow-bottom" aria-hidden="true" />}
    </div>
  );
}
