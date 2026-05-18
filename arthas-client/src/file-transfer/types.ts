/**
 * 文件传输核心类型定义与 ID 生成器。
 *
 * 本文件定义了文件传输模块的所有核心数据类型，包括：
 * - FileMetadata: 文件元数据（加密前的明文结构）
 * - TransferDirection: 传输方向（发送/接收）
 * - TransferStatus: 传输状态机的所有合法状态
 * - TransferState: 单次传输的完整运行时状态
 * - FileTransferState: 全局文件传输 Store 状态
 * - generateTransferId(): 生成唯一传输标识符
 *
 * 📚 学习要点: 类型驱动设计（Type-Driven Design）
 * 在 TypeScript 中，先定义精确的类型再编写实现代码，可以：
 * 1. 让编译器在编译时捕获非法状态转换（如从 'complete' 回到 'sending'）
 * 2. 为团队成员提供清晰的数据契约文档
 * 3. 使 IDE 自动补全更精确，减少运行时错误
 * 这种方法被称为"让非法状态不可表示"（Make Illegal States Unrepresentable）。
 *
 * @module file-transfer/types
 * @see design.md — 数据模型和状态机设计
 * @see requirements.md — Requirements 2.1, 2.2, 5.3, 1.5
 */

// ============================================================================
// 常量定义
// ============================================================================

/**
 * 文件分片大小：64KB (65536 bytes)。
 *
 * 📚 学习要点: 为什么选择 64KB？
 * - 太小（如 4KB）：分片数量过多，每片 28 bytes 加密开销占比高，协议消息频繁
 * - 太大（如 1MB）：单片加密耗时长可能阻塞主线程，WebSocket 单消息过大
 * - 64KB 是平衡点：5MB 文件 = 80 片，每片加密 <1ms，单消息 ~65KB 在 100KB 限制内
 * - 与操作系统页面大小（4KB）对齐的倍数，有利于内存分配效率
 */
export const CHUNK_SIZE = 65536;

/**
 * 单文件大小上限：5MB (5,242,880 bytes)。
 *
 * 📚 学习要点: 为什么限制 5MB？
 * - 带宽放大效应：N 个房间成员时，服务器出口流量 = 文件大小 × (N-1)
 * - MaxMembers=50 时：5MB × 49 ≈ 245MB/次传输
 * - 更大的文件应使用专用文件分享服务（如 S3 presigned URL）
 * - 5MB 覆盖了大多数截图、文档和小型图片的使用场景
 */
export const MAX_FILE_SIZE = 5_242_880;

/**
 * Transfer ID 长度：21 字符。
 *
 * 📚 学习要点: NanoID 熵分析
 * 使用 64 字符的 alphabet (A-Za-z0-9_-)，每个字符携带 log2(64) = 6 bits 信息。
 * 21 字符 × 6 bits = 126 bits 总熵。
 *
 * 碰撞概率（Birthday Problem 近似）：
 * - 假设每秒 1000 个传输（极端场景）
 * - 运行 1 年 ≈ 3.15 × 10^10 个 ID
 * - 碰撞概率 ≈ n² / (2 × 2^126) ≈ 5.8 × 10^-18
 * 这比硬件错误率（~10^-15）还低 3 个数量级，可以安全忽略。
 */
export const TRANSFER_ID_LENGTH = 21;

/**
 * NanoID 字母表：64 个 URL 安全字符。
 *
 * 📚 学习要点: 为什么选择这个 alphabet？
 * - A-Z (26) + a-z (26) + 0-9 (10) + _ + - = 64 字符
 * - 64 = 2^6，每个字符恰好携带 6 bits 信息（无浪费）
 * - 所有字符都是 URL 安全的（不需要 percent-encoding）
 * - 与标准 NanoID 默认 alphabet 一致
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 文件传输元数据（加密前的明文结构）。
 *
 * 此结构在发送方生成，使用 Room_Key 加密后通过 MSG_SEND_FILE_META 发送。
 * 接收方解密后用于准备接收缓冲区和显示文件信息。
 */
export interface FileMetadata {
  /** 唯一传输标识符，NanoID 21 chars，用于关联所有分片消息 */
  transferId: string;
  /** 原始文件名（清理前），接收方需通过 sanitizeFileName() 处理后再使用 */
  fileName: string;
  /** 文件大小（字节），用于计算分片总数和验证接收完整性 */
  fileSize: number;
  /** MIME 类型（如 'image/png'），用于文件图标显示和缩略图判断 */
  mimeType: string;
  /** 分片总数 = Math.ceil(fileSize / CHUNK_SIZE)，接收方据此分配缓冲区 */
  totalChunks: number;
  /** 可选：加密前的缩略图数据 (≤50KB, JPEG)，仅图片文件包含 */
  thumbnail?: Uint8Array;
  /** 可选：每个 chunk 明文的 SHA-256 hash (hex)，用于未来 resume 校验 */
  chunkHashes?: string[];
}

/**
 * 传输方向：标识当前用户在此传输中的角色。
 *
 * 📚 学习要点: Discriminated Union 的应用
 * 使用字面量类型（'send' | 'receive'）而非 boolean（isSender），
 * 因为字面量类型在 switch/if 中提供更好的类型收窄（narrowing），
 * 且代码可读性更高：`direction === 'send'` 比 `isSender === true` 更清晰。
 */
export type TransferDirection = 'send' | 'receive';

/**
 * 传输状态：有限状态机的所有合法状态。
 *
 * 📚 学习要点: 有限状态机（FSM）与类型安全
 * 使用 union type 枚举所有合法状态，编译器会在 switch 语句中
 * 检查是否处理了所有状态（exhaustive check）。
 * 如果未来新增状态，所有未处理的 switch 都会产生编译错误，
 * 防止遗漏状态处理逻辑。
 *
 * 状态转换规则：
 * - pending → sending | receiving | cancelled | failed
 * - sending → complete | failed | cancelled
 * - receiving → complete | failed | cancelled
 * - complete / failed / cancelled → 终态（不可转换）
 */
export type TransferStatus =
  | 'pending'     // 排队等待（发送方：在队列中；接收方：收到 metadata 等待首个 chunk）
  | 'sending'     // 正在发送分片（仅发送方）
  | 'receiving'   // 正在接收分片（仅接收方）
  | 'complete'    // 传输完成（发送方：所有 chunk 已发送；接收方：文件已重组）
  | 'failed'      // 传输失败（超时、解密错误、连接断开等）
  | 'cancelled';  // 已取消（用户主动取消或收到 CANCEL 信号）

/**
 * 单次传输的完整运行时状态。
 *
 * 📚 学习要点: 为什么传输状态独立于消息数组？
 * 聊天消息数组有 MAX_MESSAGES=200 的限制，旧消息会被淘汰。
 * 但文件传输可能持续数十秒，如果传输状态存储在消息对象中，
 * 消息被淘汰时传输状态也会丢失，导致正在进行的传输无法完成。
 * 因此传输状态独立管理，通过 transferId 与消息占位符关联。
 */
export interface TransferState {
  /** 唯一传输标识符（NanoID 21 chars） */
  transferId: string;
  /** 传输方向：当前用户是发送方还是接收方 */
  direction: TransferDirection;
  /** 当前传输状态（FSM 状态） */
  status: TransferStatus;
  /** 文件名（已清理） */
  fileName: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** MIME 类型 */
  mimeType: string;
  /** 分片总数 */
  totalChunks: number;
  /** 已接收/已发送的分片数（用于计算进度百分比） */
  receivedChunks: number;
  /** 最后成功接收的 chunk 索引（用于进度恢复和调试） */
  lastReceivedIndex: number;
  /** 接收方：解密后的分片缓冲区，按索引存储；发送方不使用此字段 */
  chunks: (Uint8Array | null)[];
  /** 可选：从 metadata 获取的 chunk hash 列表（用于未来 resume 校验） */
  chunkHashes?: string[];
  /** 可选：解密后的缩略图 data URL（用于图片内联预览） */
  thumbnail?: string;
  /** 可选：传输完成后的下载 Blob URL */
  blobUrl?: string;
  /** 可选：错误信息（仅 failed 状态有值） */
  error?: string;
  /** 传输开始时间戳（Date.now()），用于计算传输速度 */
  startTime: number;
  /** 最后一个分片的时间戳，用于超时检测 */
  lastChunkTime: number;
  /** 发送方的用户 ID */
  senderId: string;
  /** 发送方的显示名称 */
  senderName: string;
  /** 发送方：已确认接收的人数（ACK 计数） */
  ackCount: number;
  /** 发送方：总接收人数（房间成员数 - 1） */
  totalReceivers: number;
  /** 对应的聊天消息占位符 ID（用于 ephemeral 清理和 UI 关联） */
  chatMessageId: string;
}

/**
 * 文件传输 Store 的全局状态。
 *
 * 📚 学习要点: 为什么使用 Map 而非普通对象？
 * - Map 的 key 可以是任意类型（虽然这里用 string），且保持插入顺序
 * - Map.size 属性直接获取大小，无需 Object.keys().length
 * - Map 的 delete 操作比 delete obj[key] 更高效（不会导致 V8 hidden class 退化）
 * - 语义更清晰：Map 表示"键值映射"，Object 表示"结构化数据"
 */
export interface FileTransferState {
  /** 所有传输状态的映射：transferId → TransferState */
  transfers: Map<string, TransferState>;
  /** 待发送队列（最多 3 个），存储 transferId，FIFO 顺序 */
  sendQueue: string[];
  /** 当前活跃发送的 transferId（同一时间只有一个活跃发送） */
  activeSendId: string | null;
  /** 当前活跃接收传输数（限制最大并发接收数，防止内存耗尽） */
  activeReceiveCount: number;
}

// ============================================================================
// ID 生成器
// ============================================================================

/**
 * 生成唯一的文件传输标识符（Transfer ID）。
 *
 * 使用 crypto.getRandomValues() 生成密码学安全的随机字节，
 * 然后映射到 64 字符的 URL 安全 alphabet，产生 21 字符的 ID。
 *
 * 📚 学习要点: 为什么不使用 nanoid 包？
 * 1. NFR-8 要求不引入新依赖
 * 2. NanoID 的核心逻辑非常简单（<20 行代码），不值得引入一个包
 * 3. 自己实现可以精确控制 alphabet 和长度，避免版本升级风险
 * 4. 使用 Web Crypto API 的 getRandomValues() 确保密码学安全性
 *
 * 📚 学习要点: 位掩码技巧（Bitmask Technique）
 * alphabet 长度为 64 = 2^6，因此每个随机字节的低 6 位（& 0x3F = & 63）
 * 恰好可以无偏差地映射到 alphabet 中的一个字符。
 * 如果 alphabet 长度不是 2 的幂，需要使用 rejection sampling 避免偏差，
 * 但 64 恰好是 2^6，所以简单的位掩码就足够了。
 *
 * 熵分析：
 * - 每个字符：6 bits（log2(64) = 6）
 * - 21 个字符：21 × 6 = 126 bits 总熵
 * - 碰撞概率（1000 ID/秒，运行 1 年）：≈ 5.8 × 10^-18
 *
 * @returns 21 字符的唯一传输标识符
 *
 * @example
 * ```typescript
 * const transferId = generateTransferId();
 * // 例如: "V1StGXR8_Z5jdHi6B-myT"
 * console.log(transferId.length); // 21
 * ```
 */
export function generateTransferId(): string {
  // 1. 生成 21 个密码学安全的随机字节
  //    crypto.getRandomValues() 使用操作系统的 CSPRNG（如 /dev/urandom）
  //    每个字节 8 bits，但我们只使用低 6 bits（因为 alphabet 大小为 64）
  const randomBytes = crypto.getRandomValues(new Uint8Array(TRANSFER_ID_LENGTH));

  // 2. 将每个随机字节映射到 alphabet 中的字符
  //    使用位掩码 0x3F (= 63 = 0b00111111) 提取低 6 位
  //    这确保了均匀分布：每个 alphabet 字符被选中的概率完全相同（1/64）
  let id = '';
  for (let i = 0; i < TRANSFER_ID_LENGTH; i++) {
    id += ALPHABET[randomBytes[i] & 0x3F];
  }

  return id;
}
