import styled from "styled-components";
import { useCheckFraudAdmin } from "../features/FraudList/useCheckFraudAdmin";
import { useNavigate } from "react-router-dom";
import Logo from "../ui/Logo";
import { Avatar, Button, List, Popover, Segmented, Table } from "antd";
import { IoLogOutOutline } from "react-icons/io5";
import { AuthContext } from "../context/AuthContext";
import { useContext, useEffect, useState } from "react";
import { PiUser } from "react-icons/pi";
import { getUserInfo } from "../services/getJWTUserInfo";
import { useGetAadminList } from "../features/FraudList/useGetAdminList";
import useDeleteFraudRecord from "../features/FraudList/useDeleteFraudRecord";
import { getFilterList } from "../utils/getFilterList";
import MiniModal from "../ui/MiniModal";
import FraudAdminDeleteConfirm from "../features/FraudList/FraudAdminDeleteConfirm";
import AddFraudRecord from "../features/FraudList/AddFraudRecord";
import EditFraudRecord from "../features/FraudList/EditFraudRecord";
import { useGetFraudBehaviorFlow } from "../features/FraudList/useGetFraudBehaviorFlow";
import FraudChangeDetails from "../features/FraudList/FraudChangeDetails";
import FraudApproveReport from "../features/FraudList/FraudApproveReport";

const StyledLayout = styled.div`
  @import url("https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap");

  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: "Montserrat", sans-serif;
  font-size: 100%;

  background-color: #c9d6ff;

  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  /* height: 100vh; */
  height: 900px;
  min-height: 100vh; /* 使用 min-height 以填充整个视口高度 */
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

const StyledContainer = styled.div`
  background-color: #fff;
  width: 70%;
  height: 100%;
  border-radius: 10px;
  margin-bottom: auto;
  margin-top: 30px;
`;

const StyledDiv = styled.div`
  margin-left: auto; /* 这会将按钮推到最右侧 */
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const StyledNav = styled.nav`
  display: flex;
  justify-content: space-between; /* 修改为space-between */
  align-items: center;
  background-color: #fff;
  padding: 10px 10%;
  border-bottom: 1px solid #eee;

  @media (max-width: 767px) {
    display: none; // 在小屏幕上不显示
  }
`;
const ContentDiv = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-items: center;
  row-gap: 15px;
  width: 130px;
`;
const ContentP = styled.p`
  display: flex;
  align-items: center;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  &:hover {
    text-decoration: underline; // 鼠标悬停时显示下划线
    color: #0077cc; // 鼠标悬停时改变文本颜色
    svg {
      color: #333; // 鼠标悬停时保持图标颜色不变
    }
  }

  svg {
    margin-right: 5px; // 调整图标与文字之间的间距
  }
`;

const AvatarUserName = styled.span`
  font-weight: 600;
`;
const ButtonConainer = styled.div`
  display: flex;
  gap: 10px;
`;

const StyledTable = styled(Table)`
  width: 100%;
`;

const ButtonContainer = styled.div`
  display: flex;
  align-items: center;
`;
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function renderAction(actionType) {
  let actionText = "";
  switch (actionType) {
    case "add":
      actionText = "增加";
      break;
    case "delete":
      actionText = "删除";
      break;
    case "update":
      actionText = "修改";
      break;
    case "accept":
      actionText = "审核通过";
      break;
    case "reject":
      actionText = "审核拒绝";
      break;
    default:
      actionText = "未知操作";
      break;
  }

  return <span style={{ color: "red" }}>{actionText}</span>;
}
function FraudAdmin() {
  const { userName } = getUserInfo() || "";
  const [showControl, setShowControl] = useState("诈骗名单");

  const navigate = useNavigate();
  const { logout, isAuthenticated } = useContext(AuthContext);
  const { checkFraudLogin } = useCheckFraudAdmin(isAuthenticated);
  const { adminFraudList } = useGetAadminList();
  const { fraudBehaviorFlow, isLoading } = useGetFraudBehaviorFlow();

  const deleteFraudRecord = useDeleteFraudRecord();

  const fraudAccountFilterList = getFilterList(adminFraudList, "fraud_account");
  const accountTypeFilterList = getFilterList(adminFraudList, "account_type");
  const fraudTypeFilterList = getFilterList(adminFraudList, "fraud_type");

  const columns = [
    {
      title: "账户类型",
      dataIndex: "account_type",
      key: "account_type",
      filters: accountTypeFilterList,
      sorter: (a, b) => a.box.localeCompare(b.box),
      onFilter: (value, record) => record.account_type.indexOf(value) === 0,
      filterSearch: true,
    },
    {
      title: "账户号码",
      dataIndex: "fraud_account",
      key: "fraud_account",
      filters: fraudAccountFilterList,
      sorter: (a, b) => a.fraud_account - b.fraud_account,
      onFilter: (value, record) => record.fraud_account.indexOf(value) === 0,
      filterSearch: true,
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
      filters: fraudTypeFilterList,
      onFilter: (value, record) => record.fraud_type.indexOf(value) === 0,
      filterSearch: true,
    },
    {
      title: "名单来源",
      dataIndex: "source_group_name",
      key: "id",
      sorter: (a, b) => a.source_group_name - b.source_group_name,
      render: (_, record) => {
        return (
          <StyledBlock>
            <StyledImg src={record.icon} alt={record.source_group_name} />
            {record.source_group_name}
          </StyledBlock>
        );
      },
    },
    {
      title: "操作",
      key: "action",
      render: (_, record) => (
        <ButtonConainer>
          <MiniModal>
            <MiniModal.Open opens={"editFraudRecord"}>
              <Button type="primary">编辑</Button>
            </MiniModal.Open>
            <MiniModal.Window name={"editFraudRecord"}>
              <EditFraudRecord record={record} />
            </MiniModal.Window>
          </MiniModal>

          <MiniModal>
            <MiniModal.Open opens={"deleteFraudRecord"}>
              <Button danger={true}>删除</Button>
            </MiniModal.Open>
            <MiniModal.Window name={"deleteFraudRecord"}>
              <FraudAdminDeleteConfirm
                fraudNumber={record.fraud_account}
                handleConfirmed={() => handleDelete(record)}
              />
            </MiniModal.Window>
          </MiniModal>
        </ButtonConainer>
      ),
    },
  ];

  function handleDelete(record) {
    deleteFraudRecord.mutate({ fraudID: record.id });
  }

  useEffect(() => {
    if (checkFraudLogin?.message === "UnAuthorized Users" || !isAuthenticated) {
      navigate("/fraudlogin");
    }
  }, [checkFraudLogin, isAuthenticated, navigate]);

  const UserContent = (
    <ContentDiv>
      <ContentP
        onClick={() => {
          logout();
          navigate("/fraudlogin");
        }}
      >
        <IoLogOutOutline />
        退出登录
      </ContentP>
    </ContentDiv>
  );

  return (
    <>
      <StyledNav>
        <Logo />
        <Popover placement="leftBottom" content={UserContent}>
          <StyledDiv>
            <Avatar size={50} icon={<PiUser />} />
            <AvatarUserName>{userName}</AvatarUserName>
          </StyledDiv>
        </Popover>
      </StyledNav>
      <StyledLayout>
        <StyledContainer>
          <ButtonContainer>
            <MiniModal>
              <MiniModal.Open opens={"addFraudRecord"}>
                <Button
                  type="primary"
                  style={{
                    backgroundColor: "var(--color-brand-600)",
                    margin: "20px 20px",
                  }}
                >
                  新增
                </Button>
              </MiniModal.Open>
              <MiniModal.Window name={"addFraudRecord"}>
                <AddFraudRecord />
              </MiniModal.Window>
            </MiniModal>
            <Segmented
              options={["诈骗名单", "名单修改记录", "审核公众举报"]}
              onChange={(value) => {
                setShowControl(value);
              }}
              style={{ height: "100%" }}
            />
          </ButtonContainer>

          {showControl === "诈骗名单" ? (
            <StyledTable
              dataSource={adminFraudList?.map((item) => ({
                ...item,
                key: item.id,
              }))}
              columns={columns}
              pagination={{ showSizeChanger: false }}
            ></StyledTable>
          ) : showControl === "名单修改记录" ? (
            <div>
              <List
                size="large"
                dataSource={fraudBehaviorFlow?.filter(
                  (item) => item.change !== "F"
                )}
                renderItem={(item) => (
                  <List.Item
                    actions={[
                      item.change === "B" && (
                        <MiniModal>
                          <MiniModal.Open opens={"FraudChangeRecordDetails"}>
                            <Button type="link">查看详情</Button>
                          </MiniModal.Open>
                          <MiniModal.Window name={"FraudChangeRecordDetails"}>
                            <FraudChangeDetails
                              beforeRecord={item}
                              afterRecord={
                                fraudBehaviorFlow?.filter(
                                  (record) =>
                                    record.operation_id === item.operation_id &&
                                    record.change === "F"
                                )[0]
                              }
                            />
                          </MiniModal.Window>
                        </MiniModal>
                      ),
                    ]}
                  >
                    <List.Item.Meta
                      title={item.fraud_account}
                      description={
                        <>
                          {`${item.username}在 ${formatDate(
                            item.change_time
                          )} `}
                          {renderAction(item.action_type)}
                          {` 记录 ${item.fraud_account}`}
                        </>
                      }
                    />
                  </List.Item>
                )}
                loading={isLoading}
                pagination={{ pageSize: 9 }}
              />
            </div>
          ) : (
            <FraudApproveReport></FraudApproveReport>
          )}
        </StyledContainer>
      </StyledLayout>
    </>
  );
}

export default FraudAdmin;
