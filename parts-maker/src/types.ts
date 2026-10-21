export type PartId = number;

export interface HiddenRegion {
  id: string;
  /** Part that should receive the hidden cap (usually child). */
  partId: PartId;
  /** Normalized 0..1 in image space */
  x: number;
  y: number;
  /** Radius as fraction of min(image w,h) */
  radius: number;
  note: string;
  /** approx = light local fill applied; stub = marker only */
  inpaint: "approx" | "stub" | "none";
}

export interface PartMeta {
  id: PartId;
  name: string;
  /** Higher draws later (front). */
  drawOrder: number;
  color: string;
  /** Parent part name, or "root", or null */
  parent: string | null;
  /** Normalized 0..1 in full image space */
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
  hiddenRegions: HiddenRegion[];
}

export type Tool =
  | "brush"
  | "eraser"
  | "fill"
  | "pivot"
  | "hidden";

export type AppStep = "prompt" | "landing" | "workspace";
