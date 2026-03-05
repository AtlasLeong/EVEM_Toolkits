// 获取颜色的方法，根据安全状态返回不同的颜色
export const getColor = (value) => {
  value = parseFloat(value).toFixed(1);
  if (value <= 0) {
    return 0xff0000;
  } else if (value > 0 && value < 0.1) {
    return 0x8c4d3f;
  } else if (value >= 0.1 && value < 0.2) {
    return 0xa6634b;
  } else if (value >= 0.2 && value < 0.3) {
    return 0xbf6e3f;
  } else if (value >= 0.3 && value < 0.4) {
    return 0xbf863f;
  } else if (value >= 0.4 && value < 0.5) {
    return 0xd9b95b;
  } else if (value >= 0.5 && value < 0.6) {
    return 0x85aa4a;
  } else if (value >= 0.6 && value < 0.7) {
    return 0x70c341;
  } else if (value >= 0.7 && value < 0.8) {
    return 0x58a65d;
  } else if (value >= 0.8 && value < 0.9) {
    return 0x8fd9be;
  } else if (value >= 0.9 && value <= 1) {
    return 0x79cfd9;
  }
};
