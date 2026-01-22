
export interface Concept {
  id: string;
  name: string;
  prompt: string;
  thumbnail: string;
}

export interface EventRecord {
  id: string;
  name: string;
  description: string;
  folderId: string;
  createdAt: string;
  isActive: boolean;
}

export type AspectRatio = '16:9' | '9:16' | '3:2' | '2:3';

export type MonitorTheme = 'physics' | 'grid' | 'hero' | 'slider';

export interface PhotoboothSettings {
  eventName: string;
  eventDescription: string;
  folderId: string;
  spreadsheetId?: string; // New: To link specific sheet
  selectedModel: string;
  enableOpenAI?: boolean; // New: Toggle OpenAI provider
  gptModelSize?: '512' | '720' | '1024'; // New: OpenAI Render Size
  overlayImage: string | null;
  backgroundImage: string | null;
  backgroundAudio: string | null; // New: Audio file URL
  videoPrompt: string; // New: Prompt for Veo
  enableVideoGeneration?: boolean; // New: Toggle video button
  monitorImageSize?: 'small' | 'medium' | 'large'; // New: Monitor card size
  monitorTheme?: MonitorTheme; // New: Monitor Theme Layout
  autoResetTime: number;
  adminPin: string;
  orientation: 'portrait' | 'landscape';
  outputRatio: AspectRatio;
  activeEventId?: string;
  cameraRotation: number;
}

export interface GalleryItem {
  id: string;
  createdAt: string;
  conceptName: string;
  imageUrl: string;
  downloadUrl: string;
  token: string;
  eventId?: string;
  type?: 'image' | 'video'; // Added type field
}

export enum AppState {
  LANDING = 'LANDING',
  THEMES = 'THEMES',
  CAMERA = 'CAMERA',
  GENERATING = 'GENERATING',
  RESULT = 'RESULT',
  GALLERY = 'GALLERY',
  ADMIN = 'ADMIN',
  MONITOR = 'MONITOR'
}