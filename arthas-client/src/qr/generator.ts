/**
 * QR 码生成模块 — 将 Join_URL 编码为 QR 码 Data URL。
 *
 * 📚 学习要点: QR 库选择理由
 * 选择 `qrcode` npm 包（bundled 依赖）的原因：
 * 1. QR 编码算法复杂度高（Reed-Solomon 纠错 + 掩码模式选择 + 版本自适应），
 *    自行实现成本远超收益
 * 2. 该库为纯计算库，不发起任何网络请求（满足零网络依赖约束）
 * 3. 输出 Data URL（base64 PNG），可直接用于 <img> 标签，无需额外 Canvas 操作
 * 4. 支持 error correction level 配置，适配屏幕-摄像头扫描场景
 *
 * 模块职责：
 * - 提供 generateQRCode() 将任意文本编码为 QR 码 Data URL
 * - 提供 buildJoinURL() 构建完整的房间加入链接
 * - 不涉及 UI 渲染（渲染由 QRCodeModal 组件负责）
 *
 * @module qr/generator
 */

import QRCode from 'qrcode';

/**
 * QR 码生成选项。
 * 控制 QR 码的视觉外观和纠错能力。
 */
export interface QROptions {
  /** 错误纠正等级: L(7%), M(15%), Q(25%), H(30%) */
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
  /** 输出宽度（CSS 像素） */
  width: number;
  /** 静默区模块数（QR 码周围的空白边距） */
  margin: number;
  /** 深色模块颜色（前景色） */
  colorDark: string;
  /** 浅色模块颜色（背景色） */
  colorLight: string;
}

/**
 * 默认 QR 码生成选项。
 *
 * 📚 学习要点: 默认参数选择
 * - errorCorrectionLevel='M': 15% 纠错能力，平衡数据密度和扫描可靠性。
 *   屏幕-摄像头场景下 M 级别足够（不像印刷品可能被污损需要 H 级别）
 * - margin=4: QR 规范推荐的最小静默区，确保扫描器正确识别边界
 * - width=256: 适合桌面端显示，移动端会通过组件层覆盖为 200px
 * - 黑白配色: 确保最大对比度，兼容所有 QR 扫描器（含低端设备）
 */
const DEFAULT_OPTIONS: QROptions = {
  errorCorrectionLevel: 'M',
  width: 256,
  margin: 4,
  colorDark: '#000000',
  colorLight: '#ffffff',
};

/**
 * 生成 QR 码 Data URL。
 *
 * 将输入文本编码为 QR 码，返回 `data:image/png;base64,...` 格式的 URL，
 * 可直接赋值给 <img> 标签的 src 属性。
 *
 * @param text - 要编码的文本（通常是 Join_URL）
 * @param options - QR 码配置选项（部分覆盖默认值）
 * @returns Promise<string> - QR 码的 data:image/png;base64,... URL
 * @throws 当输入文本为空或 QR 编码失败时抛出错误
 *
 * @example
 * ```typescript
 * const dataUrl = await generateQRCode('https://example.com/#/join/abc123:key456');
 * // dataUrl = "data:image/png;base64,iVBORw0KGgo..."
 * ```
 */
export async function generateQRCode(
  text: string,
  options?: Partial<QROptions>
): Promise<string> {
  const merged = { ...DEFAULT_OPTIONS, ...options };

  const dataUrl = await QRCode.toDataURL(text, {
    errorCorrectionLevel: merged.errorCorrectionLevel,
    width: merged.width,
    margin: merged.margin,
    color: {
      dark: merged.colorDark,
      light: merged.colorLight,
    },
  });

  return dataUrl;
}

/**
 * 构建完整的 Join URL。
 *
 * 优先使用环境变量 `VITE_APP_URL` 作为 base URL（支持自定义域名和反向代理场景），
 * 若未配置则 fallback 到 `window.location.origin`（当前页面的协议+域名+端口）。
 *
 * 📚 学习要点: 尾部斜杠处理
 * 用户在 .env 中配置 VITE_APP_URL 时可能带尾部斜杠（如 `https://chat.example.com/`），
 * 如果不去除，拼接后会产生双斜杠 `https://chat.example.com//#/join/...`。
 * 虽然大多数浏览器能容忍双斜杠，但某些 QR 扫描器的内置浏览器可能无法正确解析。
 * 因此使用 `replace(/\/+$/, '')` 统一去除尾部斜杠。
 *
 * @param shareCode - 分享码字符串（如 "roomId:key:ephemeral:expiresAt"）
 * @returns 完整的加入链接（如 "https://example.com/#/join/roomId:key:ephemeral:expiresAt"）
 *
 * @example
 * ```typescript
 * // 环境变量 VITE_APP_URL = "https://chat.example.com/"
 * buildJoinURL('abc123:key456:0:1700000000');
 * // → "https://chat.example.com/#/join/abc123:key456:0:1700000000"
 * ```
 */
export function buildJoinURL(shareCode: string): string {
  const base =
    (import.meta.env.VITE_APP_URL as string | undefined) ||
    window.location.origin;

  // 去除尾部斜杠，防止拼接后产生双斜杠
  const normalizedBase = base.replace(/\/+$/, '');

  return `${normalizedBase}/#/join/${shareCode}`;
}
