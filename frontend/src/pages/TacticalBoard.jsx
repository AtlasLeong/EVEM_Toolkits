import styled from "styled-components";
import StarMap from "../features/TacticalBoard/ThreeStarMap";
import NavContainer from "../ui/NavContainer";
import { useEffect, useState } from "react";
import MobileSearch from "../features/TacticalBoard/MobileSearch";

const AppContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh; /* 修正为vh */
  overflow-x: hidden;
  width: 100vw;
`;
function TacticalBoard() {
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  useEffect(() => {
    const checkMobile = () => {
      const isMobile = window.innerWidth <= 768; // 你可以调整这个宽度
      setShowMobileSearch(isMobile);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <>
      {showMobileSearch ? (
        <MobileSearch />
      ) : (
        <AppContainer>
          <NavContainer />
          <StarMap />
        </AppContainer>
      )}
    </>
  );
}

export default TacticalBoard;
