import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { ImagePlus, SlidersHorizontal, X } from "lucide-react";
import "./App.css";
import { createImageTask, deleteImageTask, listTasks, resolveImageUrl } from "./api";
import { DEFAULT_CONFIG, getDeviceUuid, loadConfig, saveConfig } from "./storage";
import type { AppConfig, ImageTask, ReferenceImagePayload, TaskStatus } from "./types";

type ImageAspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
type ImageResolution = "1K" | "2K" | "4K";

interface ImageConfig {
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
}

const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  aspectRatio: "1:1",
  resolution: "1K"
};

const ASPECT_RATIO_OPTIONS: Array<{ value: ImageAspectRatio; label: string }> = [
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" }
];

const RESOLUTION_OPTIONS: Array<{ value: ImageResolution; label: string }> = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" }
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

const ACTIVE_STATUSES: TaskStatus[] = ["queued", "running"];
const MAX_REFERENCE_IMAGES = 16;

interface ReferenceImage extends ReferenceImagePayload {
  id: string;
}

function App() {
  const [deviceUuid] = useState(() => getDeviceUuid());
  const [config, setConfig] = useState<AppConfig>(() => loadConfig());
  const [draftConfig, setDraftConfig] = useState<AppConfig>(() => loadConfig());
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [imageConfig, setImageConfig] = useState<ImageConfig>(DEFAULT_IMAGE_CONFIG);
  const [draftImageConfig, setDraftImageConfig] = useState<ImageConfig>(DEFAULT_IMAGE_CONFIG);
  const [isImageConfigOpen, setIsImageConfigOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ImageTask | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);
  const isTaskListRequestInFlight = useRef(false);

  const hasActiveTasks = useMemo(() => tasks.some((task) => ACTIVE_STATUSES.includes(task.status)), [tasks]);

  const refreshTasks = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      if (isTaskListRequestInFlight.current) return;

      isTaskListRequestInFlight.current = true;
      if (options.showLoading) setIsRefreshing(true);

      try {
        const nextTasks = await listTasks(config.workerUrl, deviceUuid);
        setTasks(nextTasks);
        setError(null);
      } catch (refreshError) {
        setError(errorMessage(refreshError));
      } finally {
        setIsLoading(false);
        if (options.showLoading) setIsRefreshing(false);
        isTaskListRequestInFlight.current = false;
      }
    },
    [config.workerUrl, deviceUuid]
  );

  useEffect(() => {
    let isMounted = true;
    async function loadInitialTasks() {
      setIsLoading(true);
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

  function openImageConfig() {
    setDraftImageConfig(imageConfig);
    setIsImageConfigOpen(true);
  }

  function submitImageConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImageConfig(draftImageConfig);
    setIsImageConfigOpen(false);
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
    if (isSubmitting) return;

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
        size: resolveImageSize(imageConfig),
        inputImages: referenceImages.map(({ dataUrl, filename }) => ({ dataUrl, filename })),
        uuid: deviceUuid,
        config
      });
      setPrompt("");
      setReferenceImages([]);
      setNotice("任务已创建，正在生成");
      await refreshTasks();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  function requestDeleteTask(task: ImageTask) {
    if (deletingTaskId) return;
    setDeleteCandidate(task);
  }

  async function addReferenceFiles(files: FileList | File[]) {
    const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
    if (remaining <= 0) {
      setError(`最多添加 ${MAX_REFERENCE_IMAGES} 张参考图`);
      return;
    }

    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, remaining);
    if (imageFiles.length === 0) return;

    try {
      const nextImages = await Promise.all(
        imageFiles.map(async (file) => ({
          id: crypto.randomUUID(),
          filename: file.name || "reference.png",
          dataUrl: await fileToDataUrl(file)
        }))
      );
      setReferenceImages((current) => [...current, ...nextImages]);
      setError(null);
    } catch (fileError) {
      setError(errorMessage(fileError));
    }
  }

  function handleReferenceFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files) void addReferenceFiles(files);
    event.target.value = "";
  }

  async function addTaskResultAsReference(task: ImageTask) {
    const resultUrl = task.resultUrls[0] ? resolveImageUrl(config.workerUrl, task.resultUrls[0]) : null;
    if (!resultUrl) return;
    if (referenceImages.length >= MAX_REFERENCE_IMAGES) {
      setError(`最多添加 ${MAX_REFERENCE_IMAGES} 张参考图`);
      return;
    }

    try {
      const dataUrl = await fetchImageAsDataUrl(resultUrl);
      setReferenceImages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          filename: `${task.id}.png`,
          dataUrl
        }
      ]);
      setPrompt((current) => current || task.prompt);
      setNotice("已加入参考图，可以继续描述修改要求");
      setError(null);
    } catch (referenceError) {
      setError(errorMessage(referenceError));
    }
  }

  function removeReferenceImage(id: string) {
    setReferenceImages((current) => current.filter((image) => image.id !== id));
  }

  async function confirmDeleteTask() {
    if (!deleteCandidate || deletingTaskId) return;

    const task = deleteCandidate;

    setDeletingTaskId(task.id);
    setError(null);
    setNotice(null);

    try {
      await deleteImageTask(config.workerUrl, task.id, deviceUuid);
      setTasks((currentTasks) => currentTasks.filter((currentTask) => currentTask.id !== task.id));
      setDeleteCandidate(null);
      setNotice("任务已删除");
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setDeletingTaskId(null);
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
          <button
            className="ghost-button"
            disabled={isRefreshing}
            type="button"
            onClick={() => void refreshTasks({ showLoading: true })}
          >
            {isRefreshing ? "刷新中" : "刷新"}
          </button>
          <button className="ghost-button" type="button" onClick={openConfig}>
            配置
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
            <TaskCard
              isDeleting={deletingTaskId === task.id}
              isRefreshing={isRefreshing}
              key={task.id}
              onDelete={() => requestDeleteTask(task)}
              onEdit={() => void addTaskResultAsReference(task)}
              onRefresh={() => void refreshTasks({ showLoading: true })}
              task={task}
              workerUrl={config.workerUrl}
            />
          ))}
      </section>

      <form className="composer" onSubmit={(event) => void submitTask(event)}>
        {referenceImages.length > 0 ? (
          <div className="reference-strip" aria-label="参考图">
            {referenceImages.map((image, index) => (
              <div className="reference-thumb" key={image.id}>
                <img src={image.dataUrl} alt={`参考图 ${index + 1}`} />
                <button type="button" onClick={() => removeReferenceImage(image.id)} aria-label={`移除参考图 ${index + 1}`}>
                  <X size={13} strokeWidth={2.3} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={referenceImages.length > 0 ? "描述你想如何修改参考图" : "描述你想生成的图片"}
          rows={4}
        />
        <div className="composer-controls">
          <input
            accept="image/*"
            multiple
            onChange={handleReferenceFileChange}
            ref={referenceFileInputRef}
            type="file"
          />
          <button
            className="image-config-trigger"
            disabled={isSubmitting || referenceImages.length >= MAX_REFERENCE_IMAGES}
            type="button"
            onClick={() => referenceFileInputRef.current?.click()}
            aria-label="添加参考图"
          >
            <ImagePlus size={16} strokeWidth={2} aria-hidden="true" />
            <strong>参考图 {referenceImages.length}</strong>
          </button>
          <button
            className="image-config-trigger"
            disabled={isSubmitting}
            type="button"
            onClick={openImageConfig}
            aria-label={`图片配置，当前分辨率 ${resolveImageSize(imageConfig)}`}
          >
            <SlidersHorizontal size={16} strokeWidth={2} aria-hidden="true" />
            <strong>{resolveImageSize(imageConfig)}</strong>
          </button>
          <button className="primary-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "提交中" : "生成"}
          </button>
        </div>
      </form>

      {isImageConfigOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsImageConfigOpen(false)}>
          <form
            className="config-modal image-config-modal"
            onSubmit={submitImageConfig}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-title">
              <div>
                <h2>图片配置</h2>
                <p>{imageConfigSummary(draftImageConfig)}</p>
              </div>
              <button type="button" className="ghost-button" onClick={() => setIsImageConfigOpen(false)}>
                关闭
              </button>
            </div>

            <fieldset className="option-group">
              <legend>比例</legend>
              <div className="option-grid">
                {ASPECT_RATIO_OPTIONS.map((option) => (
                  <button
                    aria-pressed={draftImageConfig.aspectRatio === option.value}
                    className="option-button"
                    key={option.value}
                    onClick={() =>
                      setDraftImageConfig((current) => ({ ...current, aspectRatio: option.value }))
                    }
                    type="button"
                  >
                    <span>{option.label}</span>
                    <small>{resolveImageSize({ ...draftImageConfig, aspectRatio: option.value })}</small>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="option-group">
              <legend>分辨率</legend>
              <div className="option-grid">
                {RESOLUTION_OPTIONS.map((option) => (
                  <button
                    aria-pressed={draftImageConfig.resolution === option.value}
                    className="option-button"
                    key={option.value}
                    onClick={() =>
                      setDraftImageConfig((current) => ({ ...current, resolution: option.value }))
                    }
                    type="button"
                  >
                    <span>{option.label}</span>
                    <small>{resolveImageSize({ ...draftImageConfig, resolution: option.value })}</small>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setDraftImageConfig(DEFAULT_IMAGE_CONFIG)}>
                恢复默认
              </button>
              <button type="submit" className="primary-button">
                保存配置
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isConfigOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setIsConfigOpen(false)}>
          <form className="config-modal" onSubmit={submitConfig} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title">
              <div>
                <h2>生成配置</h2>
                <p>保存在当前浏览器，不会同步到服务端。</p>
              </div>
              <button type="button" className="ghost-button" onClick={() => setIsConfigOpen(false)}>
                关闭
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

      {deleteCandidate ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            if (!deletingTaskId) setDeleteCandidate(null);
          }}
        >
          <div
            aria-labelledby="delete-task-title"
            aria-modal="true"
            className="confirm-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modal-title">
              <div>
                <h2 id="delete-task-title">删除任务</h2>
                <p>删除后将移除任务记录和已生成图片。</p>
              </div>
            </div>
            <p className="confirm-body">{deleteCandidate.prompt}</p>
            <div className="modal-actions">
              <button
                className="ghost-button"
                disabled={Boolean(deletingTaskId)}
                type="button"
                onClick={() => setDeleteCandidate(null)}
              >
                取消
              </button>
              <button
                className="danger-button"
                disabled={Boolean(deletingTaskId)}
                type="button"
                onClick={() => void confirmDeleteTask()}
              >
                {deletingTaskId ? "删除中" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

interface TaskCardProps {
  task: ImageTask;
  workerUrl: string;
  isDeleting: boolean;
  isRefreshing: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}

function TaskCard({ task, workerUrl, isDeleting, isRefreshing, onDelete, onEdit, onRefresh }: TaskCardProps) {
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
              <button disabled={isDeleting || isRefreshing} type="button" onClick={onEdit}>
                修改
              </button>
            </>
          ) : null}
          {task.status === "failed" ? (
            <button disabled={isRefreshing || isDeleting} type="button" onClick={onRefresh}>
              {isRefreshing ? "检查中" : "重新检查"}
            </button>
          ) : null}
          <button className="danger-action" disabled={isDeleting || isRefreshing} type="button" onClick={onDelete}>
            {isDeleting ? "删除中" : "删除"}
          </button>
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

function resolveImageSize(config: ImageConfig): string {
  return IMAGE_SIZE_PRESETS[config.resolution][config.aspectRatio];
}

function imageConfigSummary(config: ImageConfig): string {
  return `${config.aspectRatio} · ${config.resolution} · ${resolveImageSize(config)}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("参考图读取失败"));
    reader.readAsDataURL(file);
  });
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`参考图读取失败：${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("结果不是可用图片");
  }

  return fileToDataUrl(new File([blob], "reference.png", { type: blob.type }));
}

function shortUuid(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;
