import { useEffect, useState } from "react";
import CountUp from "react-countup";

function ConvertHoursToDaysHoursMinutes({ totalHours }) {
  const [showDaysHoursMinutes, setShowDaysHoursMinutes] = useState(false);

  useEffect(() => {
    setShowDaysHoursMinutes(totalHours >= 24);
  }, [totalHours]);

  return (
    <div>
      {showDaysHoursMinutes ? (
        <div>
          <CountUp end={Math.floor(totalHours / 24)} duration={2} /> 天{" "}
          <CountUp end={Math.floor(totalHours % 24)} duration={2} /> 小时{" "}
          <CountUp end={Math.round((totalHours % 1) * 60)} duration={2} /> 分钟
        </div>
      ) : (
        <div>
          <CountUp end={Math.floor(totalHours)} duration={2} /> 小时{" "}
          <CountUp
            end={Math.round((totalHours - Math.floor(totalHours)) * 60)}
            duration={2}
          />{" "}
          分钟
        </div>
      )}
    </div>
  );
}

export default ConvertHoursToDaysHoursMinutes;
