import React, { useEffect, useRef, useState, memo } from 'react';
import socket from '../../services/socket';

function YouTubeBackgroundPlayer({
  youtubeId,
  isPlaying = false,
  isVisible = true,
  syncAnchorRef = null,
  seekTimestamp = null
}) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [hasError, setHasError] = useState(false);

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  const lastSeekTimeRef = useRef(0);
  const lastPausedTargetTimeRef = useRef(null);
  const prevSeekTimestampRef = useRef(seekTimestamp);

  // High-precision sync time retrieval from sync anchor
  const getCurrentSyncTime = () => {
    const anchor = syncAnchorRef?.current;
    if (!anchor) return 0;
    if (!anchor.isPlaying) return anchor.time || 0;
    const elapsed = (performance.now() - anchor.timestamp) / 1000;
    return Math.max(0, (anchor.time || 0) + elapsed);
  };

  const syncVideoPlayback = (targetTime, forceSeek = false) => {
    const v = videoRef.current;
    if (!v) return;

    try {
      const cur = v.currentTime || 0;
      const drift = Math.abs(cur - targetTime);

      if (forceSeek || drift > 0.45) {
        lastSeekTimeRef.current = performance.now();
        v.currentTime = targetTime;
      }

      if (isPlayingRef.current && isVisibleRef.current) {
        if (v.paused) {
          v.play().catch(() => {});
        }
      } else {
        if (!v.paused) {
          v.pause();
        }
      }
    } catch (e) {}
  };

  // Socket player command listener for seeks
  useEffect(() => {
    if (!youtubeId) return;

    const handlePlayerCommand = (cmd) => {
      const v = videoRef.current;
      if (!v) return;

      if (cmd && cmd.command === 'seek' && typeof cmd.time === 'number') {
        syncVideoPlayback(cmd.time, true);
        setHasPlaybackStarted(true);
      }
    };

    socket.on('player_command', handlePlayerCommand);
    return () => {
      socket.off('player_command', handlePlayerCommand);
    };
  }, [youtubeId]);

  // Periodic drift synchronization loop
  useEffect(() => {
    if (!youtubeId) return;

    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;

      const targetTime = getCurrentSyncTime();

      if (isPlayingRef.current && isVisibleRef.current) {
        if (v.paused) {
          v.play().catch(() => {});
        }
        const drift = Math.abs(v.currentTime - targetTime);
        if (drift > 0.6) {
          v.currentTime = targetTime;
        }
      } else if (isVisibleRef.current) {
        if (!v.paused) {
          v.pause();
        }
        // When paused, seek if user scrubbed or jumped lines
        if (lastPausedTargetTimeRef.current === null || Math.abs(targetTime - lastPausedTargetTimeRef.current) > 0.15) {
          lastPausedTargetTimeRef.current = targetTime;
          v.currentTime = targetTime;
          setHasPlaybackStarted(true);
        }
      }
    }, 150);

    return () => clearInterval(interval);
  }, [youtubeId]);

  // React immediately to play/pause state changes
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const targetTime = getCurrentSyncTime();
    lastPausedTargetTimeRef.current = isPlaying ? null : targetTime;
    syncVideoPlayback(targetTime, true);
  }, [isPlaying, isVisible]);

  // React immediately to explicit lyric line clicks
  useEffect(() => {
    if (seekTimestamp === null || seekTimestamp === undefined) {
      prevSeekTimestampRef.current = null;
      return;
    }
    if (seekTimestamp === prevSeekTimestampRef.current) {
      return;
    }
    prevSeekTimestampRef.current = seekTimestamp;

    syncVideoPlayback(seekTimestamp, true);
    setHasPlaybackStarted(true);
  }, [seekTimestamp]);

  // When metadata loads: seek to current sync position and play or pause
  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;

    v.muted = true;
    v.volume = 0;

    const startSeconds = getCurrentSyncTime();
    v.currentTime = startSeconds;

    if (isPlayingRef.current && isVisibleRef.current) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
    setHasPlaybackStarted(true);
  };

  const handleEnded = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    if (isPlayingRef.current && isVisibleRef.current) {
      v.play().catch(() => {});
    }
  };

  const handleError = (e) => {
    console.warn('[NativeVideoPlayer] Stream load error, trying fallback:', e);
    setHasError(true);
  };

  if (hasError || !youtubeId) {
    return null;
  }

  const streamSrc = `/api/video_stream/${youtubeId}`;

  return (
    <div
      className="youtube-video-container"
      ref={containerRef}
      style={{
        display: isVisible ? 'block' : 'none',
        pointerEvents: 'none'
      }}
      aria-hidden="true"
    >
      <div
        className="youtube-video-iframe-wrap"
        style={{
          width: '100%',
          height: '100%',
          opacity: hasPlaybackStarted ? 1 : 0
        }}
      >
        <video
          ref={videoRef}
          src={streamSrc}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={handleLoadedMetadata}
          onCanPlay={() => setHasPlaybackStarted(true)}
          onEnded={handleEnded}
          onError={handleError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            pointerEvents: 'none'
          }}
        />
      </div>
      <div
        className={`youtube-video-dark-filter ${!isPlaying ? 'is-paused' : ''}`}
      />
    </div>
  );
}

export default memo(YouTubeBackgroundPlayer);
