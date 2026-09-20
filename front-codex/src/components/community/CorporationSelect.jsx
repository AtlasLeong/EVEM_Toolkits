import { useId, useState } from "react";
import { Check, Search } from "lucide-react";
import FilterDisclosure from "../ui/FilterDisclosure";

export const catalogSecurity = (value) =>
  value === null ||
  value === undefined ||
  String(value).trim() === "" ||
  !Number.isFinite(Number(value))
    ? null
    : Number(value);
export const catalogLabel = (item, prefix) =>
  String(
    item?.[`${prefix}_title`] ||
      item?.[`${prefix}_titleen`] ||
      item?.[`${prefix}_id`] ||
      "未命名",
  );
export const catalogOptions = (data, prefix) =>
  (data || []).map((item) => ({
    value: String(item[`${prefix}_id`]),
    label: catalogLabel(item, prefix),
    security: catalogSecurity(item[`${prefix}_safetylvl`]),
  }));

// Real radio inputs preserve native keyboard selection. Disclosure owns focus
// dismissal, including its Chromium-safe handling of blank-space clicks.
export default function CorporationSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "请选择",
  disabled = false,
  loading = false,
  error,
  onRetry,
  selectedLabel,
  searchable = true,
  compact = false,
}) {
  const [search, setSearch] = useState("");
  const groupId = useId();
  const selected = options.find(
    (option) => String(option.value) === String(value),
  );
  const caption = selected?.label || selectedLabel || placeholder;
  const visible = options.filter((option) =>
    String(option.label ?? option.value)
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <div className={`corp-select-field${compact ? " is-compact" : ""}`}>
      <FilterDisclosure
        label={label}
        value={loading ? "加载中…" : caption}
        disabled={disabled || loading || !!error}
        className="corp-select"
      >
        {searchable && (
          <label className="corp-select-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label={`搜索${label}`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`搜索${label}`}
              autoComplete="off"
            />
          </label>
        )}
        <div
          className="corp-select-options"
          role="radiogroup"
          aria-label={label}
          tabIndex={-1}
        >
          {visible.map((option) => (
            <label
              key={String(option.value)}
              className={`corp-select-option${String(option.value) === String(value) ? " is-selected" : ""}`}
            >
              <input
                type="radio"
                name={groupId}
                aria-label={option.label}
                value={option.value}
                checked={String(option.value) === String(value)}
                disabled={disabled || loading || !!error}
                onChange={(event) => {
                  onChange(option.value);
                  setSearch("");
                  const disclosure = event.currentTarget.closest("details");
                  disclosure.open = false;
                  disclosure.querySelector("summary").focus();
                }}
              />
              <span>{option.label}</span>
              {Number.isFinite(option.security) && (
                <small
                  className={`corp-security ${option.security >= 0.5 ? "is-high" : option.security > 0 ? "is-low" : "is-null"}`}
                >
                  {option.security.toFixed(2)}
                </small>
              )}
              {String(option.value) === String(value) && (
                <Check size={15} aria-hidden="true" />
              )}
            </label>
          ))}
          {!visible.length && (
            <p className="corp-select-empty">没有匹配选项，试试其他名称。</p>
          )}
        </div>
      </FilterDisclosure>
      {error && (
        <div className="corp-select-error" role="alert">
          <span>{error.message || "目录暂时不可用"}</span>
          {onRetry && (
            <button type="button" onClick={onRetry} disabled={disabled}>
              重试
            </button>
          )}
        </div>
      )}
    </div>
  );
}
