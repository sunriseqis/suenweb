export interface Env {
  DB: D1Database;
  AI?: any;
  ASSETS?: Fetcher;
  BACKUP_DB?: R2Bucket;
}

export interface Group {
  id: number;
  name: string;
  icon: string;
  type: string;
  display_mode: string;
  layout_mode?: string;
  sort_order: number;
  is_imported: number;
  created_at: string;
  links?: Link[];
}

export interface Link {
  id: number;
  group_id: number;
  title: string;
  url: string;
  description: string;
  icon: string;
  icon_type: string;
  sort_order: number;
  is_imported: number;
  synced_to_browser: number;
  created_at: string;
  group_name?: string;
  group_type?: string;
}

export interface Setting {
  key: string;
  value: string;
}

export interface Wallpaper {
  id: number;
  name: string;
  url: string;
  category: string;
  enabled: number;
  sort_order: number;
  source_type: string;
  created_at: string;
}

export interface FontItem {
  id: number;
  name: string;
  family: string;
  category: string;
  cdn_url: string;
  language: string;
  sort_order: number;
  created_at: string;
}
