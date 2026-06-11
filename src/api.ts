import type { CreateTaskResponse, ImageTask, ReferenceImagePayload, TaskListResponse } from "./types";
import { trimTrailingSlash } from "./config";

interface CreateImageTaskInput {
  workerUrl: string;
  token: string;
  prompt: string;
  size: string;
  quality: "low" | "medium" | "high";
  inputImages: ReferenceImagePayload[];
  mask?: ReferenceImagePayload | null;
}

export async function listTasks(workerUrl: string, token: string): Promise<ImageTask[]> {
  const baseUrl = trimTrailingSlash(workerUrl);
  const response = await fetch(`${baseUrl}/tasks?limit=80`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`任务列表读取失败：${response.status} ${await safeText(response)}`);
  }

  const data = (await response.json()) as TaskListResponse;
  return data.tasks;
}

export async function createImageTask(input: CreateImageTaskInput): Promise<CreateTaskResponse> {
  const baseUrl = trimTrailingSlash(input.workerUrl);
  const payload = {
    prompt: input.prompt,
    size: input.size,
    quality: input.quality
  };

  const response = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      payload,
      inputImages: input.inputImages,
      ...(input.mask ? { mask: input.mask } : {}),
      maxAttempts: 1
    })
  });

  if (!response.ok) {
    throw new Error(`任务创建失败：${response.status} ${await safeText(response)}`);
  }

  return (await response.json()) as CreateTaskResponse;
}

export async function deleteImageTask(workerUrl: string, token: string, taskId: string): Promise<void> {
  const baseUrl = trimTrailingSlash(workerUrl);
  const response = await fetch(`${baseUrl}/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`任务删除失败：${response.status} ${await safeText(response)}`);
  }
}

export function resolveImageUrl(workerUrl: string, resultUrl: string): string {
  if (resultUrl.startsWith("http://") || resultUrl.startsWith("https://")) {
    return resultUrl;
  }

  return `${trimTrailingSlash(workerUrl)}${resultUrl.startsWith("/") ? "" : "/"}${resultUrl}`;
}

export async function fetchImageBlobUrl(workerUrl: string, token: string, resultUrl: string): Promise<string> {
  const url = resolveImageUrl(workerUrl, resultUrl);
  const response = await fetch(url, {
    headers: shouldSendWorkerAuth(workerUrl, resultUrl) ? { Authorization: `Bearer ${token}` } : undefined
  });

  if (!response.ok) {
    throw new Error(`图片读取失败：${response.status} ${await safeText(response)}`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("结果不是可用图片");
  }

  return URL.createObjectURL(blob);
}

function shouldSendWorkerAuth(workerUrl: string, resultUrl: string): boolean {
  if (!resultUrl.startsWith("http://") && !resultUrl.startsWith("https://")) {
    return true;
  }

  try {
    return new URL(resultUrl).origin === new URL(workerUrl).origin;
  } catch {
    return true;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}
