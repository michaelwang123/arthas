/**
 * @file TagSelector — 兴趣标签选择器，允许用户选择 0-3 个兴趣标签用于匹配偏好
 *
 * 预定义标签: #tech, #music, #gaming, #random, #language, #movies
 * 从 matchStore.selectedTags 加载上次选择的标签。
 * 支持键盘导航 + ARIA 标签。
 *
 * @module match/TagSelector
 */

import { useState, useCallback, useRef } from 'react';
import { useTranslation } from '../i18n';
import { useMatchStore } from './matchStore';

const PREDEFINED_TAGS = ['tech', 'music', 'gaming', 'random', 'language', 'movies'] as const;
const MAX_TAGS = 3;

interface TagSelectorProps {
  /** 确认选择的回调，传入当前选中的标签列表 */
  onConfirm: (tags: string[]) => void;
}

/**
 * 兴趣标签选择器组件。
 *
 * 功能：
 * - 显示 6 个预定义标签，toggle 选中/取消
 * - 最多选择 3 个标签（已满时禁用其余未选中标签）
 * - 加载 matchStore.selectedTags 作为初始选中状态
 * - 键盘导航：左右方向键切换焦点，Enter/Space 切换选中
 * - 完整 ARIA 支持
 */
export function TagSelector({ onConfirm }: TagSelectorProps) {
  const { t } = useTranslation();
  const storedTags = useMatchStore((s) => s.selectedTags);
  const [selected, setSelected] = useState<string[]>(() =>
    storedTags.filter((tag) => (PREDEFINED_TAGS as readonly string[]).includes(tag))
  );
  const tagRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const toggleTag = useCallback((tag: string) => {
    setSelected((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((t) => t !== tag);
      }
      if (prev.length >= MAX_TAGS) return prev;
      return [...prev, tag];
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      let nextIndex = -1;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextIndex = (index + 1) % PREDEFINED_TAGS.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        nextIndex = (index - 1 + PREDEFINED_TAGS.length) % PREDEFINED_TAGS.length;
      }

      if (nextIndex >= 0) {
        tagRefs.current[nextIndex]?.focus();
      }
    },
    []
  );

  const handleConfirm = useCallback(() => {
    onConfirm(selected);
  }, [onConfirm, selected]);

  return (
    <div className="space-y-4" role="group" aria-label={t('match.tagSelector.title')}>
      <p className="text-sm text-gray-400">
        {t('match.tagSelector.hint')}
      </p>

      <div className="flex flex-wrap gap-2" role="listbox" aria-multiselectable="true">
        {PREDEFINED_TAGS.map((tag, index) => {
          const isSelected = selected.includes(tag);
          const isDisabled = !isSelected && selected.length >= MAX_TAGS;

          return (
            <button
              key={tag}
              ref={(el) => { tagRefs.current[index] = el; }}
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-disabled={isDisabled}
              disabled={isDisabled}
              onClick={() => toggleTag(tag)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              tabIndex={index === 0 ? 0 : -1}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                isSelected
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : isDisabled
                    ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                    : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-400'
              }`}
            >
              #{tag}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {selected.length}/{MAX_TAGS}
        </span>
        <button
          type="button"
          onClick={handleConfirm}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
        >
          {t('match.tagSelector.confirm')}
        </button>
      </div>
    </div>
  );
}
