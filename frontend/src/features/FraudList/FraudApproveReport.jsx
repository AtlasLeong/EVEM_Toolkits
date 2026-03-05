import { Button, Table } from "antd";
import styled from "styled-components";
import { useGetFraudReportListAdmin } from "./useGetFraudReportListAdmin";
import { getFilterList } from "../../utils/getFilterList";
import MiniModal from "../../ui/MiniModal";
import FraudReportDetails from "./FraudReportDetails";
import ModalApproveReport from "./ModalApproveReport";

const StyledTable = styled(Table)`
  width: 100%;
`;

const ButtonContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
`;

function getStatusText(status) {
  if (status === "pending") return "等待审核";
  if (status === "accept") return "审核通过";
  if (status === "reject") return "审核拒绝";
  return "未知";
}

function getStatusColor(status) {
  if (status === "pending") return "var(--color-yellow-700)";
  if (status === "accept") return "green";
  if (status === "reject") return "red";
  return "未知";
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function FraudApproveReport() {
  const { adminFraudReportList, isLoading } = useGetFraudReportListAdmin();

  const fraudAccountFilterList = getFilterList(
    adminFraudReportList,
    "fraud_account"
  );
  const accountTypeFilterList = getFilterList(
    adminFraudReportList,
    "account_type"
  );

  const contactNumberFilterList = getFilterList(
    adminFraudReportList,
    "contact_number"
  );
  const reportStatusFilterList = getFilterList(
    adminFraudReportList?.map((item) => ({
      ...item,
      report_status: getStatusText(item.report_status),
    })),
    "report_status"
  );

  const columns = [
    {
      title: "举报人联系方式",
      dataIndex: "contact_number",
      key: "contact_number",
      filters: contactNumberFilterList,
      onFilter: (value, record) => record.contact_number.indexOf(value) === 0,
      filterSearch: true,
    },
    {
      title: "审核状态",
      dataIndex: "report_status",
      key: "report_status",
      filters: reportStatusFilterList,
      onFilter: (value, record) =>
        getStatusText(record.report_status).indexOf(value) === 0,
      filterSearch: true,
      render: (_, record) => (
        <p style={{ color: `${getStatusColor(record.report_status)}` }}>
          {getStatusText(record.report_status)}
        </p>
      ),
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
      title: "账户类型",
      dataIndex: "account_type",
      key: "account_type",
      filters: accountTypeFilterList,
      onFilter: (value, record) => record.fraud_type.indexOf(value) === 0,
      filterSearch: true,
    },
    {
      title: "审核备注",
      dataIndex: "approve_remark",
      key: "approve_remark",
      ellipsis: {
        showTitle: false,
      },
    },
    {
      title: "操作",
      key: "action",
      align: "center",
      render: (_, record) => (
        <ButtonContainer>
          {record.report_status === "pending" ? (
            <MiniModal>
              <MiniModal.Open opens={"approveModal"}>
                <Button type="primary">审 核</Button>
              </MiniModal.Open>
              <MiniModal.Window name={"approveModal"}>
                <ModalApproveReport
                  reportDetail={record}
                  formatDate={formatDate}
                  getStatusColor={getStatusColor}
                  getStatusText={getStatusText}
                ></ModalApproveReport>
              </MiniModal.Window>
            </MiniModal>
          ) : (
            <MiniModal>
              <MiniModal.Open opens={"detailModal"}>
                <Button>查看详情</Button>
              </MiniModal.Open>
              <MiniModal.Window name={"detailModal"}>
                <FraudReportDetails
                  reportdetail={record}
                  formatDate={formatDate}
                  getStatusColor={getStatusColor}
                  getStatusText={getStatusText}
                ></FraudReportDetails>
              </MiniModal.Window>
            </MiniModal>
          )}
        </ButtonContainer>
      ),
    },
  ];

  return (
    <div>
      <StyledTable
        dataSource={adminFraudReportList?.map((item) => ({
          ...item,
          key: item.id,
        }))}
        columns={columns}
        pagination={{ showSizeChanger: false }}
        loading={isLoading}
      ></StyledTable>
    </div>
  );
}

export default FraudApproveReport;
