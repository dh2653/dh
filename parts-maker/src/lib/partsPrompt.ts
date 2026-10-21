/** ChatGPT용: 원본을 “자르지” 말고 파츠 시트로 재생성해 달라는 프롬프트. */

export type PromptPreset = "humanoid" | "chibi" | "creature" | "prop";

export type PartsPromptInput = {
  /** 사용자가 적은 캐릭터 설명 (옷, 무기, 포즈 등) */
  notes: string;
  preset: PromptPreset;
  /** 투명 배경 컷아웃을 이미 첨부하는지 */
  hasCutout: boolean;
  /** 언어 */
  lang?: "ko" | "en";
};

const PRESET_PARTS: Record<PromptPreset, string[]> = {
  humanoid: [
    "머리 / 얼굴 (정면·측면이 필요하면 둘 다)",
    "모자·헤어 액세서리 (있다면 분리)",
    "상의 / 외투 (앞·뒤가 다르면 둘 다)",
    "소매·팔 가드",
    "왼팔 / 오른팔 (상완·하완·손 — 포즈에 맞게)",
    "허리띠·장식",
    "바지·하체 (상·하 분리 가능하면 분리)",
    "왼다리 / 오른다리·신발",
    "들고 있는 무기·소품 (몸통 / 총열 등 의미 단위로)",
  ],
  chibi: [
    "머리+얼굴",
    "몸통",
    "팔·손",
    "다리·발",
    "모자·소품",
  ],
  creature: [
    "머리",
    "몸통",
    "다리·날개·꼬리 등 사지",
    "뿔·갑옷·장식",
  ],
  prop: [
    "본체",
    "분리 가능한 부품",
    "장식·이펙트",
  ],
};

export function buildPartsRegenPrompt(input: PartsPromptInput): string {
  const lang = input.lang ?? "ko";
  const parts = PRESET_PARTS[input.preset];
  const notes = input.notes.trim() || "(첨부 이미지의 캐릭터 디자인을 그대로 따를 것)";

  if (lang === "en") {
    return [
      "You are helping me make a game-ready character PARTS SHEET for Spine/Live2D-style rigging.",
      "",
      "IMPORTANT:",
      "- Do NOT try to literally cut pixels out of my photo.",
      "- REGENERATE / REDRAW the same character as a clean modular parts sheet.",
      "- Keep identity: same face, outfit, colors, silhouette, and props as the attached image.",
      "- Flat clean illustration, transparent or pure black background, no collage of the original photo scraps.",
      "- Lay out: left = optional full-body pose reference, right = separated parts with clear gaps between pieces.",
      "- Each part should be complete and usable alone (not jagged mask leftovers).",
      "",
      input.hasCutout
        ? "I attached a transparent cutout of the character as reference."
        : "I attached the character image as reference.",
      "",
      `Character notes: ${notes}`,
      "",
      "Please regenerate a parts sheet including at least:",
      ...parts.map((p, i) => `${i + 1}. ${p}`),
      "",
      "Output: one high-resolution parts sheet image. If text labels help, keep them small and out of the art.",
    ].join("\n");
  }

  return [
    "게임/애니용 캐릭터 **파츠 시트**를 만들어 주세요. (Spine·Live2D 스타일 리깅 전제)",
    "",
    "중요:",
    "- 원본 사진을 픽셀 단위로 “자르지” 마세요.",
    "- 첨부한 캐릭터와 **같은 디자인**으로 **새로 그려서(재생성)** 파츠를 배치해 주세요.",
    "- 얼굴·의상·색·실루엣·소품 정체성은 유지.",
    "- 깔끔한 일러스트, 배경은 투명 또는 순검정. 원본을 찢어 붙인 조각 시트처럼 보이지 않게.",
    "- 레이아웃: 왼쪽(선택) 전체 포즈 참고 + 오른쪽/주변에 파츠를 간격 두고 분리 배치.",
    "- 각 파츠는 단독으로 쓸 수 있게 완성된 형태여야 함 (들쭉날쭉한 마스크 조각 금지).",
    "",
    input.hasCutout
      ? "첨부: 배경 제거된 캐릭터 컷아웃(참고용)."
      : "첨부: 캐릭터 이미지(참고용).",
    "",
    `캐릭터 메모: ${notes}`,
    "",
    "다음을 포함해 파츠 시트로 재생성해 주세요:",
    ...parts.map((p, i) => `${i + 1}. ${p}`),
    "",
    "결과물: 고해상도 파츠 시트 이미지 1장. 라벨 텍스트가 필요하면 작게, 그림과 겹치지 않게.",
  ].join("\n");
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
