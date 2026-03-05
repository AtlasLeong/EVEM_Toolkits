import NavContainer from "./NavContainer";
import { Outlet, useLocation } from "react-router-dom";
import { styled } from "styled-components";
import ContactFooter from "./ContactFooter";
import { useContext } from "react";
import { isMobileContext } from "../context/IsMobileContext";
import MobileBottomNavigate from "./MobileBottomNavigate";
import Logo from "./Logo";

const AppContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh; /* 修正为vh */
  @media (max-width: 767px) {
    background-color: var(--color-grey-100);
    height: auto;
    width: 100%;
  }
`;

const StyleLogo = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`;

const Main = styled.main`
  background-color: var(--color-grey-100);
  padding: 4rem 4.8rem 6.4rem;
  overflow: auto; /* 允许Main内部滚动 */
  flex: 1; /* 使Main组件占用所有剩余空间 */
  @media (max-width: 767px) {
    padding: 0; // 在小屏幕上不显示
  }
`;

const Container = styled.div`
  max-width: 140rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 3.2rem;
`;

function AppLayout() {
  const { isMobile } = useContext(isMobileContext);
  const location = useLocation();

  // 检查当前路径是否为登录页面
  const isLoginPage = location.pathname === "/mobilelogin" && isMobile;
  return (
    <>
      {isMobile ? (
        <AppContainer>
          {!isLoginPage && (
            <StyleLogo>
              <Logo />
            </StyleLogo>
          )}
          <Outlet />
          <MobileBottomNavigate />
        </AppContainer>
      ) : (
        <AppContainer>
          <NavContainer />
          <Main>
            <Container>
              <Outlet />
            </Container>
          </Main>
          <ContactFooter />
        </AppContainer>
      )}
    </>
  );
}

export default AppLayout;
