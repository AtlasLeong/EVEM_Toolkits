import { useState } from "react";
import styled, { css } from "styled-components";
import { IoRemove, IoAdd } from "react-icons/io5";

// 使用 styled 的 attrs 方法来定义属性，这样可以确保 isOpen 不会被传递给 DOM 元素
// 使用 shouldForwardProp 来过滤 isOpen 属性
const AccordionItem = styled.div.withConfig({
  shouldForwardProp: (prop) => prop !== "isOpen",
})`
  box-shadow: 0 0 30px rgba(0, 0, 0, 0.1);
  padding: 10px 12px;
  padding-right: 48px;
  cursor: pointer;
  border-top: 4px solid #fff;
  border-bottom: 4px solid #fff;
  border-radius: 1rem;
  display: grid;
  grid-template-columns: 1fr auto;
  column-gap: 24px;
  row-gap: 20px;
  align-items: center;
  background-color: #fff;
  overflow: hidden;
  transition: max-height 0.3s ease-in-out;
  max-height: 60px; /* 初始最大高度 */
  ${(props) =>
    props.isOpen &&
    css`
      p {
        color: #087f5b;
      }
      border-top: 4px solid #087f5b;
      max-height: 500px; /* 调整为合适的最大高度 */
    `}
`;

const StyledTitle = styled.p`
  font-size: 24px;
  font-weight: bolder;
`;

const ContentBox = styled.div`
  grid-column: 1 / -1;
  padding-bottom: 16px;
  line-height: 1.6;
  cursor: default;
  ul {
    margin-left: 16px;
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
`;

function AccordionTip({ title, children }) {
  const [isOpen, setIsOpen] = useState(false);

  function handleToggle() {
    setIsOpen((open) => !open);
  }

  return (
    <AccordionItem isOpen={isOpen}>
      <StyledTitle onClick={handleToggle}>{title}</StyledTitle>
      <StyledTitle onClick={handleToggle}>
        {isOpen ? <IoRemove /> : <IoAdd />}
      </StyledTitle>
      <ContentBox>{children}</ContentBox>
    </AccordionItem>
  );
}

export default AccordionTip;
