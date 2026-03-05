import React, { useCallback, useEffect, useRef, useState } from "react";
import { Select, Button, Radio, Flex, InputNumber, message } from "antd";
import styled from "styled-components";
import { get16Color } from "./get16Color";
import { HiArrowLongRight } from "react-icons/hi2";
import { IoCloseOutline } from "react-icons/io5";
import usePostJumpInfo from "./usePostJumpInfo";

import { FaArrowLeft, FaArrowRight } from "react-icons/fa";

const TopContainer = styled.div`
  position: absolute;
  top: 5px;
  left: ${($props) => ($props.$isVisible ? "1px" : "-340px")};
  z-index: 10;
  background: rgba(255, 255, 255, 0.8);
  padding: 10px;
  border-radius: 5px;
  max-height: 90vh;
  overflow-y: auto;
  transition: left 0.3s ease-in-out;
  width: 340px;
`;

const ToggleButton = styled.button`
  position: absolute;
  left: ${($props) => ($props.$isVisible ? "341px" : "0px")};
  z-index: 11;
  transition: left 0.3s ease-in-out;
  padding: 0;
  margin: 0;
  height: 50px;
  width: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.8);
  border: none;
  border-right: 1px solid #d9d9d9;
  border-top-right-radius: 4px;
  border-bottom-right-radius: 4px;
  box-shadow: 2px 0 5px rgba(0, 0, 0, 0.1);
  &:hover {
    background-color: #f5f5f5;
  }
  &:focus {
    outline: none;
  }
`;

const SearchContainer = styled.div`
  display: flex;
  gap: 10px;
`;

const StyledSelect = styled(Select)`
  width: 200px;
`;

const StyledRadio = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 10px;
`;

const StyledDiv = styled.div`
  margin-top: 10px;
  border-radius: 10px;
  width: 95%;
  min-height: 200px; // 改为最小高度
  background-color: #fff;
  display: flex;
  flex-direction: column;
  padding: 5px;
  overflow-y: auto; // 添加垂直滚动条
  max-height: 70vh; // 设置最大高度,防止过度扩展
  overflow-y: auto;
  height: 200px;
`;

const TagContent = styled.div`
  display: grid;
  grid-template-columns: 1fr auto 1fr auto;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  border: 1px solid #d9d9d9;
  margin-bottom: 5px;
  border-radius: 5px;
  padding: 5px;
  background-color: var(--color-grey-100);
`;

const DeleteButtonContainer = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const SystemInfo = styled.div`
  display: flex;
  flex-direction: column;
  align-items: ${(props) => props.$align || "flex-start"};
`;

const SystemName = styled.span`
  font-weight: bold;
`;

const SecurityStatus = styled.span`
  color: ${(props) => props.$color};
`;

const DirtRoadContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`;

const DirtRoadBadge = styled.div`
  font-size: 12px;
  border-radius: 20px;
  padding: 2px 5px;
  border: 1px solid var(--color-yellow-700);
  background: var(--color-yellow-100);
`;

const JumpsCount = styled.div`
  font-size: 12px;
  margin-top: 2px;
  color: var(--color-grey-600);
`;

const JumpPathContainter = styled.div`
  display: grid;
  gap: 3px;
`;

const FlexSpan = styled.span`
  flex-shrink: 0;
  font-size: 14px;
`;

const ArrowContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`;

const DistanceText = styled.span`
  font-size: 12px;
  color: var(--color-grey-600);
  margin-top: 2px;
`;
function SearchBox({
  options,
  onSearch,
  isLoading,
  startSystems,
  endSystems,
  onRemoveInductionGroup,
  lineMode,
  setLineMode,
  setPathData,
  path,
}) {
  const [searchTerm, setSearchTerm] = useState(null);

  const [jumpPathStart, setJumpPathStart] = useState(null);
  const [jumpPathEnd, setJumpPathEnd] = useState(null);
  const [jumpRange, setJumpRange] = useState(4.9);

  const [inHighSecurity, setInHighSecurity] = useState(true);
  const [dirtRoad, setDirtRoad] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const [buttonTop, setButtonTop] = useState(0);

  const containerRef = useRef(null);
  const postJumpInfo = usePostJumpInfo();

  const [pathData, setLocalPathData] = useState([]);

  const getDistanceBetweenSystems = (startSystem, endSystem) => {
    for (const pathSegment of pathData) {
      if (
        pathSegment.start.system_id === startSystem.system_id &&
        pathSegment.end.system_id === endSystem.system_id
      ) {
        return pathSegment.distance.toFixed(2); // 保留两位小数
      }
    }
    return null; // 如果没有找到匹配的路径段
  };

  useEffect(() => {
    if (path) {
      setLocalPathData(path);
    }
  }, [path]);

  const getDirtRoadJumps = (startSystem) => {
    let jumps = 0;
    let isCountingDirtRoad = false;

    for (const pathSegment of pathData) {
      if (pathSegment.start.system_id === startSystem.system_id) {
        isCountingDirtRoad = true;
      }

      if (isCountingDirtRoad) {
        if (
          pathSegment.start.move_type === "土路" &&
          pathSegment.end.move_type === "土路"
        ) {
          jumps++;
        } else {
          // 如果遇到非土路系统，停止计数
          break;
        }
      }
    }

    return jumps;
  };

  useEffect(() => {
    const updateButtonPosition = () => {
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        setButtonTop(containerRect.top + containerRect.height / 2 - 100);
      }
    };

    updateButtonPosition();
    window.addEventListener("resize", updateButtonPosition);

    return () => {
      window.removeEventListener("resize", updateButtonPosition);
    };
  }, []);

  const toggleVisibility = () => {
    setIsVisible((prev) => !prev);
  };

  const handlePostJumpInfo = useCallback(() => {
    if (!jumpPathEnd || !jumpPathStart || !jumpRange) {
      message.warning("请选择完整诱导信息");
      return;
    }
    if (postJumpInfo.isLoading) {
      return; // 防止多次点击
    }

    postJumpInfo.mutate(
      {
        start_system: jumpPathStart,
        end_system: jumpPathEnd,
        max_distance: jumpRange,
        dict_road: dirtRoad,
        inHighSecurity: inHighSecurity,
      },
      {
        onSuccess: (data) => {
          setPathData(data);
        },
        onError: (error) => {
          message.error("获取诱导路线失败，请重试");
        },
      }
    );
  }, [
    jumpPathStart,
    jumpPathEnd,
    jumpRange,
    dirtRoad,
    inHighSecurity,
    postJumpInfo,
    setPathData,
  ]);

  return (
    <>
      <TopContainer $isVisible={isVisible} ref={containerRef}>
        <h3>定位星系</h3>
        <SearchContainer>
          <StyledSelect
            allowClear
            options={options}
            value={searchTerm}
            onChange={(value) => setSearchTerm(value)}
            placeholder="请选择星系"
            showSearch
            loading={isLoading}
            filterOption={(input, option) => {
              const zhName = option.label.props.children[0];
              return zhName?.toLowerCase().includes(input.toLowerCase());
            }}
          />
          <Button
            onClick={() => onSearch(searchTerm)}
            disabled={isLoading}
            type="primary"
          >
            搜索
          </Button>
        </SearchContainer>
        <StyledRadio>
          <Flex vertical gap="middle" style={{ marginTop: "10px" }}>
            <Radio.Group
              value={lineMode}
              buttonStyle="solid"
              onChange={(e) => setLineMode(e.target.value)}
            >
              <Radio.Button value="Single induction">单次诱导</Radio.Button>
              <Radio.Button value="multiple inductions">多次诱导</Radio.Button>
            </Radio.Group>
          </Flex>
        </StyledRadio>
        <JumpPathContainter>
          <h3>自动诱导规划</h3>
          <FlexSpan>起点：</FlexSpan>
          <StyledSelect
            allowClear
            options={options}
            value={jumpPathStart}
            onChange={(value) => setJumpPathStart(value)}
            placeholder="请选择星系"
            showSearch
            loading={isLoading}
            filterOption={(input, option) => {
              const zhName = option.label.props.children[0];
              return zhName?.toLowerCase().includes(input.toLowerCase());
            }}
          />
          <FlexSpan> 终点：</FlexSpan>
          <StyledSelect
            allowClear
            options={options}
            value={jumpPathEnd}
            onChange={(value) => setJumpPathEnd(value)}
            placeholder="请选择星系"
            showSearch
            loading={isLoading}
            filterOption={(input, option) => {
              const zhName = option.label.props.children[0];
              return zhName?.toLowerCase().includes(input.toLowerCase());
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: "3px",
              marginBottom: "3px",
            }}
          >
            <FlexSpan> 最大跳跃范围（光年）：</FlexSpan>

            <InputNumber
              min={0.1}
              value={jumpRange}
              onChange={(value) => setJumpRange(value)}
            ></InputNumber>
          </div>
          {/* <div style={{ display: "flex" }}>
          <FlexSpan style={{ width: "130px" }}>是否在高低安土路：</FlexSpan>{" "}
          <Radio.Group
            style={{ flex: "none" }}
            value={dirtRoad}
            onChange={(e) => setDirtRoad(e.target.value)}
          >
            <Radio value={true}>是</Radio>
            <Radio value={false}>否</Radio>
          </Radio.Group>
        </div> */}
          <div style={{ display: "flex" }}>
            <FlexSpan style={{ width: "130px" }}>能否进入高安：</FlexSpan>{" "}
            <Radio.Group
              style={{ flex: "none" }}
              value={inHighSecurity}
              onChange={(e) => setInHighSecurity(e.target.value)}
            >
              <Radio value={true}>是</Radio>
              <Radio value={false}>否</Radio>
            </Radio.Group>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Button
              type="primary"
              style={{ marginTop: "5px", width: "50%" }}
              onClick={handlePostJumpInfo}
              loading={postJumpInfo.isLoading} // 显示加载状态
              disabled={postJumpInfo.isLoading} // 禁用按钮防止多次点击
            >
              获取诱导路线
            </Button>
          </div>
          <span
            style={{ color: "red", fontSize: "12px", letterSpacing: "1px" }}
          >
            *算法已考虑多种情况(如高低安土路与旗舰鸿沟)，但仍可能不是最佳诱导方案，出现bug或优化建议请与本人反馈
          </span>
        </JumpPathContainter>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <StyledDiv>
            {startSystems.map((startSystem, index) => {
              const endSystem = endSystems[index];
              const dirtRoadJumps = getDirtRoadJumps(startSystem);
              const distance = getDistanceBetweenSystems(
                startSystem,
                endSystem
              );

              if (endSystem) {
                return (
                  <TagContent key={index}>
                    <SystemInfo>
                      <SystemName>{startSystem.name}</SystemName>
                      <SecurityStatus
                        $color={get16Color(startSystem.security_status)}
                      >
                        {startSystem.security_status}
                      </SecurityStatus>
                    </SystemInfo>
                    {startSystem.move_type === "土路" ? (
                      <DirtRoadContainer>
                        <DirtRoadBadge>土路</DirtRoadBadge>
                        {dirtRoadJumps > 0 && (
                          <JumpsCount>{dirtRoadJumps} 跳</JumpsCount>
                        )}
                      </DirtRoadContainer>
                    ) : (
                      <ArrowContainer>
                        <HiArrowLongRight style={{ fontSize: "24px" }} />
                        {distance && (
                          <DistanceText>{distance} 光年</DistanceText>
                        )}
                      </ArrowContainer>
                    )}
                    <SystemInfo $align="flex-end">
                      <SystemName>{endSystem.name}</SystemName>
                      <SecurityStatus
                        $color={get16Color(endSystem.security_status)}
                      >
                        {endSystem.security_status}
                      </SecurityStatus>
                    </SystemInfo>
                    <DeleteButtonContainer>
                      <Button
                        icon={<IoCloseOutline />}
                        type="text"
                        size="small"
                        onClick={() =>
                          onRemoveInductionGroup(startSystem, endSystem)
                        }
                      />
                    </DeleteButtonContainer>
                  </TagContent>
                );
              }
              return null;
            })}
          </StyledDiv>
        </div>
      </TopContainer>
      <ToggleButton
        onClick={toggleVisibility}
        $isVisible={isVisible}
        style={{ top: `300px` }}
      >
        {isVisible ? (
          // style={{ color: "#1890ff" }}
          <FaArrowLeft />
        ) : (
          <FaArrowRight />
        )}
      </ToggleButton>
    </>
  );
}

export default SearchBox;
