/**
 * 语音消息时间格式化工具函数。
 *
 * 本文件提供将秒数转换为用户友好的 "M:SS" 格式字符串的工具函数，
 * 用于录音指示器（"正在录音 0:05"）和语音气泡（"▶️ 0:30"）的时长显示。
 *
 * 📚 学习要点: 为什么将格式化逻辑抽取为独立文件？
 * 1. 单一职责原则（SRP）— 格式化是纯逻辑，不依赖任何状态或副作用
 * 2. 可测试性 — 纯函数极易编写属性测试（Property-Based Test）
 * 3. 复用性 — RecordingIndicator 和 VoiceMessage 组件都需要格式化时长
 * 4. 关注点分离 — UI 组件不应包含格式化逻辑（即使只有几行代码）
 *
 * @module voice/formatDuration
 * @see design.md — Property 4: Duration format correctness
 * @see requirements.md — Requirement 5.7
 */

/**
 * 将秒数格式化为 "M:SS" 格式的时长字符串。
 *
 * 📚 学习要点: "M:SS" 格式的设计选择
 * 语音消息最长 60 秒（Requirements 1.8），因此分钟数只有 0 或 1，
 * 不需要两位数的分钟格式（"MM:SS"）。使用 "M:SS" 更紧凑：
 * - "0:05" 比 "00:05" 更自然（类似微信、Telegram 的语音时长显示）
 * - 秒数始终两位（零填充），避免 "0:5" 这种不对齐的显示
 *
 * 📚 学习要点: 防御性编程 — 处理非法输入
 * 虽然调用方（voiceStore、RecordingIndicator）理论上只会传入 [0, 60] 范围的值，
 * 但作为工具函数，应该对所有可能的输入都有确定性行为：
 * - 负数 → 视为 0（录音不可能有负时长）
 * - 小数 → Math.floor 取整（Date.now() 差值除以 1000 可能产生小数）
 * - NaN/Infinity → 视为 0（防止 UI 显示 "NaN:NaN"）
 *
 * 📚 学习要点: Math.floor vs Math.round
 * 使用 Math.floor 而非 Math.round，因为录音计时器应该显示"已经过去的完整秒数"。
 * 例如录了 4.9 秒，应该显示 "0:04"（4 个完整秒已过去），
 * 而非 "0:05"（用户会困惑为什么松开时提示"录音时间太短"但显示了 5 秒）。
 *
 * @param seconds - 时长（秒），可以是任意数字（函数内部处理边界情况）
 * @returns 格式化后的时长字符串，格式为 "M:SS"（如 "0:00", "0:30", "1:00"）
 *
 * @example
 * formatDuration(0)   // "0:00"
 * formatDuration(5)   // "0:05"
 * formatDuration(30)  // "0:30"
 * formatDuration(60)  // "1:00"
 * formatDuration(65)  // "1:05"
 * formatDuration(-1)  // "0:00" (负数归零)
 * formatDuration(3.7) // "0:03" (向下取整)
 */
export function formatDuration(seconds: number): string {
  // 📚 学习要点: 输入规范化（Input Normalization）
  // 先处理所有非法输入，将其归一化为非负整数，
  // 后续逻辑只需要处理 [0, +∞) 范围的整数，大大简化了代码。
  // Number.isFinite() 同时排除了 NaN 和 ±Infinity。
  const safeSeconds = Number.isFinite(seconds) && seconds > 0
    ? Math.floor(seconds)
    : 0;

  // 📚 学习要点: 整数除法与取模运算
  // JavaScript 没有整数除法运算符，使用 Math.floor(a / b) 模拟。
  // 取模运算 (%) 获取除法的余数，即不足一分钟的剩余秒数。
  // 例如 65 秒: minutes = Math.floor(65/60) = 1, remainingSeconds = 65 % 60 = 5
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  // 📚 学习要点: String.prototype.padStart() 零填充
  // padStart(2, '0') 确保秒数始终显示为两位数字：
  // - "5" → "05"（填充一个零）
  // - "30" → "30"（已经两位，不填充）
  // - "0" → "00"（填充一个零）
  // 这是 ES2017 引入的字符串方法，所有现代浏览器都支持。
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
