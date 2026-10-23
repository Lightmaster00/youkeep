// Shapes of the Subscriptions page data (GET /api/subscriptions/channels).
export interface SubscribedChannel {
  id: string;
  title: string;
  avatar_url: string | null;
  subscribedAt?: number;
  videoCount: number;
  newCount: number;
  lastUploadDate: string | null;
  lastUploadAt?: number | null;
  categories: string[];
}
