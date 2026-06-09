/**
 * HubFilters component tests — sort mode buttons.
 *
 * Validates: Requirements 4.1, 4.3, 4.7, 4.8
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { HubFilters } from './HubFilters';
import { useHubStore } from '../hub/hubStore';

// Mock i18n — returns key as translation value (same pattern as Hub.test.tsx)
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

// Mock hubApi to prevent real network calls triggered by setSortMode → fetchRooms
vi.mock('../hub/hubApi', () => ({
  fetchHubRooms: vi.fn().mockResolvedValue({ rooms: [], total: 0, limit: 50, offset: 0, totalOnline: 0 }),
}));

describe('HubFilters sort buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to default state
    useHubStore.setState({
      rooms: [],
      total: 0,
      loading: false,
      error: null,
      filters: { tag: '', query: '' },
      sortMode: '',
      totalOnline: 0,
    });
  });

  it('renders 4 sort buttons with correct labels', () => {
    render(<HubFilters />);

    // Scope queries to the toolbar to avoid matching aria-live region
    const toolbar = screen.getByRole('toolbar', { name: 'hub.sort.all' });
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons).toHaveLength(4);

    // Verify each label key is rendered within the toolbar buttons
    expect(within(toolbar).getByText('hub.sort.all')).toBeInTheDocument();
    expect(buttons[1].textContent).toContain('hub.sort.active');
    expect(buttons[2].textContent).toContain('hub.sort.people');
    expect(buttons[3].textContent).toContain('hub.sort.newest');
  });

  it('clicking sort button calls setSortMode with correct value', () => {
    render(<HubFilters />);

    // Scope to toolbar and click the "Most Active" button (second button)
    const toolbar = screen.getByRole('toolbar', { name: 'hub.sort.all' });
    const buttons = within(toolbar).getAllByRole('button');
    fireEvent.click(buttons[1]); // "Most Active" is the second button

    // Store should now have sortMode = 'active'
    expect(useHubStore.getState().sortMode).toBe('active');
  });

  it('active button has aria-pressed="true" and others have aria-pressed="false"', () => {
    // Set sortMode to 'active' before rendering
    useHubStore.setState({ sortMode: 'active' });

    render(<HubFilters />);

    const toolbar = screen.getByRole('toolbar', { name: 'hub.sort.all' });
    const buttons = within(toolbar).getAllByRole('button');

    // buttons[0] = All, buttons[1] = Most Active, buttons[2] = Most People, buttons[3] = Newest
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[3]).toHaveAttribute('aria-pressed', 'false');
  });

  it('aria-live region announces sort change', async () => {
    // Start with default sort mode
    useHubStore.setState({ sortMode: '' });

    const { rerender } = render(<HubFilters />);

    // Verify initially empty (no announcement on first render)
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion!.textContent).toBe('');

    // Change sort mode and re-render
    useHubStore.setState({ sortMode: 'active' });
    rerender(<HubFilters />);

    // After re-render with changed sortMode, the useEffect fires and sets announcement
    // Wait for the effect to apply
    await vi.waitFor(() => {
      expect(liveRegion!.textContent).toContain('hub.sort.changed');
    });
    expect(liveRegion!.textContent).toContain('hub.sort.active');
  });
});
