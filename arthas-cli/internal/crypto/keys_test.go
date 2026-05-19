package crypto

import (
	"encoding/base64"
	"testing"
)

func TestGenerateRoomKey_Returns32Bytes(t *testing.T) {
	key, err := GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey() returned error: %v", err)
	}
	if len(key) != 32 {
		t.Errorf("expected key length 32, got %d", len(key))
	}
}

func TestGenerateRoomKey_ProducesUniqueKeys(t *testing.T) {
	key1, err := GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey() returned error: %v", err)
	}
	key2, err := GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey() returned error: %v", err)
	}
	if string(key1) == string(key2) {
		t.Error("two generated keys should not be identical")
	}
}

func TestExportKeyBase64URL_ProducesCorrectLength(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	encoded := ExportKeyBase64URL(key)
	// 32 bytes → 43 base64url characters (no padding)
	if len(encoded) != 43 {
		t.Errorf("expected encoded length 43, got %d", len(encoded))
	}
}

func TestExportKeyBase64URL_UsesURLSafeCharacters(t *testing.T) {
	// Use bytes that would produce '+' and '/' in standard base64
	key := []byte{0xfb, 0xff, 0xfe, 0xfb, 0xff, 0xfe, 0xfb, 0xff,
		0xfe, 0xfb, 0xff, 0xfe, 0xfb, 0xff, 0xfe, 0xfb,
		0xff, 0xfe, 0xfb, 0xff, 0xfe, 0xfb, 0xff, 0xfe,
		0xfb, 0xff, 0xfe, 0xfb, 0xff, 0xfe, 0xfb, 0xff}
	encoded := ExportKeyBase64URL(key)
	for _, c := range encoded {
		if c == '+' || c == '/' || c == '=' {
			t.Errorf("encoded string contains non-URL-safe character: %c", c)
		}
	}
}

func TestImportKeyBase64URL_RoundTrip(t *testing.T) {
	original, err := GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey() returned error: %v", err)
	}
	encoded := ExportKeyBase64URL(original)
	decoded, err := ImportKeyBase64URL(encoded)
	if err != nil {
		t.Fatalf("ImportKeyBase64URL() returned error: %v", err)
	}
	if string(original) != string(decoded) {
		t.Error("round-trip failed: decoded key does not match original")
	}
}

func TestImportKeyBase64URL_RejectsInvalidBase64(t *testing.T) {
	_, err := ImportKeyBase64URL("not-valid-base64!!!")
	if err == nil {
		t.Error("expected error for invalid base64url input, got nil")
	}
}

func TestImportKeyBase64URL_RejectsWrongLength(t *testing.T) {
	// Encode 16 bytes (too short for AES-256)
	shortKey := make([]byte, 16)
	encoded := base64.RawURLEncoding.EncodeToString(shortKey)
	_, err := ImportKeyBase64URL(encoded)
	if err == nil {
		t.Error("expected error for 16-byte key, got nil")
	}

	// Encode 64 bytes (too long)
	longKey := make([]byte, 64)
	encoded = base64.RawURLEncoding.EncodeToString(longKey)
	_, err = ImportKeyBase64URL(encoded)
	if err == nil {
		t.Error("expected error for 64-byte key, got nil")
	}
}

func TestImportKeyBase64URL_AcceptsExactly32Bytes(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i * 7) // deterministic non-zero pattern
	}
	encoded := base64.RawURLEncoding.EncodeToString(key)
	decoded, err := ImportKeyBase64URL(encoded)
	if err != nil {
		t.Fatalf("ImportKeyBase64URL() returned error: %v", err)
	}
	if len(decoded) != 32 {
		t.Errorf("expected decoded length 32, got %d", len(decoded))
	}
}
