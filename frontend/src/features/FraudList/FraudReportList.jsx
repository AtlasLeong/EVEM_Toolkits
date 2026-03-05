import styled from "styled-components";
import { Button, List, message } from "antd";
import { useContext, useState } from "react";
import FraudReportDetails from "./FraudReportDetails";
import { isMobileContext } from "../../context/IsMobileContext";

const StyledCustomFlex = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 30px;
`;

const StyledH3 = styled.h3`
  margin-top: 10px;
  margin-bottom: 10px;
`;

const StyledList = styled(List)`
  height: 400px;
`;

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString("zh-CN", { hour12: false });
}

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

function FraudReportList({ fraudReportList, isLoading, setShowReportPage }) {
  const [showReportDetails, setShowReportDetails] = useState(false);

  const { isMobile } = useContext(isMobileContext);
  const [reportdetail, setReportDetail] = useState({});
  // 根据列表长度决定是否显示分页
  const showPagination = isMobile
    ? fraudReportList?.length >= 3
    : fraudReportList?.length >= 4;

  const pendingReports = fraudReportList?.filter(
    (report) => report.report_status === "pending"
  );

  function handleAddReport() {
    if (pendingReports?.length > 0) {
      message.error("每个用户只能同时产生一个举报，请等待审核完成后再次举报");
      return;
    }
    setShowReportPage(true);
  }

  function handleShowReportDetails(data) {
    console.log(data);
    setReportDetail(data);
    setShowReportDetails(true);
  }

  return (
    <div>
      {showReportDetails ? (
        <FraudReportDetails
          reportdetail={reportdetail}
          setShowReportDetails={setShowReportDetails}
          getStatusColor={getStatusColor}
          getStatusText={getStatusText}
          formatDate={formatDate}
        />
      ) : (
        <>
          <StyledH3>举报记录</StyledH3>
          <StyledList
            size="small"
            dataSource={fraudReportList}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    type="link"
                    key={"list-check"}
                    onClick={() => handleShowReportDetails(item)}
                  >
                    查看详情
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={item.fraud_account}
                  description={
                    <>
                      <p>
                        审核状态：
                        <span
                          style={{
                            color: `${getStatusColor(item.report_status)}`,
                          }}
                        >
                          {getStatusText(item.report_status)}
                          {"  "}
                        </span>
                      </p>
                      <p>创建时间：{formatDate(item.create_time)}</p>
                    </>
                  }
                />
              </List.Item>
            )}
            loading={isLoading}
            pagination={showPagination ? { pageSize: isMobile ? 3 : 4 } : false}
          />
          <StyledCustomFlex>
            <Button type="primary" size="large" onClick={handleAddReport}>
              新增举报
            </Button>
          </StyledCustomFlex>
        </>
      )}
    </div>
  );
}

export default FraudReportList;
