import styled from "styled-components";

const WarningSpan = styled.span`
  color: var(--color-red-700);
  font-weight: bold;
`;

const GreatSpan = styled.span`
  color: #1e8b1e;
  font-weight: bold;
`;

const BlueSpan = styled.span`
  color: var(--color-blue-700);
  font-weight: bold;
`;

function TipForUse() {
  return (
    <ul>
      <h3>·行星资源搜索允许只输入 星域 或 行星资源，将会触发以下不同的查询</h3>
      <li>
        <WarningSpan>1、行星资源、地点不为空: </WarningSpan>
        正常按选择的星图地点查询行星资源
      </li>
      <li>
        <WarningSpan>2、行星资源为空、地点不为空：</WarningSpan>
        查询该星图地点下所有种类行星资源<GreatSpan> 前三 </GreatSpan>的地点
      </li>
      <li>
        <WarningSpan>3、行星资源不为空、地点为空：</WarningSpan>
        显示每个星域中该行星资源产出<GreatSpan> 最高 </GreatSpan>的地点
      </li>
      <h3>·可通过表格选择列，选择对应的行星资源加入到计算其中</h3>
      <li>
        计算器中可自由调整各行星资源的 <BlueSpan>阵列数量</BlueSpan>、
        <BlueSpan> 计算时间</BlueSpan>、
        <BlueSpan> 行星菜单价（可使用预设值）</BlueSpan>
      </li>
      <ul style={{ whiteSpace: "pre", paddingBottom: "4px" }}>
        计算器将计算：
        <li>
          {"    "}
          <span style={{ fontSize: "10px", fontWeight: "bold" }}>· </span>
          个堡燃料收入消耗是否平衡
        </li>
        <li>
          {"    "}
          <span style={{ fontSize: "10px", fontWeight: "bold" }}>· </span>
          当前个堡的行星资源产出数量（可在 <WarningSpan>用户设置 </WarningSpan>
          中修改预设单价查看产出总价）
        </li>
        <li>
          {"    "}
          <span style={{ fontSize: "10px", fontWeight: "bold" }}>· </span>
          何时达到阵列存储上限
        </li>
      </ul>
    </ul>
  );
}

export default TipForUse;
