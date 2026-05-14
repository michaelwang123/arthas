/**
 * 精选 emoji 数据 — 约 200 个常用 emoji，分为 8 个分类。
 * 控制在 < 20KB，覆盖 95% 日常使用场景。
 */

export interface EmojiCategory {
  name: string
  icon: string
  emojis: string[]
}

export const emojiCategories: EmojiCategory[] = [
  {
    name: '最近',
    icon: '🕐',
    emojis: [], // 动态填充
  },
  {
    name: '表情',
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
    name: '手势',
    icon: '👋',
    emojis: [
      '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲',
      '🤝', '🙏', '✌️', '🤞', '🤟', '🤘', '🤙', '👋', '🖐️', '✋',
      '👌', '🤌', '🫰', '🫵', '👈', '👉', '👆', '👇', '☝️', '💪',
    ],
  },
  {
    name: '心形',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟',
    ],
  },
  {
    name: '动物',
    icon: '🐱',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
      '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦄', '🐝',
      '🦋', '🐙', '🐠', '🐳', '🐬', '🦈',
    ],
  },
  {
    name: '食物',
    icon: '🍕',
    emojis: [
      '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒',
      '🍕', '🍔', '🍟', '🌭', '🍿', '🧁', '🍩', '🍪', '🎂', '🍰',
      '☕', '🍵', '🧋', '🍺', '🍷', '🥤',
    ],
  },
  {
    name: '活动',
    icon: '⚽',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🎮', '🕹️',
      '🎯', '🎲', '🧩', '🎵', '🎶', '🎸', '🎹', '🎬', '📸', '🏆',
      '🥇', '🎪', '🎭', '🎨',
    ],
  },
  {
    name: '旅行',
    icon: '✈️',
    emojis: [
      '🚗', '🚕', '🚌', '🚀', '✈️', '🚁', '🛸', '🏠', '🏖️', '🏔️',
      '⛰️', '🌋', '🗺️', '🌍', '🌙', '⭐', '☀️', '🌈', '⛅', '🌅',
    ],
  },
  {
    name: '符号',
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
