import { Breadcrumb, Segmented, Button, message } from "antd";
import { useDefaultPrice } from "../PlanetaryResource/useDefaultPrice";
import { HomeOutlined, UserOutlined } from "@ant-design/icons";
import styled from "styled-components";
import { useEffect, useState } from "react";
import PrePriceForm from "./PrePriceForm";
import { usePlanetResource } from "../PlanetaryResource/usePlanetResource";
import Spinner from "../../ui/Spinner";
import MiniModal from "../../ui/MiniModal";
import ConfirmResetPrePrice from "./ConfirmResetPrePrice";
import useSaveUserPrePrice from "./useSaveUserPrePrice";

const StyledDiv = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 90px;
  height: 100%;
`;

const SegmentedContainer = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 40px;
`;

const SpinnerDiv = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80%;
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 60px;
  align-items: center;
  justify-content: center;
  position: absolute; // 修改为绝对定位
  bottom: 10px; // 距离底部50px
  left: 50%; // 水平居中
  transform: translateX(-50%); // 偏移自身宽度的一半以确保真正的居中
  z-index: 10; // 确保在父容器内部元素之上
`;

function ChangePrePrice() {
  const [resourceType, setResourceType] = useState("船菜");
  const { isLoading, defaultPrice: userPrice } = useDefaultPrice("user");
  const saveUserPrePrice = useSaveUserPrePrice();
  const { isLoading: isLoadingDefault, defaultPrice } =
    useDefaultPrice("default");
  const { planetResourceList } = usePlanetResource();
  const allIcons = planetResourceList?.flatMap((group) => group.options);

  const [editablePrices, setEditablePrices] = useState([]);

  const newEditablePrices = editablePrices?.map((resource) => {
    const iconEntry = allIcons?.find(
      (icon) => icon.value === resource.resource_name
    );
    return {
      ...resource,
      icon: iconEntry ? iconEntry.icon : "", // 提供默认图标
    };
  });

  const currentReource = newEditablePrices?.filter(
    (item) => item.resource_type === resourceType
  );

  const handlePriceChange = (resourceName, newPrice) => {
    const updatedPrices = newEditablePrices.map((item) => {
      if (item.resource_name === resourceName) {
        return { ...item, resource_price: newPrice };
      }
      return item;
    });
    setEditablePrices(updatedPrices);
  };

  function handleResetPrice() {
    setEditablePrices(defaultPrice);
    message.success("价格已重置");
  }

  function handleSavePrePrice() {
    saveUserPrePrice.mutate({
      prePriceElement: { prePriceElement: newEditablePrices },
    });
  }

  useEffect(() => {
    if (userPrice) {
      setEditablePrices(userPrice);
    }
  }, [userPrice]);

  if (isLoading || isLoadingDefault)
    return (
      <SpinnerDiv>
        <Spinner />
      </SpinnerDiv>
    );

  return (
    <div>
      <Breadcrumb
        style={{ cursor: "default" }}
        items={[
          {
            title: <HomeOutlined />,
          },
          {
            title: (
              <>
                <UserOutlined />
                <span>用户设置</span>
              </>
            ),
          },
          {
            title: "修改预设价格",
          },
        ]}
      />
      <SegmentedContainer>
        <Segmented
          size="large"
          style={{
            fontSize: "20px",
            fontWeight: "500",
          }}
          options={["船菜", "建筑菜", "燃料"]}
          defaultValue={"船菜"}
          onChange={(value) => setResourceType(value)}
        />
      </SegmentedContainer>
      <StyledDiv>
        <PrePriceForm
          currentResource={currentReource}
          onPriceChange={handlePriceChange}
        />
      </StyledDiv>
      <div style={{ height: "120px", position: "relative" }}>
        <ButtonGroup>
          <Button size="large" type="primary" onClick={handleSavePrePrice}>
            保存所有价格
          </Button>
          <MiniModal>
            <MiniModal.Open opens={"resetPrePrice"}>
              <Button size="large" danger={true} onClick={handleResetPrice}>
                重置默认价格
              </Button>
            </MiniModal.Open>
            <MiniModal.Window name={"resetPrePrice"}>
              <ConfirmResetPrePrice onResetPrice={handleResetPrice} />
            </MiniModal.Window>
          </MiniModal>
        </ButtonGroup>
      </div>
    </div>
  );
}

export default ChangePrePrice;
