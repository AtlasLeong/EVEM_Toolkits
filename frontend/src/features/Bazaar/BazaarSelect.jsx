import { Select, DatePicker } from "antd";
import styled from "styled-components";
import { useBazaarNameList } from "./useBazaarNameList";
import useBazaarDate from "./useBazaarDate";
import { useEffect } from "react";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
dayjs.extend(customParseFormat);
const dateFormat = "YYYY-MM-DD";
const SelectContainer = styled.div`
  display: flex;
  background-color: #fff;
  gap: 100px;
  justify-content: center;
  align-items: center;
  height: 80px;
  border-radius: 5px;
`;

const StyledSelecter = styled.div`
  display: flex;
  font-size: 20px;
  align-items: center;
  justify-content: center;
  white-space: pre; /* 保留空格 */
`;

function BazaarSelect({
  setBazaarName,
  setServer,
  bazaarName,
  server,
  selectDate,
  setSelectDate,
}) {
  const { isLoading, bazaarNameList } = useBazaarNameList();
  const { mutate, data: bazaarDate } = useBazaarDate();

  useEffect(() => {
    // 确保 server 和 bazaarName 都有值再发起请求
    setSelectDate(null);
    if (server && bazaarName) {
      mutate({ bazaarName: bazaarName, server: server });
    }
  }, [server, bazaarName, mutate, setSelectDate]);

  return (
    <SelectContainer>
      <StyledSelecter>
        泛星集市:{" "}
        <Select
          style={{ width: "200px" }}
          loading={isLoading}
          options={bazaarNameList}
          defaultValue={bazaarName}
          onChange={(name) => setBazaarName(name)}
        ></Select>
      </StyledSelecter>
      <StyledSelecter>
        服务器:{" "}
        <Select
          style={{ width: "150px" }}
          defaultValue={server}
          options={[
            {
              value: "china",
              label: "国服",
            },
            {
              value: "world",
              label: "国际服",
            },
          ]}
          onChange={(server) => setServer(server)}
        />
      </StyledSelecter>
      <StyledSelecter>
        日期:{" "}
        <DatePicker
          style={{ width: "200px" }}
          disabled={!bazaarName || !server}
          minDate={dayjs(bazaarDate?.min_date, dateFormat)}
          maxDate={dayjs(bazaarDate?.max_date, dateFormat)}
          value={selectDate}
          onChange={(date) => setSelectDate(date)}
        ></DatePicker>
      </StyledSelecter>
    </SelectContainer>
  );
}

export default BazaarSelect;
