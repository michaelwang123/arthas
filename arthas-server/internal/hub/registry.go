package hub

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
)

// ErrHubFull is returned when the registry has reached its maximum capacity.
var ErrHubFull = errors.New("hub: maximum number of public rooms reached")

// RoomListing represents a public room's metadata in the Hub directory.
type RoomListing struct {
	RoomID       string   `json:"roomId"`
	KeyEncoded   string   `json:"-"`                      // base64url key from client (internal, not in JSON)
	ShareCode    string   `json:"shareCode"`              // Full share code, constructed by server: roomId:key:ephemeral:expiresAt
	Title        string   `json:"title"`                  // 1-50 chars, room display name
	Description  string   `json:"description"`            // 0-200 chars, optional
	Tags         []string `json:"tags"`                   // 0-5 tags, each 1-20 chars
	MemberCount  int      `json:"memberCount"`            // Live count from Room.MemberCount()
	HasPassword  bool     `json:"hasPassword"`            // True if room requires password
	CreatedAt    int64    `json:"createdAt"`              // Unix seconds
	ExpiresAt    int64    `json:"expiresAt"`              // Unix seconds, 0 = never
	Ephemeral    int      `json:"-"`                      // Ephemeral mode (internal, used for share code construction)
	IsDailyTopic bool     `json:"isDailyTopic,omitempty"` // true = system daily topic room
}

// ListOptions defines query parameters for directory listing.
type ListOptions struct {
	Tag          string // filter by tag (case-insensitive match)
	Query        string // search in title + description (case-insensitive contains)
	IsDailyTopic *bool  // filter by isDailyTopic: nil = no filter, true/false = exact match
	Limit        int    // max results, default 50, max 100
	Offset       int    // pagination offset, default 0
}

// ListResult wraps paginated query results.
type ListResult struct {
	Rooms  []*RoomListing `json:"rooms"`
	Total  int            `json:"total"` // total matching (before pagination)
	Limit  int            `json:"limit"`
	Offset int            `json:"offset"`
}

// HubRegistry is a thread-safe in-memory registry of public rooms.
// It stores only listing metadata; the actual Room state lives in RoomManager.
type HubRegistry struct {
	mu       sync.RWMutex
	listings map[string]*RoomListing // key = roomId
	maxRooms int                     // configurable cap (default 200)
}

// NewHubRegistry creates a new HubRegistry with the specified maximum capacity.
func NewHubRegistry(maxRooms int) *HubRegistry {
	return &HubRegistry{
		listings: make(map[string]*RoomListing),
		maxRooms: maxRooms,
	}
}

// Register adds a public room listing. Returns ErrHubFull if at capacity.
// Daily topic rooms bypass the capacity limit (system-created, reserved slot).
// Before storing, it constructs the full share code from the listing fields.
func (r *HubRegistry) Register(listing *RoomListing) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	// Daily topic rooms are not subject to the capacity limit
	if !listing.IsDailyTopic && len(r.listings) >= r.maxRooms {
		return ErrHubFull
	}
	// Construct the full share code: roomId:keyEncoded:ephemeral:expiresAt
	listing.ShareCode = fmt.Sprintf("%s:%s:%d:%d", listing.RoomID, listing.KeyEncoded, listing.Ephemeral, listing.ExpiresAt)
	r.listings[listing.RoomID] = listing
	return nil
}

// Unregister removes a room from the directory.
// Safe to call for non-existent roomIDs (no-op).
func (r *HubRegistry) Unregister(roomID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.listings, roomID)
}

// UpdateMemberCount updates the live member count for a registered room.
// No-op if the roomID is not in the registry.
func (r *HubRegistry) UpdateMemberCount(roomID string, count int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if listing, ok := r.listings[roomID]; ok {
		listing.MemberCount = count
	}
}

// List returns a filtered, sorted, paginated slice of listings.
// Sorting: memberCount DESC, then createdAt DESC.
// Filtering: tag match (case-insensitive), query search in title+description (case-insensitive contains).
func (r *HubRegistry) List(opts ListOptions) *ListResult {
	r.mu.RLock()

	// Collect all listings into a slice
	all := make([]*RoomListing, 0, len(r.listings))
	for _, l := range r.listings {
		all = append(all, l)
	}

	r.mu.RUnlock()

	// Apply filters
	var filtered []*RoomListing
	tagLower := strings.ToLower(opts.Tag)
	queryLower := strings.ToLower(opts.Query)

	for _, l := range all {
		// Filter by isDailyTopic (exact match when specified)
		if opts.IsDailyTopic != nil {
			if l.IsDailyTopic != *opts.IsDailyTopic {
				continue
			}
		}

		// Filter by tag (case-insensitive)
		if tagLower != "" {
			matched := false
			for _, t := range l.Tags {
				if strings.ToLower(t) == tagLower {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
		}

		// Filter by query (case-insensitive contains in title or description)
		if queryLower != "" {
			titleMatch := strings.Contains(strings.ToLower(l.Title), queryLower)
			descMatch := strings.Contains(strings.ToLower(l.Description), queryLower)
			if !titleMatch && !descMatch {
				continue
			}
		}

		filtered = append(filtered, l)
	}

	// Sort: memberCount DESC, then createdAt DESC
	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].MemberCount != filtered[j].MemberCount {
			return filtered[i].MemberCount > filtered[j].MemberCount
		}
		return filtered[i].CreatedAt > filtered[j].CreatedAt
	})

	total := len(filtered)

	// Apply defaults for limit
	limit := opts.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	offset := opts.Offset
	if offset < 0 {
		offset = 0
	}

	// Paginate
	if offset >= total {
		return &ListResult{
			Rooms:  []*RoomListing{},
			Total:  total,
			Limit:  limit,
			Offset: offset,
		}
	}

	end := offset + limit
	if end > total {
		end = total
	}

	return &ListResult{
		Rooms:  filtered[offset:end],
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}
}

// Count returns the number of listings currently in the registry.
func (r *HubRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.listings)
}
