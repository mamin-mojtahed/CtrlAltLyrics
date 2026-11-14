import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, X } from 'lucide-react';
import { formatTime } from '../../utils/themeColors';

export default function AudioPreviewPlayer({ songId, title, artist, onClose }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setError(null);
    if (audioRef.current) {
      audioRef.current.load();
      audioRef.current.play().then(() => setIsPlaying(true)).catch((e) => {
        // Autoplay may be prevented until interaction, which is normal
        console.log('Preview playback waiting for user tap:', e);
      });
    }
  }, [songId]);

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(err => {
        setError('Failed to play preview audio');
      });
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e) => {
    const target = parseFloat(e.target.value);
    setCurrentTime(target);
    if (audioRef.current) {
      audioRef.current.currentTime = target;
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  if (!songId) return null;

  return (
    <div className="audio-preview-bar glass">
      <audio
        ref={audioRef}
        src={`/api/social/preview_audio/${songId}`}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setIsPlaying(false)}
        onError={() => setError('Preview track not ready or processed yet')}
        preload="metadata"
      />

      <div className="preview-meta">
        <span className="preview-label">Local Audition (Phone / Headphones)</span>
        <strong className="preview-title">{title || 'Preview Audio'}</strong>
        {artist && <span className="preview-artist">{artist}</span>}
      </div>

      {error ? (
        <span className="preview-error">{error}</span>
      ) : (
        <div className="preview-controls">
          <button
            className="btn glass-btn preview-play-btn"
            onClick={togglePlayPause}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <span className="preview-timer">{formatTime(currentTime)}</span>

          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={currentTime}
            onChange={handleSeek}
            className="preview-slider"
          />

          <span className="preview-duration">{formatTime(duration)}</span>

          <button
            className="btn glass-btn preview-mute-btn"
            onClick={toggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
        </div>
      )}

      {onClose && (
        <button className="preview-close-btn" onClick={onClose} title="Close Preview">
          <X size={16} />
        </button>
      )}
    </div>
  );
}
