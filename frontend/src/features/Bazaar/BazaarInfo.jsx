import styled from "styled-components";
import BazaarStats from "./BazaarStats";

const InfoContainer = styled.div`
  display: grid;
  grid-template-rows: 30px auto; /* 第一行高度为30px，第二行自动填充 */
  background-color: #fff;
  border-radius: 5px;
  height: 160px;
`;
const Heading = styled.h3`
  padding: 5px 10px; /* 添加内边距 */
`;

function BazaarInfo({ bazaarName, server, selectDate }) {
  return (
    <InfoContainer>
      <Heading>具体日期数据</Heading>
      <BazaarStats
        bazaarName={bazaarName}
        server={server}
        selectDate={selectDate}
      ></BazaarStats>
    </InfoContainer>
  );
}

export default BazaarInfo;
