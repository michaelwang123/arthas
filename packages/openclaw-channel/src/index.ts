/**
 * @file index.ts — OpenClaw Channel Plugin 入口文件
 *
 * 本文件是插件的主入口点（package.json "main" 指向编译后的 dist/index.js）。
 * 职责：
 * 1. 使用 OpenClaw definePlugin() 注册插件
 * 2. 声明插件元数据（name, version, channels）
 * 3. 注册 Arthas Channel Adapter
 * 4. 导出关键类型供消费者使用
 *
 * 📚 学习要点: OpenClaw 插件加载机制
 * OpenClaw Gateway 通过以下步骤加载插件：
 * 1. 读取 Gateway 配置中的 plugins 列表
 * 2. 对每个插件执行 `import(pluginPackageName)`
 * 3. 获取 default export（即 definePlugin() 的返回值）
 * 4. 读取 plugin.definition.channels 数组
 * 5. 为每个 channel 创建 adapter 实例并调用 connect()
 *
 * 因此本文件的 default export 必须是 definePlugin() 的返回值。
 *
 * 📚 学习要点: 模块导出策略
 * 除了 default export（插件实例），我们还 re-export 关键类型和类：
 * - ArthasChannelAdapter: 允许消费者直接实例化（用于测试或自定义集成）
 * - 类型接口: 允许消费者在 TypeScript 中引用这些类型
 * 这种模式在 npm 包中很常见（如 express 同时导出 app 工厂和 Router 类）。
 *
 * @module openclaw-channel
 * @see design.md — D3: OpenClaw Plugin API 集成
 * @see requirements.md — Requirement 1.1: Channel Adapter 注册
 */

import { definePlugin } from './types';
import { ArthasChannelAdapter } from './adapter';

// ============================================================================
// 插件定义与注册
// ============================================================================

/**
 * Arthas OpenClaw Channel Plugin 实例。
 *
 * 通过 definePlugin() 向 OpenClaw Gateway 注册插件。
 * Gateway 加载此模块后，会读取 channels 数组，
 * 为 'arthas' 通道创建 ArthasChannelAdapter 实例。
 *
 * 📚 学习要点: 声明式插件注册
 * definePlugin() 采用声明式配置而非命令式注册：
 * - 声明式：描述"插件是什么"（name, version, channels）
 * - 命令式：描述"插件做什么"（gateway.register(...), gateway.addChannel(...)）
 *
 * 声明式的好处：
 * 1. Gateway 可以在不实例化 adapter 的情况下读取插件元数据
 * 2. 配置集中在一处，易于理解和维护
 * 3. 支持静态分析（如 CLI 工具列出所有已安装插件的 channels）
 *
 * @see PluginDefinition — 插件定义接口
 * @see ChannelRegistration — 通道注册信息
 */
const plugin = definePlugin({
  /**
   * 插件唯一标识符。
   * 使用 npm 包名格式，与 package.json 的 name 字段一致。
   */
  name: '@arthas/openclaw-channel',

  /**
   * 插件版本号（遵循 semver）。
   * 与 package.json 的 version 字段保持同步。
   */
  version: '1.0.0',

  /**
   * 插件提供的通信通道列表。
   * v1 只注册一个 'arthas' 通道。
   * 未来可扩展为多通道（如同时连接多个 Arthas 服务器实例）。
   */
  channels: [
    {
      /** 通道唯一 ID，Gateway 通过此 ID 路由消息 */
      id: 'arthas',

      /** 通道显示名称，用于日志和管理界面 */
      name: 'Arthas E2EE Chat',

      /**
       * Adapter 类引用（非实例）。
       * Gateway 会调用 `new ArthasChannelAdapter()` 创建实例，
       * 然后调用 connect(config) 建立连接。
       */
      adapter: ArthasChannelAdapter,
    },
  ],
});

/**
 * 插件默认导出。
 * OpenClaw Gateway 通过 `import plugin from '@arthas/openclaw-channel'` 加载。
 */
export default plugin;

// ============================================================================
// Re-exports — 供消费者直接使用的类型和类
// ============================================================================

/**
 * 导出 ArthasChannelAdapter 类，允许消费者：
 * - 在测试中直接实例化 adapter（不通过 Gateway）
 * - 在自定义集成场景中使用（如嵌入到其他框架）
 */
export { ArthasChannelAdapter } from './adapter';

/**
 * 导出核心类型定义，供 TypeScript 消费者引用。
 * 这些类型在编写自定义集成或扩展插件时非常有用。
 */
export type {
  /** 插件定义接口 */
  PluginDefinition,
  /** 通道注册信息 */
  ChannelRegistration,
  /** Channel Adapter 接口（实现此接口可创建自定义 adapter） */
  ChannelAdapter,
  /** 通道配置（通用键值对） */
  ChannelConfig,
  /** Arthas 通道的强类型配置 */
  ArthasChannelConfig,
  /** 接收的用户消息 */
  IncomingMessage,
  /** 发送的 Agent 回复 */
  OutgoingMessage,
  /** 消息附件 */
  MessageAttachment,
  /** 连接状态 */
  ConnectionStatus,
  /** 消息类型 */
  MessageType,
  /** 插件实例 */
  Plugin,
} from './types';

/** 导出 definePlugin 函数，供需要创建自定义插件的场景使用 */
export { definePlugin } from './types';
