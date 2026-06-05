package dailytopic

import (
	"testing"
)

func TestLoadTopics_Success(t *testing.T) {
	topics, err := LoadTopics()
	if err != nil {
		t.Fatalf("LoadTopics() returned error: %v", err)
	}
	if len(topics) < 30 {
		t.Errorf("expected at least 30 topics, got %d", len(topics))
	}
}

func TestLoadTopics_AllTopicsHaveTitle(t *testing.T) {
	topics, err := LoadTopics()
	if err != nil {
		t.Fatalf("LoadTopics() returned error: %v", err)
	}
	for i, topic := range topics {
		if topic.Title == "" {
			t.Errorf("topic[%d] has empty title", i)
		}
	}
}

func TestLoadTopics_AllTopicsHaveTags(t *testing.T) {
	topics, err := LoadTopics()
	if err != nil {
		t.Fatalf("LoadTopics() returned error: %v", err)
	}
	for i, topic := range topics {
		if len(topic.Tags) == 0 {
			t.Errorf("topic[%d] (%q) has no tags", i, topic.Title)
		}
	}
}
