// room_property_test.go — Room 过期属性测试
//
// 本文件使用 pgregory.net/rapid 进行属性测试（Property-Based Testing），
// 验证 Room.IsExpired、Room.GetExpiresAt、RoomManager.GetExpiredRooms 的正确性。
//
// 📚 学习要点: 属性测试 vs 示例测试
// 属性测试不预设具体输入/输出，而是验证「对于所有合法输入，某个属性恒成立」。
// 例如：对于任意 expiry > 0，expiresAt 应等于 now + expiry（在合法范围内）。
// rapid 库会自动生成大量随机输入来尝试找到反例。
//
// Feature: qr-share-and-room-expiry, Property 3: ExpiresAt computation
// Feature: qr-share-and-room-expiry, Property 4: Expiry checker correctness
// Feature: qr-share-and-room-expiry, Property 8: Empty room destruction invariant
// Feature: qr-share-and-room-expiry, Property 9: Expiry input sanitization
package room

import (
	"testing"

	"pgregory.net/rapid"
)

// -----------------------------------------------------------------------
// Property 3: ExpiresAt computation
// -----------------------------------------------------------------------
//
// 属性定义：
// 给定合法的 expiry（1 到 MaxExpiryDuration），expiresAt 应等于 now + expiry。
// 验证 GetExpiresAt() 返回值与创建时传入的 expiresAt 一致，
// 且 IsExpired 在 expiresAt 之前返回 false，之后返回 true。
//
// **Validates: Requirements 5.1, 5.2**

// TestProperty3_ExpiresAtComputation_PositiveExpiry 验证正数 expiry 产生正确的 expiresAt。
//
// 测试策略：模拟 hub.go 的计算逻辑：expiresAt = now + expiry（当 expiry > 0）。
// 验证 NewRoom 创建后 GetExpiresAt() 返回正确值。
// 验证 IsExpired 在 expiresAt 之前返回 false，之后返回 true。
func TestProperty3_ExpiresAtComputation_PositiveExpiry(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成合法的 expiry（1 到 MaxExpiryDuration）
		expiry := rapid.Int64Range(1, MaxExpiryDuration).Draw(t, "expiry")

		// 模拟当前时间（Unix 秒）
		now := rapid.Int64Range(1_000_000_000, 2_000_000_000).Draw(t, "now")

		// 计算 expiresAt（模拟 handleCreateRoom 的逻辑）
		expiresAt := now + expiry

		// 创建房间
		room := NewRoom("test-room-id-21chars", "", 0, expiresAt)

		// 验证 GetExpiresAt() 返回正确值（now + expiry）
		if room.GetExpiresAt() != expiresAt {
			t.Fatalf("ExpiresAt mismatch: got %d, want %d (now=%d, expiry=%d)",
				room.GetExpiresAt(), expiresAt, now, expiry)
		}

		// 验证过期前：IsExpired 应返回 false
		beforeExpiry := expiresAt - 1
		if room.IsExpired(beforeExpiry) {
			t.Fatalf("IsExpired should be false at time %d (expiresAt=%d)",
				beforeExpiry, expiresAt)
		}

		// 验证过期后：IsExpired 应返回 true
		afterExpiry := expiresAt + 1
		if !room.IsExpired(afterExpiry) {
			t.Fatalf("IsExpired should be true at time %d (expiresAt=%d)",
				afterExpiry, expiresAt)
		}
	})
}

// TestProperty3_ExpiresAtComputation_ZeroExpiry 验证 expiry=0 时 expiresAt=0。
// 即永不过期的房间，IsExpired 对任何时间点都返回 false。
func TestProperty3_ExpiresAtComputation_ZeroExpiry(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// expiresAt = 0 表示永不过期
		room := NewRoom("test-room-id-21chars", "", 0, 0)

		if room.GetExpiresAt() != 0 {
			t.Fatalf("ExpiresAt should be 0 for no-expiry room, got %d", room.GetExpiresAt())
		}

		// 对任意时间点，IsExpired 都应返回 false
		anyTime := rapid.Int64Range(0, 9_999_999_999).Draw(t, "anyTime")
		if room.IsExpired(anyTime) {
			t.Fatalf("IsExpired should always be false for expiresAt=0, but returned true at time %d",
				anyTime)
		}
	})
}

// TestProperty3_ExpiresAtComputation_BoundaryExact 验证 now == expiresAt 时
// IsExpired 返回 false（严格大于才过期，即 now > expiresAt 才为 true）。
//
// 测试策略：验证边界条件的精确行为。
// IsExpired 使用 now > expiresAt（严格大于），所以 now == expiresAt 时不过期。
func TestProperty3_ExpiresAtComputation_BoundaryExact(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		expiresAt := rapid.Int64Range(1, 2_000_000_000).Draw(t, "expiresAt")
		room := NewRoom("test-room-id-21chars", "", 0, expiresAt)

		// now == expiresAt: 不应过期（严格大于才过期）
		if room.IsExpired(expiresAt) {
			t.Fatalf("IsExpired should be false when now == expiresAt (%d)", expiresAt)
		}
	})
}

// -----------------------------------------------------------------------
// Property 4: Expiry checker correctness
// -----------------------------------------------------------------------
//
// 属性定义：
// 对于任意房间集合，GetExpiredRooms(T) 应返回所有 expiresAt > 0 && T > expiresAt 的房间。
// 满足条件的房间必须在列表中，不满足条件的房间不应在列表中。
//
// **Validates: Requirements 6.2, 6.5**

// TestProperty4_ExpiryCheckerCorrectness 验证 GetExpiredRooms 的正确性/完整性。
//
// 测试策略：创建多个房间（混合过期/未过期/永不过期），
// 调用 GetExpiredRooms，验证返回的 ID 集合与预期完全一致。
func TestProperty4_ExpiryCheckerCorrectness(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		rm := NewRoomManager()

		// 生成 1-20 个房间
		roomCount := rapid.IntRange(1, 20).Draw(t, "roomCount")

		// 扫描时间
		scanTime := rapid.Int64Range(1_000_000_000, 2_000_000_000).Draw(t, "scanTime")

		// 记录预期过期的房间 ID
		expectedExpired := make(map[string]bool)

		for i := 0; i < roomCount; i++ {
			roomID := rapid.StringMatching(`[a-zA-Z0-9_-]{21}`).Draw(t, "roomID")

			// 生成 expiresAt：0=永不过期，<scanTime=已过期，>=scanTime=未过期
			expiryType := rapid.IntRange(0, 2).Draw(t, "expiryType")
			var expiresAt int64

			switch expiryType {
			case 0:
				// 永不过期
				expiresAt = 0
			case 1:
				// 已过期：expiresAt < scanTime
				expiresAt = rapid.Int64Range(1, scanTime-1).Draw(t, "expiredAt")
				expectedExpired[roomID] = true
			case 2:
				// 未过期：expiresAt >= scanTime
				expiresAt = rapid.Int64Range(scanTime, scanTime+MaxExpiryDuration).Draw(t, "futureAt")
			}

			rm.CreateRoom(roomID, "", 0, expiresAt)
		}

		// 调用 GetExpiredRooms
		expired := rm.GetExpiredRooms(scanTime)

		// 转换为 map 方便查找
		gotExpired := make(map[string]bool)
		for _, id := range expired {
			gotExpired[id] = true
		}

		// 验证所有预期过期的房间都在列表中
		for id := range expectedExpired {
			if !gotExpired[id] {
				t.Errorf("expected room %q to be in expired list, but it was not", id)
			}
		}

		// 验证列表中没有不应过期的房间
		for _, id := range expired {
			if !expectedExpired[id] {
				t.Errorf("room %q should not be in expired list, but it was", id)
			}
		}
	})
}

// -----------------------------------------------------------------------
// Property 8: Empty room destruction invariant
// -----------------------------------------------------------------------
//
// 属性定义：
// 对于任意房间，当所有成员离开后（MemberCount == 0），
// 调用 RemoveRoom 后 RoomManager 中不再包含该房间。
// 验证「所有成员离开 → 房间被销毁」的不变量。
//
// **Validates: Requirements 5.3**

// TestProperty8_EmptyRoomDestructionInvariant 验证空房间销毁不变量。
//
// 测试策略：创建房间 → 添加随机数量成员 → 逐一移除 → 验证房间被销毁。
// 这是一个 Invariant Test（不变量测试）：
// 无论成员数量如何变化，最终结果（空房间被销毁）始终成立。
func TestProperty8_EmptyRoomDestructionInvariant(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		rm := NewRoomManager()

		// 随机 expiresAt（0=永不过期，>0=有过期时间）
		expiresAt := rapid.Int64Range(0, 2_000_000_000).Draw(t, "expiresAt")

		roomID := rapid.StringMatching(`[a-zA-Z0-9_-]{21}`).Draw(t, "roomID")
		room := rm.CreateRoom(roomID, "", 0, expiresAt)

		// 添加 1-10 个成员
		memberCount := rapid.IntRange(1, 10).Draw(t, "memberCount")
		memberIDs := make([]string, memberCount)
		for i := 0; i < memberCount; i++ {
			memberIDs[i] = rapid.StringMatching(`[a-z]{8}`).Draw(t, "memberID")
			room.AddMember(&Member{
				ID:   memberIDs[i],
				Name: "User",
			})
		}

		// 验证房间存在
		if rm.GetRoom(roomID) == nil {
			t.Fatal("room should exist after creation")
		}
		if room.MemberCount() != memberCount {
			t.Fatalf("expected %d members, got %d", memberCount, room.MemberCount())
		}

		// 逐一移除所有成员
		for _, id := range memberIDs {
			room.RemoveMember(id)
		}

		// 验证成员数为 0
		if room.MemberCount() != 0 {
			t.Fatalf("expected 0 members after removing all, got %d", room.MemberCount())
		}

		// 模拟 hub.go 的逻辑：成员为 0 时调用 RemoveRoom
		rm.RemoveRoom(roomID)

		// 验证房间已从 RoomManager 中移除
		if rm.GetRoom(roomID) != nil {
			t.Fatal("room should be destroyed after all members leave and RemoveRoom is called")
		}
		if rm.RoomCount() != 0 {
			t.Fatalf("expected 0 rooms, got %d", rm.RoomCount())
		}
	})
}

// -----------------------------------------------------------------------
// Property 9: Expiry input sanitization
// -----------------------------------------------------------------------
//
// 属性定义：
// - 若 expiry < 0，sanitizeExpiry 应返回 expiresAt=0（视为永不过期）。
// - 若 expiry > MaxExpiryDuration，应截断为 MaxExpiryDuration，expiresAt = now + MaxExpiryDuration。
// - 若 0 <= expiry <= MaxExpiryDuration，expiresAt 应在合法范围内。
//
// 测试策略：模拟 hub.go 中的 expiry 清洗逻辑，验证边界处理正确。
// 这些测试验证防御性输入清洗（Defensive Input Sanitization）的正确性。
// 客户端可能发送任意 expiry 值（bug、恶意行为），服务器必须做边界检查。
//
// **Validates: NFR-7 (security), defensive design**

// sanitizeExpiry 模拟 hub.go 中的 expiry 清洗逻辑。
// 这是一个纯函数，方便属性测试验证。
//
// 规则：
// - expiry < 0 → 返回 0（永不过期）
// - expiry > MaxExpiryDuration → 截断为 MaxExpiryDuration
// - expiry > 0 → 返回 now + expiry
// - expiry == 0 → 返回 0（永不过期）
func sanitizeExpiry(expiry int64, now int64) int64 {
	if expiry < 0 {
		return 0
	}
	if expiry > MaxExpiryDuration {
		expiry = MaxExpiryDuration
	}
	if expiry > 0 {
		return now + expiry
	}
	return 0
}

// TestProperty9_ExpirySanitization_NegativeToZero 验证负数 expiry 被清洗为 expiresAt=0。
func TestProperty9_ExpirySanitization_NegativeToZero(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成负数 expiry
		expiry := rapid.Int64Range(-1_000_000, -1).Draw(t, "negativeExpiry")
		now := rapid.Int64Range(1_000_000_000, 2_000_000_000).Draw(t, "now")

		expiresAt := sanitizeExpiry(expiry, now)

		if expiresAt != 0 {
			t.Fatalf("negative expiry %d should produce expiresAt=0, got %d", expiry, expiresAt)
		}

		// 验证创建的房间永不过期
		room := NewRoom("test-room-id-21chars", "", 0, expiresAt)
		anyFutureTime := rapid.Int64Range(now, now+MaxExpiryDuration*10).Draw(t, "futureTime")
		if room.IsExpired(anyFutureTime) {
			t.Fatalf("room with expiresAt=0 should never expire, but IsExpired(%d)=true", anyFutureTime)
		}
	})
}

// TestProperty9_ExpirySanitization_LargeValueTruncated 验证超大 expiry 被截断为 MaxExpiryDuration。
func TestProperty9_ExpirySanitization_LargeValueTruncated(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成超过 MaxExpiryDuration 的 expiry
		expiry := rapid.Int64Range(MaxExpiryDuration+1, MaxExpiryDuration*10).Draw(t, "largeExpiry")
		now := rapid.Int64Range(1_000_000_000, 2_000_000_000).Draw(t, "now")

		expiresAt := sanitizeExpiry(expiry, now)
		expectedExpiresAt := now + MaxExpiryDuration

		if expiresAt != expectedExpiresAt {
			t.Fatalf("expiry %d should be truncated to MaxExpiryDuration: expected expiresAt=%d, got %d",
				expiry, expectedExpiresAt, expiresAt)
		}

		// 验证房间在 now + MaxExpiryDuration 之前不过期
		room := NewRoom("test-room-id-21chars", "", 0, expiresAt)
		if room.IsExpired(now + MaxExpiryDuration - 1) {
			t.Fatal("room should not be expired before truncated expiresAt")
		}
		// 验证房间在 now + MaxExpiryDuration + 1 之后过期
		if !room.IsExpired(now + MaxExpiryDuration + 1) {
			t.Fatal("room should be expired after truncated expiresAt")
		}
	})
}

// TestProperty9_ExpirySanitization_ValidRange 验证合法范围内的 expiry 产生正确的 expiresAt。
func TestProperty9_ExpirySanitization_ValidRange(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成合法范围内的 expiry
		expiry := rapid.Int64Range(1, MaxExpiryDuration).Draw(t, "validExpiry")
		now := rapid.Int64Range(1_000_000_000, 2_000_000_000).Draw(t, "now")

		expiresAt := sanitizeExpiry(expiry, now)
		expectedExpiresAt := now + expiry

		if expiresAt != expectedExpiresAt {
			t.Fatalf("valid expiry %d should produce expiresAt=%d, got %d",
				expiry, expectedExpiresAt, expiresAt)
		}

		// 验证房间在正确时间过期
		room := NewRoom("test-room-id-21chars", "", 0, expiresAt)
		if room.IsExpired(now + expiry - 1) {
			t.Fatal("room should not be expired before expiresAt")
		}
		if !room.IsExpired(now + expiry + 1) {
			t.Fatal("room should be expired after expiresAt")
		}
	})
}

// TestProperty9_ExpirySanitization_ZeroPassthrough 验证 expiry=0 直接产生 expiresAt=0。
func TestProperty9_ExpirySanitization_ZeroPassthrough(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		now := rapid.Int64Range(1_000_000_000, 2_000_000_000).Draw(t, "now")

		expiresAt := sanitizeExpiry(0, now)

		if expiresAt != 0 {
			t.Fatalf("expiry=0 should produce expiresAt=0, got %d", expiresAt)
		}

		// 验证创建的房间永不过期
		room := NewRoom("test-room-id-21chars", "", 0, expiresAt)
		anyFutureTime := rapid.Int64Range(now, now+MaxExpiryDuration*10).Draw(t, "futureTime")
		if room.IsExpired(anyFutureTime) {
			t.Fatalf("room with expiresAt=0 should never expire, but IsExpired(%d)=true", anyFutureTime)
		}
	})
}
