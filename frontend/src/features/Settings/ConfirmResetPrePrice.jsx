import { Button } from "antd";
import styled from "styled-components";

const ButtonGroup = styled.div`
  display: flex;
  gap: 15px;
  margin-top: 22px;
  margin-left: 50%;
`;

const StyledDiv = styled.div`
  display: flex;
  flex-direction: column;
  width: 250px;
  height: 100px;
`;

const StyledP = styled.p`
  display: flex;
  justify-items: center;
  align-items: center;
  margin-top: 10px;
  font-size: 16px;
`;

function ConfirmResetPrePrice({ onCloseModal, onResetPrice }) {
  return (
    <StyledDiv>
      <h3>重置</h3>
      <StyledP>确认重置预设价格吗？</StyledP>
      <ButtonGroup>
        <Button
          danger={true}
          type="primary"
          onClick={() => {
            onResetPrice();
            onCloseModal();
          }}
        >
          确认
        </Button>
        <Button danger={true} onClick={onCloseModal}>
          返回
        </Button>
      </ButtonGroup>
    </StyledDiv>
  );
}

export default ConfirmResetPrePrice;
