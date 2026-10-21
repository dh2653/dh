import type { ViewId, ViewSlot } from "../lib/views";

type Props = {
  slots: ViewSlot[];
  activeId: ViewId;
  busy?: boolean;
  onSelect: (id: ViewId) => void;
  onUploadView: (id: ViewId, file: File) => void;
  onRegenerate: () => void;
};

export function ViewStrip({
  slots,
  activeId,
  busy,
  onSelect,
  onUploadView,
  onRegenerate,
}: Props) {
  return (
    <div className="view-strip">
      <div className="view-strip-head">
        <h2>각도 뷰</h2>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={onRegenerate}
        >
          뷰 다시 생성
        </button>
      </div>
      <div className="view-thumbs" role="listbox" aria-label="각도 뷰">
        {slots.map((slot) => (
          <div
            key={slot.id}
            role="option"
            aria-selected={activeId === slot.id}
            data-view-id={slot.id}
            className={`view-thumb${activeId === slot.id ? " active" : ""}${
              slot.status !== "ready" ? " empty" : ""
            }`}
            onClick={() => {
              if (busy || !slot.blob) return;
              onSelect(slot.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!busy && slot.blob) onSelect(slot.id);
              }
            }}
            tabIndex={slot.blob ? 0 : -1}
          >
            <div className="view-thumb-btn">
              {slot.url ? (
                <img src={slot.url} alt={slot.label} draggable={false} />
              ) : (
                <span className="view-placeholder">{slot.label}</span>
              )}
              <span className="view-caption">{slot.label}</span>
            </div>
            <label
              className="view-upload"
              onClick={(e) => e.stopPropagation()}
            >
              업로드
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadView(slot.id, f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        ))}
      </div>
      <p className="status view-engine">
        {slots.find((s) => s.engine)?.engine
          ? `뷰 엔진: ${slots.find((s) => s.engine)?.engine}`
          : "뷰 대기"}
      </p>
    </div>
  );
}
