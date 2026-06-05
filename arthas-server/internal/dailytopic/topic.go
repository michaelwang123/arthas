package dailytopic

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed topics.json
var embeddedTopicsData []byte

// Topic represents a single daily topic entry from the embedded pool.
type Topic struct {
	Title       string   `json:"title"`       // 话题标题（直接显示在 Hub）
	Description string   `json:"description"` // 话题描述
	Tags        []string `json:"tags"`        // 额外标签（合并 "daily-topic"）
}

// LoadTopics loads the topic pool from embedded JSON.
// Returns error if JSON is malformed or pool is empty.
func LoadTopics() ([]Topic, error) {
	var topics []Topic
	if err := json.Unmarshal(embeddedTopicsData, &topics); err != nil {
		return nil, fmt.Errorf("dailytopic: failed to parse topics.json: %w", err)
	}
	if len(topics) == 0 {
		return nil, fmt.Errorf("dailytopic: topics.json is empty")
	}
	return topics, nil
}
