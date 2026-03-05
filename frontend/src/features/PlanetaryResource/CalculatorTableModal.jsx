import {
  Form,
  Input,
  Table,
  InputNumber,
  Button as AntdButton,
  Popover,
  Segmented,
  Dropdown,
} from "antd";
import styled from "styled-components";
import RegionLevelSpan from "../../ui/RegionLevelSpan";
import { getFilterList } from "../../utils/getFilterList";
import Button from "../../ui/Button";
import React, { useContext, useEffect, useRef, useState } from "react";
import TimeInput from "../../ui/TimeInput";
import { IoCopy } from "react-icons/io5";
import CountUp from "react-countup";
import Stats from "./Stats";
import { useDefaultPrice } from "./useDefaultPrice";
import SpinnerMini from "../../ui/SpinnerMini";
import MiniModal from "../../ui/MiniModal";
import SavePlanetaryProgramme from "./SavePlanetaryProgramme";
import { useProgremmaList } from "./useProgremmaList";
import { HiXMark } from "react-icons/hi2";
import { useGetProgremma } from "./useGetProgremma";
import useDeleteProgramme from "./useDeleteProgremma";
import useUpdateProgramme from "./useUpdateProgremma";
import DeleteConfirm from "./DeleteConfirm";
import { AuthContext } from "../../context/AuthContext";
import LoginTips from "../../ui/LoginTips";

const StyledTable = styled(Table)`
  .no-wrap-column {
    white-space: nowrap;
  }
`;
const StatsContainer = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr); /* 将容器分成4列 */

  margin: 0 auto; /* 水平居中 */
`;
const SegmentedContainer = styled.div`
  display: flex;
  justify-content: center;
  gap: 20px;
`;

const StyledContent = styled.div`
  display: flex;
  justify-items: center;
  font-size: 15px;
  font-weight: bold;
  color: var(--color-grey-700);
`;
const content = <StyledContent>扩散至所有行</StyledContent>;

const StyledBlock = styled.div`
  display: flex;
  align-items: center;
  white-space: pre;
  transition: all 0.3s ease; // 添加过渡效果
`;
const StyledImg = styled.img`
  width: 70px;
  height: 38px;
  border-radius: 5px;
  transition: all 0.3s ease; // 添加过渡效果
`;

const ProgrammeButtonGroup = styled.div`
  display: flex;
  gap: 10px;
  margin-top: 30px;
  margin-bottom: 15px;
`;

const MenuDiv = styled.div`
  display: flex;
  gap: 5px;
  align-items: center;
  justify-content: center;
`;

function CalculatorTableModal({
  calculatorData,
  setCalculatorData,
  currentProgramme,
  setCurrentProgremma,
  selectedProgrammeId,
  setSelectedProgrammeId,
}) {
  const [totalPrice, setTotalPrice] = useState(0);
  const [totalFuel, setTotalFuel] = useState(0);
  const [unitFuel, setUnitFuel] = useState(0);
  const [castle, setCastle] = useState("双菜插");
  const [skill, setSkill] = useState("技能554");
  const [startSelect, setStartSelect] = useState(false);

  const { programme, isLoading: isSwitching } = useGetProgremma({
    startSelect,
    setStartSelect,
    selectedProgrammeId,
    setCalculatorData,
    setCurrentProgremma,
  });
  const { isAuthenticated } = useContext(AuthContext);
  const { isLoading: isGetingProgrammeList, progremmaList } =
    useProgremmaList(isAuthenticated);

  const deleteProgramme = useDeleteProgramme();
  const updateProgramme = useUpdateProgramme();

  const getItems =
    progremmaList?.map((item) => {
      return {
        key: item.programme_id,
        label: (
          <MenuDiv>
            <p style={{ fontSize: "16px", fontWeight: "500" }}>
              {item.programme_name}
            </p>
            <MiniModal>
              <MiniModal.Open
                opens={"deleteProgramme"}
                onClickFunction={(e) => e.stopPropagation()}
              >
                <AntdButton
                  style={{ fontSize: "18px", marginLeft: "auto" }}
                  size="small"
                  type="primary"
                  danger={true}
                  icon={<HiXMark />}
                ></AntdButton>
              </MiniModal.Open>
              <MiniModal.Window name={"deleteProgramme"}>
                <DeleteConfirm
                  deleteProgrammeName={item.programme_name}
                  handleConfirmed={() =>
                    handleDeleteProgremma(item.programme_id)
                  }
                />
              </MiniModal.Window>
            </MiniModal>
          </MenuDiv>
        ),
        onClick: () => handleSetProgremma(item.programme_id),
      };
    }) || [];

  const fullGetItems = [
    {
      key: "create new programme",
      label: (
        <MenuDiv>
          <p
            style={{
              fontSize: "16px",
              fontWeight: "600",
              alignItems: "center",
              display: "flex",
              justifyContent: "center" /* 水平居中 */,
            }}
            onClick={() => setCurrentProgremma("无")}
          >
            新建方案 +
          </p>
        </MenuDiv>
      ),
    },
    ...getItems,
  ];

  const items =
    fullGetItems?.length > 0
      ? fullGetItems
      : [
          {
            key: 1,
            label: (
              <MenuDiv>
                <p>暂无方案</p>
              </MenuDiv>
            ),
          },
        ];

  const { isLoading: isLoadingPrice, defaultPrice } = useDefaultPrice("user");

  function handleDeleteProgremma(id) {
    deleteProgramme.mutate(id);
    setCalculatorData([]);
    setCurrentProgremma("无");
  }

  function handleSetProgremma(id) {
    setSelectedProgrammeId(id);
    setStartSelect(true);
    if (programme) {
      setCalculatorData(programme[0].programme_element);
      setCurrentProgremma(programme[0].programme_name);
    }
  }

  function handleUpdateProgremma() {
    updateProgramme.mutate({
      programme_id: selectedProgrammeId,
      element: calculatorData,
    });
  }

  useEffect(() => {
    const calculateTotal = () => {
      let totalPrice = 0;
      let totalFuel = 0;
      let unitFuel = 0;
      calculatorData.forEach((item) => {
        totalPrice += item.total_price;
        totalFuel += item.total_fuel;
        unitFuel += item.fuel_value * item.arrays_number;
      });
      setUnitFuel(unitFuel);
      setTotalPrice(totalPrice);
      setTotalFuel(totalFuel);
    };

    calculateTotal();
  }, [calculatorData]);

  const calculateTotals = (row) => {
    const totalOutput =
      row.resource_yield * row.arrays_number * row.computation_time;
    const totalFuel = row.fuel_value * row.arrays_number * row.computation_time;
    const totalPrice =
      row.resource_yield *
      row.arrays_number *
      row.computation_time *
      row.unit_price;

    return {
      ...row,
      total_output: totalOutput,
      total_fuel: totalFuel,
      total_price: totalPrice,
    };
  };

  const handleSpread = (dataIndex, value) => {
    const newData = calculatorData.map((item) => {
      // 首先更新指定的字段
      const updatedItem = { ...item, [dataIndex]: value };

      // 然后使用calculateTotals函数来计算和更新其他依赖字段
      return calculateTotals(updatedItem);
    });

    setCalculatorData(newData);
  };
  //可编辑单元格antd实现
  const EditableContext = React.createContext(null);
  const EditableRow = ({ index, ...props }) => {
    const [form] = Form.useForm();
    return (
      <Form form={form} component={false}>
        <EditableContext.Provider value={form}>
          <tr {...props} />
        </EditableContext.Provider>
      </Form>
    );
  };
  const EditableCell = ({
    title,
    editable,
    children,
    dataIndex,
    record,
    handleSave,
    handleSpread,
    ...restProps
  }) => {
    const [editing, setEditing] = useState(false);
    const inputRef = useRef(null);
    const form = useContext(EditableContext);
    useEffect(() => {
      if (editing) {
        inputRef.current?.focus();
      }
    }, [editing]);

    const toggleEdit = () => {
      setEditing(!editing);
      form.setFieldsValue({
        [dataIndex]: record[dataIndex],
      });
    };
    const save = async () => {
      try {
        const values = await form.validateFields();
        toggleEdit();
        handleSave({
          ...record,
          ...values,
        });
      } catch (errInfo) {
      }
    };
    let childNode = children;
    let value = children.toString().replace(/,/g, ""); // 去除所有逗号

    if (editable) {
      childNode = editing ? (
        <Form.Item
          style={{
            margin: 0,
          }}
          name={dataIndex}
          rules={[
            {
              required: true,
              message: `${title} 为必填项`,
            },
          ]}
        >
          {dataIndex === "arrays_number" ? (
            <InputNumber
              ref={inputRef}
              onPressEnter={save}
              onBlur={save}
              style={{ fontSize: "18px", fontWeight: "bold" }}
              min={0}
            />
          ) : dataIndex === "unit_price" ? (
            <InputNumber
              ref={inputRef}
              onPressEnter={save}
              onBlur={save}
              style={{ fontSize: "18px", fontWeight: "bold" }}
              changeOnWheel
              min={0}
            />
          ) : dataIndex === "computation_time" ? (
            <TimeInput
              value={value}
              onChange={(val) => form.setFieldsValue({ [dataIndex]: val })}
              save={save}
            />
          ) : (
            <Input ref={inputRef} onPressEnter={save} onBlur={save} />
          )}
        </Form.Item>
      ) : (
        <div
          className="editable-cell-value-wrap"
          style={{
            fontSize: "18px",
            fontWeight: "bold",
            borderRadius: "5px",
          }}
          onClick={toggleEdit}
        >
          {dataIndex === "unit_price" ? (
            <span style={{ whiteSpace: "nowrap" }}>
              <CountUp end={value} duration={0.5} separator="," preserveValue />{" "}
              isk
            </span>
          ) : dataIndex === "computation_time" ? (
            <div style={{ fontWeight: "16px" }}>
              <span style={{ whiteSpace: "nowrap" }}>
                {Math.floor(value / 24)} 天 {value % 24} 小时
                <Popover content={content}>
                  <AntdButton
                    type="primary"
                    shape="circle"
                    size={"small"}
                    onClick={() => {
                      handleSpread(dataIndex, record[dataIndex]);
                    }}
                    style={{ marginLeft: 5 }}
                    icon={<IoCopy />}
                  ></AntdButton>
                </Popover>
              </span>
            </div>
          ) : dataIndex === "arrays_number" ? (
            <span style={{ whiteSpace: "nowrap" }}>
              {children}
              <Popover content={content}>
                <AntdButton
                  type="primary"
                  shape="circle"
                  size={"small"}
                  onClick={() => {
                    handleSpread(dataIndex, record[dataIndex]);
                  }}
                  style={{ marginLeft: 8 }}
                  icon={<IoCopy />}
                ></AntdButton>
              </Popover>
            </span>
          ) : (
            children
          )}
        </div>
      );
    }
    return <td {...restProps}>{childNode}</td>;
  };

  //------------------------------------------------------------------------------------------
  const planetFilterList = getFilterList(calculatorData, "resource_name");
  const solarSystemFilterList = getFilterList(calculatorData, "solar_system");

  const columns = [
    {
      title: "行星资源",
      dataIndex: "resource_name",
      key: "resource_name",
      render: (_, record) => {
        return (
          <StyledBlock>
            <StyledImg src={record.icon} alt={record.solar_system} />
            {record.resource_name}
          </StyledBlock>
        );
      },
      filters: planetFilterList,
      onFilter: (value, record) => record.resource_name.indexOf(value) === 0,
      sorter: (a, b) => a.resource_name.localeCompare(b.resource_name),
      filterSearch: true,
      width: "215px",
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
      width: "210px",
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
      width: "120px",
    },
    {
      title: "单位热值",
      dataIndex: "fuel_value",
      key: "fuel_value",
      render: (_, record) => {
        return (
          <span style={{ fontWeight: "bold", fontSize: "18px" }}>
            {record.fuel_value?.toFixed(2)}
          </span>
        );
      },
      sorter: (a, b) => a.fuel_value - b.fuel_value,
      width: "120px",
    },

    {
      title: "阵列数量",
      dataIndex: "arrays_number",
      key: "arrays_number",
      sorter: (a, b) => a.arrays_number - b.arrays_number,
      editable: true,
      width: "120px",
    },
    {
      title: "计算时间",
      dataIndex: "computation_time",
      key: "computation_time",
      sorter: (a, b) => a.computation_time - b.computation_time,
      editable: true,
      width: "210px",
    },
    {
      title: "总产出热值",
      dataIndex: "total_fuel",
      key: "total_fuel",
      render: (_, record) => {
        return (
          <span style={{ fontWeight: "bold", fontSize: "18px" }}>
            {record.total_fuel?.toFixed(2)}
          </span>
        );
      },
      sorter: (a, b) => a.total_fuel - b.total_fuel,
      width: "140px",
    },
    {
      title: "产出总量",
      dataIndex: "total_output",
      key: "total_output",
      sorter: (a, b) => a.total_output - b.total_output,
      render: (_, record) => {
        return (
          <span
            style={{
              fontWeight: "bold",
              fontSize: "18px",
            }}
          >
            <CountUp
              start={0}
              end={record.total_output}
              duration={1}
              separator=","
            />
          </span>
        );
      },
      width: "120px",
    },
    {
      title: "物品单价",
      dataIndex: "unit_price",
      key: "unit_price",
      sorter: (a, b) => a.unit_price - b.unit_price,
      editable: true,
      width: "110px",
    },
    {
      title: "产出总价",
      dataIndex: "total_price",
      key: "total_price",
      sorter: (a, b) => a.total_price - b.total_price,
      render: (_, record) => {
        return (
          <span
            style={{
              fontWeight: "bold",
              fontSize: "18px",
              whiteSpace: "nowrap",
            }}
          >
            {
              <CountUp
                end={
                  record.total_price > 10000000
                    ? record.total_price / 100000000
                    : record.total_price / 10000
                }
                decimals={2}
                duration={0.5}
              />
            }

            <span style={{ color: "var(--color-red-700)" }}>
              {record.total_price > 10000000 ? "亿" : "万"}
            </span>
            <span>isk</span>
          </span>
        );
      },
      width: "120px",
    },
    {
      title: "操作",
      dataIndex: "operation",
      render: (_, record) => (
        <Button onClick={() => handleDelete(record.key)}>
          <span style={{ fontSize: "14px" }}>删除</span>
        </Button>
      ),
      width: "100px",
    },
  ];
  function handleDelete(key) {
    const newData = calculatorData.filter((item) => item.key !== key);
    setCalculatorData(newData);
  }

  const handleSave = (row) => {
    const newData = [...calculatorData];
    const index = newData.findIndex((item) => row.key === item.key);

    // 使用calculateTotals函数来计算依赖于输入值的字段
    const updatedRow = calculateTotals(row);

    newData.splice(index, 1, updatedRow);
    setCalculatorData(newData);
  };
  const components = {
    body: {
      row: EditableRow,
      cell: EditableCell,
    },
  };
  const newEditColumns = columns.map((col) => {
    if (!col.editable) {
      return col;
    }
    return {
      ...col,
      onCell: (record) => ({
        record,
        editable: col.editable,
        dataIndex: col.dataIndex,
        title: col.title,
        handleSave,
        handleSpread,
      }),
    };
  });

  function handleDefaultPrice() {
    const updatedData = calculatorData.map((item) => {
      const defaultItem = defaultPrice.find(
        (price) => price.resource_name === item.resource_name
      );
      if (defaultItem) {
        return {
          ...item,
          unit_price: defaultItem.resource_price,
          total_price: item.total_output * defaultItem.resource_price, // 确保每行的total_price是基于当前行的total_output计算的
        };
      }
      return item;
    });
    setCalculatorData(updatedData);
  }

  const maxOutput = Math.max(
    ...calculatorData?.map((item) => item.arrays_number * item.resource_yield)
  );

  return (
    <div>
      <h2 style={{ textAlign: "center", marginBottom: "8px" }}>
        行星资源计算器
      </h2>
      <SegmentedContainer>
        <Segmented
          size="large"
          style={{
            fontSize: "20px",
            fontWeight: "500",
          }}
          options={["双菜插", "单菜插", "无个堡"]}
          defaultValue={"双菜插"}
          onChange={(value) => setCastle(value)}
        />
        <Segmented
          size="large"
          style={{
            fontSize: "20px",
            fontWeight: "500",
          }}
          options={["技能554", "技能555"]}
          defaultValue={"技能554"}
          onChange={(value) => setSkill(value)}
        />
      </SegmentedContainer>
      <StatsContainer>
        <Stats
          totalPrice={totalPrice}
          totalFuel={totalFuel}
          unitFuel={unitFuel}
          skill={skill}
          castle={castle}
          maxOutPut={maxOutput}
        />
      </StatsContainer>
      <Button
        style={{ width: "120px" }}
        onClick={handleDefaultPrice}
        disabled={isLoadingPrice}
      >
        {isLoadingPrice ? <SpinnerMini /> : "加载预设价格"}
      </Button>
      <div style={{ marginTop: "15px" }}>
        <StyledTable
          dataSource={calculatorData}
          columns={newEditColumns}
          rowClassName={() => "editable-row"}
          pagination={{ pageSize: 5 }}
          scroll={{ x: "max-content" }}
          components={components}
          bordered
        />
        <ProgrammeButtonGroup>
          <AntdButton
            danger={true}
            onClick={() => {
              setCalculatorData([]);
              setCurrentProgremma("无");
            }}
          >
            清空计算器
          </AntdButton>

          {!isAuthenticated ? (
            <LoginTips style={{ marginLeft: "auto" }}>
              登录后可在计算器中保存或加载行星资源方案
            </LoginTips>
          ) : (
            <>
              {currentProgramme === "无" ? (
                <MiniModal>
                  <MiniModal.Open opens={"saveProgramme"}>
                    <AntdButton
                      size="large"
                      type="primary"
                      style={{ marginLeft: "auto" }}
                      disabled={!calculatorData.length}
                    >
                      使用当前数据创建行星方案
                    </AntdButton>
                  </MiniModal.Open>
                  <MiniModal.Window name={"saveProgramme"}>
                    <SavePlanetaryProgramme
                      calculatorData={calculatorData}
                      handleSetProgremma={handleSetProgremma}
                    ></SavePlanetaryProgramme>
                  </MiniModal.Window>
                </MiniModal>
              ) : (
                <AntdButton
                  size="large"
                  type="primary"
                  style={{ marginLeft: "auto" }}
                  disabled={!calculatorData.length}
                  onClick={handleUpdateProgremma}
                >
                  更新并保存当前方案
                </AntdButton>
              )}

              <Dropdown
                menu={{
                  items,
                }}
                placement="top"
                arrow={{ pointAtCenter: true }}
              >
                <AntdButton
                  size="large"
                  style={{
                    backgroundColor: "var(--color-grey-100)",
                    display: "flex",
                    justifyItems: "center",
                    alignItems: "center",
                  }}
                >
                  当前方案 :{" "}
                  {isGetingProgrammeList || isSwitching ? (
                    <SpinnerMini />
                  ) : (
                    currentProgramme
                  )}
                </AntdButton>
              </Dropdown>
            </>
          )}
        </ProgrammeButtonGroup>
      </div>
    </div>
  );
}

export default CalculatorTableModal;
