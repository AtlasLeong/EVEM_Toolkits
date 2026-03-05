import Select, { components } from "react-select";
import styled from "styled-components";
import { useRegions } from "./useRegions";
import { useConstellations } from "./useConstellations";
import { useSolarSystems } from "./useSolarSystems";
import RegionLevelSpan from "../../ui/RegionLevelSpan";
import { useEffect } from "react";

const NameSpan = styled.span`
  font-weight: bold;
`;

const StyledDiv = styled.div`
  width: 400px;
`;

const formatGroupLabel = (data) => (
  <span
    style={{
      fontSize: "18px",
      fontWeight: "bold",
    }}
  >
    {data.label}
  </span>
);

const CustomOption = (props) => {
  const { security, label } = props.data;
  const name = label.split(" - ")[1]; // 分割以获取名称
  return (
    <components.Option {...props}>
      {/* 安全等级用不同颜色显示，而名称保持默认样式 */}
      <NameSpan>
        {name}
        <RegionLevelSpan security={security}> {security}</RegionLevelSpan>
      </NameSpan>
    </components.Option>
  );
};

const CustomMultiValue = function (option) {
  const { security, label } = option.data;
  const name = label.split(" - ")[1]; // 分割以获取名称
  return (
    <>
      <components.MultiValue {...option}>
        {/* 同样，仅改变安全等级的颜色 */}
        <NameSpan>
          {name}
          <RegionLevelSpan security={security}> {security}</RegionLevelSpan>
        </NameSpan>
      </components.MultiValue>
    </>
  );
};

const CustomSingleValue = ({ children, ...props }) => {
  const { security, label } = props.data;
  const name = label.split(" - ")[1]; // 分割以获取名称
  return (
    <components.SingleValue {...props}>
      {/* 同样，仅改变安全等级的颜色 */}
      <NameSpan>
        {name}
        <RegionLevelSpan security={security}> {security}</RegionLevelSpan>
      </NameSpan>
    </components.SingleValue>
  );
};
function RegionsSelecter({
  regionField,
  constellationField,
  systemField,
  setValue,
}) {
  // 使用自定义钩子获取数据
  const { regions } = useRegions();
  const { constellations, isLoading: isLoadingConstellations } =
    useConstellations(regionField.value?.map((region) => region.value));
  const { solarSystems, isLoading: isLoadingSolarSystem } = useSolarSystems(
    constellationField.value?.map((co) => co.value)
  );

  useEffect(
    () => {
      // 对于星座的处理
      if (regionField.value?.length === 0 || !regionField.value) {
        setValue("constellation", null);
      } else {
        const newConstellationValue =
          constellationField.value?.filter((co) =>
            regionField.value
              .map((region) => region.value)
              .includes(co.co_region_id)
          ) || [];

        if (
          JSON.stringify(constellationField.value) !==
          JSON.stringify(newConstellationValue)
        ) {
          setValue("constellation", newConstellationValue);
        }
      }
    }, // eslint-disable-next-line react-hooks/exhaustive-deps
    [regionField.value, setValue]
  );

  useEffect(
    () => {
      // 对于星系的处理
      if (
        constellationField.value &&
        regionField.value?.length !== 0 &&
        constellationField.value?.length !== 0
      ) {
        const newSystemValue =
          systemField.value?.filter((ss) =>
            constellationField.value
              .map((co) => co.value)
              .includes(ss.ss_constellation_id)
          ) || [];

        if (
          JSON.stringify(constellationField.value) !==
          JSON.stringify(newSystemValue)
        ) {
          setValue("system", newSystemValue);
        }
      } else {
        setValue("system", null);
      }
    }, // eslint-disable-next-line react-hooks/exhaustive-deps
    [regionField.value, constellationField.value, setValue]
  );

  return (
    <div style={{ display: "flex", gap: "20px" }}>
      <StyledDiv>
        <h3>星域</h3>
        <Select
          {...regionField}
          options={
            regions
              ? regions.map((region) => ({
                  value: region.r_id,
                  label: `${region.r_safetylvl} - ${region.r_title}`,
                  security: region.r_safetylvl,
                }))
              : []
          }
          isMulti
          placeholder="搜索或选择星域"
          components={{
            Option: CustomOption,
            SingleValue: CustomSingleValue,
            MultiValue: CustomMultiValue,
          }}
          styles={{
            menu: (provided) => ({
              ...provided,
              zIndex: 9999, // 设置一个较高的z-index值
            }),
          }}
        />
      </StyledDiv>
      <StyledDiv>
        <h3>星座</h3>
        <Select
          {...constellationField}
          options={
            constellations
              ? constellations.map((group) => ({
                  label: group.label,
                  options: group.options.map((constellation) => ({
                    value: constellation.co_id,
                    label: `${constellation.co_safetylvl} - ${constellation.co_title}`,
                    security: constellation.co_safetylvl,
                    co_region_id: constellation.co_region_id,
                  })),
                }))
              : []
          }
          placeholder="选填"
          isMulti
          components={{
            Option: CustomOption,
            SingleValue: CustomSingleValue,
            MultiValue: CustomMultiValue,
          }}
          isDisabled={!regionField.value || regionField.value.length === 0}
          isLoading={isLoadingConstellations}
          styles={{
            menu: (provided) => ({
              ...provided,
              zIndex: 9999, // 设置一个较高的z-index值
            }),
          }}
          formatGroupLabel={formatGroupLabel}
        />
      </StyledDiv>
      <StyledDiv>
        <h3>星系</h3>
        <Select
          {...systemField}
          options={
            solarSystems
              ? solarSystems.map((group) => ({
                  label: group.label,
                  options: group.options.map((system) => ({
                    value: system.ss_id,
                    label: `${system.ss_safetylvl} - ${system.ss_title}`,
                    security: system.ss_safetylvl,
                    ss_constellation_id: system.ss_constellation_id,
                  })),
                }))
              : []
          }
          placeholder="选填"
          components={{
            Option: CustomOption,
            SingleValue: CustomSingleValue,
            MultiValue: CustomMultiValue,
          }}
          isMulti
          isDisabled={
            !constellationField.value || constellationField.value.length === 0
          }
          isLoading={isLoadingSolarSystem}
          formatGroupLabel={formatGroupLabel}
          styles={{
            menu: (provided) => ({
              ...provided,
              zIndex: 9999, // 设置一个较高的z-index值
            }),
          }}
        />
      </StyledDiv>
    </div>
  );
}
export default RegionsSelecter;
