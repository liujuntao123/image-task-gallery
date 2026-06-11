import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Brush, Eraser } from "lucide-react";
import type { MaskDraft, MaskTool, ReferenceImage } from "../appTypes";
import { calculateMaskCoverage, errorMessage, loadImage, requiredContext } from "../utils";

interface MaskEditorModalProps {
  image: ReferenceImage;
  initialMask: string | null;
  onCancel: () => void;
  onSave: (draft: MaskDraft) => void;
}

export function MaskEditorModal({ image, initialMask, onCancel, onSave }: MaskEditorModalProps) {
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
