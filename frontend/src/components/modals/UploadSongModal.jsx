import React, { useState, useRef } from 'react';
import { useModalStore } from '../../stores/useModalStore';
import { useQueueStore } from '../../stores/useQueueStore';
import { useLibraryStore } from '../../stores/useLibraryStore';

export default function UploadSongModal() {
  const isOpen = useModalStore((state) => state.uploadModalOpen);
  const close = useModalStore((state) => state.closeUploadModal);
  const loadQueue = useQueueStore((state) => state.loadQueue);
  const loadLibrary = useLibraryStore((state) => state.loadLibrary);

  const [selectedFile, setSelectedFile] = useState(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [engineMode, setEngineMode] = useState('balanced');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState('Sending...');
  const [errorMessage, setErrorMessage] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleFileSelect = (file) => {
    if (!file) return;
    setSelectedFile(file);
    setErrorMessage(null);

    // Auto-parse filename
    const cleanName = file.name.replace(/\.[^/.]+$/, '');
    const parts = cleanName.split(/ - |_|-/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      setArtist(parts[0]);
      setTitle(parts.slice(1).join(' '));
    } else {
      setTitle(cleanName);
      setArtist('Unknown Artist');
    }
  };

  const handleSubmit = () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadPercent(0);
    setUploadStatusText('Sending...');
    setErrorMessage(null);

    const formData = new FormData();
    formData.append('audioFile', selectedFile);
    formData.append('title', title || selectedFile.name.replace(/\.[^/.]+$/, ''));
    formData.append('artist', artist || 'Unknown Artist');
    formData.append('engineSettings', JSON.stringify({
      mode: engineMode,
      format: 'MP3',
      bitrate: '192k',
      isCustom: true
    }));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        setUploadPercent(percent);
        if (percent >= 100) {
          setUploadStatusText('Processing file & splitting stems...');
        }
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setIsUploading(false);
        close();
        await loadQueue();
        await loadLibrary();
      } else {
        let errText = 'Upload failed.';
        try {
          const errData = JSON.parse(xhr.responseText);
          if (errData.error) errText = errData.error;
        } catch (e) {}
        setErrorMessage(errText);
        setIsUploading(false);
      }
    };

    xhr.onerror = () => {
      setErrorMessage('Network error during upload.');
      setIsUploading(false);
    };

    xhr.send(formData);
  };

  const handleClose = () => {
    if (!isUploading) {
      setSelectedFile(null);
      setErrorMessage(null);
      close();
    }
  };

  return (
    <div className="modal-backdrop" style={{ display: 'flex' }} onClick={handleClose}>
      <div className="modal-box upload-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3><i className="icon-upload" style={{ marginRight: '0.4rem' }}></i> Upload Song</h3>
          <button className="btn-close" onClick={handleClose} disabled={isUploading}>
            <i className="icon-x"></i>
          </button>
        </div>

        <div className="modal-body">
          {!selectedFile ? (
            <div
              className={`upload-dropzone ${isDragOver ? 'dragover' : ''}`}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files?.length > 0) handleFileSelect(e.dataTransfer.files[0]);
              }}
            >
              <input
                type="file"
                ref={fileInputRef}
                accept="audio/*,.mp3,.m4a,.wav,.flac,.opus,.ogg,.aac,.webm"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.length > 0 && handleFileSelect(e.target.files[0])}
              />
              <div className="dropzone-icon"><i className="icon-music"></i></div>
              <div className="dropzone-prompt"><strong>Click to browse</strong> or drag & drop audio file here</div>
              <div className="dropzone-formats">Supports MP3, WAV, M4A, FLAC, OPUS, OGG, AAC (Max 150MB)</div>
            </div>
          ) : (
            <div className="upload-file-info" style={{ display: 'block' }}>
              <div className="upload-file-preview-row">
                <img className="upload-cover-preview" src="/ctrlaltlyrics-logo.webp" alt="cover" />
                <div className="upload-file-details">
                  <div className="file-name-badge">
                    <span>{selectedFile.name}</span>
                    <span className="file-size-tag" style={{ marginLeft: '0.35rem' }}>
                      ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                    </span>
                  </div>
                </div>
                {!isUploading && (
                  <button
                    className="btn-clear-file"
                    title="Remove File"
                    onClick={() => setSelectedFile(null)}
                  >
                    <i className="icon-x"></i>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="upload-form-grid" style={{ marginTop: '0.75rem' }}>
            <div className="form-group">
              <label>Song Title:</label>
              <input
                type="text"
                placeholder="e.g. Bohemian Rhapsody"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isUploading}
                autoComplete="off"
              />
            </div>
            <div className="form-group">
              <label>Artist Name:</label>
              <input
                type="text"
                placeholder="e.g. Queen"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                disabled={isUploading}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="upload-engine-summary" style={{ marginTop: '0.75rem' }}>
            <div className="engine-summary-header">
              <span><i className="icon-settings" style={{ marginRight: '0.25rem' }}></i> Stem Separation Engine</span>
              <span className="engine-badge-pill">{engineMode.toUpperCase()} (MP3 192k)</span>
            </div>
            <div className="engine-quick-select-row">
              <label>Mode:</label>
              <select
                value={engineMode}
                onChange={(e) => setEngineMode(e.target.value)}
                disabled={isUploading}
              >
                <option value="balanced">Balanced (~30s)</option>
                <option value="fast">Fast (~10s)</option>
                <option value="high">High Precision (~60s)</option>
                <option value="ultra">Ultra Quality (~2m)</option>
              </select>
            </div>
          </div>

          {isUploading && (
            <div className="upload-progress-container" style={{ display: 'block', marginTop: '0.75rem' }}>
              <div className="upload-progress-header">
                <span>Uploading: {uploadPercent}%</span>
                <span>{uploadStatusText}</span>
              </div>
              <div className="upload-progress-bar-bg">
                <div className="upload-progress-bar-fill" style={{ width: `${uploadPercent}%` }}></div>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="upload-error-msg" style={{ display: 'block', marginTop: '0.75rem' }}>
              <i className="icon-alert-triangle" style={{ marginRight: '0.35rem' }}></i>
              {errorMessage}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={handleClose} disabled={isUploading}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!selectedFile || isUploading}
          >
            {isUploading ? 'Uploading...' : 'Upload & Process'}
          </button>
        </div>
      </div>
    </div>
  );
}
