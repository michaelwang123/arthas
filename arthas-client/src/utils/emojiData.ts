/**
 * 精选 emoji 数据 — 约 200 个常用 emoji，分为 8 个分类。
 * 控制在 < 20KB，覆盖 95% 日常使用场景。
 */

import type { TranslationKey } from '../i18n';

export interface EmojiCategory {
  nameKey: TranslationKey
  icon: string
  emojis: string[]
}

export const emojiCategories: EmojiCategory[] = [
  {
    nameKey: 'emoji.category.recent',
    icon: '🕐',
    emojis: [], // 动态填充
  },
  {
    nameKey: 'emoji.category.smileys',
    icon: '😊',
    emojis: [
      '😀', '😃', '😄', '😁', '😂', '🤣', '😅', '😊', '😇', '🙂',
      '😉', '😍', '🥰', '😘', '😋', '🤔', '🤨', '😐', '😑', '😶',
      '🙄', '😏', '😣', '😥', '😮', '🤐', '😯', '😪', '😫', '🥱',
      '😴', '😌', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫',
      '🤥', '😬', '😰', '😨', '😱', '🥶', '🥵', '😳', '🤯', '😭',
      '😤', '😡', '🤬', '😈', '👿', '💀', '☠️', '🤡', '👻', '😎',
    ],
  },
  {
    nameKey: 'emoji.category.gestures',
    icon: '👋',
    emojis: [
      '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲',
      '🤝', '🙏', '✌️', '🤞', '🤟', '🤘', '🤙', '👋', '🖐️', '✋',
      '👌', '🤌', '🫰', '🫵', '👈', '👉', '👆', '👇', '☝️', '💪',
    ],
  },
  {
    nameKey: 'emoji.category.hearts',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟',
    ],
  },
  {
    nameKey: 'emoji.category.animals',
    icon: '🐱',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
      '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦄', '🐝',
      '🦋', '🐙', '🐠', '🐳', '🐬', '🦈',
    ],
  },
  {
    nameKey: 'emoji.category.food',
    icon: '🍕',
    emojis: [
      '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒',
      '🍕', '🍔', '🍟', '🌭', '🍿', '🧁', '🍩', '🍪', '🎂', '🍰',
      '☕', '🍵', '🧋', '🍺', '🍷', '🥤',
    ],
  },
  {
    nameKey: 'emoji.category.activities',
    icon: '⚽',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🎮', '🕹️',
      '🎯', '🎲', '🧩', '🎵', '🎶', '🎸', '🎹', '🎬', '📸', '🏆',
      '🥇', '🎪', '🎭', '🎨',
    ],
  },
  {
    nameKey: 'emoji.category.travel',
    icon: '✈️',
    emojis: [
      '🚗', '🚕', '🚌', '🚀', '✈️', '🚁', '🛸', '🏠', '🏖️', '🏔️',
      '⛰️', '🌋', '🗺️', '🌍', '🌙', '⭐', '☀️', '🌈', '⛅', '🌅',
    ],
  },
  {
    nameKey: 'emoji.category.symbols',
    icon: '💯',
    emojis: [
      '💯', '✅', '❌', '⭕', '❗', '❓', '‼️', '⁉️', '💡', '🔥',
      '⚡', '💫', '✨', '🎉', '🎊', '💢', '💤', '🚫', '♻️', '🔒',
      '🔓', '🏳️', '🏴', '🚩',
    ],
  },
]

const RECENT_KEY = 'arthas_recent_emojis'
const MAX_RECENT = 16

export function getRecentEmojis(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

export function addRecentEmoji(emoji: string): void {
  const recent = getRecentEmojis().filter((e) => e !== emoji)
  recent.unshift(emoji)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)))
}
