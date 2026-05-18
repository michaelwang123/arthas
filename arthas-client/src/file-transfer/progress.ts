/**
 * @file progress.ts — 文件传输进度计算纯函数
 *
 * 本文件提供文件传输进度相关的纯计算函数，供 UI 组件（ProgressBar、FileMessage）使用。
 * 所有函数都是无副作用的纯函数，便于测试和组合。
 *
 * 📚 学习要点: 为什么将进度计算抽取为独立纯函数？
 * 1. 可测试性：纯函数可以用属性测试验证数学不变量（如进度永远在 [0, 100]）
 * 2. 复用性：ProgressBar 和 FileMessage 都需要这些计算，避免重复逻辑
 * 3. 关注点分离：UI 组件只负责渲染，计算逻辑集中在此文件
 * 4. 性能：纯函数可以被 React.memo / useMemo 安全缓存
 *
 * 进度计算公式：
 * - 百分比 = Math.floor(receivedChunks / totalChunks × 100)
 * - 速度 = bytesTransferred / elapsedSeconds (KB/s)
 * - 预计剩余时间 = remainingBytes / speed (seconds)
 *
 * @module file-transfer/progress
 * @see design.md — 进度显示设计
 * @see requirements.md — Requirements 7.1, 7.4, 7.5
 */

// ============================================================================
// 进度百分比计算
// ============================================================================

/**
 * 计算文件传输进度百分比。
 *
 * 📚 学习要点: 为什么使用 Math.floor 而非 Math.round？
 * - Math.floor 确保进度条不会在最后一个 chunk 到达前显示 100%
 * - 用户心理预期：看到 100% 意味着传输完成，如果 round 到 100% 但实际还差一个 chunk，
 *   会造成"完成了但还在等待"的困惑体验
 * - 只有当 receivedChunks === totalChunks 时才返回精确的 100
 *
 * 📚 学习要点: 防御性编程 — 输入验证
 * totalChunks 必须 > 0（除以零保护）。
 * receivedChunks 被 clamp 到 [0, totalChunks] 范围，防止异常状态导致进度超出 [0, 100]。
 *
 * @param receivedChunks - 已接收/已发送的分片数量
 * @param totalChunks - 分片总数（必须 > 0）
 * @returns 进度百分比，整数，范围 [0, 100]
 *
 * @example
 * ```typescript
 * calculateProgress(0, 80);   // 0
 * calculateProgress(40, 80);  // 50
 * calculateProgress(80, 80);  // 100
 * calculateProgress(79, 80);  // 98 (floor, not round)
 * ```
 */
export function calculateProgress(receivedChunks: number, totalChunks: number): number {
  // 防御性检查：totalChunks 必须为正整数
  if (totalChunks <= 0) {
    return 0;
  }

  // Clamp receivedChunks 到合法范围 [0, totalChunks]
  const clamped = Math.max(0, Math.min(receivedChunks, totalChunks));

  // 使用 Math.floor 确保不会提前显示 100%
  return Math.floor((clamped / totalChunks) * 100);
}

// ============================================================================
// 传输速度计算
// ============================================================================

/**
 * 计算文件传输速度（KB/s）。
 *
 * 📚 学习要点: 为什么使用毫秒作为输入而非秒？
 * - Date.now() 和 performance.now() 都返回毫秒值
 * - 避免调用方进行 ms → s 转换（减少出错机会）
 * - 内部转换为秒进行计算，对外暴露 KB/s 单位（用户友好）
 *
 * 📚 学习要点: 边界情况处理
 * - elapsedMs <= 0：传输刚开始或时钟异常，返回 0（避免除以零或负速度）
 * - bytesTransferred < 0：异常状态，返回 0（速度不应为负）
 * - 正常情况：bytes / 1024 / (ms / 1000) = bytes × 1000 / (ms × 1024)
 *
 * @param bytesTransferred - 已传输的字节数
 * @param elapsedMs - 已经过的时间（毫秒）
 * @returns 传输速度，单位 KB/s，非负数
 *
 * @example
 * ```typescript
 * calculateSpeed(65536, 1000);  // 64 KB/s (64KB in 1 second)
 * calculateSpeed(0, 1000);      // 0 KB/s
 * calculateSpeed(1024, 0);      // 0 KB/s (elapsed is 0, avoid division by zero)
 * ```
 */
export function calculateSpeed(bytesTransferred: number, elapsedMs: number): number {
  // 防御性检查：时间必须为正数（避免除以零）
  if (elapsedMs <= 0) {
    return 0;
  }

  // 防御性检查：传输字节数不应为负
  if (bytesTransferred < 0) {
    return 0;
  }

  // 计算速度：bytes → KB，ms → s
  // 公式：(bytesTransferred / 1024) / (elapsedMs / 1000)
  // 简化：bytesTransferred * 1000 / (elapsedMs * 1024)
  return (bytesTransferred * 1000) / (elapsedMs * 1024);
}

// ============================================================================
// 预计剩余时间计算
// ============================================================================

/**
 * 计算预计剩余传输时间（秒）。
 *
 * 📚 学习要点: ETA 计算的不确定性
 * ETA（Estimated Time of Arrival）本质上是一个估算值：
 * - 假设当前速度保持不变（实际网络速度会波动）
 * - 当速度为 0 时返回 Infinity（表示无法估算）
 * - UI 层可以选择显示 "计算中..." 或 "∞" 来处理 Infinity
 *
 * 📚 学习要点: 为什么 speed=0 时返回 Infinity 而非一个大数？
 * - Infinity 是 JavaScript 的合法数值，可以参与比较（Infinity > 100 === true）
 * - UI 层可以用 `Number.isFinite(eta)` 精确判断是否有有效 ETA
 * - 使用大数（如 999999）会导致 UI 显示不合理的时间（"277 小时"）
 * - Infinity 语义更清晰：速度为零意味着永远无法完成
 *
 * @param remainingBytes - 剩余待传输的字节数
 * @param speedKBps - 当前传输速度（KB/s），由 calculateSpeed() 计算得到
 * @returns 预计剩余时间（秒），非负数或 Infinity
 *
 * @example
 * ```typescript
 * calculateEta(65536, 64);   // 1 second (64KB remaining at 64KB/s)
 * calculateEta(131072, 64);  // 2 seconds (128KB remaining at 64KB/s)
 * calculateEta(1024, 0);     // Infinity (speed is 0, cannot estimate)
 * calculateEta(0, 64);       // 0 seconds (nothing remaining)
 * ```
 */
export function calculateEta(remainingBytes: number, speedKBps: number): number {
  // 防御性检查：剩余字节数不应为负
  if (remainingBytes <= 0) {
    return 0;
  }

  // 速度为 0 或负数时，无法估算剩余时间
  if (speedKBps <= 0) {
    return Infinity;
  }

  // 计算 ETA：remainingBytes / (speedKBps × 1024) = 剩余秒数
  // speedKBps 单位是 KB/s，转换为 bytes/s 需要 × 1024
  return remainingBytes / (speedKBps * 1024);
}
