import { useEffect, useRef, useState, useTransition } from "react";
import "./App.css";
import { PartsTable } from "./components/PartsTable";
import { downloadReassemblyGif, exportPartsZip, buildReassemblyGif } from "./lib/export";
import {
  addHiddenMarker,
  applyLightInpaint,
  estimateHiddenRegions,
  removeHiddenMarker,
} from "./lib/hidden";
import {
  enrichSpineMeta,
  moveDrawOrder,
  updatePart,
} from "./lib/meta";
import { proposePartsBest } from "./lib/propose";
import { drawProject } from "./lib/render";
import {
  addPart,
  floodFill,
  paintBrush,
  proposePartsLocal,
} from "./lib/segment";
import type { AppStep, PartMeta, ProjectState, Tool } from "./types";

export default function App() {
  const [step, setStep] = useState<AppStep>("landing");
  const [project, setProject] = useState<ProjectState | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(14);
  const [overlayOpacity, setOverlayOpacity] = useState(0.38);
  const [showLabels, setShowLabels] = useState(true);
  const [showPivots, setShowPivots] = useState(true);
  const [showBones, setShowBones] = useState(true);
  const [showHidden, setShowHidden] = useState(true);
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
      showPivots,
      showBones,
      showHidden,
      selectedId,
      dimOthers,
    });
  };

  useEffect(() => {
    if (project) redraw(project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    project,
    overlayOpacity,
    showLabels,
    showPivots,
    showBones,
    showHidden,
    selectedId,
    dimOthers,
  ]);

  useEffect(() => {
    return () => {
      if (gifUrl) URL.revokeObjectURL(gifUrl);
    };
  }, [gifUrl]);

  const runPropose = async (blob: Blob) => {
    setBusy(true);
    setStatus("U2Net 배경 분리 · 파츠·피벗·히든 마커 추정 중…");
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
            ? `${next.parts.length}개 파츠 · pivot/parent/hidden 추정 · ${engineLabel}`
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

  const mutateProject = (fn: (p: ProjectState) => ProjectState | void) => {
    setProject((prev) => {
      if (!prev) return prev;
      const draft: ProjectState = {
        ...prev,
        labels: new Uint16Array(prev.labels),
        parts: prev.parts.map((p) => ({
          ...p,
          pivot: { ...p.pivot },
        })),
        hiddenRegions: (prev.hiddenRegions ?? []).map((h) => ({ ...h })),
        source: prev.source,
      };
      const result = fn(draft);
      return result ?? draft;
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!project) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = canvasPos(e);

    if (tool === "pivot") {
      if (selectedId == null) {
        setStatus("피벗을 옮길 파츠를 테이블에서 선택하세요.");
        return;
      }
      mutateProject((p) =>
        updatePart(p, selectedId, {
          pivot: { x: x / p.width, y: y / p.height },
        }),
      );
      setStatus("피벗 위치를 갱신했습니다.");
      return;
    }

    if (tool === "hidden") {
      if (selectedId == null) {
        setStatus("히든 마커를 붙일 파츠를 선택하세요.");
        return;
      }
      mutateProject((p) =>
        addHiddenMarker(p, selectedId, x / p.width, y / p.height),
      );
      setStatus("히든 영역 마커 추가 · ‘간단 인페인트’로 채울 수 있습니다.");
      return;
    }

    if (tool === "fill") {
      const id = selectedId ?? 0;
      mutateProject((p) => {
        floodFill(p, Math.floor(x), Math.floor(y), id);
      });
      return;
    }
    if (tool === "brush" || tool === "eraser") {
      painting.current = true;
      const id = tool === "eraser" ? 0 : (selectedId ?? 0);
      if (tool === "brush" && selectedId == null) {
        setStatus("파츠를 선택한 뒤 브러시를 쓰세요.");
        return;
      }
      mutateProject((p) => {
        paintBrush(p.labels, p.width, p.height, x, y, brushSize, id);
      });
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!painting.current || !project) return;
    const { x, y } = canvasPos(e);
    const id = tool === "eraser" ? 0 : (selectedId ?? 0);
    mutateProject((p) => {
      paintBrush(p.labels, p.width, p.height, x, y, brushSize, id);
    });
  };

  const onPointerUp = () => {
    painting.current = false;
  };

  const handlePartChange = (id: number, patch: Partial<PartMeta>) => {
    setProject((prev) => (prev ? updatePart(prev, id, patch) : prev));
  };

  const handleAddPart = () => {
    setProject((prev) => {
      if (!prev) return prev;
      const copy = {
        ...prev,
        parts: [...prev.parts],
        hiddenRegions: [...(prev.hiddenRegions ?? [])],
      };
      const part = addPart(copy);
      setSelectedId(part.id);
      setStatus(`새 파츠 “${part.name}” 추가`);
      return copy;
    });
  };

  const handleExportZip = async () => {
    if (!project) return;
    setStatus("PNG zip + parts.json 생성 중…");
    await exportPartsZip(project);
    setStatus("parts-export.zip 다운로드 완료 (메타 v2).");
  };

  const handleGif = async () => {
    if (!project) return;
    setStatus("재조립 GIF 생성 중 (현재 drawOrder)…");
    const blob = await buildReassemblyGif(project);
    if (gifUrl) URL.revokeObjectURL(gifUrl);
    setGifUrl(URL.createObjectURL(blob));
    setStatus("재조립 GIF 준비됨 · drawOrder 스택 반영.");
  };

  if (step === "landing") {
    return (
      <div className="app">
        <section className="landing">
          <div className="landing-inner">
            <h1 className="brand">파츠 제작</h1>
            <p className="headline">캐릭터를 올리고, 파츠로 쪼개세요.</p>
            <p className="sub">
              마스크를 다듬고 Spine식 pivot·parent·draw order를 편집한 뒤, 투명 PNG와
              재조립 GIF로 검증합니다.
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
                      await runPropose(await res.blob());
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
              Phase 2 · rembg 세그 + Spine 메타 테이블 · 히든 마커 / 간단 인페인트
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

  return (
    <div className="app">
      <div className="workspace workspace-v2">
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
                    const local = proposePartsLocal(project.source);
                    const withMeta = enrichSpineMeta({
                      ...local,
                      hiddenRegions: [],
                    });
                    setProject({
                      ...withMeta,
                      hiddenRegions: estimateHiddenRegions(withMeta),
                    });
                    setSelectedId(withMeta.parts[0]?.id ?? null);
                    setStatus("API 실패 · 로컬 fallback");
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

        <div className="main main-v2">
          <div className="canvas-panel">
            <div className="toolbar">
              <div className="tool-group">
                {(
                  [
                    ["brush", "브러시"],
                    ["eraser", "지우개"],
                    ["fill", "채우기"],
                    ["pivot", "피벗"],
                    ["hidden", "히든"],
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
                라벨
              </label>
              <label className="slider-label">
                <input
                  type="checkbox"
                  checked={showPivots}
                  onChange={(e) => setShowPivots(e.target.checked)}
                />
                피벗
              </label>
              <label className="slider-label">
                <input
                  type="checkbox"
                  checked={showBones}
                  onChange={(e) => setShowBones(e.target.checked)}
                />
                본
              </label>
              <label className="slider-label">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />
                히든
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

          <aside className="side side-v2">
            <div className="meta-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!project}
                onClick={() => {
                  if (!project) return;
                  setProject(enrichSpineMeta(project));
                  setStatus("피벗·parent를 마스크 기준으로 다시 추정했습니다.");
                }}
              >
                피벗 재추정
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!project}
                onClick={() => {
                  if (!project) return;
                  setProject({
                    ...project,
                    hiddenRegions: estimateHiddenRegions(project),
                  });
                  setStatus("히든 영역 마커를 관절 기준으로 다시 배치했습니다.");
                }}
              >
                히든 재배치
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!project}
                onClick={() => {
                  if (!project) return;
                  setProject(applyLightInpaint(project));
                  setStatus(
                    "간단 인페인트 적용 (이웃 평균) · 생성형 inpaint는 TODO",
                  );
                }}
              >
                간단 인페인트
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleAddPart}>
                파츠 추가
              </button>
            </div>

            <div className="preview-block">
              <h2>재조립 GIF</h2>
              {gifUrl ? (
                <>
                  <img src={gifUrl} alt="파츠 재조립 미리보기" />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => project && void downloadReassemblyGif(project)}
                  >
                    GIF 다운로드
                  </button>
                </>
              ) : (
                <p className="status">drawOrder 변경 후 GIF로 스택을 확인하세요.</p>
              )}
            </div>

            {(project?.hiddenRegions?.length ?? 0) > 0 && (
              <div className="hidden-list">
                <h2>히든 마커</h2>
                <ul>
                  {(project?.hiddenRegions ?? []).map((h) => {
                    const part = project?.parts.find((p) => p.id === h.partId);
                    return (
                      <li key={h.id}>
                        <span>
                          {part?.name ?? h.partId} · {h.inpaint}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            setProject((prev) =>
                              prev ? removeHiddenMarker(prev, h.id) : prev,
                            )
                          }
                        >
                          삭제
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </aside>
        </div>

        {project && (
          <PartsTable
            project={project}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={handlePartChange}
            onMoveOrder={(id, dir) =>
              setProject((prev) => (prev ? moveDrawOrder(prev, id, dir) : prev))
            }
          />
        )}

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
