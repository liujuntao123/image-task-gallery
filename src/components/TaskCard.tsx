import { useEffect, useState } from "react";
import type { ImagePreview } from "../appTypes";
import type { ImageTask } from "../types";
import { errorMessage, formatElapsed, payloadText, statusText } from "../utils";

interface TaskCardProps {
  task: ImageTask;
  getImageUrl: (resultUrl: string) => Promise<string>;
  isDeleting: boolean;
  isRefreshing: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onPreview: (preview: ImagePreview) => void;
  onRefresh: () => void;
}

export function TaskCard({ task, getImageUrl, isDeleting, isRefreshing, onDelete, onEdit, onPreview, onRefresh }: TaskCardProps) {
  const firstResultUrl = task.resultUrls[0] ?? null;
  const [imageState, setImageState] = useState<{ resultUrl: string; objectUrl: string | null; error: string | null } | null>(
    null
  );
  const firstImageUrl = imageState?.resultUrl === firstResultUrl ? imageState.objectUrl : null;
  const imageLoadError = imageState?.resultUrl === firstResultUrl ? imageState.error : null;
  const elapsed = formatElapsed(task.startedAt, task.completedAt ?? task.failedAt);

  useEffect(() => {
    let revokedUrl: string | null = null;
    let cancelled = false;

    if (!firstResultUrl) return undefined;

    getImageUrl(firstResultUrl)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revokedUrl = url;
        setImageState({ resultUrl: firstResultUrl, objectUrl: url, error: null });
      })
      .catch((error) => {
        if (!cancelled) setImageState({ resultUrl: firstResultUrl, objectUrl: null, error: errorMessage(error) });
      });

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [firstResultUrl, getImageUrl]);

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
            <span>{firstResultUrl && imageLoadError ? "图片读取失败" : statusText(task.status)}</span>
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
        {imageLoadError ? <p className="task-error">{imageLoadError}</p> : null}
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
