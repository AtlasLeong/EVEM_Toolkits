import { Button, InputNumber, message, Radio, Select } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import usePostJumpInfo from "./usePostJumpInfo";
import { get16Color } from "./get16Color";
import { useGetBoardSystems } from "./useGetBoardSystems";
import { HiArrowLongRight } from "react-icons/hi2";
import { useSearchContext } from "../../context/SearchContext";
const Container = styled.div`
  padding: 10px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: auto;
`;

const StyledSelect = styled(Select)`
  width: 70%;
`;

const StyledDiv = styled.div`
  margin-top: 5px;
  border-radius: 10px;
  width: 95%;
  height: 250px;
  background-color: #fff;
  display: flex;
  flex-direction: column;
  padding: 10px;
  margin-bottom: 30px;
  overflow-y: auto;
  align-self: center;
`;

const TagContent = styled.div`
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 5px;
  font-size: 14px;
  border: 1px solid #d9d9d9;
  margin-bottom: 5px;
  border-radius: 5px;
  padding: 5px;
  height: auto;
  background-color: var(--color-grey-100);
`;

const SystemInfo = styled.div`
  display: flex;
  flex-direction: column;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const MoveTypeIndicator = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;

const DirtRoadIndicator = styled.div`
  font-size: 13px;
  border-radius: 20px;
  padding: 2px 6px;
  border: 1px solid var(--color-yellow-700);
  background: var(--color-yellow-100);
`;

const DistanceIndicator = styled.div`
  font-size: 13px;
  color: black;
  margin-top: 1px;
`;

const JumpPathContainter = styled.div`
  display: grid;
  gap: 3px;
  input {
    font-size: 17px !important;
  }
`;

const SummaryContainer = styled.div`
  display: flex;
  justify-content: space-around;
  width: 95%;
  margin: 10px 0;
  padding: 5px;
  background-color: #f0f0f0;
  border-radius: 5px;
  flex-shrink: 0;
`;

const SummaryItem = styled.div`
  text-align: center;
  font-size: 15px;
`;

const FlexSpan = styled.span`
  flex-shrink: 0;
  font-size: 15px;
`;

function MobileSearch() {
  const { boardSystems, isLoading } = useGetBoardSystems();
  const { searchState, updateSearchState } = useSearchContext();

  // const [jumpPathStart, setJumpPathStart] = useState(null);
  // const [jumpPathEnd, setJumpPathEnd] = useState(null);
  // const [jumpRange, setJumpRange] = useState(4.9);
  // const [inHighSecurity, setInHighSecurity] = useState(true);
  // const [pathData, setPathData] = useState([]);

  const [jumpPathStart, setJumpPathStart] = useState(searchState.jumpPathStart);
  const [jumpPathEnd, setJumpPathEnd] = useState(searchState.jumpPathEnd);
  const [jumpRange, setJumpRange] = useState(searchState.jumpRange);
  const [inHighSecurity, setInHighSecurity] = useState(
    searchState.inHighSecurity
  );
  const [pathData, setPathData] = useState(searchState.pathData);

  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const postJumpInfo = usePostJumpInfo();
  const handleClear = useCallback(() => {
    setJumpPathStart(null);
    setJumpPathEnd(null);
    setJumpRange(4.9);
    setInHighSecurity(true);
    setPathData([]);
  }, []);

  // 使用useMemo来缓存搜索选项
  const options = useMemo(() => {
    return boardSystems
      ?.filter((item) => item.zh_name !== null)
      .map((system) => ({
        value: system.zh_name,
        label: (
          <span>
            {system.zh_name} -{" "}
            <span style={{ color: get16Color(system.security_status) }}>
              {system.security_status.toFixed(1)}
            </span>
          </span>
        ),
      }));
  }, [boardSystems]);

  const getSecurityStatus = useCallback(
    (zhName) => {
      const system = boardSystems.find((sys) => sys.zh_name === zhName);
      return system ? system.security_status : null;
    },
    [boardSystems]
  );

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
        inHighSecurity: inHighSecurity,
      },
      {
        onSuccess: (data) => {
          console.log(data);
          setPathData(data);
        },
        onError: (error) => {
          message.error("获取诱导路线失败，请重试");
        },
      }
    );
  }, [jumpPathStart, jumpPathEnd, jumpRange, inHighSecurity, postJumpInfo]);

  const processPathData = useCallback(
    (data) => {
      if (!Array.isArray(data)) return [];

      const processedData = [];
      let currentGroup = [];

      data.forEach((item) => {
        if (item?.start?.move_type === "土路") {
          currentGroup.push(item);
        } else {
          if (currentGroup.length > 0) {
            processedData.push({
              start: {
                ...currentGroup[0]?.start,
                security_status: getSecurityStatus(
                  currentGroup[0]?.start?.zh_name
                ),
              },
              end: {
                ...currentGroup[currentGroup.length - 1]?.end,
                security_status: getSecurityStatus(
                  currentGroup[currentGroup.length - 1]?.end?.zh_name
                ),
              },
              move_type: "土路",
              distance: currentGroup.reduce(
                (sum, path) => sum + (path.distance || 0),
                0
              ),
              jumpCount: currentGroup.length,
            });
            currentGroup = [];
          }
          processedData.push({
            ...item,
            start: {
              ...item.start,
              security_status: getSecurityStatus(item.start?.zh_name),
            },
            end: {
              ...item.end,
              security_status: getSecurityStatus(item.end?.zh_name),
            },
          });
        }
      });

      if (currentGroup.length > 0) {
        processedData.push({
          start: {
            ...currentGroup[0]?.start,
            security_status: getSecurityStatus(currentGroup[0]?.start?.zh_name),
          },
          end: {
            ...currentGroup[currentGroup.length - 1]?.end,
            security_status: getSecurityStatus(
              currentGroup[currentGroup.length - 1]?.end?.zh_name
            ),
          },
          move_type: "土路",
          distance: currentGroup.reduce(
            (sum, path) => sum + (path.distance || 0),
            0
          ),
          jumpCount: currentGroup.length,
        });
      }

      return processedData;
    },
    [getSecurityStatus]
  );

  const { totalDirtRoadJumps, totalNonDirtRoadJumps } = useMemo(() => {
    const processedData = processPathData(pathData);
    let dirtRoadJumps = 0;
    let nonDirtRoadJumps = 0;

    processedData.forEach((item) => {
      if (item.move_type === "土路") {
        dirtRoadJumps += item.jumpCount;
      } else {
        nonDirtRoadJumps += 1;
      }
    });

    return {
      totalDirtRoadJumps: dirtRoadJumps,
      totalNonDirtRoadJumps: nonDirtRoadJumps,
    };
  }, [pathData, processPathData]);

  // 在每次这些状态改变时，更新 Context
  useEffect(() => {
    updateSearchState((prevState) => ({
      ...prevState,
      jumpPathStart,
      jumpPathEnd,
      jumpRange,
      inHighSecurity,
      pathData,
    }));
  }, [jumpPathStart, jumpPathEnd, jumpRange, inHighSecurity, pathData]);

  useEffect(() => {
    const preventDefault = (e) => {
      e.preventDefault();
    };

    if (isSelectOpen) {
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
      document.addEventListener("touchmove", preventDefault, {
        passive: false,
      });
      document.addEventListener("wheel", preventDefault, { passive: false });
    } else {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.width = "";
      document.removeEventListener("touchmove", preventDefault);
      document.removeEventListener("wheel", preventDefault);
    }

    return () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.width = "";
      document.removeEventListener("touchmove", preventDefault);
      document.removeEventListener("wheel", preventDefault);
    };
  }, [isSelectOpen]);

  const handleSelectOpen = useCallback(() => {
    setIsSelectOpen(true);
  }, []);

  const handleSelectClose = useCallback(() => {
    setIsSelectOpen(false);
  }, []);

  return (
    <Container>
      <JumpPathContainter>
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
          onDropdownVisibleChange={(open) => {
            if (open) {
              handleSelectOpen();
            } else {
              handleSelectClose();
            }
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
          onDropdownVisibleChange={(open) => {
            if (open) {
              handleSelectOpen();
            } else {
              handleSelectClose();
            }
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
            gap: "10px", // 添加按钮之间的间隔
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
          <Button
            style={{ marginTop: "5px", width: "40%" }} // 调整宽度
            onClick={handleClear}
            danger={true}
          >
            清除
          </Button>
        </div>
        <span style={{ color: "red", fontSize: "12px", letterSpacing: "1px" }}>
          *算法已考虑多种情况(如高低安土路与旗舰鸿沟)，但仍可能不是最佳诱导方案，出现bug或优化建议请与本人反馈
        </span>
      </JumpPathContainter>

      <SummaryContainer>
        <SummaryItem>
          <strong>土路总跳数：</strong> {totalDirtRoadJumps}
        </SummaryItem>
        <SummaryItem>
          <strong>非土路总跳数：</strong> {totalNonDirtRoadJumps}
        </SummaryItem>
      </SummaryContainer>

      <StyledDiv>
        {processPathData(pathData).map((item, index) => (
          <TagContent key={index}>
            <SystemInfo>
              <span>{item?.start?.zh_name || "未知"}</span>
              <span
                style={{
                  color: `${get16Color(item?.start?.security_status ?? 0)}`,
                }}
              >
                {item?.start?.security_status != null
                  ? item.start.security_status.toFixed(1)
                  : "N/A"}
              </span>
            </SystemInfo>
            <MoveTypeIndicator>
              {item?.move_type === "土路" ? (
                <>
                  <DirtRoadIndicator>土路</DirtRoadIndicator>
                  <DistanceIndicator>{item.jumpCount} 跳</DistanceIndicator>
                </>
              ) : (
                <>
                  <HiArrowLongRight style={{ fontSize: "18px" }} />
                  <DistanceIndicator>
                    {item.distance?.toFixed(2)} 光年
                  </DistanceIndicator>
                </>
              )}
            </MoveTypeIndicator>
            <SystemInfo style={{ textAlign: "right" }}>
              <span>{item?.end?.zh_name || "未知"}</span>
              <span
                style={{
                  color: `${get16Color(item?.end?.security_status ?? 0)}`,
                }}
              >
                {item?.end?.security_status != null
                  ? item.end.security_status.toFixed(1)
                  : "N/A"}
              </span>
            </SystemInfo>
          </TagContent>
        ))}
      </StyledDiv>
    </Container>
  );
}

export default MobileSearch;
