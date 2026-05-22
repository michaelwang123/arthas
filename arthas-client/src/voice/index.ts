/**
 * @file 语音模块 Barrel Export — 统一对外导出入口
 *
 * 本文件是 src/voice/ 模块的公共 API 入口点。
 * 外部模块通过 `import { PttButton, sendVoice } from '../voice'` 引用，
 * 无需知道内部文件结构（哪个函数在哪个文件中定义）。
 *
 * 📚 学习要点: Barrel Export 模式
 * Barrel Export 是 TypeScript/JavaScript 项目中常见的模块组织模式：
 * 1. 封装内部结构 — 外部不需要知道 voiceSender.ts、voiceStore.ts 等文件名
 * 2. 简化导入路径 — `from '../voice'` 比 `from '../voice/voiceSender'` 更简洁
 * 3. 控制公共 API — 只导出外部需要的符号，内部实现细节保持私有
 * 4. 重构友好 — 内部文件重命名/拆分不影响外部导入路径
 *
 * 注意事项：
 * - 不要导出所有内容（`export * from`），只导出外部确实需要的符号
 * - 类型导出使用 `export type` 确保在运行时被擦除（Tree-shaking 友好）
 * - 组件、hooks、工具函数分组导出，便于阅读
 *
 * @module voice
 * @see design.md — 客户端模块结构
 */

// ============================================================================
// 状态管理
// ============================================================================

export { useVoiceStore, MAX_VOICE_CACHE, initVoiceModule } from './voiceStore';

// ============================================================================
// 核心功能
// ============================================================================

export { sendVoice } from './voiceSender';
export { formatDuration } from './formatDuration';

// ============================================================================
// UI 组件
// ============================================================================

export { PttButton } from './components/PttButton';
export { VoiceMessage } from './components/VoiceMessage';
export { RecordingIndicator } from './components/RecordingIndicator';
export { VoiceErrorToast } from './components/VoiceErrorToast';

// ============================================================================
// 类型导出（运行时擦除，仅用于类型检查）
// ============================================================================

export type {
  RecordingState,
  PlaybackState,
  VoicePlaybackState,
  RecordingResult,
  VoiceFileMetadata,
} from './types';
