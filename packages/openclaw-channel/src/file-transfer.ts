/**
 * @file file-transfer.ts — 文件传输协议适配（Node.js 版本）
 *
 * 本文件实现 Arthas 分片文件传输协议的 Node.js 适配层，
 * 供 OpenClaw Channel Plugin 使用。包含两个核心类：
 *
 * 1. **FileReceiver** — 接收端：收集 META/CHUNK/COMPLETE 消息，解密并重组文件
 * 2. **FileSender** — 发送端：将文件分片、加密，生成待发送的消息序列
 *
 * 📚 学习要点: 与 Web 客户端实现的差异
 * Web 客户端（arthas-client/src/file-transfer/）使用：
 * - Web Crypto API（crypto.subtle）进行加密/解密
 * - Zustand Store 管理传输状态
 * - File API + Blob 处理文件数据
 * - 浏览器 WebSocket API 发送数据
 *
 * 本 Node.js 实现使用：
 * - Node.js crypto 模块（src/crypto.ts 中的 encrypt/decrypt）
 * - 纯函数式设计（无状态管理库依赖）
 * - Buffer 处理文件数据
 * - 返回消息数组，由调用方决定如何发送（解耦 WebSocket 层）
 *
 * 📚 学习要点: 为什么 FileSender 不直接发送消息？
 * 遵循「关注点分离」原则：
 * - FileSender 只负责「准备数据」（分片 + 加密 + 构造消息）
 * - WebSocket 发送由 adapter.ts 或 client.ts 负责
 * - 这使得 FileSender 可以独立测试（无需 mock WebSocket）
 * - 也允许调用方控制发送节奏（如添加延迟、流控）
 *
 * @module openclaw-channel/file-transfer
 * @see design.md — D7: 文件传输适配
 * @see requirements.md — Requirement 5: 文件传输支持
 * @see protocol.ts — 文件传输消息类型定义
 */

import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, toBase64Url, fromBase64Url, encryptBuffer, decryptBuffer } from './crypto.js';
import type {
  SendFileMetaData,
  SendFileChunkData,
  SendFileCompleteData,
  RelayFileMetaData,
  RelayFileChunkData,
  RelayFileCompleteData,
  RelayFileCancelData,
} from './protocol.js';
import {
  MSG_SEND_FILE_META,
  MSG_SEND_FILE_CHUNK,
  MSG_SEND_FILE_COMPLETE,
} from './protocol.js';

// ============================================================================
// 常量定义
// ============================================================================

/**
 * 文件大小上限：5MB (5 * 1024 * 1024 = 5,242,880 字节)。
 *
 * 📚 学习要点: 为什么限制 5MB？
 * - WebSocket 消息在内存中缓冲，过大的文件会导致内存压力
 * - Arthas 服务器对单个传输有超时限制（90s），5MB 在大多数网络下可在此时间内完成
 * - 对于 AI Agent 场景，5MB 足以覆盖代码文件、文档、图片等常见附件
 * - 与 Web 客户端和 CLI 客户端保持一致的限制
 */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

/**
 * 分片大小：64KB (64 * 1024 = 65,536 字节)。
 *
 * 📚 学习要点: 为什么选择 64KB？
 * - 与 Arthas Web 客户端保持一致（CHUNK_SIZE = 64 * 1024）
 * - 64KB 是 WebSocket 帧大小和网络 MTU 的良好平衡点
 * - 5MB 文件 = 80 个 chunk，进度粒度约 1.25%（足够平滑）
 * - 每个 chunk 加密后增加 16 字节 auth tag + 12 字节 IV = ~64KB + 28 字节
 * - 不会超过 Arthas 服务器的 maxMessageSize 限制
 */
export const CHUNK_SIZE = 64 * 1024;

// ============================================================================
// 文件元数据接口
// ============================================================================

/**
 * 加密传输的文件元数据（JSON 序列化后加密发送）。
 *
 * 📚 学习要点: 元数据加密的安全意义
 * 文件名、大小、MIME 类型都是敏感信息（可能泄露用户意图）。
 * 将元数据加密后发送，确保服务器无法得知用户传输了什么类型的文件。
 * 服务器只能看到 transferId（用于路由）和加密后的二进制数据。
 */
export interface FileMetadata {
  /** 文件名（如 'report.pdf'） */
  name: string;
  /** 文件大小（字节） */
  size: number;
  /** MIME 类型（如 'application/pdf'） */
  mimeType: string;
  /** 总分片数（= Math.ceil(size / CHUNK_SIZE)） */
  totalChunks: number;
}

// ============================================================================
// 进度回调类型
// ============================================================================

/**
 * 传输进度回调函数类型。
 *
 * 📚 学习要点: 回调 vs 事件发射器
 * 使用简单回调而非 EventEmitter，因为：
 * - 只有一个消费者（adapter 的日志逻辑）
 * - 类型安全更好（参数有明确类型）
 * - 无需引入额外依赖
 * - 生命周期简单（传输结束后回调自然不再被调用）
 *
 * @param processedChunks - 已处理的分片数量
 * @param totalChunks - 总分片数量
 */
export type ProgressCallback = (processedChunks: number, totalChunks: number) => void;

// ============================================================================
// FileSender — 文件发送端
// ============================================================================

/**
 * FileSender 生成的单条待发送消息。
 *
 * 📚 学习要点: 消息信封设计
 * 每条消息包含 type（消息类型码）和 data（消息负载）。
 * 调用方使用 encodeMessage(msg.type, msg.data) 编码后通过 WebSocket 发送。
 * 这种设计让 FileSender 与传输层完全解耦。
 */
export interface FileTransferMessage {
  /** 消息类型码（MSG_SEND_FILE_META / MSG_SEND_FILE_CHUNK / MSG_SEND_FILE_COMPLETE） */
  type: number;
  /** 消息负载数据 */
  data: SendFileMetaData | SendFileChunkData | SendFileCompleteData;
}

/**
 * FileSender — 文件发送引擎。
 *
 * 将文件数据分片、加密，生成完整的消息序列（META → CHUNK × N → COMPLETE）。
 * 不直接操作 WebSocket，而是返回消息数组供调用方发送。
 *
 * 📚 学习要点: 发送流程
 * 1. 验证文件大小（不超过 5MB）
 * 2. 生成唯一 transferId（用于标识本次传输）
 * 3. 加密文件元数据（JSON → encrypt → base64url IV + binary ciphertext）
 * 4. 将文件 Buffer 按 64KB 分片
 * 5. 每个分片独立加密（随机 IV，确保 AES-GCM 安全性）
 * 6. 生成 COMPLETE 消息标记传输结束
 *
 * 使用示例：
 * ```typescript
 * const sender = new FileSender(aesKey);
 * const messages = sender.prepareTransfer(fileBuffer, {
 *   name: 'report.pdf',
 *   size: fileBuffer.length,
 *   mimeType: 'application/pdf',
 * }, (sent, total) => console.log(`${sent}/${total}`));
 *
 * for (const msg of messages) {
 *   const binary = encodeMessage(msg.type, msg.data);
 *   ws.send(binary);
 *   await delay(10); // 可选：分片间延迟
 * }
 * ```
 *
 * @see design.md — D7: 文件传输适配
 * @see requirements.md — Requirement 5.4: 发送文件
 */
export class FileSender {
  /** AES-256 加密密钥（从分享码派生） */
  private readonly key: Buffer;

  /**
   * 创建 FileSender 实例。
   *
   * @param key - 32 字节 AES-256 密钥（从 deriveKey(shareCode) 获取）
   */
  constructor(key: Buffer) {
    this.key = key;
  }

  /**
   * 准备文件传输：生成完整的消息序列。
   *
   * 📚 学习要点: 同步 vs 异步设计选择
   * 本方法是同步的，因为 Node.js crypto 模块的加密操作是同步的
   * （createCipheriv 不返回 Promise）。这与 Web 客户端不同
   * （Web Crypto API 的 encrypt() 返回 Promise）。
   * 同步设计简化了调用方代码，且 Node.js 环境下加密性能足够。
   *
   * @param fileData - 文件内容 Buffer
   * @param metadata - 文件元数据（name, size, mimeType）
   * @param onProgress - 可选的进度回调（每个 chunk 加密后调用）
   * @returns 待发送的消息数组（META + CHUNK × N + COMPLETE）
   * @throws 如果文件大小超过 5MB 限制
   * @throws 如果文件为空（0 字节）
   */
  prepareTransfer(
    fileData: Buffer,
    metadata: Omit<FileMetadata, 'totalChunks'>,
    onProgress?: ProgressCallback
  ): FileTransferMessage[] {
    // 1. 验证文件大小
    if (fileData.length === 0) {
      throw new Error('文件为空，无法发送');
    }
    if (fileData.length > MAX_FILE_SIZE) {
      throw new Error(
        `文件大小 ${fileData.length} 字节超过限制 ${MAX_FILE_SIZE} 字节 (5MB)`
      );
    }

    // 2. 计算分片数量
    const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE);

    // 3. 生成唯一 transferId（21 字符随机 hex，模拟 NanoID）
    const transferId = randomBytes(16).toString('hex').slice(0, 21);

    // 4. 构建完整元数据
    const fullMetadata: FileMetadata = {
      ...metadata,
      totalChunks,
    };

    const messages: FileTransferMessage[] = [];

    // 5. 生成 META 消息（加密元数据）
    messages.push(this.createMetaMessage(transferId, fullMetadata));

    // 6. 生成 CHUNK 消息（逐片加密）
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileData.length);
      const chunk = fileData.subarray(start, end);

      messages.push(this.createChunkMessage(transferId, i, chunk));

      // 调用进度回调
      if (onProgress) {
        onProgress(i + 1, totalChunks);
      }
    }

    // 7. 生成 COMPLETE 消息
    messages.push({
      type: MSG_SEND_FILE_COMPLETE,
      data: { transferId } as SendFileCompleteData,
    });

    return messages;
  }

  /**
   * 创建加密的 META 消息。
   *
   * 📚 学习要点: 元数据加密格式
   * 元数据以 JSON 字符串形式加密：
   * - 序列化：FileMetadata → JSON.stringify → UTF-8 string
   * - 加密：encrypt(jsonString, key) → { ciphertext, iv }
   * - 传输：iv 以 base64url 编码，ciphertext 以原始二进制（Uint8Array）
   *
   * 接收方解密流程：
   * - 解密：decrypt(ciphertext, iv, key) → JSON string
   * - 反序列化：JSON.parse → FileMetadata
   *
   * @param transferId - 传输唯一标识符
   * @param metadata - 文件元数据
   * @returns META 消息
   */
  private createMetaMessage(transferId: string, metadata: FileMetadata): FileTransferMessage {
    // 将元数据序列化为 JSON 字符串并加密
    const metadataJson = JSON.stringify(metadata);
    const { ciphertext, iv } = encrypt(metadataJson, this.key);

    const sendData: SendFileMetaData = {
      transferId,
      iv: toBase64Url(iv),
      ciphertext: new Uint8Array(ciphertext),
    };

    return {
      type: MSG_SEND_FILE_META,
      data: sendData,
    };
  }

  /**
   * 创建加密的 CHUNK 消息。
   *
   * 📚 学习要点: 分片加密策略
   * 为什么每个 Chunk 使用独立的 IV（初始化向量）？
   * - AES-GCM 要求同一密钥下 IV 绝不重复（重复会泄露明文 XOR）
   * - 每个 Chunk 独立加密，允许流式处理（不需要等待整个文件）
   * - 单个 Chunk 损坏不影响其他 Chunk 的解密
   * - 接收方可以乱序接收 Chunk（通过 index 重排）
   *
   * @param transferId - 传输唯一标识符
   * @param index - 分片索引（0-based）
   * @param chunkData - 分片原始数据
   * @returns CHUNK 消息
   */
  private createChunkMessage(
    transferId: string,
    index: number,
    chunkData: Buffer
  ): FileTransferMessage {
    // 📚 学习要点: 直接加密 Buffer（ISSUE-1 修复）
    // 使用 encryptBuffer() 直接对原始二进制数据加密，
    // 与 Web 客户端的 crypto.subtle.encrypt(ArrayBuffer) 行为完全一致。
    // 不再使用 latin1 编码 hack（该方式会导致跨客户端不兼容）。
    const { ciphertext, iv } = encryptBuffer(chunkData, this.key);

    const sendData: SendFileChunkData = {
      transferId,
      index,
      iv: new Uint8Array(iv),
      data: new Uint8Array(ciphertext),
    };

    return {
      type: MSG_SEND_FILE_CHUNK,
      data: sendData,
    };
  }
}

// ============================================================================
// FileReceiver — 文件接收端
// ============================================================================

/**
 * 接收完成后的文件结果。
 */
export interface ReceivedFile {
  /** 文件名 */
  name: string;
  /** 文件 MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 文件内容 */
  data: Buffer;
  /** 发送方名称（从 META 消息获取） */
  senderName: string;
}

/**
 * FileReceiver — 文件接收引擎。
 *
 * 收集 META/CHUNK/COMPLETE 消息，解密并重组文件。
 * 支持乱序接收 chunk（通过 index 存储到正确位置）。
 *
 * 📚 学习要点: 状态机设计
 * FileReceiver 内部维护一个简单的状态机：
 * - idle → receiving（收到 META 消息后）
 * - receiving → complete（收到 COMPLETE 且所有 chunk 齐全）
 * - receiving → cancelled（收到 CANCEL 消息）
 * - 任何状态 → error（解密失败、超时等）
 *
 * 每个 transferId 对应一个独立的接收状态（支持并发接收多个文件）。
 *
 * 使用示例：
 * ```typescript
 * const receiver = new FileReceiver(aesKey, (received, total) => {
 *   console.log(`接收进度: ${received}/${total}`);
 * });
 *
 * // 在 WebSocket 消息处理中：
 * receiver.handleMeta(relayFileMetaData);
 * receiver.handleChunk(relayFileChunkData);
 * // ... 更多 chunk ...
 * const file = receiver.handleComplete(relayFileCompleteData);
 * if (file) {
 *   console.log(`文件接收完成: ${file.name} (${file.size} bytes)`);
 * }
 * ```
 *
 * @see design.md — D7: 文件传输适配
 * @see requirements.md — Requirement 5.1, 5.2, 5.3
 */
export class FileReceiver {
  /** AES-256 加密密钥 */
  private readonly key: Buffer;

  /** 进度回调 */
  private readonly onProgress?: ProgressCallback;

  /**
   * 活跃传输状态映射：transferId → 传输状态。
   *
   * 📚 学习要点: 为什么使用 Map 而非单个状态？
   * 在多用户房间中，可能同时有多个用户向 Agent 发送文件。
   * 每个传输有独立的 transferId，需要独立跟踪状态。
   * Map 提供 O(1) 的查找性能，适合高频 chunk 消息的处理。
   */
  private transfers: Map<string, TransferState> = new Map();

  /**
   * 创建 FileReceiver 实例。
   *
   * @param key - 32 字节 AES-256 密钥
   * @param onProgress - 可选的进度回调
   */
  constructor(key: Buffer, onProgress?: ProgressCallback) {
    this.key = key;
    this.onProgress = onProgress;
  }

  /**
   * 处理 META 消息：解密文件元数据，初始化接收状态。
   *
   * @param data - 中转的文件元数据消息
   * @throws 如果元数据解密失败或字段验证不通过
   */
  handleMeta(data: RelayFileMetaData): void {
    // 防止重复处理同一 transferId
    if (this.transfers.has(data.transferId)) {
      return;
    }

    // 解密元数据
    // 📚 学习要点: META 消息的 IV 使用 base64url 编码
    // 与 CHUNK 消息的二进制 IV 不同，META 只发送一次，
    // 使用 base64url 方便调试和日志记录。
    const ivBuffer = fromBase64Url(data.iv);

    // 处理 msgpack 共享缓冲区问题
    const ciphertextArr = data.ciphertext instanceof Uint8Array
      ? data.ciphertext
      : new Uint8Array(data.ciphertext as ArrayLike<number>);
    const ciphertextBuffer = Buffer.from(
      ciphertextArr.buffer,
      ciphertextArr.byteOffset,
      ciphertextArr.byteLength
    );

    // 解密得到 JSON 字符串
    const metadataJson = decrypt(ciphertextBuffer, ivBuffer, this.key);
    const metadata = JSON.parse(metadataJson) as FileMetadata;

    // 验证元数据字段
    if (
      !metadata.name ||
      typeof metadata.size !== 'number' ||
      metadata.size <= 0 ||
      metadata.size > MAX_FILE_SIZE ||
      typeof metadata.totalChunks !== 'number' ||
      metadata.totalChunks <= 0 ||
      !metadata.mimeType
    ) {
      throw new Error(
        `无效的文件元数据: name=${metadata.name}, size=${metadata.size}, ` +
        `totalChunks=${metadata.totalChunks}, mimeType=${metadata.mimeType}`
      );
    }

    // 初始化接收状态
    const state: TransferState = {
      metadata,
      chunks: new Array<Buffer | null>(metadata.totalChunks).fill(null),
      receivedCount: 0,
      cancelled: false,
      timeoutTimer: null,
      senderName: data.senderName ?? '',
    };

    this.transfers.set(data.transferId, state);

    // ISSUE-2 修复：设置 5 分钟超时自动清理（防止内存泄漏）
    state.timeoutTimer = setTimeout(() => {
      this.transfers.delete(data.transferId);
    }, 5 * 60 * 1000);
  }

  /**
   * 处理 CHUNK 消息：解密分片数据并存入缓冲区。
   *
   * 📚 学习要点: 乱序处理
   * chunk 可能因网络延迟而乱序到达。
   * 通过 index 字段将每个 chunk 存入正确的位置，
   * 最终在 handleComplete 时按顺序重组。
   *
   * @param data - 中转的文件分片消息
   */
  handleChunk(data: RelayFileChunkData): void {
    const state = this.transfers.get(data.transferId);
    if (!state || state.cancelled) {
      return; // 未知传输或已取消，静默丢弃
    }

    // 验证 index 边界
    if (data.index < 0 || data.index >= state.metadata.totalChunks) {
      return; // 越界 chunk，静默丢弃
    }

    // 检查重复（幂等性）
    if (state.chunks[data.index] !== null) {
      return; // 已收到此 chunk，跳过
    }

    // 解密 chunk 数据
    // 📚 学习要点: 使用 decryptBuffer 直接解密为 Buffer（ISSUE-1 修复）
    // 与 Web 客户端的 crypto.subtle.decrypt() 返回 ArrayBuffer 行为一致。
    const ivArr = data.iv instanceof Uint8Array
      ? data.iv
      : new Uint8Array(data.iv as ArrayLike<number>);
    const ivBuffer = Buffer.from(ivArr.buffer, ivArr.byteOffset, ivArr.byteLength);

    const dataArr = data.data instanceof Uint8Array
      ? data.data
      : new Uint8Array(data.data as ArrayLike<number>);
    const ciphertextBuffer = Buffer.from(dataArr.buffer, dataArr.byteOffset, dataArr.byteLength);

    // 直接解密为 Buffer（不经过字符串编码）
    const decryptedChunk = decryptBuffer(ciphertextBuffer, ivBuffer, this.key);

    // 存入缓冲区
    state.chunks[data.index] = decryptedChunk;
    state.receivedCount++;

    // 调用进度回调
    if (this.onProgress) {
      this.onProgress(state.receivedCount, state.metadata.totalChunks);
    }
  }

  /**
   * 处理 COMPLETE 消息：验证完整性并重组文件。
   *
   * 📚 学习要点: 完整性验证
   * COMPLETE 消息是发送方的声明："所有 chunk 已发送完毕"。
   * 接收方在此时验证是否收齐了所有 chunk：
   * - 如果收齐：重组文件并返回
   * - 如果未收齐：返回 null（表示传输不完整）
   *
   * @param data - 中转的完成信号
   * @returns 重组后的文件，或 null（如果 chunk 不完整）
   */
  handleComplete(data: RelayFileCompleteData): ReceivedFile | null {
    const state = this.transfers.get(data.transferId);
    if (!state || state.cancelled) {
      return null;
    }

    // 验证所有 chunk 已收齐
    if (state.receivedCount !== state.metadata.totalChunks) {
      // chunk 不完整，清理状态和定时器
      if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
      this.transfers.delete(data.transferId);
      return null;
    }

    // 重组文件：按顺序拼接所有 chunk
    const chunks = state.chunks.filter((c): c is Buffer => c !== null);
    const fileData = Buffer.concat(chunks);

    // 清理传输状态（释放内存）
    if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
    this.transfers.delete(data.transferId);

    return {
      name: state.metadata.name,
      mimeType: state.metadata.mimeType,
      size: state.metadata.size,
      data: fileData,
      senderName: state.senderName,
    };
  }

  /**
   * 处理 CANCEL 消息：清理传输状态，释放缓冲区。
   *
   * 📚 学习要点: 取消的语义
   * CANCEL 消息由发送方主动发出，表示传输被中止。
   * 接收方收到后应立即释放已缓冲的 chunk 数据，
   * 避免无效数据长期占用内存。
   *
   * @param data - 中转的取消信号
   */
  handleCancel(data: RelayFileCancelData): void {
    const state = this.transfers.get(data.transferId);
    if (!state) {
      return;
    }

    // 标记为已取消并清理
    state.cancelled = true;
    state.chunks = []; // 释放缓冲区内存
    if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
    this.transfers.delete(data.transferId);
  }

  /**
   * 检查是否有指定 transferId 的活跃传输。
   *
   * @param transferId - 传输 ID
   * @returns 是否存在活跃传输
   */
  hasTransfer(transferId: string): boolean {
    return this.transfers.has(transferId);
  }

  /**
   * 获取指定传输的当前进度。
   *
   * @param transferId - 传输 ID
   * @returns [已接收 chunk 数, 总 chunk 数]，或 null（传输不存在）
   */
  getProgress(transferId: string): [number, number] | null {
    const state = this.transfers.get(transferId);
    if (!state) {
      return null;
    }
    return [state.receivedCount, state.metadata.totalChunks];
  }

  /**
   * 清理所有活跃传输（用于断开连接时释放资源）。
   */
  cleanup(): void {
    // 清理所有超时定时器
    for (const state of this.transfers.values()) {
      if (state.timeoutTimer) clearTimeout(state.timeoutTimer);
    }
    this.transfers.clear();
  }
}

// ============================================================================
// 内部类型
// ============================================================================

/**
 * 单个文件传输的接收状态。
 */
interface TransferState {
  /** 解密后的文件元数据 */
  metadata: FileMetadata;
  /** chunk 缓冲区（按 index 存储，null 表示尚未收到） */
  chunks: (Buffer | null)[];
  /** 已接收的 chunk 数量 */
  receivedCount: number;
  /** 是否已被取消 */
  cancelled: boolean;
  /** 超时定时器（ISSUE-2 修复：5 分钟后自动清理） */
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  /** 发送方名称（从 META 消息缓存，供 COMPLETE 时构造 IncomingMessage 使用） */
  senderName: string;
}
