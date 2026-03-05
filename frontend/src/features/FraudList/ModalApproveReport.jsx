import { Button, Image, Input, Radio, Steps } from "antd";
import { useState } from "react";
import styled from "styled-components";
import useSubmitReportApprove from "./useSubmitReportApprove";

const StyledSteps = styled(Steps)`
  margin-top: 25px;
  margin-bottom: 20px;
`;
const StyledCustomFlex = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 30px;
  gap: 30px;
`;

const Container = styled.div`
  height: 550px;
  width: 650px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: scroll;
`;

const ImageConatiner = styled.div`
  display: flex;
  gap: 10px;
  flex-wrap: wrap; /* 允许元素自动换行 */
`;

const { TextArea } = Input;

function ModalApproveReport({ reportDetail, formatDate, onCloseModal }) {
  const urlList = reportDetail.evidence_dict?.split(",");
  const [approveStatus, setApproveStatus] = useState("accept");
  const [approveRemark, setApproveRemark] = useState("");

  const reportApprove = useSubmitReportApprove();

  function handleSubmitApprove() {
    reportApprove.mutate({
      report_id: reportDetail.id,
      approve_remark: approveRemark,
      approve_status: approveStatus,
    });
    onCloseModal();
  }
  return (
    <Container>
      <StyledSteps
        current={
          reportDetail.report_status === "accept" ||
          reportDetail.report_status === "reject"
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
              reportDetail.report_status === "accept" ||
              reportDetail.report_status === "pending"
                ? "审核成功"
                : "审核失败"
            }`,
            status: `${
              reportDetail.report_status === "accept"
                ? "finish"
                : reportDetail.report_status === "pending"
                ? "wait"
                : "error"
            }`,
          },
        ]}
        size="small"
      />
      <h3>举报详情</h3>
      <p>
        举报人联系方式：<span>{reportDetail.contact_number}</span>
      </p>

      <p>
        被举报账号：
        <span>{reportDetail.fraud_account}</span>
      </p>
      <p>
        账号类型：
        <span>{reportDetail.account_type}</span>
      </p>
      <p>
        创建时间：
        <span>
          {formatDate(reportDetail.create_time) === "1970/1/1 08:00:00"
            ? "无"
            : formatDate(reportDetail.create_time)}
        </span>
      </p>

      <p>
        行为描述：
        <span>{reportDetail.description}</span>
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
      <p>
        <span style={{ color: "red" }}>*</span>审核备注：
        <TextArea
          value={approveRemark}
          onChange={(e) => setApproveRemark(e.target.value)}
          style={{ height: "100px" }}
          showCount
          maxLength={200}
          allowClear
          placeholder="通过或拒绝审核的理由与备注"
        ></TextArea>
      </p>
      <StyledCustomFlex>
        <Radio.Group
          size="large"
          onChange={(e) => setApproveStatus(e.target.value)}
          value={approveStatus}
        >
          <Radio value={"accept"}>通过</Radio>
          <Radio value={"reject"}>拒绝</Radio>
        </Radio.Group>
      </StyledCustomFlex>
      <StyledCustomFlex>
        <Button type="primary" onClick={handleSubmitApprove}>
          提交
        </Button>
        <Button onClick={onCloseModal}>返回</Button>
      </StyledCustomFlex>
    </Container>
  );
}

export default ModalApproveReport;
