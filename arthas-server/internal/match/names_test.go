package match

import (
	"fmt"
	"strings"
	"testing"
)

// TestGenerateMatchName_EmptyRoomId verifies fallback behavior for empty roomId.
func TestGenerateMatchName_EmptyRoomId(t *testing.T) {
	tests := []struct {
		position int
		expected string
	}{
		{0, "Stranger A"},
		{1, "Stranger B"},
	}
	for _, tc := range tests {
		got := GenerateMatchName("", tc.position)
		if got != tc.expected {
			t.Errorf("GenerateMatchName(\"\", %d) = %q, want %q", tc.position, got, tc.expected)
		}
	}
}

// TestGenerateMatchName_InvalidPosition verifies guard clause for out-of-range positions.
func TestGenerateMatchName_InvalidPosition(t *testing.T) {
	positions := []int{-1, -100, 2, 3, 10, 999}
	for _, pos := range positions {
		got := GenerateMatchName("any-room-id", pos)
		if got != "Stranger" {
			t.Errorf("GenerateMatchName(\"any-room-id\", %d) = %q, want \"Stranger\"", pos, got)
		}
	}
}

// TestGenerateMatchName_Determinism verifies same input always produces same output.
func TestGenerateMatchName_Determinism(t *testing.T) {
	roomIds := []string{
		"room-abc123",
		"a",
		"🔑",
		strings.Repeat("x", 1000),
		"uuid-4b3f2a1c-8d7e-4f6a-9c2b-1a5d3e7f8b0c",
	}
	for _, roomId := range roomIds {
		for pos := 0; pos <= 1; pos++ {
			first := GenerateMatchName(roomId, pos)
			second := GenerateMatchName(roomId, pos)
			third := GenerateMatchName(roomId, pos)
			if first != second || second != third {
				t.Errorf("GenerateMatchName(%q, %d) not deterministic: %q, %q, %q",
					roomId, pos, first, second, third)
			}
		}
	}
}

// TestGenerateMatchName_Distinctness verifies position 0 and 1 always differ.
func TestGenerateMatchName_Distinctness(t *testing.T) {
	roomIds := []string{
		"room-1",
		"room-2",
		"a",
		"ab",
		"abc",
		"🎮🎲🎯",
		strings.Repeat("z", 500),
		"uuid-00000000-0000-0000-0000-000000000000",
	}
	for _, roomId := range roomIds {
		nameA := GenerateMatchName(roomId, 0)
		nameB := GenerateMatchName(roomId, 1)
		if nameA == nameB {
			t.Errorf("GenerateMatchName(%q, 0) == GenerateMatchName(%q, 1) == %q (should differ)",
				roomId, roomId, nameA)
		}
	}
}

// TestGenerateMatchName_OutputFormat verifies names match expected emoji+space+word format.
func TestGenerateMatchName_OutputFormat(t *testing.T) {
	roomIds := []string{"test-room-1", "test-room-2", "uuid-xyz"}
	for _, roomId := range roomIds {
		for pos := 0; pos <= 1; pos++ {
			name := GenerateMatchName(roomId, pos)
			// Name should contain at least one space (emoji + space + animal name)
			if !strings.Contains(name, " ") {
				t.Errorf("GenerateMatchName(%q, %d) = %q, expected space-separated format",
					roomId, pos, name)
			}
			// Name should not be empty
			if len(name) == 0 {
				t.Errorf("GenerateMatchName(%q, %d) returned empty string", roomId, pos)
			}
		}
	}
}

// TestGenerateMatchName_AllPairsReachable verifies the hash function can reach all pairs.
// Uses UUID-like room IDs (matching real production input) to check distribution.
func TestGenerateMatchName_AllPairsReachable(t *testing.T) {
	numPairs := len(matchNames) / 2
	seen := make(map[int]bool)

	// Generate diverse room IDs that resemble production UUIDs.
	for i := 0; i < 10000; i++ {
		// Mix different character ranges to simulate UUID-like diversity
		roomId := fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", i*2654435761, i%65536, (i*31)%65536, (i*97)%65536, i*1103515245+12345)
		name := GenerateMatchName(roomId, 0)
		// Find which pair index this name belongs to
		for idx := 0; idx < len(matchNames); idx += 2 {
			if matchNames[idx] == name {
				seen[idx/2] = true
				break
			}
		}
	}

	// With 10000 UUID-like samples across 32 pairs, we should hit all pairs
	// (expected value per bucket = 10000/32 ≈ 312, so hitting all 32 is very likely)
	if len(seen) < numPairs {
		t.Errorf("only %d/%d pairs reached with UUID-like inputs, hash distribution is biased",
			len(seen), numPairs)
	}
}

// TestMatchNames_EvenLength verifies the init() guard at test time too.
func TestMatchNames_EvenLength(t *testing.T) {
	if len(matchNames)%2 != 0 {
		t.Fatalf("matchNames has odd length %d, must be even (pairs)", len(matchNames))
	}
}

// TestMatchNames_NoDuplicates verifies no duplicate names exist in the list.
func TestMatchNames_NoDuplicates(t *testing.T) {
	seen := make(map[string]bool)
	for i, name := range matchNames {
		if seen[name] {
			t.Errorf("duplicate name at index %d: %q", i, name)
		}
		seen[name] = true
	}
}

// TestMatchNames_MinimumSize verifies the list has at least 64 entries (32 pairs).
func TestMatchNames_MinimumSize(t *testing.T) {
	if len(matchNames) < 64 {
		t.Errorf("matchNames has %d entries, minimum required is 64 (32 pairs)", len(matchNames))
	}
}
