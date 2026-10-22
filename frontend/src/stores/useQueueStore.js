import { create } from 'zustand';
import * as api from '../services/api';

export const useQueueStore = create((set, get) => ({
  queue: [],
  isLoading: false,
  error: null,
  draggedQueueItem: null,
  draggedLibrarySong: null,
  isDraggingQueue: false,
  isDragOutsideQueue: false,

  setDraggedQueueItem: (item) => set({ draggedQueueItem: item }),
  setDraggedLibrarySong: (song) => set({ draggedLibrarySong: song }),
  setIsDraggingQueue: (isDragging) => set({ isDraggingQueue: isDragging }),
  setIsDragOutsideQueue: (isOutside) => set({ isDragOutsideQueue: isOutside }),

  loadQueue: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.fetchQueue();
      set({ queue: data || [], isLoading: false });
    } catch (err) {
      set({ error: err.message, isLoading: false });
    }
  },

  setQueue: (items) => {
    if (Array.isArray(items)) {
      set({ queue: items });
    }
  },

  enqueue: async (song, insertIndex = undefined) => {
    try {
      const res = await api.enqueueSong(song, insertIndex);
      if (res && res.queue) {
        set({ queue: res.queue });
      } else {
        await get().loadQueue();
      }
      return true;
    } catch (err) {
      console.error("Enqueue error:", err);
      return false;
    }
  },

  reorderItem: async (queueId, direction) => {
    try {
      const res = await api.reorderQueueItem(queueId, direction);
      if (res && res.queue) {
        set({ queue: res.queue });
      } else {
        await get().loadQueue();
      }
    } catch (err) {
      console.error("Reorder item error:", err);
    }
  },

  reorderAll: async (queueIds) => {
    try {
      // Optimistic update
      set((state) => {
        const queueMap = new Map(state.queue.map(s => [String(s.queueId || s.id), s]));
        const newQueue = [];
        for (const id of queueIds) {
          const sId = String(id);
          if (queueMap.has(sId)) {
            newQueue.push(queueMap.get(sId));
            queueMap.delete(sId);
          }
        }
        for (const rem of queueMap.values()) {
          newQueue.push(rem);
        }
        return { queue: newQueue };
      });

      const res = await api.reorderQueueList(queueIds);
      if (res && res.queue) {
        set({ queue: res.queue });
      }
    } catch (err) {
      console.error("Reorder all error:", err);
      await get().loadQueue();
    }
  },

  remove: async (queueId) => {
    try {
      // Optimistic update
      set(state => ({ queue: state.queue.filter(q => q.queueId !== queueId) }));
      await api.removeFromQueue(queueId);
    } catch (err) {
      console.error("Remove from queue error:", err);
      await get().loadQueue();
    }
  }
}));
