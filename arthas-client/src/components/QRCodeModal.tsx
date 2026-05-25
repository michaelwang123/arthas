/**
 * QR 码模态框组件 — 显示房间加入链接的 QR 码。
 *
 * 在整体架构中的角色：
 * - 属于 Share_Panel 的子组件，由"显示 QR 码"按钮触发打开
 * - 依赖 `src/qr/generator.ts` 的 generateQRCode + buildJoinURL 生成 QR 码
 * - 使用 i18n 模块提供多语言支持（zh/en/ja）
 *
 * 设计决策：
 * - 响应式布局：<640px 显示 200px QR 码，>=640px 显示 256px（适配手机扫描距离）
 * - 始终使用黑色模块 + 白色背景（确保扫描兼容性，不受暗色主题影响）
 * - 支持三种关闭方式：Escape 键、点击外部遮罩、关闭按钮（无障碍最佳实践）
 *
 * 📚 学习要点: QR 码缓存策略
 * 使用 useEffect + state 缓存 QR data URL，避免每次打开 modal 都重新生成。
 * shareCode 在房间生命周期内不变，因此 QR 码只需生成一次。
 * 依赖数组为 [shareCode]，仅在分享码变化时重新生成。
 * 这是一种常见的"计算结果缓存"模式：将异步计算的结果存入 state，
 * 通过 useEffect 的依赖数组控制何时重新计算，避免不必要的重复工作。
 *
 * @module components/QRCodeModal
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { generateQRCode, buildJoinURL } from '../qr/generator';
import { useTranslation } from '../i18n';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * QRCodeModal 组件的 props。
 */
interface QRCodeModalProps {
  /** 是否显示模态框 */
  open: boolean;
  /** 关闭回调（Escape 键、点击外部、关闭按钮均触发） */
  onClose: () => void;
  /** 分享码字符串（用于生成 QR 码内容） */
  shareCode: string;
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * QR 码模态框 — 将房间加入链接编码为 QR 码图像，供手机扫码加入。
 *
 * 功能特性：
 * - 异步生成 QR 码 Data URL 并缓存（shareCode 不变则不重新生成）
 * - 响应式尺寸：移动端 200px，桌面端 256px（使用 Tailwind sm: 断点）
 * - 固定黑白配色确保所有 QR 扫描器兼容
 * - 完整的无障碍支持：role="dialog"、aria-modal、alt text
 * - 生成失败时显示 fallback 错误文本
 *
 * @param props - 组件属性
 * @returns React 元素或 null（未打开时）
 */
export function QRCodeModal({ open, onClose, shareCode }: QRCodeModalProps) {
  const { t } = useTranslation();

  // QR 码 Data URL 缓存状态
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  // 生成错误状态
  const [error, setError] = useState<string | null>(null);

  // 关闭按钮 ref，用于打开时聚焦
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  // 内容面板 ref，用于检测点击外部
  const panelRef = useRef<HTMLDivElement>(null);

  // --------------------------------------------------------------------------
  // 📚 学习要点: QR 码异步生成与缓存
  // generateQRCode 是异步操作（内部使用 Canvas 绘制 + base64 编码）。
  // 将结果存入 state 后，后续打开 modal 直接使用缓存值，无需重新生成。
  // 依赖数组 [shareCode] 确保只在分享码变化时才重新生成（房间生命周期内通常不变）。
  // 注意：不依赖 t 函数 — QR 内容（Join URL）与语言无关，error 消息在渲染时本地化。
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!shareCode) return;

    let cancelled = false;

    async function generate() {
      try {
        const joinUrl = buildJoinURL(shareCode);
        const dataUrl = await generateQRCode(joinUrl);
        if (!cancelled) {
          setQrDataUrl(dataUrl);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setQrDataUrl(null);
          setError('generation_failed');
        }
      }
    }

    generate();

    // 清理函数：防止组件卸载后设置 state（React 严格模式下的竞态保护）
    return () => {
      cancelled = true;
    };
  }, [shareCode]);

  // --------------------------------------------------------------------------
  // Escape 键关闭处理
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // 打开时聚焦关闭按钮（无障碍：屏幕阅读器用户知道焦点在 dialog 内）
    closeBtnRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  // --------------------------------------------------------------------------
  // 点击外部遮罩关闭
  // --------------------------------------------------------------------------
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 只有点击遮罩层本身（不是内容面板）才关闭
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose]
  );

  // 未打开时不渲染
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t('share.qr.title')}
      onClick={handleOverlayClick}
    >
      {/* 遮罩层 — 半透明黑色背景 */}
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />

      {/* 内容面板 */}
      <div
        ref={panelRef}
        className="relative bg-gray-800 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col items-center gap-4"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between w-full">
          <h2 className="text-lg font-semibold text-white">
            {t('share.qr.title')}
          </h2>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-white transition-colors rounded-lg"
          >
            ✕
          </button>
        </div>

        {/* QR 码显示区域 — 白色背景确保扫描兼容性 */}
        <div className="bg-white p-4 rounded">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={t('share.qr.alt')}
              className="w-[200px] h-[200px] sm:w-[256px] sm:h-[256px]"
            />
          ) : error ? (
            // 生成失败 fallback：显示错误文本（渲染时本地化，避免 effect 依赖 t）
            <div className="w-[200px] h-[200px] sm:w-[256px] sm:h-[256px] flex items-center justify-center text-red-500 text-sm text-center px-4">
              {t('share.qr.error')}
            </div>
          ) : (
            // 加载中状态
            <div className="w-[200px] h-[200px] sm:w-[256px] sm:h-[256px] flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
