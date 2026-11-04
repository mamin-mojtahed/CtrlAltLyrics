import React, { useEffect } from 'react';
import { Cpu } from 'lucide-react';
import { useModalStore } from './stores/useModalStore';
import ModelsManagerModal from './components/modals/ModelsManagerModal';

export default function MainMenuApp() {
  const openModelsManagerModal = useModalStore((state) => state.openModelsManagerModal);
  const modelsManagerModalOpen = useModalStore((state) => state.modelsManagerModalOpen);
  const closeModelsManagerModal = useModalStore((state) => state.closeModelsManagerModal);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && modelsManagerModalOpen) {
        closeModelsManagerModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modelsManagerModalOpen, closeModelsManagerModal]);

  return (
    <div id="app" className="main-menu-layout">
      <div className="main-menu-card glass">
        <div className="main-menu-banner">
          <img src="/CtrlAltLyrics-banner.svg" alt="Ctrl+Alt+Lyrics Banner" />
        </div>
        <h1>Ctrl+Alt+Lyrics</h1>
        <h2>Karaoke Player</h2>
        <div className="links">
          <a href="/dashboard.html" className="btn btn-menu btn-primary">
            <span className="btn-icon"><i className="icon-sliders"></i></span>
            <span>Open Dashboard</span>
          </a>
          <a href="/display.html" className="btn btn-menu btn-secondary" target="_blank" rel="noreferrer">
            <span className="btn-icon"><i className="icon-tv"></i></span>
            <span>Open Display Window</span>
          </a>
        </div>
      </div>

      {/* Bottom-Left Floating Control Button (matching Song Info Sidebar button style) */}
      <div className="main-menu-floating-controls">
        <button
          id="toggleModelsBtn"
          className="btn glass-btn floating-control-btn models-btn"
          title="Manage AI Models (Whisper & Audio Separation)"
          aria-label="Manage AI Models"
          onClick={openModelsManagerModal}
        >
          <Cpu size={22} />
        </button>
      </div>

      {/* External AI Models Manager Modal */}
      <ModelsManagerModal />
    </div>
  );
}
