// signing.go — Ed25519 数字签名：密钥生成、签名、验证
//
// 本文件实现 Arthas 消息签名系统的核心密码学操作。
// 在端到端加密架构中，消息签名提供**来源认证**（Authentication）：
// 接收方可以验证消息确实来自声称的发送者，而非服务器伪造。
//
// 架构角色：
// - 每个客户端在加入房间时生成一个临时 Ed25519 密钥对（不持久化）
// - 私钥用于对发送的消息签名（覆盖完整 payload，防止任何字段被篡改）
// - 公钥通过加密广播分享给房间成员（TOFU 信任模型）
// - 接收方使用发送者的公钥验证签名
//
// 与其他模块的关系：
// - canonical.go: 提供 Signable_Bytes 计算（签名的输入）
// - encrypt.go: 签名后的 payload 再经过 AES-256-GCM 加密传输
// - session.go: 集成签名/验证到消息收发流程
//
// 安全属性：
// - Ed25519 签名长度固定 64 字节，公钥 32 字节，私钥 64 字节（seed + public key）
// - 签名不可伪造：没有私钥无法生成有效签名（基于椭圆曲线离散对数困难性）
// - 签名不可篡改：修改消息任意字段后签名验证失败
//
// 📚 学习要点: 为什么选择 Ed25519 而非 ECDSA？
//  1. 确定性签名：Ed25519 对相同输入始终产生相同签名（ECDSA 需要随机 k 值，
//     如果 k 值生成有缺陷会泄露私钥——PlayStation 3 破解事件的根因）
//  2. 性能优越：Ed25519 签名和验证速度比 ECDSA-P256 快约 2-3 倍
//  3. 抗侧信道：算法设计避免了分支和查表操作，天然抗时序攻击
//  4. 跨平台支持：Go 标准库和 Web Crypto API 都原生支持 Ed25519
//  5. 密钥短小：32 字节公钥 + 32 字节 seed，适合在加密消息中传输
package crypto

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

// SigningKeyPair 持有 Ed25519 签名密钥对（内存中，不持久化）。
//
// 生命周期：
// - 创建：用户加入/创建房间时调用 GenerateSigningKeyPair()
// - 使用：每条发送消息调用 Sign() 生成签名
// - 销毁：用户离开房间时调用 ZeroKeyPair() 清零内存
//
// 字段说明：
//   - PrivateKey: 64 字节 Ed25519 私钥（前 32 字节为 seed，后 32 字节为公钥副本）
//   - PublicKey:  32 字节 Ed25519 公钥（用于广播给其他成员）
type SigningKeyPair struct {
	PrivateKey ed25519.PrivateKey // 64 字节（seed + public key）
	PublicKey  ed25519.PublicKey  // 32 字节
}

// GenerateSigningKeyPair 生成 Ed25519 签名密钥对。
//
// 使用 crypto/rand.Reader 作为随机源（CSPRNG），生成 32 字节 seed，
// 然后派生出完整的 64 字节私钥和 32 字节公钥。
//
// 每次加入/创建房间时调用一次，密钥对仅存在于进程内存中，
// 不写入磁盘、不持久化到任何存储。
//
// 返回值：
//   - *SigningKeyPair: 生成的密钥对
//   - error: 如果系统随机源不可用（极罕见情况）
func GenerateSigningKeyPair() (*SigningKeyPair, error) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate Ed25519 signing keypair: %w", err)
	}
	return &SigningKeyPair{
		PrivateKey: privateKey,
		PublicKey:  publicKey,
	}, nil
}

// Sign 使用私钥对 signableBytes 进行 Ed25519 签名。
//
// signableBytes 是通过 ComputeSignableBytes() 计算得到的 canonical JSON UTF-8 字节。
// 签名覆盖完整 payload（去除 sig 字段），确保任何字段被篡改都能被检测。
//
// 返回 base64url 编码（无 padding）的 64 字节签名字符串，
// 与 Web 客户端使用相同的编码格式，确保跨客户端互操作。
//
// 📚 学习要点: Ed25519 签名的确定性
// 与 ECDSA 不同，Ed25519 签名是确定性的——对相同的 (privateKey, message) 输入
// 始终产生相同的签名输出。这意味着：
// - 不需要额外的随机数生成（消除了随机数质量风险）
// - 相同消息的签名可以被缓存和比较
// - 测试可以使用固定输入验证固定输出（见 Appendix A Test Vector）
//
// 参数：
//   - signableBytes: canonical JSON 的 UTF-8 编码字节（由 ComputeSignableBytes 生成）
//
// 返回值：
//   - string: base64url 编码的 64 字节 Ed25519 签名
func (kp *SigningKeyPair) Sign(signableBytes []byte) string {
	signature := ed25519.Sign(kp.PrivateKey, signableBytes)
	return base64.RawURLEncoding.EncodeToString(signature)
}

// VerifySignature 使用公钥验证 Ed25519 签名。
//
// 验证流程：
// 1. 将 base64url 编码的签名解码为 64 字节原始签名
// 2. 使用 ed25519.Verify 验证签名是否与 (publicKey, signableBytes) 匹配
//
// 如果签名解码失败（非法 base64url 或长度不是 64 字节），返回 false。
// 这是安全的默认行为——任何格式错误都视为验证失败。
//
// 参数：
//   - publicKey: 发送者的 32 字节 Ed25519 公钥（从 publicKeyMap 获取）
//   - signableBytes: 接收方重新计算的 canonical JSON UTF-8 字节
//   - sigBase64url: 消息中携带的 base64url 编码签名字符串
//
// 返回值：
//   - bool: true 表示签名有效（消息未被篡改），false 表示验证失败
func VerifySignature(publicKey ed25519.PublicKey, signableBytes []byte, sigBase64url string) bool {
	// 解码 base64url 签名
	signature, err := base64.RawURLEncoding.DecodeString(sigBase64url)
	if err != nil {
		return false
	}

	// Ed25519 签名固定为 64 字节，长度不匹配则验证失败
	if len(signature) != ed25519.SignatureSize {
		return false
	}

	return ed25519.Verify(publicKey, signableBytes, signature)
}

// ZeroKeyPair 安全清零密钥对内存（best-effort）。
//
// 在用户离开房间或会话结束时调用，将私钥和公钥的内存内容覆写为零字节。
// 这减少了密钥在内存中的暴露时间窗口，降低内存转储攻击的风险。
//
// 📚 学习要点: 为什么内存清零在 Go 中是 best-effort（尽力而为）？
// Go 的垃圾回收器（GC）可能在清零之前已经将密钥数据复制到新的内存位置
// （例如在 GC 压缩堆内存时）。旧位置的数据副本不受我们控制，
// 可能在物理内存中残留直到被其他数据覆盖。
//
// 此外，Go 的逃逸分析可能将小对象分配在栈上，栈帧在函数返回后
// 不会被主动清零（只是标记为可复用）。
//
// 尽管如此，显式清零仍然有价值：
// 1. 减少密钥在堆内存中的存活时间（缩小攻击窗口）
// 2. 防止通过 /proc/[pid]/mem 等接口直接读取进程内存时获取密钥
// 3. 遵循密码学最佳实践（defense in depth）
// 4. 进程正常退出时，OS 会回收所有内存页（最终清理）
//
// 对比其他语言：
// - C/C++: 可以使用 explicit_bzero() 或 SecureZeroMemory()，编译器不会优化掉
// - Rust: 使用 zeroize crate，利用 volatile 写入防止优化
// - Go: 没有等效的"不可优化清零"原语，只能 best-effort
func (kp *SigningKeyPair) ZeroKeyPair() {
	// 清零私钥（64 字节）
	for i := range kp.PrivateKey {
		kp.PrivateKey[i] = 0
	}
	// 清零公钥（32 字节）
	for i := range kp.PublicKey {
		kp.PublicKey[i] = 0
	}
}
