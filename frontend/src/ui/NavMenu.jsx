import styled from "styled-components";
import { NavLink, useLocation } from "react-router-dom";
import {
  IoPlanet,
  IoReader,
  IoSkullSharp,
  IoBarChartSharp,
} from "react-icons/io5";
import { FaMapLocation } from "react-icons/fa6";
import { useEffect, useRef, useState } from "react";

const StyledNavMenu = styled.ul`
  display: flex;
  gap: 0.8rem;
  position: relative;
  margin-left: auto;
`;

const Underline = styled.div`
  height: 2.5px;
  background-color: #007bff;
  position: absolute;
  bottom: 0;
  transition: width 0.3s, left 0.3s;
`;

const NavItem = styled(NavLink)`
  &:link,
  &:visited {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 2rem;
    font-weight: 500;
    padding: 1.2rem 2.4rem;
    transition: all 0.3s;
    &:hover {
      background-color: var(--color-grey-300);
      border-radius: var(--border-radius-md);
    }
  }
`;

const NavMenu = () => {
  const [underlineStyle, setUnderlineStyle] = useState({ left: 0, width: 0 });
  const location = useLocation();
  const navItemsRef = useRef({
    infocenter: useRef(null),
    fraudlist: useRef(null),
    planetary: useRef(null),
    bazaar: useRef(null),
    starmap: useRef(null),
  });

  const updateUnderline = (el) => {
    const { offsetLeft: left, offsetWidth: width } = el;
    setUnderlineStyle({ left, width });
  };

  useEffect(() => {
    const activeItem = Object.keys(navItemsRef.current).find((key) =>
      location.pathname.includes(key)
    );

    if (activeItem) {
      const activeElement = navItemsRef.current[activeItem].current;
      if (activeElement) {
        updateUnderline(activeElement);
      }
    } else {
      setUnderlineStyle({ left: 0, width: 0 }); // 重置下划线样式
    }
  }, [location]);

  useEffect(() => {
    const handleResize = () => {
      const activeItem = Object.keys(navItemsRef.current).find((key) =>
        location.pathname.includes(key)
      );
      if (activeItem) {
        const activeElement = navItemsRef.current[activeItem].current;
        if (activeElement) {
          updateUnderline(activeElement);
        }
      }
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [location]);

  return (
    <StyledNavMenu>
      <li>
        <NavItem
          to="/starmap"
          onClick={() =>
            updateUnderline(navItemsRef.current.infocenter.current)
          }
          ref={navItemsRef.current.starmap}
        >
          {/* <IoSkullSharp /> */}
          <FaMapLocation />
          诱导星图
        </NavItem>
      </li>
      <li>
        <NavItem
          to="/fraudlist"
          onClick={() => updateUnderline(navItemsRef.current.fraudlist.current)}
          ref={navItemsRef.current.fraudlist}
        >
          <IoReader />
          防诈名单
        </NavItem>
      </li>
      <li>
        <NavItem
          to="/bazaar"
          onClick={() => updateUnderline(navItemsRef.current.bazaar.current)}
          ref={navItemsRef.current.bazaar}
        >
          <IoBarChartSharp />
          泛星集市
        </NavItem>
      </li>
      <li>
        <NavItem
          to="/planetary"
          onClick={() => updateUnderline(navItemsRef.current.planetary.current)}
          ref={navItemsRef.current.planetary}
        >
          <IoPlanet />
          行星资源
        </NavItem>
      </li>

      <Underline
        style={{
          left: `${underlineStyle.left}px`,
          width: `${underlineStyle.width}px`,
        }}
      />
    </StyledNavMenu>
  );
};

export default NavMenu;
