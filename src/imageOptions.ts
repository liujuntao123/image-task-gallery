import type { ImageAspectRatio, ImageConfig, ImageQuality, ImageResolution } from "./appTypes";

export const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  aspectRatio: "1:1",
  resolution: "1K",
  quality: "high"
};

export const ASPECT_RATIO_OPTIONS: Array<{ value: ImageAspectRatio; label: string }> = [
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" }
];

export const RESOLUTION_OPTIONS: Array<{ value: ImageResolution; label: string }> = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" }
];

export const QUALITY_OPTIONS: Array<{ value: ImageQuality; label: string; description: string }> = [
  { value: "low", label: "Low", description: "更快" },
  { value: "medium", label: "Medium", description: "均衡" },
  { value: "high", label: "High", description: "默认" }
];

const IMAGE_SIZE_PRESETS: Record<ImageResolution, Record<ImageAspectRatio, string>> = {
  "1K": {
    "1:1": "1024x1024",
    "4:3": "1152x864",
    "3:4": "864x1152",
    "16:9": "1280x720",
    "9:16": "720x1280"
  },
  "2K": {
    "1:1": "2048x2048",
    "4:3": "2304x1728",
    "3:4": "1728x2304",
    "16:9": "2560x1440",
    "9:16": "1440x2560"
  },
  "4K": {
    "1:1": "2880x2880",
    "4:3": "3072x2304",
    "3:4": "2304x3072",
    "16:9": "3840x2160",
    "9:16": "2160x3840"
  }
};

export function resolveImageSize(config: ImageConfig): string {
  return IMAGE_SIZE_PRESETS[config.resolution][config.aspectRatio];
}

export function imageConfigSummary(config: ImageConfig): string {
  return `${config.aspectRatio} · ${config.resolution} · ${resolveImageSize(config)} · ${qualityLabel(config.quality)}`;
}

export function imageConfigButtonText(config: ImageConfig): string {
  return `${resolveImageSize(config)} · ${qualityLabel(config.quality)}`;
}

export function qualityLabel(quality: ImageQuality): string {
  const text: Record<ImageQuality, string> = {
    low: "Low",
    medium: "Medium",
    high: "High"
  };
  return text[quality];
}
