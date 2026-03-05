import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import styled from "styled-components";

import { useEffect, useState } from "react";
import { Button, Checkbox, InputNumber, Select, message } from "antd";
import Spinner from "../../ui/Spinner";
import { useBazaarChart } from "./useBazaarChart";
import { IoCloseOutline } from "react-icons/io5";
import { useBazaarNameList } from "./useBazaarNameList";
import SpinnerMini from "../../ui/SpinnerMini";
import ErrorMessage from "../../ui/ErrorMessage";
const LoadingDiv = styled.div`
  width: 800px;
  height: 400px;
  display: flex;
  justify-content: center;
  align-items: center;
`;

const ChartsContainer = styled.div`
  display: grid;
  grid-template-rows: 30px auto; /* 第一行高度为30px，第二行自动填充 */
  background-color: #fff;
  height: 550px;
  border-radius: 5px;
`;

const ChildContainer = styled.div`
  display: flex;
`;

const ChartSelectContainer = styled.div`
  display: grid;
  grid-template-rows: 80px auto; /* 第一行高度为30px，第二行自动填充 */
  min-width: 200px;
  max-width: 480px;
  width: 100%;
  height: 400px;
  border: 1px solid #ccc;
  border-radius: 10px;
  margin: 30px;
  margin-right: 30px;
`;
const Heading = styled.h3`
  padding: 10px 15px; /* 添加内边距 */
`;

const SeletContainer = styled.div`
  display: grid; /* 使用 grid 布局 */
  grid-template-columns: 1fr 1fr; /* 创建两个等宽的列 */
  grid-template-rows: 1fr 1fr; /* 创建两个等高的行 */
  padding: 5px;
  gap: 5px; /* 根据需要可以设置网格之间的间隙 */
`;

const StyledSelecter = styled.div`
  display: flex;
  font-size: 14px;
  align-items: center;
  justify-content: center;
  white-space: pre; /* 保留空格 */
  padding: 5px;
`;

// 定义 CheckboxDiv，使用 flex 布局并允许自动换行
const CheckBoxDiv = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr; // 两列，每列宽度相等
  grid-auto-rows: 30px; // 每行高度固定为30px
  gap: 10px; // 可以根据需要调整行间和列间的间距
  margin: 10px;
  margin-top: 20px;
  border-radius: 10px;
  padding: 0;
  background-color: var(--color-grey-100);
`;

// 定义 CheckBoxItem，每个项目占用 50% 的宽度，高度为 30px
const CheckBoxItem = styled.div`
  display: flex;
  align-items: center; // 保持内容垂直居中
  justify-content: flex-start; // 内容靠左对齐
  flex-wrap: nowrap;
  margin-left: 5px;
  margin-right: 5px;
  margin-top: 10px;
  padding: 0px;
  border-radius: 5px;
  background-color: #dbe6f8;
  height: 30px;
`;

const CustomFlexDiv = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  white-space: pre;
`;

const COLORS = [
  "#0000FF", // 深蓝色
  "#008000", // 翠绿色

  "#A52A2A", // 棕色
  "#FFA500", // 橙色
  "#800080", // 紫色
  "#D2B48C", // 土黄色
  "#008B8B", // 深青色（青蓝色）
  "#9400D3", // 深紫罗兰色
  "#FFD700", // 鲜黄色
  "#87CEEB", // 天蓝色
  "#7CFC00", // 草绿色
  "#FF00FF", // 品红色
  "#FF0000", // 深红色
];

function mergeDataByDate(bigArray) {
  if (bigArray.length === 0) return [];

  // 如果只有一个数组，直接返回转换后的数据
  if (bigArray.length === 1) {
    return bigArray[0].map((item) => ({ ...item, date: item.date }));
  }

  // 提取所有日期，假设每个子数组的第一个元素都有 'date' 字段
  const allDates = bigArray[0].map((item) => item.date);

  // 创建一个新数组，合并所有数组中相同日期的数据
  const mergedData = allDates.map((date) => {
    const itemsByDate = bigArray
      .map((array) => array.find((item) => item.date === date)) // 找到每个数组中相同日期的元素
      .filter((item) => item !== undefined); // 过滤掉未找到的结果

    // 合并所有找到的项目到一个对象
    return itemsByDate.reduce(
      (acc, curr) => ({
        ...acc,
        ...curr,
      }),
      { date }
    );
  });

  return mergedData;
}

// const data_new = [
//   { date: "第1日", 银环圆舞国服第5名: 9667, 银环圆舞国际服第5名: 4510 },
//   { date: "第2日", 银环圆舞国服第5名: 6800, 银环圆舞国际服第5名: 3565 },
// ];

function BazaarCharts() {
  const [chartInfo, setChartInfo] = useState([]);

  const {
    mutate: getBazaarChartInfo,
    data,
    isLoading: isLoadingBazaarChart,
  } = useBazaarChart();

  const {
    mutate: addBazaarChart,
    data: addData,
    isLoading: isLoadingAddChart,
  } = useBazaarChart();

  const [chartControlList, setChartControlList] = useState([]);

  const [selectSever, setSelectSever] = useState();

  const [selectBazaar, setSelectBazaar] = useState();

  const [selectRank, setSelectRank] = useState();

  const { isLoading, bazaarNameList } = useBazaarNameList();

  /**
   * 合并两个数据数组，基于共同的键。
   * @param {Array} primaryData - 主数据数组。
   * @param {Array} additionalData - 需要添加到主数据数组的数据。
   * @param {string} key - 用于匹配数据的键。
   * @returns {Array} - 合并后的数据数组。
   */
  function mergeDataArrays(primaryData, additionalData, key) {
    // 创建一个新数组来存放合并后的数据
    const mergedData = primaryData.map((item) => {
      // 找到 additionalData 中与当前 item 相同 key 值的项
      const foundItem = additionalData[0].find((addItem) => {
        return addItem[key] === item[key];
      });

      // 如果找到了，合并这两个对象
      return foundItem ? { ...item, ...foundItem } : { ...item };
    });

    return mergedData;
  }

  function nameExistsInConditions(nameToCheck, chartConditions) {
    return chartConditions.some((condition) => condition.name === nameToCheck);
  }

  const handleCheckboxChange = (name) => {
    const updatedControls = chartControlList.map((item) => {
      if (item.name === name) {
        return { ...item, checkbox: !item.checkbox };
      }
      return item;
    });
    setChartControlList(updatedControls);
  };

  const handleDeleteChartControl = (name) => {
    const filteredControls = chartControlList.filter(
      (item) => item.name !== name
    );
    setChartControlList(filteredControls);
    // 同时更新chartInfo，移除对应的数据
    const updatedChartInfo = chartInfo.map((dataPoint) => {
      const newDataPoint = { ...dataPoint };
      delete newDataPoint[name]; // 删除对应的属性
      return newDataPoint;
    });
    setChartInfo(updatedChartInfo);
  };

  function handleAddBazaarChart() {
    const newChartInfo = [
      { server: selectSever, bazaarName: selectBazaar, rank: selectRank },
    ];

    const chartConditions = `${selectBazaar}${
      selectSever === "China" ? "国服" : "国际服"
    }第${selectRank}名`;

    const exists = nameExistsInConditions(chartConditions, chartControlList);

    if (exists) {
      message.warning("该趋势已存在");
      return;
    }

    if (chartControlList.length >= 8) {
      message.warning("折线上限为8，请先删除部分趋势");
      return;
    }

    if (selectBazaar && selectRank && selectSever) {
      addBazaarChart(newChartInfo);
      setSelectBazaar(null);
      setSelectRank(null);
      setSelectSever(null);
    } else {
      message.warning("请完整选择集市条件");
    }
  }

  useEffect(() => {
    if (addData) {
      const merged = mergeDataArrays(chartInfo, addData, "date");
      setChartInfo(merged);
    } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addData]); // 仅添加addData作为依赖

  useEffect(() => {
    const defaultChart = [
      { server: "China", rank: 5, bazaarName: "银环圆舞" },
      { server: "China", rank: 5, bazaarName: "终焉回响" },
      { server: "China", rank: 5, bazaarName: "逐星之律" },
      { server: "China", rank: 25, bazaarName: "终焉回响" },
      { server: "China", rank: 25, bazaarName: "银环圆舞" },
    ];
    getBazaarChartInfo(defaultChart);
  }, [getBazaarChartInfo]);

  // 监听 data 变化，更新 chartInfo
  useEffect(() => {
    if (data) {
      setChartInfo(mergeDataByDate(data));
    }
  }, [data]);

  useEffect(() => {
    if (chartInfo) {
      setChartControlList(
        chartInfo.length > 0
          ? Object.keys(chartInfo[0])
              .filter((key) => key !== "date")
              .map((key) => ({
                name: key,
                checkbox: true, // 默认所有线条都可见
              }))
          : []
      );
    }
  }, [chartInfo]);

  return (
    <ChartsContainer>
      <div>
        <Heading>泛星集市幸运值趋势</Heading>
      </div>
      <ChildContainer>
        {isLoadingBazaarChart ? (
          <LoadingDiv>
            <Spinner />
          </LoadingDiv>
        ) : (
          <LineChart
            width={800}
            height={400}
            data={chartInfo || null}
            style={{ marginRight: "auto", marginTop: "30px" }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            {chartControlList
              .filter((key) => key.checkbox)
              .map((item, index) => (
                <Line
                  type="monotone"
                  dataKey={item.name}
                  stroke={COLORS[index % COLORS.length]}
                  key={item.name}
                />
              ))}
          </LineChart>
        )}
        <ChartSelectContainer>
          <SeletContainer>
            <StyledSelecter>
              <span>集市名称：</span>
              <Select
                style={{ width: "100%" }}
                value={selectBazaar}
                options={bazaarNameList}
                onChange={(name) => setSelectBazaar(name)}
              ></Select>
            </StyledSelecter>
            <StyledSelecter>
              <span>服务器：</span>
              <Select
                options={[
                  {
                    value: "china",
                    label: "国服",
                  },
                  {
                    value: "world",
                    label: "国际服",
                  },
                ]}
                style={{ width: "100%" }}
                loading={isLoading}
                value={selectSever}
                onChange={(server) => setSelectSever(server)}
              ></Select>
            </StyledSelecter>
            <StyledSelecter>
              <span>排名：</span>
              <InputNumber
                max={50}
                min={1}
                style={{ width: "100%" }}
                value={selectRank}
                onChange={(value) => setSelectRank(value)}
              ></InputNumber>
            </StyledSelecter>
            <StyledSelecter>
              <Button
                type="primary"
                style={{ width: "90px" }}
                onClick={handleAddBazaarChart}
                disabled={isLoadingAddChart}
              >
                {isLoadingAddChart ? <SpinnerMini /> : "添加趋势"}
              </Button>
            </StyledSelecter>
          </SeletContainer>

          <CheckBoxDiv>
            {chartControlList.map((item) => (
              <CheckBoxItem key={item.name}>
                <Checkbox
                  checked={item.checkbox}
                  onChange={() => handleCheckboxChange(item.name)}
                  style={{ marginLeft: "5px" }}
                >
                  {item.name}
                </Checkbox>
                <Button
                  size="small"
                  danger={true}
                  type="text"
                  icon={<IoCloseOutline />}
                  style={{
                    marginLeft: "auto",
                    marginRight: "3px",
                    fontSize: "18px",
                  }}
                  onClick={() => handleDeleteChartControl(item.name)}
                ></Button>
              </CheckBoxItem>
            ))}
          </CheckBoxDiv>
        </ChartSelectContainer>
      </ChildContainer>
      <CustomFlexDiv>
        <ErrorMessage
          style={{
            height: "30px",
            display: "inline-block",
            justifyContent: "center",
            alignItems: "center",
            padding: "5px 5px",
          }}
        >
          *注：数据均为本人历届集市活动手录，逐星之律 国服
          缺失第18日、19日2日数据
        </ErrorMessage>
      </CustomFlexDiv>
    </ChartsContainer>
  );
}

export default BazaarCharts;
