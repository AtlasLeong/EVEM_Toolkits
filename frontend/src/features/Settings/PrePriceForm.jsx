import styled from "styled-components";
import { InputNumber } from "antd";
import { useEffect, useState } from "react";

const FlexContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  margin: -10px; // 为了抵消子元素的外边距
  padding-left: 30px;
  padding-right: 30px;
`;

const FlexItem = styled.div`
  flex: 0 0 25%; // 现在设置为不增长，不收缩，基础宽度为25%
  max-width: 25%; // 保持最大宽度为25%
  padding: 10px; // 添加内边距
`;

const StyledImg = styled.img`
  width: 70px;
  height: 38px;
  border-radius: 5px;
`;

const DisplayContainer = styled.div`
  display: flex;
  justify-content: left;
  align-items: center;
`;

function PrePriceForm({ currentResource, onPriceChange }) {
  const [prices, setPrices] = useState({});

  // 当 currentResource 改变时，更新 prices 状态
  useEffect(() => {
    const newPrices = currentResource.reduce((acc, resource) => {
      acc[resource.resource_name] = resource.resource_price;
      return acc;
    }, {});
    setPrices(newPrices);
  }, [currentResource]);

  const handlePriceChange = (resourceName, newPrice) => {
    setPrices((prevPrices) => ({
      ...prevPrices,
      [resourceName]: newPrice,
    }));
    onPriceChange(resourceName, newPrice);
  };

  return (
    <div style={{ height: "450px" }}>
      <FlexContainer>
        {currentResource.map((item) => (
          <FlexItem key={item.resource_name}>
            <DisplayContainer>
              <StyledImg src={item.icon} />
              <span>{item.resource_name}</span>
            </DisplayContainer>
            <InputNumber
              style={{ width: "90%" }}
              suffix="$"
              value={prices[item.resource_name]}
              min={0}
              onChange={(newPrice) =>
                handlePriceChange(item.resource_name, newPrice)
              }
            />
          </FlexItem>
        ))}
      </FlexContainer>
    </div>
  );
}

export default PrePriceForm;
