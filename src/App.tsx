import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { SignInButton, SignedIn, SignedOut, UserButton, useAuth, useUser } from "@clerk/clerk-react";
import { Brush, ImagePlus, SlidersHorizontal, X } from "lucide-react";
import "./App.css";
import { createImageTask, deleteImageTask, fetchImageBlobUrl, listTasks } from "./api";
import type { AppView, EditMode, ImageConfig, ImagePreview, MaskDraft, ReferenceImage } from "./appTypes";
import { MaskEditorModal } from "./components/MaskEditorModal";
import { TaskCard } from "./components/TaskCard";
import { WORKER_URL } from "./config";
import {
  ASPECT_RATIO_OPTIONS,
  DEFAULT_IMAGE_CONFIG,
  imageConfigButtonText,
  imageConfigSummary,
  QUALITY_OPTIONS,
  RESOLUTION_OPTIONS,
  resolveImageSize
} from "./imageOptions";
import type { ImageTask, TaskStatus } from "./types";
import {
  compactUrl,
  errorMessage,
  fetchImageAsDataUrl,
  fileToDataUrl,
  orderImagesForMask,
  toPayload
} from "./utils";

interface MaskEditorState {
  image: ReferenceImage;
  existingMask: MaskDraft | null;
}

const ACTIVE_STATUSES: TaskStatus[] = ["queued", "running"];
const MAX_REFERENCE_IMAGES = 16;
const TASK_CREATED_NOTICE = "任务已创建，正在生成";
const TASK_CREATED_NOTICE_TIMEOUT_MS = 3500;

function App() {
  return (
    <>
      <SignedOut>
        <SignedOutLanding />
      </SignedOut>
      <SignedIn>
        <AuthenticatedApp />
      </SignedIn>
    </>
  );
}

function SignedOutLanding() {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand">
          <div className="brand-mark">IG</div>
          <div>
            <h1>Image Gallery</h1>
            <p>登录后查看你的生成任务</p>
          </div>
        </div>
        <div className="auth-copy">
          <h2>你的图片任务会绑定到 Clerk 用户</h2>
          <p>登录后即可创建、查看、编辑和删除自己的任务；生成接口和上游密钥由 Worker 统一管理。</p>
        </div>
        <SignInButton mode="modal">
          <button className="primary-button" type="button">
            登录
          </button>
        </SignInButton>
      </section>
    </main>
  );
}

function AuthenticatedApp() {
  const { getToken, userId } = useAuth();
  const { user } = useUser();
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
  const userLabel = user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? userId ?? "已登录";

  const requireToken = useCallback(async () => {
    const token = await getToken();
    if (!token) throw new Error("登录状态已失效，请重新登录");
    return token;
  }, [getToken]);

  const getTaskImageUrl = useCallback(
    async (resultUrl: string) => {
      const token = await requireToken();
      return fetchImageBlobUrl(WORKER_URL, token, resultUrl);
    },
    [requireToken]
  );

  const refreshTasks = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      if (isTaskListRequestInFlight.current) return;

      isTaskListRequestInFlight.current = true;
      if (options.showLoading) setIsRefreshing(true);

      try {
        const token = await requireToken();
        const nextTasks = await listTasks(WORKER_URL, token);
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
    [requireToken]
  );

  useEffect(() => {
    let isMounted = true;
    async function loadInitialTasks() {
      setIsLoading(true);
      try {
        const token = await requireToken();
        const initialTasks = await listTasks(WORKER_URL, token);
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
  }, [requireToken]);

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

  function openImageConfig() {
    setDraftImageConfig(imageConfig);
    setIsImageConfigOpen(true);
  }

  function submitImageConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImageConfig(draftImageConfig);
    setIsImageConfigOpen(false);
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const finalPrompt = prompt.trim();
    if (!finalPrompt) {
      setError("请输入提示词");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const token = await requireToken();
      await createImageTask({
        workerUrl: WORKER_URL,
        token,
        prompt: finalPrompt,
        size: resolveImageSize(imageConfig),
        quality: imageConfig.quality,
        inputImages: referenceImages.map(toPayload)
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
      const token = await requireToken();
      const orderedImages = orderImagesForMask(editImages, editMode === "masked" ? maskDraft?.targetImageId : null);
      await createImageTask({
        workerUrl: WORKER_URL,
        token,
        prompt: finalPrompt,
        size: resolveImageSize(imageConfig),
        quality: imageConfig.quality,
        inputImages: orderedImages.map(toPayload),
        mask: editMode === "masked" && maskDraft ? { dataUrl: maskDraft.dataUrl, filename: "mask.png" } : null
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
    const resultUrl = task.resultUrls[0] ?? null;
    if (!resultUrl) return;
    if (editImages.length >= MAX_REFERENCE_IMAGES) {
      setError(`最多添加 ${MAX_REFERENCE_IMAGES} 张图片`);
      return;
    }

    try {
      const objectUrl = await getTaskImageUrl(resultUrl);
      let dataUrl = "";
      try {
        dataUrl = await fetchImageAsDataUrl(objectUrl);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
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
      const token = await requireToken();
      await deleteImageTask(WORKER_URL, token, task.id);
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
            <p>{userLabel}</p>
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
          <UserButton />
        </div>
      </header>

      <section className="status-strip" aria-live="polite">
        <span>接口：{compactUrl(WORKER_URL)}</span>
        <span>身份：Clerk 用户</span>
        <span>任务：{tasks.length}</span>
        <span>生成中：{tasks.filter((task) => ACTIVE_STATUSES.includes(task.status)).length}</span>
      </section>

      {notice ? <div className="notice">{notice}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      {view === "gallery" ? (
        <>
          <section className="gallery" aria-label="任务画廊">
            {isLoading ? <GallerySkeleton /> : null}
            {!isLoading && tasks.length === 0 ? <EmptyState /> : null}
            {!isLoading &&
              tasks.map((task) => (
                <TaskCard
                  isDeleting={deletingTaskId === task.id}
                  isRefreshing={isRefreshing}
                  key={task.id}
                  onDelete={() => requestDeleteTask(task)}
                  onEdit={() => void addTaskResultToEditor(task)}
                  getImageUrl={getTaskImageUrl}
                  onPreview={(preview) => setImagePreview(preview)}
                  onRefresh={() => void refreshTasks({ showLoading: true })}
                  task={task}
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

function EmptyState() {
  return (
    <div className="empty-state">
      <h2>还没有任务</h2>
      <p>在底部输入提示词创建第一张图片。任务会自动归属到当前登录用户。</p>
    </div>
  );
}

export default App;
