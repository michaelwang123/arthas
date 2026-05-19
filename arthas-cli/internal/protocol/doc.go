// Package protocol defines the MessagePack binary protocol types and codec
// for communication between arthas-cli and the Arthas server.
//
// 所有消息使用统一的 {type: uint8, data: object} 信封格式，
// 与 Web 客户端和服务器端完全兼容。
//
// 📚 学习要点: 协议层的职责边界
// protocol 包只负责消息的序列化/反序列化和类型定义。
// 它不包含任何网络 I/O 或业务逻辑，确保可以独立测试。
// 这种分层设计使得协议兼容性测试可以不依赖网络连接。
package protocol
