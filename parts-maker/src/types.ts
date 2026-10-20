export type PartId = number;

export interface PartMeta {
  id: PartId;
  name: string;
  /** Higher draws later (front). */
  drawOrder: number;
  color: string;
  /** Stub for Phase 2 */
  parent: string | null;
  /** Stub for Phase 2 — normalized 0..1 */
  pivot: { x: number; y: number };
}

export interface ProjectState {
  width: number;
  height: number;
  /** RGBA source pixels */
  source: ImageData;
  /** 0 = background, else part id */
  labels: Uint16Array;
  parts: PartMeta[];
}

export type Tool = "brush" | "eraser" | "fill" | "pan";

export type AppStep = "landing" | "workspace";
