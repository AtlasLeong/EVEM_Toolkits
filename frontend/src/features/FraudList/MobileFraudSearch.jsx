import { Button, Card, SearchBar } from "antd-mobile";
import { useContext, useState } from "react";
import { MdReport } from "react-icons/md";
import styled from "styled-components";
import { Button as AntdButon, Descriptions } from "antd";
import useFraudSearch from "./useFraudSearch";
import MobileModal from "../../ui/MobileModal";
import { AuthContext } from "../../context/AuthContext";
import LinkToLogin from "../../ui/LinkToLogin";
import MobileReportMoadl from "./MobileReportModal";

const CustomFlexContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 30px;
`;

const SearchDiv = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  input {
    font-size: 16px !important; /* 防止 iOS 自动放大 */
  }
  input:focus,
  textarea:focus,
  select:focus {
    outline: none;
    outline-offset: none;
  }
`;

const StyledSearchBar = styled(SearchBar)`
  --background: #ffffff;
  width: 70%;
  margin-top: 10px;
  .adm-search-bar {
    height: 40px;
    padding: 0;
  }
  .adm-search-bar-input-box {
    height: 40px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .adm-search-bar-input {
    height: 40px;
  }
`;
const ReportButtonContainer = styled.div`
  position: absolute;
  left: 8%;
  display: flex;
  justify-content: center;
  align-items: center;
`;
const StyledSearchButton = styled(Button)`
  margin-top: 10px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  height: 40px;
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
const StyledCard = styled(Card)`
  width: 80%;
  background-color: var(--color-blue-100);
`;
const DescriptionsDiv = styled.div`
  display: flex; // 在小屏幕上不显示
  flex-direction: column;
  justify-content: center;
  margin: 20px;
  gap: 10px;
  width: 90%;
  max-width: 600px;
`;

const PageContainer = styled.div`
  background-color: var(--color-grey-100);
  height: auto;
  padding-bottom: 20px;
`;

const StyledDescriptions = styled(Descriptions)`
  width: 100%;
  background-color: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);

  .ant-descriptions-view {
    border: none;
  }

  .ant-descriptions-row:last-child .ant-descriptions-item {
    border-bottom: none;
  }
`;
const collaboratingGroups = [
  { name: "吉商委员会", id: "927154656" },
  { name: "EVE交易群", id: "微信" },
  { name: "奶爸商业联盟", id: "636501916" },
  { name: "墨意商业", id: "569553200" },
];

function MobileFraudSearch() {
  const [searchValue, setSearchValue] = useState();

  const [fraudList, setFraudList] = useState([]);

  const getSearchFraud = useFraudSearch(setFraudList);

  const { isAuthenticated } = useContext(AuthContext);

  function handleSearch() {
    if (searchValue === "") return;
    getSearchFraud.mutate({ searchNumber: searchValue });
  }
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
    <PageContainer>
      <CustomFlexContainer>
        <ReportButtonContainer>
          <MobileModal>
            <MobileModal.Open opens="reportfraud">
              <AntdButon
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "5px",
                  height: "28px",
                  marginTop: "5px",
                }}
                danger={true}
              >
                <MdReport />
                举报
              </AntdButon>
            </MobileModal.Open>
            {isAuthenticated ? (
              <MobileModal.Window name="reportfraud" size="small">
                <MobileReportMoadl />
              </MobileModal.Window>
            ) : (
              <MobileModal.Window name="reportfraud" size="small">
                <LinkToLogin operation={"举报"} mobile={true}></LinkToLogin>
              </MobileModal.Window>
            )}
          </MobileModal>
        </ReportButtonContainer>
        <h2>诈骗名单</h2>
      </CustomFlexContainer>
      <SearchDiv>
        <StyledSearchBar
          placeholder="支持QQ、微信、咸鱼号、游戏ID"
          value={searchValue}
          onChange={setSearchValue}
        />
        <StyledSearchButton
          color="primary"
          size="small"
          onClick={handleSearch}
          loading={getSearchFraud.isLoading}
        >
          查询
        </StyledSearchButton>
      </SearchDiv>
      <DescriptionsDiv>
        {items.map((item, index) => (
          <StyledDescriptions
            bordered={true}
            items={item}
            labelStyle={{ width: "30%" }}
            size="small"
            key={index}
          />
        ))}
      </DescriptionsDiv>
      <CustomFlexContainer style={{ marginTop: "0", marginBottom: "30px" }}>
        <StyledCard>
          <p>*本功能旨在整合各大交易群中的纠纷与诈骗实施者</p>
          <p>
            该名单由各大交易群管理直接维护，如有错误，请联系名单中出现的交易群管理
          </p>
          <p>如其他交易群主需要名单权限请联系本人QQ: 2235102484</p>
          以下为当前的合作交易群:
          <CollaboratingGroups>
            {collaboratingGroups.map((group, index) => (
              <GroupSpan key={index}>
                {group.name}--{group.id}
              </GroupSpan>
            ))}
          </CollaboratingGroups>
        </StyledCard>
      </CustomFlexContainer>
    </PageContainer>
  );
}

export default MobileFraudSearch;
