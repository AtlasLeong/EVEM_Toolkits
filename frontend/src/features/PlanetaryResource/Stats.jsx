import Stat from "../../ui/Stat";
import { BsFuelPump } from "react-icons/bs";
import { RiMoneyCnyBoxLine } from "react-icons/ri";
import { IoHourglassOutline } from "react-icons/io5";
import { GiCelebrationFire } from "react-icons/gi";
import CountUp from "react-countup";
import styled from "styled-components";
import ConvertHoursToDaysHoursMinutes from "../../ui/ConvertHoursToDaysHoursMinutes";

const Value = styled.div`
  font-size: 2.4rem;
  line-height: 1;
  font-weight: 500;
  align-items: center;
`;

function Stats({ totalPrice, totalFuel, unitFuel, skill, castle, maxOutPut }) {
  let centerCost = 0;
  let resource_limit = 100;
  switch (castle) {
    case "双菜插":
      centerCost = 18000;
      resource_limit += 400;
      break;
    case "单菜插":
      centerCost = 9000;
      resource_limit += 200;
      break;
    default:
      centerCost = 0;
      break;
  }

  switch (skill) {
    case "技能554":
      resource_limit += 820;
      break;
    case "技能555":
      resource_limit += 900;
      break;
    default:
      break;
  }

  const costGap = unitFuel - centerCost;

  const fullArraryTime = maxOutPut ? (resource_limit * 100) / maxOutPut : 0;

  return (
    <>
      <Stat
        title="个堡燃料消耗差"
        icon={<BsFuelPump />}
        color={"green"}
        value={
          <Value>
            <CountUp end={costGap} duration={0.5} />
            <span> 吉焦/小时</span>
          </Value>
        }
      />
      <Stat
        title="燃料总热值"
        icon={<GiCelebrationFire />}
        color={"red"}
        value={
          <Value>
            <CountUp end={totalFuel} duration={0.5} />
            吉焦
          </Value>
        }
      />

      <Stat
        title="产出总价值"
        icon={<RiMoneyCnyBoxLine />}
        color={"blue"}
        value={
          <Value>
            <CountUp end={totalPrice / 100000000} decimals={2} duration={0.5} />
            亿ISK
          </Value>
        }
      />
      <Stat
        title="阵列满仓时间"
        icon={<IoHourglassOutline />}
        color={"yellow"}
        value={
          <Value>
            <ConvertHoursToDaysHoursMinutes totalHours={fullArraryTime} />
          </Value>
        }
      />
    </>
  );
}

export default Stats;
