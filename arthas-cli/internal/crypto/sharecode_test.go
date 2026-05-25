package crypto

import (
	"encoding/base64"
	"strings"
	"testing"
)

// TestParseShareCode_ValidTwoSegment 验证两段格式（非临时）的分享码解析。
func TestParseShareCode_ValidTwoSegment(t *testing.T) {
	// 构造一个合法的分享码：21 字符 roomID + 43 字符 base64url key
	roomID := "abcdefghijklmnopqrstu" // 21 chars
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	keyEncoded := base64.RawURLEncoding.EncodeToString(key)
	code := roomID + ":" + keyEncoded

	sc, err := ParseShareCode(code)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sc.RoomID != roomID {
		t.Errorf("RoomID = %q, want %q", sc.RoomID, roomID)
	}
	if len(sc.KeyBytes) != 32 {
		t.Errorf("KeyBytes length = %d, want 32", len(sc.KeyBytes))
	}
	for i, b := range sc.KeyBytes {
		if b != byte(i) {
			t.Errorf("KeyBytes[%d] = %d, want %d", i, b, i)
			break
		}
	}
	if sc.Ephemeral != 0 {
		t.Errorf("Ephemeral = %d, want 0", sc.Ephemeral)
	}
}

// TestParseShareCode_ValidThreeSegment 验证三段格式（临时模式）的分享码解析。
func TestParseShareCode_ValidThreeSegment(t *testing.T) {
	roomID := "ABCDEFGHIJ1234567890x" // 21 chars
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(255 - i)
	}
	keyEncoded := base64.RawURLEncoding.EncodeToString(key)
	code := roomID + ":" + keyEncoded + ":3600"

	sc, err := ParseShareCode(code)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sc.RoomID != roomID {
		t.Errorf("RoomID = %q, want %q", sc.RoomID, roomID)
	}
	if sc.Ephemeral != 3600 {
		t.Errorf("Ephemeral = %d, want 3600", sc.Ephemeral)
	}
	if sc.ExpiresAt != 0 {
		t.Errorf("ExpiresAt = %d, want 0", sc.ExpiresAt)
	}
}

// TestParseShareCode_ValidFourSegment 验证四段格式（含过期时间戳）的分享码解析。
func TestParseShareCode_ValidFourSegment(t *testing.T) {
	roomID := "ABCDEFGHIJ1234567890x" // 21 chars
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(255 - i)
	}
	keyEncoded := base64.RawURLEncoding.EncodeToString(key)
	code := roomID + ":" + keyEncoded + ":3600:1700000000"

	sc, err := ParseShareCode(code)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sc.RoomID != roomID {
		t.Errorf("RoomID = %q, want %q", sc.RoomID, roomID)
	}
	if sc.Ephemeral != 3600 {
		t.Errorf("Ephemeral = %d, want 3600", sc.Ephemeral)
	}
	if sc.ExpiresAt != 1700000000 {
		t.Errorf("ExpiresAt = %d, want 1700000000", sc.ExpiresAt)
	}
}

// TestParseShareCode_ValidFourSegment_ZeroEphemeral 验证四段格式中 ephemeral=0 的情况。
func TestParseShareCode_ValidFourSegment_ZeroEphemeral(t *testing.T) {
	roomID := "ABCDEFGHIJ1234567890x" // 21 chars
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 100)
	}
	keyEncoded := base64.RawURLEncoding.EncodeToString(key)
	code := roomID + ":" + keyEncoded + ":0:1700000000"

	sc, err := ParseShareCode(code)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if sc.Ephemeral != 0 {
		t.Errorf("Ephemeral = %d, want 0", sc.Ephemeral)
	}
	if sc.ExpiresAt != 1700000000 {
		t.Errorf("ExpiresAt = %d, want 1700000000", sc.ExpiresAt)
	}
}

// TestParseShareCode_InvalidFormats 验证各种无效格式被正确拒绝。
func TestParseShareCode_InvalidFormats(t *testing.T) {
	tests := []struct {
		name string
		code string
		want string // 期望错误消息包含的子串
	}{
		{
			name: "empty string",
			code: "",
			want: "expected format",
		},
		{
			name: "single segment",
			code: "abcdefghijklmnopqrstu",
			want: "expected format",
		},
		{
			name: "room ID too short",
			code: "short:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			want: "room ID must be 21 characters",
		},
		{
			name: "room ID too long",
			code: "abcdefghijklmnopqrstuvwxyz:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			want: "room ID must be 21 characters",
		},
		{
			name: "key segment too short",
			code: "abcdefghijklmnopqrstu:short",
			want: "key segment must be 43 characters",
		},
		{
			name: "key segment too long",
			code: "abcdefghijklmnopqrstu:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			want: "key segment must be 43 characters",
		},
		{
			name: "invalid base64url in key",
			code: "abcdefghijklmnopqrstu:!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!", // 43 chars but invalid
			want: "invalid share code",
		},
		{
			name: "too many segments (5)",
			code: "abcdefghijklmnopqrstu:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:100:200:extra",
			want: "expected format",
		},
		{
			name: "ephemeral not a number",
			code: "abcdefghijklmnopqrstu:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:abc",
			want: "ephemeral must be a valid integer",
		},
		{
			name: "ephemeral negative",
			code: "abcdefghijklmnopqrstu:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:-1",
			want: "ephemeral must be non-negative",
		},
		{
			name: "expiresAt not a number",
			code: "abcdefghijklmnopqrstu:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0:abc",
			want: "expiresAt must be a valid integer",
		},
		{
			name: "expiresAt negative",
			code: "abcdefghijklmnopqrstu:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0:-100",
			want: "expiresAt must be non-negative",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseShareCode(tt.code)
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Errorf("error = %q, want substring %q", err.Error(), tt.want)
			}
		})
	}
}

// TestBuildShareCode_NonEphemeral 验证非临时模式的分享码构建（两段格式）。
func TestBuildShareCode_NonEphemeral(t *testing.T) {
	roomID := "abcdefghijklmnopqrstu"
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}

	code := BuildShareCode(roomID, key, 0, 0)

	// 应该只有两段（无 ephemeral 后缀）
	parts := strings.Split(code, ":")
	if len(parts) != 2 {
		t.Errorf("expected 2 segments, got %d: %q", len(parts), code)
	}
	if parts[0] != roomID {
		t.Errorf("roomID segment = %q, want %q", parts[0], roomID)
	}
}

// TestBuildShareCode_Ephemeral 验证临时模式的分享码构建（三段格式）。
func TestBuildShareCode_Ephemeral(t *testing.T) {
	roomID := "abcdefghijklmnopqrstu"
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}

	code := BuildShareCode(roomID, key, 7200, 0)

	parts := strings.Split(code, ":")
	if len(parts) != 3 {
		t.Errorf("expected 3 segments, got %d: %q", len(parts), code)
	}
	if parts[2] != "7200" {
		t.Errorf("ephemeral segment = %q, want %q", parts[2], "7200")
	}
}

// TestShareCode_RoundTrip 验证 Build → Parse 往返一致性。
func TestShareCode_RoundTrip(t *testing.T) {
	roomID := "TestRoomID_1234567abc" // 21 chars
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i * 7 % 256)
	}

	// 非临时模式，无过期
	code := BuildShareCode(roomID, key, 0, 0)
	sc, err := ParseShareCode(code)
	if err != nil {
		t.Fatalf("round-trip parse failed: %v", err)
	}
	if sc.RoomID != roomID {
		t.Errorf("RoomID = %q, want %q", sc.RoomID, roomID)
	}
	if len(sc.KeyBytes) != 32 {
		t.Fatalf("KeyBytes length = %d, want 32", len(sc.KeyBytes))
	}
	for i := range key {
		if sc.KeyBytes[i] != key[i] {
			t.Errorf("KeyBytes[%d] = %d, want %d", i, sc.KeyBytes[i], key[i])
			break
		}
	}
	if sc.Ephemeral != 0 {
		t.Errorf("Ephemeral = %d, want 0", sc.Ephemeral)
	}
	if sc.ExpiresAt != 0 {
		t.Errorf("ExpiresAt = %d, want 0", sc.ExpiresAt)
	}

	// 临时模式，无过期
	code = BuildShareCode(roomID, key, 1800, 0)
	sc, err = ParseShareCode(code)
	if err != nil {
		t.Fatalf("round-trip parse (ephemeral) failed: %v", err)
	}
	if sc.Ephemeral != 1800 {
		t.Errorf("Ephemeral = %d, want 1800", sc.Ephemeral)
	}
	if sc.ExpiresAt != 0 {
		t.Errorf("ExpiresAt = %d, want 0", sc.ExpiresAt)
	}

	// 有过期时间（4 段格式）
	code = BuildShareCode(roomID, key, 3600, 1700000000)
	sc, err = ParseShareCode(code)
	if err != nil {
		t.Fatalf("round-trip parse (expiresAt) failed: %v", err)
	}
	if sc.Ephemeral != 3600 {
		t.Errorf("Ephemeral = %d, want 3600", sc.Ephemeral)
	}
	if sc.ExpiresAt != 1700000000 {
		t.Errorf("ExpiresAt = %d, want 1700000000", sc.ExpiresAt)
	}

	// 有过期时间，ephemeral=0（4 段格式，ephemeral 显式为 0）
	code = BuildShareCode(roomID, key, 0, 1700000000)
	sc, err = ParseShareCode(code)
	if err != nil {
		t.Fatalf("round-trip parse (expiresAt, ephemeral=0) failed: %v", err)
	}
	if sc.Ephemeral != 0 {
		t.Errorf("Ephemeral = %d, want 0", sc.Ephemeral)
	}
	if sc.ExpiresAt != 1700000000 {
		t.Errorf("ExpiresAt = %d, want 1700000000", sc.ExpiresAt)
	}
}
