// Package chat coordinates the complete chat session lifecycle,
// orchestrating the protocol, crypto, network, and UI layers.
//
// chat 包是 arthas-cli 的核心协调层，管理会话状态机、
// 消息收发循环、成员事件处理和优雅退出。
//
// 📚 学习要点: 协调层的设计模式
// chat.Session 采用 CSP（Communicating Sequential Processes）模型：
// 多个 goroutine 通过 channel 通信，main goroutine 使用 select
// 多路复用所有事件源（stdin、WebSocket、系统信号）。
// 这避免了共享状态的锁竞争，使并发逻辑更容易推理。
package chat
