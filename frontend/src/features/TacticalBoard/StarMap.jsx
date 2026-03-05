import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { useGetBoardSystems } from "./useGetBoardSystems";
import { Popover, Select, Button, message } from "antd";
import styled from "styled-components";
import ReactDOM from "react-dom";
import { useGetBoardStarGate } from "./useGetBoardStarGate";
import { useGetBoardConstellations } from "./useGetBoardConstellations";

const StyledContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100vh; /* 使容器高度为视口高度 */
  position: relative;
  overflow: hidden; /* 避免出现滑动条 */
`;

const SearchContainer = styled.div`
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.8);
  padding: 10px;
  border-radius: 5px;
  display: flex;
  gap: 10px;
`;
const StyledSelect = styled(Select)`
  width: 200px;
`;

const getColor = (value) => {
  value = parseFloat(value); // 将值转换为浮点数
  if (value <= 0) {
    return "red";
  } else if (value > 0 && value < 0.1) {
    return "#8C4D3F";
  } else if (value >= 0.1 && value < 0.2) {
    return "#A6634B";
  } else if (value >= 0.2 && value < 0.3) {
    return "#BF6E3F";
  } else if (value >= 0.3 && value < 0.4) {
    return "#BF863F";
  } else if (value >= 0.4 && value < 0.5) {
    return "#D9B95B";
  } else if (value >= 0.5 && value < 0.6) {
    return "#85AA4A";
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

const StarMap = () => {
  const canvasRef = useRef(null);
  const [popoverInfo, setPopoverInfo] = useState({
    visible: false,
    data: null,
    x: 0,
    y: 0,
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [startPoint, setStartPoint] = useState(null);
  const [endPoint, setEndPoint] = useState(null);

  const { boardSystems, isLoading } = useGetBoardSystems();
  const { boardStarGate } = useGetBoardStarGate();
  const { boardConstellations } = useGetBoardConstellations();

  const [currentTransform, setCurrentTransform] = useState(d3.zoomIdentity);

  // 使用 useMemo 优化选项列表的生成
  const options = useMemo(() => {
    return boardSystems
      ?.filter((item) => item.zh_name !== null)
      .map((system) => ({
        value: system.zh_name,
        label: (
          <span>
            {system.zh_name} -{" "}
            <span style={{ color: getColor(system.security_status) }}>
              {system.security_status.toFixed(2)}
            </span>
          </span>
        ),
      }));
  }, [boardSystems]);

  console.log(boardStarGate);

  const drawStarMap = useCallback(
    (stars, stargates, constellations, transform) => {
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = width;
      canvas.height = height;

      const xScale = d3
        .scaleLinear()
        .domain([d3.min(stars, (d) => d.x), d3.max(stars, (d) => d.x)])
        .range([0, width]);
      const yScale = d3
        .scaleLinear()
        .domain([d3.min(stars, (d) => d.z), d3.max(stars, (d) => d.z)])
        .range([height, 0]); // 这里实现上下镜像

      const drawStars = (transform) => {
        context.clearRect(0, 0, width, height);

        context.save();
        context.translate(transform.x, transform.y);
        context.scale(transform.k, transform.k);

        if (transform.k >= 7) {
          // 绘制当前视口范围内的星门链接
          const visibleStargates = stargates?.filter((gate) => {
            const startSystem = stars.find(
              (d) => d.system_id === gate.system_id
            );
            const endSystem = stars.find(
              (d) => d.system_id === gate.destination_system_id
            );

            if (startSystem && endSystem) {
              const startX = xScale(startSystem.x) * transform.k + transform.x;
              const startY = yScale(startSystem.z) * transform.k + transform.y;
              const endX = xScale(endSystem.x) * transform.k + transform.x;
              const endY = yScale(endSystem.z) * transform.k + transform.y;

              return (
                startX >= 0 &&
                startX <= width &&
                startY >= 0 &&
                startY <= height &&
                endX >= 0 &&
                endX <= width &&
                endY >= 0 &&
                endY <= height
              );
            }
            return false;
          });

          visibleStargates?.forEach((gate) => {
            const startSystem = stars.find(
              (d) => d.system_id === gate.system_id
            );
            const endSystem = stars.find(
              (d) => d.system_id === gate.destination_system_id
            );

            if (startSystem && endSystem) {
              context.beginPath();
              context.moveTo(xScale(startSystem.x), yScale(startSystem.z));
              context.lineTo(xScale(endSystem.x), yScale(endSystem.z));
              context.strokeStyle = "rgba(255, 255, 255, 0.2)";
              context.lineWidth = 0.1;
              context.stroke();
            }
          });
        }

        stars.forEach((d) => {
          context.beginPath();
          context.arc(xScale(d.x), yScale(d.z), 0.7, 0, 2 * Math.PI);
          context.fillStyle = getColor(d.security_status);
          context.fill();

          if (startPoint && d.zh_name === startPoint.zh_name) {
            context.beginPath();
            context.arc(xScale(d.x), yScale(d.z), 1.5, 0, 2 * Math.PI);
            context.strokeStyle = "white";
            context.lineWidth = 0.5;
            context.stroke();
          }

          if (endPoint && d.zh_name === endPoint.zh_name) {
            context.beginPath();
            context.arc(xScale(d.x), yScale(d.z), 1.5, 0, 2 * Math.PI);
            context.strokeStyle = "white";
            context.lineWidth = 0.5;
            context.stroke();
          }

          if (transform.k >= 7) {
            context.font = "1.5px sans-serif"; // 设置字体大小为 1px
            context.fillStyle = "rgba(255, 255, 255, 0.7)"; // 设置字体透明度为 0.7
            context.textAlign = "center";
            context.fillText(d.zh_name, xScale(d.x), yScale(d.z) + 3);
          }
        });

        // 绘制星座标签
        constellations.forEach((constellation) => {
          if (transform.k >= 7) {
            context.font = "2px sans-serif"; // 设置字体大小为 2px
            context.fillStyle = "rgba(255, 255, 255, 0.7)"; // 设置字体透明度为 0.7
            context.textAlign = "center";
            context.fillText(
              constellation.zh_name,
              xScale(constellation.x),
              yScale(constellation.z)
            );
          }
        });

        if (startPoint && endPoint) {
          const startX = xScale(startPoint.x);
          const startY = yScale(startPoint.z);

          const endX = xScale(endPoint.x);
          const endY = yScale(endPoint.z);

          // 绘制直线
          context.beginPath();
          context.moveTo(startX, startY);
          context.lineTo(endX, endY);
          context.lineWidth = 0.3; // 设置线条宽度为 1
          context.strokeStyle = "rgba(255, 255, 0)"; // 设置线条颜色为淡黄色
          context.stroke();

          // 计算距离
          const distance = Math.sqrt(
            Math.pow(endPoint.x - startPoint.x, 2) +
              Math.pow(endPoint.y - startPoint.y, 2) +
              Math.pow(endPoint.z - startPoint.z, 2)
          ).toFixed(2);

          const distanceInLightYears = (distance / 9.461e15).toFixed(2);

          // 绘制文本
          context.font = "bold 2px sans-serif"; // 调整字体大小
          context.fillStyle = "white";
          context.textAlign = "center"; // 使文本居中
          context.fillText(
            `距离: ${distanceInLightYears} 光年`,
            (startX + endX) / 2,
            (startY + endY) / 2 - 5
          );
        }

        context.restore();
      };

      const zoom = d3
        .zoom()
        .scaleExtent([1, 10])
        .translateExtent([
          [-200, -200],
          [width + 200, height + 200],
        ])
        .on("zoom", (event) => {
          const transform = event.transform;
          setCurrentTransform(transform);
          drawStars(transform);

          // 隐藏 Popover
          setPopoverInfo((prev) => ({ ...prev, visible: false }));
        });

      d3.select(canvas).call(zoom);
      drawStars(transform); // 使用当前的变换信息绘制星图

      const handleCanvasClick = (event) => {
        const [x, y] = d3
          .zoomTransform(canvas)
          .invert([event.offsetX, event.offsetY]);
        const star = stars.find(
          (d) => Math.abs(xScale(d.x) - x) < 2 && Math.abs(yScale(d.z) - y) < 2
        );

        if (star) {
          // 将星系的坐标转换为画布上的坐标
          const starX = xScale(star.x);
          const starY = yScale(star.z);
          const transform = d3.zoomTransform(canvas);
          const adjustedX = starX * transform.k + transform.x;
          const adjustedY = starY * transform.k + transform.y + 50;

          setPopoverInfo({
            visible: true,
            data: star,
            x: adjustedX,
            y: adjustedY,
          });
        }
      };

      canvas.removeEventListener("click", handleCanvasClick);
      canvas.addEventListener("click", handleCanvasClick);

      const searchAndZoom = (searchTerm) => {
        const star = stars.find(
          (d) => d.zh_name?.toLowerCase() === searchTerm.toLowerCase()
        );
        if (star) {
          const [x, y] = [xScale(star.x), yScale(star.z)];
          const scale = 8;
          const transform = d3.zoomIdentity
            .translate(width / 2 - x * scale, height / 2 - y * scale)
            .scale(scale);

          // 添加过渡效果
          d3.select(canvas)
            .transition()
            .duration(1000) // 动画持续时间
            .call(zoom.transform, transform)
            .on("end", () => {
              // 计算调整后的 Popover 位置
              const adjustedX = x * scale + transform.x;
              const adjustedY = y * scale + transform.y + 50;
              setPopoverInfo({
                visible: true,
                data: star,
                x: adjustedX,
                y: adjustedY,
              });
            });
        }
      };

      const handleSearch = () => {
        searchAndZoom(searchTerm);
      };

      return handleSearch;
    },
    [startPoint, endPoint, searchTerm]
  );

  useEffect(() => {
    if (
      boardSystems?.length > 0 &&
      boardConstellations?.length > 0 &&
      canvasRef.current
    ) {
      const handleSearch = drawStarMap(
        boardSystems,
        boardStarGate,
        boardConstellations,
        currentTransform
      );
      window.addEventListener("resize", handleSearch);
      return () => window.removeEventListener("resize", handleSearch);
    }
  }, [
    boardSystems,
    boardStarGate,
    boardConstellations,
    currentTransform,
    drawStarMap,
  ]);

  useEffect(() => {
    if (startPoint || endPoint) {
      drawStarMap(
        boardSystems,
        boardStarGate,
        boardConstellations,
        currentTransform
      );
    }
  }, [
    startPoint,
    endPoint,
    boardSystems,
    boardStarGate,
    boardConstellations,
    currentTransform,
    drawStarMap,
  ]);

  const handleSearch = () => {
    if (!searchTerm) {
      message.warning("请输入星系");
      return;
    }

    const star = boardSystems.find(
      (d) => d.zh_name?.toLowerCase() === searchTerm.toLowerCase()
    );
    if (!star) {
      message.warning("未找到该星系");
      return;
    }
    const searchHandler = drawStarMap(
      boardSystems,
      boardStarGate,
      boardConstellations,
      currentTransform
    );
    searchHandler();
  };

  const handleSetStartPoint = () => {
    setStartPoint(popoverInfo.data);
    setPopoverInfo((prev) => ({ ...prev, visible: false }));
  };

  const handleSetEndPoint = () => {
    setEndPoint(popoverInfo.data);
    setPopoverInfo((prev) => ({ ...prev, visible: false }));
  };

  return (
    <StyledContainer>
      <SearchContainer>
        <StyledSelect
          options={options}
          value={searchTerm}
          onChange={(value) => setSearchTerm(value)}
          placeholder="请选择星系"
          showSearch
          loading={isLoading}
          filterOption={(input, option) => {
            const zhName = option.label.props.children[0];
            return zhName?.toLowerCase().includes(input.toLowerCase());
          }}
        />
        <Button onClick={handleSearch} disabled={isLoading} type="primary">
          搜索
        </Button>
      </SearchContainer>
      <canvas
        ref={canvasRef}
        style={{
          background: "black",
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />

      {popoverInfo.visible &&
        ReactDOM.createPortal(
          <Popover
            content={
              <div>
                <p>星系: {popoverInfo.data.zh_name}</p>
                <p>
                  星系安等:{" "}
                  <span
                    style={{
                      color: getColor(popoverInfo.data.security_status),
                    }}
                  >
                    {popoverInfo.data.security_status.toFixed(2)}
                  </span>
                </p>
                <Button onClick={handleSetStartPoint}>设置起点</Button>
                <Button onClick={handleSetEndPoint}>设置终点</Button>
              </div>
            }
            title="Star System Info"
            open={popoverInfo.visible}
            onOpenChange={(open) =>
              setPopoverInfo((prev) => ({ ...prev, visible: open }))
            }
            trigger="click"
            getPopupContainer={() => document.body} // 确保 popover 在 body 上渲染
          >
            <div
              style={{
                position: "absolute",
                left: popoverInfo.x,
                top: popoverInfo.y,
                width: 0,
                height: 0,
              }}
            ></div>
          </Popover>,
          document.body
        )}
    </StyledContainer>
  );
};

export default StarMap;
