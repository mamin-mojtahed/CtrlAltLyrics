import React, { useRef } from 'react';

export default function Resizer({ id, className, title, onDrag, onReset, direction = 'horizontal' }) {
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef(null);

  const handlePointerDown = (e) => {
    isDraggingRef.current = true;
    lastPosRef.current = direction === 'vertical' ? e.clientY : e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDraggingRef.current || lastPosRef.current === null) return;
    const currentPos = direction === 'vertical' ? e.clientY : e.clientX;
    const delta = currentPos - lastPosRef.current;
    lastPosRef.current = currentPos;
    if (onDrag) onDrag(delta, e);
  };

  const handlePointerUp = (e) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      lastPosRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(err){}
    }
  };

  return (
    <div
      id={id}
      className={`panel-border-resizer ${className || ''}`}
      aria-hidden="true"
      title={title || 'Drag border to resize, double-click to reset'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={onReset}
    />
  );
}
