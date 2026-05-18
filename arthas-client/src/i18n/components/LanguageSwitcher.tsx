/**
 * @file LanguageSwitcher — 语言切换下拉菜单组件
 *
 * 📚 学习要点: 下拉菜单的无障碍设计
 * - aria-expanded 告知屏幕阅读器菜单是否展开
 * - aria-label 提供按钮的语义描述
 * - 点击外部关闭（useEffect + document click listener）
 * - Escape 键关闭
 * - role="menu" / role="menuitem" 标识菜单结构
 *
 * 📚 学习要点: 为什么用 useRef + useEffect 监听外部点击？
 * 下拉菜单需要在用户点击菜单外部时自动关闭。通过 ref 获取容器 DOM 节点，
 * 在 document 上监听 mousedown 事件，判断点击目标是否在容器内。
 * 使用 mousedown 而非 click 是因为 mousedown 在 click 之前触发，
 * 能更快响应用户意图，避免与菜单项的 click 事件冲突。
 *
 * @module i18n/components/LanguageSwitcher
 */

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from '../index';
import type { Locale } from '../types';

/** 支持的语言列表配置 */
const languages: { code: Locale; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
];

/**
 * 语言切换下拉菜单 — 允许用户在支持的语言间切换
 *
 * 功能特性：
 * - 🌐 Globe 图标按钮，桌面端显示当前语言缩写
 * - 点击展开下拉菜单，显示所有可选语言
 * - 当前语言带 ✓ 标记
 * - 点击外部或按 Escape 关闭
 * - 响应式：移动端仅显示图标，桌面端显示缩写标签
 */
export function LanguageSwitcher() {
  const { t, locale, setLocale } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 📚 学习要点: 点击外部关闭 + Escape 键关闭
  // 仅在菜单打开时注册监听器，关闭时清理，避免不必要的事件监听开销
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  /**
   * 切换语言并关闭菜单
   * 📚 学习要点: setLocale 会更新 Zustand store，触发所有使用 useTranslation 的组件重渲染
   */
  const handleSelect = (code: Locale) => {
    setLocale(code);
    setOpen(false);
  };

  // 按钮上显示的短标签：中/EN/日
  const shortLabel = locale === 'zh' ? '中' : locale === 'ja' ? '日' : 'EN';

  return (
    <div className="relative" ref={ref}>
      {/* 触发按钮 */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={t('language.switch')}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center gap-1 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-700 px-2"
      >
        <span aria-hidden="true">🌐</span>
        <span className="hidden md:inline text-sm">{shortLabel}</span>
      </button>

      {/* 下拉菜单 */}
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-36 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-50 py-1 animate-fade-in motion-reduce:animate-none"
        >
          {languages.map((lang) => (
            <button
              key={lang.code}
              role="menuitem"
              onClick={() => handleSelect(lang.code)}
              className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between transition-colors ${
                locale === lang.code
                  ? 'text-white bg-gray-600'
                  : 'text-gray-300 hover:bg-gray-600 hover:text-white'
              }`}
            >
              <span>{lang.label}</span>
              {locale === lang.code && (
                <span aria-hidden="true" className="text-green-400">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
