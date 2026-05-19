// Package crypto implements AES-256-GCM encryption/decryption and key management
// for the Arthas end-to-end encrypted chat protocol.
//
// 所有加密操作使用 Go 标准库 crypto/aes + crypto/cipher，
// 无需第三方加密依赖。密钥和 IV 生成使用 crypto/rand（CSPRNG）。
//
// 📚 学习要点: 为什么选择 Go 标准库而非第三方加密库？
// Go 的 crypto 标准库经过严格审计，AES-GCM 实现使用硬件加速（AES-NI），
// 性能和安全性都有保障。引入第三方加密库会增加供应链攻击面，
// 且对于 AES-256-GCM 这种标准算法，标准库已经足够。
package crypto
