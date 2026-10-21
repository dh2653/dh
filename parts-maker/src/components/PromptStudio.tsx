import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCutoutPng } from "../lib/cutoutApi";
import {
  buildPartsRegenPrompt,
  downloadText,
  type PromptPreset,
} from "../lib/partsPrompt";
import { saveAs } from "file-saver";

type Props = {
  onOpenLegacyEditor?: () => void;
};

export function PromptStudio({ onOpenLegacyEditor }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null);
  const [cutoutBlob, setCutoutBlob] = useState<Blob | null>(null);
  const [notes, setNotes] = useState("");
  const [preset, setPreset] = useState<PromptPreset>("humanoid");
  const [lang, setLang] = useState<"ko" | "en">("ko");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("이미지를 올리면 참고용 투명컷 + 재생성 프롬프트를 만듭니다.");
  const [copied, setCopied] = useState(false);

  const prompt = useMemo(
    () =>
      buildPartsRegenPrompt({
        notes,
        preset,
        hasCutout: !!cutoutBlob,
        lang,
      }),
    [notes, preset, cutoutBlob, lang],
  );

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      if (cutoutUrl) URL.revokeObjectURL(cutoutUrl);
    };
  }, [sourceUrl, cutoutUrl]);

  const onFile = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    setCopied(false);
    setStatus("투명 배경 컷아웃 만드는 중…");
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    if (cutoutUrl) URL.revokeObjectURL(cutoutUrl);
    setSourceUrl(URL.createObjectURL(file));
    setCutoutUrl(null);
    setCutoutBlob(null);
    try {
      const { pngBlob, engine } = await fetchCutoutPng(file);
      setCutoutBlob(pngBlob);
      setCutoutUrl(URL.createObjectURL(pngBlob));
      setStatus(`컷아웃 완료 (${engine}). 프롬프트를 복사해 챗지에 이미지와 함께 붙여넣으세요.`);
    } catch (e) {
      console.error(e);
      setStatus("컷아웃 API 실패 — 원본만으로도 프롬프트는 쓸 수 있어요. 챗지에 원본을 첨부하세요.");
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setStatus("프롬프트 복사됨. 챗지 새 채팅에 이미지 첨부 후 붙여넣기.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus("클립보드 복사 실패 — 아래 텍스트를 직접 선택하세요.");
    }
  };

  const downloadPack = () => {
    downloadText("chatgpt-parts-regen-prompt.txt", prompt);
    if (cutoutBlob) saveAs(cutoutBlob, "character-cutout.png");
    setStatus("프롬프트(.txt) + 컷아웃 PNG 저장했습니다.");
  };

  return (
    <section className="prompt-studio">
      <div className="prompt-studio-inner">
        <header className="prompt-head">
          <h1 className="brand">파츠 제작</h1>
          <p className="headline">챗지에 넣을 ‘재생성’ 프롬프트를 뽑아 드립니다.</p>
          <p className="sub">
            원본을 자르지 않습니다. 같은 캐릭터를 <strong>파츠 시트로 다시 그려 달라</strong>고
            부탁하는 문장을 만들고, 참고용 투명 컷아웃을 같이 내려줍니다.
          </p>
        </header>

        <div className="prompt-grid">
          <div className="prompt-preview">
            <div className="prompt-preview-frame">
              {(cutoutUrl || sourceUrl) ? (
                <img
                  src={cutoutUrl ?? sourceUrl!}
                  alt="character reference"
                />
              ) : (
                <div className="prompt-empty">이미지 미리보기</div>
              )}
            </div>
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
                    const res = await fetch("/demo-character.png");
                    if (!res.ok) return;
                    const blob = await res.blob();
                    await onFile(new File([blob], "demo.png", { type: "image/png" }));
                  })();
                }}
              >
                샘플
              </button>
            </div>
            <input
              ref={fileRef}
              className="hidden-file"
              type="file"
              accept="image/*"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <p className="hint">{status}</p>
          </div>

          <div className="prompt-form">
            <label className="field">
              <span>캐릭터 메모 (옷·무기·포즈 등)</span>
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="예: 검은 갓, 흰 저고리, 검은 도포, 볼트액션 소총 조준 포즈"
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>유형</span>
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as PromptPreset)}
                >
                  <option value="humanoid">인간형</option>
                  <option value="chibi">치비</option>
                  <option value="creature">크리처</option>
                  <option value="prop">소품</option>
                </select>
              </label>
              <label className="field">
                <span>프롬프트 언어</span>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as "ko" | "en")}
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span>챗지용 프롬프트 (재생성 요청)</span>
              <textarea className="prompt-out" rows={16} readOnly value={prompt} />
            </label>

            <div className="cta-row">
              <button type="button" className="btn btn-primary" onClick={() => void copyPrompt()}>
                {copied ? "복사됨" : "프롬프트 복사"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={downloadPack}>
                txt+PNG 저장
              </button>
            </div>
            {onOpenLegacyEditor && (
              <button
                type="button"
                className="btn btn-ghost legacy-link"
                onClick={onOpenLegacyEditor}
              >
                (실험) 예전 자동 분할 에디터 열기
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
