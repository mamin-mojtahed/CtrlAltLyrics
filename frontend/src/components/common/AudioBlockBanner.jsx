import React from 'react';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import * as audioPlayer from '../../services/audioPlayer';

export default function AudioBlockBanner() {
  const audioBlocked = usePlaybackStore((state) => state.audioBlocked);
  const setAudioBlocked = usePlaybackStore((state) => state.setAudioBlocked);

  if (!audioBlocked) return null;

  const handleUnlock = async () => {
    const success = await audioPlayer.unlockAudio();
    if (success) {
      setAudioBlocked(false);
    }
  };

  return (
    <div
      id="audioBlockedBanner"
      className="audio-blocked-banner"
      style={{ display: 'block', cursor: 'pointer' }}
      onClick={handleUnlock}
    >
      <span>
        <i className="icon-alert-triangle" style={{ marginRight: '0.5rem' }}></i>
        Browser sound paused. Click anywhere on this page to enable audio playback!
      </span>
    </div>
  );
}
