import { Button, Descriptions, Input, Space, Table } from "antd";
import { useContext, useState } from "react";
import styled from "styled-components";
import useFraudSearch from "./useFraudSearch";
import Logo from "../../ui/Logo";
import { MdReport } from "react-icons/md";
import MiniModal from "../../ui/MiniModal";
import ReportModal from "./ReportModal";
import { AuthContext } from "../../context/AuthContext";
import LinkToLogin from "../../ui/LinkToLogin";
import PcImplantExperienceCalculator from "../TacticalBoard/PcImplantExperienceCalculator";

const FraudContainer = styled.div`
  position: relative; // 添加这行
  background-color: #fff;
  width: 100%;
  height: 900px;
  border-radius: 10px;
`;

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

const CustomFlexContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 20px;
  position: relative;
  width: 100%;
`;

const CustomFlexContainerButtom = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 20px;
  position: absolute; // 修改这行
  bottom: 30px; // 添加这行
  width: 100%; // 添加这行，使其占据全宽

  @media (max-width: 767px) {
    margin: 20;
    position: initial;
    width: 90%; // 添加这行，使其占据全宽
  }
`;

const InputContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 500px;
`;

const ReportButtonContainer = styled.div`
  position: absolute;
  right: 10%;
  display: flex;
  justify-content: center;
  align-items: center;
  @media (max-width: 767px) {
    margin-top: 90px;
    margin-right: 5%;
  }
`;

const CalculatorContainer = styled.div`
  position: absolute;
  left: 10%;
  display: flex;
  justify-content: center;
  align-items: center;
`;

const StyledTable = styled(Table)`
  width: 80%;

  border-radius: 10px;
  @media (max-width: 767px) {
    display: none; // 在小屏幕上不显示
  }
`;

const StyledDescriptions = styled(Descriptions)`
  display: none;
  @media (max-width: 767px) {
    display: block; // 在小屏幕上不显示
  }
`;

const SmallMediaDiv = styled.div`
  display: none;
  @media (max-width: 767px) {
    display: flex; // 在小屏幕上不显示
    flex-direction: column;
    justify-content: center;
    margin: 20px;
    gap: 10px;
    width: 90%;
  }
`;

const TipsDiv = styled.div`
  width: 800px;
  min-height: 180px; // 改为最小高度
  background-color: var(--color-blue-100);
  color: var(--color-blue-700);
  border-radius: 10px;
  padding: 4px 15px;
  white-space: pre-wrap; // 修改为 pre-wrap

  @media (max-width: 767px) {
    width: 90%;
    height: auto;
    white-space: normal; // 在小屏幕上使用 normal
  }
`;

const LogoContainer = styled.div`
  display: none;
  @media (max-width: 767px) {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-left: 60px;
    margin-top: 10px;
  }
`;
const CollaboratingGroups = styled.div`
  display: flex;
  flex-wrap: wrap;
  margin-top: 10px;
  color: black;
`;

const GroupSpan = styled.span`
  display: inline-block;
  margin-right: 10px;
  margin-bottom: 5px;
`;

function FraudSearch() {
  const { isAuthenticated } = useContext(AuthContext);

  const collaboratingGroups = [
    { name: "吉商委员会", id: "927154656" },
    { name: "EVE交易群", id: "微信" },
    { name: "奶爸商业联盟", id: "636501916" },
    { name: "墨意商业", id: "569553200" },
  ];
  const [fraudList, setFraudList] = useState([]);

  const [searchNumber, setSearchNumber] = useState("");

  const getSearchFraud = useFraudSearch(setFraudList);

  const showPagination = fraudList?.length >= 6;
  function handleSearch() {
    if (searchNumber === "") return;
    getSearchFraud.mutate({ searchNumber: searchNumber });
  }

  const columns = [
    {
      title: "账户类型",
      dataIndex: "account_type",
      key: "account_type",
      sorter: (a, b) => a.box.localeCompare(b.box),
    },
    {
      title: "账户号码",
      dataIndex: "fraud_account",
      key: "fraud_account",
      sorter: (a, b) => a.fraud_account - b.fraud_account,
    },
    {
      title: "备注",
      dataIndex: "remark",
      key: "remark",
    },
    {
      title: "纠纷类型",
      dataIndex: "fraud_type",
      key: "fraud_type",
    },
    {
      title: "名单来源",
      dataIndex: "source_group_name",
      key: "id",
      render: (_, record) => {
        return (
          <StyledBlock>
            <StyledImg src={record.icon} alt={record.source_group_name} />
            {record.source_group_name}
          </StyledBlock>
        );
      },
    },
  ];

  console.log(fraudList);

  const items = fraudList.map((item, index) => {
    return [
      {
        key: `${index * 5 + 1}`,
        label: "账户类型",
        children: item.account_type,
      },
      {
        key: `${index * 5 + 2}`,
        label: "账户号码",
        children: item.fraud_account,
      },
      { key: `${index * 5 + 3}`, label: "备注", children: item.remark },
      { key: `${index * 5 + 4}`, label: "纠纷类型", children: item.fraud_type },
      {
        key: `${index * 5 + 5}`,
        label: "名单来源",
        children: item.source_group_name,
      },
    ];
  });
  return (
    <FraudContainer>
      <LogoContainer>
        <Logo />
      </LogoContainer>
      <CustomFlexContainer>
        <h2>防诈查询</h2>
      </CustomFlexContainer>
      <CustomFlexContainer>
        <CalculatorContainer>
          <MiniModal>
            <MiniModal.Open
              opens={"PcImplantExperienceCalculator"}
              onClickFunction={(e) => e.stopPropagation()}
            >
              <Button
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "5px",
                }}
                color="purple"
                variant="outlined"
              >
                植入体经验计算
              </Button>
            </MiniModal.Open>
            <MiniModal.Window name={"PcImplantExperienceCalculator"}>
              <PcImplantExperienceCalculator />
            </MiniModal.Window>
          </MiniModal>
        </CalculatorContainer>

        <InputContainer>
          <Space.Compact
            style={{
              width: "100%",
            }}
          >
            <Input
              placeholder="支持QQ、微信、咸鱼号、游戏ID"
              value={searchNumber}
              onChange={(e) => setSearchNumber(e.target.value)}
              onPressEnter={handleSearch}
            />
            <Button
              type="primary"
              onClick={handleSearch}
              loading={getSearchFraud.isLoading}
            >
              查询名单
            </Button>
          </Space.Compact>
        </InputContainer>
        <ReportButtonContainer>
          <MiniModal>
            <MiniModal.Open
              opens={"reportModal"}
              onClickFunction={(e) => e.stopPropagation()}
            >
              <Button
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "5px",
                }}
                danger={true}
              >
                <MdReport />
                我要举报
              </Button>
            </MiniModal.Open>
            <MiniModal.Window name={"reportModal"}>
              {isAuthenticated ? (
                <ReportModal />
              ) : (
                <LinkToLogin operation={"举报"}></LinkToLogin>
              )}
            </MiniModal.Window>
          </MiniModal>
        </ReportButtonContainer>
      </CustomFlexContainer>
      <CustomFlexContainer>
        <StyledTable
          dataSource={fraudList.map((item) => ({ ...item, key: item.id }))}
          columns={columns}
          pagination={showPagination ? { pageSize: 6 } : false}
        ></StyledTable>
      </CustomFlexContainer>
      <SmallMediaDiv>
        {items.map((item) => (
          <StyledDescriptions
            bordered={true}
            items={item}
            labelStyle={{ width: "30%" }}
          />
        ))}
      </SmallMediaDiv>

      <CustomFlexContainerButtom>
        <TipsDiv>
          <p>*本功能旨在整合各大交易群中的纠纷与诈骗实施者</p>
          <p>
            该名单由各大交易群管理直接维护，如有错误，请联系名单中出现的交易群管理
          </p>
          <p>
            欢迎各大交易群联系本人QQ:2235102484
            一起整合名单，我会开放管理账户由群管理直接控制名单
          </p>
          <br />
          以下为当前的合作交易群: <br />
          <CollaboratingGroups>
            {collaboratingGroups.map((group, index) => (
              <GroupSpan key={index}>
                {group.name}--{group.id}
              </GroupSpan>
            ))}
          </CollaboratingGroups>
        </TipsDiv>
      </CustomFlexContainerButtom>
    </FraudContainer>
  );
}

export default FraudSearch;
