import { Button, Image, Steps } from "antd";
import styled from "styled-components";
const StyledCustomFlex = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 30px;
  gap: 25px;
`;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ImageConatiner = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap; /* 允许元素自动换行 */
`;

const StyledSteps = styled(Steps)`
  margin-top: 15px;
  margin-bottom: 10px;
`;

function FraudReportDetails({
  reportdetail,
  setShowReportDetails,
  getStatusColor,
  getStatusText,
  formatDate,
  onCloseModal,
}) {
  const urlList = reportdetail.evidence_dict?.split(",");

  return (
    <Container>
      <StyledSteps
        current={
          reportdetail.report_status === "accept" ||
          reportdetail.report_status === "reject"
            ? 3
            : 2
        }
        items={[
          {
            title: "提交举报",
            status: "process",
          },
          {
            title: "等待审核",
            status: "process",
          },
          {
            title: `${
              reportdetail.report_status === "accept" ||
              reportdetail.report_status === "pending"
                ? "审核成功"
                : "审核失败"
            }`,
            status: `${
              reportdetail.report_status === "accept"
                ? "finish"
                : reportdetail.report_status === "pending"
                ? "wait"
                : "error"
            }`,
          },
        ]}
        size="small"
      />
      <h3>举报详情</h3>
      <p>
        举报账号：
        <span>{reportdetail.fraud_account}</span>
      </p>
      <p>
        账号类型：
        <span>{reportdetail.account_type}</span>
      </p>
      <p>
        创建时间：
        <span>
          {formatDate(reportdetail.create_time) === "1970/1/1 08:00:00"
            ? "无"
            : formatDate(reportdetail.create_time)}
        </span>
      </p>

      <p>
        审核时间：
        <span>
          {formatDate(reportdetail.approve_time) === "1970/1/1 08:00:00"
            ? "无"
            : formatDate(reportdetail.approve_time)}
        </span>
      </p>
      <p>
        审核状态：
        <span
          style={{ color: `${getStatusColor(reportdetail.report_status)}` }}
        >
          {getStatusText(reportdetail.report_status)}
        </span>
      </p>
      <p>
        审核群组：
        <span>{reportdetail.approver_group || "无"}</span>
      </p>
      <p>
        行为描述：
        <span>{reportdetail.description}</span>
      </p>
      <p>
        审核备注：
        <span>{reportdetail.approve_remark}</span>
      </p>
      <div>
        <p>证据截图： </p>
        <ImageConatiner>
          <Image.PreviewGroup
            preview={{
              onChange: (current, prev) =>
            }}
          >
            {urlList.map((url) => (
              <Image width={130} height={130} src={url} key={url} />
            ))}
          </Image.PreviewGroup>
        </ImageConatiner>
      </div>
      <StyledCustomFlex>
        {/* {reportdetail.report_status === "reject" && (
          <Button type="primary" onClick={handleEditAgain}>
            修改重新提交
          </Button>
        )} */}
        <Button
          onClick={() =>
            setShowReportDetails ? setShowReportDetails(false) : onCloseModal()
          }
        >
          返回
        </Button>
      </StyledCustomFlex>
    </Container>
  );
}

export default FraudReportDetails;
