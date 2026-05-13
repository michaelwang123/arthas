package logger

import (
	"bytes"
	"log"
	"regexp"
	"strings"
	"testing"
	"testing/quick"
	"time"
)

// TestProperty_StructuredLogFormat verifies Property 3: Structured log format invariant.
//
// For any log event (with any module name, any level, and any message string
// that does not contain newlines), the formatted log output SHALL match the pattern
// [<RFC3339>] [<LEVEL>] [<MODULE>] <message> where <RFC3339> is a valid RFC 3339
// timestamp, <LEVEL> is one of INFO/WARN/ERROR, and <MODULE> is the provided module string.
//
// **Validates: Requirements 4.1**
func TestProperty_StructuredLogFormat(t *testing.T) {
	// Pattern: [timestamp] [LEVEL] [module] message\n
	logPattern := regexp.MustCompile(`^\[.+\] \[(INFO|WARN|ERROR)\] \[.+\] .+\n$`)

	// Save original log output and restore after test
	originalOutput := log.Writer()
	defer log.SetOutput(originalOutput)

	// Ensure logger flags are set correctly for the test
	originalFlags := log.Flags()
	defer log.SetFlags(originalFlags)
	log.SetFlags(0)

	var buf bytes.Buffer

	// Define the property function that testing/quick will call with random inputs
	property := func(module, message string) bool {
		// Filter out newlines from generated strings as per property definition
		module = strings.ReplaceAll(module, "\n", "")
		module = strings.ReplaceAll(module, "\r", "")
		message = strings.ReplaceAll(message, "\n", "")
		message = strings.ReplaceAll(message, "\r", "")

		// Skip empty module/message — emit still works but the regex expects non-empty content
		if module == "" || message == "" {
			return true
		}

		// Test all three log levels
		levels := []struct {
			fn    func(string, string, ...interface{})
			level string
		}{
			{Info, "INFO"},
			{Warn, "WARN"},
			{Error, "ERROR"},
		}

		for _, l := range levels {
			buf.Reset()
			log.SetOutput(&buf)

			l.fn(module, "%s", message)

			output := buf.String()

			// Verify overall pattern matches
			if !logPattern.MatchString(output) {
				t.Logf("output did not match pattern: %q", output)
				return false
			}

			// Extract and validate the RFC3339 timestamp
			// Format: [timestamp] [LEVEL] [module] message
			// The timestamp is between the first '[' and first ']'
			firstClose := strings.Index(output, "]")
			if firstClose < 2 {
				t.Logf("could not find timestamp closing bracket in: %q", output)
				return false
			}
			timestamp := output[1:firstClose]

			_, err := time.Parse(time.RFC3339, timestamp)
			if err != nil {
				t.Logf("timestamp %q is not valid RFC3339: %v", timestamp, err)
				return false
			}

			// Verify the level is correct
			if !strings.Contains(output, "["+l.level+"]") {
				t.Logf("output missing expected level [%s]: %q", l.level, output)
				return false
			}

			// Verify the module is present in brackets
			if !strings.Contains(output, "["+module+"]") {
				t.Logf("output missing expected module [%s]: %q", module, output)
				return false
			}

			// Verify the message appears at the end
			if !strings.Contains(output, message) {
				t.Logf("output missing expected message %q: %q", message, output)
				return false
			}
		}

		return true
	}

	// Run with minimum 100 iterations as specified
	cfg := &quick.Config{MaxCount: 100}
	if err := quick.Check(property, cfg); err != nil {
		t.Errorf("Property 3 (Structured log format invariant) failed: %v", err)
	}
}
