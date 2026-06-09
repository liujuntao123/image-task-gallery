import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import { createImageTask, listTasks, resolveImageUrl } from "./api";
import { DEFAULT_CONFIG, getDeviceUuid, loadConfig, saveConfig } from "./storage";
import type { AppConfig, ImageTask, TaskStatus } from "./types";

const SIZE_OPTIONS = ["1024x1024", "1536x1536", "2048x2048"];
const QUALITY_OPTIONS = ["auto", "high", "medium", "low"];
const ACTIVE_STATUSES: TaskStatus[] = ["queued", "running"];

function App() {
  const [deviceUuid] = useState(() => getDeviceUuid());
  const [config, setConfig] = useState<AppConfig>(() => loadConfig());
  const [draftConfig, setDraftConfig] = useState<AppConfig>(() => loadConfig());
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState("auto");
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasActiveTasks = useMemo(() => tasks.some((task) => ACTIVE_STATUSES.includes(task.status)), [tasks]);

  useEffect(() => {
    let isMounted = true;
    async function loadInitialTasks() {
      try {
        const initialTasks = await listTasks(config.workerUrl, deviceUuid);
        if (!isMounted) return;
        setTasks(initialTasks);
        setError(null);
      } catch (loadError) {
        if (!isMounted) return;
        setError(errorMessage(loadError));
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadInitialTasks();
    return () => {
      isMounted = false;
    };
  }, [config.workerUrl, deviceUuid]);

  const refreshTasks = useCallback(async () => {
    try {
      const nextTasks = await listTasks(config.workerUrl, deviceUuid);
      setTasks(nextTasks);
      setError(null);
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    } finally {
      setIsLoading(false);
    }
  }, [config.workerUrl, deviceUuid]);

  useEffect(() => {
    const intervalMs = hasActiveTasks ? 3000 : 12000;
    const timer = window.setInterval(() => {
      void refreshTasks();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [hasActiveTasks, refreshTasks]);

  function openConfig() {
    setDraftConfig(config);
    setIsConfigOpen(true);
  }

  function submitConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextConfig = {
      ...draftConfig,
      imageType: "gpt-image-2" as const,
      workerUrl: draftConfig.workerUrl.trim(),
      targetUrl: draftConfig.targetUrl.trim(),
      apiKey: draftConfig.apiKey.trim(),
      model: draftConfig.model.trim() || "gpt-image-2"
    };
    saveConfig(nextConfig);
    setConfig(nextConfig);
    setIsConfigOpen(false);
    setNotice("配置已保存");
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const finalPrompt = prompt.trim();
    if (!config.apiKey) {
      setNotice(null);
      setError("请先在配置里填写 key");
      setIsConfigOpen(true);
      return;
    }
    if (!finalPrompt) {
      setError("请输入提示词");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      await createImageTask({
        prompt: finalPrompt,
        size,
        quality,
        uuid: deviceUuid,
        config
      });
      setPrompt("");
      setNotice("任务已创建，正在生成");
      await refreshTasks();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">IG</div>
          <div>
            <h1>Image Gallery</h1>
            <p>设备任务：{shortUuid(deviceUuid)}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" type="button" onClick={() => void refreshTasks()}>
            刷新
          </button>
          <button className="icon-button" type="button" aria-label="打开配置" onClick={openConfig}>
            ⚙
          </button>
        </div>
      </header>

      <section className="status-strip" aria-live="polite">
        <span>接口：{compactUrl(config.targetUrl)}</span>
        <span>模型：{config.model}</span>
        <span>任务：{tasks.length}</span>
        <span>生成中：{tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).length}</span>
      </section>

      {notice ? <div className="notice">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="gallery" aria-label="任务画廊">
        {isLoading ? <GallerySkeleton /> : null}
        {!isLoading && tasks.length === 0 ? <EmptyState onConfigure={openConfig} /> : null}
        {!isLoading &&
          tasks.map((task) => (
            <TaskCard key={task.id} task={task} workerUrl={config.workerUrl} onRefresh={() => void refreshTasks()} />
          ))}
      </section>

      <form className="composer" onSubmit={(event) => void submitTask(event)}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="描述你想生成的图片"
          rows={2}
        />
        <div className="composer-controls">
          <label>
            尺寸
            <select value={size} onChange={(event) => setSize(event.target.value)}>
              {SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            质量
            <select value={quality} onChange={(event) => setQuality(event.target.value)}>
              {QUALITY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "提交中" : "生成"}
          </button>
        </div>
      </form>

      {isConfigOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsConfigOpen(false)}>
          <form className="config-modal" onSubmit={submitConfig} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title">
              <div>
                <h2>生成配置</h2>
                <p>保存在当前浏览器，不会同步到服务端。</p>
              </div>
              <button type="button" className="icon-button" aria-label="关闭配置" onClick={() => setIsConfigOpen(false)}>
                ×
              </button>
            </div>

            <label>
              image 类型
              <select
                value={draftConfig.imageType}
                onChange={() => setDraftConfig((current) => ({ ...current, imageType: "gpt-image-2" }))}
              >
                <option value="gpt-image-2">gpt-image-2</option>
              </select>
            </label>
            <label>
              Worker URL
              <input
                value={draftConfig.workerUrl}
                onChange={(event) => setDraftConfig((current) => ({ ...current, workerUrl: event.target.value }))}
                placeholder={DEFAULT_CONFIG.workerUrl}
              />
            </label>
            <label>
              URL
              <input
                value={draftConfig.targetUrl}
                onChange={(event) => setDraftConfig((current) => ({ ...current, targetUrl: event.target.value }))}
                placeholder="https://example.com/v1/images/generations"
              />
            </label>
            <label>
              key
              <input
                value={draftConfig.apiKey}
                onChange={(event) => setDraftConfig((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder="sk-..."
                type="password"
              />
            </label>
            <label>
              model
              <input
                value={draftConfig.model}
                onChange={(event) => setDraftConfig((current) => ({ ...current, model: event.target.value }))}
                placeholder="gpt-image-2"
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setDraftConfig(DEFAULT_CONFIG)}>
                恢复默认
              </button>
              <button type="submit" className="primary-button">
                保存配置
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

interface TaskCardProps {
  task: ImageTask;
  workerUrl: string;
  onRefresh: () => void;
}

function TaskCard({ task, workerUrl, onRefresh }: TaskCardProps) {
  const firstImageUrl = task.resultUrls[0] ? resolveImageUrl(workerUrl, task.resultUrls[0]) : null;
  const elapsed = formatElapsed(task.startedAt, task.completedAt ?? task.failedAt);

  return (
    <article className={`task-card task-${task.status}`}>
      <div className="image-frame">
        {firstImageUrl ? (
          <img src={firstImageUrl} alt={task.prompt} loading="lazy" />
        ) : (
          <div className="placeholder">
            <span>{statusText(task.status)}</span>
          </div>
        )}
        <span className={`status-pill ${task.status}`}>{statusText(task.status)}</span>
      </div>
      <div className="task-meta">
        <p className="prompt-text">{task.prompt}</p>
        <div className="meta-row">
          <span>{payloadText(task, "size")}</span>
          <span>{task.modelId || payloadText(task, "model")}</span>
          <span>{elapsed}</span>
        </div>
        {task.error ? <p className="task-error">{task.error}</p> : null}
        <div className="task-actions">
          {firstImageUrl ? (
            <>
              <a href={firstImageUrl} target="_blank" rel="noreferrer">
                打开
              </a>
              <a href={firstImageUrl} download={`${task.id}.png`}>
                下载
              </a>
            </>
          ) : null}
          {task.status === "failed" ? (
            <button type="button" onClick={onRefresh}>
              重新检查
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function GallerySkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="task-card skeleton" key={index}>
          <div className="image-frame" />
          <div className="task-meta">
            <div />
            <div />
          </div>
        </div>
      ))}
    </>
  );
}

function EmptyState({ onConfigure }: { onConfigure: () => void }) {
  return (
    <div className="empty-state">
      <h2>还没有任务</h2>
      <p>先完成接口配置，然后在底部输入提示词创建第一张图片。</p>
      <button className="primary-button" type="button" onClick={onConfigure}>
        打开配置
      </button>
    </div>
  );
}

function statusText(status: TaskStatus): string {
  const text: Record<TaskStatus, string> = {
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败"
  };
  return text[status];
}

function payloadText(task: ImageTask, key: string): string {
  const value = task.targetPayload?.[key];
  return typeof value === "string" && value ? value : "-";
}

function formatElapsed(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt) return "未开始";
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}

function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.host;
  } catch {
    return value || "未配置";
  }
}

function shortUuid(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;
