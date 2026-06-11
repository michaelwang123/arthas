// names_property_test.go — Property-based tests for GenerateMatchName.
//
// Feature: match-ux-polish, Property 1: Name Determinism and Distinctness
//
// Validates: Requirements 1.1, 1.2
//
// Properties verified:
// - Determinism: same (roomId, position) always produces the same name.
// - Distinctness: for any roomId, position 0 and position 1 yield different names.
package match

import (
	"testing"

	"pgregory.net/rapid"
)

// TestProperty_NameDeterminism verifies that GenerateMatchName is a pure function:
// calling it multiple times with the same (roomId, position) always returns
// the same result.
//
// **Validates: Requirements 1.2**
func TestProperty_NameDeterminism(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		roomId := rapid.String().Draw(t, "roomId")
		position := rapid.IntRange(0, 1).Draw(t, "position")

		first := GenerateMatchName(roomId, position)
		second := GenerateMatchName(roomId, position)

		if first != second {
			t.Fatalf("determinism violated: GenerateMatchName(%q, %d) returned %q then %q",
				roomId, position, first, second)
		}
	})
}

// TestProperty_NameDistinctness verifies that for any non-empty roomId,
// the two positions (0 and 1) always produce different names.
// This ensures match participants can be distinguished.
//
// **Validates: Requirements 1.1**
func TestProperty_NameDistinctness(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate non-empty roomId since empty roomId has special fallback behavior
		roomId := rapid.StringMatching(`.+`).Draw(t, "roomId")

		nameA := GenerateMatchName(roomId, 0)
		nameB := GenerateMatchName(roomId, 1)

		if nameA == nameB {
			t.Fatalf("distinctness violated: GenerateMatchName(%q, 0) == GenerateMatchName(%q, 1) == %q",
				roomId, roomId, nameA)
		}
	})
}

// TestProperty_NameDeterminismAndDistinctness combines both properties in a single
// property test: for any roomId, names are deterministic AND distinct across positions.
//
// **Validates: Requirements 1.1, 1.2**
func TestProperty_NameDeterminismAndDistinctness(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		roomId := rapid.StringMatching(`.+`).Draw(t, "roomId")

		// Determinism: calling twice with same args yields same result
		nameA1 := GenerateMatchName(roomId, 0)
		nameA2 := GenerateMatchName(roomId, 0)
		if nameA1 != nameA2 {
			t.Fatalf("determinism violated for position 0: %q != %q (roomId=%q)",
				nameA1, nameA2, roomId)
		}

		nameB1 := GenerateMatchName(roomId, 1)
		nameB2 := GenerateMatchName(roomId, 1)
		if nameB1 != nameB2 {
			t.Fatalf("determinism violated for position 1: %q != %q (roomId=%q)",
				nameB1, nameB2, roomId)
		}

		// Distinctness: position 0 and 1 yield different names
		if nameA1 == nameB1 {
			t.Fatalf("distinctness violated: positions 0 and 1 both returned %q (roomId=%q)",
				nameA1, roomId)
		}
	})
}
