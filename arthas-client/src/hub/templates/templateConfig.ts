import type { TranslationKey } from '../../i18n';

/** Theme color for template card visual styling */
export type TemplateThemeColor =
  | 'indigo'
  | 'emerald'
  | 'amber'
  | 'purple'
  | 'blue'
  | 'orange'
  | 'pink';

/**
 * Static configuration for a room template.
 * Defines all parameters needed to pre-fill createRoom() and render the card.
 */
export interface TemplateConfig {
  /** Unique identifier for the template (used as key) */
  id: string;
  /** Emoji icon displayed prominently on the card */
  emoji: string;
  /** i18n key for the template display name — compile-time validated */
  nameKey: TranslationKey;
  /** i18n key for the template short description — compile-time validated */
  descriptionKey: TranslationKey;
  /** Preset tags for the created room's public listing (at least one required) */
  tags: [string, ...string[]];
  /** Room expiry duration in seconds (0 = no expiry) */
  expirySeconds: number;
  /** Ephemeral mode timer in seconds (0 = disabled) */
  ephemeralSeconds: number;
  /** Whether to show password input during creation (recommended, not required) */
  passwordRecommended: boolean;
  /** Theme color for card border, glow, and hover effects */
  themeColor: TemplateThemeColor;
}

/** All available room templates — single source of truth */
export const ROOM_TEMPLATES: readonly TemplateConfig[] = [
  {
    id: 'interview-prep',
    emoji: '💼',
    nameKey: 'hub.templates.interviewPrep.name',
    descriptionKey: 'hub.templates.interviewPrep.desc',
    tags: ['interview', 'practice'],
    expirySeconds: 3600,
    ephemeralSeconds: 60,
    passwordRecommended: false,
    themeColor: 'indigo',
  },
  {
    id: 'debug-help',
    emoji: '🐛',
    nameKey: 'hub.templates.debugHelp.name',
    descriptionKey: 'hub.templates.debugHelp.desc',
    tags: ['debug', 'help'],
    expirySeconds: 0,
    ephemeralSeconds: 0,
    passwordRecommended: false,
    themeColor: 'emerald',
  },
  {
    id: 'team-retro',
    emoji: '🔄',
    nameKey: 'hub.templates.teamRetro.name',
    descriptionKey: 'hub.templates.teamRetro.desc',
    tags: ['team', 'retro'],
    expirySeconds: 0,
    ephemeralSeconds: 0,
    passwordRecommended: true,
    themeColor: 'purple',
  },
  {
    id: 'anonymous-feedback',
    emoji: '💭',
    nameKey: 'hub.templates.anonymousFeedback.name',
    descriptionKey: 'hub.templates.anonymousFeedback.desc',
    tags: ['anonymous', 'feedback'],
    expirySeconds: 86400,
    ephemeralSeconds: 30,
    passwordRecommended: false,
    themeColor: 'amber',
  },
  {
    id: 'study-room',
    emoji: '🎓',
    nameKey: 'hub.templates.studyRoom.name',
    descriptionKey: 'hub.templates.studyRoom.desc',
    tags: ['study', 'focus'],
    expirySeconds: 7200,
    ephemeralSeconds: 0,
    passwordRecommended: false,
    themeColor: 'blue',
  },
  {
    id: 'coffee-chat',
    emoji: '☕',
    nameKey: 'hub.templates.coffeeChat.name',
    descriptionKey: 'hub.templates.coffeeChat.desc',
    tags: ['chat', 'casual'],
    expirySeconds: 1800,
    ephemeralSeconds: 0,
    passwordRecommended: false,
    themeColor: 'orange',
  },
  {
    id: 'game-night',
    emoji: '🎮',
    nameKey: 'hub.templates.gameNight.name',
    descriptionKey: 'hub.templates.gameNight.desc',
    tags: ['game', 'fun'],
    expirySeconds: 0,
    ephemeralSeconds: 0,
    passwordRecommended: false,
    themeColor: 'pink',
  },
] as const;
