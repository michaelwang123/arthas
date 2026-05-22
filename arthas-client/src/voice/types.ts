/**
 * 语音模块核心类型定义。
 *
 * 本文件定义了语音消息功能的所有核心数据类型，包括：
 * - RecordingState: 录音状态机的所有合法状态
 * - PlaybackState: 播放状态机的所有合法状态
 * - RecordingResult: 录音完成后的输出数据结构
 * - VoicePlaybackState: 单条语音消息的播放运行时状态
 * - VoiceFileMetadata: 语音消息的文件元数据（扩展 FileMetadata）
 *
 * 📚 学习要点: 为什么语音模块需要独立的类型文件？
 * 语音消息虽然复用文件传输协议进行加密传输，但在录音和播放层面
 * 有自己独特的状态机和数据结构。将这些类型集中定义在独立文件中：
 * 1. 保持单一职责原则（SRP）— 每个文件只描述一个领域的类型
 * 2. 避免 file-transfer/types.ts 膨胀（该文件已经很长）
 * 3. 让语音模块的其他文件（recorder.ts, player.ts, voiceStore.ts）
 *    都从同一个地方导入类型，形成清晰的依赖关系
 * 4. 方便未来扩展（如添加波形数据类型）而不影响文件传输模块
 *
 * @module voice/types
 * @see design.md — 录音状态模型、播放状态模型、VoiceFileMetadata
 * @see requirements.md — Requirements 2.1, 3.3
 */

import type { FileMetadata } from '../file-transfer/types';

// ============================================================================
// 录音相关类型
// ============================================================================

/**
 * 录音状态机的所有合法状态。
 *
 * 📚 学习要点: 状态机设计与用户体验
 * 录音涉及异步操作（请求权限、启动硬件），用户需要即时反馈。
 * 将这些中间过程建模为独立状态，UI 可以为每个状态显示不同的视觉提示：
 * - idle: 显示正常的麦克风图标
 * - requesting: 显示加载动画（等待用户授权弹窗）
 * - recording: 显示脉冲红点 + 计时器
 * - processing: 显示"处理中"提示（通常极短，用户几乎感知不到）
 *
 * 📚 学习要点: 状态转换规则
 * idle → requesting: 用户按下 PTT（首次需要请求麦克风权限）
 * idle → recording: 用户按下 PTT（已有权限，跳过 requesting）
 * requesting → recording: 权限授予成功，MediaRecorder 启动
 * requesting → idle: 权限被拒绝（显示错误提示）
 * recording → processing: 用户松开 PTT，MediaRecorder 停止
 * recording → idle: 录音时间 < 500ms（丢弃录音，显示"录音时间太短"）
 * processing → idle: Blob 生成完成，已交给发送引擎
 *
 * 📚 学习要点: 为什么使用 union type 而非 enum？
 * TypeScript 的字符串字面量联合类型（union type）相比 enum 有几个优势：
 * 1. 编译后不产生额外的 JavaScript 代码（enum 会生成反向映射对象）
 * 2. 在 switch 语句中天然支持 exhaustive check（穷尽检查）
 * 3. 与 JSON 序列化/反序列化天然兼容（字符串就是字符串）
 * 4. 在调试时直接看到有意义的字符串值，而非数字
 */
export type RecordingState = 'idle' | 'requesting' | 'recording' | 'processing';

/**
 * 录音完成后的输出数据结构。
 *
 * 📚 学习要点: 为什么需要 RecordingResult 而非直接返回 Blob？
 * 录音完成后，发送引擎需要三个信息来构造 VoiceFileMetadata：
 * 1. blob — 音频数据本身（用于加密和传输）
 * 2. duration — 录音时长（用于 UI 显示 "0:05" 和 metadata.duration 字段）
 * 3. mimeType — 实际使用的编码格式（用于 metadata.mimeType 字段）
 *
 * 将这三个值打包为一个结构体，让调用方（voiceSender）一次性获得所有需要的信息，
 * 避免多次调用 recorder 的不同方法来分别获取这些值。
 *
 * 📚 学习要点: Duration 的测量方式
 * MediaRecorder API 不直接提供录音时长属性。
 * 使用 Date.now() 在 start/stop 时计算差值：
 *   duration = Math.round((stopTime - startTime) / 1000)
 * 这比依赖 audio.duration（需要加载完整 Blob 后才可用）更即时，
 * 且不受浏览器标签页后台节流的影响。
 */
export interface RecordingResult {
  /** 完整的音频 Blob（WebM/Opus 或 MP4/Opus 容器格式） */
  blob: Blob;
  /** 录音时长（秒），通过 Date.now() 差值计算: Math.round((stopTime - startTime) / 1000) */
  duration: number;
  /** 实际使用的 MIME 类型（如 'audio/webm;codecs=opus' 或 'audio/mp4;codecs=opus'） */
  mimeType: string;
}

// ============================================================================
// 播放相关类型
// ============================================================================

/**
 * 播放状态机的所有合法状态。
 *
 * 📚 学习要点: 为什么需要 'expired' 状态？
 * 由于服务器不存储音频数据（零知识架构），语音 Blob 仅存在于客户端内存中。
 * voiceStore 使用 LRU 缓存策略（最多 10 条），当缓存满时会淘汰最久未播放的 Blob。
 * 一旦 Blob 被淘汰，该语音消息将永久不可播放（无法从服务器重新下载）。
 *
 * 'expired' 状态让 UI 明确告知用户"语音已过期"，
 * 而非让用户点击播放后无响应或报错（这是糟糕的用户体验）。
 *
 * 📚 学习要点: 状态转换规则
 * idle → playing: 用户点击播放按钮
 * playing → paused: 用户点击暂停按钮
 * paused → playing: 用户点击恢复播放
 * playing → idle: 播放完成（audio.onended 事件触发）
 * idle/paused → expired: voiceStore.evictBlob() 被调用（LRU 淘汰或 ephemeral 超时）
 * expired 是终态，不可恢复（因为原始音频数据已不可获取）
 */
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'expired';

/**
 * 单条语音消息的播放运行时状态。
 *
 * 📚 学习要点: 为什么将播放状态建模为独立接口？
 * 每条语音消息都有自己的播放状态（是否在播放、播放到哪里了）。
 * voiceStore 使用 Map<string, VoicePlaybackState> 来追踪所有语音消息的播放状态，
 * 其中 key 是 transferId。
 *
 * 这种设计允许：
 * 1. 快速查找任意消息的播放状态（O(1) Map 查找）
 * 2. UI 组件只需订阅自己关心的 transferId 对应的状态
 * 3. 播放完成后保留 duration 信息（用于 UI 显示总时长）
 *
 * 📚 学习要点: currentTime 的更新频率
 * HTML5 Audio 的 timeupdate 事件大约每 250ms 触发一次（浏览器实现差异）。
 * 对于语音消息播放进度显示来说，250ms 的更新频率已经足够流畅。
 * 不需要使用 requestAnimationFrame 来追踪播放进度（那是音频可视化的需求）。
 */
export interface VoicePlaybackState {
  /** 当前播放状态 */
  state: PlaybackState;
  /** 当前播放位置（秒），由 audio.timeupdate 事件驱动更新 */
  currentTime: number;
  /** 总时长（秒），从 VoiceFileMetadata.duration 获取 */
  duration: number;
}

// ============================================================================
// 语音文件元数据
// ============================================================================

/**
 * 语音消息的文件元数据，扩展标准 FileMetadata。
 *
 * 📚 学习要点: 向后兼容的接口扩展策略
 * VoiceFileMetadata 继承 FileMetadata 的所有字段，并添加两个语音特有字段：
 * - isVoice: true — 标识这是一条语音消息（字面量类型，不是 boolean）
 * - duration — 录音时长（秒）
 *
 * 为什么使用 interface extends 而非交叉类型（&）？
 * 1. extends 在编译错误中显示更清晰的类型名称
 * 2. extends 支持 declaration merging（虽然这里不需要）
 * 3. extends 在 IDE 中悬停时显示完整的继承链，帮助理解类型来源
 *
 * 📚 学习要点: 为什么 isVoice 是字面量类型 true 而非 boolean？
 * 使用 `isVoice: true`（字面量类型）而非 `isVoice: boolean` 有两个好处：
 * 1. 类型收窄（Type Narrowing）：在 if (metadata.isVoice) 后，
 *    TypeScript 自动将 metadata 收窄为 VoiceFileMetadata 类型
 * 2. 防止误用：不可能创建一个 isVoice: false 的 VoiceFileMetadata，
 *    因为类型系统会拒绝这种赋值
 *
 * 📚 学习要点: 加密后的隐私保护
 * isVoice 和 duration 字段存在于加密前的明文 metadata JSON 中。
 * 发送时，整个 metadata 对象被 AES-256-GCM 加密后才通过 WebSocket 传输。
 * 服务器只能看到加密后的密文，无法知道这是语音消息还是普通文件。
 * 接收方解密 metadata 后检查 isVoice 字段，决定渲染为语音气泡还是文件卡片。
 * 旧客户端不认识 isVoice 字段会忽略它，将消息渲染为普通音频文件（优雅降级）。
 */
export interface VoiceFileMetadata extends FileMetadata {
  /** 语音消息标识（字面量类型 true），用于类型收窄和 UI 条件渲染 */
  isVoice: true;
  /** 语音时长（秒），用于 UI 显示 "0:05" 格式的时长标签 */
  duration: number;
}
