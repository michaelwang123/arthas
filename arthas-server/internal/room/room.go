package room

import (
	"errors"
	"sync"

	"github.com/arthas/arthas-server/internal/logger"
)

const (
	// MaxMembers is the maximum number of members allowed in a single room.
	MaxMembers = 50
)

// Errors returned by Room methods.
var (
	ErrRoomFull = errors.New("room is full")
)

// Member represents a participant in a chat room.
//
// 📚 学习要点: SendFunc vs SendFileFunc — 两种发送策略的分离
// Member 拥有两个发送函数，分别服务于不同的消息类型：
//
// SendFunc（非阻塞）：用于聊天消息、系统通知等普通消息。
//   - 缓冲区满时静默丢弃（聊天消息丢失可接受）
//   - 不会阻塞调用方（Broadcast 串行调用，不能被慢客户端拖住）
//
// SendFileFunc（带超时阻塞）：用于文件传输分片数据。
//   - 缓冲区满时等待最多 5 秒（文件分片丢失 = 整个传输失败）
//   - 由 BroadcastFileData 在独立 goroutine 中调用（不阻塞其他成员）
//   - 超时返回 false，调用方记录警告但不影响其他接收方
//
// 这种分离确保了：
// 1. 普通消息的低延迟特性不受文件传输影响
// 2. 文件传输的可靠性不被非阻塞发送破坏
// 3. 慢接收方不会拖住整个系统（超时 + 并发发送）
type Member struct {
	ID           string
	Name         string
	Color        string
	SendFunc     func([]byte)      // Called by Broadcast to deliver data to this member (non-blocking).
	SendFileFunc func([]byte) bool // Called by BroadcastFileData for file transfer (blocking with timeout, returns false on timeout).
}

// Room represents a single chat room with its members.
type Room struct {
	ID           string
	PasswordHash string // SHA-256 hash of room password; empty string means no password.
	Ephemeral    int    // Ephemeral message duration in seconds; 0 means disabled.
	mu           sync.RWMutex
	members      map[string]*Member
}

// NewRoom creates a new Room with the given ID, optional password hash, and ephemeral duration.
func NewRoom(id, passwordHash string, ephemeral int) *Room {
	return &Room{
		ID:           id,
		PasswordHash: passwordHash,
		Ephemeral:    ephemeral,
		members:      make(map[string]*Member),
	}
}

// MemberCount returns the current number of members in the room.
func (r *Room) MemberCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.members)
}

// IsFull returns true if the room has reached its capacity limit.
func (r *Room) IsFull() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.members) >= MaxMembers
}

// AddMember adds a member to the room. Returns ErrRoomFull if the room
// has reached MaxMembers capacity.
func (r *Room) AddMember(member *Member) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(r.members) >= MaxMembers {
		return ErrRoomFull
	}

	r.members[member.ID] = member
	return nil
}

// RemoveMember removes a member by ID and returns the remaining member count.
func (r *Room) RemoveMember(id string) int {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.members, id)
	return len(r.members)
}

// GetMember returns the member with the given ID, or nil if not found.
func (r *Room) GetMember(id string) *Member {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.members[id]
}

// GetMembers returns a copy of all members currently in the room.
func (r *Room) GetMembers() []*Member {
	r.mu.RLock()
	defer r.mu.RUnlock()

	members := make([]*Member, 0, len(r.members))
	for _, m := range r.members {
		members = append(members, m)
	}
	return members
}

// Broadcast sends data to all members in the room except the sender.
// It calls each member's SendFunc if set. Members without a SendFunc are skipped.
func (r *Room) Broadcast(senderId string, data []byte) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for id, m := range r.members {
		if id == senderId {
			continue
		}
		if m.SendFunc != nil {
			m.SendFunc(data)
		}
	}
}

// BroadcastFileData 向房间内除 excludeID 以外的所有成员发送文件传输数据。
// 与普通 Broadcast 不同，此方法使用并发 goroutine + sync.WaitGroup 发送，
// 每个成员的 SendFileFunc 在独立 goroutine 中执行（带 5s 超时阻塞）。
// 如果某个接收方发送超时（SendFileFunc 返回 false），记录警告日志但不影响其他接收方。
//
// 📚 学习要点: 并发 Broadcast 与串行 Broadcast 的权衡
//
// 串行发送（普通 Broadcast 的方式）：
//   - 优点：实现简单，无 goroutine 开销，适合非阻塞的 SendFunc
//   - 缺点：如果某个成员的发送操作阻塞（如 SendFileFunc 的 5s 超时），
//     后续所有成员都必须等待，导致不必要的延迟累积。
//     极端情况：50 个成员中有 3 个超时 → 其他 47 个成员延迟 15s 才收到数据。
//
// 并发发送（BroadcastFileData 的方式）：
//   - 优点：所有成员同时接收，慢接收方不影响快接收方。
//     最坏情况延迟 = 单个最慢成员的超时时间（5s），而非所有超时之和。
//   - 缺点：每次调用创建 N-1 个 goroutine（N = 房间成员数）。
//     但 Go goroutine 初始栈仅 2KB，MaxMembers=50 时最多 49 个短生命周期 goroutine，
//     对 Go runtime 来说是轻量级的。
//
// 为什么不用 Worker Pool？
//
//	MaxMembers=50，每个 chunk 最多创建 49 个 goroutine，每个最多存活 5s。
//	Go runtime 轻松处理数千个 goroutine，49 个完全不需要池化。
//	如果未来 MaxMembers 增大到数百，可以引入 worker pool 限制并发数。
//
// 参数：
//   - excludeID: 要排除的成员 ID（通常是发送方自己）
//   - data: 要发送的文件传输数据（已编码的 msgpack 字节）
//
// 线程安全：可从任意 goroutine 调用。内部使用 RLock 读取成员列表快照，
// 然后释放锁后并发发送，避免在持锁期间执行可能阻塞的操作。
func (r *Room) BroadcastFileData(excludeID string, data []byte) {
	// 📚 学习要点: 先快照再发送（Copy-then-Send 模式）
	// 为什么不在持有 RLock 的情况下直接发送？
	// 因为 SendFileFunc 可能阻塞最多 5s（等待 send channel 有空间）。
	// 如果在持锁期间阻塞，其他需要写锁的操作（如 AddMember、RemoveMember）
	// 会被阻塞，导致新成员无法加入或离开房间。
	// 所以先复制成员列表（快照），释放锁后再并发发送。
	r.mu.RLock()
	members := make([]*Member, 0, len(r.members))
	for _, m := range r.members {
		if m.ID != excludeID {
			members = append(members, m)
		}
	}
	r.mu.RUnlock()

	// 📚 学习要点: sync.WaitGroup 的使用模式
	// WaitGroup 是 Go 中等待一组 goroutine 完成的标准原语。
	// 模式：Add(1) → go func() { defer Done(); ... }(arg) → Wait()
	//
	// 为什么 Wait() 是必要的？
	// BroadcastFileData 的调用方（Hub handler）需要知道所有发送操作已完成，
	// 才能安全地处理下一个 chunk。如果不等待，可能出现：
	// - 前一个 chunk 的发送还在进行中，下一个 chunk 又开始发送
	// - 在高负载下导致 goroutine 数量失控
	// Wait() 确保每次 BroadcastFileData 调用是「同步完成」的语义，
	// 但内部的并发发送保证了最大延迟 = max(单个成员发送时间) 而非 sum。
	var wg sync.WaitGroup
	for _, m := range members {
		if m.SendFileFunc == nil {
			continue
		}
		wg.Add(1)
		go func(member *Member) {
			defer wg.Done()
			// SendFileFunc 带 5s 超时：成功返回 true，超时返回 false。
			// 超时意味着该接收方的 send buffer 持续满了 5s，
			// 认为该接收方网络过慢或已实质断线，记录警告但不影响其他成员。
			if !member.SendFileFunc(data) {
				logger.Warn("Room", "file data send timeout for member %s in room %s", member.ID, r.ID)
			}
		}(m)
	}
	wg.Wait() // 等待所有发送完成（最多 5s，取决于最慢的成员）
}
