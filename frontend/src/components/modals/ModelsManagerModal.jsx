import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Cpu, HardDrive, Package, Zap, Mic, Layers, AlertCircle, Trash2, Download } from 'lucide-react';
import { useModalStore } from '../../stores/useModalStore';
import * as api from '../../services/api';
import socket from '../../services/socket';
import ScrollShadowWrapper from '../common/ScrollShadowWrapper';

function parseApproxBytes(str) {
  if (!str) return 0;
  const num = parseFloat(str);
  if (str.includes('GB')) return num * 1024 * 1024 * 1024;
  if (str.includes('MB')) return num * 1024 * 1024;
  if (str.includes('KB')) return num * 1024;
  return num || 0;
}

export default function ModelsManagerModal() {
  const isOpen = useModalStore((state) => state.modelsManagerModalOpen);
  const closeModal = useModalStore((state) => state.closeModelsManagerModal);

  const [modelsData, setModelsData] = useState({ models: [], summary: {} });
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [downloadProgresses, setDownloadProgresses] = useState({});
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'whisper', 'separation'
  const [showInstalledOnly, setShowInstalledOnly] = useState(false);
  const [sortBy, setSortBy] = useState('default'); // 'default', 'size-desc', 'size-asc', 'usage-desc', 'usage-asc', 'name-asc'
  const [noticeMessage, setNoticeMessage] = useState(null);

  const scrollContainerRef = useRef(null);

  const fetchModels = async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await api.fetchModelsStatus();
      setModelsData(data);
    } catch (err) {
      console.error('Failed to load AI models status:', err);
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchModels(true);
      setConfirmDeleteId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleProgress = (data) => {
      if (!data || !data.id) return;
      setDownloadProgresses((prev) => ({
        ...prev,
        [data.id]: {
          progress: data.progress,
          status: data.status,
          message: data.message
        }
      }));

      if (data.status === 'done' || data.status === 'error' || data.status === 'cancelled') {
        fetchModels(false);
      }
    };

    const handleUpdated = () => {
      fetchModels(false);
    };

    socket.on('model_download_progress', handleProgress);
    socket.on('models_updated', handleUpdated);

    return () => {
      socket.off('model_download_progress', handleProgress);
      socket.off('models_updated', handleUpdated);
    };
  }, [isOpen]);

  const handleDownload = async (model) => {
    setActionLoading((prev) => ({ ...prev, [model.id]: true }));
    try {
      setDownloadProgresses((prev) => ({
        ...prev,
        [model.id]: { progress: 1, status: 'starting', message: `Initializing download for ${model.name}...` }
      }));
      await api.downloadModel(model.id);
      setNoticeMessage({ type: 'info', text: `Download started for ${model.name}` });
    } catch (err) {
      setNoticeMessage({ type: 'error', text: err.message || 'Download failed to start' });
      setDownloadProgresses((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [model.id]: false }));
    }
  };

  const handleCancelDownload = async (model) => {
    try {
      await api.cancelModelDownload(model.id);
      setDownloadProgresses((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
      fetchModels(false);
    } catch (err) {
      console.error('Failed to cancel download:', err);
    }
  };

  const handleDelete = async (model) => {
    setActionLoading((prev) => ({ ...prev, [model.id]: true }));
    try {
      const res = await api.deleteModel(model.id);
      setConfirmDeleteId(null);
      setNoticeMessage({
        type: 'success',
        text: `Deleted ${model.name} (${res.freedFormatted || 'freed space'}). Model can now be installed anytime.`
      });
      fetchModels(false);
    } catch (err) {
      setNoticeMessage({ type: 'error', text: err.message || 'Failed to delete model file' });
    } finally {
      setActionLoading((prev) => ({ ...prev, [model.id]: false }));
    }
  };

  const { models = [], summary = {} } = modelsData;

  const toggleSort = (field) => {
    if (field === 'size') {
      setSortBy((prev) => (prev === 'size-desc' ? 'size-asc' : 'size-desc'));
    } else if (field === 'usage') {
      setSortBy((prev) => (prev === 'usage-desc' ? 'usage-asc' : 'usage-desc'));
    } else if (field === 'name') {
      setSortBy((prev) => (prev === 'name-asc' ? 'default' : 'name-asc'));
    }
  };

  const filteredAndSortedModels = useMemo(() => {
    let list = models.filter((m) => {
      if (activeTab === 'whisper' && m.type !== 'whisper') return false;
      if (activeTab === 'separation' && m.type !== 'separation') return false;
      if (showInstalledOnly && !m.isInstalled) return false;
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'size-desc') {
        const sizeA = a.isInstalled ? a.sizeBytes : parseApproxBytes(a.approxSize);
        const sizeB = b.isInstalled ? b.sizeBytes : parseApproxBytes(b.approxSize);
        return sizeB - sizeA;
      }
      if (sortBy === 'size-asc') {
        const sizeA = a.isInstalled ? a.sizeBytes : parseApproxBytes(a.approxSize);
        const sizeB = b.isInstalled ? b.sizeBytes : parseApproxBytes(b.approxSize);
        return sizeA - sizeB;
      }
      if (sortBy === 'usage-desc') {
        return (b.timesUsed || 0) - (a.timesUsed || 0);
      }
      if (sortBy === 'usage-asc') {
        return (a.timesUsed || 0) - (b.timesUsed || 0);
      }
      if (sortBy === 'name-asc') {
        return a.name.localeCompare(b.name);
      }
      return 0;
    });
  }, [models, activeTab, showInstalledOnly, sortBy]);

  const whisperCount = useMemo(() => models.filter((m) => m.type === 'whisper').length, [models]);
  const separationCount = useMemo(() => models.filter((m) => m.type === 'separation').length, [models]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop models-manager-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div className="modal-box models-manager-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header models-manager-header">
          <div className="header-title-group">
            <div className="header-icon-badge">
              <Cpu size={22} />
            </div>
            <div>
              <h2 className="modal-title">AI Models Manager</h2>
              <p className="modal-subtitle">
                Manage external neural network weights for Whisper lyrics alignment and audio stem separation
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-close"
            onClick={closeModal}
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        {/* Global Alert Notification */}
        {noticeMessage && (
          <div className={`models-notice-banner ${noticeMessage.type}`}>
            <span>{noticeMessage.text}</span>
            <button
              type="button"
              className="btn-notice-dismiss"
              onClick={() => setNoticeMessage(null)}
              aria-label="Dismiss message"
            >
              &times;
            </button>
          </div>
        )}

        {/* Top Summary Stat Cards */}
        <div className="models-summary-banner">
          {/* Card 1: Total Storage */}
          <div className="summary-stat-card card-storage">
            <div className="stat-card-header">
              <span className="stat-label">TOTAL STORAGE USED</span>
              <HardDrive size={18} />
            </div>
            <div className="stat-value">{summary.totalSizeFormatted || '0 B'}</div>
            <div className="stat-breakdown">
              <span className="breakdown-tag whisper">Whisper: {summary.whisperSizeFormatted || '0 B'}</span>
              <span className="breakdown-divider">•</span>
              <span className="breakdown-tag separation">Stems: {summary.separationSizeFormatted || '0 B'}</span>
            </div>
          </div>

          {/* Card 2: Installed Models */}
          <div className="summary-stat-card card-models">
            <div className="stat-card-header">
              <span className="stat-label">INSTALLED MODELS</span>
              <Package size={18} />
            </div>
            <div className="stat-value">
              {summary.installedCount ?? 0} <span className="stat-sub-value">/ {summary.totalCount ?? 0}</span>
            </div>
            <div className="stat-subtext">Local models available for offline processing</div>
          </div>

          {/* Card 3: Total Executions */}
          <div className="summary-stat-card card-executions">
            <div className="stat-card-header">
              <span className="stat-label">TOTAL SESSIONS</span>
              <Zap size={18} />
            </div>
            <div className="stat-value">{summary.totalUses ?? 0} <span className="stat-sub-value">runs</span></div>
            <div className="stat-subtext">Cumulative stems split & lyrics synchronized</div>
          </div>
        </div>

        {/* Filter & Sort Toolbar */}
        <div className="models-filter-bar">
          <div className="filter-tabs">
            <button
              type="button"
              className={`filter-tab ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              All Models <span className="tab-badge">{models.length}</span>
            </button>
            <button
              type="button"
              className={`filter-tab ${activeTab === 'whisper' ? 'active' : ''}`}
              onClick={() => setActiveTab('whisper')}
            >
              <Mic size={14} />
              Whisper <span className="tab-badge">{whisperCount}</span>
            </button>
            <button
              type="button"
              className={`filter-tab ${activeTab === 'separation' ? 'active' : ''}`}
              onClick={() => setActiveTab('separation')}
            >
              <Layers size={14} />
              Separation <span className="tab-badge">{separationCount}</span>
            </button>
          </div>

          <div className="filter-controls-right">
            {/* Sort Dropdown Selector */}
            <div className="sort-select-wrapper">
              <span className="sort-label">Sort:</span>
              <select
                className="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort models by"
              >
                <option value="default">Default Order</option>
                <option value="size-desc">Disk Size (Largest first)</option>
                <option value="size-asc">Disk Size (Smallest first)</option>
                <option value="usage-desc">Most Frequently Used</option>
                <option value="usage-asc">Least Frequently Used</option>
                <option value="name-asc">Model Name (A-Z)</option>
              </select>
            </div>

            <label className="installed-filter-toggle">
              <input
                type="checkbox"
                checked={showInstalledOnly}
                onChange={(e) => setShowInstalledOnly(e.target.checked)}
              />
              <span>Installed only</span>
            </label>
          </div>
        </div>

        {/* Models Compact Table Card */}
        <div className="models-table-card">
          {/* Fixed Table Header (strictly outside scroll container) */}
          <div className="models-table-header" role="row">
            <div className="th-col th-model sortable" onClick={() => toggleSort('name')} title="Sort by Model Name">
              <span>MODEL</span>
              {sortBy === 'name-asc' && <span className="sort-arrow">▲</span>}
            </div>
            <div className="th-col th-category">
              <span>CATEGORY</span>
            </div>
            <div className="th-col th-size sortable" onClick={() => toggleSort('size')} title="Sort by Disk Storage Size">
              <span>DISK SIZE</span>
              {sortBy === 'size-desc' && <span className="sort-arrow">▼</span>}
              {sortBy === 'size-asc' && <span className="sort-arrow">▲</span>}
            </div>
            <div className="th-col th-usage sortable" onClick={() => toggleSort('usage')} title="Sort by Usage Count">
              <span>USAGE</span>
              {sortBy === 'usage-desc' && <span className="sort-arrow">▼</span>}
              {sortBy === 'usage-asc' && <span className="sort-arrow">▲</span>}
            </div>
            <div className="th-col th-actions">
              <span>ACTION</span>
            </div>
          </div>

          {/* Scrollable Models Body Area */}
          <ScrollShadowWrapper
            className="models-list-scroll-wrapper"
            scrollRef={scrollContainerRef}
          >
            <div ref={scrollContainerRef} className="models-table-container">
              {loading ? (
                <div className="models-loading-state">
                  <div className="spinner"></div>
                  <span>Scanning model weights on disk...</span>
                </div>
              ) : filteredAndSortedModels.length === 0 ? (
                <div className="models-empty-state">
                  <AlertCircle size={36} />
                  <p>No models match the selected filter criteria.</p>
                </div>
              ) : (
                <div className="models-table-body">
                  {filteredAndSortedModels.map((model) => {
                    const dl = downloadProgresses[model.id] || (model.isDownloading ? {
                      progress: model.downloadProgress,
                      status: model.downloadStatus,
                      message: model.downloadMessage
                    } : null);

                    const isDownloading = Boolean(dl && dl.status !== 'done' && dl.status !== 'error' && dl.status !== 'cancelled');
                    const isConfirmingDelete = confirmDeleteId === model.id;
                    const isLoadingAction = Boolean(actionLoading[model.id]);

                    return (
                      <div
                        key={model.id}
                        className={`model-table-row ${model.isInstalled ? 'row-installed' : 'row-not-installed'} ${isDownloading ? 'row-downloading' : ''}`}
                        role="row"
                      >
                        {/* Column 1: Model Name & Description */}
                        <div className="td-col td-model">
                          <div className="model-name-cell">
                            <div className="model-row-icon">
                              {model.type === 'whisper' ? (
                                <Mic size={15} />
                              ) : (
                                <Layers size={15} />
                              )}
                            </div>
                            <div className="model-text-stack">
                              <span className="row-model-name">{model.name}</span>
                              <span className="row-model-desc" title={model.description}>{model.description}</span>
                            </div>
                          </div>
                        </div>

                        {/* Column 2: Category Badge */}
                        <div className="td-col td-category">
                          <span className={`compact-category-badge ${model.type}`}>
                            {model.type === 'whisper' ? 'Whisper' : 'Stem Split'}
                          </span>
                        </div>

                        {/* Column 3: Storage Size */}
                        <div className="td-col td-size">
                          {model.isInstalled ? (
                            <div className="size-badge-box installed">
                              <span className="status-dot installed"></span>
                              <span className="size-val">{model.sizeFormatted}</span>
                            </div>
                          ) : (
                            <div className="size-badge-box missing">
                              <span className="status-dot missing"></span>
                              <span className="size-val">{model.approxSize}</span>
                            </div>
                          )}
                        </div>

                        {/* Column 4: Usage Count */}
                        <div className="td-col td-usage">
                          <span className={`compact-usage-badge ${model.timesUsed > 0 ? 'used' : 'idle'}`}>
                            {model.timesUsed > 0 ? `${model.timesUsed} runs` : '0 runs'}
                          </span>
                        </div>

                        {/* Column 5: Actions (Install or Delete or Progress) */}
                        <div className="td-col td-actions">
                          {isDownloading ? (
                            <div className="compact-download-box">
                              <div className="compact-progress-track">
                                <div
                                  className="compact-progress-fill"
                                  style={{ width: `${Math.max(3, Math.min(100, dl?.progress || 0))}%` }}
                                />
                              </div>
                              <div className="compact-download-info">
                                <span className="compact-pct">{dl?.progress || 0}%</span>
                                <button
                                  type="button"
                                  className="btn-link-cancel"
                                  onClick={() => handleCancelDownload(model)}
                                  disabled={isLoadingAction}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : isConfirmingDelete ? (
                            <div className="compact-delete-confirm">
                              <span className="confirm-prompt">Delete?</span>
                              <button
                                type="button"
                                className="btn-confirm-act confirm-yes"
                                onClick={() => handleDelete(model)}
                                disabled={isLoadingAction}
                                title="Confirm deletion"
                              >
                                {isLoadingAction ? '...' : 'Yes'}
                              </button>
                              <button
                                type="button"
                                className="btn-confirm-act confirm-no"
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={isLoadingAction}
                              >
                                No
                              </button>
                            </div>
                          ) : model.isInstalled ? (
                            <button
                              type="button"
                              className="btn-table-action btn-delete-row"
                              title={`Delete ${model.name} (${model.sizeFormatted}) from disk`}
                              onClick={() => setConfirmDeleteId(model.id)}
                              disabled={isLoadingAction}
                            >
                              <Trash2 size={13} />
                              Delete
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-table-action btn-install-row"
                              title={`Download and install ${model.name} (${model.approxSize})`}
                              onClick={() => handleDownload(model)}
                              disabled={isLoadingAction}
                            >
                              <Download size={13} />
                              Install
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollShadowWrapper>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer models-manager-footer">
          <div className="footer-legend">
            <span>Cache paths: <code>~/.cache/whisper</code> & <code>/tmp/audio-separator-models</code></span>
          </div>
          <button type="button" className="btn btn-primary" onClick={closeModal}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
