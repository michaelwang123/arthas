# 任务：端到端加密实时聊天室

## Task 1: 重构后端 — 清理游戏代码，搭建房间系统骨架
- [x] 删除 `internal/game/` 目录下所有文件（game.go, player.go, projectile.go, coreshard.go, combat.go, constants.go）
- [x] 创建 `internal/room/manager.go` — RoomManager 结构体，管理房间创建/查找/销毁
- [x] 创建 `internal/room/room.go` — Room 结构体，管理成员列表 + 消息转发
- [x] 重写 `internal/network/protocol.go` — 新的消息类型定义（CreateRoom, JoinRoom, SendMessage, LeaveRoom, Typing, Pong, RoomCreated, RoomJoined, MemberJoined, MemberLeft, RelayMessage, MemberTyping, RoomClosed, Error, Ping）
- [x] 重写 `internal/network/hub.go` — 移除游戏逻辑，集成 RoomManager，实现消息路由
- [x] 更新 `internal/network/client.go` — 添加 RoomID 字段，添加 Name/Color 字段
- [x] 更新 `cmd/server/main.go` — 移除 game 依赖，使用新的 Hub + RoomManager
- [x] 验证：`go build ./...` 编译通过

## Task 2: 后端消息处理 — 实现房间 CRUD 和消息转发
- [x] 实现 handleCreateRoom — 生成 NanoID roomId，创建 Room，将客户端加入，返回 RoomCreated
- [x] 实现 handleJoinRoom — 查找 Room，加入成员，广播 MemberJoined，返回 RoomJoined（含成员列表）
- [x] 实现 handleSendMessage — 原样转发 {iv, ciphertext} 给房间内其他成员（RelayMessage）
- [x] 实现 handleLeaveRoom — 移除成员，广播 MemberLeft，空房间自动销毁
- [x] 实现 handleTyping — 广播 MemberTyping 给房间内其他成员
- [x] 实现断线处理 — 连接断开时自动 LeaveRoom
- [x] 实现心跳 — 服务器每 25s 发送 Ping，客户端回复 Pong
- [x] 添加 NanoID 依赖到 go.mod（github.com/matoous/go-nanoid/v2）
- [x] 验证：启动服务器，用 wscat 手动测试创建/加入/发消息/离开流程

## Task 3: 前端加密层 — Web Crypto API 实现
- [x] 创建 `src/crypto/keys.ts` — generateRoomKey(), exportRoomKey(key), importRoomKey(encoded)
- [x] 创建 `src/crypto/encrypt.ts` — encryptMessage(key, plaintext) → {iv, ciphertext}
- [x] 创建 `src/crypto/decrypt.ts` — decryptMessage(key, iv, ciphertext) → plaintext
- [x] 创建 `src/crypto/shareKey.ts` — encodeShareKey(roomId, key), decodeShareKey(code)
- [x] 实现 base64url 编解码工具函数
- [x] 验证：在浏览器控制台测试加密→解密往返正确

## Task 4: 前端网络层 — WebSocket + MessagePack 重构
- [x] 重写 `src/network/protocol.ts` — 新的消息类型常量和 TypeScript 接口
- [x] 重写 `src/network/websocket.ts` — 连接管理、自动重连（指数退避）、MessagePack 编解码、消息分发到 store
- [x] 删除 `src/game/systems/InputSystem.ts`
- [x] 删除 `src/game/systems/PredictionSystem.ts`
- [x] 删除 `src/game/systems/InterpolationSystem.ts`
- [x] 验证：前端能连接后端，收到 Ping 并回复 Pong

## Task 5: 前端状态管理 — Zustand chatStore
- [x] 删除 `src/stores/gameStore.ts`
- [x] 创建 `src/stores/chatStore.ts` — 完整的聊天状态管理
  - 连接状态 (connected, ws, myId, myName)
  - 房间状态 (roomId, roomKey, shareCode, members)
  - 消息状态 (messages, typingMembers)
  - Actions: connect, createRoom, joinRoom, sendMessage, setTyping, leaveRoom
- [x] 集成加密层：sendMessage 时加密，收到 RelayMessage 时解密
- [x] 集成网络层：actions 触发 WebSocket 消息发送
- [x] 验证：store actions 正确触发网络消息

## Task 6: 前端 UI — 首页（创建/加入房间）
- [x] 创建 `src/pages/Home.tsx` — 首页布局
  - 输入昵称
  - "创建房间" 按钮 → 调用 chatStore.createRoom
  - "加入房间" 输入框（分享码）+ 按钮 → 调用 chatStore.joinRoom
  - 连接状态指示
- [x] 更新 `src/App.tsx` — 根据 roomId 状态切换 Home / ChatRoom 页面
- [x] 删除旧的 `src/ui/HUD.tsx` 和 `src/ui/Scoreboard.tsx`
- [x] 样式：Tailwind 暗色主题，居中卡片布局
- [x] 验证：能创建房间并看到分享码

## Task 7: 前端 UI — 聊天室页面
- [x] 创建 `src/pages/ChatRoom.tsx` — 聊天室容器布局
- [x] 创建 `src/components/MessageList.tsx` — 消息列表（自动滚动到底部）
- [x] 创建 `src/components/MessageInput.tsx` — 输入框 + 发送按钮 + Enter 发送
- [x] 创建 `src/components/MemberList.tsx` — 在线成员侧栏
- [x] 创建 `src/components/ShareKey.tsx` — 显示分享码 + 一键复制按钮
- [x] 创建 `src/components/TypingIndicator.tsx` — "xxx 正在输入..." 提示
- [x] 加密状态指示（🔒 图标）
- [x] 离开房间按钮
- [x] 样式：暗色主题，消息气泡区分自己/他人
- [x] 验证：两个浏览器窗口能加密聊天，消息正确显示

## Task 8: 集成测试 + 清理
- [x] 删除 `src/game/Game.ts` 中的游戏循环代码（保留 PixiJS 初始化如果需要背景效果，否则删除整个 game 目录）
- [x] 删除 `src/game/constants.ts` 中的游戏常量
- [x] 删除 `src/game/shaders/VoidBackground.ts`（如不需要）
- [x] 清理 `src/main.tsx` — 移除游戏初始化代码
- [x] 更新 `package.json` — 移除不需要的依赖（pixi.js 如果不用）、添加 nanoid 依赖
- [x] 端到端测试：创建房间 → 分享码 → 加入 → 聊天 → 离开 → 房间销毁
- [x] 验证服务器日志中无明文消息
- [x] 确保 `npm run build` 和 `go build ./...` 都通过
- [x] 更新 `.env.development` 中的 WebSocket URL 配置
