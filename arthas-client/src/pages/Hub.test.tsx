/**
 * Hub page component tests.
 *
 * Tests: loading state, empty state, room grid rendering, back button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Hub } from './Hub';
import { useHubStore } from '../hub/hubStore';
import { usePageStore } from '../stores/pageStore';

// Mock i18n
vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    },
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

// Mock HubFilters to keep test focused on Hub page logic
vi.mock('../components/HubFilters', () => ({
  HubFilters: () => <div data-testid="hub-filters" />,
}));

// Mock HubRoomCard
vi.mock('../components/HubRoomCard', () => ({
  HubRoomCard: ({ room }: { room: { title: string } }) => (
    <div data-testid="hub-room-card">{room.title}</div>
  ),
}));

// Mock hubApi to prevent real network calls from startPolling
vi.mock('../hub/hubApi', () => ({
  fetchHubRooms: vi.fn().mockResolvedValue({ rooms: [], total: 0, limit: 50, offset: 0, totalOnline: 0 }),
}));

describe('Hub page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to known state BEFORE render (startPolling will fire on mount)
    useHubStore.setState({
      rooms: [],
      total: 0,
      loading: false,
      error: null,
      filters: { tag: '', query: '' },
      totalOnline: 0,
    });
    usePageStore.setState({ page: 'hub' });
  });

  afterEach(() => {
    useHubStore.getState().stopPolling();
  });

  it('renders hub title', async () => {
    await act(async () => { render(<Hub />); });
    expect(screen.getByText('hub.title')).toBeInTheDocument();
  });

  it('renders back button that navigates home', async () => {
    await act(async () => { render(<Hub />); });
    const backBtn = screen.getByText(/hub\.backHome/);
    fireEvent.click(backBtn);
    expect(usePageStore.getState().page).toBe('home');
  });

  it('shows empty state when no rooms and not loading', async () => {
    await act(async () => { render(<Hub />); });
    // After startPolling resolves, loading becomes false, rooms is []
    expect(screen.getByText('hub.empty')).toBeInTheDocument();
  });

  it('renders room cards when rooms are available', async () => {
    // Set rooms AFTER mount (simulate poll result)
    await act(async () => { render(<Hub />); });
    act(() => {
      useHubStore.setState({
        rooms: [
          { roomId: '1', title: 'Room A', shareCode: '1:k:0:0', description: '', tags: [], memberCount: 2, hasPassword: false, createdAt: 1000, expiresAt: 0, messageCount5min: 0 },
          { roomId: '2', title: 'Room B', shareCode: '2:k:0:0', description: '', tags: [], memberCount: 1, hasPassword: true, createdAt: 2000, expiresAt: 0, messageCount5min: 0 },
        ],
        total: 2,
        loading: false,
      });
    });

    const cards = screen.getAllByTestId('hub-room-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('Room A')).toBeInTheDocument();
    expect(screen.getByText('Room B')).toBeInTheDocument();
  });

  it('shows room count when rooms available', async () => {
    await act(async () => { render(<Hub />); });
    act(() => {
      useHubStore.setState({ rooms: [], total: 42, loading: false, error: null });
    });
    expect(screen.getByText(/hub\.roomCount/)).toBeInTheDocument();
  });

  it('shows error message on error', async () => {
    await act(async () => { render(<Hub />); });
    act(() => {
      useHubStore.setState({ error: 'Network error', loading: false });
    });
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('renders HubFilters component', async () => {
    await act(async () => { render(<Hub />); });
    expect(screen.getByTestId('hub-filters')).toBeInTheDocument();
  });
});
