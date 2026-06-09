export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface AppConfig {
  workerUrl: string;
  imageType: "gpt-image-2";
  targetUrl: string;
  apiKey: string;
  model: string;
}

export interface ImageTask {
  id: string;
  uuid: string;
  status: TaskStatus;
  targetUrl: string;
  apiKeyHint: string | null;
  modelId: string;
  prompt: string;
  targetPayload: Record<string, unknown> | null;
  resultObjects: Array<{
    key: string;
    contentType: string;
    size: number;
  }>;
  resultUrls: string[];
  error: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  deletedAt?: string | null;
  updatedAt: string;
}

export interface ReferenceImagePayload {
  dataUrl: string;
  filename: string;
}

export interface TaskListResponse {
  tasks: ImageTask[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    nextOffset: number | null;
  };
}

export interface CreateTaskResponse {
  taskId: string;
  uuid: string;
  status: TaskStatus;
  createdAt: string;
}
