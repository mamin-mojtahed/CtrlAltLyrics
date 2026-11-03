import React, { useEffect, useRef, useState, memo } from 'react';
import socket from '../../services/socket';
import { extractYoutubeId } from '../../utils/youtube';

function YouTubeBackgroundPlayer({
  youtubeId,
  isPlaying = false,
  isVisible = true,
  syncAnchorRef = null,
  seekTimestamp = null,
  videoOffset = 0
}) {
  const cleanId = extractYoutubeId(youtubeId) || (typeof youtubeId === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(youtubeId.trim()) ? youtubeId.trim() : null);

  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [hasError, setHasError] = useState(false);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef(null);

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;
  const videoOffsetRef = useRef(videoOffset);
  videoOffsetRef.current = videoOffset;

  const lastSeekTimeRef = useRef(0);
  const lastPausedTargetTimeRef = useRef(null);
  const prevSeekTimestampRef = useRef(seekTimestamp);

  // Reset retry and error state whenever the YouTube ID changes
  useEffect(() => {
    setHasError(false);
    setHasPlaybackStarted(false);
    retryCountRef.current = 0;
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, [cleanId]);

  // Clean up any pending retry timeouts on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  // Self-heal error state when user plays or replays
  useEffect(() => {
    if (hasError && isPlaying) {
      setHasError(false);
      retryCountRef.current = 0;
      if (videoRef.current) {
        videoRef.current.load();
      }
    }
  }, [isPlaying, hasError]);

  // High-precision sync time retrieval from sync anchor
  const getCurrentSyncTime = () => {
    const anchor = syncAnchorRef?.current;
    if (!anchor) return 0;
    if (!anchor.isPlaying) return anchor.time || 0;
    const elapsed = (performance.now() - anchor.timestamp) / 1000;
    return Math.max(0, (anchor.time || 0) + elapsed);
  };

  const syncVideoPlayback = (targetAudioTime, forceSeek = false) => {
    const v = videoRef.current;
    // Wait until metadata is ready (readyState >= 1) before scrubbing or playing
    if (!v || v.readyState < 1) return;

    try {
      const targetVideoTime = targetAudioTime + (videoOffsetRef.current || 0);

      if (targetVideoTime < 0) {
        if (v.currentTime !== 0) v.currentTime = 0;
        if (!v.paused) v.pause();
        return;
      }

      if (v.duration && targetVideoTime >= v.duration) {
        if (v.currentTime !== v.duration) v.currentTime = v.duration;
        if (!v.paused) v.pause();
        return;
      }

      const cur = v.currentTime || 0;
      const drift = Math.abs(cur - targetVideoTime);

      if (forceSeek || drift > 0.45) {
        lastSeekTimeRef.current = performance.now();
        v.currentTime = targetVideoTime;
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
    if (!cleanId) return;

    const handlePlayerCommand = (cmd) => {
      const v = videoRef.current;
      if (!v) return;

      if (cmd && cmd.command === 'seek' && typeof cmd.time === 'number') {
        if (hasError) {
          setHasError(false);
          retryCountRef.current = 0;
          v.load();
        }
        syncVideoPlayback(cmd.time, true);
        setHasPlaybackStarted(true);
      }
    };

    socket.on('player_command', handlePlayerCommand);
    return () => {
      socket.off('player_command', handlePlayerCommand);
    };
  }, [cleanId, hasError]);

  // Periodic drift synchronization loop
  useEffect(() => {
    if (!cleanId) return;

    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.readyState < 1) return;

      const targetAudioTime = getCurrentSyncTime();
      const targetVideoTime = targetAudioTime + (videoOffsetRef.current || 0);

      if (targetVideoTime < 0) {
        if (v.currentTime !== 0) v.currentTime = 0;
        if (!v.paused) v.pause();
        return;
      }

      if (v.duration && targetVideoTime >= v.duration) {
        if (v.currentTime !== v.duration) v.currentTime = v.duration;
        if (!v.paused) v.pause();
        return;
      }

      if (isPlayingRef.current && isVisibleRef.current) {
        if (v.paused) {
          v.play().catch(() => {});
        }
        const drift = Math.abs(v.currentTime - targetVideoTime);
        if (drift > 0.6) {
          v.currentTime = targetVideoTime;
        }
      } else if (isVisibleRef.current) {
        if (!v.paused) {
          v.pause();
        }
        // When paused, seek if user scrubbed or jumped lines
        if (lastPausedTargetTimeRef.current === null || Math.abs(targetVideoTime - lastPausedTargetTimeRef.current) > 0.15) {
          lastPausedTargetTimeRef.current = targetVideoTime;
          v.currentTime = targetVideoTime;
          setHasPlaybackStarted(true);
        }
      }
    }, 150);

    return () => clearInterval(interval);
  }, [cleanId]);

  // React immediately to play/pause state changes
  useEffect(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 1) return;

    const targetAudioTime = getCurrentSyncTime();
    lastPausedTargetTimeRef.current = isPlaying ? null : (targetAudioTime + (videoOffsetRef.current || 0));
    syncVideoPlayback(targetAudioTime, true);
  }, [isPlaying, isVisible]);

  // React immediately to videoOffset changes
  useEffect(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 1) return;
    lastPausedTargetTimeRef.current = null;
    syncVideoPlayback(getCurrentSyncTime(), true);
  }, [videoOffset]);

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

    if (hasError && videoRef.current) {
      setHasError(false);
      retryCountRef.current = 0;
      videoRef.current.load();
    }
    syncVideoPlayback(seekTimestamp, true);
    setHasPlaybackStarted(true);
  }, [seekTimestamp, hasError]);

  // When metadata loads: seek to current sync position with offset and play or pause
  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;

    v.muted = true;
    v.volume = 0;

    const audioSeconds = getCurrentSyncTime();
    const targetSeconds = audioSeconds + (videoOffsetRef.current || 0);

    try {
      if (targetSeconds <= 0) {
        v.currentTime = 0;
      } else if (v.duration && targetSeconds >= v.duration) {
        v.currentTime = v.duration;
      } else {
        v.currentTime = targetSeconds;
      }
    } catch (e) {}

    if (isPlayingRef.current && isVisibleRef.current && targetSeconds >= 0 && (!v.duration || targetSeconds < v.duration)) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  const handleCanPlay = () => {
    setHasPlaybackStarted(true);
    const v = videoRef.current;
    if (v && isPlayingRef.current && isVisibleRef.current && v.paused) {
      const curAudio = getCurrentSyncTime();
      const targetSec = curAudio + (videoOffsetRef.current || 0);
      if (targetSec >= 0 && (!v.duration || targetSec < v.duration)) {
        v.play().catch(() => {});
      }
    }
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
    const v = videoRef.current;
    const mediaError = v?.error;
    console.warn('[NativeVideoPlayer] Stream load event error:', mediaError?.code, mediaError?.message || e);

    // Code 1 is MEDIA_ERR_ABORTED: the user/browser aborted fetching (e.g. seeking or navigating).
    if (mediaError && mediaError.code === 1) {
      return;
    }

    // Exponential backoff retry (up to 3 retries: 800ms, 1600ms, 2400ms)
    if (retryCountRef.current < 3) {
      retryCountRef.current += 1;
      const delay = 800 * retryCountRef.current;
      console.log(`[NativeVideoPlayer] Retrying stream load (attempt ${retryCountRef.current}/3) in ${delay}ms...`);
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.load();
        }
      }, delay);
      return;
    }

    setHasError(true);
  };

  if (hasError || !cleanId) {
    return null;
  }

  const streamSrc = `/api/video_stream/${cleanId}`;

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
          onCanPlay={handleCanPlay}
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
