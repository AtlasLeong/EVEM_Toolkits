import styled from "styled-components";
import { FaArrowRight } from "react-icons/fa6";

const StyleContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 0.3fr 1fr; // 两列，每列宽度相等
`;

const HalfDiv = styled.div`
  height: 180px;
  min-width: 150px;
  display: flex;
  flex-direction: column;

  align-items: start;
`;

const MiddleDiv = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 30px;
`;

const StyledText = styled.span`
  color: ${(props) => (props.isChanged ? "red" : "black")};
`;

function FraudChangeDetails({ beforeRecord, afterRecord }) {
  const isChanged = (field) => beforeRecord[field] !== afterRecord[field];

  return (
    <div>
      <h2 style={{ marginBottom: "30px" }}>更新详情</h2>
      <StyleContainer>
        <HalfDiv>
          <p>
            诈骗账号：
            <StyledText isChanged={isChanged("fraud_account")}>
              {beforeRecord.fraud_account}
            </StyledText>
          </p>
          <p>
            账号类型：
            <StyledText isChanged={isChanged("account_type")}>
              {beforeRecord.account_type}
            </StyledText>
          </p>
          <p>
            诈骗类型：
            <StyledText isChanged={isChanged("fraud_type")}>
              {beforeRecord.fraud_type}
            </StyledText>
          </p>
          <p>
            诈骗备注：
            <StyledText isChanged={isChanged("remark")}>
              {beforeRecord.remark}
            </StyledText>
          </p>
        </HalfDiv>
        <MiddleDiv>
          <FaArrowRight style={{ fontSize: "19px" }} />
        </MiddleDiv>
        <HalfDiv>
          <p>
            诈骗账号：
            <StyledText isChanged={isChanged("fraud_account")}>
              {afterRecord.fraud_account}
            </StyledText>
          </p>
          <p>
            账号类型：
            <StyledText isChanged={isChanged("account_type")}>
              {afterRecord.account_type}
            </StyledText>
          </p>
          <p>
            诈骗类型：
            <StyledText isChanged={isChanged("fraud_type")}>
              {afterRecord.fraud_type}
            </StyledText>
          </p>
          <p>
            诈骗备注：
            <StyledText isChanged={isChanged("remark")}>
              {afterRecord.remark}
            </StyledText>
          </p>
        </HalfDiv>
      </StyleContainer>
    </div>
  );
}

export default FraudChangeDetails;
