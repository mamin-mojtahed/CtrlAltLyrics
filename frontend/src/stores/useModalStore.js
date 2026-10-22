import { create } from 'zustand';

export const useModalStore = create((set) => ({
  uploadModalOpen: false,
  metadataModalSong: null,
  lyricsSyncModalSong: null,
  componentManagerSongId: null,

  openUploadModal: () => set({ uploadModalOpen: true }),
  closeUploadModal: () => set({ uploadModalOpen: false }),

  openMetadataModal: (song) => set({ metadataModalSong: song }),
  closeMetadataModal: () => set({ metadataModalSong: null }),

  openLyricsSyncModal: (song) => set({ lyricsSyncModalSong: song }),
  closeLyricsSyncModal: () => set({ lyricsSyncModalSong: null }),

  openComponentManager: (songId) => set({ componentManagerSongId: songId }),
  closeComponentManager: () => set({ componentManagerSongId: null }),

  closeAllModals: () => set({
    uploadModalOpen: false,
    metadataModalSong: null,
    lyricsSyncModalSong: null,
    componentManagerSongId: null
  })
}));
