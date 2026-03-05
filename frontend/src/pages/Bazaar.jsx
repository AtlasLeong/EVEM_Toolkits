import styled from "styled-components";
import BazaarCharts from "../features/Bazaar/BazaarCharts";
import BazaarSelect from "../features/Bazaar/BazaarSelect";
import { useState } from "react";
import BazaarInfo from "../features/Bazaar/BazaarInfo";
import BazaarCalculator from "../features/Bazaar/BazaarCalculator";

const ContainDiv = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

function Bazaar() {
  const [bazaarName, setBazaarName] = useState("终焉回响");
  const [server, setServer] = useState("china");
  const [selectDate, setSelectDate] = useState();
  return (
    <ContainDiv>
      <BazaarSelect
        bazaarName={bazaarName}
        server={server}
        selectDate={selectDate}
        setSelectDate={setSelectDate}
        setBazaarName={setBazaarName}
        setServer={setServer}
      ></BazaarSelect>
      <BazaarInfo
        bazaarName={bazaarName}
        server={server}
        selectDate={selectDate}
      ></BazaarInfo>
      <BazaarCharts />
      <BazaarCalculator />
    </ContainDiv>
  );
}

export default Bazaar;
