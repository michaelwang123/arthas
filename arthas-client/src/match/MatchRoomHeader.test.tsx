/**
 * @file MatchRoomHeader.test.tsx — MatchRoom header component unit tests
 *
 * Tests:
 * - Renders partner name when present
 * - Shows "Waiting for partner..." placeholder when partner name is absent
 * - Shows ephemeral duration badge when ephemeral > 0
 * - Hides ephemeral badge when ephemeral = 0
 * - Does NOT render room ID or Leave button
 * - Renders E2EE lock icon with accessible label
 *
 * @module match/MatchRoomHeader.test
 * @see requirements.md — Requirements 3.1, 3.3, 3.4
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MatchRoomHeader } from './MatchRoomHeader';

// ============================================================================
// Mock setup
// ============================================================================

// Mock i18n — returns English translations for relevant keys
vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'match.room.waitingForPartner': 'Waiting for partner...',
        'match.room.e2eeLabel': 'End-to-end encrypted',
      };
      return translations[key] ?? key;
    },
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

// Mock ExpiryCountdown — renders a simple stub to avoid timer complexity
vi.mock('../components/ExpiryCountdown', () => ({
  ExpiryCountdown: ({ expiresAt }: { expiresAt: number }) => (
    <span data-testid="expiry-countdown" data-expires-at={expiresAt}>
      countdown
    </span>
  ),
}));

// ============================================================================
// Tests
// ============================================================================

describe('MatchRoomHeader', () => {
  describe('partner name display', () => {
    it('renders partner name when present', () => {
      render(
        <MatchRoomHeader partnerName="🐱 Cat" expiresAt={1700000000} ephemeral={60} />
      );

      expect(screen.getByText('🐱 Cat')).toBeInTheDocument();
    });

    it('shows "Waiting for partner..." when partner name is null', () => {
      render(
        <MatchRoomHeader partnerName={null} expiresAt={1700000000} ephemeral={60} />
      );

      expect(screen.getByText('Waiting for partner...')).toBeInTheDocument();
    });
  });

  describe('ephemeral duration badge', () => {
    it('renders duration badge when ephemeral > 0', () => {
      render(
        <MatchRoomHeader partnerName="🦊 Fox" expiresAt={1700000000} ephemeral={60} />
      );

      expect(screen.getByText('⏱️ 60s')).toBeInTheDocument();
    });

    it('does not render duration badge when ephemeral = 0', () => {
      render(
        <MatchRoomHeader partnerName="🦊 Fox" expiresAt={1700000000} ephemeral={0} />
      );

      expect(screen.queryByText(/⏱️/)).not.toBeInTheDocument();
    });
  });

  describe('E2EE indicator', () => {
    it('renders lock icon with accessible aria-label', () => {
      render(
        <MatchRoomHeader partnerName="🐼 Panda" expiresAt={1700000000} ephemeral={30} />
      );

      const lockIcon = screen.getByLabelText('End-to-end encrypted');
      expect(lockIcon).toBeInTheDocument();
      expect(lockIcon.textContent).toBe('🔒');
    });

    it('has role="img" for screen reader compatibility', () => {
      render(
        <MatchRoomHeader partnerName="🐼 Panda" expiresAt={1700000000} ephemeral={30} />
      );

      const lockIcon = screen.getByRole('img', { name: 'End-to-end encrypted' });
      expect(lockIcon).toBeInTheDocument();
    });
  });

  describe('ExpiryCountdown integration', () => {
    it('passes expiresAt to ExpiryCountdown', () => {
      render(
        <MatchRoomHeader partnerName="🐱 Cat" expiresAt={1700000000} ephemeral={0} />
      );

      const countdown = screen.getByTestId('expiry-countdown');
      expect(countdown).toBeInTheDocument();
      expect(countdown).toHaveAttribute('data-expires-at', '1700000000');
    });
  });

  describe('header does NOT contain room ID or Leave button', () => {
    it('does not render any Leave or room ID text', () => {
      render(
        <MatchRoomHeader partnerName="🦁 Lion" expiresAt={1700000000} ephemeral={60} />
      );

      // No "Leave" button should exist
      expect(screen.queryByRole('button', { name: /leave/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/leave/i)).not.toBeInTheDocument();

      // No room ID should be displayed (room IDs are typically UUIDs or short codes)
      expect(screen.queryByText(/room/i)).not.toBeInTheDocument();
    });
  });
});
