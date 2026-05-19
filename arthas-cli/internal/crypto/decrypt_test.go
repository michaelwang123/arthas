package crypto

import (
	"encoding/base64"
	"testing"
)

func TestDecrypt_RoundTripWithEncrypt(t *testing.T) {
	key, err := GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey() error: %v", err)
	}

	plaintext := []byte(`{"text":"Hello, 世界! 🎉"}`)
	ivB64, ctB64, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt() error: %v", err)
	}

	decrypted, err := Decrypt(key, ivB64, ctB64)
	if err != nil {
		t.Fatalf("Decrypt() error: %v", err)
	}

	if string(decrypted) != string(plaintext) {
		t.Errorf("Decrypt() = %q, want %q", decrypted, plaintext)
	}
}

func TestDecrypt_FailsWithWrongKey(t *testing.T) {
	key, _ := GenerateRoomKey()
	wrongKey, _ := GenerateRoomKey()

	plaintext := []byte("secret message")
	ivB64, ctB64, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt() error: %v", err)
	}

	_, err = Decrypt(wrongKey, ivB64, ctB64)
	if err == nil {
		t.Fatal("Decrypt() with wrong key should return error, got nil")
	}
}

func TestDecrypt_FailsWithTamperedCiphertext(t *testing.T) {
	key, _ := GenerateRoomKey()

	plaintext := []byte("secret message")
	ivB64, ctB64, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt() error: %v", err)
	}

	// Tamper with ciphertext by decoding, flipping a byte, and re-encoding
	ctBytes, _ := base64.RawURLEncoding.DecodeString(ctB64)
	ctBytes[0] ^= 0xFF
	tamperedCtB64 := base64.RawURLEncoding.EncodeToString(ctBytes)

	_, err = Decrypt(key, ivB64, tamperedCtB64)
	if err == nil {
		t.Fatal("Decrypt() with tampered ciphertext should return error, got nil")
	}
}

func TestDecrypt_FailsWithInvalidBase64IV(t *testing.T) {
	key, _ := GenerateRoomKey()

	_, err := Decrypt(key, "!!!invalid-base64!!!", "validbase64data")
	if err == nil {
		t.Fatal("Decrypt() with invalid base64 IV should return error, got nil")
	}
}

func TestDecrypt_FailsWithInvalidBase64Ciphertext(t *testing.T) {
	key, _ := GenerateRoomKey()

	// Valid base64url IV (12 bytes → 16 chars)
	validIV := base64.RawURLEncoding.EncodeToString(make([]byte, 12))

	_, err := Decrypt(key, validIV, "!!!invalid-base64!!!")
	if err == nil {
		t.Fatal("Decrypt() with invalid base64 ciphertext should return error, got nil")
	}
}

func TestDecrypt_FailsWithTamperedIV(t *testing.T) {
	key, _ := GenerateRoomKey()

	plaintext := []byte("secret message")
	ivB64, ctB64, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt() error: %v", err)
	}

	// Tamper with IV
	ivBytes, _ := base64.RawURLEncoding.DecodeString(ivB64)
	ivBytes[0] ^= 0xFF
	tamperedIVB64 := base64.RawURLEncoding.EncodeToString(ivBytes)

	_, err = Decrypt(key, tamperedIVB64, ctB64)
	if err == nil {
		t.Fatal("Decrypt() with tampered IV should return error, got nil")
	}
}

func TestDecrypt_EmptyPlaintext(t *testing.T) {
	key, _ := GenerateRoomKey()

	plaintext := []byte("")
	ivB64, ctB64, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt() error: %v", err)
	}

	decrypted, err := Decrypt(key, ivB64, ctB64)
	if err != nil {
		t.Fatalf("Decrypt() error: %v", err)
	}

	if string(decrypted) != "" {
		t.Errorf("Decrypt() = %q, want empty string", decrypted)
	}
}
