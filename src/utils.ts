import type { ReferenceImage, MaskDraft } from "./appTypes";
import type { ImageTask, ReferenceImagePayload, TaskStatus } from "./types";

export function statusText(status: TaskStatus): string {
  const text: Record<TaskStatus, string> = {
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败"
  };
  return text[status];
}

export function payloadText(task: ImageTask, key: string): string {
  const value = task.targetPayload?.[key];
  return typeof value === "string" && value ? value : "-";
}

export function formatElapsed(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt) return "未开始";
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}

export function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.host;
  } catch {
    return value || "未配置";
  }
}

export function toPayload(image: ReferenceImage): ReferenceImagePayload {
  return {
    dataUrl: image.dataUrl,
    filename: image.filename
  };
}

export function orderImagesForMask(images: ReferenceImage[], maskTargetImageId: string | null | undefined): ReferenceImage[] {
  if (!maskTargetImageId) return images;
  const index = images.findIndex((image) => image.id === maskTargetImageId);
  if (index <= 0) return images;
  const nextImages = [...images];
  const [target] = nextImages.splice(index, 1);
  return [target, ...nextImages];
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export async function fetchImageAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`图片读取失败：${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("结果不是可用图片");
  }

  return fileToDataUrl(new File([blob], "reference.png", { type: blob.type }));
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

export function requiredContext(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D {
  const context = canvas?.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器不支持 Canvas");
  return context;
}

export function calculateMaskCoverage(canvas: HTMLCanvasElement | null): number {
  if (!canvas) return 0;
  const context = requiredContext(canvas);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) transparent += 1;
  }
  return transparent / (canvas.width * canvas.height);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { MaskDraft };
