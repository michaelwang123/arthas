package ui

import (
	"fmt"
	"testing"
)

func TestHexToANSI256_ValidColors(t *testing.T) {
	tests := []struct {
		name    string
		hex     string
		wantIdx int // expected ANSI 256-color index
	}{
		{"black", "#000000", 16},                 // r=0, g=0, b=0 → 16 + 0 + 0 + 0
		{"white", "#ffffff", 231},                // r=5, g=5, b=5 → 16 + 180 + 30 + 5
		{"pure red", "#ff0000", 196},             // r=5, g=0, b=0 → 16 + 180 + 0 + 0
		{"pure green", "#00ff00", 46},            // r=0, g=5, b=0 → 16 + 0 + 30 + 0
		{"pure blue", "#0000ff", 21},             // r=0, g=0, b=5 → 16 + 0 + 0 + 5
		{"mid gray", "#808080", 102},             // 0x80=128 → closest to 135 (level 2) → 16 + 72 + 12 + 2
		{"example color #4a7fbf", "#4a7fbf", 67}, // 0x4a=74→1, 0x7f=127→2, 0xbf=191→3 → 16+36+12+3
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := HexToANSI256(tt.hex)
			want := fmt.Sprintf("\033[38;5;%dm", tt.wantIdx)
			if got != want {
				t.Errorf("HexToANSI256(%q) = %q, want %q", tt.hex, got, want)
			}
		})
	}
}

func TestHexToANSI256_InvalidInputs(t *testing.T) {
	tests := []struct {
		name string
		hex  string
		want string // expected output ("" for invalid)
	}{
		{"empty string", "", ""},
		{"too short with hash", "#fff", ""},
		{"too long", "#fffffff", ""},
		{"no hash valid hex", "4a7fbf", "\033[38;5;67m"}, // 6 valid hex chars without # should work
		{"invalid hex chars", "#gggggg", ""},
		{"partial invalid", "#ff00gg", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := HexToANSI256(tt.hex)
			if got != tt.want {
				t.Errorf("HexToANSI256(%q) = %q, want %q", tt.hex, got, tt.want)
			}
		})
	}
}

func TestReset(t *testing.T) {
	got := Reset()
	want := "\033[0m"
	if got != want {
		t.Errorf("Reset() = %q, want %q", got, want)
	}
}

func TestColorToAnsiComponent(t *testing.T) {
	tests := []struct {
		value int
		want  int
	}{
		{0, 0},   // exact match level 0
		{47, 0},  // closer to 0 than 95
		{48, 1},  // closer to 95 than 0
		{95, 1},  // exact match level 1
		{115, 1}, // closer to 95 than 135
		{116, 2}, // closer to 135 than 95
		{135, 2}, // exact match level 2
		{155, 2}, // closer to 135 than 175
		{156, 3}, // closer to 175 than 135
		{175, 3}, // exact match level 3
		{195, 3}, // closer to 175 than 215
		{196, 4}, // closer to 215 than 175
		{215, 4}, // exact match level 4
		{235, 4}, // closer to 215 than 255
		{236, 5}, // closer to 255 than 215
		{255, 5}, // exact match level 5
	}

	for _, tt := range tests {
		got := colorToAnsiComponent(tt.value)
		if got != tt.want {
			t.Errorf("colorToAnsiComponent(%d) = %d, want %d", tt.value, got, tt.want)
		}
	}
}
