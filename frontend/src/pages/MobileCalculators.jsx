import { Tabs } from "antd-mobile";
import MobileMapCalculator from "../features/TacticalBoard/MobileMapCalculator";
import styled from "styled-components";
import ImplantExperienceCalculator from "../features/TacticalBoard/ImplantExperienceCalculator";

const StyledTabs = styled(Tabs)`
  margin-top: 20px;
`;
function MobileCalculators() {
  return (
    <StyledTabs>
      <Tabs.Tab title="诱导路线规划" key="MapClculator">
        <MobileMapCalculator />
      </Tabs.Tab>
      <Tabs.Tab title="植入体经验计算" key="xxxxx">
        <ImplantExperienceCalculator></ImplantExperienceCalculator>
      </Tabs.Tab>
    </StyledTabs>
  );
}

export default MobileCalculators;
