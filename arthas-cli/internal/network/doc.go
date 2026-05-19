// Package network manages the WebSocket connection to the Arthas server,
// providing thread-safe read/write operations through a channel-based architecture.
//
// 使用 gorilla/websocket 库（与服务器端一致），通过 sendCh + writePump
// 模式确保写操作的线程安全性。
//
// 📚 学习要点: 网络层的封装目标
// network 包将 WebSocket 的底层细节（帧类型、超时、并发控制）
// 封装为简单的 Send/ReadMessage 接口。上层的 chat 包只需关心
// "发送字节"和"接收字节"，不需要了解 WebSocket 协议细节。
package network
