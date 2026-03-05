import React from "react";
import { useSpring, animated } from "react-spring";

const DotAnimation = ({ start, end, onRest }) => {
  const { x } = useSpring({
    from: { x: 0 },
    to: { x: 1 },
    config: { duration: 800 },
    onRest,
  });

  // 弧线的高度，可以根据需要调整
  const arcHeight = 80;
  // 计算起点和终点的中点
  // const midX = (start.left + end.left) / 2;

  return (
    <animated.div
      style={{
        position: "absolute",
        borderRadius: "50%",
        width: 10,
        height: 10,
        backgroundColor: "var(--color-blue-700)",
        opacity: x.to([0, 1], [1, 0]),
        left: x.to((x) => start.left + (end.left - start.left) * x),
        top: x.to((x) => {
          // 计算当前进度对应的弧线高度
          const peak = 1 - 4 * (x - 0.5) ** 2; // 一个向下开口的抛物线，顶点在x=0.5
          return start.top + (end.top - start.top) * x - arcHeight * peak;
        }),
      }}
    />
  );
};

export default DotAnimation;
