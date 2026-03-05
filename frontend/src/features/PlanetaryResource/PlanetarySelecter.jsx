import React, { useEffect, useRef, useState } from "react";
import Select, { components } from "react-select";
import makeAnimated from "react-select/animated";

import styled from "styled-components";
import { usePlanetResource } from "./usePlanetResource";

const StyledImg = styled.img`
  width: 70px;
  height: 38px;
  border-radius: 5px;
`;

const StyledDiv = styled.div`
  display: flex;
  align-items: center;
`;

const StyledSpan = styled.span`
  font-size: 15px;
  font-weight: bold;
  margin-left: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  max-width: 150px;
`;

const animatedComponents = makeAnimated();
const customStyles = {
  control: (base) => ({
    ...base,
    minHeight: "55px", // 设置最小高度以确保即使内容较少时也保持高度
  }),
  // 修改多值标签的样式
  multiValue: (styles, { isFocused }) => ({
    ...styles,
    maxWidth: "100%",
    borderRadius: "5px",
    backgroundColor: isFocused
      ? "var(--color-grey-500)"
      : "var(--color-grey-500)", // 当标签被聚焦时使用暗灰色，否则使用灰色
  }),
  multiValueLabel: (styles, { isFocused }) => ({
    ...styles,
    color: "var(--color-grey-50)", // 根据需要调整文字颜色
  }),
  multiValueRemove: (styles) => ({
    ...styles,
    color: "white", // 调整移除按钮的颜色
    ":hover": {
      backgroundColor: "red",
      color: "white",
    },
    marginLeft: "5px",
  }),
};
// 自定义 MultiValueLabel 组件
const CustomMultiValueLabel = (props) => (
  <components.MultiValueLabel {...props}>
    <StyledDiv>
      <StyledImg src={props.data.icon} alt={props.data.label} />
      <StyledSpan>{props.data.label}</StyledSpan>
    </StyledDiv>
  </components.MultiValueLabel>
);

const formatGroupLabel = (data) => (
  <span style={{ fontSize: "20px", fontWeight: "bold" }}>{data.label}</span>
);

function PlanetarySelecter({ planetaryField }) {
  const { planetResourceList, isLoading } = usePlanetResource();
  const [selectWidth, setSelectWidth] = useState(500);

  const optionRef = useRef();
  const optionWidthIncrement =
    optionRef.current?.offsetWidth / (planetaryField.value?.length + 1);

  // 处理选择变化的内部函数
  const handleChange = (selectedOption) => {
    // 先根据选中选项的数量调整宽度
    if (selectedOption.length >= 2) {
      setSelectWidth((width) => width + optionWidthIncrement);
    }
    // 调用从props传入的onChange，更新外部表单状态
    planetaryField.onChange(selectedOption);
  };

  useEffect(() => {
    // 根据选中的选项数量调整宽度
    if (planetaryField.value?.length === 0 || !planetaryField.value) {
      // 如果没有选中的选项，重置宽度为初始值

      setSelectWidth(500);
    }
  }, [planetaryField.value]);

  return (
    <div
      style={{
        width: `${selectWidth}px`,
        transition: "width 0.5s",
        maxWidth: "1100px",
      }}
    >
      <h3>行星资源</h3>
      <Select
        {...planetaryField}
        options={planetResourceList}
        isMulti
        name="planetary"
        classNamePrefix="select"
        components={{
          ...animatedComponents,
          MultiValueLabel: CustomMultiValueLabel,
        }}
        formatGroupLabel={formatGroupLabel}
        styles={customStyles}
        placeholder="输入或选择行星菜（可多选）"
        // 如果你想要在选中后的Input框中也显示图标，你还需要自定义 ValueContainer 或 SingleValue 组件
        getOptionLabel={(option) => (
          <StyledDiv ref={optionRef}>
            <StyledImg src={option.icon} alt={option.label} />
            <StyledSpan>{option.label}</StyledSpan>
          </StyledDiv>
        )}
        isLoading={isLoading}
        onChange={handleChange} // 使用自定义的handleChange来处理选择变化
      />
    </div>
  );
}

export default PlanetarySelecter;
