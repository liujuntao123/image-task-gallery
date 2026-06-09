import type { AppConfig } from "./types";

const DEVICE_UUID_KEY = "image-task-gallery.device-uuid";
const CONFIG_KEY = "image-task-gallery.config";

export const DEFAULT_CONFIG: AppConfig = {
  workerUrl: "https://image-task-worker.royal-silence-b1e6.workers.dev",
  imageType: "gpt-image-2",
  targetUrl: "https://sub.aizhi.site/v1/images/generations",
  apiKey: "",
  model: "gpt-image-2"
};

export function getDeviceUuid(): string {
  const existing = localStorage.getItem(DEVICE_UUID_KEY);
  if (existing) return existing;

  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone
  ].join("|");
  const randomPart = crypto.randomUUID();
  const uuid = `web-${hashString(fingerprint)}-${randomPart}`;
  localStorage.setItem(DEVICE_UUID_KEY, uuid);
  return uuid;
}

export function loadConfig(): AppConfig {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return DEFAULT_CONFIG;

  try {
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      imageType: "gpt-image-2",
      model: parsed.model?.trim() || "gpt-image-2",
      workerUrl: trimTrailingSlash(parsed.workerUrl || DEFAULT_CONFIG.workerUrl),
      targetUrl: parsed.targetUrl || DEFAULT_CONFIG.targetUrl
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({
      ...config,
      workerUrl: trimTrailingSlash(config.workerUrl),
      imageType: "gpt-image-2"
    })
  );
}

export function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
