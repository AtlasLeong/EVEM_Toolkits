import { Avatar, List } from "antd-mobile";
import { getUserInfo } from "../../services/getJWTUserInfo";
import styled from "styled-components";
import { useContext } from "react";
import { AuthContext } from "../../context/AuthContext";
import Logo from "../../ui/Logo";

const StyledSpan = styled.span`
  margin-left: 40px;
`;

const StyledAvatar = styled(Avatar)`
  margin-right: 20px;
`;

const StyledFlexListItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;
const StyledContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`;

const StyledLogoutP = styled.p`
  color: var(--color-red-700);
`;

function MobileSetting() {
  const { userName } = getUserInfo() || "";
  const { logout } = useContext(AuthContext);

  return (
    <>
      <List style={{ marginTop: "10px" }}>
        <List.Item>
          <StyledFlexListItem>
            <StyledSpan>{userName}</StyledSpan>
            <StyledAvatar src="" />
          </StyledFlexListItem>
        </List.Item>
        <List.Item>
          <StyledContainer>
            <StyledLogoutP onClick={logout}>退出登录</StyledLogoutP>
          </StyledContainer>
        </List.Item>
      </List>
    </>
  );
}

export default MobileSetting;
