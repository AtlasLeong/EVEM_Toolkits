import { Button, Input, Select, message } from "antd";
import { useState } from "react";
import styled from "styled-components";
import useAddFraudRecord from "./useAddFraudRecord";
import { useGetFraudAdminGroup } from "./useGetFraudAdminGroup";

const StyledContainer = styled.div`
  width: 500px;
  height: 300px;
  display: grid;
  grid-template-columns: 1fr 1fr; // 两列，每列宽度相等
  grid-template-rows: 40px;
`;

const CustomInputDiv = styled.div`
  display: flex;
  justify-content: start;
  align-items: center;
  white-space: pre;
  padding: 5px 5px;
`;

const StyledInput = styled(Input)`
  width: 88%;
`;
const StyledSelect = styled(Select)`
  width: 70%;
`;
const ButtonContainer = styled.div`
  display: flex;
  gap: 40px;
  grid-column: 1/-1;
  margin-left: auto;
  margin-top: 15px;
`;

const fraudTypeList = [
  {
    label: "诈骗",
    value: "诈骗",
  },
  {
    label: "中间人纠纷",
    value: "中间人纠纷",
  },
];
const accountTypeList = [
  {
    label: "QQ",
    value: "QQ",
  },
  {
    label: "微信",
    value: "微信",
  },
  {
    label: "游戏ID",
    value: "游戏ID",
  },
  {
    label: "咸鱼号",
    value: "咸鱼号",
  },
];

function AddFraudRecord({ onCloseModal }) {
  const [fraudAccount, setFraudAccount] = useState("");
  const [accountType, setAccountType] = useState([]);
  const [fraudType, setFraudType] = useState([]);
  const [remark, setRemark] = useState("");
  const [groupID, setGroupID] = useState([]);

  const addFraudRecord = useAddFraudRecord();
  const { adminGroup, isLoading } = useGetFraudAdminGroup();

  function resetAllInput() {
    setAccountType(null);
    setFraudType(null);
    setRemark("");
    setFraudAccount("");
  }

  function handleAddRecord() {
    if (!fraudAccount || !accountType || !fraudType || !groupID) {
      message.warning("请填写完整信息");
      return;
    }

    addFraudRecord.mutate({
      fraudRecord: {
        fraud_account: fraudAccount,
        account_type: accountType[0],
        remark: remark,
        fraud_type: fraudType[0],
        source_group_id: groupID,
      },
    });
    onCloseModal();
  }

  return (
    <StyledContainer>
      <h2>添加诈骗记录</h2>
      <CustomInputDiv style={{ gridColumn: " 1 / -1" }}>
        <p>诈骗号码 </p>
        <StyledInput
          value={fraudAccount}
          onChange={(e) => setFraudAccount(e.target.value)}
        />
      </CustomInputDiv>
      <CustomInputDiv>
        <p>号码类型 </p>
        <StyledSelect
          options={accountTypeList}
          maxCount={1}
          mode="tags"
          placeholder={"可自行输入类型"}
          onChange={(value) => {
            setAccountType(value);
          }}
          value={accountType}
        />
      </CustomInputDiv>
      <CustomInputDiv>
        <p>行为类型 </p>
        <StyledSelect
          options={fraudTypeList}
          maxCount={1}
          mode="tags"
          placeholder={"可自行输入类型"}
          onChange={(value) => {
            setFraudType(value);
          }}
          value={fraudType}
        />
      </CustomInputDiv>
      <CustomInputDiv style={{ gridColumn: " 1 / -1" }}>
        <p>备注/行为详情 </p>
        <StyledInput
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
        />
      </CustomInputDiv>
      <CustomInputDiv style={{ gridColumn: " 1 / -1" }}>
        <p>记录来源 </p>
        <Select
          options={adminGroup}
          loading={isLoading}
          style={{ width: "90%" }}
          onChange={(value) => setGroupID(value)}
          value={groupID}
        />
      </CustomInputDiv>
      <ButtonContainer>
        <Button type="primary" onClick={handleAddRecord}>
          添加记录
        </Button>
        <Button danger={true} onClick={resetAllInput}>
          重置
        </Button>
      </ButtonContainer>
    </StyledContainer>
  );
}

export default AddFraudRecord;
