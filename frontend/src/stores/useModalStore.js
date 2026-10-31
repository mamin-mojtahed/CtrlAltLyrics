import { create } from 'zustand';

function getActiveModalDescriptor(state) {
  if (state.lyricsSyncModalSong) {
    return { type: 'lyricsSync', payload: state.lyricsSyncModalSong };
  }
  if (state.stemEditorModalSong) {
    return { type: 'stemEditor', payload: state.stemEditorModalSong };
  }
  if (state.metadataModalSong) {
    return { type: 'metadata', payload: state.metadataModalSong };
  }
  if (state.componentManagerSongId) {
    return { type: 'componentManager', payload: state.componentManagerSongId };
  }
  if (state.uploadModalOpen) {
    return { type: 'upload', payload: true };
  }
  return null;
}

function isSameModal(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.payload === b.payload) return true;
  if (typeof a.payload === 'object' && typeof b.payload === 'object' && a.payload && b.payload) {
    return a.payload.id && b.payload.id && a.payload.id === b.payload.id;
  }
  return false;
}

function popAndRestore(state) {
  const history = Array.isArray(state.modalHistory) ? [...state.modalHistory] : [];
  if (history.length === 0) {
    return {
      uploadModalOpen: false,
      metadataModalSong: null,
      lyricsSyncModalSong: null,
      componentManagerSongId: null,
      stemEditorModalSong: null,
      modalHistory: []
    };
  }

  const previous = history.pop();
  return {
    uploadModalOpen: previous.type === 'upload',
    metadataModalSong: previous.type === 'metadata' ? previous.payload : null,
    lyricsSyncModalSong: previous.type === 'lyricsSync' ? previous.payload : null,
    componentManagerSongId: previous.type === 'componentManager' ? previous.payload : null,
    stemEditorModalSong: previous.type === 'stemEditor' ? previous.payload : null,
    modalHistory: history
  };
}

function pushAndOpen(state, nextModalState, descriptor) {
  const current = getActiveModalDescriptor(state);
  let nextHistory = Array.isArray(state.modalHistory) ? [...state.modalHistory] : [];

  if (current && descriptor && isSameModal(current, descriptor)) {
    return state;
  }

  if (current) {
    nextHistory.push(current);
  }

  return {
    uploadModalOpen: false,
    metadataModalSong: null,
    lyricsSyncModalSong: null,
    componentManagerSongId: null,
    stemEditorModalSong: null,
    ...nextModalState,
    modalHistory: nextHistory
  };
}

export const useModalStore = create((set) => ({
  uploadModalOpen: false,
  metadataModalSong: null,
  lyricsSyncModalSong: null,
  componentManagerSongId: null,
  stemEditorModalSong: null,
  modalHistory: [],

  openUploadModal: () => set((state) => pushAndOpen(state, { uploadModalOpen: true }, { type: 'upload', payload: true })),
  closeUploadModal: () => set((state) => popAndRestore(state)),

  openMetadataModal: (song) => set((state) => pushAndOpen(state, { metadataModalSong: song }, { type: 'metadata', payload: song })),
  closeMetadataModal: () => set((state) => popAndRestore(state)),

  openLyricsSyncModal: (song) => set((state) => pushAndOpen(state, { lyricsSyncModalSong: song }, { type: 'lyricsSync', payload: song })),
  closeLyricsSyncModal: () => set((state) => popAndRestore(state)),

  openComponentManager: (songId) => set((state) => pushAndOpen(state, { componentManagerSongId: songId }, { type: 'componentManager', payload: songId })),
  closeComponentManager: () => set((state) => popAndRestore(state)),

  openStemEditorModal: (song) => set((state) => pushAndOpen(state, { stemEditorModalSong: song }, { type: 'stemEditor', payload: song })),
  closeStemEditorModal: () => set((state) => popAndRestore(state)),

  stepBack: () => set((state) => popAndRestore(state)),

  closeAllModals: () => set({
    uploadModalOpen: false,
    metadataModalSong: null,
    lyricsSyncModalSong: null,
    componentManagerSongId: null,
    stemEditorModalSong: null,
    modalHistory: []
  })
}));
