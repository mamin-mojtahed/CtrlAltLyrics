import React, { useState, useEffect, useRef } from 'react';
import {
  Sliders,
  Lock,
  Sparkles,
  Mic2,
  Volume2,
  VolumeX,
  UserPlus,
  Clock,
  LogOut,
  Check,
  Link2,
  Unlink2
} from 'lucide-react';
import { emitPlayerCommand } from '../../services/socket';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useSocialStore } from '../../stores/useSocialStore';
import * as socialApi from '../../services/socialApi';

export default function PerformerMixer() {
  const currentSong = usePlaybackStore((state) => state.currentSong);
  const storeVolumes = usePlaybackStore((state) => state.volumes);
  const isInstBackLinked = usePlaybackStore((state) => state.isInstBackLinked);
  const setLinkInstBack = usePlaybackStore((state) => state.setLinkInstBack);
  const isBackLeadLinked = usePlaybackStore((state) => state.isBackLeadLinked);
  const setLinkBackLead = usePlaybackStore((state) => state.setLinkBackLead);
  const setStoreVolumes = usePlaybackStore((state) => state.setVolumes);
  const toggleStemMute = usePlaybackStore((state) => state.toggleStemMute);

  const nickname = useSocialStore((state) => state.nickname);
  const guestId = useSocialStore((state) => state.guestId);
  const avatarColor = useSocialStore((state) => state.avatarColor);
  const stageJoinRequests = useSocialStore((state) => state.stageJoinRequests);
  const partySettings = useSocialStore((state) => state.partySettings);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Local volume state initialized from playback store
  const [volumes, setVolumes] = useState({
    inst: storeVolumes?.inst ?? 1,
    back: storeVolumes?.back ?? 1,
    lead: storeVolumes?.lead ?? 1
  });

  const prevVolumesRef = useRef({
    inst: storeVolumes?.inst || 1,
    back: storeVolumes?.back || 1,
    lead: storeVolumes?.lead || 1
  });

  // Keep in sync with incoming store volumes
  useEffect(() => {
    if (storeVolumes) {
      const updated = {
        inst: storeVolumes.inst ?? storeVolumes.instrumentals ?? 1,
        back: storeVolumes.back ?? 1,
        lead: storeVolumes.lead ?? storeVolumes.vocals ?? 1
      };
      setVolumes(updated);
      if (updated.inst > 0.01) prevVolumesRef.current.inst = updated.inst;
      if (updated.back > 0.01) prevVolumesRef.current.back = updated.back;
      if (updated.lead > 0.01) prevVolumesRef.current.lead = updated.lead;
    }
  }, [storeVolumes]);

  // Determine if this guest is on stage (in singers or requester)
  const isPerformerOnStage = Boolean(
    currentSong &&
    (
      (Array.isArray(currentSong.singers) && nickname &&
        currentSong.singers.some(s => s.toLowerCase() === nickname.toLowerCase())) ||
      (currentSong.requestedBy?.guestId && currentSong.requestedBy.guestId === guestId)
    )
  );

  // Check if current guest has a pending stage join request
  const myStageRequest = Array.isArray(stageJoinRequests)
    ? stageJoinRequests.find(r => r.guestId === guestId && r.status === 'pending')
    : null;

  const handleRequestJoinStage = async () => {
    if (!nickname) {
      alert('Please set your nickname before requesting to join the stage.');
      return;
    }
    if (!currentSong) {
      alert('No song is currently playing on stage.');
      return;
    }
    try {
      setIsSubmitting(true);
      await socialApi.requestJoinStage({
        guestId,
        nickname,
        avatarColor
      });
    } catch (err) {
      alert(err.message || 'Could not request to join stage');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelStageRequest = async () => {
    if (!myStageRequest) return;
    try {
      setIsSubmitting(true);
      await socialApi.cancelStageJoinRequest(myStageRequest.id, guestId);
    } catch (err) {
      alert(err.message || 'Could not cancel request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLeaveStage = async () => {
    if (!confirm('Are you sure you want to step down from the stage?')) return;
    try {
      setIsSubmitting(true);
      await socialApi.leaveStage(nickname);
    } catch (err) {
      alert(err.message || 'Could not leave stage');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVolumeChange = (stem, value) => {
    const val = Math.max(0, Math.min(1, parseFloat(value) || 0));
    setStoreVolumes({ [stem]: val });
  };

  const handleToggleStemMute = (stem) => {
    toggleStemMute(stem);
  };

  const getFaderStyle = (val) => {
    const v = Math.max(0, Math.min(1, parseFloat(val) || 0));
    const pct = v * 100;
    return {
      background: `linear-gradient(to top, var(--accent, #6366f1) ${pct}%, #ffffff ${pct}%)`,
      backgroundClip: 'content-box'
    };
  };

  // If the guest is NOT on stage, show the Stage Join Request option alongside the locked mixer
  if (!isPerformerOnStage) {
    const activeSingers = currentSong?.singers?.length ? currentSong.singers.join(' & ') : currentSong?.requestedBy?.nickname;

    return (
      <div className="stage-join-section">
        {/* Prominent Live Stage Participation Call to Action */}
        {currentSong && partySettings?.allowStageJoin !== false && (
          <div className={`stage-join-prompt-box glass ${myStageRequest ? 'pending' : 'ready'}`}>
            <div className="stage-join-info">
              {myStageRequest ? (
                <>
                  <div className="stage-join-title-row">
                    <span className="stage-status-badge pending">
                      <Clock size={13} className="icon-spin-slow" />
                      Stage Request Pending
                    </span>
                  </div>
                  <p className="stage-join-hint">
                    Waiting for the host to welcome you to the stage for <strong dir="auto">"{currentSong.title}"</strong>...
                  </p>
                </>
              ) : (
                <>
                  <div className="stage-join-title-row">
                    <Mic2 size={18} className="stage-mic-accent" />
                    <strong>Join the Current Song!</strong>
                  </div>
                  <p className="stage-join-hint">
                    Hop on stage for <strong dir="auto">"{currentSong.title}"</strong> to sing along & unlock live stem mixing!
                  </p>
                </>
              )}
            </div>

            <div className="stage-join-actions">
              {myStageRequest ? (
                <button
                  type="button"
                  className="btn glass-btn btn-sm"
                  onClick={handleCancelStageRequest}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-join-stage"
                  onClick={handleRequestJoinStage}
                  disabled={isSubmitting}
                >
                  <UserPlus size={16} />
                  <span>Request to Join Stage</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Locked Mixer Info Card */}
        <div className="performer-mixer-locked glass">
          <div className="mixer-lock-icon-wrap">
            <Lock size={20} className="mixer-lock-icon" />
          </div>
          <div className="mixer-lock-text">
            <strong>Performer Mixer Locked</strong>
            <p>
              {currentSong ? (
                activeSingers ? (
                  <>🎤 Currently performing: <span className="highlight-singer" dir="auto">{activeSingers}</span>. Controls unlock when you are on stage!</>
                ) : (
                  'Controls unlock when you are on stage as singer or requester.'
                )
              ) : (
                'Mixer unlocks when a song is playing.'
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="performer-mixer-card glass">
      <div className="performer-mixer-header">
        <div className="mixer-header-top-row">
          <div className="mixer-badge-active">
            <Sparkles size={16} className="sparkle-icon" />
            <span>You're On Stage!</span>
          </div>
          <button
            type="button"
            className="btn glass-btn btn-sm btn-leave-stage"
            onClick={handleLeaveStage}
            title="Step down from the stage"
            disabled={isSubmitting}
          >
            <LogOut size={13} />
            <span>Leave Stage</span>
          </button>
        </div>
        <span className="mixer-subtitle">Vertical live stem faders active on the room sound system</span>
      </div>

      {/* Dashboard-Consistent Vertical 3-Fader Mixer */}
      <div className="mixer guest-mixer-track-area">
        {/* Instrumental Fader */}
        <div className="fader-container">
          <span className="fader-val-tag" title="Instrumental Volume">
            {Math.round((volumes.inst ?? 1) * 100)}%
          </span>
          <input
            type="range"
            id="guestVolInst"
            min="0"
            max="1"
            step="0.01"
            value={volumes.inst ?? 1}
            style={getFaderStyle(volumes.inst ?? 1)}
            onChange={(e) => handleVolumeChange('inst', e.target.value)}
            aria-label="Instrumental stem volume"
          />
          <div className="fader-bottom">
            <button
              type="button"
              className={`fader-mute-btn ${(volumes.inst ?? 1) <= 0.001 ? 'is-muted' : ''}`}
              title="Mute/Unmute Inst"
              onClick={() => handleToggleStemMute('inst')}
            >
              {(volumes.inst ?? 1) <= 0.001 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <span className="fader-label">Inst</span>
          </div>
        </div>

        {/* Link Inst & Back */}
        <button
          type="button"
          className={`btn mixer-link-btn ${isInstBackLinked ? 'is-linked' : ''}`}
          style={{ opacity: isInstBackLinked ? 1 : 0.4 }}
          title={isInstBackLinked ? 'Linked Inst & Back (Click to Unlink)' : 'Unlinked Inst & Back (Click to Link)'}
          aria-label={isInstBackLinked ? 'Unlink instrumental and backing vocals' : 'Link instrumental and backing vocals'}
          onClick={() => setLinkInstBack(!isInstBackLinked)}
        >
          {isInstBackLinked ? <Link2 size={16} /> : <Unlink2 size={16} />}
        </button>

        {/* Backing Vocals Fader */}
        <div className="fader-container">
          <span className="fader-val-tag" title="Backing Vocals Volume">
            {Math.round((volumes.back ?? 1) * 100)}%
          </span>
          <input
            type="range"
            id="guestVolBack"
            min="0"
            max="1"
            step="0.01"
            value={volumes.back ?? 1}
            style={getFaderStyle(volumes.back)}
            onChange={(e) => handleVolumeChange('back', e.target.value)}
            aria-label="Backing vocals stem volume"
          />
          <div className="fader-bottom">
            <button
              type="button"
              className={`fader-mute-btn ${(volumes.back ?? 1) <= 0.001 ? 'is-muted' : ''}`}
              title="Mute/Unmute Back"
              onClick={() => handleToggleStemMute('back')}
            >
              {(volumes.back ?? 1) <= 0.001 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <span className="fader-label">Back</span>
          </div>
        </div>

        {/* Link Back & Lead */}
        <button
          type="button"
          className={`btn mixer-link-btn ${isBackLeadLinked ? 'is-linked' : ''}`}
          style={{ opacity: isBackLeadLinked ? 1 : 0.4 }}
          title={isBackLeadLinked ? 'Linked Back & Lead (Click to Unlink)' : 'Unlinked Back & Lead (Click to Link)'}
          aria-label={isBackLeadLinked ? 'Unlink backing vocals and lead vocals' : 'Link backing vocals and lead vocals'}
          onClick={() => setLinkBackLead(!isBackLeadLinked)}
        >
          {isBackLeadLinked ? <Link2 size={16} /> : <Unlink2 size={16} />}
        </button>

        {/* Lead Vocals Fader */}
        <div className="fader-container">
          <span className="fader-val-tag" title="Lead Vocals Volume">
            {Math.round((volumes.lead ?? 1) * 100)}%
          </span>
          <input
            type="range"
            id="guestVolLead"
            min="0"
            max="1"
            step="0.01"
            value={volumes.lead ?? 1}
            style={getFaderStyle(volumes.lead)}
            onChange={(e) => handleVolumeChange('lead', e.target.value)}
            aria-label="Lead vocals stem volume"
          />
          <div className="fader-bottom">
            <button
              type="button"
              className={`fader-mute-btn ${(volumes.lead ?? 1) <= 0.001 ? 'is-muted' : ''}`}
              title="Mute/Unmute Lead"
              onClick={() => handleToggleStemMute('lead')}
            >
              {(volumes.lead ?? 1) <= 0.001 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <span className="fader-label">Lead</span>
          </div>
        </div>
      </div>
    </div>
  );
}
