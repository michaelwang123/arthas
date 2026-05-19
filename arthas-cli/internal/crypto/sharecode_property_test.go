// sharecode_property_test.go — 分享码属性测试
//
// 本文件使用 pgregory.net/rapid 进行属性测试（Property-Based Testing），
// 验证分享码的 Build → Parse 往返一致性在所有合法输入空间中成立，
// 以及非法输入被正确拒绝。
//
// 📚 学习要点: 为什么需要属性测试？
// 单元测试只验证有限的手工用例，而属性测试通过随机生成大量输入，
// 验证代码在整个输入空间中的正确性。如果存在边界条件 bug
// （如特定字符组合导致解析失败），属性测试更容易发现。
//
// Feature: cli-client, Property 1: Share Code Round-Trip
// Feature: cli-client, Property 6: Invalid Share Code Rejection
package crypto

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"

	"pgregory.net/rapid"
)

// nanoIDAlphabet 定义 NanoID 使用的字符集（与服务器一致）。
// 服务器使用 nanoid 库的默认字母表生成 21 字符的房间 ID。
const nanoIDAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"

// genRoomID 生成一个合法的 21 字符 NanoID 房间标识符。
//
// 📚 学习要点: 为什么使用自定义生成器而非 rapid.String()？
// NanoID 有严格的字符集约束（A-Za-z0-9_-），使用 rapid.String() 会生成
// 包含冒号等非法字符的字符串，导致测试无法验证正确的往返行为。
// 自定义生成器确保输入始终在合法域内。
func genRoomID(t *rapid.T) string {
	result := make([]byte, roomIDLength)
	for i := range result {
		idx := rapid.IntRange(0, len(nanoIDAlphabet)-1).Draw(t, "charIdx")
		result[i] = nanoIDAlphabet[idx]
	}
	return string(result)
}

// TestProperty_ShareCodeRoundTrip 验证分享码的 Build → Parse 往返一致性。
//
// **Validates: Requirements 1.4, 3.1, 3.2, 3.3, 3.4**
//
// 属性定义：
// 对于任意合法的 roomID（21 字符 NanoID 字母表）、任意 32 字节密钥、
// 以及任意非负 ephemeral 值，BuildShareCode 构建的字符串经 ParseShareCode
// 解析后，必须还原出完全相同的 roomID、keyBytes 和 ephemeral。
//
// 📚 学习要点: 往返属性（Round-Trip Property）
// 往返属性是序列化/反序列化代码最基本的正确性保证：
// parse(build(x)) == x 对所有合法 x 成立。
// 如果此属性被违反，说明编码或解码逻辑存在信息丢失或损坏。
func TestProperty_ShareCodeRoundTrip(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成随机但合法的输入
		roomID := genRoomID(t)
		key := genKey(t)
		ephemeral := rapid.IntRange(0, 86400).Draw(t, "ephemeral")

		// Build → Parse 往返
		code := BuildShareCode(roomID, key, ephemeral)
		parsed, err := ParseShareCode(code)

		// 验证解析成功
		if err != nil {
			t.Fatalf("ParseShareCode failed for valid input: %v\n  roomID=%q\n  ephemeral=%d\n  code=%q",
				err, roomID, ephemeral, code)
		}

		// 验证 roomID 还原
		if parsed.RoomID != roomID {
			t.Errorf("RoomID mismatch: got %q, want %q", parsed.RoomID, roomID)
		}

		// 验证 key 还原（逐字节比较）
		if !bytes.Equal(parsed.KeyBytes, key) {
			t.Errorf("KeyBytes mismatch: got %x, want %x", parsed.KeyBytes, key)
		}

		// 验证 ephemeral 还原
		if parsed.Ephemeral != ephemeral {
			t.Errorf("Ephemeral mismatch: got %d, want %d", parsed.Ephemeral, ephemeral)
		}
	})
}

// ---------------------------------------------------------------------------
// Property 6: Invalid Share Code Rejection
// ---------------------------------------------------------------------------
//
// 📚 学习要点: 负面属性测试（Negative Property Testing）
// 正面属性测试验证"合法输入产生正确输出"，
// 负面属性测试验证"非法输入被正确拒绝"。
// 对于安全相关的解析器，负面测试尤为重要——
// 确保畸形输入不会绕过验证、导致 panic 或产生无效状态。

// TestProperty6_InvalidShareCode_WrongRoomIDLength 验证房间 ID 长度不为 21 时，
// ParseShareCode 必须返回错误。
//
// **Validates: Requirements 2.2**
func TestProperty6_InvalidShareCode_WrongRoomIDLength(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成长度不为 21 的房间 ID（0-20 或 22-50）
		length := rapid.OneOf(
			rapid.IntRange(0, 20),
			rapid.IntRange(22, 50),
		).Draw(t, "roomIDLength")

		// NanoID 字符集: A-Za-z0-9_-
		roomID := genStringFromCharset(t, length, nanoIDAlphabet)

		// 使用合法的 43 字符 base64url key 段
		validKey := make([]byte, 32)
		for i := range validKey {
			validKey[i] = byte(i)
		}
		keyEncoded := base64.RawURLEncoding.EncodeToString(validKey)

		code := roomID + ":" + keyEncoded

		_, err := ParseShareCode(code)
		if err == nil {
			t.Fatalf("expected error for room ID length %d, got nil (code=%q)", length, code)
		}
	})
}

// TestProperty6_InvalidShareCode_WrongKeyLength 验证 key 段长度不为 43 时，
// ParseShareCode 必须返回错误。
//
// **Validates: Requirements 2.2**
func TestProperty6_InvalidShareCode_WrongKeyLength(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 合法的 21 字符房间 ID
		roomID := genRoomID(t)

		// 生成长度不为 43 的 key 段（0-42 或 44-80）
		keyLength := rapid.OneOf(
			rapid.IntRange(0, 42),
			rapid.IntRange(44, 80),
		).Draw(t, "keyLength")

		// 使用合法的 base64url 字符
		base64urlChars := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
		keySegment := genStringFromCharset(t, keyLength, base64urlChars)

		code := roomID + ":" + keySegment

		_, err := ParseShareCode(code)
		if err == nil {
			t.Fatalf("expected error for key length %d, got nil (code=%q)", keyLength, code)
		}
	})
}

// TestProperty6_InvalidShareCode_InvalidBase64URLChars 验证 key 段包含非法 base64url 字符时，
// ParseShareCode 必须返回错误。
//
// 📚 学习要点: 为什么单独测试非法字符？
// 即使 key 段长度正确（43 字符），如果包含非 base64url 字符（如 !@#$%），
// base64 解码会失败。此测试确保 ParseShareCode 正确传播解码错误，
// 而非 panic 或返回垃圾数据。
//
// **Validates: Requirements 2.2**
func TestProperty6_InvalidShareCode_InvalidBase64URLChars(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 合法的 21 字符房间 ID
		roomID := genRoomID(t)

		// 非法字符集: 不在 A-Za-z0-9-_ 范围内的字符
		invalidChars := "!@#$%^&*()+=[]{}|;:',.<>?/~` "
		base64urlChars := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

		// 先生成一个合法的 base64url 字符串作为基础（43 字符）
		keyChars := make([]byte, 43)
		for i := range keyChars {
			idx := rapid.IntRange(0, len(base64urlChars)-1).Draw(t, "")
			keyChars[i] = base64urlChars[idx]
		}

		// 在随机位置注入至少一个非法字符
		injectionPos := rapid.IntRange(0, 42).Draw(t, "injectionPos")
		invalidCharIdx := rapid.IntRange(0, len(invalidChars)-1).Draw(t, "invalidCharIdx")
		keyChars[injectionPos] = invalidChars[invalidCharIdx]

		code := roomID + ":" + string(keyChars)

		_, err := ParseShareCode(code)
		if err == nil {
			t.Fatalf("expected error for invalid base64url chars at pos %d, got nil (code=%q)",
				injectionPos, code)
		}
	})
}

// TestProperty6_InvalidShareCode_WrongSegmentCount 验证冒号分隔段数不为 2 或 3 时，
// ParseShareCode 必须返回错误。
//
// 📚 学习要点: 段数验证是解析器的第一道防线
// 分享码格式严格定义为 2 或 3 段（冒号分隔）。
// 段数不对意味着输入根本不是合法的分享码格式，
// 应在任何字段验证之前就被拒绝（fail-fast 原则）。
//
// **Validates: Requirements 2.2**
func TestProperty6_InvalidShareCode_WrongSegmentCount(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成段数为 1（无冒号）或 4+（过多冒号）
		segmentCount := rapid.OneOf(
			rapid.Just(1),
			rapid.IntRange(4, 8),
		).Draw(t, "segmentCount")

		// 使用合法字符生成各段（避免段内包含冒号）
		segments := make([]string, segmentCount)
		for i := range segments {
			segLen := rapid.IntRange(1, 21).Draw(t, "")
			segments[i] = genStringFromCharset(t, segLen, nanoIDAlphabet)
		}

		code := strings.Join(segments, ":")

		_, err := ParseShareCode(code)
		if err == nil {
			t.Fatalf("expected error for %d segments, got nil (code=%q)", segmentCount, code)
		}
	})
}

// genStringFromCharset 从给定字符集中生成指定长度的随机字符串。
//
// 📚 学习要点: 自定义生成器的可组合性
// rapid 库的设计哲学是通过组合简单生成器构建复杂测试数据。
// 这个辅助函数从特定字符集中逐字符生成字符串，
// 确保生成的数据精确匹配我们想要测试的输入空间，
// 避免生成无关的输入（如包含冒号的字符串）干扰测试逻辑。
func genStringFromCharset(t *rapid.T, length int, charset string) string {
	if length == 0 {
		return ""
	}
	chars := make([]byte, length)
	for i := range chars {
		idx := rapid.IntRange(0, len(charset)-1).Draw(t, "")
		chars[i] = charset[idx]
	}
	return string(chars)
}
