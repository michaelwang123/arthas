/**
 * @file FileAttachButton.tsx — 文件附件按钮组件
 *
 * 本组件提供一个 📎 图标按钮，用于触发文件选择对话框。
 * 它是用户发起文件传输的主要入口之一（另外两个是拖拽和剪贴板粘贴）。
 *
 * 📚 学习要点: 隐藏 input[type="file"] 模式
 * 浏览器原生的文件选择器 `<input type="file">` 外观无法自定义，
 * 且在不同浏览器/操作系统上样式不一致。
 * 常见解决方案是：
 * 1. 将 `<input type="file">` 设为 `display: none` 或 `opacity: 0`
 * 2. 创建一个自定义样式的按钮
 * 3. 按钮点击时通过 `inputRef.current.click()` 触发隐藏 input 的文件选择
 * 4. 监听 input 的 `onChange` 事件获取用户选择的文件
 *
 * 这样既保留了浏览器原生的文件选择功能（安全沙箱），
 * 又能完全自定义按钮的外观和交互。
 *
 * 无障碍设计：
 * - 使用 `<button>` 元素（天然支持 Enter/Space 键盘激活）
 * - 提供 `aria-label` 描述按钮功能
 * - 触摸目标 ≥ 44px（WCAG 2.5.5 Target Size）
 *
 * @module file-transfer/components/FileAttachButton
 * @see requirements.md — Requirements 1.6, 12.1, NFR-12
 */

import { useRef, useCallback } from 'react';
import { useFileTransferStore, getLargeRoomWarning } from '../fileTransferStore';

/**
 * 文件附件按钮 — 📎 图标，点击后打开系统文件选择对话框。
 *
 * 📚 学习要点: 组件职责单一化
 * 此组件只负责：
 * 1. 渲染按钮 UI（图标、样式、无障碍属性）
 * 2. 触发文件选择对话框
 * 3. 获取用户选择的文件并传递给 fileTransferStore
 *
 * 不负责：
 * - 文件验证（由 fileTransferStore.initiateTransfer 处理）
 * - 传输状态管理（由 fileTransferStore 处理）
 * - 进度显示（由 FileMessage / ProgressBar 组件处理）
 *
 * @example
 * ```tsx
 * // 在 MessageInput 中使用
 * <div className="flex gap-2 items-center">
 *   <FileAttachButton />
 *   <input ... />
 *   <button>发送</button>
 * </div>
 * ```
 */
export function FileAttachButton() {
  /**
   * 📚 学习要点: useRef 持有 DOM 引用
   * 使用 useRef 获取隐藏 input 元素的引用，
   * 以便在按钮点击时通过 `.click()` 方法触发文件选择对话框。
   * useRef 不会触发重渲染，适合存储 DOM 引用。
   */
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * 处理按钮点击：触发隐藏的文件选择 input。
   *
   * 📚 学习要点: 为什么使用 useCallback？
   * 此函数作为 onClick 事件处理器传递给 button 元素。
   * 使用 useCallback 确保函数引用稳定，避免不必要的子组件重渲染。
   * 虽然对于简单按钮影响不大，但养成良好习惯有助于性能优化。
   */
  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /**
   * 处理文件选择：用户在文件对话框中选择文件后触发。
   *
   * 📚 学习要点: 大房间警告的 UI 交互流程
   * 1. 用户选择文件 → onChange 触发
   * 2. 检查是否需要大房间警告（getLargeRoomWarning）
   * 3. 如果需要警告 → 显示 confirm 对话框（浏览器原生）
   * 4. 用户确认 → 调用 initiateTransfer
   * 5. 用户取消 → 不发起传输
   *
   * 为什么使用 window.confirm 而非自定义 Modal？
   * - 简单直接，无需额外状态管理
   * - 阻塞式交互，确保用户做出明确选择
   * - 学习项目中优先简单实现，后续可升级为自定义 Modal
   *
   * @see requirements.md — Requirement 7.6
   */
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // 大房间警告检查
    const warning = getLargeRoomWarning();
    if (warning) {
      const confirmed = window.confirm(warning);
      if (!confirmed) {
        // 用户取消，重置 input 以允许再次选择同一文件
        e.target.value = '';
        return;
      }
    }

    // 发起文件传输
    useFileTransferStore.getState().initiateTransfer(file);

    // 📚 学习要点: 重置 input value
    // 将 input 的 value 重置为空字符串，确保用户可以再次选择同一个文件。
    // 如果不重置，选择相同文件时 onChange 不会触发（因为 value 没变化）。
    e.target.value = '';
  }, []);

  return (
    <>
      {/*
        📚 学习要点: 按钮无障碍设计
        - <button> 元素天然支持键盘操作（Enter/Space 激活）
        - aria-label 为屏幕阅读器提供按钮描述
        - min-w-[44px] min-h-[44px] 确保触摸目标足够大（WCAG 2.5.5）
        - hover/focus 状态提供视觉反馈
      */}
      <button
        type="button"
        onClick={handleClick}
        aria-label="添加附件"
        title="发送文件"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xl text-gray-400 hover:text-white focus:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 focus:ring-offset-gray-800 rounded-lg transition-colors"
      >
        📎
      </button>

      {/* 📚 学习要点: 隐藏的文件选择 input
        - className="hidden" 使其不可见且不占据布局空间
        - accept 设为通配符，允许选择所有文件类型（Requirement 1.4）
        - tabIndex={-1} 从 Tab 顺序中移除（用户通过按钮交互，不需要直接 Tab 到 input）
        - aria-hidden="true" 对屏幕阅读器隐藏（按钮已提供无障碍描述）
      */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        onChange={handleFileChange}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />
    </>
  );
}
