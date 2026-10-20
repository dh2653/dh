import { useEffect, useRef, useState, useTransition } from "react";
import "./App.css";
import { downloadReassemblyGif, exportPartsZip, buildReassemblyGif } from "./lib/export";
import { drawProject } from "./lib/render";
import { proposePartsBest } from "./lib/propose";
import {
  addPart,
  floodFill,
  paintBrush,
  proposePartsLocal,
} from "./lib/segment";
import type { AppStep, ProjectState, Tool } from "./types";

export default function App() {
  const [step, setStep] = useState<AppStep>("landing");
  const [project, setProject] = useState<ProjectState | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(14);
  const [overlayOpacity, setOverlayOpacity] = useState(0.42);
  const [showLabels, setShowLabels] = useState(true);
  const [dimOthers, setDimOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("이미지를 올리면 파츠를 제안합니다.");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const redraw = (proj: ProjectState) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = proj.width;
    canvas.height = proj.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawProject(ctx, proj, {
      overlayOpacity,
      showLabels,
      selectedId,
      dimOthers,
    });
  };

  useEffect(() => {
    if (project) redraw(project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, overlayOpacity, showLabels, selectedId, dimOthers]);

  useEffect(() => {
    return () => {
      if (gifUrl) URL.revokeObjectURL(gifUrl);
    };
  }, [gifUrl]);

  const runPropose = async (blob: Blob) => {
    setBusy(true);
    setStatus("U2Net 배경 분리 · 파츠 워터셰드 중…");
    try {
      await new Promise((r) => setTimeout(r, 30));
      const { project: next, info } = await proposePartsBest(blob);
      startTransition(() => {
        setProject(next);
        setSelectedId(next.parts[0]?.id ?? null);
        setStep("workspace");
        const engineLabel =
          info.via === "api"
            ? `엔진 ${info.engine}`
            : `오프라인 fallback (${info.engine})`;
        setStatus(
          next.parts.length
            ? `${next.parts.length}개 파츠 제안 · ${engineLabel} · 브러시로 다듬기`
            : "전경을 찾지 못했습니다. 배경이 단순한 이미지를 올려 주세요.",
        );
        setGifUrl(null);
      });
    } catch (e) {
      console.error(e);
      setStatus("처리 실패. 다른 이미지로 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void runPropose(file);
  };

  const canvasPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const mutateLabels = (fn: (p: ProjectState) => void) => {
    setProject((prev) => {
      if (!prev) return prev;
      const next: ProjectState = {
        ...prev,
        labels: new Uint16Array(prev.labels),
        parts: prev.parts.map((p) => ({ ...p })),
      };
      fn(next);
      return next;
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!project) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = canvasPos(e);
    if (tool === "fill") {
      const id = selectedId ?? 0;
      mutateLabels((p) => floodFill(p, Math.floor(x), Math.floor(y), id));
      return;
    }
    if (tool === "brush" || tool === "eraser") {
      painting.current = true;
      const id = tool === "eraser" ? 0 : (selectedId ?? 0);
      if (tool === "brush" && selectedId == null) {
        setStatus("왼쪽 목록에서 파츠를 선택한 뒤 브러시를 쓰세요.");
        return;
      }
      mutateLabels((p) => paintBrush(p.labels, p.width, p.height, x, y, brushSize, id));
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!painting.current || !project) return;
    const { x, y } = canvasPos(e);
    const id = tool === "eraser" ? 0 : (selectedId ?? 0);
    mutateLabels((p) => paintBrush(p.labels, p.width, p.height, x, y, brushSize, id));
  };

  const onPointerUp = () => {
    painting.current = false;
  };

  const renameSelected = (name: string) => {
    if (selectedId == null) return;
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        parts: prev.parts.map((p) => (p.id === selectedId ? { ...p, name } : p)),
      };
    });
  };

  const handleAddPart = () => {
    setProject((prev) => {
      if (!prev) return prev;
      const copy = { ...prev, parts: [...prev.parts] };
      const part = addPart(copy);
      setSelectedId(part.id);
      setStatus(`새 파츠 “${part.name}” 추가 · 브러시/채우기로 마스크를 칠하세요.`);
      return copy;
    });
  };

  const handleExportZip = async () => {
    if (!project) return;
    setStatus("PNG zip 생성 중…");
    await exportPartsZip(project);
    setStatus("parts-export.zip 다운로드 완료.");
  };

  const handleGif = async () => {
    if (!project) return;
    setStatus("재조립 GIF 생성 중…");
    const blob = await buildReassemblyGif(project);
    if (gifUrl) URL.revokeObjectURL(gifUrl);
    const url = URL.createObjectURL(blob);
    setGifUrl(url);
    setStatus("재조립 GIF 준비됨 · 미리보기 또는 다운로드.");
  };

  const handleGifDownload = async () => {
    if (!project) return;
    await downloadReassemblyGif(project);
  };

  if (step === "landing") {
    return (
      <div className="app">
        <section className="landing">
          <div className="landing-inner">
            <h1 className="brand">파츠 제작</h1>
            <p className="headline">캐릭터를 올리고, 파츠로 쪼개세요.</p>
            <p className="sub">
              AI 제안 마스크를 다듬고, 투명 PNG와 재조립 GIF로 원본이 다시 쌓이는지
              확인합니다.
            </p>
            <div className="cta-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? "처리 중…" : "이미지 업로드"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    try {
                      const res = await fetch("/demo-character.png");
                      if (!res.ok) throw new Error("sample missing");
                      const blob = await res.blob();
                      await runPropose(blob);
                    } catch (e) {
                      console.error(e);
                      setStatus("샘플 로드 실패");
                    }
                  })();
                }}
              >
                샘플로 체험
              </button>
            </div>
            <p className="hint">
              Phase 1.5 · rembg(U2Net) + 워터셰드 파츠 제안 · 브러시로 다듬기
            </p>
            <input
              ref={fileRef}
              className="hidden-file"
              type="file"
              accept="image/*"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>
        </section>
      </div>
    );
  }

  const selected = project?.parts.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="app">
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-brand">파츠 제작</div>
          <div className="topbar-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => fileRef.current?.click()}
            >
              다른 이미지
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!project || busy}
              onClick={() => {
                if (!project) return;
                setBusy(true);
                setStatus("다시 제안 중…");
                // Re-run from current raster as PNG blob
                void (async () => {
                  try {
                    const c = document.createElement("canvas");
                    c.width = project.width;
                    c.height = project.height;
                    c.getContext("2d")!.putImageData(project.source, 0, 0);
                    const blob = await new Promise<Blob | null>((res) =>
                      c.toBlob(res, "image/png"),
                    );
                    if (!blob) throw new Error("encode failed");
                    const { project: next, info } = await proposePartsBest(blob);
                    setProject(next);
                    setSelectedId(next.parts[0]?.id ?? null);
                    setStatus(
                      `다시 제안 완료 · ${info.via === "api" ? info.engine : "fallback"}`,
                    );
                  } catch (e) {
                    console.error(e);
                    const next = proposePartsLocal(project.source);
                    setProject(next);
                    setSelectedId(next.parts[0]?.id ?? null);
                    setStatus("API 실패 · 로컬 fallback으로 재제안");
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              다시 제안
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!project}
              onClick={() => void handleGif()}
            >
              재조립 GIF
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!project}
              onClick={() => void handleExportZip()}
            >
              PNG zip
            </button>
          </div>
        </header>

        <div className="main">
          <div className="canvas-panel">
            <div className="toolbar">
              <div className="tool-group">
                {(
                  [
                    ["brush", "브러시"],
                    ["eraser", "지우개"],
                    ["fill", "채우기"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={tool === id ? "active" : ""}
                    onClick={() => setTool(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="slider-label">
                크기
                <input
                  type="range"
                  min={3}
                  max={48}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                />
              </label>
              <label className="slider-label">
                오버레이
                <input
                  type="range"
                  min={0}
                  max={80}
                  value={Math.round(overlayOpacity * 100)}
                  onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)}
                />
              </label>
              <label className="slider-label">
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                />
                번호/이름
              </label>
              <label className="slider-label">
                <input
                  type="checkbox"
                  checked={dimOthers}
                  onChange={(e) => setDimOthers(e.target.checked)}
                />
                선택만
              </label>
            </div>

            <div className={`canvas-stage${busy || pending ? " busy" : ""}`}>
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              />
            </div>
            <p className="status">{status}</p>
          </div>

          <aside className="side">
            <h2>파츠 목록</h2>
            <ul className="part-list">
              {(project?.parts ?? [])
                .slice()
                .sort((a, b) => a.drawOrder - b.drawOrder)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`part-item${selectedId === p.id ? " selected" : ""}`}
                      onClick={() => setSelectedId(p.id)}
                    >
                      <span className="swatch" style={{ background: p.color }} />
                      <span className="part-name">{p.name}</span>
                      <span className="part-meta">#{String(p.drawOrder).padStart(2, "0")}</span>
                    </button>
                  </li>
                ))}
            </ul>

            <button type="button" className="btn btn-ghost" onClick={handleAddPart}>
              파츠 추가
            </button>

            {selected && (
              <div>
                <h2>선택 파츠</h2>
                <input
                  className="rename-input"
                  value={selected.name}
                  onChange={(e) => renameSelected(e.target.value)}
                />
                <p className="status">
                  drawOrder {selected.drawOrder} · pivot/parent는 Phase 2 스텁
                </p>
              </div>
            )}

            <div className="preview-block">
              <h2>재조립 GIF</h2>
              {gifUrl ? (
                <>
                  <img src={gifUrl} alt="파츠 재조립 미리보기" />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void handleGifDownload()}
                  >
                    GIF 다운로드
                  </button>
                </>
              ) : (
                <p className="status">상단 “재조립 GIF”로 draw order 스택을 확인하세요.</p>
              )}
            </div>
          </aside>
        </div>

        <input
          ref={fileRef}
          className="hidden-file"
          type="file"
          accept="image/*"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
