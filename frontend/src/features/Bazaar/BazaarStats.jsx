import styled from "styled-components";
import { useBazaarInfo } from "./useBazaarInfo";
import CountUp from "react-countup";
import SpinnerMini from "../../ui/SpinnerMini";

const Container = styled.div`
  display: flex;
  justify-content: space-around; /* 将卡片横向均匀分布 */
  align-items: center;
`;

const Card = styled.div`
  background-color: white;
  border-radius: 8px;

  text-align: center;
  width: 150px;
  height: 80%;
`;

const Title = styled.h3`
  margin: 0;
  font-size: 14px;
  color: #666;
`;

const Value = styled.p`
  margin: 10px 0;
  font-size: 24px;
  color: #333;
`;

const Percentage = styled.div`
  font-size: 12px;
  color: #999;

  &.up {
    color: red;
  }

  &.down {
    color: green;
  }
`;

function formatDate(dateString) {
  if (!dateString) return undefined;
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0"); // 月份从0开始，所以加1
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function BazaarStats({ bazaarName, server, selectDate }) {
  const formattedDate = formatDate(selectDate);
  const { isLoading, bazaarInfo } = useBazaarInfo({
    bazaarName,
    server,
    selectDate: formattedDate,
  });

  return (
    <Container>
      <Card>
        <Title>第 5 名分数线</Title>
        <Value>
          {isLoading ? (
            <SpinnerMini />
          ) : (
            <CountUp
              end={bazaarInfo?.rank_5 || 0}
              decimals={0}
              duration={0.5}
            />
          )}
        </Value>
        <Percentage
          className={`${bazaarInfo?.pre_rank_diff_5 > 0 ? "up" : "down"}`}
        >
          同比上一日 {bazaarInfo?.pre_rank_diff_5 || 0}{" "}
          {`${bazaarInfo?.pre_rank_diff_5 > 0 ? "▲" : "▼"}`}
        </Percentage>
      </Card>
      <Card>
        <Title>第 20 名分数线</Title>
        <Value>
          {isLoading ? (
            <SpinnerMini />
          ) : (
            <CountUp
              end={bazaarInfo?.rank_20 || 0}
              decimals={0}
              duration={0.5}
            />
          )}
        </Value>
        <Percentage
          className={`${bazaarInfo?.pre_rank_diff_20 > 0 ? "up" : "down"}`}
        >
          同比上一日 {bazaarInfo?.pre_rank_diff_20 || 0}{" "}
          {`${bazaarInfo?.pre_rank_diff_20 > 0 ? "▲" : "▼"}`}
        </Percentage>
      </Card>
      <Card>
        <Title>第 50 名分数线</Title>
        <Value>
          {isLoading ? (
            <SpinnerMini />
          ) : (
            <CountUp
              end={bazaarInfo?.rank_50 || 0}
              decimals={0}
              duration={0.5}
            />
          )}
        </Value>
        <Percentage
          className={`${bazaarInfo?.pre_rank_diff_50 > 0 ? "up" : "down"}`}
        >
          同比上一日 {bazaarInfo?.pre_rank_diff_50 || 0}{" "}
          {`${bazaarInfo?.pre_rank_diff_50 > 0 ? "▲" : "▼"}`}
        </Percentage>
      </Card>
      <Card>
        <Title>{bazaarName}第5名平均分</Title>
        <Value>
          <CountUp
            end={bazaarInfo?.average_score_5 || 0}
            decimals={0}
            duration={0.5}
          />
        </Value>
      </Card>
      <Card>
        <Title>{bazaarName}第20名平均分</Title>
        <Value>
          <CountUp
            end={bazaarInfo?.average_score_20 || 0}
            decimals={0}
            duration={0.5}
          />
        </Value>
      </Card>
    </Container>
  );
}

export default BazaarStats;
