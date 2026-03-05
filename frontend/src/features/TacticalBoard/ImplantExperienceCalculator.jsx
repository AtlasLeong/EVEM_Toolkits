import { useEffect, useState } from "react";
import { Button, Picker } from "antd-mobile";
import {
  Col,
  Form,
  Image,
  Input,
  InputNumber,
  message,
  Row,
  Space,
  Table,
} from "antd";
import styled from "styled-components";

const StyledForm = styled(Form)`
  input {
    font-size: 16px !important;
  }

  .ant-form-item {
    margin-bottom: 12px;
  }

  .ant-form-item-label > label {
    font-size: 16px;
  }
`;

const StyledTable = styled(Table)`
  margin-bottom: 40px;
`;

const ResultRow = styled(Row)`
  margin-bottom: 16px;
  align-items: center;
`;

const experienceData = {
  1: { total: 0, required: 950 },
  2: { total: 950, required: 1900 },
  3: { total: 2850, required: 2900 },
  4: { total: 5750, required: 4000 },
  5: { total: 9750, required: 7000 },
  6: { total: 16750, required: 8500 },
  7: { total: 25250, required: 10000 },
  8: { total: 35250, required: 11000 },
  9: { total: 46250, required: 13000 },
  10: { total: 59250, required: 10000 },
  11: { total: 69250, required: 12000 },
  12: { total: 81250, required: 14000 },
  13: { total: 95250, required: 16000 },
  14: { total: 111250, required: 18000 },
  15: { total: 129250, required: 27000 },
  16: { total: 156250, required: 31000 },
  17: { total: 187250, required: 34000 },
  18: { total: 221250, required: 37000 },
  19: { total: 258250, required: 41000 },
  20: { total: 299250, required: 62000 },
  21: { total: 361250, required: 67000 },
  22: { total: 428250, required: 72000 },
  23: { total: 500250, required: 78000 },
  24: { total: 578250, required: 84000 },
  25: { total: 662250, required: 120000 },
  26: { total: 782250, required: 130000 },
  27: { total: 912250, required: 140000 },
  28: { total: 1052250, required: 150000 },
  29: { total: 1202250, required: 160000 },
  30: { total: 1362250, required: 230000 },
  31: { total: 1592250, required: 250000 },
  32: { total: 1842250, required: 260000 },
  33: { total: 2102250, required: 270000 },
  34: { total: 2372250, required: 290000 },
  35: { total: 2662250, required: 410000 },
  36: { total: 3072250, required: 430000 },
  37: { total: 3502250, required: 450000 },
  38: { total: 3952250, required: 470000 },
  39: { total: 4422250, required: 490000 },
  40: { total: 4912250, required: 690000 },
  41: { total: 5602250, required: 720000 },
  42: { total: 6322250, required: 750000 },
  43: { total: 7072250, required: 780000 },
  44: { total: 7852250, required: 810000 },
  45: { total: 8662250, required: 0 }, // 45级不需要再升级
};

const experienceBottles = [
  {
    name: "爬虫神经编程器",
    minLevel: 1,
    maxLevel: 9,
    exp: 100,
    img: "programmer/pachong.png",
  },
  {
    name: "深度神经编程器",
    minLevel: 10,
    maxLevel: 24,
    exp: 500,
    img: "programmer/shendu.png",
  },
  {
    name: "新伦神经编程器",
    minLevel: 25,
    maxLevel: 39,
    exp: 1000,
    img: "programmer/xinlun.png",
  },
  {
    name: "超越神经编程器",
    minLevel: 40,
    maxLevel: 45,
    exp: 2000,
    img: "programmer/chaoyue.png",
  },
];

const levelOptions = Object.keys(experienceData).map((level) => ({
  label: `等级 ${level}`,
  value: level,
}));

function ImplantExperienceCalculator() {
  const [form] = Form.useForm();
  const [result, setResult] = useState("");
  const [bestPlan, setBestPlan] = useState([]);
  const [maxCurrentExp, setMaxCurrentExp] = useState(0);
  const [isCurrentLevelSelected, setIsCurrentLevelSelected] = useState(false);

  const handleCurrentLevelSelect = async () => {
    const value = await Picker.prompt({
      columns: [levelOptions],
    });
    if (value) {
      const level = parseInt(value[0]);
      form.setFieldsValue({ currentLevel: `等级 ${level}` });
      setMaxCurrentExp(experienceData[level].required - 1);
      form.setFieldsValue({ currentExp: 0 }); // 重置当前经验值
      setIsCurrentLevelSelected(true);
    }
  };

  // 监听当前等级的变化
  useEffect(() => {
    const currentLevel = form.getFieldValue("currentLevel");
    if (currentLevel) {
      const level = parseInt(currentLevel.split(" ")[1]);
      setMaxCurrentExp(experienceData[level].required - 1);
      setIsCurrentLevelSelected(true);
    } else {
      setIsCurrentLevelSelected(false);
    }
  }, [form.getFieldValue("currentLevel")]);

  const handleTargetLevelSelect = async () => {
    const currentLevel = form.getFieldValue("currentLevel");
    if (!currentLevel) {
      message.warning("请先选择当前等级");
      return;
    }
    const currentLevelNumber = parseInt(currentLevel.split(" ")[1]);
    const targetOptions = levelOptions.filter(
      (option) => parseInt(option.value) > currentLevelNumber
    );
    const value = await Picker.prompt({
      columns: [targetOptions],
    });
    if (value) {
      form.setFieldsValue({ targetLevel: `等级 ${value[0]}` });
    }
  };

  const calculateExperience = () => {
    const values = form.getFieldsValue();
    const { currentLevel, currentExp, targetLevel } = values;

    if (!currentLevel || !targetLevel) {
      message.warning("请选择当前等级和目标等级");
      return;
    }

    const currentLevelNumber = parseInt(currentLevel.split(" ")[1]);
    const targetLevelNumber = parseInt(targetLevel.split(" ")[1]);

    const currentLevelTotalExp = experienceData[currentLevelNumber].total;
    const targetLevelTotalExp = experienceData[targetLevelNumber].total;
    const currentExpInt = parseInt(currentExp) || 0;

    const neededExp =
      targetLevelTotalExp - currentLevelTotalExp - currentExpInt;

    setResult(`还需要 ${neededExp} 经验值`);
    calculateBestPlan(currentLevelNumber, targetLevelNumber, neededExp);
  };

  const calculateBestPlan = (currentLevel, targetLevel, neededExp) => {
    let plan = {};
    let remainingExp = neededExp;

    for (let level = currentLevel; level < targetLevel; level++) {
      const applicableBottles = experienceBottles.filter(
        (bottle) => level >= bottle.minLevel && level <= bottle.maxLevel
      );

      if (applicableBottles.length > 0) {
        const bottle = applicableBottles[0];
        let expToNextLevel = experienceData[level].required;

        const expNeeded = Math.min(expToNextLevel, remainingExp);
        const bottlesNeeded = Math.ceil(expNeeded / bottle.exp);

        if (!plan[bottle.name]) {
          plan[bottle.name] = {
            key: bottle.name,
            bottleName: bottle.name,
            bottleImg: bottle.img,
            bottleCount: 0,
            expGained: 0,
          };
        }
        const actualExpGained = Math.min(bottlesNeeded * bottle.exp, expNeeded);
        plan[bottle.name].bottleCount += bottlesNeeded;
        plan[bottle.name].expGained += actualExpGained;

        remainingExp -= actualExpGained;
      }

      if (remainingExp <= 0) break;
    }

    setBestPlan(Object.values(plan));
  };

  const handleClear = () => {
    form.resetFields();
    setResult("");
    setBestPlan([]);
  };

  const columns = [
    {
      title: "经验瓶",
      dataIndex: "bottleName",
      key: "bottleName",
      render: (text, record) => (
        <Space>
          <Image src={record.bottleImg} alt={text} width={30} preview={false} />
          {text}
        </Space>
      ),
    },
    { title: "数量", dataIndex: "bottleCount", key: "bottleCount" },
    { title: "获得经验", dataIndex: "expGained", key: "expGained" },
  ];

  return (
    <StyledForm form={form} layout="vertical">
      <Form.Item label="当前等级" name="currentLevel">
        <Input
          readOnly
          onClick={handleCurrentLevelSelect}
          placeholder="选择当前等级"
        />
      </Form.Item>
      <Form.Item label="当前等级经验值" name="currentExp">
        <InputNumber
          min={0}
          max={maxCurrentExp}
          disabled={!isCurrentLevelSelected}
          placeholder="输入当前经验值"
          style={{ width: "100%" }}
        />
      </Form.Item>
      <Form.Item label="目标等级" name="targetLevel">
        <Input
          readOnly
          onClick={handleTargetLevelSelect}
          placeholder="选择目标等级"
        />
      </Form.Item>
      <Form.Item>
        <Space>
          <Button color="primary" onClick={calculateExperience}>
            计算
          </Button>
          <Button
            onClick={handleClear}
            style={{
              backgroundColor: "var(--color-red-100)",
              color: "var(--color-red-700)",
            }}
          >
            清除
          </Button>
        </Space>
      </Form.Item>

      {bestPlan.length > 0 && (
        <Form.Item>
          <ResultRow>
            <Col span={12}>
              <h3>最佳使用方案：</h3>
            </Col>
            <Col span={12}>{result && <div>{result}</div>}</Col>
          </ResultRow>
          <StyledTable
            columns={columns}
            dataSource={bestPlan}
            pagination={false}
          />
        </Form.Item>
      )}
    </StyledForm>
  );
}

export default ImplantExperienceCalculator;
