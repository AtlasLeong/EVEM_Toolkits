import styled from "styled-components";

import Stat from "../../ui/Stat";
import CountUp from "react-countup";
import { PiAlignLeftSimpleFill } from "react-icons/pi";
import { PiAlignLeftFill } from "react-icons/pi";
import { AiFillMoneyCollect, AiOutlineMoneyCollect } from "react-icons/ai";
import {
  RiMoneyCnyBoxFill,
  RiMoneyEuroBoxFill,
  RiMoneyEuroCircleFill,
} from "react-icons/ri";
import {
  Select as AntdSelect,
  Button,
  Card,
  InputNumber,
  Radio,
  message,
} from "antd";
import { useBazaarNameList } from "./useBazaarNameList";
import { useEffect, useState } from "react";

import Select from "react-select";
import { useBazaarBox } from "./useBazaarBox";
import MyButton from "../../ui/Button";
import { v4 as uuidv4 } from "uuid";
import { IoCloseOutline } from "react-icons/io5";
import BazaarBoxRank from "./BazaarBoxRank";
const StyledImg = styled.img`
  width: auto;
  height: 42px;
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
  max-width: 200px;
`;

const CalculatorContainer = styled.div`
  background-color: #fff;
  min-height: 800px; // 从 height 改为 min-height
  width: auto;
  border-radius: 5px;
  display: flex; // 新增
  flex-direction: column; // 新增
`;
const Value = styled.div`
  font-size: 2.4rem;
  line-height: 1;
  font-weight: 500;
  align-items: center;
`;
const Heading = styled.h3`
  padding: 5px 10px; /* 添加内边距 */
  margin: 10px;
`;
const HeadingDiv = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const StatsDiv = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 50px;
`;

const SelecterDiv = styled.div`
  display: flex;
  justify-content: center;
  gap: 40px;
  margin-top: 30px;
`;

const customStyles = {
  control: (base) => ({
    ...base,
    width: "300px", // 设置最小高度以确保即使内容较少时也保持高度
    height: "50px",
  }),
};

const CustomFlexDiv = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  white-space: pre;
`;

const ResultDiv = styled.div`
  background-color: var(--color-grey-100);
  display: grid;
  grid-template-columns: repeat(4, 1fr); // 简化写法
  min-height: 500px; // 从 height 改为 min-height
  margin: 20px;
  border-radius: 5px;
  gap: 10px;
  flex-wrap: wrap;
`;

const StyledCard = styled(Card)`
  margin: 20px;
  width: 280px;
  height: 210px;
  .ant-card-body {
    padding: 0 !important; /* 取消内边距 */
  }
  .ant-card-head {
    padding: 0 !important; /* 取消内边距 */
    margin: 0;
  }
`;

const CardGridDiv = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr; // 两列，每列宽度相等
  grid-template-rows: 40px 40px 40px; // 第一行高度自动，从第二行开始高度固定为30px
  padding: 0;
  margin: 0;
`;

const FirstRow = styled.div`
  grid-column: 1 / -1; /* 跨越所有列 */
  display: flex;
  justify-content: center;
  align-items: center;
  white-space: pre;
`;

const FlexSpan = styled.span`
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 16px;
`;

const CardSpan = styled.span`
  font-size: "18px";
`;

const CouponDiv = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2px 2px;
  border-radius: 5px;
  width: 80px;
  height: 30px;
`;

function BazaarCalculator() {
  const { isLoading, bazaarNameList } = useBazaarNameList();
  const [bazaarName, setBazaarName] = useState("终焉回响");
  const { isLoading: isLoadingBazaarBox, bazaarBox } = useBazaarBox(bazaarName);
  const [selectBox, setSelectBox] = useState(null);
  const [selectNumber, setSelectNumber] = useState(1);
  const [coupon, setCoupon] = useState(1);
  const [bazaarItemList, setBazaarItemList] = useState([]);

  const [showLuckyRank, setShowLuckyRank] = useState(false);

  const totalBasicLucky = bazaarItemList.reduce(
    (acc, item) => acc + item.basic_lucky * item.selectNumber,
    0
  );

  const totalExpectedLucky = bazaarItemList.reduce(
    (acc, item) => acc + item.expected_value * item.selectNumber,
    0
  );

  const totalLiangziCost = bazaarItemList
    .filter((item) => item.unit === "量子元")
    .reduce(
      (acc, item) => acc + item.price * item.selectNumber * item.coupon,
      0
    );
  const totalYiDianCost = bazaarItemList
    .filter((item) => item.unit === "伊甸币")
    .reduce(
      (acc, item) => acc + item.price * item.selectNumber * item.coupon,
      0
    );

  const totalISKCost = bazaarItemList
    .filter((item) => item.unit === "星币")
    .reduce(
      (acc, item) => acc + item.price * item.selectNumber * item.coupon,
      0
    );

  function handleShowLuckyRank() {
    setShowLuckyRank((show) => !show);
  }

  function handleAddBazaarItem() {
    if (!selectBox || !selectNumber) {
      message.warning("请选择幸运箱与数量");
      return;
    }
    setBazaarItemList((list) => [
      ...list,
      { ...selectBox, coupon, selectNumber, id: uuidv4() },
    ]);
    setCoupon(1);
    setSelectBox(null);
    setSelectNumber(null);
  }

  function handleDeleteBazaarItem(id) {
    setBazaarItemList((list) => list.filter((item) => item.id !== id));
  }

  useEffect(() => {
    setSelectBox(null);
    setBazaarItemList([]);
  }, [bazaarName]);

  return (
    <CalculatorContainer>
      {showLuckyRank && (
        <BazaarBoxRank
          bazaarBoxRank={showLuckyRank}
          setShowBazaarRank={setShowLuckyRank}
          bazaarNameList={bazaarNameList}
        ></BazaarBoxRank>
      )}
      <div>
        <Heading>幸运值期望计算器</Heading>
        <HeadingDiv>
          <AntdSelect
            loading={isLoading}
            options={bazaarNameList}
            style={{
              width: "150px",
              marginLeft: "20px",
            }}
            value={bazaarName}
            onChange={(value) => setBazaarName(value)}
          ></AntdSelect>
          <MyButton
            style={{ marginRight: "40px" }}
            onClick={handleShowLuckyRank}
          >
            幸运箱成本排行榜
          </MyButton>
        </HeadingDiv>
      </div>
      <StatsDiv>
        <Stat
          title="总保底幸运值"
          icon={<PiAlignLeftSimpleFill />}
          color={"green"}
          value={
            <Value>
              <CountUp end={totalBasicLucky} duration={0.5} />
            </Value>
          }
        ></Stat>
        <Stat
          title="总期望幸运值"
          icon={<PiAlignLeftFill />}
          color={"blue"}
          value={
            <Value>
              <CountUp end={totalExpectedLucky} decimals={2} duration={0.5} />
            </Value>
          }
        ></Stat>
        <Stat
          title="总花费量子元"
          icon={<RiMoneyEuroBoxFill />}
          color={"red"}
          value={
            <Value>
              <CountUp end={totalLiangziCost} duration={0.5} />
            </Value>
          }
        ></Stat>
        <Stat
          title="总花费伊甸币"
          icon={<AiOutlineMoneyCollect />}
          color={"yellow"}
          value={
            <Value>
              <CountUp end={totalYiDianCost} duration={0.5} />
            </Value>
          }
        ></Stat>
        <Stat
          title="总花费ISK"
          icon={<RiMoneyCnyBoxFill />}
          color={"grey"}
          value={
            <Value>
              <CountUp end={totalISKCost / 100000000} duration={0.5} /> 亿
            </Value>
          }
        ></Stat>
      </StatsDiv>
      <SelecterDiv>
        <CustomFlexDiv>
          <h3>集市幸运箱: </h3>
          <Select
            styles={customStyles}
            placeholder="选择 或 搜索 幸运箱"
            onChange={(value) => setSelectBox(value)}
            value={selectBox}
            options={bazaarBox}
            getOptionLabel={(option) => (
              <StyledDiv>
                <StyledImg src={option.picture_url} alt={option.box} />
                <StyledSpan>{option.box}</StyledSpan>
              </StyledDiv>
            )}
            isLoading={isLoadingBazaarBox}
            filterOption={(option, inputValue) => {
              return option.data.box
                .toLowerCase()
                .includes(inputValue.toLowerCase());
            }}
            getOptionValue={(option) => option.id}
          ></Select>
        </CustomFlexDiv>
        <CustomFlexDiv>
          <h3>数量：</h3>
          <InputNumber
            min={1}
            defaultValue={1}
            style={{ fontSize: "16px", height: "44px" }}
            value={selectNumber}
            onChange={(value) => setSelectNumber(value)}
          ></InputNumber>
        </CustomFlexDiv>
        <CustomFlexDiv>
          <Radio.Group
            onChange={(e) => setCoupon(e.target.value)}
            value={coupon}
          >
            <Radio value={0.5} style={{ fontWeight: "800" }}>
              五折卷
            </Radio>
            <Radio value={0.7} style={{ fontWeight: "800" }}>
              七折卷
            </Radio>
            <Radio value={1} style={{ fontWeight: "800" }}>
              不使用卷
            </Radio>
          </Radio.Group>
        </CustomFlexDiv>
        <Button
          size="large"
          type="primary"
          style={{ height: "44px" }}
          onClick={handleAddBazaarItem}
        >
          添加计算
        </Button>
      </SelecterDiv>
      <ResultDiv>
        {bazaarItemList.map((item) => (
          <StyledCard
            title={
              <CustomFlexDiv style={{ height: "56px", marginLeft: "15px" }}>
                <StyledImg src={item.picture_url} alt={item.box} />
                <StyledSpan>{item.box}</StyledSpan>
                <Button
                  style={{
                    marginLeft: "auto",
                    marginBottom: "auto",
                    fontSize: "18px",
                  }}
                  danger={true}
                  type="text"
                  icon={<IoCloseOutline />}
                  onClick={() => handleDeleteBazaarItem(item.id)}
                ></Button>
              </CustomFlexDiv>
            }
            bordered={false}
            key={item.id}
          >
            <CardGridDiv>
              <CustomFlexDiv>
                <CardSpan>
                  数量：
                  <CardSpan />
                </CardSpan>
                <h3>{item.selectNumber}</h3>
              </CustomFlexDiv>
              <CustomFlexDiv>
                <CouponDiv
                  style={{
                    backgroundColor: `${
                      item.coupon === 1
                        ? "var(--color-grey-100)"
                        : item.coupon === 0.7
                        ? "var(--color-blue-100)"
                        : "var(--color-green-100)"
                    }`,
                  }}
                >
                  {`${
                    item.coupon === 1
                      ? "无打折卷"
                      : item.coupon === 0.7
                      ? "七折卷"
                      : "五折卷"
                  }`}
                </CouponDiv>
              </CustomFlexDiv>

              <CustomFlexDiv>
                <CardSpan>保底幸运值: </CardSpan>
                <h3>{(item.basic_lucky * item.selectNumber).toFixed(1)}</h3>
              </CustomFlexDiv>
              <CustomFlexDiv>
                期望幸运值:{" "}
                <h3>{(item.expected_value * item.selectNumber).toFixed(1)}</h3>
              </CustomFlexDiv>
              <CustomFlexDiv>
                单位保底值: <h3>{item.basic_lucky.toFixed(1)}</h3>
              </CustomFlexDiv>
              <CustomFlexDiv>
                单位期望值: <h3>{item.expected_value.toFixed(1)}</h3>
              </CustomFlexDiv>
              <FirstRow>
                <FlexSpan>
                  {item.unit === "量子元" && (
                    <RiMoneyEuroCircleFill
                      style={{ color: "var(--color-red-700)" }}
                    />
                  )}
                  {item.unit === "伊甸币" && (
                    <AiFillMoneyCollect style={{ color: "#eecc0e" }} />
                  )}

                  {item.unit === "星币" && (
                    <RiMoneyCnyBoxFill style={{ color: "grey" }} />
                  )}
                </FlexSpan>
                {item.unit}:{" "}
                <h3>
                  {item.unit === "星币"
                    ? (Number(item.price) * item.selectNumber * item.coupon) /
                        100000000 +
                      "亿"
                    : Number(item.price) * item.selectNumber * item.coupon}
                </h3>
              </FirstRow>
            </CardGridDiv>
          </StyledCard>
        ))}
      </ResultDiv>
    </CalculatorContainer>
  );
}

export default BazaarCalculator;
