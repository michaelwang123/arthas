package hub

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

var tagRegex = regexp.MustCompile(`^[a-zA-Z0-9-]+$`)

// ValidateListing validates Hub listing metadata from CreateRoom data.
func ValidateListing(title, description string, tags []string) error {
	// Sanitize inputs first
	title = SanitizeString(title)
	description = SanitizeString(description)

	// Title validation
	titleLen := utf8.RuneCountInString(title)
	if titleLen == 0 {
		return fmt.Errorf("title is required")
	}
	if titleLen > 50 {
		return fmt.Errorf("title must be 50 characters or less")
	}
	if containsControlChars(title) {
		return fmt.Errorf("title contains invalid characters")
	}

	// Description validation
	descLen := utf8.RuneCountInString(description)
	if descLen > 200 {
		return fmt.Errorf("description must be 200 characters or less")
	}
	if containsControlChars(description) {
		return fmt.Errorf("description contains invalid characters")
	}

	// Tags validation
	if len(tags) > 5 {
		return fmt.Errorf("maximum 5 tags allowed")
	}
	for _, tag := range tags {
		if len(tag) == 0 || len(tag) > 20 {
			return fmt.Errorf("each tag must be 1-20 characters")
		}
		if !tagRegex.MatchString(tag) {
			return fmt.Errorf("tag %q contains invalid characters (alphanumeric and hyphens only)", tag)
		}
	}

	return nil
}

// SanitizeString strips HTML tags, trims whitespace, and removes control characters.
func SanitizeString(s string) string {
	// Strip HTML tags
	s = stripHTMLTags(s)
	// Remove control characters
	s = removeControlChars(s)
	// Trim whitespace
	s = strings.TrimSpace(s)
	return s
}

// containsControlChars checks if the string has any control characters (except newline/tab).
func containsControlChars(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return true
		}
	}
	return false
}

// removeControlChars removes all control characters from a string.
func removeControlChars(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, s)
}

// stripHTMLTags removes HTML/XML tags from a string using a simple regex.
func stripHTMLTags(s string) string {
	re := regexp.MustCompile(`<[^>]*>`)
	return re.ReplaceAllString(s, "")
}
