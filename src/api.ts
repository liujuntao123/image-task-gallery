import type { AppConfig, CreateTaskResponse, ImageTask, TaskListResponse } from "./types";
import { trimTrailingSlash } from "./storage";

interface CreateImageTaskInput {
  prompt: string;
  size: string;
  uuid: string;
  config: AppConfig;
}

export async function listTasks(workerUrl: string, uuid: string): Promise<ImageTask[]> {
  const baseUrl = trimTrailingSlash(workerUrl);
  const response = await fetch(`${baseUrl}/tasks?uuid=${encodeURIComponent(uuid)}&limit=80`, {
    headers: {
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
  const baseUrl = trimTrailingSlash(input.config.workerUrl);
  const payload = {
    model: input.config.model,
    prompt: input.prompt,
    size: input.size,
    quality: "auto"
  };

  const response = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      url: input.config.targetUrl,
      key: input.config.apiKey,
      payload,
      uuid: input.uuid,
      maxAttempts: 1
    })
  });

  if (!response.ok) {
    throw new Error(`任务创建失败：${response.status} ${await safeText(response)}`);
  }

  return (await response.json()) as CreateTaskResponse;
}

export async function deleteImageTask(workerUrl: string, taskId: string, uuid: string): Promise<void> {
  const baseUrl = trimTrailingSlash(workerUrl);
  const response = await fetch(`${baseUrl}/tasks/${encodeURIComponent(taskId)}?uuid=${encodeURIComponent(uuid)}`, {
    method: "DELETE",
    headers: {
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

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}
