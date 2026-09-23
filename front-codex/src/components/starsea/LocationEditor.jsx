import { useEffect, useState } from "react";
import { getLocations, searchCorporations } from "../../services/apiStarsea";
import { ErrorNotice, useLoad } from "./StarseaUI";

export function LocationEditor({ value, onChange }) {
  const regions = useLoad(() => getLocations("regions"), []),
    constellations = useLoad(
      () =>
        value?.region_id
          ? getLocations("constellations", value.region_id)
          : Promise.resolve({ results: [] }),
      [value?.region_id],
    ),
    systems = useLoad(
      () =>
        value?.constellation_id
          ? getLocations("systems", value.constellation_id)
          : Promise.resolve({ results: [] }),
      [value?.constellation_id],
    );
  const select = (label, selected, data, disabled, change) => (
    <label>
      {label}
      <select
        aria-label={label}
        value={selected || ""}
        disabled={disabled || data.loading}
        onChange={(event) =>
          change(event.target.value ? Number(event.target.value) : null)
        }
      >
        <option value="">不限 / 未填写</option>
        {data.data?.results.map((item) => (
          <option value={item.id} key={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <ErrorNotice error={data.error} retry={data.reload} />
    </label>
  );
  return (
    <div className="ss-location-fields">
      {select("发生星域", value?.region_id, regions, false, (id) =>
        onChange(
          id
            ? { region_id: id, constellation_id: null, solarsystem_id: null }
            : null,
        ),
      )}
      {select(
        "发生星座",
        value?.constellation_id,
        constellations,
        !value?.region_id,
        (id) =>
          onChange({ ...value, constellation_id: id, solarsystem_id: null }),
      )}
      {select(
        "发生星系",
        value?.solarsystem_id,
        systems,
        !value?.constellation_id,
        (id) => onChange({ ...value, solarsystem_id: id }),
      )}
    </div>
  );
}
export function CorporationEditor({ value, onChange, selected }) {
  const [q, setQ] = useState(""),
    [result, setResult] = useState({ results: [] }),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(
      () =>
        searchCorporations(q, controller.signal)
          .then((data) => {
            if (active) {
              setResult(data);
              setError("");
            }
          })
          .catch((err) => {
            if (active && err.name !== "AbortError") setError(err.message);
          }),
      200,
    );
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);
  return (
    <div className="ss-corporation-field">
      <label>
        搜索公开军团
        <input
          value={q}
          maxLength={120}
          onChange={(event) => setQ(event.target.value)}
          placeholder="输入军团名称"
        />
      </label>
      <label>
        关联军团（选填）
        <select
          aria-label="关联军团（选填）"
          value={value || ""}
          onChange={(event) =>
            onChange(event.target.value ? Number(event.target.value) : null)
          }
        >
          <option value="">不关联军团</option>
          {value && !result.results.some((item) => item.id === value) && (
            <option value={value}>
              {selected?.id === value ? selected.name : `已关联军团 #${value}`}
            </option>
          )}
          {result.results.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <p className="ss-muted">只能关联已公开军团；关联不代表军团官方立场。</p>
      <ErrorNotice error={error} />
    </div>
  );
}
