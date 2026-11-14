import React, { useState } from 'react';
import { Settings, Shield, X, Check } from 'lucide-react';
import { useSocialStore } from '../../stores/useSocialStore';
import * as socialApi from '../../services/socialApi';

export default function HostSettingsModal({ isOpen, onClose }) {
  const partySettings = useSocialStore((state) => state.partySettings);
  const hostToken = useSocialStore((state) => state.hostToken);

  const [allowRequests, setAllowRequests] = useState(partySettings?.allowGuestRequests ?? true);
  const [autoApprove, setAutoApprove] = useState(partySettings?.autoApproveLibrary ?? false);
  const [allowStageJoin, setAllowStageJoin] = useState(partySettings?.allowStageJoin ?? true);
  const [autoApproveStageJoin, setAutoApproveStageJoin] = useState(partySettings?.autoApproveStageJoin ?? false);
  const [partyName, setPartyName] = useState(partySettings?.partyName || 'Ctrl+Alt+Lyrics Karaoke Party');
  const [newPin, setNewPin] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const payload = {
        allowGuestRequests: allowRequests,
        autoApproveLibrary: autoApprove,
        allowStageJoin,
        autoApproveStageJoin,
        partyName: partyName.trim()
      };
      if (newPin.trim()) {
        payload.pin = newPin.trim();
      }
      await socialApi.updateHostSettings(payload, hostToken);
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 1000);
    } catch (err) {
      alert(`Failed to save settings: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{ display: 'flex', zIndex: 3000 }} onClick={onClose}>
      <div className="modal-box host-settings-modal glass" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <Settings size={18} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
            Party & Host Settings
          </h3>
          <button className="btn-close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave} className="settings-form">
          <div className="form-group">
            <label htmlFor="partyNameInput">Party Name</label>
            <input
              id="partyNameInput"
              type="text"
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              className="input-glass"
              maxLength={40}
              dir="auto"
            />
          </div>

          <div className="settings-toggle-row">
            <div className="toggle-label-wrap">
              <strong>Allow Guest Song Requests</strong>
              <span>Guests can search and submit songs for approval</span>
            </div>
            <input
              type="checkbox"
              checked={allowRequests}
              onChange={(e) => setAllowRequests(e.target.checked)}
              className="toggle-checkbox"
            />
          </div>

          <div className="settings-toggle-row">
            <div className="toggle-label-wrap">
              <strong>Auto-Approve Library Songs</strong>
              <span>Songs already in the local library skip approval and enqueue immediately</span>
            </div>
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              className="toggle-checkbox"
            />
          </div>

          <div className="settings-toggle-row">
            <div className="toggle-label-wrap">
              <strong>Allow Live Stage Join Requests</strong>
              <span>Guests can request to join the stage on the current song</span>
            </div>
            <input
              type="checkbox"
              checked={allowStageJoin}
              onChange={(e) => setAllowStageJoin(e.target.checked)}
              className="toggle-checkbox"
            />
          </div>

          <div className="settings-toggle-row">
            <div className="toggle-label-wrap">
              <strong>Auto-Approve Stage Joins</strong>
              <span>Guests hop on stage immediately without waiting for host confirmation</span>
            </div>
            <input
              type="checkbox"
              checked={autoApproveStageJoin}
              onChange={(e) => setAutoApproveStageJoin(e.target.checked)}
              className="toggle-checkbox"
            />
          </div>

          <div className="form-group" style={{ marginTop: '0.8rem' }}>
            <label htmlFor="hostPinChange">Change Host PIN (Current: 1234)</label>
            <input
              id="hostPinChange"
              type="text"
              placeholder="Leave blank to keep current PIN"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              className="input-glass"
              maxLength={12}
            />
          </div>

          <div className="modal-actions-row">
            <button type="button" className="btn glass-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {saveSuccess ? (
                <>
                  <Check size={16} /> Saved!
                </>
              ) : isSaving ? (
                'Saving...'
              ) : (
                'Save Settings'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
