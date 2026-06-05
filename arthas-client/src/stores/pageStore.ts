/**
 * @file Page navigation store — lightweight Zustand store for page routing.
 *
 * The app uses state-based routing (no React Router).
 * This store manages which top-level page is currently displayed.
 *
 * @module stores/pageStore
 */

import { create } from 'zustand';

export type Page = 'home' | 'hub';

interface PageState {
  page: Page;
  setPage: (page: Page) => void;
}

export const usePageStore = create<PageState>((set) => ({
  page: 'home',
  setPage: (page) => set({ page }),
}));
