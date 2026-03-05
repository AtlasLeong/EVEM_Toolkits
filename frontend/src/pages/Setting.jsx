// 引入 Ant Design 组件库中的 Menu 和 Layout 组件
import { Menu, Layout } from "antd";
// 引入图标库中的图标组件
import { FaUserLock } from "react-icons/fa";
import { AiFillMoneyCollect } from "react-icons/ai";
import { IoSettingsOutline } from "react-icons/io5";
// 引入 styled-components 库用于自定义组件样式
import styled from "styled-components";
// 引入 React 的 useState 钩子
import { useContext, useState } from "react";
// 引入修改密码和修改预设价格的组件
import ChangePassword from "../features/Settings/ChangePassword";
import ChangePrePrice from "../features/Settings/ChangePrePrice";
import { AuthContext } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
// 从 Layout 组件中解构出 Content 和 Sider 组件
const { Content, Sider } = Layout;

// 使用 styled-components 创建一个 Container 组件，设置样式为网格布局
const Container = styled.div`
  display: grid;
  height: 850px;
  grid-template-columns: 26rem 1fr;
  grid-template-rows: 1fr;
  background-color: #fff;
`;

// 创建一个 StyledIcon 组件，用于设置图标的样式
const StyledIcon = styled.div`
  align-items: center;
  font-size: 60px;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 256px;
`;

// 定义菜单项数据，包括 key、label 和 icon
const items = [
  {
    key: "password",
    label: "修改密码",
    icon: <FaUserLock />,
  },
  {
    key: "PrePrice",
    label: "修改预设价格",
    icon: <AiFillMoneyCollect />,
  },
];

// 定义 Setting 组件
function Setting() {
  // 使用 useState 管理当前显示的页面
  const [showPage, setShowPage] = useState("password");
  const { isAuthenticated } = useContext(AuthContext);
  const navigate = useNavigate();

  if (!isAuthenticated) {
    navigate("/");
  }

  // 定义点击菜单项时的处理函数
  const onClickSetting = (e) => {
    setShowPage(e.key);
  };
  // 组件渲染内容
  return (
    <Container>
      <Sider>
        <StyledIcon>
          <IoSettingsOutline />
        </StyledIcon>
        <Menu
          onClick={onClickSetting} // 点击菜单项时的回调函数
          style={{
            width: 256,
            marginTop: 20,
          }}
          mode="vertical" // 菜单模式为垂直
          items={items} // 菜单项数据
          defaultSelectedKeys={"password"} // 默认激活的菜单项
        />
      </Sider>
      <Content>
        {showPage === "password" && <ChangePassword />}
        {showPage === "PrePrice" && <ChangePrePrice />}
      </Content>
    </Container>
  );
}

// 导出 Setting 组件
export default Setting;
