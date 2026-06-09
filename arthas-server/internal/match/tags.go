package match

import (
	"errors"
	"fmt"
)

// ValidTags defines the set of allowed interest tags for match requests.
// Tags outside this set are rejected by the server.
var ValidTags = map[string]bool{
	"tech":     true,
	"music":    true,
	"gaming":   true,
	"random":   true,
	"language": true,
	"movies":   true,
}

// MaxTags is the maximum number of tags a user can select per match request.
const MaxTags = 3

// Sentinel errors for tag validation.
var (
	ErrTooManyTags = errors.New("match: too many tags (maximum 3)")
	ErrInvalidTag  = errors.New("match: invalid tag")
)

// ValidateTagSet validates that a tag set contains 0-3 tags, all from ValidTags.
// Returns nil if valid, or a descriptive error if not.
func ValidateTagSet(tags []string) error {
	if len(tags) > MaxTags {
		return fmt.Errorf("%w: got %d", ErrTooManyTags, len(tags))
	}
	for _, tag := range tags {
		if !ValidTags[tag] {
			return fmt.Errorf("%w: %q", ErrInvalidTag, tag)
		}
	}
	return nil
}
