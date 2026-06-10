import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { Brush, Eraser, ImagePlus, SlidersHorizontal, X } from "lucide-react";
import "./App.css";
import { createImageTask, deleteImageTask, listTasks, resolveImageUrl } from "./api";
import { DEFAULT_CONFIG, getDeviceUuid, loadConfig, saveConfig } from "./storage";
import type { AppConfig, ImageTask, ReferenceImagePayload, TaskStatus } from "./types";

type AppView = "gallery" | "edit";
type EditMode = "global" | "masked";
type MaskTool = "brush" | "eraser";
type ImageAspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
type ImageResolution = "1K" | "2K" | "4K";
type ImageQuality = "low" | "medium" | "high";

interface ImageConfig {
  aspectRatio: ImageAspectRatio;
  resolution: ImageResolution;
  quality: ImageQuality;
}

interface ReferenceImage extends ReferenceImagePayload {
  id: string;
}

interface MaskDraft {
  targetImageId: string;
  dataUrl: string;
  previewDataUrl: string;
  coverage: number;
}

interface ImagePreview {
  url: string;
  alt: string;
  prompt: string;
}

interface MaskEditorState {
  image: ReferenceImage;
  existingMask: MaskDraft | null;
}

const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  aspectRatio: "1:1",
  resolution: "1K",
  quality: "high"
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

const QUALITY_OPTIONS: Array<{ value: ImageQuality; label: string; description: string }> = [
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

const ACTIVE_STATUSES: TaskStatus[] = ["queued", "running"];
const MAX_REFERENCE_IMAGES = 16;
const TASK_CREATED_NOTICE = "任务已创建，正在生成";
const TASK_CREATED_NOTICE_TIMEOUT_MS = 3500;

function App() {
  const [deviceUuid] = useState(() => getDeviceUuid());
  const [config, setConfig] = useState<AppConfig>(() => loadConfig());
  const [draftConfig, setDraftConfig] = useState<AppConfig>(() => loadConfig());
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [view, setView] = useState<AppView>("gallery");
  const [imageConfig, setImageConfig] = useState<ImageConfig>(DEFAULT_IMAGE_CONFIG);
  const [draftImageConfig, setDraftImageConfig] = useState<ImageConfig>(DEFAULT_IMAGE_CONFIG);
  const [isImageConfigOpen, setIsImageConfigOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [editPrompt, setEditPrompt] = useState("");
  const [editImages, setEditImages] = useState<ReferenceImage[]>([]);
  const [editMode, setEditMode] = useState<EditMode>("global");
  const [maskDraft, setMaskDraft] = useState<MaskDraft | null>(null);
  const [maskEditor, setMaskEditor] = useState<MaskEditorState | null>(null);
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ImageTask | null>(null);
  const [imagePreview, setImagePreview] = useState<ImagePreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const isTaskListRequestInFlight = useRef(false);

  const hasActiveTasks = useMemo(() => tasks.some((task) => ACTIVE_STATUSES.includes(task.status)), [tasks]);
  const editMaskTarget = editImages.find((image) => image.id === maskDraft?.targetImageId) ?? editImages[0] ?? null;

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

  useEffect(() => {
    if (notice !== TASK_CREATED_NOTICE) return undefined;

    const timer = window.setTimeout(() => {
      setNotice((currentNotice) => (currentNotice === TASK_CREATED_NOTICE ? null : currentNotice));
    }, TASK_CREATED_NOTICE_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!imagePreview && !maskEditor) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setImagePreview(null);
        setMaskEditor(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [imagePreview, maskEditor]);

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
    if (!ensureConfigured()) return;
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
        quality: imageConfig.quality,
        inputImages: referenceImages.map(toPayload),
        uuid: deviceUuid,
        config
      });
      setPrompt("");
      setReferenceImages([]);
      setNotice(TASK_CREATED_NOTICE);
      await refreshTasks();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitEditTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const finalPrompt = editPrompt.trim();
    if (!ensureConfigured()) return;
    if (editImages.length === 0) {
      setError("请先添加要编辑的图片");
      return;
    }
    if (!finalPrompt) {
      setError("请输入编辑要求");
      return;
    }
    if (editMode === "masked" && !maskDraft) {
      setError("局部编辑需要先涂抹遮罩区域");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const orderedImages = orderImagesForMask(editImages, editMode === "masked" ? maskDraft?.targetImageId : null);
      await createImageTask({
        prompt: finalPrompt,
        size: resolveImageSize(imageConfig),
        quality: imageConfig.quality,
        inputImages: orderedImages.map(toPayload),
        mask: editMode === "masked" && maskDraft ? { dataUrl: maskDraft.dataUrl, filename: "mask.png" } : null,
        uuid: deviceUuid,
        config
      });
      setEditPrompt("");
      setMaskDraft(null);
      setNotice(editMode === "masked" ? "局部编辑任务已创建" : "整体编辑任务已创建");
      await refreshTasks();
      setView("gallery");
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  function ensureConfigured(): boolean {
    if (!config.apiKey) {
      setNotice(null);
      setError("请先在配置里填写 key");
      setIsConfigOpen(true);
      return false;
    }
    return true;
  }

  function requestDeleteTask(task: ImageTask) {
    if (deletingTaskId) return;
    setDeleteCandidate(task);
  }

  async function addFiles(files: FileList | File[], target: "reference" | "edit") {
    const currentImages = target === "reference" ? referenceImages : editImages;
    const remaining = MAX_REFERENCE_IMAGES - currentImages.length;
    if (remaining <= 0) {
      setError(`最多添加 ${MAX_REFERENCE_IMAGES} 张图片`);
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
      if (target === "reference") {
        setReferenceImages((current) => [...current, ...nextImages]);
      } else {
        setEditImages((current) => [...current, ...nextImages]);
      }
      setError(null);
    } catch (fileError) {
      setError(errorMessage(fileError));
    }
  }

  function handleReferenceFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files) void addFiles(files, "reference");
    event.target.value = "";
  }

  function handleEditFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files) void addFiles(files, "edit");
    event.target.value = "";
  }

  async function addTaskResultToEditor(task: ImageTask) {
    const resultUrl = task.resultUrls[0] ? resolveImageUrl(config.workerUrl, task.resultUrls[0]) : null;
    if (!resultUrl) return;
    if (editImages.length >= MAX_REFERENCE_IMAGES) {
      setError(`最多添加 ${MAX_REFERENCE_IMAGES} 张图片`);
      return;
    }

    try {
      const dataUrl = await fetchImageAsDataUrl(resultUrl);
      setEditImages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          filename: `${task.id}.png`,
          dataUrl
        }
      ]);
      setEditPrompt((current) => current || task.prompt);
      setView("edit");
      setNotice("已放入图片编辑页");
      setError(null);
    } catch (referenceError) {
      setError(errorMessage(referenceError));
    }
  }

  function removeReferenceImage(id: string) {
    setReferenceImages((current) => current.filter((image) => image.id !== id));
  }

  function removeEditImage(id: string) {
    setEditImages((current) => current.filter((image) => image.id !== id));
    setMaskDraft((current) => (current?.targetImageId === id ? null : current));
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
          <div className="view-switch" aria-label="页面">
            <button aria-pressed={view === "gallery"} type="button" onClick={() => setView("gallery")}>
              画廊
            </button>
            <button aria-pressed={view === "edit"} type="button" onClick={() => setView("edit")}>
              图片编辑
            </button>
          </div>
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

      {view === "gallery" ? (
        <>
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
                  onEdit={() => void addTaskResultToEditor(task)}
                  onPreview={(preview) => setImagePreview(preview)}
                  onRefresh={() => void refreshTasks({ showLoading: true })}
                  task={task}
                  workerUrl={config.workerUrl}
                />
              ))}
          </section>

          <form className="composer" onSubmit={(event) => void submitTask(event)}>
            {referenceImages.length > 0 ? (
              <ReferenceStrip images={referenceImages} label="参考图" onRemove={removeReferenceImage} />
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
              <ImageConfigButton config={imageConfig} disabled={isSubmitting} onClick={openImageConfig} />
              <button className="primary-button" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "提交中" : "生成"}
              </button>
            </div>
          </form>
        </>
      ) : (
        <section className="edit-page" aria-label="图片编辑">
          <div className="edit-workbench">
            <div className="edit-canvas-panel">
              {editMaskTarget ? (
                <div className="edit-preview-frame">
                  <img src={editMaskTarget.dataUrl} alt="编辑主图" />
                  {maskDraft ? (
                    <img className="mask-preview-overlay" src={maskDraft.previewDataUrl} alt="" aria-hidden="true" />
                  ) : null}
                </div>
              ) : (
                <div className="edit-dropzone">
                  <ImagePlus size={34} strokeWidth={1.8} aria-hidden="true" />
                  <p>添加图片后开始编辑</p>
                </div>
              )}
            </div>

            <form className="edit-panel" onSubmit={(event) => void submitEditTask(event)}>
              <div className="panel-heading">
                <h2>图片编辑</h2>
                <button
                  className="ghost-button"
                  disabled={isSubmitting || editImages.length >= MAX_REFERENCE_IMAGES}
                  type="button"
                  onClick={() => editFileInputRef.current?.click()}
                >
                  添加图片
                </button>
                <input accept="image/*" multiple onChange={handleEditFileChange} ref={editFileInputRef} type="file" />
              </div>

              <div className="mode-switch" aria-label="编辑方式">
                <button aria-pressed={editMode === "global"} type="button" onClick={() => setEditMode("global")}>
                  整体编辑
                </button>
                <button aria-pressed={editMode === "masked"} type="button" onClick={() => setEditMode("masked")}>
                  局部编辑
                </button>
              </div>

              {editImages.length > 0 ? (
                <ReferenceStrip images={editImages} label="编辑图片" onRemove={removeEditImage} />
              ) : null}

              <div className="mask-controls">
                <button
                  className="image-config-trigger"
                  disabled={editImages.length === 0 || isSubmitting}
                  type="button"
                  onClick={() => {
                    const target = editMaskTarget;
                    if (target) {
                      setEditMode("masked");
                      setMaskEditor({ image: target, existingMask: maskDraft });
                    }
                  }}
                >
                  <Brush size={16} strokeWidth={2} aria-hidden="true" />
                  <strong>{maskDraft ? `遮罩 ${(maskDraft.coverage * 100).toFixed(0)}%` : "绘制遮罩"}</strong>
                </button>
                {maskDraft ? (
                  <button className="ghost-button" disabled={isSubmitting} type="button" onClick={() => setMaskDraft(null)}>
                    清除遮罩
                  </button>
                ) : null}
                <ImageConfigButton config={imageConfig} disabled={isSubmitting} onClick={openImageConfig} />
              </div>

              <textarea
                value={editPrompt}
                onChange={(event) => setEditPrompt(event.target.value)}
                placeholder={editMode === "masked" ? "描述涂抹区域要变成什么" : "描述整张图片需要如何调整"}
                rows={7}
              />

              <div className="modal-actions">
                <button
                  className="ghost-button"
                  disabled={isSubmitting}
                  type="button"
                  onClick={() => {
                    setEditPrompt("");
                    setEditImages([]);
                    setMaskDraft(null);
                  }}
                >
                  清空
                </button>
                <button className="primary-button" disabled={isSubmitting} type="submit">
                  {isSubmitting ? "提交中" : editMode === "masked" ? "提交局部编辑" : "提交整体编辑"}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

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
                    onClick={() => setDraftImageConfig((current) => ({ ...current, aspectRatio: option.value }))}
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
                    onClick={() => setDraftImageConfig((current) => ({ ...current, resolution: option.value }))}
                    type="button"
                  >
                    <span>{option.label}</span>
                    <small>{resolveImageSize({ ...draftImageConfig, resolution: option.value })}</small>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="option-group">
              <legend>质量</legend>
              <div className="option-grid quality-grid">
                {QUALITY_OPTIONS.map((option) => (
                  <button
                    aria-pressed={draftImageConfig.quality === option.value}
                    className="option-button"
                    key={option.value}
                    onClick={() => setDraftImageConfig((current) => ({ ...current, quality: option.value }))}
                    type="button"
                  >
                    <span>{option.label}</span>
                    <small>{option.description}</small>
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

      {imagePreview ? (
        <div className="preview-backdrop" role="presentation" onMouseDown={() => setImagePreview(null)}>
          <div aria-label="查看图片" aria-modal="true" className="preview-modal" role="dialog">
            <button className="preview-close" type="button" onClick={() => setImagePreview(null)} aria-label="关闭预览">
              <X size={22} strokeWidth={2.2} aria-hidden="true" />
            </button>
            <img src={imagePreview.url} alt={imagePreview.alt} onMouseDown={(event) => event.stopPropagation()} />
            <div className="preview-caption" onMouseDown={(event) => event.stopPropagation()}>
              <p>{imagePreview.prompt}</p>
              <a href={imagePreview.url} target="_blank" rel="noreferrer">
                打开原图
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {maskEditor ? (
        <MaskEditorModal
          image={maskEditor.image}
          initialMask={maskEditor.existingMask?.dataUrl ?? null}
          onCancel={() => setMaskEditor(null)}
          onSave={(draft) => {
            setMaskDraft(draft);
            setMaskEditor(null);
          }}
        />
      ) : null}
    </main>
  );
}

function ImageConfigButton({ config, disabled, onClick }: { config: ImageConfig; disabled: boolean; onClick: () => void }) {
  return (
    <button
      className="image-config-trigger"
      disabled={disabled}
      type="button"
      onClick={onClick}
      aria-label={`图片配置，当前分辨率 ${resolveImageSize(config)}`}
    >
      <SlidersHorizontal size={16} strokeWidth={2} aria-hidden="true" />
      <strong>{imageConfigButtonText(config)}</strong>
    </button>
  );
}

function ReferenceStrip({
  images,
  label,
  onRemove
}: {
  images: ReferenceImage[];
  label: string;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="reference-strip" aria-label={label}>
      {images.map((image, index) => (
        <div className="reference-thumb" key={image.id}>
          <img src={image.dataUrl} alt={`${label} ${index + 1}`} />
          <button type="button" onClick={() => onRemove(image.id)} aria-label={`移除${label} ${index + 1}`}>
            <X size={13} strokeWidth={2.3} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

function MaskEditorModal({
  image,
  initialMask,
  onCancel,
  onSave
}: {
  image: ReferenceImage;
  initialMask: string | null;
  onCancel: () => void;
  onSave: (draft: MaskDraft) => void;
}) {
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [tool, setTool] = useState<MaskTool>("brush");
  const [brushSize, setBrushSize] = useState(72);
  const [coverage, setCoverage] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function prepare() {
      try {
        const sourceImage = await loadImage(image.dataUrl);
        if (cancelled) return;
        const width = sourceImage.naturalWidth;
        const height = sourceImage.naturalHeight;
        for (const canvas of [imageCanvasRef.current, maskCanvasRef.current, overlayCanvasRef.current]) {
          if (!canvas) throw new Error("当前浏览器不支持 Canvas");
          canvas.width = width;
          canvas.height = height;
        }

        const imageCtx = requiredContext(imageCanvasRef.current);
        imageCtx.clearRect(0, 0, width, height);
        imageCtx.drawImage(sourceImage, 0, 0, width, height);

        const maskCtx = requiredContext(maskCanvasRef.current);
        maskCtx.clearRect(0, 0, width, height);
        maskCtx.fillStyle = "#ffffff";
        maskCtx.fillRect(0, 0, width, height);

        if (initialMask) {
          const maskImage = await loadImage(initialMask);
          if (cancelled) return;
          maskCtx.drawImage(maskImage, 0, 0, width, height);
        }

        renderMaskOverlay();
        setCoverage(calculateMaskCoverage(maskCanvasRef.current));
        setIsReady(true);
      } catch (loadError) {
        if (!cancelled) setError(errorMessage(loadError));
      }
    }

    void prepare();
    return () => {
      cancelled = true;
    };
  }, [image.dataUrl, initialMask]);

  function renderMaskOverlay() {
    const maskCanvas = maskCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!maskCanvas || !overlayCanvas) return;
    const maskCtx = requiredContext(maskCanvas);
    const overlayCtx = requiredContext(overlayCanvas);
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const overlayData = overlayCtx.createImageData(maskCanvas.width, maskCanvas.height);
    for (let i = 0; i < maskData.data.length; i += 4) {
      const alpha = maskData.data[i + 3];
      if (alpha < 250) {
        overlayData.data[i] = 27;
        overlayData.data[i + 1] = 124;
        overlayData.data[i + 2] = 171;
        overlayData.data[i + 3] = 132;
      }
    }
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.putImageData(overlayData, 0, 0);
  }

  function getPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function drawTo(point: { x: number; y: number }) {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = requiredContext(canvas);
    const previous = lastPointRef.current ?? point;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    if (tool === "brush") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "#ffffff";
    }
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();
    lastPointRef.current = point;
    renderMaskOverlay();
  }

  function endStroke() {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    setCoverage(calculateMaskCoverage(maskCanvasRef.current));
  }

  function clearMask() {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = requiredContext(canvas);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    renderMaskOverlay();
    setCoverage(0);
  }

  function saveMask() {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const nextCoverage = calculateMaskCoverage(canvas);
    if (nextCoverage <= 0) {
      setError("请先涂抹需要编辑的区域");
      return;
    }
    onSave({
      targetImageId: image.id,
      dataUrl: canvas.toDataURL("image/png"),
      previewDataUrl: overlayCanvasRef.current?.toDataURL("image/png") ?? canvas.toDataURL("image/png"),
      coverage: nextCoverage
    });
  }

  return (
    <div className="preview-backdrop mask-backdrop" role="presentation" onMouseDown={onCancel}>
      <div className="mask-editor" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mask-toolbar">
          <div className="mode-switch">
            <button aria-pressed={tool === "brush"} type="button" onClick={() => setTool("brush")}>
              <Brush size={16} aria-hidden="true" />
              涂抹
            </button>
            <button aria-pressed={tool === "eraser"} type="button" onClick={() => setTool("eraser")}>
              <Eraser size={16} aria-hidden="true" />
              擦除
            </button>
          </div>
          <label className="brush-size">
            画笔
            <input
              max={180}
              min={16}
              onChange={(event) => setBrushSize(Number(event.target.value))}
              type="range"
              value={brushSize}
            />
          </label>
          <span className="mask-coverage">区域 {(coverage * 100).toFixed(0)}%</span>
          <button className="ghost-button" type="button" onClick={clearMask}>
            清空
          </button>
          <button className="ghost-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary-button" disabled={!isReady} type="button" onClick={saveMask}>
            保存遮罩
          </button>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="mask-stage">
          <canvas ref={imageCanvasRef} aria-hidden="true" />
          <canvas ref={maskCanvasRef} aria-hidden="true" hidden />
          <canvas
            ref={overlayCanvasRef}
            onPointerDown={(event) => {
              const point = getPoint(event);
              if (!point) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              isDrawingRef.current = true;
              lastPointRef.current = point;
              drawTo(point);
            }}
            onPointerMove={(event) => {
              if (!isDrawingRef.current) return;
              const point = getPoint(event);
              if (point) drawTo(point);
            }}
            onPointerCancel={endStroke}
            onPointerLeave={endStroke}
            onPointerUp={endStroke}
            aria-label="遮罩绘制区域"
          />
        </div>
      </div>
    </div>
  );
}

interface TaskCardProps {
  task: ImageTask;
  workerUrl: string;
  isDeleting: boolean;
  isRefreshing: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onPreview: (preview: ImagePreview) => void;
  onRefresh: () => void;
}

function TaskCard({ task, workerUrl, isDeleting, isRefreshing, onDelete, onEdit, onPreview, onRefresh }: TaskCardProps) {
  const firstImageUrl = task.resultUrls[0] ? resolveImageUrl(workerUrl, task.resultUrls[0]) : null;
  const elapsed = formatElapsed(task.startedAt, task.completedAt ?? task.failedAt);

  return (
    <article className={`task-card task-${task.status}`}>
      <div className="image-frame">
        {firstImageUrl ? (
          <button
            className="image-preview-trigger"
            type="button"
            onClick={() => onPreview({ url: firstImageUrl, alt: task.prompt, prompt: task.prompt })}
            aria-label="全屏查看图片"
          >
            <img src={firstImageUrl} alt={task.prompt} loading="lazy" />
          </button>
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
  return `${config.aspectRatio} · ${config.resolution} · ${resolveImageSize(config)} · ${qualityLabel(config.quality)}`;
}

function imageConfigButtonText(config: ImageConfig): string {
  return `${resolveImageSize(config)} · ${qualityLabel(config.quality)}`;
}

function qualityLabel(quality: ImageQuality): string {
  const text: Record<ImageQuality, string> = {
    low: "Low",
    medium: "Medium",
    high: "High"
  };
  return text[quality];
}

function toPayload(image: ReferenceImage): ReferenceImagePayload {
  return {
    dataUrl: image.dataUrl,
    filename: image.filename
  };
}

function orderImagesForMask(images: ReferenceImage[], maskTargetImageId: string | null | undefined): ReferenceImage[] {
  if (!maskTargetImageId) return images;
  const index = images.findIndex((image) => image.id === maskTargetImageId);
  if (index <= 0) return images;
  const nextImages = [...images];
  const [target] = nextImages.splice(index, 1);
  return [target, ...nextImages];
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

function requiredContext(canvas: HTMLCanvasElement | null): CanvasRenderingContext2D {
  const context = canvas?.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器不支持 Canvas");
  return context;
}

function calculateMaskCoverage(canvas: HTMLCanvasElement | null): number {
  if (!canvas) return 0;
  const context = requiredContext(canvas);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) transparent += 1;
  }
  return transparent / (canvas.width * canvas.height);
}

function shortUuid(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;
