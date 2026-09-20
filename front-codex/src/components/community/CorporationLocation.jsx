import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import {
  getCommunityRegions,
  getCommunityConstellations,
  getCommunitySolarSystems,
} from "../../services/apiCommunity";
import CorporationSelect, {
  catalogOptions,
  catalogLabel,
  catalogSecurity,
} from "./CorporationSelect";

export function CorporationLocationLabel({
  location,
  legacy,
  empty = "未填写",
}) {
  const names = location
    ? [
        location.region_name,
        location.constellation_name,
        location.solarsystem_name,
      ].filter(Boolean)
    : [];
  return (
    <span className="corp-location-label">
      {names.length ? names.join(" / ") : legacy || empty}
      {Number.isFinite(location?.security) && (
        <small
          className={`corp-security ${location.security >= 0.5 ? "is-high" : location.security > 0 ? "is-low" : "is-null"}`}
        >
          {location.security.toFixed(2)}
        </small>
      )}
    </span>
  );
}

export default function CorporationLocation({
  value,
  legacy,
  onChange,
  onLegacyChange,
  disabled,
}) {
  const [linking, setLinking] = useState(!!value);
  const regions = useQuery({
    queryKey: ["community-regions"],
    queryFn: getCommunityRegions,
    staleTime: 3600000,
    retry: 1,
  });
  const constellations = useQuery({
    queryKey: ["community-constellations", value?.region_id],
    queryFn: () => getCommunityConstellations(value.region_id),
    enabled: !!value?.region_id,
    staleTime: 3600000,
    retry: 1,
  });
  const systems = useQuery({
    queryKey: ["community-systems", value?.constellation_id],
    queryFn: () => getCommunitySolarSystems(value.constellation_id),
    enabled: !!value?.constellation_id,
    staleTime: 3600000,
    retry: 1,
  });
  const choices = (data, prefix, placeholder) => [
    { value: "", label: placeholder },
    ...catalogOptions(data, prefix),
  ];
  const selectRegion = (id) => {
    if (!id) return onChange(null);
    const item = regions.data?.find((item) => String(item.r_id) === String(id));
    onChange({
      region_id: String(id),
      constellation_id: null,
      solarsystem_id: null,
      region_name: catalogLabel(item, "r"),
      security: catalogSecurity(item?.r_safetylvl),
    });
  };
  const selectConstellation = (id) => {
    const item = constellations.data?.find(
      (item) => String(item.co_id) === String(id),
    );
    const region = regions.data?.find(
      (item) => String(item.r_id) === String(value.region_id),
    );
    onChange({
      ...value,
      constellation_id: id ? String(id) : null,
      solarsystem_id: null,
      constellation_name: id ? catalogLabel(item, "co") : undefined,
      solarsystem_name: undefined,
      security: catalogSecurity(id ? item?.co_safetylvl : region?.r_safetylvl),
    });
  };
  const selectSystem = (id) => {
    const item = systems.data?.find(
      (item) => String(item.ss_id) === String(id),
    );
    const constellation = constellations.data?.find(
      (item) => String(item.co_id) === String(value.constellation_id),
    );
    onChange({
      ...value,
      solarsystem_id: id ? String(id) : null,
      solarsystem_name: id ? catalogLabel(item, "ss") : undefined,
      security: catalogSecurity(
        id ? item?.ss_safetylvl : constellation?.co_safetylvl,
      ),
    });
  };
  return (
    <section className="corp-location-editor" aria-label="军团驻地">
      <div className="corp-location-heading">
        <div>
          <h3>
            <MapPin size={16} />
            军团驻地
          </h3>
          <p>关联星域、星座与星系，也可以只选到星域。</p>
        </div>
        {value && (
          <button
            className="corp-text-button"
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(null);
              setLinking(false);
            }}
          >
            清除关联驻地
          </button>
        )}
      </div>
      {!value && (
        <label className="corp-location-legacy-input">
          原驻地说明
          <input
            className="text-input"
            value={legacy || ""}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => onLegacyChange?.(event.target.value)}
            placeholder="可保留原来的文字说明，也可关联下方星图位置"
          />
        </label>
      )}
      {!linking && !value ? (
        <div className="corp-location-legacy">
          <p>
            {legacy
              ? `已有驻地文字：${legacy}（未关联星图，原内容会保留）`
              : "尚未关联星图驻地"}
          </p>
          <button
            type="button"
            className="ghost-btn"
            disabled={disabled}
            onClick={() => setLinking(true)}
          >
            关联星图驻地
          </button>
        </div>
      ) : (
        <>
          <div className="corp-location-selects">
            <CorporationSelect
              label="驻地星域"
              value={value?.region_id || ""}
              selectedLabel={value?.region_name}
              options={choices(regions.data, "r", "选择星域")}
              onChange={selectRegion}
              disabled={disabled}
              loading={regions.isPending}
              error={regions.error}
              onRetry={() => regions.refetch()}
            />
            <CorporationSelect
              label="驻地星座"
              value={value?.constellation_id || ""}
              selectedLabel={value?.constellation_name}
              options={choices(constellations.data, "co", "全部星座")}
              onChange={selectConstellation}
              disabled={disabled || !value?.region_id}
              loading={!!value?.region_id && constellations.isPending}
              error={value?.region_id ? constellations.error : null}
              onRetry={() => constellations.refetch()}
            />
            <CorporationSelect
              label="驻地星系"
              value={value?.solarsystem_id || ""}
              selectedLabel={value?.solarsystem_name}
              options={choices(systems.data, "ss", "全部星系")}
              onChange={selectSystem}
              disabled={disabled || !value?.constellation_id}
              loading={!!value?.constellation_id && systems.isPending}
              error={value?.constellation_id ? systems.error : null}
              onRetry={() => systems.refetch()}
            />
          </div>
          {value && (
            <p className="corp-hint">
              <CorporationLocationLabel location={value} />
            </p>
          )}
        </>
      )}
    </section>
  );
}
