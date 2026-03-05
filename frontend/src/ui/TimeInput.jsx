import { Col, InputNumber, Row } from "antd";
import { useState } from "react";
import styled from "styled-components";

const StyledSpan = styled.span`
  margin-left: 5;
  font-weight: bold;
`;

function TimeInput({ value, onChange, save }) {
  const [days, setDays] = useState(Math.floor(value / 24));
  const [hours, setHours] = useState(value % 24);

  const handleDaysChange = (days) => {
    setDays(days);
    onChange(days * 24 + hours);
  };

  const handleHoursChange = (hours) => {
    setHours(hours);
    onChange(days * 24 + hours);
  };

  return (
    <Row gutter={8}>
      <Col>
        <InputNumber
          value={days}
          onChange={handleDaysChange}
          style={{ width: "65px", fontWeight: "bold" }}
          min={0}
          max={365}
          onPressEnter={save}
          onBlur={save}
        />
        <StyledSpan style={{ marginLeft: 6 }}>天</StyledSpan>
      </Col>
      <Col>
        <InputNumber
          min={0}
          max={24}
          value={hours}
          onChange={handleHoursChange}
          style={{ width: "60px", fontWeight: "bold" }}
          onPressEnter={save}
          onBlur={save}
        />
        <StyledSpan style={{ marginLeft: 6 }}>小时</StyledSpan>
      </Col>
    </Row>
  );
}

export default TimeInput;
