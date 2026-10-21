import { parentOptions } from "../lib/meta";
import type { PartMeta, ProjectState } from "../types";

type Props = {
  project: ProjectState;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onChange: (id: number, patch: Partial<PartMeta>) => void;
  onMoveOrder: (id: number, dir: -1 | 1) => void;
};

export function PartsTable({
  project,
  selectedId,
  onSelect,
  onChange,
  onMoveOrder,
}: Props) {
  const rows = [...project.parts].sort((a, b) => a.drawOrder - b.drawOrder);
  const parents = parentOptions(project.parts);

  return (
    <div className="parts-table-wrap">
      <div className="parts-table-head">
        <h2>파츠 메타 (Spine식)</h2>
        <span className="status">{rows.length} parts · drawOrder / parent / pivot</span>
      </div>
      <div className="parts-table-scroll">
        <table className="parts-table">
          <thead>
            <tr>
              <th>#</th>
              <th>name</th>
              <th>parent</th>
              <th>pivot X</th>
              <th>pivot Y</th>
              <th>draw</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.id}
                className={selectedId === p.id ? "selected" : ""}
                onClick={() => onSelect(p.id)}
              >
                <td>
                  <span className="swatch" style={{ background: p.color }} />
                  {String(p.drawOrder).padStart(2, "0")}
                </td>
                <td>
                  <input
                    value={p.name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onChange(p.id, { name: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={p.parent ?? ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onChange(p.id, {
                        parent: e.target.value === "" ? null : e.target.value,
                      })
                    }
                  >
                    <option value="">—</option>
                    {parents
                      .filter((n) => n === "root" || n !== p.name)
                      .map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    step={0.001}
                    min={0}
                    max={1}
                    value={Number(p.pivot.x.toFixed(3))}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onChange(p.id, {
                        pivot: { ...p.pivot, x: Number(e.target.value) },
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step={0.001}
                    min={0}
                    max={1}
                    value={Number(p.pivot.y.toFixed(3))}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onChange(p.id, {
                        pivot: { ...p.pivot, y: Number(e.target.value) },
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    className="draw-input"
                    type="number"
                    min={1}
                    value={p.drawOrder}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      onChange(p.id, { drawOrder: Number(e.target.value) || 1 })
                    }
                  />
                </td>
                <td className="order-btns">
                  <button
                    type="button"
                    title="앞으로 (더 뒤 레이어)"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveOrder(p.id, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="뒤로 (더 앞 레이어)"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveOrder(p.id, 1);
                    }}
                  >
                    ↓
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
