import { create } from 'zustand';
import * as api from '../services/api';

export const useLibraryStore = create((set, get) => ({
  library: [],
  filterQuery: '',
  sortKey: 'date',
  sortOrder: 'desc',
  isLoading: false,
  error: null,

  setFilterQuery: (query) => set({ filterQuery: query }),

  setSort: (key, order) => {
    set(state => ({
      sortKey: key !== undefined ? key : state.sortKey,
      sortOrder: order !== undefined ? order : state.sortOrder
    }));
  },

  loadLibrary: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.fetchLibrary();
      set({ library: data || [], isLoading: false });
    } catch (err) {
      set({ error: err.message, isLoading: false });
    }
  },

  setLibrary: (data) => {
    if (Array.isArray(data)) {
      set({ library: data });
    }
  },

  removeSong: async (id) => {
    try {
      set(state => ({ library: state.library.filter(s => s.id !== id) }));
      await api.removeFromLibrary(id);
    } catch (err) {
      console.error("Remove from library error:", err);
      await get().loadLibrary();
    }
  },

  getFilteredAndSorted: () => {
    const { library, filterQuery, sortKey, sortOrder } = get();
    let result = [...library];

    if (filterQuery && filterQuery.trim()) {
      const q = filterQuery.toLowerCase().trim();
      result = result.filter(song => {
        const title = (song.title || '').toLowerCase();
        const artist = (song.artist || '').toLowerCase();
        return title.includes(q) || artist.includes(q);
      });
    }

    result.sort((a, b) => {
      let valA, valB;
      if (sortKey === 'title') {
        valA = (a.title || '').toLowerCase();
        valB = (b.title || '').toLowerCase();
      } else if (sortKey === 'artist') {
        valA = (a.artist || '').toLowerCase();
        valB = (b.artist || '').toLowerCase();
      } else if (sortKey === 'missing') {
        // Sort songs with missing stems/lyrics first
        const hasA = (a.stems?.inst && a.stems?.lead && (a.lyrics?.length || a.hasLyrics));
        const hasB = (b.stems?.inst && b.stems?.lead && (b.lyrics?.length || b.hasLyrics));
        valA = hasA ? 1 : 0;
        valB = hasB ? 1 : 0;
      } else {
        // Date added (or ID fallback)
        valA = a.createdAt || a.id || 0;
        valB = b.createdAt || b.id || 0;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }
}));
