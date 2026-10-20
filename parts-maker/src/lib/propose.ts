import { estimateHiddenRegions } from "./hidden";
import { enrichSpineMeta } from "./meta";
import { loadImageData, proposePartsLocal } from "./segment";
import { proposePartsViaApi, type SegmentEngineInfo } from "./segmentApi";
import type { ProjectState } from "../types";

function finalize(project: ProjectState): ProjectState {
  const withMeta = enrichSpineMeta({
    ...project,
    hiddenRegions: project.hiddenRegions ?? [],
  });
  return {
    ...withMeta,
    hiddenRegions: estimateHiddenRegions(withMeta),
  };
}

export async function proposePartsBest(
  file: Blob,
): Promise<{ project: ProjectState; info: SegmentEngineInfo }> {
  try {
    const { project, info } = await proposePartsViaApi(file);
    return { project: finalize(project), info };
  } catch {
    const source = await loadImageData(file);
    const project = finalize(proposePartsLocal(source));
    return {
      project,
      info: { engine: "local-marker-watershed", via: "local-fallback" },
    };
  }
}
