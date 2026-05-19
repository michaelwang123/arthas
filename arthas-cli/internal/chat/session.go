// session.go 协调聊天会话的完整生命周期，是 arthas-cli 的核心协调层。
//
// 本文件管理会话状态机（Connecting → Joining → Chatting → Leaving），
// 编排 protocol、crypto、network、ui 四个底层模块的协作。
// Session 结构体持有所有会话状态，RunCreate/RunJoin 是两个入口函数，
// chatLoop 是聊天阶段的事件循环。
//
// 📚 学习要点: 协调层的职责
// session.go 不实现任何底层逻辑（加密、编解码、网络 I/O），
// 它只负责"胶水"工作：按正确顺序调用底层模块，管理状态转换，
// 处理错误路径。这种分层使得每个模块可以独立测试，
// 而集成测试只需验证协调逻辑的正确性。
package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"time"

	"github.com/arthas/arthas-cli/internal/crypto"
	"github.com/arthas/arthas-cli/internal/network"
	"github.com/arthas/arthas-cli/internal/protocol"
	"github.com/arthas/arthas-cli/internal/ui"
)

// ---------------------------------------------------------------------------
// 会话状态机
// ---------------------------------------------------------------------------

// SessionState 表示会话的当前阶段，用于控制消息处理逻辑。
//
// 📚 学习要点: 显式状态机 vs 隐式状态
// 使用显式的状态枚举（而非布尔标志组合）有以下好处：
// 1. 状态转换规则清晰可见（每个状态只能转到特定的下一状态）
// 2. 避免"不可能的状态组合"（如同时处于 connecting 和 chatting）
// 3. switch 语句可以穷举所有状态，编译器帮助发现遗漏
type SessionState int

const (
	// StateConnecting 正在建立 WebSocket 连接。
	StateConnecting SessionState = iota

	// StateJoining 已连接，等待服务器的 RoomCreated/RoomJoined 响应。
	StateJoining

	// StateChatting 已加入房间，正常收发消息。
	StateChatting

	// StateLeaving 正在发送 LeaveRoom，准备退出。
	StateLeaving
)

// joinTimeout 是等待服务器 RoomCreated/RoomJoined 响应的最大时间。
// 📚 学习要点: 为什么需要加入阶段超时？
// 如果服务器不响应（网络中断但 TCP 未断开、服务器 bug 等），
// 没有超时的 for 循环会导致 CLI 永久挂起，用户只能强制终止进程。
// 30 秒超时在慢速网络下仍有足够余量，同时避免无限等待。
const joinTimeout = 30 * time.Second

// ---------------------------------------------------------------------------
// 消息载荷类型（加密前/解密后的 JSON 结构）
// ---------------------------------------------------------------------------

// MessagePayload 是加密前的消息载荷结构，与 Web 客户端的 payload.ts 完全兼容。
//
// 📚 学习要点: 为什么使用 JSON 而非直接加密文本？
// 使用 JSON 结构体作为加密载荷（而非裸文本）有两个好处：
//  1. 可扩展性：未来可以添加新字段（如 reply）而不破坏向后兼容
//  2. 互操作性：Web 客户端使用 JSON.stringify/parse，CLI 使用 json.Marshal/Unmarshal，
//     两端的载荷格式完全一致
type MessagePayload struct {
	Text  string     `json:"text"`
	Reply *ReplyData `json:"reply,omitempty"`
}

// ReplyData 引用回复的上下文信息，由 Web 客户端发送。
// CLI MVP 不主动发送引用回复，但能正确显示收到的引用回复。
type ReplyData struct {
	StableID   string `json:"stableId"`
	SenderName string `json:"senderName"`
	Preview    string `json:"preview"`
}

// ---------------------------------------------------------------------------
// Session 结构体
// ---------------------------------------------------------------------------

// Session 协调所有模块，管理聊天会话的完整生命周期。
//
// 📚 学习要点: 为什么 Session 持有所有状态？
// 将所有会话状态集中在一个结构体中（而非分散在全局变量或闭包中）：
// 1. 生命周期清晰：Session 创建时初始化，退出时释放
// 2. 可测试性：测试可以构造不同状态的 Session 实例
// 3. 并发安全：所有字段只在 main goroutine 中修改（CSP 模型）
type Session struct {
	conn        *network.Conn
	roomKey     []byte
	display     *ui.Display
	myName      string
	members     map[string]protocol.MemberInfo // id → member info
	state       SessionState
	hasPassword bool // 从 RoomJoined 响应中获取
	ephemeral   int  // 从 RoomJoined 响应中获取（秒数，0 = 非临时）
}

// ---------------------------------------------------------------------------
// RunCreate — 创建房间流程
// ---------------------------------------------------------------------------

// RunCreate 执行创建房间的完整流程：
//  1. 生成 256-bit Room_Key（crypto/rand）
//  2. 连接 WebSocket（设置 Origin: "arthas-cli"）
//  3. 发送 CreateRoom（type 0x01）
//  4. 等待 RoomCreated (0x10) + RoomJoined (0x11)
//  5. 存储 members、hasPassword、ephemeral
//  6. 显示 Share_Code
//  7. 进入 chatLoop
//
// 参数:
//   - serverURL: WebSocket 服务器地址（如 "wss://example.com/ws"）
//   - name: 用户的显示昵称（已通过 ValidateDisplayName 验证）
func RunCreate(serverURL, name string) error {
	// 1. 生成房间密钥
	roomKey, err := crypto.GenerateRoomKey()
	if err != nil {
		return fmt.Errorf("failed to generate room key: %w", err)
	}

	// 2. 创建终端显示
	display := ui.NewDisplay(name)

	// 3. 连接 WebSocket
	conn, err := network.Dial(serverURL)
	if err != nil {
		return fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// 4. 发送 CreateRoom 消息
	createMsg := &protocol.Message{
		Type: protocol.MsgCreateRoom,
		Data: protocol.CreateRoomData{
			Name:      name,
			Password:  "",
			Ephemeral: 0,
		},
	}
	encoded, err := protocol.Encode(createMsg)
	if err != nil {
		return fmt.Errorf("failed to encode CreateRoom: %w", err)
	}
	if err := conn.Send(encoded); err != nil {
		return fmt.Errorf("failed to send CreateRoom: %w", err)
	}

	// 5. 等待 RoomCreated + RoomJoined 响应（带超时保护）
	s := &Session{
		conn:    conn,
		roomKey: roomKey,
		display: display,
		myName:  name,
		members: make(map[string]protocol.MemberInfo),
		state:   StateJoining,
	}

	var roomID string
	timeout := time.After(joinTimeout)

	for {
		select {
		case <-timeout:
			return fmt.Errorf("timed out waiting for server response (waited %s)", joinTimeout)
		default:
		}

		raw, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("connection lost while waiting for server response: %w", err)
		}

		msg, err := protocol.Decode(raw)
		if err != nil {
			return fmt.Errorf("failed to decode server message: %w", err)
		}

		switch msg.Type {
		case protocol.MsgRoomCreated:
			// 提取 roomId
			data, ok := msg.Data.(map[string]interface{})
			if !ok {
				return fmt.Errorf("unexpected RoomCreated data format")
			}
			id, ok := data["roomId"].(string)
			if !ok {
				return fmt.Errorf("RoomCreated missing roomId field")
			}
			roomID = id

		case protocol.MsgRoomJoined:
			// 提取 members、hasPassword、ephemeral
			if err := s.processRoomJoined(msg); err != nil {
				return err
			}

			// 构建并显示 Share_Code
			shareCode := crypto.BuildShareCode(roomID, roomKey, s.ephemeral)
			display.ShowShareCode(shareCode)

			// 进入聊天循环
			s.state = StateChatting
			return s.chatLoop()

		case protocol.MsgError:
			return s.handleJoinError(msg)

		default:
			// 忽略其他消息类型
		}
	}
}

// ---------------------------------------------------------------------------
// RunJoin — 加入房间流程
// ---------------------------------------------------------------------------

// RunJoin 执行加入房间的完整流程：
//  1. 解析 Share_Code（提取 roomId、roomKey、ephemeral）
//  2. 连接 WebSocket（设置 Origin: "arthas-cli"）
//  3. 发送 JoinRoom（type 0x02）
//  4. 等待 RoomJoined (0x11)
//  5. 存储 members map
//  6. 显示成员列表
//  7. 进入 chatLoop
//
// 错误处理：
//   - E001: room not found（房间不存在或已过期）
//   - E002: room is full（达到最大成员数）
//   - E006: incorrect room password（密码错误）
//
// 📚 学习要点: RunJoin vs RunCreate 的差异
// RunJoin 不需要生成密钥（从 Share_Code 中提取），
// 也不需要等待 RoomCreated 响应（只等待 RoomJoined）。
// 但错误处理更复杂：需要区分多种服务器错误码并给出用户友好的提示。
//
// 参数:
//   - serverURL: WebSocket 服务器地址
//   - name: 用户的显示昵称（已通过 ValidateDisplayName 验证）
//   - shareCode: 分享码字符串（由房间创建者提供）
func RunJoin(serverURL, name, shareCode string) error {
	// 1. 解析分享码
	sc, err := crypto.ParseShareCode(shareCode)
	if err != nil {
		return fmt.Errorf("invalid share code: %w", err)
	}

	// 2. 创建终端显示
	display := ui.NewDisplay(name)

	// 3. 连接 WebSocket
	conn, err := network.Dial(serverURL)
	if err != nil {
		return fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// 4. 发送 JoinRoom 消息
	joinMsg := &protocol.Message{
		Type: protocol.MsgJoinRoom,
		Data: protocol.JoinRoomData{
			RoomID:   sc.RoomID,
			Name:     name,
			Password: "",
		},
	}
	encoded, err := protocol.Encode(joinMsg)
	if err != nil {
		return fmt.Errorf("failed to encode JoinRoom: %w", err)
	}
	if err := conn.Send(encoded); err != nil {
		return fmt.Errorf("failed to send JoinRoom: %w", err)
	}

	// 5. 等待 RoomJoined 响应（带超时保护）
	s := &Session{
		conn:    conn,
		roomKey: sc.KeyBytes,
		display: display,
		myName:  name,
		members: make(map[string]protocol.MemberInfo),
		state:   StateJoining,
	}

	timeout := time.After(joinTimeout)

	for {
		select {
		case <-timeout:
			return fmt.Errorf("timed out waiting for server response (waited %s)", joinTimeout)
		default:
		}

		raw, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("connection lost while waiting for server response: %w", err)
		}

		msg, err := protocol.Decode(raw)
		if err != nil {
			return fmt.Errorf("failed to decode server message: %w", err)
		}

		switch msg.Type {
		case protocol.MsgRoomJoined:
			// 提取 members、hasPassword、ephemeral
			if err := s.processRoomJoined(msg); err != nil {
				return err
			}

			// 显示成员列表
			memberList := s.getMemberList()
			display.ShowMembers(memberList)

			// 进入聊天循环
			s.state = StateChatting
			return s.chatLoop()

		case protocol.MsgError:
			return s.handleJoinError(msg)

		default:
			// 忽略其他消息类型
		}
	}
}

// ---------------------------------------------------------------------------
// 辅助方法
// ---------------------------------------------------------------------------

// processRoomJoined 从 RoomJoined 响应中提取成员列表、密码保护状态和临时模式配置。
//
// RoomJoined 响应的 data 字段结构：
//
//	{
//	  "roomId": string,
//	  "members": [{"id": string, "name": string, "color": string}, ...],
//	  "hasPassword": bool,
//	  "ephemeral": int
//	}
func (s *Session) processRoomJoined(msg *protocol.Message) error {
	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		return fmt.Errorf("unexpected RoomJoined data format")
	}

	// 提取 members 数组
	membersRaw, ok := data["members"]
	if ok {
		if membersList, ok := membersRaw.([]interface{}); ok {
			for _, m := range membersList {
				if memberMap, ok := m.(map[string]interface{}); ok {
					id, _ := memberMap["id"].(string)
					name, _ := memberMap["name"].(string)
					color, _ := memberMap["color"].(string)
					if id != "" {
						s.members[id] = protocol.MemberInfo{
							ID:    id,
							Name:  name,
							Color: color,
						}
					}
				}
			}
		}
	}

	// 提取 hasPassword
	if hp, ok := data["hasPassword"].(bool); ok {
		s.hasPassword = hp
	}

	// 提取 ephemeral
	if eph := data["ephemeral"]; eph != nil {
		s.ephemeral = int(protocol.ToInt(eph))
	}

	return nil
}

// handleJoinError 处理服务器在加入阶段返回的错误响应。
//
// 📚 学习要点: 错误码映射策略
// 服务器使用字符串错误码（E001、E002、E006 等），CLI 将其映射为
// 用户友好的错误消息。使用 protocol 包中定义的常量（而非硬编码字符串）
// 确保错误码定义的单一数据源，避免拼写错误导致的匹配失败。
func (s *Session) handleJoinError(msg *protocol.Message) error {
	data, ok := msg.Data.(map[string]interface{})
	if !ok {
		return fmt.Errorf("server error: unexpected error format")
	}

	code, _ := data["code"].(string)
	desc, _ := data["description"].(string)

	switch code {
	case protocol.ErrRoomNotFound:
		return fmt.Errorf("room not found")
	case protocol.ErrRoomFull:
		return fmt.Errorf("room is full")
	case protocol.ErrIncorrectPassword:
		return fmt.Errorf("incorrect room password")
	default:
		return fmt.Errorf("server error: %s: %s", code, desc)
	}
}

// getMemberList 将 members map 转换为 MemberInfo 切片，用于 UI 显示。
func (s *Session) getMemberList() []protocol.MemberInfo {
	members := make([]protocol.MemberInfo, 0, len(s.members))
	for _, m := range s.members {
		members = append(members, m)
	}
	return members
}

// ---------------------------------------------------------------------------
// chatLoop — 聊天主循环（四 goroutine 事件循环）
// ---------------------------------------------------------------------------

// chatLoop 是聊天阶段的事件循环，使用四个 goroutine 协调：
// stdinPump、readPump、writePump（network 层）和 main goroutine 的 select。
//
// 📚 学习要点: 为什么 stdin 需要独立 goroutine？（stdinPump 的必要性）
// Go 的 select 语句只能等待 channel 操作，而 bufio.Scanner.Scan() 是阻塞系统调用。
// 如果将 stdin 读取放在 main goroutine 中，select 将无法同时监听 WebSocket 消息、
// 系统信号和连接关闭事件。解决方案是将 stdin 读取放在独立 goroutine（stdinPump）中，
// 通过 inputCh channel 将用户输入传递给 main goroutine 的 select 循环。
// 这是 Go 中处理多个阻塞 I/O 源的标准模式。
//
// 📚 学习要点: CSP 并发模型（Communicating Sequential Processes）
// chatLoop 采用 CSP 模型：每个 goroutine 是独立的顺序进程，
// 通过 channel 通信而非共享内存。所有会话状态（members map、state 等）
// 只在 main goroutine 中修改，其他 goroutine 只负责 I/O 并通过 channel 传递数据。
// 这消除了锁竞争，使并发代码易于推理正确性。
//
// 📚 学习要点: 跨平台信号处理差异
//   - os.Interrupt (SIGINT): 在所有平台上由 Ctrl+C 触发。
//     Unix 上是真正的 POSIX 信号，Windows 上是控制台事件的模拟。
//     Go 的 os/signal 包统一了这两种机制，使用 os.Interrupt 即可跨平台工作。
//   - syscall.SIGTERM: 仅在 Unix 上可用，Windows 上不存在此信号。
//     因此本代码不使用 syscall 包，避免编译错误。
//   - EOF (Ctrl+D / Ctrl+Z+Enter): 不是信号，而是 stdin 流结束。
//     Unix 上 Ctrl+D 发送 EOF，Windows 上 Ctrl+Z+Enter 发送 EOF。
//     通过 ReadLine() 返回 io.EOF 统一处理。
func (s *Session) chatLoop() error {
	// 创建可取消的 context，用于协调所有 goroutine 的退出
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 📚 学习要点: channel 容量选择
	// inputCh 容量为 1：用户输入是低频操作（人类打字速度），
	//   容量 1 足够缓冲一行输入，同时防止 stdinPump 在 main 处理消息时阻塞。
	// msgCh 容量为 16：服务器可能突发多条消息（如多人同时发言），
	//   16 条缓冲与 network 层的 sendCh 容量对齐，避免 readPump 阻塞。
	// sigCh 容量为 1：信号是低频事件，容量 1 确保信号不丢失。
	inputCh := make(chan string, 1)
	msgCh := make(chan *protocol.Message, 16)
	sigCh := make(chan os.Signal, 1)

	// 注册信号处理：仅监听 os.Interrupt（Ctrl+C）
	// 📚 学习要点: 为什么不使用 syscall.SIGTERM？
	// syscall.SIGTERM 在 Windows 上未定义（编译错误）。
	// os.Interrupt 在所有平台上都能正确捕获 Ctrl+C：
	// - Unix: 映射到 SIGINT
	// - Windows: 映射到 CTRL_C_EVENT 控制台事件
	signal.Notify(sigCh, os.Interrupt)
	defer signal.Stop(sigCh)

	// 启动 stdinPump goroutine：读取用户输入
	go s.stdinPump(ctx, inputCh)

	// 启动 readPump goroutine：读取 WebSocket 消息
	go s.readPump(ctx, msgCh)

	// writePump 已由 network.Conn 在 Dial() 时启动，无需额外启动

	// 📚 学习要点: main goroutine 的 select 事件循环
	// select 同时等待四个事件源，哪个先就绪就处理哪个：
	// 1. inputCh: 用户输入了一行文本
	// 2. msgCh: 服务器发来了一条消息
	// 3. sigCh: 用户按了 Ctrl+C
	// 4. ctx.Done(): 连接已关闭（readPump 退出时 msgCh 被关闭）
	// 这种模式确保 main goroutine 永远不会阻塞在单一 I/O 操作上。
	for {
		select {
		case line, ok := <-inputCh:
			if !ok {
				// inputCh 关闭意味着 stdin EOF（Ctrl+D / Ctrl+Z+Enter）
				// 用户主动退出，发送 LeaveRoom 并优雅关闭
				s.state = StateLeaving
				s.sendLeaveRoom()
				return nil
			}
			// 处理用户输入（stub：后续 task 8.4 实现）
			s.handleUserInput(line)

		case msg, ok := <-msgCh:
			if !ok {
				// msgCh 关闭意味着 readPump 退出（WebSocket 连接断开）
				if s.state == StateLeaving {
					// 主动离开，正常退出
					return nil
				}
				// 非预期断线
				s.display.ShowError("Connection lost")
				return fmt.Errorf("connection lost")
			}
			// 处理服务器消息（stub：后续 task 8.7 实现）
			s.handleServerMessage(msg)

		case <-sigCh:
			// Ctrl+C：优雅退出
			s.state = StateLeaving
			s.sendLeaveRoom()
			return nil

		case <-ctx.Done():
			// context 被取消（不应在正常流程中触发，防御性处理）
			return nil
		}
	}
}

// ---------------------------------------------------------------------------
// stdinPump — stdin 读取 goroutine
// ---------------------------------------------------------------------------

// stdinPump 在独立 goroutine 中阻塞读取 stdin，将每行输入发送到 inputCh。
// 当 stdin 关闭（EOF）或 ctx 被取消时退出并关闭 inputCh。
//
// 📚 学习要点: 为什么 stdinPump 需要关闭 inputCh？
// 关闭 inputCh 是向 main goroutine 发送"stdin 已结束"信号的唯一方式。
// main goroutine 通过 `line, ok := <-inputCh` 中 ok==false 检测到 EOF，
// 从而触发优雅退出流程。如果不关闭 channel，main 将永远等待下一行输入。
//
// 📚 学习要点: stdinPump 的退出时机
// bufio.Scanner.Scan() 是不可中断的阻塞调用（不像 socket 可以设置 deadline）。
// 当 ctx 被取消时（如用户 Ctrl+C），stdinPump 可能仍在等待 stdin 输入。
// 这是可接受的：进程退出时 OS 会回收所有 goroutine。
// 我们在发送到 inputCh 前检查 ctx.Done()，确保取消后不再向 channel 发送数据。
func (s *Session) stdinPump(ctx context.Context, inputCh chan<- string) {
	defer close(inputCh)

	for {
		line, err := ui.ReadLine()
		if err != nil {
			if err == io.EOF {
				// stdin 关闭（Ctrl+D on Unix, Ctrl+Z+Enter on Windows）
				// 关闭 inputCh 通知 main goroutine
				return
			}
			// 其他读取错误（极少发生），静默退出
			return
		}

		// 在发送前检查 ctx 是否已取消
		select {
		case <-ctx.Done():
			return
		case inputCh <- line:
			// 成功发送到 main goroutine
		}
	}
}

// ---------------------------------------------------------------------------
// readPump — WebSocket 读取 goroutine
// ---------------------------------------------------------------------------

// readPump 在独立 goroutine 中阻塞读取 WebSocket 消息，解码后发送到 msgCh。
// 当连接断开或 ctx 被取消时退出并关闭 msgCh。
//
// 📚 学习要点: 为什么 readPump 关闭 msgCh？
// 与 stdinPump 关闭 inputCh 的原因相同：关闭 channel 是通知 main goroutine
// "数据源已终止"的标准 Go 模式。main 通过 `msg, ok := <-msgCh` 中 ok==false
// 检测到连接断开，从而显示断线消息并退出。
func (s *Session) readPump(ctx context.Context, msgCh chan<- *protocol.Message) {
	defer close(msgCh)

	for {
		raw, err := s.conn.ReadMessage()
		if err != nil {
			// WebSocket 读取失败：连接断开、超时或被关闭
			// 关闭 msgCh 通知 main goroutine
			return
		}

		msg, err := protocol.Decode(raw)
		if err != nil {
			// 解码失败：跳过此消息，继续读取
			// （可能是未知格式的消息，不应中断连接）
			continue
		}

		// 在发送前检查 ctx 是否已取消
		select {
		case <-ctx.Done():
			return
		case msgCh <- msg:
			// 成功发送到 main goroutine
		}
	}
}

// ---------------------------------------------------------------------------
// handleMemberJoined — 处理成员加入事件
// ---------------------------------------------------------------------------

// handleMemberJoined 处理 MemberJoined (0x12) 服务器消息。
// 将新成员添加到 members map 并显示系统通知。
//
// 📚 学习要点: 为什么需要维护 members map？
// 服务器的 RelayMessage (0x14) 不包含发送者颜色字段，
// 只包含 senderId 和 senderName。CLI 需要从 members map 中
// 查找发送者的颜色来正确渲染消息。MemberJoined 事件是
// 保持 members map 与服务器状态同步的关键机制。
//
// 参数:
//   - data: 服务器消息的 data 字段，包含 id、name、color
func (s *Session) handleMemberJoined(data map[string]interface{}) {
	id, _ := data["id"].(string)
	name, _ := data["name"].(string)
	color, _ := data["color"].(string)

	if id == "" {
		return
	}

	// 添加到 members map
	s.members[id] = protocol.MemberInfo{
		ID:    id,
		Name:  name,
		Color: color,
	}

	// 显示系统消息（ShowSystemMessage 已添加 *** 前缀）
	s.display.ShowSystemMessage(name + " joined")
}

// ---------------------------------------------------------------------------
// handleMemberLeft — 处理成员离开事件
// ---------------------------------------------------------------------------

// handleMemberLeft 处理 MemberLeft (0x13) 服务器消息。
// 从 members map 中移除成员并显示系统通知。
//
// 📚 学习要点: 查找后删除的顺序
// 必须先从 map 中查找成员名称（用于显示通知），再执行 delete。
// 如果先删除再查找，将无法获取离开成员的名称。
// 对于 map 中不存在的 id（理论上不应发生），使用 "unknown" 作为兜底。
//
// 参数:
//   - data: 服务器消息的 data 字段，包含 id
func (s *Session) handleMemberLeft(data map[string]interface{}) {
	id, _ := data["id"].(string)

	if id == "" {
		return
	}

	// 查找成员名称（在删除之前）
	name := "unknown"
	if member, ok := s.members[id]; ok {
		name = member.Name
	}

	// 显示系统消息（ShowSystemMessage 已添加 *** 前缀）
	s.display.ShowSystemMessage(name + " left")

	// 从 map 中移除
	delete(s.members, id)
}

// ---------------------------------------------------------------------------
// handleUserInput — 处理用户输入
// ---------------------------------------------------------------------------

// handleUserInput 处理用户从 stdin 输入的一行文本。
// 负责命令解析（/quit、/exit）、消息验证、加密和发送。
//
// 处理流程：
//  1. 跳过空行（用户只按了回车）
//  2. 识别 /quit 和 /exit 命令 → 发送 LeaveRoom 并触发退出
//  3. 验证消息长度 ≤ 500 rune（与 Web 客户端一致）
//  4. 构造 JSON 载荷 → AES-256-GCM 加密 → MessagePack 编码 → WebSocket 发送
//  5. 本地回显（服务器不会将消息回传给发送者）
//
// 📚 学习要点: 为什么 /quit 和 /exit 不能直接 return 退出 chatLoop？
// handleUserInput 是从 chatLoop 的 select 分支中调用的普通方法，
// 它的 return 只会返回到 select 循环，不会退出 chatLoop。
// 解决方案是设置 s.state = StateLeaving 并关闭连接：
// - 关闭连接会导致 readPump 的 ReadMessage() 返回错误
// - readPump 退出时关闭 msgCh
// - chatLoop 的 select 检测到 msgCh 关闭，且 state == StateLeaving，正常返回
// 这是一种通过"断开数据源"来间接退出事件循环的模式。
func (s *Session) handleUserInput(line string) {
	// 1. 跳过空行
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return
	}

	// 2. 处理退出命令
	if trimmed == "/quit" || trimmed == "/exit" {
		s.state = StateLeaving
		s.sendLeaveRoom()
		return
	}

	// 3. 验证消息长度（≤ 500 rune）
	if err := ui.ValidateMessageLength(trimmed); err != nil {
		s.display.ShowError(err.Error())
		return
	}

	// 4. 构造 JSON 载荷
	// 📚 学习要点: 为什么先 JSON 再加密？
	// Arthas 协议要求加密载荷是 JSON 格式的 {"text": "..."} 对象，
	// 而非裸文本。这样 Web 客户端和 CLI 都能正确解析载荷中的结构化字段
	// （如 reply 引用回复信息），保证双端互操作性。
	payload := MessagePayload{Text: trimmed}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		s.display.ShowError(fmt.Sprintf("failed to marshal message: %s", err.Error()))
		return
	}

	// 5. AES-256-GCM 加密
	iv, ciphertext, err := crypto.Encrypt(s.roomKey, jsonBytes)
	if err != nil {
		s.display.ShowError(fmt.Sprintf("encryption failed: %s", err.Error()))
		return
	}

	// 6. 编码为协议消息（MessagePack 信封）
	msg := &protocol.Message{
		Type: protocol.MsgSendMessage,
		Data: protocol.SendMessageData{
			IV:         iv,
			Ciphertext: ciphertext,
		},
	}
	encoded, err := protocol.Encode(msg)
	if err != nil {
		s.display.ShowError(fmt.Sprintf("failed to encode message: %s", err.Error()))
		return
	}

	// 7. 通过 WebSocket 发送
	if err := s.conn.Send(encoded); err != nil {
		s.display.ShowError(fmt.Sprintf("failed to send message: %s", err.Error()))
		return
	}

	// 8. 本地回显（服务器不会将消息回传给发送者）
	s.display.ShowOwnMessage(trimmed)
}

// ---------------------------------------------------------------------------
// handleServerMessage — 处理服务器消息路由
// ---------------------------------------------------------------------------

// handleServerMessage 根据消息类型路由到对应的处理函数。
//
// 📚 学习要点: 消息路由的设计原则
// 使用 switch 语句进行消息路由有以下优势：
// 1. 编译时可检查是否遗漏了某种消息类型（配合 linter）
// 2. 每种消息类型的处理逻辑独立，便于单独测试
// 3. 未知消息类型静默忽略，确保向前兼容（服务器新增消息类型不会导致 CLI 崩溃）
//
// 静默忽略的消息类型：
//   - 0x15 (MemberTyping): 终端无法显示输入指示器
//   - 0x19 (RelayReaction): CLI MVP 不支持反应
//   - 0x1A-0x1E (文件传输): CLI MVP 不支持文件传输
//   - 未知类型: 向前兼容，服务器可能添加新消息类型
func (s *Session) handleServerMessage(msg *protocol.Message) {
	// 提取 data 字段（大多数消息类型需要）
	data, _ := msg.Data.(map[string]interface{})

	switch msg.Type {
	case protocol.MsgRelayMessage:
		// 0x14: 中转的加密聊天消息
		if data != nil {
			s.handleRelayMessage(data)
		}

	case protocol.MsgMemberJoined:
		// 0x12: 新成员加入
		if data != nil {
			s.handleMemberJoined(data)
		}

	case protocol.MsgMemberLeft:
		// 0x13: 成员离开
		if data != nil {
			s.handleMemberLeft(data)
		}

	case protocol.MsgPing:
		// 0x18: 应用层心跳，需回复 Pong
		if data != nil {
			s.handlePing(data)
		}

	case protocol.MsgError:
		// 0x17: 服务器错误（聊天阶段收到的错误，如发送频率限制）
		if data != nil {
			code, _ := data["code"].(string)
			desc, _ := data["description"].(string)
			s.display.ShowError(fmt.Sprintf("%s: %s", code, desc))
		}

	case protocol.MsgRoomClosed:
		// 0x16: 房间被关闭（房主离开或临时房间过期）
		s.display.ShowSystemMessage("Room closed")
		s.state = StateLeaving
		s.conn.Close()

	case protocol.MsgMemberTyping,
		protocol.MsgRelayReaction,
		protocol.MsgRelayFileMeta,
		protocol.MsgRelayFileChunk,
		protocol.MsgRelayFileComplete,
		protocol.MsgRelayFileCancel,
		protocol.MsgRelayFileAck:
		// 0x15, 0x19, 0x1A-0x1E: CLI 不支持的功能，静默忽略

	default:
		// 未知消息类型：静默忽略（向前兼容）
	}
}

// ---------------------------------------------------------------------------
// handlePing — 处理应用层心跳
// ---------------------------------------------------------------------------

// handlePing 处理 MsgPing (0x18) 消息：提取时间戳并回复 Pong。
//
// 📚 学习要点: 应用层心跳 vs WebSocket 心跳
// Arthas 协议定义了两层心跳机制：
//   - WebSocket 层: gorilla/websocket 自动处理 Ping/Pong 控制帧（检测 TCP 存活）
//   - 应用层: MsgPing (0x18) / MsgPong (0x06)，用于前端延迟测量
//
// 应用层心跳的工作方式：
//  1. 服务器发送 Ping 消息，data 中包含时间戳 T（Unix 毫秒）
//  2. 客户端收到后立即回复 Pong，携带相同的时间戳 T
//  3. 服务器计算 RTT = now - T，用于连接质量监控
//
// CLI 必须正确回复 Pong，否则服务器可能判定连接不活跃并断开。
//
// 参数:
//   - data: 服务器消息的 data 字段，包含 t（时间戳）
func (s *Session) handlePing(data map[string]interface{}) {
	// 提取时间戳（使用 ToInt 安全处理 msgpack 整数类型）
	t := protocol.ToInt(data["t"])

	// 编码 Pong 响应（携带相同时间戳）
	pongMsg := &protocol.Message{
		Type: protocol.MsgPong,
		Data: protocol.PongData{T: t},
	}
	encoded, err := protocol.Encode(pongMsg)
	if err != nil {
		// 编码失败（理论上不应发生），静默忽略
		return
	}

	// 发送 Pong（尽力而为，忽略发送错误）
	// 如果连接已断开，Send 会返回错误，但此时 readPump 也会退出，
	// chatLoop 会通过 msgCh 关闭检测到断线。
	_ = s.conn.Send(encoded)
}

// ---------------------------------------------------------------------------
// handleRelayMessage — 处理服务器中转的加密聊天消息
// ---------------------------------------------------------------------------

// handleRelayMessage 处理 MsgRelayMessage (0x14) 消息：解密、解析载荷、显示。
//
// RelayMessage 的 data 字段结构（由服务器中转）：
//
//	{
//	  "senderId": string,     // 发送者的成员 ID
//	  "senderName": string,   // 发送者的显示昵称
//	  "iv": string,           // base64url 编码的 12 字节 IV
//	  "ciphertext": string,   // base64url 编码的 AES-256-GCM 密文
//	  "t": int64              // 服务器时间戳（Unix 毫秒）
//	}
//
// 📚 学习要点: RelayMessage 不包含 color 字段
// 服务器在 RelayMessage 中不携带发送者颜色（节省带宽）。
// CLI 必须从本地 members map 中通过 senderId 查找颜色。
// 这要求 CLI 正确维护 members map（在 RoomJoined 和 MemberJoined 时更新）。
//
// 📚 学习要点: 向后兼容的载荷解析策略
// 加密载荷可能是 JSON 格式 {"text": "...", "reply": {...}} 或纯文本。
// 早期版本的客户端可能直接加密文本（无 JSON 包装），因此：
// - 先尝试 JSON 解析
// - 如果 JSON 解析失败或 text 字段为空，将整个明文作为消息文本
// 这确保 CLI 能正确显示来自任何版本客户端的消息。
func (s *Session) handleRelayMessage(data map[string]interface{}) {
	// 1. 提取字段
	senderId, _ := data["senderId"].(string)
	senderName, _ := data["senderName"].(string)
	ivB64, _ := data["iv"].(string)
	ciphertextB64, _ := data["ciphertext"].(string)
	timestamp := protocol.ToInt(data["t"])

	// 2. 解密消息
	plaintext, err := crypto.Decrypt(s.roomKey, ivB64, ciphertextB64)
	if err != nil {
		// 解密失败：显示警告但不崩溃
		// 可能原因：密钥不匹配（用户使用旧分享码）、数据被篡改、传输错误
		s.display.ShowSystemMessage("[⚠ decryption failed]")
		return
	}

	// 3. 解析 JSON 载荷
	var payload MessagePayload
	jsonErr := json.Unmarshal(plaintext, &payload)

	// 4. 向后兼容：如果 JSON 解析失败或 text 为空，使用整个明文
	if jsonErr != nil || payload.Text == "" {
		payload.Text = string(plaintext)
		payload.Reply = nil // 确保非 JSON 载荷不会有残留的 reply 数据
	}

	// 5. 颜色查找：从 members map 中获取发送者颜色
	// 📚 学习要点: 为什么需要从 map 查找而非使用消息中的字段？
	// RelayMessage 协议设计中不包含 color 字段（减少每条消息的传输开销）。
	// 颜色信息只在 RoomJoined 和 MemberJoined 时传递一次，之后由客户端本地缓存。
	color := ""
	if member, ok := s.members[senderId]; ok {
		color = member.Color
	}

	// 6. 如果有引用回复，先显示回复上下文
	if payload.Reply != nil {
		s.display.ShowReplyContext(payload.Reply.SenderName, payload.Reply.Preview)
	}

	// 7. 显示消息
	s.display.ShowMessage(senderName, color, payload.Text, timestamp)
}

// ---------------------------------------------------------------------------
// sendLeaveRoom — 发送 LeaveRoom 消息并关闭连接
// ---------------------------------------------------------------------------

// sendLeaveRoom 编码并发送 LeaveRoom (0x04) 消息，然后关闭连接。
// 在 Ctrl+C、Ctrl+D、/quit、/exit 时调用。
//
// 📚 学习要点: 尽力而为的退出策略
// sendLeaveRoom 采用"尽力而为"策略：
//   - 编码失败 → 跳过发送，直接关闭连接
//   - 发送失败 → 忽略错误，继续关闭连接（连接可能已断开）
//   - 关闭失败 → 忽略错误（进程即将退出，OS 会回收资源）
//
// 这种策略确保退出流程不会因为网络问题而卡住或 panic。
// 服务器在检测到连接断开后会自动清理该成员的状态。
func (s *Session) sendLeaveRoom() {
	// 尽力发送 LeaveRoom，忽略错误（连接可能已断开）
	encoded, err := protocol.Encode(&protocol.Message{
		Type: protocol.MsgLeaveRoom,
		Data: protocol.LeaveRoomData{},
	})
	if err == nil {
		_ = s.conn.Send(encoded)
	}

	// 关闭连接（触发 readPump 退出 → msgCh 关闭 → chatLoop 检测到退出）
	s.conn.Close()

	// 📚 学习要点: Best-effort 密钥清零
	// 会话结束后，roomKey 不再需要。显式清零减少密钥在内存中的驻留时间，
	// 降低内存转储（core dump）或冷启动攻击（cold boot attack）泄露密钥的风险。
	// 注意：Go 的 GC 可能已经复制了密钥到其他内存位置（如栈逃逸），
	// 因此这只是 best-effort 安全措施，不能保证密钥完全从内存中消失。
	for i := range s.roomKey {
		s.roomKey[i] = 0
	}
}
