/**
 * @file signing.ts — Ed25519 数字签名模块（可选功能）
 *
 * 本文件实现 Arthas 消息签名系统的 Node.js 版本，与 arthas-cli（Go）的
 * signing.go 实现完全兼容。在端到端加密架构中，消息签名提供**来源认证**
 * （Authentication）：接收方可以验证消息确实来自声称的发送者，而非服务器伪造。
 *
 * 架构角色：
 * - AI Agent 在加入房间时生成一个临时 Ed25519 密钥对（不持久化到磁盘）
 * - 私钥用于对发送的消息签名（覆盖完整 payload，防止任何字段被篡改）
 * - 公钥通过加密广播分享给房间成员（TOFU 信任模型）
 * - 接收方使用 Agent 的公钥验证签名，确认消息来源
 *
 * 与其他模块的关系：
 * - crypto.ts: 签名后的 payload 再经过 AES-256-GCM 加密传输
 * - adapter.ts: 集成签名/验证到消息收发流程（当 signingEnabled=true 时）
 * - config.ts: 通过 signingEnabled 配置开关控制是否启用签名
 * - types.ts: ArthasChannelConfig.signingEnabled 定义配置字段
 *
 * 安全属性：
 * - Ed25519 签名长度固定 64 字节，公钥 32 字节，私钥 64 字节（seed + public key）
 * - 签名不可伪造：没有私钥无法生成有效签名（基于椭圆曲线离散对数困难性）
 * - 签名不可篡改：修改消息任意字段后签名验证失败
 * - 密钥仅存在于进程内存中，进程退出时由 OS 回收
 *
 * 📚 学习要点: 为什么选择 Ed25519 而非 ECDSA？
 *  1. 确定性签名：Ed25519 对相同输入始终产生相同签名（ECDSA 需要随机 k 值，
 *     如果 k 值生成有缺陷会泄露私钥——PlayStation 3 破解事件的根因）
 *  2. 性能优越：Ed25519 签名和验证速度比 ECDSA-P256 快约 2-3 倍
 *  3. 抗侧信道：算法设计避免了分支和查表操作，天然抗时序攻击
 *  4. 跨平台支持：Go 标准库、Node.js crypto 和 Web Crypto API 都原生支持
 *  5. 密钥短小：32 字节公钥 + 32 字节 seed，适合在加密消息中传输
 *
 * 📚 学习要点: 为什么签名模块独立于 crypto.ts？
 * 遵循单一职责原则（SRP）：
 * - crypto.ts 负责 AES-256-GCM 对称加密（消息保密性）
 * - signing.ts 负责 Ed25519 非对称签名（消息来源认证）
 * 两者解决不同的安全问题，使用不同的密码学原语，独立演进。
 *
 * @module openclaw-channel/signing
 * @see requirements.md — Requirement 2.5, 2.6
 * @see arthas-cli/internal/crypto/signing.go — Go 参考实现
 */

import {
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';

// ============================================================================
// 常量定义
// ============================================================================

/**
 * Ed25519 公钥长度（字节）。
 * Ed25519 使用 Curve25519 椭圆曲线，公钥固定为 32 字节（256 位）。
 */
const PUBLIC_KEY_SIZE = 32;

/**
 * Ed25519 签名长度（字节）。
 * Ed25519 签名固定为 64 字节（512 位），由 (R, S) 两个 32 字节值组成。
 */
const SIGNATURE_SIZE = 64;

/**
 * 公钥广播消息的类型标识。
 * 当 Agent 加入房间时，通过加密消息广播自己的公钥。
 * 其他客户端收到此消息后，将公钥存入 publicKeyMap 用于后续签名验证。
 *
 * 📚 学习要点: TOFU（Trust On First Use）信任模型
 * Arthas 使用 TOFU 模型管理公钥信任：
 * - 首次收到某用户的公钥时，无条件信任并存储
 * - 后续消息使用该公钥验证签名
 * - 如果公钥发生变化（可能是中间人攻击），客户端应发出警告
 * 这与 SSH 的 known_hosts 机制类似，在便利性和安全性之间取得平衡。
 */
const PUBLIC_KEY_MESSAGE_PREFIX = '[PUBLIC_KEY]';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Ed25519 签名密钥对。
 *
 * 生命周期：
 * - 创建：Agent 加入房间时调用 generateSigningKeyPair()
 * - 使用：每条发送消息调用 signMessage() 生成签名
 * - 销毁：Agent 离开房间时调用 zeroKeyPair() 清零内存
 *
 * 📚 学习要点: Node.js crypto 的 Ed25519 密钥格式
 * Node.js 的 generateKeyPairSync('ed25519') 返回 KeyObject 类型，
 * 但为了与 Go 客户端和 Web 客户端互操作，我们导出原始字节（raw format）：
 * - publicKey: 32 字节原始公钥（DER 中的 SubjectPublicKey 部分）
 * - privateKey: 32 字节 seed（Node.js 内部会从 seed 派生完整的 64 字节私钥）
 *
 * 注意：Node.js 的 'pkcs8' 格式私钥包含 ASN.1 头部（48 字节），
 * 而 'raw' 格式只有 32 字节 seed。我们使用 raw 格式以保持跨平台兼容。
 */
export interface SigningKeyPair {
  /** 32 字节 Ed25519 公钥（用于广播给房间成员） */
  publicKey: Buffer;
  /** 32 字节 Ed25519 私钥 seed（用于签名，不可泄露） */
  privateKey: Buffer;
}

// ============================================================================
// 密钥生成
// ============================================================================

/**
 * 生成 Ed25519 签名密钥对。
 *
 * 使用 Node.js crypto 模块的 generateKeyPairSync('ed25519') 生成密钥对，
 * 底层使用操作系统的 CSPRNG（密码学安全伪随机数生成器）作为随机源。
 *
 * 每次 Agent 加入房间时调用一次，密钥对仅存在于进程内存中，
 * 不写入磁盘、不持久化到任何存储。
 *
 * 📚 学习要点: Node.js Ed25519 密钥导出格式
 * Node.js crypto 支持多种密钥导出格式：
 * - 'pkcs8' (DER): 包含 ASN.1 头部的完整 PKCS#8 结构（48 字节私钥）
 * - 'raw': 仅原始密钥字节（32 字节公钥 / 32 字节私钥 seed）
 * 我们使用 'raw' 格式，因为：
 * 1. 与 Go 的 ed25519.GenerateKey() 输出格式兼容
 * 2. 更紧凑，适合在加密消息中传输公钥
 * 3. 无需解析 ASN.1 结构
 *
 * @returns Ed25519 密钥对（publicKey: 32 字节, privateKey: 32 字节 seed）
 *
 * @example
 * ```typescript
 * const keyPair = generateSigningKeyPair();
 * console.log(keyPair.publicKey.length);  // 32
 * console.log(keyPair.privateKey.length); // 32
 * ```
 */
export function generateSigningKeyPair(): SigningKeyPair {
  // 📚 学习要点: generateKeyPairSync vs generateKeyPair
  // 使用同步版本因为密钥生成只在加入房间时执行一次，
  // 且 Ed25519 密钥生成非常快（< 1ms），不会阻塞事件循环。
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'der',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der',
    },
  });

  // 从 DER 编码中提取原始密钥字节
  // SPKI DER for Ed25519: 前 12 字节是 ASN.1 头部，后 32 字节是公钥
  // PKCS8 DER for Ed25519: 前 16 字节是 ASN.1 头部，后 32 字节是私钥 seed
  const rawPublicKey = Buffer.from(publicKey.subarray(12));
  const rawPrivateKey = Buffer.from(privateKey.subarray(16));

  return {
    publicKey: rawPublicKey,
    privateKey: rawPrivateKey,
  };
}

// ============================================================================
// 消息签名
// ============================================================================

/**
 * 使用 Ed25519 私钥对消息进行签名。
 *
 * 签名流程：
 * 1. 将消息字符串编码为 UTF-8 字节
 * 2. 使用 Ed25519 私钥对字节进行签名
 * 3. 返回 64 字节原始签名 Buffer
 *
 * 📚 学习要点: Ed25519 签名的确定性
 * 与 ECDSA 不同，Ed25519 签名是确定性的——对相同的 (privateKey, message) 输入
 * 始终产生相同的签名输出。这意味着：
 * - 不需要额外的随机数生成（消除了随机数质量风险）
 * - 相同消息的签名可以被缓存和比较
 * - 测试可以使用固定输入验证固定输出
 *
 * 📚 学习要点: Node.js crypto.sign() 的 Ed25519 特殊处理
 * 对于 Ed25519，sign() 函数的 algorithm 参数必须为 null（不是 'sha256'），
 * 因为 Ed25519 内部已经使用 SHA-512 进行哈希，不需要外部指定摘要算法。
 * 传入任何 algorithm 值都会导致错误。
 *
 * @param message - 待签名的消息字符串（UTF-8 编码）
 * @param privateKey - 32 字节 Ed25519 私钥 seed
 * @returns 64 字节 Ed25519 签名 Buffer
 *
 * @example
 * ```typescript
 * const keyPair = generateSigningKeyPair();
 * const signature = signMessage('Hello, World!', keyPair.privateKey);
 * console.log(signature.length); // 64
 * ```
 */
export function signMessage(message: string, privateKey: Buffer): Buffer {
  // 📚 学习要点: 从 raw seed 重建 Node.js KeyObject
  // Node.js 的 sign() 函数需要 KeyObject 或 DER/PEM 格式的密钥。
  // 我们存储的是 32 字节 raw seed，需要重建 PKCS8 DER 格式。
  // Ed25519 PKCS8 DER 结构：
  //   30 2e (SEQUENCE, 46 bytes)
  //     02 01 00 (INTEGER, version 0)
  //     30 05 (SEQUENCE, 5 bytes)
  //       06 03 2b6570 (OID 1.3.101.112 = Ed25519)
  //     04 22 (OCTET STRING, 34 bytes)
  //       04 20 (OCTET STRING, 32 bytes)
  //         <32 bytes private key seed>
  const pkcs8Header = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const pkcs8Der = Buffer.concat([pkcs8Header, privateKey]);

  // 对消息的 UTF-8 字节进行签名
  // Ed25519 的 algorithm 参数必须为 null
  const messageBytes = Buffer.from(message, 'utf8');
  const signature = sign(null, messageBytes, {
    key: pkcs8Der,
    format: 'der',
    type: 'pkcs8',
  });

  return Buffer.from(signature);
}

// ============================================================================
// 签名验证
// ============================================================================

/**
 * 使用 Ed25519 公钥验证消息签名。
 *
 * 验证流程：
 * 1. 将消息字符串编码为 UTF-8 字节
 * 2. 使用发送者的公钥验证签名是否与消息匹配
 * 3. 返回验证结果（true = 签名有效，false = 签名无效或被篡改）
 *
 * 📚 学习要点: 签名验证的安全默认值
 * 任何异常情况（签名长度错误、公钥格式错误等）都返回 false。
 * 这是安全的默认行为——宁可拒绝合法消息，也不接受伪造消息。
 * 调用方应在验证失败时记录警告日志，但不应崩溃。
 *
 * @param message - 原始消息字符串（UTF-8 编码）
 * @param signature - 64 字节 Ed25519 签名 Buffer
 * @param publicKey - 32 字节 Ed25519 公钥 Buffer
 * @returns true 表示签名有效（消息未被篡改），false 表示验证失败
 *
 * @example
 * ```typescript
 * const isValid = verifySignature('Hello', signature, senderPublicKey);
 * if (!isValid) {
 *   console.warn('签名验证失败，消息可能被篡改');
 * }
 * ```
 */
export function verifySignature(
  message: string,
  signature: Buffer,
  publicKey: Buffer,
): boolean {
  // 安全检查：签名长度必须为 64 字节
  if (signature.length !== SIGNATURE_SIZE) {
    return false;
  }

  // 安全检查：公钥长度必须为 32 字节
  if (publicKey.length !== PUBLIC_KEY_SIZE) {
    return false;
  }

  try {
    // 📚 学习要点: 从 raw 公钥重建 Node.js 可用的 DER 格式
    // Ed25519 SPKI DER 结构：
    //   30 2a (SEQUENCE, 42 bytes)
    //     30 05 (SEQUENCE, 5 bytes)
    //       06 03 2b6570 (OID 1.3.101.112 = Ed25519)
    //     03 21 00 (BIT STRING, 33 bytes, 0 unused bits)
    //       <32 bytes public key>
    const spkiHeader = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
      0x70, 0x03, 0x21, 0x00,
    ]);
    const spkiDer = Buffer.concat([spkiHeader, publicKey]);

    const messageBytes = Buffer.from(message, 'utf8');
    return verify(null, messageBytes, {
      key: spkiDer,
      format: 'der',
      type: 'spki',
    }, signature);
  } catch {
    // 任何异常都视为验证失败（安全默认值）
    return false;
  }
}

// ============================================================================
// 公钥广播
// ============================================================================

/**
 * 格式化公钥广播消息。
 *
 * 当 Agent 加入房间且 signingEnabled=true 时，需要将自己的公钥广播给房间成员。
 * 公钥通过加密消息发送（与普通聊天消息相同的加密流程），
 * 格式为 `[PUBLIC_KEY]{base64url 编码的 32 字节公钥}`。
 *
 * 接收方客户端识别此前缀后，提取公钥并存入 publicKeyMap，
 * 用于后续验证该 Agent 发送的消息签名。
 *
 * 📚 学习要点: 为什么公钥广播也要加密？
 * 虽然公钥本身不是秘密（可以公开），但加密广播有以下好处：
 * 1. 服务器无法知道谁在使用签名功能（隐私保护）
 * 2. 防止服务器替换公钥（中间人攻击）——因为服务器无法解密消息
 * 3. 与普通消息使用相同的传输路径，简化实现
 * 4. 只有持有房间密钥的成员才能获取公钥（访问控制）
 *
 * @param publicKey - 32 字节 Ed25519 公钥 Buffer
 * @returns 格式化的公钥广播消息字符串
 *
 * @example
 * ```typescript
 * const keyPair = generateSigningKeyPair();
 * const broadcastMsg = formatPublicKeyMessage(keyPair.publicKey);
 * // '[PUBLIC_KEY]AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
 * // 然后通过 encrypt() 加密后发送到房间
 * ```
 */
export function formatPublicKeyMessage(publicKey: Buffer): string {
  const publicKeyBase64Url = publicKey.toString('base64url');
  return `${PUBLIC_KEY_MESSAGE_PREFIX}${publicKeyBase64Url}`;
}

/**
 * 解析公钥广播消息，提取公钥。
 *
 * 当收到其他成员的消息时，检查是否为公钥广播消息。
 * 如果是，提取并返回 32 字节公钥 Buffer；否则返回 null。
 *
 * @param message - 解密后的消息文本
 * @returns 32 字节公钥 Buffer，或 null（如果不是公钥广播消息）
 *
 * @example
 * ```typescript
 * const publicKey = parsePublicKeyMessage(decryptedText);
 * if (publicKey) {
 *   publicKeyMap.set(senderId, publicKey);
 * }
 * ```
 */
export function parsePublicKeyMessage(message: string): Buffer | null {
  if (!message.startsWith(PUBLIC_KEY_MESSAGE_PREFIX)) {
    return null;
  }

  const base64UrlKey = message.slice(PUBLIC_KEY_MESSAGE_PREFIX.length);

  try {
    const publicKey = Buffer.from(base64UrlKey, 'base64url');

    // 验证公钥长度
    if (publicKey.length !== PUBLIC_KEY_SIZE) {
      return null;
    }

    return publicKey;
  } catch {
    return null;
  }
}

// ============================================================================
// 内存清零
// ============================================================================

/**
 * 安全清零密钥对内存（best-effort）。
 *
 * 在 Agent 离开房间或进程关闭时调用，将私钥和公钥的内存内容覆写为零字节。
 * 这减少了密钥在内存中的暴露时间窗口，降低内存转储攻击的风险。
 *
 * 📚 学习要点: 为什么内存清零在 JavaScript/Node.js 中是 best-effort？
 * 与 Go 类似，JavaScript 的垃圾回收器可能在清零之前已经复制了数据：
 * 1. V8 的 GC 可能在堆压缩时移动 Buffer 对象（旧位置残留数据）
 * 2. Buffer.fill(0) 可能被 JIT 编译器优化掉（如果后续没有读取）
 * 3. 字符串是不可变的，无法清零（但我们使用 Buffer 存储密钥，避免此问题）
 *
 * 尽管如此，显式清零仍然有价值：
 * - 减少密钥在堆内存中的存活时间（缩小攻击窗口）
 * - 防止通过 /proc/[pid]/mem 等接口直接读取进程内存
 * - 遵循密码学最佳实践（defense in depth）
 *
 * @param keyPair - 要清零的密钥对
 */
export function zeroKeyPair(keyPair: SigningKeyPair): void {
  keyPair.privateKey.fill(0);
  keyPair.publicKey.fill(0);
}
