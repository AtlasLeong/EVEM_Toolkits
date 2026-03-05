import styled from "styled-components";
import Logo from "./Logo";
import NavMenu from "./NavMenu";
import { Link } from "react-router-dom";

import { PiUser } from "react-icons/pi";
import { Avatar, Popover } from "antd";
import { getUserInfo } from "../services/getJWTUserInfo";
import { IoLogOutOutline, IoSettingsOutline } from "react-icons/io5";
import { AuthContext } from "../context/AuthContext";
import { useContext } from "react";

const StyledNav = styled.nav`
  display: flex;
  justify-content: space-between; /* 修改为space-between */
  align-items: center;
  background-color: #fff;
  padding: 10px 10%;
  border-bottom: 1px solid #eee;

  @media (max-width: 767px) {
    display: none; // 在小屏幕上不显示
  }
`;

const LoginButton = styled(Link)`
  padding: 10px 20px;
  font-size: 16px;
  border: none;
  cursor: pointer;
  transition: background-color 0.3s, color 0.3s;
  border-radius: 5px; /* 给按钮添加圆角 */
  margin: 5px; /* 为按钮添加一些外边距 */
  background-color: #007bff; /* 蓝色背景 */
  color: white; /* 白色文字 */

  margin-left: auto; /* 这会将按钮推到最右侧 */

  &:hover {
    background-color: #0056b3; /* 鼠标悬停时的背景色 */
  }
`;

const StyledDiv = styled.div`
  margin-left: auto; /* 这会将按钮推到最右侧 */
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const AvatarUserName = styled.span`
  font-weight: 600;
`;

const ContentDiv = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-items: center;
  row-gap: 15px;
  width: 130px;
`;
const ContentP = styled.p`
  display: flex;
  align-items: center;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  &:hover {
    text-decoration: underline; // 鼠标悬停时显示下划线
    color: #0077cc; // 鼠标悬停时改变文本颜色
    svg {
      color: #333; // 鼠标悬停时保持图标颜色不变
    }
  }

  svg {
    margin-right: 5px; // 调整图标与文字之间的间距
  }
`;

function NavContainer() {
  const { isAuthenticated: isLogin, logout } = useContext(AuthContext);

  const { userName } = getUserInfo() || "";

  const UserContent = (
    <ContentDiv>
      <ContentP>
        <IoSettingsOutline />
        <Link to={"/usersetting"}>用户设置</Link>
      </ContentP>
      <ContentP onClick={logout}>
        <IoLogOutOutline />
        退出登录
      </ContentP>
    </ContentDiv>
  );
  return (
    <StyledNav>
      <Logo />
      <NavMenu></NavMenu>
      {isLogin ? (
        <Popover placement="leftBottom" content={UserContent}>
          <StyledDiv>
            <Avatar size={50} icon={<PiUser />} />
            <AvatarUserName>{userName}</AvatarUserName>
          </StyledDiv>
        </Popover>
      ) : (
        <LoginButton to="/login">登录 \ 注册</LoginButton>
      )}
    </StyledNav>
  );
}

export default NavContainer;
