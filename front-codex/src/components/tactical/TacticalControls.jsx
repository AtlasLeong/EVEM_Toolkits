import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";
import { getTacticalCatalog } from "../../services/apiTacticalCollaboration";
import { SHIP_TYPES } from "../../utils/tacticalCollaboration";

export function ShipComposition({ ships = {}, includeUnknown = false }) {
  return (
    <div className="tac-ship-summary" aria-label="已上报舰船构成">
      {Object.entries(SHIP_TYPES)
        .filter(([key]) => includeUnknown || ships[key] != null)
        .map(([key, label]) => (
          <span key={key}>
            {label} <b>{ships[key] ?? "未知"}</b>
          </span>
        ))}
    </div>
  );
}

export function TacticalDialog({ title, children, onClose, wide = false, mobileSheet = false, confirm = false }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const node = ref.current;
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.showModal();
    return () => {
      node.close();
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`tac-dialog${wide ? " is-wide" : ""}${mobileSheet ? " tac-mobile-sheet" : ""}${confirm ? " is-confirm" : ""}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="tac-dialog-head">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="tac-icon-btn"
          aria-label={`关闭${title}`}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="tac-dialog-body">{children}</div>
    </dialog>,
    document.body,
  );
}

export function TacticalSelect({ label, value, options, onChange }) {
  const ref = useRef(null);
  return (
    <details
      className="tac-select"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          ref.current.open = false;
          ref.current.querySelector("summary").focus();
        }
      }}
    >
      <summary aria-label={label}>
        {options.find((option) => String(option.value) === String(value))
          ?.label || "请选择"}
        <ChevronDown size={16} />
      </summary>
      <div className="tac-select-menu" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={String(value) === String(option.value)}
            onClick={() => {
              onChange(option.value);
              ref.current.open = false;
              ref.current.querySelector("summary").focus();
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  );
}

export function SystemPicker({
  organizationId,
  value,
  onChange,
  label = "搜索上报星系",
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(
      () =>
        getTacticalCatalog(organizationId, "systems", query.trim())
          .then((data) => {
            if (active) {
              setResults(data.results || []);
              setError("");
            }
          })
          .catch((failure) => {
            if (active) setError(failure.message);
          })
          .finally(() => {
            if (active) setLoading(false);
          }),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [organizationId, query]);
  return (
    <div className="tac-system-picker">
      <label className="tac-field">
        <span>{label}</span>
        <div className="tac-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入星系名称"
            aria-label={label}
            autoComplete="off"
          />
        </div>
      </label>
      {value?.id && (
        <div className="tac-location-value">
          <span>已选：{value.name || value.id}</span>
          <button
            type="button"
            aria-label="清除所选星系"
            onClick={() => onChange(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {query && (
        <div
          className="tac-system-results"
          role="group"
          aria-label="星系搜索结果"
        >
          {loading ? (
            <p>搜索中…</p>
          ) : results.length ? (
            results.map((system) => (
              <button
                type="button"
                key={system.id}
                onClick={() => {
                  onChange(system);
                  setQuery("");
                }}
              >
                <span>
                  {system.name}
                  <small>{system.region_name}</small>
                </span>
                <span className="tac-security">
                  {Number(system.security_status).toFixed(2)}
                </span>
              </button>
            ))
          ) : (
            <p>未找到星系，请更换关键词</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="tac-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function ScopeEditor({ organizationId, scope, execute, onClose, variant = 'war' }) {
  const [reviewedVersion] = useState(scope.version);
  const [regions, setRegions] = useState([]);
  const [selected, setSelected] = useState(scope.region_ids || []);
  const [hops, setHops] = useState(scope.border_hops || 0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    getTacticalCatalog(organizationId, "regions")
      .then((data) => {
        if (active) setRegions(data.results || []);
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [organizationId]);
  const toggle = (id) =>
    setSelected((values) =>
      values.includes(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    );
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await execute("scope.update", {
        expected_version: reviewedVersion,
        region_ids: selected,
        border_hops: hops,
      });
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <TacticalDialog title={variant === 'pirate' ? '设置情报覆盖星域' : '设置作战星域'} onClose={onClose}>
      <form onSubmit={save} className="tac-form">
        <p className="tac-muted">
          {variant === 'pirate'
            ? '这块情报板独立选择星图范围；线索仍保留历史记录，只加载选中星域与边界星系。'
            : '所有成员共享作战范围；范围外部署仍保留在列表中。只加载选中星域与边界星系。'}
        </p>
        <label className="tac-field">
          <span>搜索星域</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按星域名称搜索"
          />
        </label>
        <div className="tac-region-options">
          {regions
            .filter((region) =>
              region.name.toLowerCase().includes(query.toLowerCase()),
            )
            .map((region) => (
              <label key={region.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(region.id)}
                  onChange={() => toggle(region.id)}
                />
                <span>{region.name}</span>
              </label>
            ))}
        </div>
        <span className="tac-muted">已选 {selected.length} 个星域</span>
        <fieldset className="tac-field">
          <legend>边界缓冲</legend>
          <div className="tac-segmented">
            {[0, 1, 2].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={hops === value}
                onClick={() => setHops(value)}
              >
                {value === 0 ? "仅所选星域" : `${value} 跳星门`}
              </button>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="tac-error" role="alert">
            {error}
          </p>
        )}
        <div className="tac-form-footer">
          <button type="button" className="tac-btn" onClick={onClose}>
            取消
          </button>
          <button className="tac-btn is-primary" disabled={busy}>
            {busy ? "保存中…" : variant === 'pirate' ? '应用情报范围' : '应用作战范围'}
          </button>
        </div>
      </form>
    </TacticalDialog>
  );
}
