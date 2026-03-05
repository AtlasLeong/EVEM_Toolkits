import { Drawer, Select, Table } from "antd";
import { useState } from "react";
import styled from "styled-components";
import { useBazaarBox } from "./useBazaarBox";
import ErrorMessage from "../../ui/ErrorMessage";

const StyledBlock = styled.div`
  display: flex;
  align-items: center;
  white-space: pre;
  gap: 5px;
`;
const StyledImg = styled.img`
  width: auto;
  height: 35px;
  border-radius: 5px;
`;

const InfoDiv = styled.div`
  margin-bottom: top;
`;
function BazaarBoxRank({ bazaarBoxRank, setShowBazaarRank, bazaarNameList }) {
  const [bazaarName, setBazaarName] = useState("终焉回响");
  const { isLoading: isLoadingBazaarBox, bazaarBox } = useBazaarBox(bazaarName);

  const sortedData = bazaarBox
    ?.map((item) => ({
      box: item.box,
      average_expected: item.average_expected,
      picture_url: item.picture_url,
    }))
    ?.sort((a, b) => a.average_expected - b.average_expected) // 降序排序
    ?.map((item, index) => ({
      rank: index + 1,
      box: item.box,
      expected_cost: item.average_expected.toFixed(4), // 保留6位小数
      picture_url: item.picture_url,
    }));

  const columns = [
    {
      title: "排行",
      dataIndex: "rank",
      key: "rank",
      sorter: (a, b) => a.rank - b.rank,
    },
    {
      title: "名称",
      dataIndex: "box",
      key: "box",
      sorter: (a, b) => a.box.localeCompare(b.box),
      render: (_, record) => {
        return (
          <StyledBlock>
            <StyledImg src={record.picture_url} alt={record.box} />
            {record.box}
          </StyledBlock>
        );
      },
    },
    {
      title: "幸运值期望成本",
      dataIndex: "expected_cost",
      key: "expected_cost",
    },
  ];

  function onClose() {
    setShowBazaarRank(false);
  }

  return (
    <Drawer
      title="价值排行榜"
      onClose={onClose}
      open={bazaarBoxRank}
      size="large"
    >
      <Select
        options={bazaarNameList}
        style={{
          width: "150px",
          marginLeft: "20px",
          marginBottom: "10px",
        }}
        value={bazaarName}
        onChange={(value) => setBazaarName(value)}
      ></Select>
      <Table
        columns={columns}
        dataSource={sortedData}
        loading={isLoadingBazaarBox}
      ></Table>
      <InfoDiv>
        <ErrorMessage>
          幸运者期望成本值： 幸运箱售价 ÷ 期望幸运值 <br />
          <span>
            代表你每花费1点基础幸运值需要支付的金额
            <br />
          </span>
          <span>该值越小，代表花费更小的成本去获得更高的期望幸运值</span>
        </ErrorMessage>
      </InfoDiv>
    </Drawer>
  );
}

export default BazaarBoxRank;
