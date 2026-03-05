import styled from "styled-components";
const Form = styled.form`
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%; /* 根据需要调整，例如使用 min-height: 100vh; 使其至少和视口一样高 */
  & > *:not(:last-child) {
    margin-bottom: 25px; // 为每个直接子元素添加底部间距，除了最后一个
  }
`;

export default Form;
