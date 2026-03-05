import styled from "styled-components";
const RegionLevelSpan = styled.span`
  color: ${(props) => {
    const getColor = (value) => {
      value = parseFloat(value); // 将值转换为浮点数
      if (value <= 0) {
        return "red";
      } else if (value > 0 && value < 0.1) {
        return "#8C4D3F"; // Red
      } else if (value >= 0.1 && value < 0.2) {
        return "#A6634B";
      } else if (value >= 0.2 && value < 0.3) {
        return "#BF6E3F";
      } else if (value >= 0.3 && value < 0.4) {
        return "#BF863F";
      } else if (value >= 0.4 && value < 0.5) {
        return "#D9B95B";
      } else if (value >= 0.5 && value < 0.6) {
        return "#85AA4A"; // Yellow
      } else if (value >= 0.6 && value < 0.7) {
        return "#70C341";
      } else if (value >= 0.7 && value < 0.8) {
        return "#58A65D";
      } else if (value >= 0.8 && value < 0.9) {
        return "#8FD9BE";
      } else if (value >= 0.9 && value <= 1) {
        return "#79CFD9";
      }
    };

    return getColor(props.security);
  }};
  font-weight: bold;
  white-space: pre;
`;

export default RegionLevelSpan;
