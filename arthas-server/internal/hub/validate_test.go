package hub

import (
	"strings"
	"testing"
)

// --- ValidateListing Tests ---

func TestValidateListing_ValidInput(t *testing.T) {
	err := ValidateListing("My Room", "A nice description", []string{"golang", "ama"})
	if err != nil {
		t.Fatalf("expected no error for valid input, got %v", err)
	}
}

func TestValidateListing_EmptyTitle_Error(t *testing.T) {
	err := ValidateListing("", "Description", nil)
	if err == nil {
		t.Fatal("expected error for empty title")
	}
	if err.Error() != "title is required" {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateListing_WhitespaceOnlyTitle_Error(t *testing.T) {
	err := ValidateListing("   ", "Description", nil)
	if err == nil {
		t.Fatal("expected error for whitespace-only title")
	}
	if err.Error() != "title is required" {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateListing_TitleTooLong_Error(t *testing.T) {
	// 51 runes
	longTitle := strings.Repeat("a", 51)
	err := ValidateListing(longTitle, "", nil)
	if err == nil {
		t.Fatal("expected error for title > 50 characters")
	}
	if err.Error() != "title must be 50 characters or less" {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateListing_TitleExactly50_Ok(t *testing.T) {
	title := strings.Repeat("x", 50)
	err := ValidateListing(title, "", nil)
	if err != nil {
		t.Fatalf("expected no error for 50-char title, got %v", err)
	}
}

func TestValidateListing_TitleUnicode_CountsRunes(t *testing.T) {
	// Each Chinese character is 1 rune but 3 bytes
	title := strings.Repeat("中", 50)
	err := ValidateListing(title, "", nil)
	if err != nil {
		t.Fatalf("expected no error for 50-rune unicode title, got %v", err)
	}

	title = strings.Repeat("中", 51)
	err = ValidateListing(title, "", nil)
	if err == nil {
		t.Fatal("expected error for 51-rune unicode title")
	}
}

func TestValidateListing_DescriptionTooLong_Error(t *testing.T) {
	desc := strings.Repeat("b", 201)
	err := ValidateListing("Title", desc, nil)
	if err == nil {
		t.Fatal("expected error for description > 200 characters")
	}
	if err.Error() != "description must be 200 characters or less" {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateListing_DescriptionExactly200_Ok(t *testing.T) {
	desc := strings.Repeat("c", 200)
	err := ValidateListing("Title", desc, nil)
	if err != nil {
		t.Fatalf("expected no error for 200-char description, got %v", err)
	}
}

func TestValidateListing_EmptyDescription_Ok(t *testing.T) {
	err := ValidateListing("Title", "", nil)
	if err != nil {
		t.Fatalf("expected no error for empty description, got %v", err)
	}
}

func TestValidateListing_TooManyTags_Error(t *testing.T) {
	tags := []string{"a", "b", "c", "d", "e", "f"}
	err := ValidateListing("Title", "", tags)
	if err == nil {
		t.Fatal("expected error for > 5 tags")
	}
	if err.Error() != "maximum 5 tags allowed" {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateListing_FiveTags_Ok(t *testing.T) {
	tags := []string{"a", "b", "c", "d", "e"}
	err := ValidateListing("Title", "", tags)
	if err != nil {
		t.Fatalf("expected no error for exactly 5 tags, got %v", err)
	}
}

func TestValidateListing_EmptyTag_Error(t *testing.T) {
	tags := []string{"valid", ""}
	err := ValidateListing("Title", "", tags)
	if err == nil {
		t.Fatal("expected error for empty tag")
	}
	if err.Error() != "each tag must be 1-20 characters" {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateListing_TagTooLong_Error(t *testing.T) {
	tags := []string{strings.Repeat("a", 21)}
	err := ValidateListing("Title", "", tags)
	if err == nil {
		t.Fatal("expected error for tag > 20 characters")
	}
	if err.Error() != "each tag must be 1-20 characters" {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateListing_TagInvalidChars_Error(t *testing.T) {
	tags := []string{"invalid tag!"}
	err := ValidateListing("Title", "", tags)
	if err == nil {
		t.Fatal("expected error for tag with invalid characters")
	}
	if !strings.Contains(err.Error(), "contains invalid characters") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateListing_TagWithHyphen_Ok(t *testing.T) {
	tags := []string{"my-tag", "another-one"}
	err := ValidateListing("Title", "", tags)
	if err != nil {
		t.Fatalf("expected no error for tags with hyphens, got %v", err)
	}
}

func TestValidateListing_TagWithUnderscore_Error(t *testing.T) {
	tags := []string{"my_tag"}
	err := ValidateListing("Title", "", tags)
	if err == nil {
		t.Fatal("expected error for tag with underscore")
	}
}

func TestValidateListing_NilTags_Ok(t *testing.T) {
	err := ValidateListing("Title", "Desc", nil)
	if err != nil {
		t.Fatalf("expected no error for nil tags, got %v", err)
	}
}

func TestValidateListing_HTMLInTitle_Stripped(t *testing.T) {
	// HTML in title should be stripped by SanitizeString, leaving "Hello"
	err := ValidateListing("<b>Hello</b>", "", nil)
	if err != nil {
		t.Fatalf("expected no error after HTML stripping, got %v", err)
	}
}

func TestValidateListing_HTMLOnlyTitle_EmptyAfterStrip_Error(t *testing.T) {
	// Title is only HTML tags with no text content → after stripping becomes empty
	err := ValidateListing("<br/><hr/>", "", nil)
	if err == nil {
		t.Fatal("expected error when title is only HTML tags")
	}
	if err.Error() != "title is required" {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateListing_ScriptTag_ContentPreserved(t *testing.T) {
	// Script tag is stripped but inner text remains
	err := ValidateListing("<script>alert('xss')</script>", "", nil)
	if err != nil {
		t.Fatalf("expected no error (text content remains after stripping), got %v", err)
	}
}

// --- SanitizeString Tests ---

func TestSanitizeString_StripsHTML(t *testing.T) {
	result := SanitizeString("<b>Hello</b> <i>World</i>")
	expected := "Hello World"
	if result != expected {
		t.Fatalf("expected %q, got %q", expected, result)
	}
}

func TestSanitizeString_TrimsWhitespace(t *testing.T) {
	result := SanitizeString("  hello world  ")
	expected := "hello world"
	if result != expected {
		t.Fatalf("expected %q, got %q", expected, result)
	}
}

func TestSanitizeString_RemovesControlChars(t *testing.T) {
	// \x00 is a null byte (control char), should be removed
	result := SanitizeString("hello\x00world")
	expected := "helloworld"
	if result != expected {
		t.Fatalf("expected %q, got %q", expected, result)
	}
}

func TestSanitizeString_PreservesNewlineAndTab(t *testing.T) {
	result := SanitizeString("hello\nworld\ttab")
	expected := "hello\nworld\ttab"
	if result != expected {
		t.Fatalf("expected %q, got %q", expected, result)
	}
}

func TestSanitizeString_EmptyString(t *testing.T) {
	result := SanitizeString("")
	if result != "" {
		t.Fatalf("expected empty string, got %q", result)
	}
}

func TestSanitizeString_ComplexHTML(t *testing.T) {
	result := SanitizeString(`<script>alert("xss")</script>safe content`)
	expected := `alert("xss")safe content`
	if result != expected {
		t.Fatalf("expected %q, got %q", expected, result)
	}
}

func TestSanitizeString_SelfClosingTags(t *testing.T) {
	result := SanitizeString("line1<br/>line2")
	expected := "line1line2"
	if result != expected {
		t.Fatalf("expected %q, got %q", expected, result)
	}
}

// --- containsControlChars Tests ---

func TestContainsControlChars_NullByte(t *testing.T) {
	if !containsControlChars("hello\x00world") {
		t.Fatal("expected true for string with null byte")
	}
}

func TestContainsControlChars_BellChar(t *testing.T) {
	if !containsControlChars("hello\x07world") {
		t.Fatal("expected true for string with bell character")
	}
}

func TestContainsControlChars_NewlineAllowed(t *testing.T) {
	if containsControlChars("hello\nworld") {
		t.Fatal("expected false for string with newline (allowed)")
	}
}

func TestContainsControlChars_TabAllowed(t *testing.T) {
	if containsControlChars("hello\tworld") {
		t.Fatal("expected false for string with tab (allowed)")
	}
}

func TestContainsControlChars_CleanString(t *testing.T) {
	if containsControlChars("hello world! 123") {
		t.Fatal("expected false for clean string")
	}
}
