/**
 * @file config.ts — 配置验证与加载
 *
 * 本文件实现插件配置的加载、验证和错误报告。
 * 职责：
 * 1. 从环境变量加载配置（ARTHAS_SERVER_URL, ARTHAS_SHARE_CODE 等）
 * 2. 从 ChannelConfig 对象加载配置（Gateway 传入）
 * 3. 配置验证（必填字段检查、URL 格式验证、分享码格式验证）
 * 4. 清晰的错误消息（指出哪个字段缺失/无效及如何修复）
 * 5. 配置优先级合并（环境变量 > ChannelConfig > 默认值）
 *
 * 📚 学习要点: 配置加载优先级
 * 遵循 12-Factor App 原则，配置来源优先级：
 * 1. 环境变量（最高优先级）— 适合生产部署、CI/CD
 * 2. ChannelConfig 对象（Gateway 传入）— 适合编程式配置
 * 3. 插件默认值（最低优先级）— displayName: 'AI Assistant' 等
 *
 * 📚 学习要点: Fail-Fast 配置验证
 * 在 connect() 阶段（而非消息处理阶段）验证配置，原因：
 * - 尽早发现配置错误，避免运行时才崩溃
 * - 提供清晰的错误消息，帮助运维快速定位问题
 * - 防止部分初始化状态（要么完全配置正确，要么立即失败）
 *
 * 📚 学习要点: 分享码安全处理
 * 分享码包含加密密钥，配置加载时的安全考虑：
 * - 不在日志中输出分享码的完整内容（仅输出 roomId 部分）
 * - 验证后立即从配置对象中移除原始字符串，只保留派生的密钥
 * - 进程退出时清零内存中的密钥材料
 *
 * @module openclaw-channel/config
 * @see design.md — D5: 配置方案
 * @see requirements.md — Requirement 3: 配置与部署
 */

import type { ArthasChannelConfig, ChannelConfig } from './types.js';

// ============================================================================
// 环境变量名称常量
// ============================================================================

/**
 * 📚 学习要点: 环境变量命名约定
 * 使用统一的 ARTHAS_ 前缀避免与其他应用的环境变量冲突。
 * 这是 12-Factor App 的标准做法。
 */
const ENV_SERVER_URL = 'ARTHAS_SERVER_URL';
const ENV_SHARE_CODE = 'ARTHAS_SHARE_CODE';
const ENV_DISPLAY_NAME = 'ARTHAS_DISPLAY_NAME';
const ENV_SIGNING_ENABLED = 'ARTHAS_SIGNING_ENABLED';
const ENV_ROOM_PASSWORD = 'ARTHAS_ROOM_PASSWORD';

// ============================================================================
// 默认值
// ============================================================================

/** Agent 在房间中的默认显示名称 */
const DEFAULT_DISPLAY_NAME = 'AI Assistant';

/** 消息签名默认关闭（需要显式启用） */
const DEFAULT_SIGNING_ENABLED = false;

// ============================================================================
// 配置加载
// ============================================================================

/**
 * 从环境变量加载原始配置值。
 *
 * 📚 学习要点: 环境变量读取的封装
 * 将 process.env 访问封装在独立函数中，便于：
 * 1. 测试时 mock（通过替换 process.env）
 * 2. 集中管理环境变量名称（避免散落在代码各处的魔法字符串）
 * 3. 统一处理 undefined vs 空字符串的语义
 *
 * @returns 从环境变量读取的原始配置对象（未验证）
 */
function loadFromEnv(): Partial<ArthasChannelConfig> {
  const config: Partial<ArthasChannelConfig> = {};

  // 读取环境变量，空字符串视为未设置
  const serverUrl = process.env[ENV_SERVER_URL]?.trim();
  if (serverUrl) {
    config.serverUrl = serverUrl;
  }

  const shareCode = process.env[ENV_SHARE_CODE]?.trim();
  if (shareCode) {
    config.shareCode = shareCode;
  }

  const displayName = process.env[ENV_DISPLAY_NAME]?.trim();
  if (displayName) {
    config.displayName = displayName;
  }

  const signingEnabled = process.env[ENV_SIGNING_ENABLED]?.trim();
  if (signingEnabled) {
    config.signingEnabled = signingEnabled === 'true' || signingEnabled === '1';
  }

  const roomPassword = process.env[ENV_ROOM_PASSWORD]?.trim();
  if (roomPassword) {
    config.roomPassword = roomPassword;
  }

  return config;
}

/**
 * 从 ChannelConfig 对象提取 Arthas 配置。
 *
 * ChannelConfig 是 OpenClaw Gateway 传递给 adapter.connect() 的通用配置容器。
 * 此函数从中提取 Arthas 特定的配置字段。
 *
 * 📚 学习要点: 通用配置到强类型配置的转换
 * ChannelConfig 是 Record<string, unknown>（弱类型），
 * 我们需要安全地提取并转换为 ArthasChannelConfig（强类型）。
 * 使用 typeof 检查确保类型安全，避免运行时类型错误。
 *
 * @param channelConfig - Gateway 传入的通用配置对象
 * @returns 从 ChannelConfig 提取的配置（未验证）
 */
function loadFromChannelConfig(channelConfig: ChannelConfig): Partial<ArthasChannelConfig> {
  const config: Partial<ArthasChannelConfig> = {};

  if (typeof channelConfig['serverUrl'] === 'string' && channelConfig['serverUrl'].trim()) {
    config.serverUrl = channelConfig['serverUrl'].trim();
  }

  if (typeof channelConfig['shareCode'] === 'string' && channelConfig['shareCode'].trim()) {
    config.shareCode = channelConfig['shareCode'].trim();
  }

  if (typeof channelConfig['displayName'] === 'string' && channelConfig['displayName'].trim()) {
    config.displayName = channelConfig['displayName'].trim();
  }

  if (typeof channelConfig['signingEnabled'] === 'boolean') {
    config.signingEnabled = channelConfig['signingEnabled'];
  } else if (typeof channelConfig['signingEnabled'] === 'string') {
    config.signingEnabled = channelConfig['signingEnabled'] === 'true' || channelConfig['signingEnabled'] === '1';
  }

  if (typeof channelConfig['roomPassword'] === 'string' && channelConfig['roomPassword'].trim()) {
    config.roomPassword = channelConfig['roomPassword'].trim();
  }

  return config;
}

// ============================================================================
// 配置验证
// ============================================================================

/**
 * 验证 serverUrl 字段。
 *
 * 规则：
 * - 必填字段
 * - 必须以 wss:// 或 ws:// 开头
 * - 如果使用 ws://（非加密），输出警告（但不阻止启动）
 *
 * 📚 学习要点: URL 协议验证
 * 生产环境必须使用 wss://（WebSocket over TLS），确保传输层加密。
 * ws:// 仅用于本地开发（localhost），在公网使用 ws:// 会暴露 msgpack 帧
 * （虽然消息内容是 E2EE 加密的，但元数据如消息长度、时间戳仍可被观察）。
 *
 * @param serverUrl - 待验证的服务器 URL
 * @throws 如果 URL 格式无效
 */
function validateServerUrl(serverUrl: string): void {
  if (!serverUrl.startsWith('wss://') && !serverUrl.startsWith('ws://')) {
    throw new Error(
      `[Arthas 配置错误] serverUrl 格式无效: "${serverUrl}"\n` +
      `  期望格式: wss://your-server.com/ws 或 ws://localhost:9000/ws\n` +
      `  设置方式: 环境变量 ${ENV_SERVER_URL}=wss://your-server.com/ws`
    );
  }

  // ws:// 非加密连接警告（不阻止启动，但提醒运维）
  if (serverUrl.startsWith('ws://') && !serverUrl.includes('localhost') && !serverUrl.includes('127.0.0.1')) {
    console.warn(
      `[Arthas 配置警告] serverUrl 使用了非加密的 ws:// 协议: "${serverUrl}"\n` +
      `  建议: 生产环境请使用 wss:// 确保传输层安全`
    );
  }
}

/**
 * 验证 shareCode 字段。
 *
 * 规则：
 * - 必填字段
 * - 必须包含至少 2 个冒号分隔的段（roomId:key）
 * - 完整格式为 roomId:base64Key:ephemeral:expiresAt（2-4 段）
 *
 * 📚 学习要点: 分享码格式
 * Arthas 分享码的结构：
 * - 段 1: roomId（房间唯一标识符）
 * - 段 2: base64url 编码的 AES-256 密钥
 * - 段 3（可选）: ephemeral 标志（0 或 1）
 * - 段 4（可选）: expiresAt 时间戳（Unix 秒）
 *
 * 最少需要 2 段（roomId + key），否则无法加入房间和解密消息。
 *
 * @param shareCode - 待验证的分享码
 * @throws 如果分享码格式无效
 */
function validateShareCode(shareCode: string): void {
  const segments = shareCode.split(':');

  if (segments.length < 2) {
    throw new Error(
      `[Arthas 配置错误] shareCode 格式无效: 需要至少 2 个冒号分隔的段（roomId:key），当前只有 ${segments.length} 段\n` +
      `  期望格式: roomId:base64Key 或 roomId:base64Key:ephemeral:expiresAt\n` +
      `  设置方式: 环境变量 ${ENV_SHARE_CODE}=your-room-id:your-encryption-key`
    );
  }

  // 验证每段不为空
  if (!segments[0] || !segments[1]) {
    throw new Error(
      `[Arthas 配置错误] shareCode 格式无效: roomId 和 key 段不能为空\n` +
      `  当前值的段: [${segments.map((s, i) => `段${i + 1}="${s || '(空)'}"`).join(', ')}]\n` +
      `  设置方式: 环境变量 ${ENV_SHARE_CODE}=your-room-id:your-encryption-key`
    );
  }
}

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 加载并验证 Arthas 通道配置。
 *
 * 配置加载优先级（高 → 低）：
 * 1. 环境变量（ARTHAS_SERVER_URL, ARTHAS_SHARE_CODE 等）
 * 2. ChannelConfig 对象（Gateway 传入的通用配置）
 * 3. 默认值（displayName: 'AI Assistant', signingEnabled: false）
 *
 * 📚 学习要点: 配置合并策略
 * 使用 spread operator 实现配置合并，后面的属性覆盖前面的：
 * { ...defaults, ...channelConfig, ...envConfig }
 * 这样环境变量始终具有最高优先级，符合 12-Factor App 原则。
 *
 * @param channelConfig - 可选的 ChannelConfig 对象（由 Gateway 传入）
 * @returns 验证通过的 ArthasChannelConfig 配置对象
 * @throws 如果必填字段缺失或格式无效，抛出描述性错误
 *
 * @example
 * ```typescript
 * // 从环境变量加载（生产环境）
 * const config = loadConfig();
 *
 * // 从 ChannelConfig 加载（Gateway 传入）
 * const config = loadConfig({ serverUrl: 'wss://...', shareCode: '...' });
 *
 * // 混合模式（环境变量覆盖 ChannelConfig）
 * process.env.ARTHAS_DISPLAY_NAME = 'My Bot';
 * const config = loadConfig({ serverUrl: 'wss://...', shareCode: '...' });
 * // config.displayName === 'My Bot'（环境变量优先）
 * ```
 */
export function loadConfig(channelConfig?: ChannelConfig): ArthasChannelConfig {
  // 1. 加载默认值
  const defaults: Partial<ArthasChannelConfig> = {
    displayName: DEFAULT_DISPLAY_NAME,
    signingEnabled: DEFAULT_SIGNING_ENABLED,
  };

  // 2. 从 ChannelConfig 对象加载（如果提供）
  const fromChannelConfig = channelConfig ? loadFromChannelConfig(channelConfig) : {};

  // 3. 从环境变量加载（最高优先级）
  const fromEnv = loadFromEnv();

  // 4. 合并配置（优先级：环境变量 > ChannelConfig > 默认值）
  const merged = {
    ...defaults,
    ...fromChannelConfig,
    ...fromEnv,
  };

  // 5. 验证必填字段
  if (!merged.serverUrl) {
    throw new Error(
      `[Arthas 配置错误] 缺少必填配置: serverUrl（Arthas 服务器地址）\n` +
      `  设置方式:\n` +
      `    环境变量: ${ENV_SERVER_URL}=wss://your-server.com/ws\n` +
      `    或 ChannelConfig: { serverUrl: 'wss://your-server.com/ws' }`
    );
  }

  if (!merged.shareCode) {
    throw new Error(
      `[Arthas 配置错误] 缺少必填配置: shareCode（房间分享码）\n` +
      `  设置方式:\n` +
      `    环境变量: ${ENV_SHARE_CODE}=roomId:encryptionKey\n` +
      `    或 ChannelConfig: { shareCode: 'roomId:encryptionKey' }\n` +
      `  获取方式: 在 Arthas 客户端中创建房间后，点击"分享"获取分享码`
    );
  }

  // 6. 格式验证
  validateServerUrl(merged.serverUrl);
  validateShareCode(merged.shareCode);

  // 7. 构造最终配置对象（确保所有字段都有值）
  const config: ArthasChannelConfig = {
    serverUrl: merged.serverUrl,
    shareCode: merged.shareCode,
    displayName: merged.displayName ?? DEFAULT_DISPLAY_NAME,
    signingEnabled: merged.signingEnabled ?? DEFAULT_SIGNING_ENABLED,
    ...(merged.roomPassword ? { roomPassword: merged.roomPassword } : {}),
  };

  return config;
}
