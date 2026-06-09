export interface RoomListing {
  roomId: string;
  shareCode: string;
  title: string;
  description: string;
  tags: string[];
  memberCount: number;
  hasPassword: boolean;
  createdAt: number;
  expiresAt: number;
  isDailyTopic?: boolean; // true = system daily topic room
  messageCount5min: number; // 5-minute sliding window message count
}

export interface HubListResponse {
  rooms: RoomListing[];
  total: number;
  limit: number;
  offset: number;
  totalOnline: number; // total connected WebSocket clients across all rooms
}

export interface HubFilters {
  tag: string;
  query: string;
}
