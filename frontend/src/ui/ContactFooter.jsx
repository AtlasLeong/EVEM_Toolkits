import React from "react";
import styled from "styled-components";

const StyledFooter = styled.footer`
  display: flex;
  justify-content: space-between;
  bottom: 0%;
  background-color: var(--color-grey-100);
  @media (max-width: 767px) {
    display: none; // 在小屏幕上不显示
  }
`;

const DataLink = styled.a`
  color: var(--color-blue-700);
  text-decoration: underline;
`;

const ContactSpan = styled.span`
  color: var(--color-blue-700);
`;

const ContactFooter = () => (
  <StyledFooter>
    <p>
      功能建议与BUG反馈-QQ: <ContactSpan>2235102484</ContactSpan>
    </p>
    <a href="https://beian.miit.gov.cn">粤ICP备2024264329号-1</a>
    <p>
      感谢数据来源ieve
      <DataLink href="https://ieve.yiilib.com/">
        (https://ieve.yiilib.com)
      </DataLink>
    </p>
  </StyledFooter>
);

export default ContactFooter;
