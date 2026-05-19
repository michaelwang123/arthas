package ui

import (
	"strings"
	"testing"
)

func TestValidateDisplayName_Empty(t *testing.T) {
	err := ValidateDisplayName("")
	if err != ErrNameEmpty {
		t.Errorf("expected ErrNameEmpty, got %v", err)
	}
}

func TestValidateDisplayName_Valid(t *testing.T) {
	cases := []string{
		"A",                     // 1 rune (minimum)
		"Alice",                 // 5 ASCII runes
		"你好世界",                  // 4 CJK runes
		strings.Repeat("a", 20), // exactly 20 runes (maximum)
		"🎉🎊🎈",                   // 3 emoji runes
	}
	for _, name := range cases {
		if err := ValidateDisplayName(name); err != nil {
			t.Errorf("ValidateDisplayName(%q) = %v, want nil", name, err)
		}
	}
}

func TestValidateDisplayName_TooLong(t *testing.T) {
	cases := []string{
		strings.Repeat("a", 21), // 21 ASCII runes
		strings.Repeat("中", 21), // 21 CJK runes (63 bytes but 21 runes)
		"abcdefghijklmnopqrstu", // 21 chars
	}
	for _, name := range cases {
		err := ValidateDisplayName(name)
		if err != ErrNameTooLong {
			t.Errorf("ValidateDisplayName(%q) = %v, want ErrNameTooLong", name, err)
		}
	}
}

func TestValidateMessageLength_Valid(t *testing.T) {
	cases := []string{
		"hi",                     // short message
		strings.Repeat("x", 500), // exactly 500 runes (maximum)
		strings.Repeat("中", 500), // 500 CJK runes
	}
	for _, text := range cases {
		if err := ValidateMessageLength(text); err != nil {
			t.Errorf("ValidateMessageLength(len=%d runes) = %v, want nil", len([]rune(text)), err)
		}
	}
}

func TestValidateMessageLength_TooLong(t *testing.T) {
	cases := []string{
		strings.Repeat("x", 501), // 501 ASCII runes
		strings.Repeat("中", 501), // 501 CJK runes
	}
	for _, text := range cases {
		err := ValidateMessageLength(text)
		if err != ErrMessageTooLong {
			t.Errorf("ValidateMessageLength(len=%d runes) = %v, want ErrMessageTooLong", len([]rune(text)), err)
		}
	}
}
