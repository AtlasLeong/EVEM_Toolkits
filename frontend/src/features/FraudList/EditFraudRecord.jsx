import { Button, Input, Select, message } from "antd";
import { useState } from "react";
import { useGetFraudAdminGroup } from "./useGetFraudAdminGroup";
import styled from "styled-components";
import useEditFraudRecord from "./useEditFraudRecord";

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

function EditFraudRecord({ record, onCloseModal }) {
  const [fraudAccount, setFraudAccount] = useState(record.fraud_account);
  const [accountType, setAccountType] = useState([record.account_type]);
  const [fraudType, setFraudType] = useState([record.fraud_type]);
  const [remark, setRemark] = useState(record.remark);
  const [groupID, setGroupID] = useState([record.source_group_id]);

  const { adminGroup, isLoading } = useGetFraudAdminGroup();
  const editFraudRecord = useEditFraudRecord();

  function handleEditRecord() {
    console.log(fraudAccount, accountType, fraudType, remark, groupID);
    if (!fraudAccount || !accountType || !fraudType || !groupID) {
      message.warning("请填写完整信息");
      return;
    }

    editFraudRecord.mutate({
      fraudRecord: {
        fraud_id: record.id,
        fraud_account: fraudAccount,
        account_type: accountType[0],
        remark: remark,
        fraud_type: fraudType[0],
        source_group_id: groupID[0],
      },
    });
    onCloseModal();
  }

  return (
    <StyledContainer>
      <h2>修改诈骗记录</h2>
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
          disabled={true}
        />
      </CustomInputDiv>
      <ButtonContainer>
        <Button type="primary" onClick={handleEditRecord}>
          保存记录
        </Button>
      </ButtonContainer>
    </StyledContainer>
  );
}

export default EditFraudRecord;
