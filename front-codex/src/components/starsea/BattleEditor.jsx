import { useEffect, useMemo, useState } from "react";
import { searchShips } from "../../services/apiStarsea";
import {
  battleSummary,
  newLoss,
  parseLossList,
  SHIP_CLASSES,
} from "../../utils/starsea";
import { ErrorNotice } from "./StarseaUI";

function ShipRow({ row, label, onChange, onDuplicate, onRemove }) {
  const [q, setQ] = useState(""),
    [catalog, setCatalog] = useState(null),
    [error, setError] = useState(""),
    [mode, setMode] = useState(
      row.ship_id
        ? "catalog"
        : row.ship_name && row.ship_name !== "未知型号"
          ? "custom"
          : "unknown",
    );
  useEffect(() => {
    if (!q.trim()) {
      setCatalog(null);
      setError("");
      return;
    }
    const controller = new AbortController();
    let current = true;
    const timer = setTimeout(
      () =>
        searchShips({ q: q.trim() }, controller.signal)
          .then((value) => {
            if (current) {
              setCatalog(value);
              setError("");
            }
          })
          .catch((err) => {
            if (current && err.name !== "AbortError") setError(err.message);
          }),
      220,
    );
    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, row.ship_class]);
  return (
    <div className="ss-loss-row">
      <label>
        舰种
        <input
          list="starsea-ship-classes"
          aria-label={`${label}舰种`}
          maxLength={80}
          value={row.ship_class}
          onChange={(event) => {
            if (row.ship_id) setMode("unknown");
            onChange({
              ...row,
              ship_class: event.target.value,
              ship_id: null,
              ship_name: row.ship_id ? "" : row.ship_name,
            });
          }}
        />
      </label>
      <div className="ss-ship-choice">
        <label>
          型号来源
          <select
            aria-label={`${label}型号来源`}
            value={mode}
            onChange={(event) => {
              setMode(event.target.value);
              setQ("");
              onChange({ ...row, ship_id: null, ship_name: "" });
            }}
          >
            <option value="catalog">真实目录</option>
            <option value="unknown">未知型号</option>
            <option value="custom">自填型号</option>
          </select>
        </label>
        <label>
          搜索舰船
          <input
            aria-label={`${label}搜索舰船`}
            value={q}
            placeholder="按名称搜索真实目录"
            maxLength={80}
            onChange={(event) => {
              setQ(event.target.value);
            }}
          />
        </label>
        {row.ship_id && (
          <p className="ss-selected-ship">
            {row.ship_name}
            <small>目录 ID {row.ship_id}</small>
          </p>
        )}
        {mode === "custom" && (
          <label>
            自填型号
            <input
              aria-label={`${label}自填型号`}
              value={row.ship_name}
              maxLength={120}
              placeholder="此型号会标为自填"
              onChange={(event) =>
                onChange({
                  ...row,
                  ship_id: null,
                  ship_name: event.target.value,
                })
              }
            />
          </label>
        )}
        {mode === "unknown" && <small>保留为未知型号，不猜测舰船。</small>}
        <ErrorNotice error={error} />
        {catalog && (
          <div className="ss-ship-results">
            {catalog.results.map((ship) => (
              <button
                key={ship.id}
                type="button"
                aria-label={`选择${ship.name}（${ship.ship_class}）`}
                onClick={() => {
                  onChange({
                    ...row,
                    ship_id: ship.id,
                    ship_name: ship.name,
                    ship_class: ship.ship_class,
                  });
                  setQ("");
                  setMode("catalog");
                  setCatalog(null);
                }}
              >
                {ship.name}
                <small>
                  {ship.ship_class} · {ship.source_version}
                </small>
              </button>
            ))}
            {catalog.results.length === 0 && (
              <p>未找到匹配舰船，可使用自填或未知型号。</p>
            )}
            {catalog.count > catalog.results.length && (
              <p>仅展示前 20 条，请补充名称缩小范围。</p>
            )}
            <small>
              {catalog.notice || "本地 SWEET 218811 快照，不保证当前国服完整。"}
            </small>
          </div>
        )}
      </div>
      <label>
        损失数量
        <input
          aria-label={`${label}数量`}
          type="number"
          min="1"
          max="100000"
          step="1"
          value={row.quantity}
          onChange={(event) =>
            onChange({
              ...row,
              quantity:
                event.target.value === "" ? "" : Number(event.target.value),
            })
          }
        />
      </label>
      <div className="ss-row-actions">
        <button
          type="button"
          aria-label={`${label}减少`}
          disabled={Number(row.quantity) <= 1}
          onClick={() =>
            onChange({
              ...row,
              quantity: Math.max(1, Number(row.quantity) - 1),
            })
          }
        >
          −
        </button>
        <button
          type="button"
          aria-label={`${label}增加`}
          disabled={Number(row.quantity) >= 100000}
          onClick={() =>
            onChange({
              ...row,
              quantity: Math.min(100000, Number(row.quantity) + 1),
            })
          }
        >
          ＋
        </button>
        <button type="button" aria-label={`${label}复制`} onClick={onDuplicate}>
          复制
        </button>
        <button type="button" aria-label={`${label}删除`} onClick={onRemove}>
          删除
        </button>
      </div>
    </div>
  );
}
function SideEditor({ side, index, onChange }) {
  const label = index === 0 ? "A方" : "B方",
    [paste, setPaste] = useState(""),
    [preview, setPreview] = useState(null),
    summary = useMemo(() => battleSummary({ sides: [side] }).sides[0], [side]);
  function setRows(rows) {
    onChange({ ...side, losses: rows });
  }
  return (
    <section className="ss-side-editor">
      <header>
        <h3>{label}</h3>
        <span>{summary.total_ships.toLocaleString()} 艘损失</span>
      </header>
      <div className="ss-side-fields">
        <label>
          名称
          <input
            aria-label={`${label}名称`}
            maxLength={80}
            value={side.name}
            onChange={(event) =>
              onChange({ ...side, name: event.target.value })
            }
          />
        </label>
        <label>
          ISK 损失（选填）
          <input
            aria-label={`${label}ISK损失`}
            type="number"
            min="0"
            max="1000000000000000"
            step="0.01"
            value={side.isk_loss ?? ""}
            placeholder="未统计"
            onChange={(event) =>
              onChange({ ...side, isk_loss: event.target.value || null })
            }
          />
        </label>
      </div>
      <p className="ss-muted">留空表示未统计，填写 0 表示没有 ISK 损失。</p>
      <div className="ss-loss-rows">
        {side.losses.map((row, rowIndex) => (
          <ShipRow
            key={row._key || rowIndex}
            row={row}
            label={`${label}第${rowIndex + 1}行`}
            onChange={(next) =>
              setRows(
                side.losses.map((value, i) => (i === rowIndex ? next : value)),
              )
            }
            onDuplicate={() => {
              if (side.losses.length < 100)
                setRows([
                  ...side.losses.slice(0, rowIndex + 1),
                  { ...row, _key: crypto.randomUUID() },
                  ...side.losses.slice(rowIndex + 1),
                ]);
            }}
            onRemove={() =>
              setRows(side.losses.filter((_, i) => i !== rowIndex))
            }
          />
        ))}
      </div>
      <button
        type="button"
        aria-label={`${label}添加损失`}
        disabled={side.losses.length >= 100}
        onClick={() =>
          setRows([...side.losses, { ...newLoss(), _key: crypto.randomUUID() }])
        }
      >
        ＋ 添加损失
      </button>
      <details className="ss-paste" open={Boolean(preview)}>
        <summary>批量粘贴清单</summary>
        <label>
          每行：舰种,型号,数量
          <textarea
            aria-label={`${label}粘贴清单`}
            rows="3"
            value={paste}
            onChange={(event) => {
              setPaste(event.target.value);
              setPreview(null);
            }}
            placeholder={"战列舰,灾难级,12\n护卫舰,未知,3"}
          />
        </label>
        <button
          type="button"
          aria-label={`${label}预览清单`}
          onClick={() => setPreview(parseLossList(paste))}
        >
          预览清单
        </button>
        {preview && (
          <div className="ss-paste-preview">
            <strong>待导入 {preview.rows.length} 行</strong>
            <p className="ss-muted">
              粘贴型号标为自填；导入后可逐行关联真实目录。确认前不会添加。
            </p>
            {preview.rows.map((row, i) => (
              <div key={i}>
                {row.ship_class} · {row.ship_name || "未知型号"} ×{" "}
                {row.quantity}
              </div>
            ))}
            {preview.errors.map((message) => (
              <p role="alert" key={message}>
                {message}
              </p>
            ))}
            {side.losses.length + preview.rows.length > 100 && (
              <p role="alert">每方最多 100 行。</p>
            )}
            <button
              type="button"
              aria-label={`${label}确认导入`}
              disabled={
                !preview.rows.length ||
                preview.errors.length > 0 ||
                side.losses.length + preview.rows.length > 100
              }
              onClick={() => {
                setRows([
                  ...side.losses,
                  ...preview.rows.map((row) => ({
                    ...row,
                    _key: crypto.randomUUID(),
                  })),
                ]);
                setPaste("");
                setPreview(null);
              }}
            >
              确认导入
            </button>
          </div>
        )}
      </details>
    </section>
  );
}
export default function BattleEditor({ battle, onChange }) {
  return (
    <section className="ss-editor-section">
      <div className="ss-section-heading">
        <div>
          <h2>双方损失</h2>
          <p>只记录确认的信息，型号未知也可以发布战报。</p>
        </div>
        <small>最多 100 行 / 方</small>
      </div>
      <datalist id="starsea-ship-classes">
        {SHIP_CLASSES.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <div className="ss-battle-editor">
        {battle.sides.map((side, index) => (
          <SideEditor
            key={index}
            side={side}
            index={index}
            onChange={(next) =>
              onChange({
                ...battle,
                sides: battle.sides.map((value, i) =>
                  i === index ? next : value,
                ),
              })
            }
          />
        ))}
      </div>
    </section>
  );
}
