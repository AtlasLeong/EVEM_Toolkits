import styled from "styled-components";
import ErrorMessage from "./ErrorMessage";
const StyleDiv = styled.div`
  width: ${(props) => (props.$inlineBlock ? "fit-content" : "100%")};
`;
function FormError({ errors, errorName, inlineBlock = false }) {
  if (!errors) return null;
  return (
    <StyleDiv $inlineBlock={inlineBlock}>
      {errors[errorName]?.message && (
        <ErrorMessage style={{ margin: "1px 0 0", width: "100%" }}>
          {errors[errorName]?.message}
        </ErrorMessage>
      )}
    </StyleDiv>
  );
}

export default FormError;
