import { useEffect, useRef, useState, useTransition } from "react";
import "./App.css";
import { PartsTable } from "./components/PartsTable";
import { PromptStudio } from "./components/PromptStudio";
import { Viewer3D } from "./components/Viewer3D";
import { ViewStrip } from "./components/ViewStrip";
import { fetchDepth, revokeDepthResult, type DepthResult } from "./lib/depth";
import {
  downloadReassemblyGif,
  exportPartsPsd,
  exportPartsZip,
  buildReassemblyGif,
} from "./lib/export";
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
import { addPart, floodFill, paintBrush } from "./lib/segment";
import {
  emptyViewSlots,
  generateViewSlots,
  revokeViewUrls,
  type ViewId,
  type ViewSlot,
} from "./lib/views";
import type { AppStep, PartMeta, ProjectState, Tool } from "./types";

export default function App() {
  const [step, setStep] = useState<AppStep>("prompt");
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
  const [viewSlots, setViewSlots] = useState<ViewSlot[]>(emptyViewSlots);
  const [activeViewId, setActiveViewId] = useState<ViewId>("front");
  const [projectsByView, setProjectsByView] = useState<
    Partial<Record<ViewId, ProjectState>>
  >({});
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [depthResult, setDepthResult] = useState<DepthResult | null>(null);
  const [depthBusy, setDepthBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectsRef = useRef(projectsByView);
  const activeViewRef = useRef(activeViewId);
  const projectRef = useRef(project);
  const viewSlotsRef = useRef(viewSlots);
  projectsRef.current = projectsByView;
  activeViewRef.current = activeViewId;
  projectRef.current = project;
  viewSlotsRef.current = viewSlots;

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

  useEffect(() => {
    return () => {
      revokeViewUrls(viewSlots);
      revokeDepthResult(depthResult);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitProject = (next: ProjectState | null, viewId?: ViewId) => {
    const vid = viewId ?? activeViewRef.current;
    setProject(next);
    projectRef.current = next;
    if (next) {
      setProjectsByView((prev) => {
        const map = { ...prev, [vid]: next };
        projectsRef.current = map;
        return map;
      });
    }
  };

  const segmentBlob = async (blob: Blob, viewId: ViewId, label: string) => {
    setBusy(true);
    setStatus(`${label} 뷰 · U2Net 파츠·메타 추정 중…`);
    try {
      const { project: next, info } = await proposePartsBest(blob);
      startTransition(() => {
        commitProject(next, viewId);
        setSelectedId(next.parts[0]?.id ?? null);
        setStep("workspace");
        setGifUrl(null);
        const engineLabel =
          info.via === "api" ? info.engine : `fallback (${info.engine})`;
        setStatus(
          next.parts.length
            ? `${label} · ${next.parts.length}개 파츠 · ${engineLabel}`
            : `${label} · 전경을 찾지 못했습니다.`,
        );
      });
    } catch (e) {
      console.error(e);
      setStatus(`${label} 뷰 처리 실패`);
    } finally {
      setBusy(false);
    }
  };

  const runPipeline = async (blob: Blob) => {
    setBusy(true);
    setSourceBlob(blob);
    setStatus("다각도 뷰 생성 중…");
    revokeViewUrls(viewSlots);
    setProjectsByView({});
    projectsRef.current = {};
    setActiveViewId("front");
    activeViewRef.current = "front";

    let slots: ViewSlot[] = emptyViewSlots();
    let viewNote = "";
    try {
      const gen = await generateViewSlots(blob);
      slots = gen.slots;
      viewNote = gen.note ? ` · ${gen.note}` : ` · 뷰:${gen.engine}`;
      setViewSlots(slots);
    } catch (e) {
      console.error(e);
      // Keep going with front-only
      const url = URL.createObjectURL(blob);
      slots = emptyViewSlots().map((s) =>
        s.id === "front"
          ? { ...s, blob, url, status: "ready" as const, engine: "front-only" }
          : s,
      );
      setViewSlots(slots);
      viewNote = " · 뷰 생성 실패 → 정면만 사용";
      setStatus("뷰 생성 실패 · 정면 이미지로 계속합니다.");
    }

    const frontBlob = slots.find((s) => s.id === "front")?.blob ?? blob;
    setBusy(false);
    await segmentBlob(frontBlob, "front", "정면");
    setStatus((prev) => prev + viewNote);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void runPipeline(file);
  };

  const switchView = async (id: ViewId) => {
    if (busy) return;
    if (id === activeViewRef.current && projectsRef.current[id]) {
      setStatus(`이미 ${id} 뷰입니다.`);
      return;
    }
    const map = { ...projectsRef.current };
    if (projectRef.current) map[activeViewRef.current] = projectRef.current;

    setActiveViewId(id);
    activeViewRef.current = id;
    setGifUrl(null);
    setProjectsByView(map);
    projectsRef.current = map;

    const slot = viewSlotsRef.current.find((s) => s.id === id);
    if (map[id]) {
      setProject(map[id]!);
      projectRef.current = map[id]!;
      setSelectedId(map[id]!.parts[0]?.id ?? null);
      setStatus(`${slot?.label ?? id} 뷰로 전환 (캐시)`);
      return;
    }
    if (!slot?.blob) {
      setProject(null);
      projectRef.current = null;
      setStatus("이 각도 이미지가 없습니다. 업로드하거나 뷰를 다시 생성하세요.");
      return;
    }
    await segmentBlob(slot.blob, id, slot.label);
  };

  const regenerateViews = async () => {
    if (!sourceBlob) {
      setStatus("원본 이미지가 없습니다.");
      return;
    }
    setBusy(true);
    setStatus("다각도 뷰 다시 생성 중…");
    try {
      revokeViewUrls(viewSlots);
      const gen = await generateViewSlots(sourceBlob);
      setViewSlots(gen.slots);
      // Drop cached projects except we keep front if still same — clear all for honesty
      setProjectsByView({});
      projectsRef.current = {};
      setActiveViewId("front");
      activeViewRef.current = "front";
      const front = gen.slots.find((s) => s.id === "front")?.blob ?? sourceBlob;
      setBusy(false);
      await segmentBlob(front, "front", "정면");
      setStatus((s) => `${s} · 뷰 엔진 ${gen.engine}`);
    } catch (e) {
      console.error(e);
      setStatus("뷰 재생성 실패 · 기존 정면 작업은 유지됩니다.");
      setBusy(false);
    }
  };

  const uploadView = (id: ViewId, file: File) => {
    const url = URL.createObjectURL(file);
    setViewSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (s.url) URL.revokeObjectURL(s.url);
        return {
          ...s,
          blob: file,
          url,
          status: "ready",
          engine: "user-upload",
        };
      }),
    );
    setProjectsByView((prev) => {
      const next = { ...prev };
      delete next[id];
      projectsRef.current = next;
      return next;
    });
    setStatus(`${id} 뷰 이미지 교체됨 · 썸네일을 클릭해 파츠 분리`);
    if (id === activeViewRef.current) {
      void segmentBlob(file, id, id);
    }
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
      const next: ProjectState = (result as ProjectState | undefined) ?? draft;
      projectRef.current = next;
      setProjectsByView((map) => {
        const m = { ...map, [activeViewRef.current]: next };
        projectsRef.current = m;
        return m;
      });
      return next;
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
      return;
    }
    if (tool === "fill") {
      mutateProject((p) => {
        floodFill(p, Math.floor(x), Math.floor(y), selectedId ?? 0);
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
    if (!project) return;
    const next = updatePart(project, id, patch);
    commitProject(next);
  };

  const handleAddPart = () => {
    if (!project) return;
    const copy = {
      ...project,
      parts: [...project.parts],
      hiddenRegions: [...(project.hiddenRegions ?? [])],
    };
    const part = addPart(copy);
    commitProject(copy);
    setSelectedId(part.id);
    setStatus(`새 파츠 “${part.name}” 추가`);
  };

  const handleExportZip = async () => {
    if (!project) return;
    setStatus("PNG zip + parts.json 생성 중…");
    const slot = viewSlots.find((s) => s.id === activeViewId);
    await exportPartsZip(project, {
      viewId: activeViewId,
      viewBlob: slot?.blob ?? null,
    });
    setStatus(`parts-export-${activeViewId}.zip 완료`);
  };

  const handleExportPsd = async () => {
    if (!project) return;
    setStatus("파츠 PNG + 미리보기 + PSD 생성 중…");
    try {
      await exportPartsPsd(project, { viewId: activeViewId });
      setStatus(`parts-images-${activeViewId}.zip 완료 (png/ + preview + PSD)`);
    } catch (e) {
      console.error(e);
      setStatus("파츠이미지다운 실패");
    }
  };

  const handleGif = async () => {
    if (!project) return;
    setStatus("재조립 GIF 생성 중…");
    const blob = await buildReassemblyGif(project);
    if (gifUrl) URL.revokeObjectURL(gifUrl);
    setGifUrl(URL.createObjectURL(blob));
    setStatus(`재조립 GIF (${activeViewId}) 준비됨`);
  };

  if (step === "prompt") {
    return (
      <div className="app">
        <PromptStudio
          onOpenLegacyEditor={() => {
            setStep("landing");
            setStatus("이미지를 올리면 자동 분할(실험)을 시작합니다.");
          }}
        />
      </div>
    );
  }

  if (step === "landing" || !project) {
    return (
      <div className="app">
        <section className="landing">
          <div className="landing-inner">
            <h1 className="brand">파츠 제작</h1>
            <p className="headline">실험: 자동 분할 에디터</p>
            <p className="sub">
              픽셀 자동 분리는 퀄리티가 낮을 수 있습니다. 메인 기능은 챗지 재생성
              프롬프트입니다.
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
                onClick={() => setStep("prompt")}
              >
                ← 프롬프트 도구로
              </button>
            </div>
            <p className="hint">실험용 · watershed 자동 분할</p>
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
                const slot = viewSlots.find((s) => s.id === activeViewId);
                if (!slot?.blob) return;
                void segmentBlob(slot.blob, activeViewId, slot.label);
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
              className="btn btn-ghost"
              disabled={!project}
              onClick={() => void handleExportZip()}
            >
              PNG zip
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!project}
              onClick={() => void handleExportPsd()}
            >
              파츠이미지다운
            </button>
          </div>
        </header>

        <ViewStrip
          slots={viewSlots}
          activeId={activeViewId}
          busy={busy}
          onSelect={(id) => void switchView(id)}
          onUploadView={uploadView}
          onRegenerate={() => void regenerateViews()}
        />

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
              {project ? (
                <canvas
                  ref={canvasRef}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={onPointerUp}
                />
              ) : (
                <p className="status">이 각도의 파츠 프로젝트가 없습니다.</p>
              )}
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
                  commitProject(enrichSpineMeta(project));
                  setStatus("피벗·parent 재추정");
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
                  commitProject({
                    ...project,
                    hiddenRegions: estimateHiddenRegions(project),
                  });
                  setStatus("히든 마커 재배치");
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
                  commitProject(applyLightInpaint(project));
                  setStatus("간단 인페인트 적용 (approx)");
                }}
              >
                간단 인페인트
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!project}
                onClick={handleAddPart}
              >
                파츠 추가
              </button>
            </div>

            <Viewer3D
              depth={depthResult}
              busy={depthBusy}
              onBuild={() => {
                const slot = viewSlotsRef.current.find(
                  (s) => s.id === activeViewRef.current,
                );
                const blob = slot?.blob;
                if (!blob) {
                  setStatus("3D용 뷰 이미지가 없습니다.");
                  return;
                }
                setDepthBusy(true);
                setStatus("Depth Anything로 깊이 추정 중…");
                void (async () => {
                  try {
                    const next = await fetchDepth(blob);
                    revokeDepthResult(depthResult);
                    setDepthResult(next);
                    setStatus(
                      `3D 메시 준비 · ${next.engine.startsWith("depth-anything") ? "실제 깊이" : "스텁"} (${next.engine})`,
                    );
                  } catch (e) {
                    console.error(e);
                    setStatus("깊이 추정 실패 · API(/depth)와 모델 다운로드를 확인하세요.");
                  } finally {
                    setDepthBusy(false);
                  }
                })();
              }}
            />

            <div className="preview-block">
              <h2>재조립 GIF · {activeViewId}</h2>
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
                <p className="status">현재 뷰의 drawOrder 스택을 GIF로 확인</p>
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
                          onClick={() => {
                            if (!project) return;
                            commitProject(removeHiddenMarker(project, h.id));
                          }}
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
            onMoveOrder={(id, dir) => {
              if (!project) return;
              commitProject(moveDrawOrder(project, id, dir));
            }}
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
