import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { isMobileContext } from "../context/IsMobileContext";

const StyledLogo = styled.div`
  text-align: left;
  display: flex;
  cursor: pointer;
  margin-left: -80px;
  ${($props) =>
    $props.$isMobile
      ? `
    justify-content: center;
    margin-left: 0;
    margin-top: 10px;
  `
      : `
  `}
`;

const Img = styled.img`
  height: 5rem;
  width: auto;
`;

const StyledDesc = styled.h2`
  text-align: center;
  font-size: 25px;
  padding-top: 15px;
  padding-left: 10px;
  color: #201e1e;
`;

function Logo() {
  const navigate = useNavigate();
  const { isMobile } = useContext(isMobileContext);

  function handleNavigateIndex() {
    navigate("/");
  }

  return (
    <StyledLogo onClick={handleNavigateIndex} $isMobile={isMobile}>
      <Img src="Guristas_Logo_new.png" alt="Logo" />
      <StyledDesc>EVEMToolkit</StyledDesc>
    </StyledLogo>
  );
}

export default Logo;
