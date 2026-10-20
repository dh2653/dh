import { loadImageData, proposePartsLocal } from "./segment";
import { proposePartsViaApi, type SegmentEngineInfo } from "./segmentApi";
import type { ProjectState } from "../types";

export async function proposePartsBest(
  file: Blob,
): Promise<{ project: ProjectState; info: SegmentEngineInfo }> {
  try {
    return await proposePartsViaApi(file);
  } catch {
    const source = await loadImageData(file);
    const project = proposePartsLocal(source);
    return {
      project,
      info: { engine: "local-marker-watershed", via: "local-fallback" },
    };
  }
}
