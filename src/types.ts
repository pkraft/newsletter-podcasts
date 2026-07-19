export interface SeriesConfig {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  author: string;
  ownerName: string;
  ownerEmail: string;
  language: string;
  category: string;
  subcategory?: string;
  explicit: boolean;
  themeColor?: string;
  link?: string;
  status: "active" | "archived";
  /** Directory listing URLs, filled in as the series is accepted (M4 checklist). */
  directories?: {
    apple?: string;
    spotify?: string;
    amazon?: string;
    podcastIndex?: string;
  };
}

export interface EpisodeAudio {
  file: string;
  bytes: number;
  durationSeconds: number;
  mimeType: "audio/mpeg";
}

export interface EpisodeMeta {
  id: string;
  guid: string;
  externalId: string;
  title: string;
  summary: string;
  publishDate: string;
  status: "published" | "unpublished";
  audio: EpisodeAudio;
  season?: number;
  episodeNumber?: number;
  ingestedAt: string;
  updatedAt: string;
}

export interface PublishPayload {
  series_id: string;
  external_id: string;
  title: string;
  summary: string;
  publish_date: string;
  audio_url: string;
  transcript_url?: string;
  source_text_url?: string;
  auto_publish?: boolean;
}

export interface SiteConfig {
  baseUrl: string;
  op3: boolean;
  siteTitle: string;
}
