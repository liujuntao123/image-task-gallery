import type { ReferenceImagePayload } from "./types";

export type AppView = "gallery" | "edit";
export type EditMode = "global" | "masked";
export type MaskTool = "brush" | "eraser";
export type ImageAspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
export type ImageResolution = "1K" | "2K" | "4K";
export type ImageQuality = "low" | "medium" | "high";

export interface ImageConfig {
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
  quality: ImageQuality;
}

export interface ReferenceImage extends ReferenceImagePayload {
  id: string;
}

export interface MaskDraft {
  targetImageId: string;
  dataUrl: string;
  previewDataUrl: string;
  coverage: number;
}

export interface ImagePreview {
  url: string;
  alt: string;
  prompt: string;
}
