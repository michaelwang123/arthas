package match

import (
	"fmt"
	"testing"
	"time"

	"pgregory.net/rapid"
)

// validTagsList returns the predefined valid tags as a slice (for generator use).
func validTagsList() []string {
	tags := make([]string, 0, len(ValidTags))
	for tag := range ValidTags {
		tags = append(tags, tag)
	}
	return tags
}

// TestProperty_TagBasedMatchingPreference verifies Property 3: Tag-based matching preference.
// For ANY two users A and B in the queue where A and B share at least one Interest_Tag,
// and A has waited less than TagFallbackDelay, A SHALL be paired with B before being paired
// with a user C who shares no tags with A.
//
// Strategy: Enqueue user A with specific tags, user B with overlapping tags, and user C
// with non-overlapping tags. All enqueued recently (within tagFallback). C is enqueued
// before B so FIFO alone would pair A with C. Verify FindMatch picks B over C for A.
//
// **Validates: Requirements 2.1, 2.3**
func TestProperty_TagBasedMatchingPreference(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Valid tags pool for generating test data.
		allTags := validTagsList()

		// Generate 1-3 tags for user A.
		numTagsA := rapid.IntRange(1, 3).Draw(t, "numTagsA")
		tagsAIndices := make(map[int]bool)
		var tagsA []string
		for len(tagsA) < numTagsA {
			idx := rapid.IntRange(0, len(allTags)-1).Draw(t, fmt.Sprintf("tagA_idx_%d", len(tagsA)))
			if !tagsAIndices[idx] {
				tagsAIndices[idx] = true
				tagsA = append(tagsA, allTags[idx])
			}
		}

		// Generate tags for user B that OVERLAP with user A (share at least one tag).
		// Pick at least one tag from tagsA, optionally add others.
		sharedIdx := rapid.IntRange(0, len(tagsA)-1).Draw(t, "sharedTagIdx")
		tagsB := []string{tagsA[sharedIdx]}

		// Optionally add more tags to B (0-2 additional).
		extraBCount := rapid.IntRange(0, 2).Draw(t, "extraBCount")
		tagsBSet := map[string]bool{tagsA[sharedIdx]: true}
		for i := 0; i < extraBCount; i++ {
			idx := rapid.IntRange(0, len(allTags)-1).Draw(t, fmt.Sprintf("tagB_extra_%d", i))
			tag := allTags[idx]
			if !tagsBSet[tag] && len(tagsB) < 3 {
				tagsBSet[tag] = true
				tagsB = append(tagsB, tag)
			}
		}

		// Generate tags for user C that DO NOT overlap with user A.
		// Find tags that are NOT in A's tag set.
		tagsASet := make(map[string]bool)
		for _, tag := range tagsA {
			tagsASet[tag] = true
		}
		var nonOverlappingTags []string
		for _, tag := range allTags {
			if !tagsASet[tag] {
				nonOverlappingTags = append(nonOverlappingTags, tag)
			}
		}

		var tagsC []string
		if len(nonOverlappingTags) > 0 {
			// C gets 1-min(3, available) non-overlapping tags.
			maxC := len(nonOverlappingTags)
			if maxC > 3 {
				maxC = 3
			}
			numTagsC := rapid.IntRange(1, maxC).Draw(t, "numTagsC")
			tagsCSet := make(map[string]bool)
			for len(tagsC) < numTagsC {
				idx := rapid.IntRange(0, len(nonOverlappingTags)-1).Draw(t, fmt.Sprintf("tagC_idx_%d", len(tagsC)))
				tag := nonOverlappingTags[idx]
				if !tagsCSet[tag] {
					tagsCSet[tag] = true
					tagsC = append(tagsC, tag)
				}
			}
		} else {
			// All valid tags are used by A — C gets empty tags (still no overlap).
			tagsC = []string{}
		}

		// Verify the setup: A and B share at least one tag.
		if tagOverlap(tagsA, tagsB) == 0 {
			t.Fatal("test setup error: A and B should share at least one tag")
		}
		// Verify the setup: A and C share NO tags.
		if tagOverlap(tagsA, tagsC) != 0 {
			t.Fatal("test setup error: A and C should share no tags")
		}

		// Create the queue and tracker.
		q := NewMatchQueue(10)
		recentPairs := NewRecentPairsTracker()

		// All users enqueued at the same time (now) — well within tagFallback.
		now := time.Now()
		tagFallback := 10 * time.Second

		// Enqueue A first (earliest in queue).
		entryA := &MatchEntry{
			ClientRef:  newMockClient("user-A"),
			Tags:       tagsA,
			EnqueuedAt: now,
		}
		if err := q.Enqueue(entryA); err != nil {
			t.Fatalf("failed to enqueue A: %v", err)
		}

		// Enqueue C before B — if FIFO were used, C would be preferred.
		// This ensures the property verifies tag preference over FIFO.
		entryC := &MatchEntry{
			ClientRef:  newMockClient("user-C"),
			Tags:       tagsC,
			EnqueuedAt: now,
		}
		if err := q.Enqueue(entryC); err != nil {
			t.Fatalf("failed to enqueue C: %v", err)
		}

		entryB := &MatchEntry{
			ClientRef:  newMockClient("user-B"),
			Tags:       tagsB,
			EnqueuedAt: now,
		}
		if err := q.Enqueue(entryB); err != nil {
			t.Fatalf("failed to enqueue B: %v", err)
		}

		// Execute FindMatch. Since A waited < tagFallback (just enqueued at now),
		// the algorithm should only accept matches with tag overlap > 0.
		// B shares tags with A; C does not. A must be paired with B.
		matchA, matchB := q.FindMatch(recentPairs, now, tagFallback)

		// A match must be found (A and B share tags).
		if matchA == nil || matchB == nil {
			t.Fatal("expected a match to be found when tag-sharing users are in queue")
		}

		// Property: A is paired with B (the tag-sharing user), NOT with C.
		pairedIDs := map[string]bool{
			matchA.ClientRef.GetID(): true,
			matchB.ClientRef.GetID(): true,
		}

		if !pairedIDs["user-A"] {
			t.Fatalf("expected user-A to be in the matched pair, got %q and %q",
				matchA.ClientRef.GetID(), matchB.ClientRef.GetID())
		}
		if !pairedIDs["user-B"] {
			t.Fatalf("tag-based preference violated: user-A should be paired with user-B (shared tags), but got paired with %q and %q",
				matchA.ClientRef.GetID(), matchB.ClientRef.GetID())
		}

		// Additional invariant: C should remain in the queue (not matched).
		if !q.Contains("user-C") {
			t.Fatal("user-C should remain in queue since A was paired with B")
		}
	})
}

// TestProperty_NoSelfMatchOrRecentPartnerRematch verifies Property 5:
// No self-match or recent-partner re-match.
//
// For ANY matching operation, the system SHALL never pair a user with themselves,
// nor with any user recorded in the server-side RecentPairsTracker for that client.
//
// Strategy:
// 1. Generate N random users with unique IDs
// 2. Record some pairs as recent partners in a RecentPairsTracker
// 3. Enqueue all users into the queue
// 4. Call FindAllMatches
// 5. Verify no pair (A, B) where A==B or IsRecentPair(A, B)
//
// **Validates: Requirements 12.5**
func TestProperty_NoSelfMatchOrRecentPartnerRematch(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate between 2 and 30 users.
		numUsers := rapid.IntRange(2, 30).Draw(t, "numUsers")

		// Create unique user IDs.
		userIDs := make([]string, numUsers)
		for i := range numUsers {
			userIDs[i] = fmt.Sprintf("user-%d", i)
		}

		// Create a RecentPairsTracker and record some random recent pairs.
		tracker := NewRecentPairsTracker()
		numRecentPairs := rapid.IntRange(0, numUsers).Draw(t, "numRecentPairs")
		for i := 0; i < numRecentPairs; i++ {
			idxA := rapid.IntRange(0, numUsers-1).Draw(t, fmt.Sprintf("recentA_%d", i))
			idxB := rapid.IntRange(0, numUsers-1).Draw(t, fmt.Sprintf("recentB_%d", i))
			if idxA != idxB {
				tracker.RecordPair(userIDs[idxA], userIDs[idxB])
			}
		}

		// Create a queue and enqueue all users with random tags.
		q := NewMatchQueue(numUsers + 10)
		allValidTags := validTagsList()
		baseTime := time.Now().Add(-time.Minute)

		for i, id := range userIDs {
			// Generate 0-3 random tags for each user.
			numTags := rapid.IntRange(0, 3).Draw(t, fmt.Sprintf("numTags_%d", i))
			tags := make([]string, 0, numTags)
			for j := 0; j < numTags; j++ {
				tagIdx := rapid.IntRange(0, len(allValidTags)-1).Draw(t, fmt.Sprintf("tag_%d_%d", i, j))
				tag := allValidTags[tagIdx]
				// Avoid duplicate tags for the same user.
				duplicate := false
				for _, existing := range tags {
					if existing == tag {
						duplicate = true
						break
					}
				}
				if !duplicate {
					tags = append(tags, tag)
				}
			}

			entry := &MatchEntry{
				ClientRef:  newMockClient(id),
				Tags:       tags,
				EnqueuedAt: baseTime.Add(time.Duration(i) * time.Second),
			}
			if err := q.Enqueue(entry); err != nil {
				t.Fatalf("failed to enqueue %s: %v", id, err)
			}
		}

		// Run matching with a generous tag fallback to allow both tag-based and FIFO matches.
		now := time.Now()
		tagFallback := 10 * time.Second
		pairs := q.FindAllMatches(tracker, now, tagFallback)

		// Verify properties for every matched pair.
		for pairIdx, pair := range pairs {
			idA := pair[0].ClientRef.GetID()
			idB := pair[1].ClientRef.GetID()

			// Property: no self-match.
			if idA == idB {
				t.Fatalf("pair %d: self-match detected: %q paired with itself", pairIdx, idA)
			}

			// Property: no recent-partner re-match.
			if tracker.IsRecentPair(idA, idB) {
				t.Fatalf("pair %d: recent-partner re-match detected: %q paired with %q (recorded as recent pair)",
					pairIdx, idA, idB)
			}
		}
	})
}

// TestProperty_TagValidationRoundTrip verifies Property 6: Tag validation round-trip.
// For ANY generated tag slice, ValidateTagSet returns nil if and only if the set
// has 0-3 elements AND all elements are in ValidTags.
//
// **Validates: Requirements 5.5, 5.6**
func TestProperty_TagValidationRoundTrip(t *testing.T) {
	allValid := validTagsList()

	rapid.Check(t, func(t *rapid.T) {
		// Decide whether to generate a valid or invalid tag set (50/50 split).
		generateValid := rapid.Bool().Draw(t, "generateValid")

		var tags []string
		var expectedValid bool

		if generateValid {
			// Generate a valid tag set: 0-3 elements, all from ValidTags.
			count := rapid.IntRange(0, MaxTags).Draw(t, "validCount")
			// Draw unique indices for tag selection.
			used := make(map[int]bool)
			tags = make([]string, 0, count)
			for len(tags) < count {
				idx := rapid.IntRange(0, len(allValid)-1).Draw(t, fmt.Sprintf("tagIdx_%d", len(tags)))
				if !used[idx] {
					used[idx] = true
					tags = append(tags, allValid[idx])
				}
			}
			expectedValid = true
		} else {
			// Generate an invalid tag set using one of two strategies:
			strategy := rapid.IntRange(0, 2).Draw(t, "invalidStrategy")

			switch strategy {
			case 0:
				// Strategy: too many tags (4-10 elements, all valid).
				count := rapid.IntRange(MaxTags+1, 10).Draw(t, "tooManyCount")
				tags = make([]string, count)
				for i := range tags {
					idx := rapid.IntRange(0, len(allValid)-1).Draw(t, "tagIdx")
					tags[i] = allValid[idx]
				}
				expectedValid = false

			case 1:
				// Strategy: contains at least one invalid tag, 1-3 elements.
				count := rapid.IntRange(1, MaxTags).Draw(t, "mixedCount")
				tags = make([]string, count)
				// Place at least one invalid tag.
				invalidTag := rapid.StringMatching(`^[a-z]{3,10}$`).Draw(t, "invalidTag")
				// Ensure it's not accidentally valid.
				for ValidTags[invalidTag] {
					invalidTag = rapid.StringMatching(`^[a-z]{3,10}$`).Draw(t, "invalidTagRetry")
				}
				invalidPos := rapid.IntRange(0, count-1).Draw(t, "invalidPos")
				for i := range tags {
					if i == invalidPos {
						tags[i] = invalidTag
					} else {
						idx := rapid.IntRange(0, len(allValid)-1).Draw(t, "validIdx")
						tags[i] = allValid[idx]
					}
				}
				expectedValid = false

			case 2:
				// Strategy: too many tags AND contains invalid tags.
				count := rapid.IntRange(MaxTags+1, 8).Draw(t, "bothBadCount")
				tags = make([]string, count)
				invalidTag := rapid.StringMatching(`^[a-z]{3,10}$`).Draw(t, "invalidTag2")
				for ValidTags[invalidTag] {
					invalidTag = rapid.StringMatching(`^[a-z]{3,10}$`).Draw(t, "invalidTagRetry2")
				}
				tags[0] = invalidTag
				for i := 1; i < count; i++ {
					idx := rapid.IntRange(0, len(allValid)-1).Draw(t, "fillIdx")
					tags[i] = allValid[idx]
				}
				expectedValid = false
			}
		}

		// Compute ground truth: valid iff 0-3 elements AND all elements in ValidTags.
		actuallyValid := len(tags) <= MaxTags
		if actuallyValid {
			for _, tag := range tags {
				if !ValidTags[tag] {
					actuallyValid = false
					break
				}
			}
		}

		// Validate using the function under test.
		err := ValidateTagSet(tags)
		isValid := err == nil

		// Property: ValidateTagSet returns nil iff the tag set is valid.
		if isValid != actuallyValid {
			t.Fatalf("ValidateTagSet(%v) = %v, but expected valid=%v (err=%v)",
				tags, isValid, actuallyValid, err)
		}

		// Cross-check against our expected validity from the generation strategy.
		if isValid != expectedValid {
			t.Fatalf("ValidateTagSet(%v) = %v, but generation expected valid=%v (err=%v)",
				tags, isValid, expectedValid, err)
		}
	})
}
