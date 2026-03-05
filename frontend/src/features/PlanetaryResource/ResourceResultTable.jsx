import { Table, Tag, Empty } from "antd";
import styled from "styled-components";
import RegionLevelSpan from "../../ui/RegionLevelSpan";
import { getFilterList } from "../../utils/getFilterList";
import { useContext, useRef, useState } from "react";
import Button from "../../ui/Button";
import { Badge } from "antd";
import { IoCalculator } from "react-icons/io5";
import DotAnimation from "../../ui/DotAnimation";
import CalculatorTableModal from "./CalculatorTableModal";
import Modal from "../../ui/Modal";
import { AuthContext } from "../../context/AuthContext";
import LoginTips from "../../ui/LoginTips";

const StyledImg = styled.img`
  width: 70px;
  height: 38px;
  border-radius: 5px;
`;
const ButtonContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;
const StyledBlock = styled.div`
  display: flex;
  align-items: center;
  white-space: pre;
`;

const StyledTable = styled(Table)`
  &.ant-table-wrapper {
    .ant-table-thead > tr > th {
      background-color: var(--color-grey-200); // 你想要的颜色
    }
  }
`;

const ProgrammeDiv = styled.div`
  display: flex;
`;

const StyledDiv = styled.div`
  padding: 20px;
  background-color: white;
  border-radius: 20px;
`;
function getFuelValue(resourceName) {
  let fuelValue = 0;
  switch (resourceName) {
    case "重水":
      fuelValue = 2;
      break;
    case "悬浮等离子":
      fuelValue = 5;
      break;
    case "液化臭氧":
      fuelValue = 13;
      break;
    case "离子溶液":
      fuelValue = 37;
      break;
    case "同位素燃料":
      fuelValue = 83;
      break;
    case "等离子体团":
      fuelValue = 191;
      break;
    default:
      fuelValue = 0;
  }
  return fuelValue;
}

function ResourceResultTable({ searchData, isSearching }) {
  const planetFilterList = getFilterList(searchData, "resource_name");
  const solarSystemFilterList = getFilterList(searchData, "solar_system");
  const constellationFilterList = getFilterList(searchData, "constellation");
  const regionFilterList = getFilterList(searchData, "region");
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const hasSelected = selectedRowKeys.length > 0;
  const [animate, setAnimate] = useState(false);
  const [startPosition, setStartPosition] = useState({ top: 0, left: 0 });
  const [endPosition, setEndPosition] = useState({ top: 0, left: 0 });
  const [calculatorData, setCalculatorData] = useState([]);

  const [currentProgramme, setCurrentProgremma] = useState("无");
  const [selectedProgrammeId, setSelectedProgrammeId] = useState(null);
  const { isAuthenticated: isLogin } = useContext(AuthContext);

  // 创建两个引用
  const addButtonRef = useRef();
  const calculatorButtonRef = useRef();
  const onSelectChange = (newSelectedRowKeys) => {
    setSelectedRowKeys(newSelectedRowKeys);
  };
  const rowSelection = {
    selectedRowKeys,
    onChange: onSelectChange,
    getCheckboxProps: (record) => ({
      disabled: calculatorData.some((data) => data.key === record.key),
      indeterminate: calculatorData.some((data) => data.key === record.key),
    }),
  };

  const NewSearchData = searchData.map((obj) => ({
    ...obj,
    fuel_value:
      getFuelValue(obj.resource_name) * (parseFloat(obj.resource_yield) || 0), // 使用|| 0确保遇到无效值时返回0
    arrays_number: 0,
    computation_time: 0,
    total_output: 0,
    unit_price: 0,
    total_price: 0,
    total_fuel: 0,
  }));
  const columns = [
    {
      title: "行星资源",
      dataIndex: "resource_name",
      key: "resource_name",
      render: (_, record) => {
        return (
          <StyledBlock>
            <StyledImg src={record.icon} alt={record.resource_name} />
            {record.resource_name}
          </StyledBlock>
        );
      },
      filters: planetFilterList,
      onFilter: (value, record) => record.resource_name.indexOf(value) === 0,
      sorter: (a, b) => a.resource_name.localeCompare(b.resource_name),
      filterSearch: true,
    },
    {
      title: "星域",
      dataIndex: "region",
      key: "region",
      filters: regionFilterList,
      onFilter: (value, record) => record.region.indexOf(value) === 0,
      filterSearch: true,
      render: (_, record) => {
        return (
          <StyledBlock>
            <span>{record.region}</span>
            <RegionLevelSpan security={record.region_security}>
              {" "}
              {record.region_security}
            </RegionLevelSpan>
          </StyledBlock>
        );
      },
    },
    {
      title: "星座",
      dataIndex: "constellation",
      key: "constellation",
      filters: constellationFilterList,
      onFilter: (value, record) => record.constellation.indexOf(value) === 0,
      filterSearch: true,
      render: (_, record) => {
        return (
          <StyledBlock>
            <span>{record.constellation}</span>
            <RegionLevelSpan security={record.constellation_security}>
              {" "}
              {record.constellation_security}
            </RegionLevelSpan>
          </StyledBlock>
        );
      },
    },
    {
      title: "星系",
      dataIndex: "solar_system",
      key: "solar_system",
      render: (_, record) => {
        return (
          <StyledBlock>
            <span>{record.solar_system}</span>
            <RegionLevelSpan security={record.solar_system_security}>
              {" "}
              {record.solar_system_security}
            </RegionLevelSpan>
            <span style={{ fontWeight: "bolder" }}> - {record.planet_id}</span>
          </StyledBlock>
        );
      },
      filters: solarSystemFilterList,
      onFilter: (value, record) => record.solar_system.indexOf(value) === 0,
      filterSearch: true,
    },
    {
      title: "产出等级",
      dataIndex: "resource_level",
      key: "resource_level",
      align: "center",
      filters: [
        { text: "完美", value: 4 },
        { text: "富裕", value: 3 },
        { text: "中等", value: 2 },
        { text: "贫瘠", value: 1 },
      ],
      onFilter: (value, record) => record.resource_level.indexOf(value) === 0,
      sorter: (a, b) => a.resource_level - b.resource_level,
      render: (_, record) => {
        let resourceText = "";
        let backGroundColor = "";
        switch (Number(record.resource_level)) {
          case 1:
            resourceText = "贫瘠";
            backGroundColor = "red";
            break;
          case 2:
            resourceText = "中等";
            backGroundColor = "orange";
            break;
          case 3:
            resourceText = "富裕";
            backGroundColor = "cyan";
            break;
          case 4:
            backGroundColor = "geekblue";
            resourceText = "完美";
            break;
          // 更多的case可以根据需要添加
          default:
            resourceText = "未知";
        }
        return (
          <Tag color={backGroundColor}>
            <span
              style={{
                fontSize: "15px",
                fontWeight: "bold",
                cursor: "default",
              }}
            >
              {resourceText}
            </span>
          </Tag>
        );
      },
    },
    {
      title: "产量",
      dataIndex: "resource_yield",
      key: "resource_yield",
      render: (_, record) => {
        return (
          <span style={{ fontWeight: "bold", fontSize: "18px" }}>
            {record.resource_yield}
          </span>
        );
      },
      sorter: (a, b) => a.resource_yield - b.resource_yield,
    },
    {
      title: "燃料热值/焦耳",
      dataIndex: "fuel_value",
      key: "fuel_value",
      render: (_, record) => {
        return (
          <span style={{ fontWeight: "bold", fontSize: "18px" }}>
            {record.fuel_value.toFixed(2)}
          </span>
        );
      },
      sorter: (a, b) => a.fuel_value - b.fuel_value,
    },
  ];

  function handleSelect() {
    if (addButtonRef.current && calculatorButtonRef.current) {
      const addButtonRect = addButtonRef.current.getBoundingClientRect();
      const calculatorButtonRect =
        calculatorButtonRef.current.getBoundingClientRect();

      // 计算起始和结束位置
      const startPosition = {
        top: addButtonRect.top,
        left: addButtonRect.left,
      };
      const endPosition = {
        top: calculatorButtonRect.top,
        left: calculatorButtonRect.left,
      };

      // 更新状态以触发动画
      setStartPosition(startPosition);
      setEndPosition(endPosition);
      setAnimate(true); // 假设你已经有了这个状态来控制动画的显示
    }

    //数据更新逻辑
    const selectData = NewSearchData.filter((data) =>
      selectedRowKeys.includes(data.key)
    );

    setCalculatorData((data) => [...data, ...selectData]);
    setSelectedRowKeys([]);
  }

  return (
    <StyledDiv>
      <h2 style={{ marginBottom: "30px" }}>搜索结果</h2>

      <ButtonContainer>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Button
            ref={addButtonRef}
            disabled={!hasSelected}
            style={{ marginBottom: "9px" }}
            onClick={handleSelect}
          >
            添加到计算器
          </Button>{" "}
          <span
            style={{
              marginLeft: 5,
            }}
          >
            {hasSelected ? `已选择 ${selectedRowKeys.length} 项` : ""}
          </span>
        </div>
        <ProgrammeDiv>
          {!isLogin && (
            <LoginTips>登录后可在计算器中保存或加载行星资源方案</LoginTips>
          )}
          <Badge
            count={calculatorData?.length || 0}
            showZero
            title="打开计算器"
          >
            <Modal>
              <Modal.Open opens="resourceModal">
                <Button
                  style={{ marginBottom: "9px" }}
                  ref={calculatorButtonRef}
                >
                  <IoCalculator style={{ fontSize: "2em" }} />
                </Button>
              </Modal.Open>
              <Modal.Window name="resourceModal">
                <CalculatorTableModal
                  calculatorData={calculatorData}
                  setCalculatorData={setCalculatorData}
                  currentProgramme={currentProgramme}
                  setCurrentProgremma={setCurrentProgremma}
                  selectedProgrammeId={selectedProgrammeId}
                  setSelectedProgrammeId={setSelectedProgrammeId}
                ></CalculatorTableModal>
              </Modal.Window>
            </Modal>
          </Badge>
        </ProgrammeDiv>
      </ButtonContainer>
      {animate && (
        <DotAnimation
          start={startPosition}
          end={endPosition}
          onRest={() => setAnimate(false)}
        />
      )}
      <StyledTable
        dataSource={NewSearchData}
        columns={columns}
        bordered
        locale={{ emptyText: <Empty description="暂无行星资源数据" /> }}
        showSorterTooltip={{
          target: "sorter-icon",
        }}
        loading={isSearching}
        pagination={{ showSizeChanger: false }}
        rowSelection={rowSelection}
      />
    </StyledDiv>
  );
}

export default ResourceResultTable;
