import React, { useEffect, useRef, useState, memo } from 'react';

// Singleton promise for loading the official YouTube IFrame API script
let ytApiPromise = null;
function loadYouTubeIframeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Window not available'));
  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve) => {
      const existing = document.getElementById('youtube-iframe-api');
      const prevHandler = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prevHandler === 'function') prevHandler();
        resolve(window.YT);
      };
      if (!existing) {
        const tag = document.createElement('script');
        tag.id = 'youtube-iframe-api';
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        if (firstScriptTag && firstScriptTag.parentNode) {
          firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
          document.head.appendChild(tag);
        }
      }
    });
  }
  return ytApiPromise;
}

// Helper to disable and unload any YouTube captions/subtitles modules
function disableCaptions(player) {
  if (!player) return;
  try {
    if (typeof player.unloadModule === 'function') {
      player.unloadModule('captions');
      player.unloadModule('cc');
    }
    if (typeof player.setOption === 'function') {
      player.setOption('captions', 'track', {});
      player.setOption('cc', 'track', {});
      player.setOption('captions', 'fontSize', 0);
    }
  } catch (e) {
    // Ignore if caption module not loaded yet
  }
}

function YouTubeBackgroundPlayer({
  youtubeId,
  isPlaying = false,
  isVisible = true,
  syncAnchorRef = null
}) {
  const containerRef = useRef(null);
  const playerSlotRef = useRef(null);
  const playerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: '100%', height: '100%' });
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [hasError, setHasError] = useState(false);

  // High-precision sync time retrieval from sync anchor
  const getCurrentSyncTime = () => {
    const anchor = syncAnchorRef?.current;
    if (!anchor) return 0;
    if (!anchor.isPlaying) return anchor.time || 0;
    const elapsed = (performance.now() - anchor.timestamp) / 1000;
    return Math.max(0, (anchor.time || 0) + elapsed);
  };

  // Responsive 16:9 aspect ratio "cover" sizing with overscan to ensure the video
  // fills the screen, stays centered, and pushes peripheral YouTube UI (top title bar & bottom captions) outside viewport
  useEffect(() => {
    const updateDimensions = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const cw = rect.width || window.innerWidth;
      const ch = rect.height || window.innerHeight;
      if (cw <= 0 || ch <= 0) return;

      const containerRatio = cw / ch;
      const targetRatio = 16 / 9;

      let w, h;
      if (containerRatio > targetRatio) {
        w = cw;
        h = cw / targetRatio;
      } else {
        h = ch;
        w = ch * targetRatio;
      }

      // Add 12% overscan to cleanly crop out YouTube's top title bar and bottom caption strip
      const overscan = 1.12;
      w = w * overscan;
      h = h * overscan;

      setDimensions({
        width: `${Math.ceil(w)}px`,
        height: `${Math.ceil(h)}px`
      });
    };

    updateDimensions();

    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(updateDimensions);
      ro.observe(containerRef.current);
    }
    window.addEventListener('resize', updateDimensions);

    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, []);

  // Initialize and bind the YouTube IFrame player
  useEffect(() => {
    if (!youtubeId) return;

    let isMounted = true;
    let syncInterval = null;
    setHasError(false);
    setHasPlaybackStarted(false);

    loadYouTubeIframeApi()
      .then((YT) => {
        if (!isMounted || !playerSlotRef.current) return;

        const startSeconds = getCurrentSyncTime();

        playerRef.current = new YT.Player(playerSlotRef.current, {
          videoId: youtubeId,
          playerVars: {
            autoplay: isPlaying && isVisible ? 1 : 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            mute: 1,
            cc_load_policy: 3,
            cc_lang_pref: 'none',
            autohide: 1,
            showinfo: 0,
            loop: 1,
            playlist: youtubeId,
            start: Math.floor(startSeconds),
            origin: window.location.origin
          },
          events: {
            onReady: (event) => {
              if (!isMounted) return;
              try {
                event.target.mute();
                disableCaptions(event.target);

                const cur = getCurrentSyncTime();
                event.target.seekTo(cur, true);

                if (isPlaying && isVisible) {
                  event.target.playVideo();
                } else {
                  event.target.pauseVideo();
                }
              } catch (err) {
                console.warn('[YouTubeBackgroundPlayer] onReady init error:', err);
              }

              // Periodic timeline synchronization to handle seeking, jumping lines, and drift
              syncInterval = setInterval(() => {
                if (!isMounted || !playerRef.current) return;
                try {
                  const p = playerRef.current;
                  if (typeof p.getPlayerState !== 'function' || typeof p.getCurrentTime !== 'function') return;

                  const pState = p.getPlayerState();
                  const targetTime = getCurrentSyncTime();
                  const ytTime = p.getCurrentTime();
                  const drift = Math.abs(ytTime - targetTime);

                  // If user jumps, seeks, or drift exceeds 0.45s, resync timeline immediately
                  if (drift > 0.45) {
                    p.seekTo(targetTime, true);
                  }

                  // Obey karaoke playback state (play / pause)
                  if (syncAnchorRef?.current?.isPlaying && isVisible) {
                    // 1 = PLAYING, 3 = BUFFERING
                    if (pState !== 1 && pState !== 3) {
                      p.playVideo();
                    }
                  } else {
                    if (pState === 1) {
                      p.pauseVideo();
                    }
                  }
                } catch (e) {
                  // Ignore transient errors during player state transitions
                }
              }, 250);
            },
            onStateChange: (event) => {
              if (!isMounted) return;

              // Reveal video only once playback starts to completely hide initial play icon
              if (event.data === window.YT.PlayerState.PLAYING) {
                setHasPlaybackStarted(true);
                disableCaptions(event.target);
              } else if (event.data === window.YT.PlayerState.BUFFERING) {
                disableCaptions(event.target);
              }

              // Loop video back to beginning if it ends before the karaoke track finishes
              if (event.data === 0 /* ENDED */) {
                event.target.seekTo(0, true);
                if (syncAnchorRef?.current?.isPlaying && isVisible) {
                  event.target.playVideo();
                }
              }
            },
            onApiChange: (event) => {
              if (!isMounted) return;
              disableCaptions(event.target);
            },
            onError: (event) => {
              console.warn('[YouTubeBackgroundPlayer] YouTube Player error:', event.data);
              if (isMounted) setHasError(true);
            }
          }
        });
      })
      .catch((err) => {
        console.warn('[YouTubeBackgroundPlayer] Failed to load YouTube API:', err);
        if (isMounted) setHasError(true);
      });

    return () => {
      isMounted = false;
      if (syncInterval) clearInterval(syncInterval);
      if (playerRef.current) {
        try {
          if (typeof playerRef.current.destroy === 'function') {
            playerRef.current.destroy();
          }
        } catch (e) {}
        playerRef.current = null;
      }
    };
  }, [youtubeId]);

  // React immediately to play/pause or visibility changes without waiting for sync interval
  useEffect(() => {
    const p = playerRef.current;
    if (!p || typeof p.getPlayerState !== 'function') return;

    try {
      const cur = getCurrentSyncTime();
      if (isPlaying && isVisible) {
        p.seekTo(cur, true);
        p.playVideo();
      } else {
        p.pauseVideo();
      }
    } catch (e) {}
  }, [isPlaying, isVisible]);

  if (hasError || !youtubeId) {
    return null;
  }

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
          width: dimensions.width,
          height: dimensions.height,
          opacity: hasPlaybackStarted ? 1 : 0
        }}
      >
        <div ref={playerSlotRef} />
      </div>
      <div className={`youtube-video-dark-filter ${!isPlaying ? 'is-paused' : ''}`} />
    </div>
  );
}

export default memo(YouTubeBackgroundPlayer);
