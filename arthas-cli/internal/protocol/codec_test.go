package protocol

import (
	"testing"
)

// TestEncodeDecodeRoundTrip verifies that encoding then decoding a message
// produces equivalent type and data fields.
func TestEncodeDecodeRoundTrip(t *testing.T) {
	original := &Message{
		Type: MsgCreateRoom,
		Data: CreateRoomData{
			Name:      "Alice",
			Password:  "",
			Ephemeral: 0,
		},
	}

	encoded, err := Encode(original)
	if err != nil {
		t.Fatalf("Encode failed: %v", err)
	}

	decoded, err := Decode(encoded)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}

	if decoded.Type != original.Type {
		t.Errorf("Type mismatch: got %d, want %d", decoded.Type, original.Type)
	}

	// Data is decoded as map[string]interface{}
	data, ok := decoded.Data.(map[string]interface{})
	if !ok {
		t.Fatalf("Data is not map[string]interface{}, got %T", decoded.Data)
	}

	if name, ok := data["name"].(string); !ok || name != "Alice" {
		t.Errorf("name mismatch: got %v", data["name"])
	}
	if pw, ok := data["password"].(string); !ok || pw != "" {
		t.Errorf("password mismatch: got %v", data["password"])
	}
	if eph := ToInt(data["ephemeral"]); eph != 0 {
		t.Errorf("ephemeral mismatch: got %d, want 0", eph)
	}
}

// TestToInt verifies that ToInt correctly handles all integer types
// that msgpack may decode into.
func TestToInt(t *testing.T) {
	tests := []struct {
		name string
		val  interface{}
		want int64
	}{
		{"int8 positive", int8(42), 42},
		{"int8 negative", int8(-10), -10},
		{"uint8", uint8(200), 200},
		{"int16", int16(1000), 1000},
		{"uint16", uint16(50000), 50000},
		{"int32", int32(100000), 100000},
		{"uint32", uint32(3000000000), 3000000000},
		{"int64", int64(9000000000000), 9000000000000},
		{"uint64", uint64(18000000000000), 18000000000000},
		{"int", int(12345), 12345},
		{"uint", uint(67890), 67890},
		{"nil returns 0", nil, 0},
		{"string returns 0", "hello", 0},
		{"float64 returns 0", float64(3.14), 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ToInt(tt.val)
			if got != tt.want {
				t.Errorf("ToInt(%v) = %d, want %d", tt.val, got, tt.want)
			}
		})
	}
}

// TestEncodeSendMessage verifies encoding a SendMessage with IV and ciphertext.
func TestEncodeSendMessage(t *testing.T) {
	msg := &Message{
		Type: MsgSendMessage,
		Data: SendMessageData{
			IV:         "dGVzdC1pdi1iYXNl",
			Ciphertext: "ZW5jcnlwdGVkLWRhdGE",
		},
	}

	encoded, err := Encode(msg)
	if err != nil {
		t.Fatalf("Encode failed: %v", err)
	}

	decoded, err := Decode(encoded)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}

	if decoded.Type != MsgSendMessage {
		t.Errorf("Type mismatch: got 0x%02x, want 0x%02x", decoded.Type, MsgSendMessage)
	}

	data := decoded.Data.(map[string]interface{})
	if iv, ok := data["iv"].(string); !ok || iv != "dGVzdC1pdi1iYXNl" {
		t.Errorf("iv mismatch: got %v", data["iv"])
	}
	if ct, ok := data["ciphertext"].(string); !ok || ct != "ZW5jcnlwdGVkLWRhdGE" {
		t.Errorf("ciphertext mismatch: got %v", data["ciphertext"])
	}
}

// TestEncodePong verifies encoding a Pong message with a timestamp.
func TestEncodePong(t *testing.T) {
	msg := &Message{
		Type: MsgPong,
		Data: PongData{T: 1700000000000},
	}

	encoded, err := Encode(msg)
	if err != nil {
		t.Fatalf("Encode failed: %v", err)
	}

	decoded, err := Decode(encoded)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}

	if decoded.Type != MsgPong {
		t.Errorf("Type mismatch: got 0x%02x, want 0x%02x", decoded.Type, MsgPong)
	}

	data := decoded.Data.(map[string]interface{})
	ts := ToInt(data["t"])
	if ts != 1700000000000 {
		t.Errorf("timestamp mismatch: got %d, want 1700000000000", ts)
	}
}

// TestDecodeInvalidData verifies that Decode returns an error for invalid input.
func TestDecodeInvalidData(t *testing.T) {
	_, err := Decode([]byte{0xFF, 0xFE, 0xFD})
	if err == nil {
		t.Error("expected error for invalid msgpack data, got nil")
	}
}
