import { Button } from "antd";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  width: 250px;
  height: 100px;
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 15px;
  margin-top: 22px;
`;

function LinkToLogin({ operation, onCloseModal, mobile = false }) {
  const navigate = useNavigate();
  function handleLogin() {
    if (mobile) {
      navigate("/mobilelogin");
    } else navigate("/login");
  }

  return (
    <Container>
      <h3> {`${operation} 前请先登录`}</h3>
      <ButtonGroup>
        <Button type="primary" onClick={handleLogin}>
          登录
        </Button>
        <Button onClick={onCloseModal}>返回</Button>
      </ButtonGroup>
    </Container>
  );
}

export default LinkToLogin;
