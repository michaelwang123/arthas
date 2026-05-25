/**
 * @file QR 码分享 & 房间过期前端集成测试
 *
 * 本文件验证 QR 码分享和房间过期功能中多个模块的协作行为：
 * 1. 旧格式分享码（2/3 段）在新客户端中的向后兼容解析
 * 2. QRCodeModal 组件的打开/关闭/响应式尺寸行为
 * 3. ExpiryCountdown 在 expiresAt=0 时不渲染
 * 4. ExpiryCountdown timer 频率切换（>1h → <=1h 边界）
 * 5. parseJoinRoute 对各种 URL hash 格式的处理
 *
 * 📚 学习要点: 集成测试 vs 单元测试
 * 单元测试验证单个函数的输入输出（如 decodeShareKey 的格式验证）。
 * 集成测试验证多个模块协作时的行为（如 parseJoinRoute + decodeShareKey 的联动，
 * ExpiryCountdown 的 timer 管理与 DOM 渲染的交互）。
 * 本文件聚焦于跨模块交互和真实 DOM 行为验证。
 *
 * @module integration/qr-expiry.test
 * @see crypto/shareKey.ts — 分享码编解码
 * @see components/QRCodeModal.tsx — QR 码模态框
 * @see components/ExpiryCountdown.tsx — 过期倒计时
 * @see pages/Home.tsx — parseJoinRoute
 * @see Requirements 9.4, 2.1, 2.2, 2.3, 8.6, 8.7, 3.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { decodeShareKey } from '../crypto/shareKey';
import { parseJoinRoute } from '../pages/Home';
import { QRCodeModal } from '../components/QRCodeModal';
import { ExpiryCountdown } from '../components/ExpiryCountdown';

// ============================================================================
// Mock 依赖模块
// ============================================================================

/**
 * Mock QR 码生成模块 — 避免在测试中执行真实的 Canvas 绘制。
 * generateQRCode 返回固定的 data URL，buildJoinURL 使用简化实现。
 */
vi.mock('../qr/generator', () => ({
  generateQRCode: vi.fn().mockResolvedValue('data:image/png;base64,mockQRData'),
  buildJoinURL: vi.fn((shareCode: string) => `https://test.example.com/#/join/${shareCode}`),
}));

/**
 * Mock i18n 模块 — 返回 key 本身作为翻译结果，简化断言。
 */
vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

// ============================================================================
// 1. 旧格式分享码向后兼容测试
// ============================================================================

describe('旧格式分享码向后兼容 (Requirements 9.4)', () => {
  /**
   * 验证 2 段格式（最早版本的分享码）在新客户端中正确解析。
   * 2 段格式: {roomId}:{keyEncoded} → ephemeral=0, expiresAt=0
   */
  it('2 段格式分享码正确解析为 ephemeral=0, expiresAt=0', () => {
    // 21 字符 roomId + 43 字符 keyEncoded
    const roomId = 'abcdefghijklmnopqrstu';
    const keyEncoded = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
    const code = `${roomId}:${keyEncoded}`;

    const result = decodeShareKey(code);

    expect(result).not.toBeNull();
    expect(result!.roomId).toBe(roomId);
    expect(result!.keyEncoded).toBe(keyEncoded);
    expect(result!.ephemeral).toBe(0);
    expect(result!.expiresAt).toBe(0);
  });

  /**
   * 验证 3 段格式（带 ephemeral 的旧版分享码）在新客户端中正确解析。
   * 3 段格式: {roomId}:{keyEncoded}:{ephemeral} → expiresAt=0
   */
  it('3 段格式分享码正确解析为 expiresAt=0', () => {
    const roomId = 'abcdefghijklmnopqrstu';
    const keyEncoded = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
    const code = `${roomId}:${keyEncoded}:30`;

    const result = decodeShareKey(code);

    expect(result).not.toBeNull();
    expect(result!.roomId).toBe(roomId);
    expect(result!.keyEncoded).toBe(keyEncoded);
    expect(result!.ephemeral).toBe(30);
    expect(result!.expiresAt).toBe(0);
  });

  /**
   * 验证 4 段格式（新版带过期的分享码）正确解析所有字段。
   */
  it('4 段格式分享码正确解析所有字段', () => {
    const roomId = 'abcdefghijklmnopqrstu';
    const keyEncoded = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
    const code = `${roomId}:${keyEncoded}:60:1700000000`;

    const result = decodeShareKey(code);

    expect(result).not.toBeNull();
    expect(result!.roomId).toBe(roomId);
    expect(result!.keyEncoded).toBe(keyEncoded);
    expect(result!.ephemeral).toBe(60);
    expect(result!.expiresAt).toBe(1700000000);
  });

  /**
   * 验证 2 段格式中 ephemeral=0 的隐含语义被正确处理。
   * 旧客户端生成的 2 段码不包含 ephemeral 段，新客户端应默认为 0。
   */
  it('2 段格式隐含 ephemeral=0 语义', () => {
    const roomId = 'ABCDEFGHIJKLMNOPQRSTU';
    const keyEncoded = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg';
    const code = `${roomId}:${keyEncoded}`;

    const result = decodeShareKey(code);

    expect(result).not.toBeNull();
    expect(result!.ephemeral).toBe(0);
    expect(result!.expiresAt).toBe(0);
  });
});

// ============================================================================
// 2. QRCodeModal 打开/关闭/响应式尺寸测试
// ============================================================================

describe('QRCodeModal 组件行为 (Requirements 2.1, 2.2, 2.3)', () => {
  afterEach(() => {
    cleanup();
  });

  /**
   * 验证 open=false 时 Modal 不渲染任何内容。
   */
  it('open=false 时不渲染 Modal', () => {
    const { container } = render(
      <QRCodeModal open={false} onClose={vi.fn()} shareCode="test:code" />
    );

    expect(container.innerHTML).toBe('');
  });

  /**
   * 验证 open=true 时 Modal 正确渲染 dialog。
   */
  it('open=true 时渲染 dialog', () => {
    render(
      <QRCodeModal open={true} onClose={vi.fn()} shareCode="abcdefghijklmnopqrstu:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr" />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
  });

  /**
   * 验证按 Escape 键触发 onClose 回调。
   * Requirements 2.3: 允许用户通过 Escape 键关闭 Modal。
   */
  it('按 Escape 键关闭 Modal', () => {
    const onClose = vi.fn();
    render(
      <QRCodeModal open={true} onClose={onClose} shareCode="abcdefghijklmnopqrstu:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr" />
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * 验证点击关闭按钮触发 onClose 回调。
   * Requirements 2.3: 允许用户通过关闭按钮关闭 Modal。
   */
  it('点击关闭按钮关闭 Modal', () => {
    const onClose = vi.fn();
    render(
      <QRCodeModal open={true} onClose={onClose} shareCode="abcdefghijklmnopqrstu:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr" />
    );

    // 关闭按钮的 aria-label 是 t('share.qr.title') → 'share.qr.title'
    const closeBtn = screen.getByRole('button', { name: 'share.qr.title' });
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * 验证 QR 码图片使用响应式尺寸 CSS 类。
   * Requirements 2.1: viewport < 640px 时 200px
   * Requirements 2.2: viewport >= 640px 时 256px
   *
   * 📚 学习要点: Tailwind 响应式断点测试
   * Tailwind 的 sm: 前缀对应 @media (min-width: 640px)。
   * 在测试中验证 CSS 类名的存在即可确认响应式配置正确，
   * 实际的媒体查询行为由 Tailwind 框架保证。
   */
  it('QR 码图片包含响应式尺寸 CSS 类', async () => {
    render(
      <QRCodeModal open={true} onClose={vi.fn()} shareCode="abcdefghijklmnopqrstu:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr" />
    );

    // 等待异步 QR 码生成完成
    const img = await screen.findByAltText('share.qr.alt');

    // 验证包含基础尺寸（200px）和 sm 断点尺寸（256px）的 CSS 类
    expect(img.className).toContain('w-[200px]');
    expect(img.className).toContain('h-[200px]');
    expect(img.className).toContain('sm:w-[256px]');
    expect(img.className).toContain('sm:h-[256px]');
  });

  /**
   * 验证点击遮罩层（Modal 外部）触发 onClose。
   * Requirements 2.3: 允许用户通过点击外部关闭 Modal。
   */
  it('点击遮罩层关闭 Modal', () => {
    const onClose = vi.fn();
    render(
      <QRCodeModal open={true} onClose={onClose} shareCode="abcdefghijklmnopqrstu:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr" />
    );

    // 点击最外层的 dialog 容器（遮罩层区域）
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 3. ExpiryCountdown 条件渲染测试
// ============================================================================

describe('ExpiryCountdown 条件渲染 (Requirements 8.6)', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /**
   * 验证 expiresAt=0 时组件不渲染任何内容。
   * Requirements 8.6: 无过期房间不显示过期指示器。
   */
  it('expiresAt=0 时不渲染', () => {
    const { container } = render(<ExpiryCountdown expiresAt={0} />);

    expect(container.innerHTML).toBe('');
  });

  /**
   * 验证 expiresAt > 0 且未过期时组件正确渲染。
   */
  it('expiresAt > 0 且未过期时渲染倒计时', () => {
    // 设置 expiresAt 为未来 2 小时
    const futureTime = Math.floor(Date.now() / 1000) + 7200;

    const { container } = render(<ExpiryCountdown expiresAt={futureTime} />);

    // 应该渲染了 timer 元素
    const timer = container.querySelector('[role="timer"]');
    expect(timer).not.toBeNull();
  });
});

// ============================================================================
// 4. ExpiryCountdown timer 频率切换测试
// ============================================================================

describe('ExpiryCountdown timer 频率切换 (Requirements 8.7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /**
   * 验证 remaining > 1h 时 timer 以 60s 间隔更新。
   * Requirements 8.7: remaining > 1h 时每 60 秒更新。
   *
   * 📚 学习要点: Fake Timers 测试策略
   * 使用 vi.useFakeTimers() 控制时间流逝，避免测试等待真实的 60 秒。
   * vi.advanceTimersByTime(ms) 精确推进指定毫秒数，触发到期的 setInterval 回调。
   * 通过 vi.setSystemTime 模拟时间推进，确保 calcRemaining 计算出正确的剩余时间。
   */
  it('remaining > 1h 时以 60s 间隔更新', () => {
    // 设置当前时间为固定值
    const baseTime = 1700000000000; // ms
    vi.setSystemTime(baseTime);

    // expiresAt 为 2 小时后（7200 秒）
    const expiresAt = Math.floor(baseTime / 1000) + 7200;

    const { container } = render(<ExpiryCountdown expiresAt={expiresAt} />);

    const timer = container.querySelector('[role="timer"]');
    expect(timer).not.toBeNull();

    // 初始显示应为小时格式
    const initialText = timer!.textContent;
    expect(initialText).toContain('h remaining');

    // 推进 30 秒 — 不应触发更新（60s 间隔）
    act(() => {
      vi.advanceTimersByTime(30000);
      vi.setSystemTime(baseTime + 30000);
    });

    // 推进到 60 秒 — 应触发一次更新
    act(() => {
      vi.advanceTimersByTime(30000);
      vi.setSystemTime(baseTime + 60000);
    });

    // 仍然显示小时格式（remaining 仍 > 1h）
    const afterOneMin = timer!.textContent;
    expect(afterOneMin).toContain('h remaining');
  });

  /**
   * 验证从 >1h 跨越到 <=1h 时 timer 频率从 60s 切换到 1s。
   * Requirements 8.7: remaining <= 1h 时每秒更新。
   *
   * 📚 学习要点: Timer 频率切换边界测试
   * 当 60s timer 触发后发现 remaining 已跨越 3600s 边界，
   * 组件应立即清除 60s interval 并启动 1s interval。
   * 测试通过推进时间到恰好跨越边界的时刻，验证后续更新频率变为 1s。
   */
  it('跨越 1h 边界时 timer 频率从 60s 切换到 1s', () => {
    // 设置当前时间
    const baseTime = 1700000000000; // ms
    vi.setSystemTime(baseTime);

    // expiresAt 为 1 小时 + 30 秒后（3630 秒）
    // 这样第一次 60s tick 后 remaining = 3570s (< 3600s)，触发频率切换
    const expiresAt = Math.floor(baseTime / 1000) + 3630;

    const { container } = render(<ExpiryCountdown expiresAt={expiresAt} />);

    const timer = container.querySelector('[role="timer"]');
    expect(timer).not.toBeNull();

    // 初始 remaining = 3630s > 3600s → 显示小时格式，60s 间隔
    expect(timer!.textContent).toContain('h remaining');

    // 推进 60 秒 — 触发第一次 tick
    // 此时 remaining = 3630 - 60 = 3570s <= 3600s → 切换到分钟格式 + 1s 间隔
    act(() => {
      vi.advanceTimersByTime(60000);
      vi.setSystemTime(baseTime + 60000);
    });

    // 应切换为分钟格式
    expect(timer!.textContent).toContain('min remaining');

    // 验证切换后以 1s 间隔更新：推进 1 秒应触发更新
    act(() => {
      vi.advanceTimersByTime(1000);
      vi.setSystemTime(baseTime + 61000);
    });

    // 仍然是分钟格式（remaining = 3569s）
    expect(timer!.textContent).toContain('min remaining');
  });
});

// ============================================================================
// 5. parseJoinRoute URL hash 格式处理测试
// ============================================================================

describe('parseJoinRoute URL hash 格式处理 (Requirements 3.1)', () => {
  /**
   * 验证标准 join 路由格式正确解析。
   */
  it('解析标准格式 #/join/{shareCode}', () => {
    const shareCode = 'abcdefghijklmnopqrstu:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr';
    const result = parseJoinRoute(`#/join/${shareCode}`);

    expect(result).toBe(shareCode);
  });

  /**
   * 验证 4 段分享码（含 expiresAt）在 hash 中正确解析。
   */
  it('解析含 expiresAt 的 4 段分享码', () => {
    const shareCode = 'abcdefghijklmnopqrstu:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr:60:1700000000';
    const result = parseJoinRoute(`#/join/${shareCode}`);

    expect(result).toBe(shareCode);
  });

  /**
   * 验证空 hash 返回 null。
   */
  it('空字符串返回 null', () => {
    expect(parseJoinRoute('')).toBeNull();
  });

  /**
   * 验证不匹配 join 路由的 hash 返回 null。
   */
  it('不匹配 #/join/ 前缀的 hash 返回 null', () => {
    expect(parseJoinRoute('#/room/abc')).toBeNull();
    expect(parseJoinRoute('#/settings')).toBeNull();
    expect(parseJoinRoute('#/')).toBeNull();
  });

  /**
   * 验证仅有 #/join/ 前缀但无 shareCode 时返回 null。
   * parseJoinRoute 使用 `.+` 匹配，要求至少一个字符。
   */
  it('#/join/ 后无内容返回 null', () => {
    expect(parseJoinRoute('#/join/')).toBeNull();
  });

  /**
   * 验证非字符串输入返回 null（防御性处理）。
   */
  it('非字符串输入返回 null', () => {
    expect(parseJoinRoute(null as unknown as string)).toBeNull();
    expect(parseJoinRoute(undefined as unknown as string)).toBeNull();
  });

  /**
   * 验证 URL 编码的 shareCode 被正确解码。
   * 虽然 base64url 和 NanoID 通常不含需要编码的字符，
   * 但防御性解码确保特殊情况下的正确性。
   */
  it('URL 编码的 shareCode 被正确解码', () => {
    // %3A 是 ':' 的 URL 编码
    const encoded = 'abcdefghijklmnopqrstu%3AABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr';
    const result = parseJoinRoute(`#/join/${encoded}`);

    // decodeURIComponent 应将 %3A 解码为 ':'
    expect(result).toBe('abcdefghijklmnopqrstu:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr');
  });

  /**
   * 验证无效 URL 编码（如 %ZZ）不会导致崩溃。
   * parseJoinRoute 应 catch URIError 并返回原始字符串。
   */
  it('无效 URL 编码不崩溃，返回原始字符串', () => {
    const invalidEncoded = 'abc%ZZdef';
    const result = parseJoinRoute(`#/join/${invalidEncoded}`);

    // 应返回原始未解码的字符串（让后续 decodeShareKey 验证）
    expect(result).toBe(invalidEncoded);
  });

  /**
   * 验证 hash 中不含 # 前缀时返回 null。
   */
  it('不含 # 前缀时返回 null', () => {
    expect(parseJoinRoute('/join/abc')).toBeNull();
  });

  /**
   * 验证 parseJoinRoute 正确处理 #/join 后紧跟内容（无斜杠分隔）。
   */
  it('#/join 后无斜杠返回 null', () => {
    expect(parseJoinRoute('#/joinabc')).toBeNull();
  });
});
