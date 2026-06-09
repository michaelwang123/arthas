package room

import (
	"sync"
	"time"
)

// maxExpiryDuration 限制客户端可设置的最大过期时长（7 天，单位：秒）。
// 防止恶意客户端创建超长生命周期的房间耗尽服务器内存。
// 导出为常量供 hub.go 中的输入清洗逻辑使用。
const MaxExpiryDuration int64 = 7 * 24 * 60 * 60 // 604800 seconds

// RoomManager manages the lifecycle of chat rooms.
// It is safe for concurrent use by multiple goroutines.
//
// 📚 学习要点: NowFunc 可注入时间源
// NowFunc 字段允许测试代码替换真实时间源为固定值或可控时间，
// 避免集成测试需要等待真实的 60 秒过期检查间隔。
// 生产环境使用默认值 time.Now().Unix()，测试环境注入自定义函数。
//
// 📚 学习要点: expiringRooms 优化扫描范围
// 维护一个独立的 map 仅包含设置了过期时间的房间（expiresAt > 0）。
// GetExpiredRooms 只遍历此子集而非全部房间，将扫描复杂度从 O(所有房间)
// 降为 O(有过期时间的房间)。对于大多数房间永不过期的场景，这是显著优化。
type RoomManager struct {
	mu    sync.RWMutex
	rooms map[string]*Room

	// expiringRooms 仅包含 expiresAt > 0 的房间 ID → expiresAt 映射。
	// 用于优化 GetExpiredRooms 的扫描范围：只遍历有过期时间的房间子集。
	expiringRooms map[string]int64

	// NowFunc 返回当前 Unix 时间戳（秒）。默认为 time.Now().Unix()。
	// 测试时可替换为固定时间源，避免依赖真实时钟。
	NowFunc func() int64
}

// NewRoomManager creates a new RoomManager with an empty room map.
func NewRoomManager() *RoomManager {
	return &RoomManager{
		rooms:         make(map[string]*Room),
		expiringRooms: make(map[string]int64),
		NowFunc:       func() int64 { return time.Now().Unix() },
	}
}

// CreateRoom creates a new room with the given ID, password hash, ephemeral duration,
// expiration timestamp, and per-room member limit.
// If a room with the same ID already exists, it returns the existing room.
//
// Parameters:
//   - roomId: unique room identifier (NanoID, 21 chars)
//   - passwordHash: SHA-256 hash of room password; empty string means no password
//   - ephemeral: ephemeral message duration in seconds; 0 means disabled
//   - expiresAt: Unix seconds timestamp when the room expires; 0 means no expiration
//   - maxMembers: per-room member limit; 0 means use DefaultMaxMembers (50)
func (rm *RoomManager) CreateRoom(roomId, passwordHash string, ephemeral int, expiresAt int64, maxMembers int) *Room {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if existing, ok := rm.rooms[roomId]; ok {
		return existing
	}

	r := NewRoom(roomId, passwordHash, ephemeral, expiresAt, maxMembers)
	rm.rooms[roomId] = r

	// 📚 学习要点: 维护 expiringRooms 索引
	// 只有设置了过期时间的房间才加入 expiringRooms map。
	// 这使得 GetExpiredRooms 只需遍历有过期时间的房间子集。
	if expiresAt > 0 {
		rm.expiringRooms[roomId] = expiresAt
	}

	return r
}

// GetRoom returns the room with the given ID, or nil if not found.
func (rm *RoomManager) GetRoom(roomId string) *Room {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.rooms[roomId]
}

// RemoveRoom removes the room with the given ID from the manager.
// This should be called when a room has 0 members or when the room expires.
func (rm *RoomManager) RemoveRoom(roomId string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	delete(rm.rooms, roomId)
	delete(rm.expiringRooms, roomId) // 同步清理过期索引
}

// ExtendRoomExpiry updates the expiration timestamp for a room.
// Returns false if the room does not exist.
// Used by match rooms to implement mutual-consent room extension.
func (rm *RoomManager) ExtendRoomExpiry(roomId string, newExpiresAt int64) bool {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	r, ok := rm.rooms[roomId]
	if !ok {
		return false
	}

	r.ExtendExpiry(newExpiresAt)
	if newExpiresAt > 0 {
		rm.expiringRooms[roomId] = newExpiresAt
	}
	return true
}

// RoomCount returns the total number of active rooms.
func (rm *RoomManager) RoomCount() int {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return len(rm.rooms)
}

// GetExpiredRooms returns a list of room IDs that have expired as of the given timestamp.
// Uses RLock to read a snapshot of the expiringRooms index without blocking other readers.
// The returned slice is a snapshot — rooms may be concurrently deleted between
// this call and subsequent operations on the returned IDs.
//
// 📚 学习要点: 优化扫描范围（Indexed Scan）
// 只遍历 expiringRooms map（仅包含 expiresAt > 0 的房间），
// 而非遍历所有房间。对于大多数房间永不过期的场景，
// 扫描集合从 O(所有房间) 缩小为 O(有过期时间的房间)。
// 例如：1000 个房间中只有 50 个设置了过期时间 → 只扫描 50 个。
//
// Parameters:
//   - now: current Unix timestamp in seconds
//
// Returns: slice of room IDs where expiresAt > 0 && now > expiresAt
func (rm *RoomManager) GetExpiredRooms(now int64) []string {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	var expired []string
	for id, expiresAt := range rm.expiringRooms {
		if now > expiresAt {
			expired = append(expired, id)
		}
	}
	return expired
}

// ForEachExpiring 遍历所有设置了过期时间的房间，对每个调用回调函数。
// 使用 RLock 保护遍历过程，回调函数不应执行耗时操作。
//
// 📚 学习要点: 回调遍历模式
// 提供回调遍历而非返回完整列表，让调用方可以在遍历中做条件判断（如跳过已警告的房间），
// 避免不必要的内存分配。回调在 RLock 内执行，因此不应调用需要写锁的方法。
//
// Parameters:
//   - fn: 对每个有过期时间的房间调用，参数为 (roomId, expiresAt)
func (rm *RoomManager) ForEachExpiring(fn func(roomId string, expiresAt int64)) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	for id, expiresAt := range rm.expiringRooms {
		fn(id, expiresAt)
	}
}
