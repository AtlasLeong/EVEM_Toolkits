import { Badge, TabBar } from "antd-mobile";
import { useEffect, useState } from "react";

import { IoCalculatorOutline, IoReaderOutline } from "react-icons/io5";
import { PiUser } from "react-icons/pi";
import { useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";

const FixedTabBar = styled(TabBar)`
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background-color: white;
  z-index: 1000;
`;

const tabs = [
  {
    key: "/fraudlist",
    title: "诈骗名单",
    icon: <IoReaderOutline />,
    badge: Badge.dot,
  },
  {
    key: "/mobileCalculators",
    title: "计算器",
    icon: <IoCalculatorOutline />,
    badge: Badge.dot,
  },
  {
    key: "/mobileuser",
    title: "我的",
    icon: <PiUser />,
    badge: Badge.dot,
  },
];

function MobileBottomNavigate() {
  const navigate = useNavigate();
  const location = useLocation();

  const [activeKey, setActiveKey] = useState(location.pathname);
  useEffect(() => {
    if (location.pathname === "/mobilelogin") {
      setActiveKey("/mobileuser");
    } else {
      setActiveKey(location.pathname);
    }
  }, [location.pathname]);

  const setRouteActive = (value) => {
    navigate(value);
  };

  return (
    <FixedTabBar
      activeKey={activeKey}
      onChange={(value) => setRouteActive(value)}
      style={{ backgroundColor: "white", bottom: "0%" }}
    >
      {tabs.map((item) => (
        <TabBar.Item title={item.title} icon={item.icon} key={item.key} />
      ))}
    </FixedTabBar>
  );
}

export default MobileBottomNavigate;
