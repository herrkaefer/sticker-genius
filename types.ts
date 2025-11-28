
export interface ReferenceImage {
  id: string;
  data: string; // Base64
  mimeType: string;
}

export type Resolution = '1K' | '2K' | '4K';

export type SheetSizePreset = '4x6' | '8.5x11' | 'custom';

export interface AppConfig {
  resolution: Resolution;
  backgroundColor: string; // Hex
  isTransparent: boolean;
  sheetSize: SheetSizePreset;
  customWidth: number;
  customHeight: number;
  numberOfSheets: number;
}

export interface AIStudio {
  hasSelectedApiKey: () => Promise<boolean>;
  openSelectKey: () => Promise<void>;
}
