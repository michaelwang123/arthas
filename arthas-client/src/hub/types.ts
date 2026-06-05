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
}

export interface HubListResponse {
  rooms: RoomListing[];
  total: number;
  limit: number;
  offset: number;
}

export interface HubFilters {
  tag: string;
  query: string;
}
