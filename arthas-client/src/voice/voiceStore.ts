/**
 * @file 语音状态管理 — 录音状态切片 + 播放状态切片
 *
 * 本文件是语音模块的状态管理中心，使用 Zustand 管理录音和播放生命周期。
 * 当前实现包含：
 * - 录音状态切片（task 4.1a）：录音状态机、互斥检查、计时器
 * - 播放状态切片（task 4.1b）：单例播放、进度追踪、状态管理
 * - LRU 缓存将在后续任务（task 4.1c）中添加
 *
 * 职责：
 * - 管理录音状态机（idle → requesting → recording → processing → idle）
 * - 检查文件传输互斥锁（activeSendId），防止录音与传输冲突
 * - 追踪录音时长（通过 Date.now() 差值 + setInterval 驱动 UI 更新）
 * - 提供 startRecording / stopRecording / cancelRecording 操作
 * - 管理播放状态（activePlaybackId, playbackStates Map）
 * - 提供 playVoice / pauseVoice / updatePlaybackProgress 操作
 *
 * 📚 学习要点: 为什么语音需要独立的 Store？
 * 文件传输 Store 管理传输状态（进度、缓冲区），但不管理：
 * - 录音状态（是否正在录音、录音时长）
 * - 播放状态（哪条消息在播放、播放进度）
 * - 语音 Blob 缓存（LRU 淘汰策略）— 将在 task 4.1c 添加
 *
 * 这些是语音消息特有的 UI 状态，与文件传输的通用逻辑无关。
 * 分离到 voiceStore 保持了关注点分离（Separation of Concerns）。
 *
 * 📚 学习要点: 录音状态机设计
 * 录音涉及多个异步步骤（请求权限、启动硬件、停止录制、生成 Blob），
 * 将这些步骤建模为状态机的不同状态，让 UI 可以为每个状态显示不同的视觉反馈：
 * - idle: 正常麦克风图标，可以开始录音
 * - requesting: 加载动画（等待用户授权弹窗）
 * - recording: 脉冲红点 + 计时器
 * - processing: "处理中"提示（通常极短）
 *
 * 状态转换规则：
 * idle → requesting/recording: startRecording() 被调用
 * requesting → recording: 权限授予，MediaRecorder 启动
 * requesting → idle: 权限被拒绝（设置 recordingError）
 * recording → processing: stopRecording() 被调用
 * recording → idle: cancelRecording() 被调用
 * processing → idle: Blob 生成完成，返回 RecordingResult
 *
 * 📚 学习要点: 传输互斥锁（Transfer Mutex）
 * 语音消息和文件传输共享同一个 WebSocket 传输通道。
 * 服务器端通过 activeTransferID 强制同一时间只有一个活跃传输。
 * 客户端在录音开始前检查 fileTransferStore.activeSendId：
 * - 如果非 null → 有文件正在发送，拒绝录音（显示"请等待当前传输完成"）
 * - 如果为 null → 可以安全录音
 *
 * 这是一种「乐观检查」策略：在用户操作的最早时机（按下 PTT）就检查，
 * 避免用户录完一段语音后才发现无法发送（浪费用户时间和精力）。
 *
 * 📚 学习要点: stopRecording 返回 Promise<RecordingResult | null>
 * stopRecording 不直接调用 sendVoice，而是返回录音结果给调用方。
 * 这让 PttButton（task 8.1）作为协调者连接 recorder → sender：
 *   const result = await voiceStore.stopRecording();
 *   if (result) sendVoice(result.blob, result.duration, result.mimeType);
 *
 * 为什么这样设计？
 * 1. 避免 voiceStore 对 voiceSender 的前向依赖（voiceSender 在 task 6.1 才实现）
 * 2. 保持 voiceStore 的单一职责：只管理录音状态，不关心发送逻辑
 * 3. PttButton 作为 UI 层的协调者，天然适合连接不同模块
 * 4. 更容易测试：voiceStore 的测试不需要 mock 发送逻辑
 *
 * 📚 学习要点: 单例播放策略（Singleton Playback）
 * 同一时间只允许一条语音消息播放（类似微信行为）。
 * 当用户点击另一条语音消息的播放按钮时：
 * 1. 自动停止当前正在播放的消息
 * 2. 将 activePlaybackId 切换为新消息的 transferId
 * 3. 开始播放新消息
 *
 * 为什么不允许多条同时播放？
 * - 语音消息是人声，多条同时播放会产生混乱的听觉体验
 * - 用户无法同时理解多段语音内容
 * - 简化状态管理：只需追踪一个 activePlaybackId
 * - 与主流即时通讯应用（微信、Telegram）的行为一致
 *
 * @module voice/voiceStore
 * @see types.ts — RecordingState, RecordingResult, PlaybackState, VoicePlaybackState
 * @see recorder.ts — createVoiceRecorder, VoiceRecorder
 * @see player.ts — createVoicePlayer, VoicePlayer
 * @see fileTransferStore.ts — activeSendId 互斥锁
 * @see design.md — Voice Store 设计
 */

import { create } from 'zustand';
import type { RecordingState, RecordingResult, PlaybackState, VoicePlaybackState } from './types';
import { createVoiceRecorder, type VoiceRecorder } from './recorder';
import { createVoicePlayer, type VoicePlayer } from './player';
import { useFileTransferStore } from '../file-transfer/fileTransferStore';
import { useI18nStore } from '../i18n/store';
import { translate } from '../i18n/translate';

// ============================================================================
// 常量定义
// ============================================================================

/**
 * 📚 学习要点: LRU 缓存容量限制
 * 每条语音消息解密后生成一个 Blob URL（内存中的音频数据）。
 * 60 秒 Opus 录音最大约 240KB，10 条 = 2.4MB（满足 NFR-7: ≤ 2.5MB）。
 *
 * 为什么选择 10？
 * - 覆盖绝大多数使用场景（用户通常只回放最近几条）
 * - 内存占用可控（2.4MB 对现代浏览器可忽略）
 * - ephemeral 模式下消息本身也会消失，缓存压力更小
 */
export const MAX_VOICE_CACHE = 10;

// ============================================================================
// 模块级单例：录音引擎
// ============================================================================

/**
 * 📚 学习要点: 为什么使用模块级单例？
 * VoiceRecorder 封装了 MediaRecorder 和 MediaStream 的生命周期。
 * 如果每次 startRecording 都创建新实例，需要确保旧实例被正确 dispose。
 * 使用单例模式：
 * 1. 整个应用只有一个录音引擎实例（符合物理现实：只有一个麦克风）
 * 2. 状态管理更简单：不需要追踪多个实例
 * 3. 资源释放更可靠：dispose 只需要调用一次
 *
 * 注意：单例在模块加载时创建，但不会立即请求麦克风权限。
 * 权限请求延迟到用户首次按下 PTT 按钮时（start() 调用时）。
 */
const recorder: VoiceRecorder = createVoiceRecorder();

// ============================================================================
// 模块级单例：播放引擎
// ============================================================================

/**
 * 📚 学习要点: 播放器单例与回调注册
 * 与 recorder 类似，player 也是模块级单例（只有一个音频输出设备）。
 * 但 player 需要通过回调将状态变化通知给 voiceStore。
 *
 * 问题：player 在模块顶层创建时，useVoiceStore 尚未定义（JavaScript 的 TDZ 限制）。
 * 解决方案：使用延迟初始化（lazy initialization）模式。
 * player 的回调函数在首次调用时通过 useVoiceStore.getState() 访问 store，
 * 此时 store 已经创建完毕。
 *
 * 回调的作用：
 * - onStateChange: 当播放状态变化时（playing/paused/idle），更新 playbackStates Map
 * - onTimeUpdate: 当播放进度变化时（约每 250ms），更新 currentTime
 *
 * 这种「回调注入」模式避免了 player.ts 直接 import voiceStore（循环依赖），
 * 同时让 voiceStore 成为播放状态的唯一权威来源（Single Source of Truth）。
 */
const player: VoicePlayer = createVoicePlayer({
  onStateChange: (transferId: string, state: PlaybackState) => {
    const store = useVoiceStore.getState();
    const currentStates = new Map(store.playbackStates);
    const existing = currentStates.get(transferId);

    const updated: VoicePlaybackState = {
      state,
      currentTime: state === 'idle' ? 0 : (existing?.currentTime ?? 0),
      duration: existing?.duration ?? 0,
    };
    currentStates.set(transferId, updated);

    // 如果状态变为 idle（播放完成或停止），清除 activePlaybackId
    const newActiveId = state === 'idle' || state === 'paused'
      ? (state === 'paused' ? store.activePlaybackId : null)
      : transferId;

    useVoiceStore.setState({
      playbackStates: currentStates,
      activePlaybackId: newActiveId,
    });
  },
  onTimeUpdate: (transferId: string, currentTime: number) => {
    // 委托给 store 的 updatePlaybackProgress action
    useVoiceStore.getState().updatePlaybackProgress(transferId, currentTime);
  },
  onError: (errorMessage: string) => {
    // 📚 学习要点: 播放错误通过 recordingError 通道显示
    // recordingError 虽然名字暗示"录音错误"，但实际上是语音模块的通用错误通道。
    // VoiceErrorToast 组件订阅此字段，显示所有语音相关的用户可见错误。
    // 播放错误（如 autoplay policy 阻止）也通过此通道通知用户。
    // 这避免了为播放错误单独创建另一个状态字段和 Toast 组件。
    useVoiceStore.setState({ recordingError: errorMessage });
  },
});

// ============================================================================
// 模块级状态：录音计时器
// ============================================================================

/**
 * 📚 学习要点: 为什么计时器放在模块级而非 store 内部？
 * setInterval 返回的 timer ID 不适合放在 Zustand state 中：
 * 1. timer ID 不是可序列化的纯数据（虽然是数字，但语义上是资源句柄）
 * 2. 每次 set() 都会触发订阅者重渲染，但 timer ID 变化不需要触发 UI 更新
 * 3. 模块级变量的生命周期与模块一致，不受 store 重置影响
 *
 * 计时器的作用：每秒更新 recordingElapsed，驱动 UI 显示录音时长。
 * 使用 Date.now() 差值而非累加计数器，确保即使标签页被节流也能显示准确时长。
 */
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动录音计时器：每秒更新 recordingElapsed。
 *
 * 📚 学习要点: 为什么使用 setInterval + Date.now() 而非纯 setInterval 累加？
 * 浏览器在标签页后台时会节流 setInterval（最低间隔从 1ms 变为 1000ms+）。
 * 如果使用累加计数器（elapsed++），标签页切回前台后计数器会落后于实际时间。
 *
 * Date.now() 差值方案：
 * - 录音开始时记录 startTime = Date.now()
 * - 每次 setInterval 回调时计算 elapsed = Math.floor((Date.now() - startTime) / 1000)
 * - 即使 setInterval 被节流，恢复后 elapsed 值仍然准确
 * - 唯一的影响是 UI 更新频率降低（但数值始终正确）
 */
function startElapsedTimer(): void {
  stopElapsedTimer(); // 防御性清理：确保没有残留的旧计时器

  elapsedTimer = setInterval(() => {
    const { recordingState, recordingStartTime } = useVoiceStore.getState();

    // 只在录音状态下更新（防御性检查）
    if (recordingState === 'recording' && recordingStartTime !== null) {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      useVoiceStore.setState({ recordingElapsed: elapsed });
    }
  }, 1000);
}

/** 停止录音计时器 */
function stopElapsedTimer(): void {
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取当前 locale 并翻译 i18n key。
 *
 * 📚 学习要点: 在非 React 上下文中使用 i18n
 * voiceStore 是纯逻辑模块（非 React 组件），不能使用 useTranslation() hook。
 * 直接通过 useI18nStore.getState().locale 同步获取当前语言设置，
 * 然后调用 translate(locale, key) 获取翻译文本。
 * 这与 recorder.ts 中的 t() 辅助函数模式一致。
 */
function t(key: Parameters<typeof translate>[1]): string {
  const locale = useI18nStore.getState().locale;
  return translate(locale, key);
}

// ============================================================================
// Store 接口定义
// ============================================================================

/**
 * 语音 Store 状态接口 — 录音状态切片 + 播放状态切片。
 *
 * 📚 学习要点: 接口分层设计
 * 当前定义了录音和播放相关的状态和操作。
 * 后续 task 4.1c 会扩展此接口，添加：
 * - LRU 缓存（blobCache, lruOrder）
 * - 对应的操作方法（registerVoiceBlob, evictBlob, cleanup）
 *
 * 分步实现的好处：
 * 1. 每个 task 的改动范围小，容易 review
 * 2. 可以独立测试每个切片的功能
 * 3. 避免一次性实现过多逻辑导致的复杂度爆炸
 */
interface VoiceStoreState {
  // === 录音状态 ===

  /** 当前录音状态（状态机的当前节点） */
  recordingState: RecordingState;

  /**
   * 录音开始时间戳（Date.now()），用于实时计算已录制时长。
   * null 表示当前未在录音。
   *
   * 📚 学习要点: 为什么存储 startTime 而非直接存储 elapsed？
   * 如果只存储 elapsed 并通过 setInterval 累加，会有两个问题：
   * 1. 标签页后台节流导致累加不准确
   * 2. 多个组件读取 elapsed 时可能看到不一致的值
   *
   * 存储 startTime 后，任何组件在任何时刻都可以通过
   * Math.floor((Date.now() - startTime) / 1000) 计算出准确的已录制时长。
   * recordingElapsed 只是一个"缓存值"，由计时器定期更新以驱动 UI 重渲染。
   */
  recordingStartTime: number | null;

  /**
   * 录音已持续时间（秒），由 setInterval 每秒更新。
   * 用于 UI 显示 "0:05" 格式的录音时长。
   *
   * 📚 学习要点: 为什么需要这个字段？
   * React 组件通过 Zustand selector 订阅此字段来触发重渲染。
   * 如果没有这个字段，组件需要自己维护 setInterval 来更新显示，
   * 导致每个使用录音时长的组件都需要重复的计时器逻辑。
   * 集中在 store 中更新，所有订阅者自动获得最新值。
   */
  recordingElapsed: number;

  /**
   * 录音错误信息（已通过 i18n translate() 获取本地化文案）。
   * null 表示无错误。错误会在下次 startRecording 时自动清除。
   *
   * 📚 学习要点: 错误状态的生命周期
   * 错误在以下时机产生：
   * - startRecording 时传输互斥检查失败 → 'voice.error.transferBusy'
   * - startRecording 时麦克风权限被拒绝 → 'voice.error.micDenied'
   * - stopRecording 时录音太短 → 'voice.error.tooShort'
   *
   * 错误在以下时机清除：
   * - 下次 startRecording 调用时（用户重新尝试）
   * - cancelRecording 调用时（用户主动取消）
   *
   * UI 组件（RecordingIndicator）订阅此字段，显示错误 toast 后自动消失。
   */
  recordingError: string | null;

  // === 播放状态 ===

  /**
   * 当前正在播放的语音消息 transferId。
   * null 表示没有语音消息正在播放。
   *
   * 📚 学习要点: 为什么需要 activePlaybackId？
   * 虽然可以遍历 playbackStates Map 找到 state === 'playing' 的条目，
   * 但维护一个独立的 activePlaybackId 有以下好处：
   * 1. O(1) 查找当前播放的消息（无需遍历 Map）
   * 2. UI 组件可以直接订阅此字段判断"是否有语音在播放"
   * 3. 语义更清晰：null 明确表示"无活跃播放"
   * 4. 方便实现单例播放策略：新播放前检查此字段即可
   */
  activePlaybackId: string | null;

  /**
   * 所有语音消息的播放状态映射：transferId → VoicePlaybackState。
   *
   * 📚 学习要点: 为什么使用 Map 而非普通对象？
   * 1. Map 的 key 可以是任意字符串（transferId 是 NanoID，可能包含特殊字符）
   * 2. Map 有明确的 size 属性，方便监控缓存大小
   * 3. Map 的迭代顺序是插入顺序（有利于 LRU 实现）
   * 4. Map 的 has/get/set 操作语义更清晰
   *
   * 📚 学习要点: Zustand 与 Map 的配合
   * Zustand 使用浅比较（Object.is）检测状态变化。
   * 更新 Map 时必须创建新的 Map 实例（new Map(oldMap)），
   * 否则 Zustand 认为状态未变化，不会触发订阅者重渲染。
   * 这是不可变数据模式在 Map 上的应用。
   */
  playbackStates: Map<string, VoicePlaybackState>;

  /**
   * 已解密的语音 Blob URL 缓存：transferId → blobUrl。
   * 这是 playVoice 查找音频数据的来源。
   *
   * 📚 学习要点: blobCache 的所有权与 LRU 淘汰
   * voiceStore 是语音 Blob URL 的唯一持有者。
   * fileTransferStore.cleanupTransfer() 会移除 TransferState（包括 blobUrl），
   * 因此 voiceStore 必须在 handleFileComplete 回调中立即复制 blobUrl 到 blobCache。
   * 之后 fileTransferStore 可以安全 cleanup 而不影响语音播放。
   *
   * 缓存容量限制为 MAX_VOICE_CACHE (10) 条，超出时按 LRU 策略淘汰最久未使用的。
   * 淘汰时调用 URL.revokeObjectURL() 释放内存。
   */
  blobCache: Map<string, string>;

  /**
   * LRU 访问顺序：最近访问的 transferId 在数组末尾。
   *
   * 📚 学习要点: 为什么用数组而非 Map 的插入顺序？
   * Map 的迭代顺序是插入顺序，但 LRU 需要的是"最近访问"顺序。
   * 当用户播放一条旧消息时，该消息应该移到"最近使用"的位置，
   * 避免被淘汰。数组可以通过 splice + push 实现这种重排序，
   * 而 Map 需要 delete + set 来改变顺序（语义不够直观）。
   *
   * lruOrder[0] = 最久未使用（下一个被淘汰的候选）
   * lruOrder[length-1] = 最近使用（最后被淘汰）
   */
  lruOrder: string[];

  // === Actions ===

  /**
   * 开始录音。
   * 前置检查：fileTransferStore.activeSendId 互斥锁。
   * 成功时：状态转为 recording，启动计时器。
   * 失败时：设置 recordingError，状态保持 idle。
   */
  startRecording: () => Promise<void>;

  /**
   * 停止录音并返回结果。
   * 返回 RecordingResult（录音 >= 500ms）或 null（录音太短）。
   * 调用方（PttButton）负责将结果传递给 voiceSender。
   *
   * 📚 学习要点: 为什么返回 Promise<RecordingResult | null>？
   * MediaRecorder.stop() 是异步的 — 需要等待最后一次 ondataavailable
   * 和 onstop 事件触发后才能获得完整的 Blob 数据。
   * 因此 stopRecording 返回 Promise，调用方 await 后才能安全使用结果。
   */
  stopRecording: () => Promise<RecordingResult | null>;

  /**
   * 取消录音：停止录制，丢弃数据，重置状态。
   * 用于组件卸载或用户主动取消场景。
   */
  cancelRecording: () => void;

  /**
   * 播放指定语音消息。
   *
   * 📚 学习要点: 单例播放策略的实现
   * playVoice 的执行流程：
   * 1. 从 blobCache 中查找 transferId 对应的 blobUrl
   * 2. 如果 blobUrl 不存在（Blob 未缓存或已被 LRU 淘汰），直接返回不做任何操作
   * 3. 委托给 player.play(transferId, blobUrl)
   * 4. player 内部会自动停止当前正在播放的消息（单例策略）
   * 5. 更新 activePlaybackId 为新的 transferId
   *
   * 为什么 playVoice 只接受 transferId 而非 blobUrl？
   * - 封装性：UI 组件不需要知道 blobUrl 的存储位置
   * - 安全性：voiceStore 可以验证 blobUrl 是否有效（存在于缓存中）
   * - 一致性：所有播放操作都通过 voiceStore 统一管理
   *
   * @param transferId - 要播放的语音消息的传输标识符
   */
  playVoice: (transferId: string) => void;

  /**
   * 暂停当前正在播放的语音消息。
   * 如果没有消息在播放，此操作为空操作（no-op）。
   *
   * 暂停后可以通过再次调用 playVoice(同一个 transferId) 来恢复播放。
   * 注意：当前实现中 playVoice 会从头开始播放，
   * 如果需要恢复功能，UI 层应检查 playbackState 并调用 player.resume()。
   */
  pauseVoice: () => void;

  /**
   * 更新播放进度。由 player 的 timeupdate 回调触发。
   *
   * 📚 学习要点: 为什么将进度更新暴露为 store action？
   * player 通过 onTimeUpdate 回调通知进度变化，回调内部调用此 action。
   * 将其作为 store action 而非直接在回调中 setState 的好处：
   * 1. 保持所有状态修改都通过 action 进行（可追踪、可调试）
   * 2. 可以在 action 内部添加额外逻辑（如节流、边界检查）
   * 3. 测试时可以直接调用此 action 模拟进度更新
   *
   * @param transferId - 正在播放的语音消息 transferId
   * @param currentTime - 当前播放位置（秒）
   */
  updatePlaybackProgress: (transferId: string, currentTime: number) => void;

  /**
   * 注册语音 Blob（在 handleFileComplete 回调中调用）。
   * 将解密后的 blobUrl 存入 LRU 缓存，如果缓存已满则淘汰最久未使用的。
   *
   * 📚 学习要点: LRU 淘汰策略
   * 每条语音消息解密后生成一个 Blob URL（内存中的音频数据）。
   * 如果不限制缓存数量，大量语音消息会导致内存溢出。
   * 使用 LRU（Least Recently Used）策略：
   * - 最多缓存 MAX_VOICE_CACHE (10) 条语音 Blob（NFR-6）
   * - 新消息进入时，如果超过限制，淘汰最久未播放的 Blob
   * - 淘汰时调用 URL.revokeObjectURL() 释放内存
   *
   * @param transferId - 语音消息的传输标识符
   * @param blobUrl - 解密后创建的 Blob URL
   */
  registerVoiceBlob: (transferId: string, blobUrl: string) => void;

  /**
   * 清理指定语音消息的资源。
   * 调用 URL.revokeObjectURL() 释放内存，从缓存和 lruOrder 中移除。
   *
   * 📚 学习要点: 触发时机
   * 1. LRU 缓存满时自动淘汰最旧的（registerVoiceBlob 内部调用）
   * 2. ephemeral 超时时外部调用（task 9.3）
   * 3. 用户离开房间时 cleanup() 批量调用
   *
   * @param transferId - 要淘汰的语音消息 transferId
   */
  evictBlob: (transferId: string) => void;

  /**
   * 清理所有资源（离开房间时调用）。
   * 释放所有 Blob URL，重置所有缓存和播放状态。
   */
  cleanup: () => void;
}

// ============================================================================
// Store 创建
// ============================================================================

/**
 * 语音 Zustand Store。
 *
 * 📚 学习要点: Zustand create() 模式
 * 与项目中其他 store（chatStore, fileTransferStore）保持一致的创建模式：
 * - create<StateInterface>((set, get) => ({ ...initialState, ...actions }))
 * - 使用 set() 更新状态（浅合并）
 * - 使用 get() 在 actions 中读取当前状态
 * - 组件通过 selector 订阅部分状态：useVoiceStore(s => s.recordingState)
 * - 非组件代码通过 .getState() 直接访问：useVoiceStore.getState().startRecording()
 */
export const useVoiceStore = create<VoiceStoreState>((set, get) => ({
  // ========================================================================
  // 初始状态
  // ========================================================================

  recordingState: 'idle',
  recordingStartTime: null,
  recordingElapsed: 0,
  recordingError: null,

  // --- 播放状态初始值 ---
  activePlaybackId: null,
  playbackStates: new Map<string, VoicePlaybackState>(),
  blobCache: new Map<string, string>(),
  lruOrder: [] as string[],

  // ========================================================================
  // Actions — 录音
  // ========================================================================

  startRecording: async () => {
    const { recordingState } = get();

    // 防御性检查：如果已经在录音/处理中，忽略重复调用
    if (recordingState !== 'idle') {
      return;
    }

    // 清除上一次的错误（用户重新尝试时清除旧错误）
    set({ recordingError: null });

    // ─── 传输互斥检查 ─────────────────────────────────────────────────
    // 📚 学习要点: 为什么在录音开始前检查而非发送时检查？
    // 如果等到录音完成后再检查互斥锁，用户可能已经录了 30 秒语音，
    // 然后被告知"请等待当前传输完成"— 这是极差的用户体验。
    // 在按下 PTT 的瞬间就检查，立即给出反馈，避免浪费用户时间。
    //
    // 📚 学习要点: 跨 Store 状态读取
    // 通过 useFileTransferStore.getState() 同步读取文件传输 store 的状态。
    // 这是 Zustand 的优势：无需 Provider 嵌套或 context 传递，
    // 任何模块都可以直接读取任何 store 的当前快照。
    const { activeSendId } = useFileTransferStore.getState();
    if (activeSendId !== null) {
      set({ recordingError: t('voice.error.transferBusy') });
      return;
    }

    // ─── 委托给 recorder 引擎 ────────────────────────────────────────
    // 📚 学习要点: voiceStore 与 recorder 的职责分离
    // voiceStore 负责：状态管理、前置条件检查、计时器、错误处理
    // recorder 负责：MediaRecorder API 交互、权限请求、Blob 组装
    //
    // voiceStore 不直接操作 MediaRecorder，而是通过 recorder 接口委托。
    // 这种分层让 voiceStore 的测试可以 mock recorder，
    // 而 recorder 的测试可以独立于 Zustand store 运行。
    set({ recordingState: 'requesting' });

    try {
      await recorder.start();

      // recorder.start() 成功 → 状态转为 recording
      set({
        recordingState: 'recording',
        recordingStartTime: Date.now(),
        recordingElapsed: 0,
      });

      // 启动 UI 计时器（每秒更新 recordingElapsed）
      startElapsedTimer();
    } catch (err: unknown) {
      // recorder.start() 失败（权限被拒绝或 MediaRecorder 创建失败）
      // recorder 内部已经清理了资源，这里只需要更新 store 状态
      set({
        recordingState: 'idle',
        recordingStartTime: null,
        recordingElapsed: 0,
        recordingError: err instanceof Error ? err.message : t('voice.error.micDenied'),
      });
    }
  },

  stopRecording: async (): Promise<RecordingResult | null> => {
    const { recordingState } = get();

    // 只有在录音状态下才能停止
    if (recordingState !== 'recording') {
      return null;
    }

    // 停止计时器
    stopElapsedTimer();

    // 更新状态为 processing（等待 Blob 生成）
    set({ recordingState: 'processing' });

    try {
      // 委托给 recorder 停止录音并获取结果
      // recorder.stop() 内部处理：
      // 1. 调用 MediaRecorder.stop()
      // 2. 等待 onstop 事件
      // 3. 组装 Blob
      // 4. 检查最短时长（< 500ms 返回 null）
      // 5. 释放 MediaStream tracks
      const result = await recorder.stop();

      // 重置录音状态
      set({
        recordingState: 'idle',
        recordingStartTime: null,
        recordingElapsed: 0,
      });

      // 如果录音太短（< 500ms），recorder 返回 null
      if (result === null) {
        set({ recordingError: t('voice.error.tooShort') });
      }

      // 返回结果给调用方（PttButton）
      // 调用方负责决定是否调用 sendVoice()
      return result;
    } catch (err: unknown) {
      // 异常情况（极罕见：MediaRecorder 内部错误）
      set({
        recordingState: 'idle',
        recordingStartTime: null,
        recordingElapsed: 0,
        recordingError: err instanceof Error ? err.message : t('voice.error.micDenied'),
      });
      return null;
    }
  },

  cancelRecording: () => {
    const { recordingState } = get();

    // 只有在非 idle 状态下才需要取消
    if (recordingState === 'idle') {
      return;
    }

    // 停止计时器
    stopElapsedTimer();

    // 委托给 recorder 取消（丢弃数据，释放资源）
    recorder.cancel();

    // 重置所有录音状态
    set({
      recordingState: 'idle',
      recordingStartTime: null,
      recordingElapsed: 0,
      recordingError: null,
    });
  },

  // ========================================================================
  // Actions — 播放
  // ========================================================================

  playVoice: (transferId: string) => {
    /**
     * 📚 学习要点: 单例播放策略的实现流程
     * 1. 从 blobCache 查找 blobUrl（voiceStore 是 Blob 的唯一持有者）
     * 2. 如果找不到 → 说明 Blob 未缓存或已被 LRU 淘汰，直接返回
     * 3. 委托给 player.play() — player 内部自动停止前一条播放（单例）
     * 4. 更新 activePlaybackId — player 的 onStateChange 回调会处理 playbackStates
     *
     * 为什么不在这里手动停止前一条？
     * player.play() 内部已经实现了"停止当前 → 播放新消息"的逻辑，
     * 并且会通过 onStateChange 回调通知 voiceStore 更新状态。
     * voiceStore 只需要设置 activePlaybackId，避免重复逻辑。
     */
    const { blobCache } = get();
    const blobUrl = blobCache.get(transferId);

    // 如果 blobUrl 不存在，无法播放（Blob 未注册或已被淘汰）
    if (!blobUrl) {
      return;
    }

    // 更新 activePlaybackId（player 的回调会更新 playbackStates）
    set({ activePlaybackId: transferId });

    // 📚 学习要点: 播放时更新 LRU 访问顺序
    // 用户播放一条语音消息意味着"最近使用"了它，应该移到 lruOrder 末尾。
    // 这确保频繁播放的消息不会被新消息淘汰（符合 LRU 语义）。
    const { lruOrder } = get();
    const newLruOrder = lruOrder.filter(id => id !== transferId);
    newLruOrder.push(transferId);
    set({ lruOrder: newLruOrder });

    // 委托给 player 引擎执行实际播放
    player.play(transferId, blobUrl);
  },

  pauseVoice: () => {
    /**
     * 📚 学习要点: pauseVoice 的防御性设计
     * 只有在确实有消息正在播放时才执行暂停操作。
     * player.pause() 内部也有状态检查，但在 store 层面提前检查
     * 可以避免不必要的 player 调用和状态更新。
     */
    const { activePlaybackId } = get();

    if (!activePlaybackId) {
      return;
    }

    // 委托给 player 暂停（player 的 onStateChange 回调会更新 playbackStates）
    player.pause();
  },

  updatePlaybackProgress: (transferId: string, currentTime: number) => {
    /**
     * 📚 学习要点: 进度更新的性能考量
     * timeupdate 事件约每 250ms 触发一次，每次都会调用此 action。
     * 每次调用都创建新的 Map 实例（不可变更新），触发订阅者重渲染。
     *
     * 这在语音消息场景下是可接受的：
     * - 同一时间只有一条消息在播放（单例策略）
     * - 只有正在播放的消息的 VoiceMessage 组件会订阅进度变化
     * - 250ms 的更新频率对进度条显示已经足够流畅
     *
     * 如果未来需要优化（如大量消息列表），可以考虑：
     * - 使用 Zustand 的 subscribeWithSelector 做精确订阅
     * - 或将 currentTime 放在 ref 中而非 store 中（避免重渲染）
     */
    const { playbackStates } = get();
    const existing = playbackStates.get(transferId);

    if (!existing) {
      return;
    }

    // 创建新的 Map 实例（不可变更新，触发 Zustand 浅比较检测变化）
    const newStates = new Map(playbackStates);
    newStates.set(transferId, {
      ...existing,
      currentTime,
    });

    set({ playbackStates: newStates });
  },

  // ========================================================================
  // Actions — LRU Blob 缓存
  // ========================================================================

  registerVoiceBlob: (transferId: string, blobUrl: string) => {
    /**
     * 📚 学习要点: LRU 缓存注册流程
     * 1. 如果 transferId 已在缓存中 → 更新 blobUrl 并将其移到 lruOrder 末尾（最近使用）
     * 2. 如果缓存未满 → 直接添加到缓存和 lruOrder 末尾
     * 3. 如果缓存已满 → 淘汰 lruOrder[0]（最久未使用），然后添加新条目
     *
     * 淘汰时调用 URL.revokeObjectURL() 释放 Blob 内存。
     * 这确保了内存使用不超过 MAX_VOICE_CACHE × 240KB ≈ 2.4MB（NFR-7）。
     */
    const { blobCache, lruOrder } = get();
    const newCache = new Map(blobCache);
    let newLruOrder = [...lruOrder];

    // 如果 transferId 已存在，先从 lruOrder 中移除（后面会重新添加到末尾）
    const existingIndex = newLruOrder.indexOf(transferId);
    if (existingIndex !== -1) {
      newLruOrder.splice(existingIndex, 1);
    }

    // 如果缓存已满且这是新条目，淘汰最久未使用的
    if (!blobCache.has(transferId) && newCache.size >= MAX_VOICE_CACHE) {
      const evictId = newLruOrder.shift(); // 移除最久未使用的（数组头部）
      if (evictId) {
        const evictedUrl = newCache.get(evictId);
        if (evictedUrl) {
          // 📚 学习要点: URL.revokeObjectURL 释放 Blob 内存
          // Blob URL 通过 URL.createObjectURL() 创建时，浏览器会在内存中
          // 保持对 Blob 数据的引用。即使没有任何变量引用该 URL 字符串，
          // Blob 数据也不会被 GC。必须显式调用 revokeObjectURL() 才能释放。
          URL.revokeObjectURL(evictedUrl);
        }
        newCache.delete(evictId);
      }
    }

    // 添加/更新缓存条目
    newCache.set(transferId, blobUrl);
    newLruOrder.push(transferId); // 添加到末尾（最近使用）

    set({ blobCache: newCache, lruOrder: newLruOrder });
  },

  evictBlob: (transferId: string) => {
    /**
     * 📚 学习要点: 显式淘汰的使用场景
     * 1. ephemeral 超时：消息消失时释放关联的 Blob
     * 2. 用户离开房间：cleanup() 内部批量调用
     * 3. 手动清理：未来可能的"清除缓存"功能
     *
     * 与 registerVoiceBlob 中的自动淘汰不同，显式淘汰不需要检查缓存容量，
     * 直接释放指定 transferId 的资源。
     */
    const { blobCache, lruOrder } = get();
    const blobUrl = blobCache.get(transferId);

    if (!blobUrl) {
      // transferId 不在缓存中，无需操作
      return;
    }

    // 释放 Blob URL 内存
    URL.revokeObjectURL(blobUrl);

    // 从缓存中移除
    const newCache = new Map(blobCache);
    newCache.delete(transferId);

    // 从 lruOrder 中移除
    const newLruOrder = lruOrder.filter(id => id !== transferId);

    set({ blobCache: newCache, lruOrder: newLruOrder });
  },

  cleanup: () => {
    /**
     * 📚 学习要点: 全量清理的使用场景
     * 用户离开房间时调用，释放所有语音相关资源：
     * 1. 停止当前播放（如果有）
     * 2. 释放所有 Blob URL（防止内存泄漏）
     * 3. 重置所有状态到初始值
     *
     * 这是一个"核弹级"清理操作，确保离开房间后不会有任何残留资源。
     */
    const { blobCache } = get();

    // 释放所有 Blob URL
    for (const blobUrl of blobCache.values()) {
      URL.revokeObjectURL(blobUrl);
    }

    // 停止播放
    player.stop();

    // 重置所有状态
    set({
      activePlaybackId: null,
      playbackStates: new Map(),
      blobCache: new Map(),
      lruOrder: [],
    });
  },
}));

// ============================================================================
// 回调注册：连接 file-transfer → voice 的数据流
// ============================================================================

/**
 * 📚 学习要点: 回调注册模式（Callback Registration Pattern）
 * 
 * 问题：receiver.ts 在 handleFileComplete 中需要通知 voiceStore 语音传输已完成，
 * 但如果 receiver.ts 直接 import voiceStore，会形成循环依赖：
 *   file-transfer/receiver.ts → voice/voiceStore.ts → file-transfer/fileTransferStore.ts
 *
 * 解决方案：
 * 1. fileTransferStore 提供 registerTransferCompleteCallback / unregisterTransferCompleteCallback
 * 2. voiceStore 在首次使用时注册回调（延迟注册，避免模块加载顺序问题）
 * 3. receiver.ts 在 handleFileComplete 中调用已注册的回调
 * 4. 依赖方向变为单向：voice → file-transfer（无反向依赖）
 *
 * 为什么使用延迟注册而非模块加载时注册？
 * 模块加载时 useFileTransferStore 可能尚未完成初始化（循环依赖导致的 TDZ 问题）。
 * 使用 Zustand 的 subscribe 机制在 store 首次被订阅时触发注册，确保所有依赖已就绪。
 */
let _callbackRegistered = false;

function ensureCallbackRegistered(): void {
  if (_callbackRegistered) return;
  _callbackRegistered = true;

  useFileTransferStore.getState().registerTransferCompleteCallback(
    (transferId: string, blobUrl: string, metadata) => {
      if (metadata.isVoice) {
        useVoiceStore.getState().registerVoiceBlob(transferId, blobUrl);
      }
    }
  );
}

// 📚 学习要点: 通过 subscribe 触发延迟注册
// Zustand 的 subscribe 在 store 被首次使用时（组件挂载或 getState 调用）触发。
// 我们利用这个时机注册回调，确保 fileTransferStore 已完成初始化。
// unsubscribe 立即调用（只需要触发一次注册）。
useVoiceStore.subscribe(() => {
  ensureCallbackRegistered();
});

// 同时提供一个手动触发入口，供 App 初始化时调用（确保即使没有组件订阅也能注册）
export function initVoiceModule(): void {
  ensureCallbackRegistered();
}
