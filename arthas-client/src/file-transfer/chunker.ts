/**
 * 文件分片与重组模块。
 *
 * 本文件提供文件传输的两个核心纯函数：
 * - streamChunks(): 发送方使用，将 File 对象流式分片为 64KB 的 ArrayBuffer
 * - reassembleChunks(): 接收方使用，将接收到的分片缓冲区重组为完整的 Blob
 *
 * 📚 学习要点: 流式处理 vs 批量处理
 * 传统方式：先将整个文件读入内存（file.arrayBuffer()），再切片
 * - 峰值内存 = 文件大小 × 2（原始 ArrayBuffer + 分片副本）
 * - 5MB 文件 → 10MB 峰值内存
 *
 * 流式方式：使用 File.slice() 按需读取每个 chunk
 * - 峰值内存 = 1 个 chunk（64KB）+ 加密后的 chunk（~64KB）
 * - 峰值内存 ≈ 128KB，与文件大小无关
 * - 在移动端或低内存设备上，这个差异可能决定页面是否 OOM 崩溃
 *
 * 📚 学习要点: AsyncGenerator（异步生成器）
 * `async function*` 定义一个异步生成器函数，它可以：
 * 1. 使用 `yield` 逐个产出值（惰性求值，不一次性生成所有值）
 * 2. 使用 `await` 等待异步操作（如 File.slice().arrayBuffer()）
 * 3. 被 `for await...of` 循环消费
 *
 * 这完美匹配了"逐片读取 → 加密 → 发送"的流水线模式：
 * - 生产者（streamChunks）按需产出 chunk
 * - 消费者（sender）逐个处理，处理完一个再请求下一个
 * - 内存中同时只有一个 chunk 的数据
 *
 * @module file-transfer/chunker
 * @see design.md — 流式分片策略和 File.slice() 零拷贝特性
 * @see Requirements 2.1, 2.2, 5.3
 */

import { CHUNK_SIZE } from './types';

/**
 * 流式分片：将 File 对象逐片读取为 ArrayBuffer。
 *
 * 使用 File.slice() 实现零拷贝的按需读取，避免一次性加载整个文件到内存。
 * 每次 yield 一个 chunk 后，调用方可以立即加密并发送，
 * 然后 GC 可以回收上一个 chunk 的内存。
 *
 * 📚 学习要点: File.slice() 的零拷贝特性
 * File 对象是对磁盘文件的引用（继承自 Blob），slice() 不会复制数据，
 * 只是创建一个指向原始文件特定字节范围的新 Blob 引用。
 * 只有调用 arrayBuffer() 时才真正从磁盘读取数据到内存。
 * 这意味着即使文件有 5MB，内存中同时只有 1 个 64KB chunk。
 *
 * 📚 学习要点: 为什么返回 ArrayBuffer 而非 Uint8Array？
 * Web Crypto API 的 encrypt() 方法接受 BufferSource（ArrayBuffer | TypedArray）。
 * 直接返回 ArrayBuffer 避免了一次 new Uint8Array(buffer) 的包装开销。
 * 如果消费者需要 Uint8Array，可以自行包装：new Uint8Array(data)。
 *
 * @param file - 要分片的 File 对象（来自 <input type="file"> 或拖拽）
 * @yields 每个 chunk 的索引和数据：{ index: number, data: ArrayBuffer }
 *
 * @example
 * ```typescript
 * const file = inputElement.files[0]; // 用户选择的文件
 * for await (const { index, data } of streamChunks(file)) {
 *   const { iv, ciphertext } = await encryptChunk(roomKey, data);
 *   ws.send(MSG_SEND_FILE_CHUNK, { transferId, index, iv, data: ciphertext });
 *   await delay(10); // 限速：10ms 间隔
 * }
 * ```
 */
export async function* streamChunks(
  file: File
): AsyncGenerator<{ index: number; data: ArrayBuffer }> {
  // 计算总分片数：向上取整（最后一片可能不足 CHUNK_SIZE）
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    // 计算当前 chunk 的字节范围 [start, end)
    // 📚 学习要点: slice(start, end) 的 end 是排他的（exclusive）
    // 与数组的 slice() 行为一致：包含 start，不包含 end
    // Math.min 确保最后一片不超过文件实际大小
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);

    // File.slice() 创建一个 Blob 引用（零拷贝，不读取磁盘）
    // .arrayBuffer() 才真正触发磁盘 I/O，将指定范围的字节读入内存
    const slice = file.slice(start, end);
    const data = await slice.arrayBuffer();

    yield { index: i, data };
    // yield 后，如果调用方不再持有 data 的引用，
    // GC 可以在下一次循环前回收这块内存
  }
}

/**
 * 重组分片：将接收到的 chunk 缓冲区合并为完整的 Blob。
 *
 * 接收方在收齐所有 chunk 后调用此函数，将按索引排列的分片数据
 * 合并为一个 Blob 对象，可用于创建下载 URL 或进一步处理。
 *
 * 📚 学习要点: 为什么返回 Blob 而非 ArrayBuffer？
 * 1. Blob 可以直接用于 URL.createObjectURL() 创建下载链接
 * 2. Blob 是不可变的（immutable），浏览器可以优化其内存管理
 * 3. 大文件的 Blob 可能由浏览器存储在磁盘上（而非全部在内存中）
 * 4. new Blob([...chunks]) 的实现通常是零拷贝的——
 *    浏览器只是记录各个 chunk 的引用，不会立即复制所有数据
 *
 * 📚 学习要点: 为什么参数是 (Uint8Array | null)[]？
 * 接收方的 chunk 缓冲区初始化为 null 数组（表示尚未收到）。
 * 收到并解密每个 chunk 后，对应索引位置被填充为 Uint8Array。
 * 调用 reassembleChunks 时，所有位置应该都已填充（非 null）。
 * null 值会被过滤掉——这是一种防御性编程，防止因 bug 导致的不完整重组。
 * 正常流程中，调用方应在确认所有 chunk 都已收到后才调用此函数。
 *
 * @param chunks - 按索引排列的分片缓冲区，null 表示该分片未收到
 * @param mimeType - 文件的 MIME 类型，用于创建正确类型的 Blob
 * @returns 重组后的完整文件 Blob
 *
 * @example
 * ```typescript
 * // 接收方确认所有 chunk 已收齐
 * if (receivedChunks === totalChunks) {
 *   const blob = reassembleChunks(chunkBuffer, mimeType);
 *   const url = URL.createObjectURL(blob);
 *   // 用户点击下载时使用此 URL
 * }
 * ```
 */
export function reassembleChunks(
  chunks: (Uint8Array | null)[],
  mimeType: string
): Blob {
  // 过滤掉 null 值（防御性编程）
  // 📚 学习要点: TypeScript 类型收窄（Type Narrowing）
  // filter(Boolean) 可以过滤 falsy 值，但 TypeScript 无法自动推断结果类型。
  // 使用类型谓词 `(chunk): chunk is Uint8Array` 告诉编译器：
  // 过滤后的数组元素类型从 `Uint8Array | null` 收窄为 `Uint8Array`。
  const validChunks = chunks.filter(
    (chunk): chunk is Uint8Array => chunk !== null
  );

  // 使用 Blob 构造函数合并所有 chunk
  // 📚 学习要点: Blob 构造函数的高效合并
  // new Blob(blobParts, options) 接受一个 BlobPart[] 数组。
  // BlobPart 可以是 ArrayBuffer、TypedArray、Blob 或 string。
  // 浏览器实现通常不会立即复制所有数据到连续内存，
  // 而是维护一个内部的"部件列表"（part list），
  // 只有在需要连续访问时（如 blob.arrayBuffer()）才真正合并。
  // 这意味着对于大文件，Blob 创建本身是 O(N) 时间但接近零拷贝。
  //
  // 类型断言说明：TypeScript 5.x 将 Uint8Array 泛型化为 Uint8Array<ArrayBufferLike>，
  // 而 Blob 构造函数要求 BlobPart[]（基于 ArrayBuffer，不含 SharedArrayBuffer）。
  // 在浏览器环境中，Uint8Array.buffer 始终是 ArrayBuffer（SharedArrayBuffer 需要
  // Cross-Origin-Isolation headers），因此 `as BlobPart[]` 断言是安全的。
  return new Blob(validChunks as BlobPart[], { type: mimeType });
}
