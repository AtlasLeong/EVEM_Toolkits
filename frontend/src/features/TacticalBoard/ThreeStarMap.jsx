import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as d3 from "d3";
import * as PIXI from "pixi.js";
import { useGetBoardSystems } from "./useGetBoardSystems";
import { useGetBoardStarGate } from "./useGetBoardStarGate";
import { Button, Popover } from "antd";
import { get16Color } from "./get16Color";
import SearchBox from "./SearchBox";
import { getColor } from "./getColor";
import { useGetBoardConstellations } from "./useGetBoardConstellations";
import { useGetBoardRegions } from "./useGetBoardRegions";
import Spinner from "../../ui/Spinner";
import styled from "styled-components";

const StyledDiv = styled.div`
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
`;

// 辅助函数：计算平均值
function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function TwoDStarMap() {
  // 获取系统和星门的数据
  const { boardSystems, isLoading: systemsLoading } = useGetBoardSystems();
  const { boardStarGate, isLoading: starGateLoading } = useGetBoardStarGate();
  const { boardConstellations, isLoading: constellationLoading } =
    useGetBoardConstellations();
  const { boardRegions, isLoading: regionsLoading } = useGetBoardRegions();

  const isDataLoading =
    systemsLoading || starGateLoading || constellationLoading || regionsLoading;

  // 创建ref来存储PIXI的容器、应用、图形、标签和星门
  const pixiContainer = useRef(null);
  const pixiApp = useRef(null);
  const pixiGraphics = useRef(null);
  const pixiLabels = useRef([]);
  const pixiStarGates = useRef([]);
  const pixiConstellationLabels = useRef([]);
  const pixiRegionLabels = useRef([]);

  // 存储当前的缩放和平移状态
  const currentTransform = useRef(d3.zoomIdentity);

  // 存储d3的缩放行为
  const zoomBehavior = useRef(null);
  // 使用state来存储线模式
  const [lineMode, setLineMode] = useState("Single induction");

  // 使用state来存储弹出框信息
  const [popoverInfo, setPopoverInfo] = useState({
    open: false,
    data: null,
    x: 0,
    y: 0,
  });

  // 使用state来存储起点和终点系统
  // 将单个起点和终点改为数组
  const [startSystems, setStartSystems] = useState([]);
  const [endSystems, setEndSystems] = useState([]);
  const [distanceLines, setDistanceLines] = useState([]);
  const [distanceTexts, setDistanceTexts] = useState([]);
  const [startCircles, setStartCircles] = useState([]);
  const [endCircles, setEndCircles] = useState([]);
  const [isSelectingEnd, setIsSelectingEnd] = useState(false);
  const [selectionState, setSelectionState] = useState("start"); // 'start' or 'end'

  const [pathData, setPathData] = useState(null);

  const [customPaths, setCustomPaths] = useState([]);

  const [shouldTriggerLineModeEffect, setShouldTriggerLineModeEffect] =
    useState(true);

  const [inductionPaths, setInductionPaths] = useState([]);

  const [isOnlyClearJumpPath, setIsOnlyClearJumpPath] = useState(false);

  const handleRemoveInductionGroup = (startSystem, endSystem) => {

    if (lineMode === "Single induction") {
      // 单选模式：移除所有自定义路径和图形元素

      setCustomPaths([]);
      setStartSystems([]);
      setEndSystems([]);

      if (pixiGraphics.current) {
        pixiGraphics.current.children = pixiGraphics.current.children.filter(
          (child) => {
            const shouldRemove =
              child.isCustom || child.isStartMarker || child.isEndMarker;
            if (shouldRemove) {
            }
            return !shouldRemove;
          }
        );
      }

      setDistanceLines((prevLines) =>
        prevLines.filter((line) => !line.isCustom)
      );
      setDistanceTexts((prevTexts) =>
        prevTexts.filter((text) => !text.isCustom)
      );
    } else {
      // 多选模式：移除特定的诱导组

      // 检查是否为自定义路线
      const customPathIndex = customPaths.findIndex(
        (path) =>
          path.start.system_id === startSystem.system_id &&
          path.end.system_id === endSystem.system_id
      );


      if (customPathIndex !== -1) {
        // 删除自定义路线
        // 多选模式：只删除特定的路径
        setStartSystems((prevSystems) =>
          prevSystems.filter(
            (sys, index) =>
              !(
                sys.system_id === startSystem.system_id &&
                endSystems[index].system_id === endSystem.system_id
              )
          )
        );
        setEndSystems((prevSystems) =>
          prevSystems.filter(
            (sys, index) =>
              !(
                startSystems[index].system_id === startSystem.system_id &&
                sys.system_id === endSystem.system_id
              )
          )
        );

        // 更新 customPaths（如果有的话）
        setCustomPaths((prevPaths) =>
          prevPaths.filter(
            (path) =>
              !(
                path.start.system_id === startSystem.system_id &&
                path.end.system_id === endSystem.system_id
              )
          )
        );

        // 检查是否还有其他路径使用这些星系作为起点或终点
        const isStartStillUsed = startSystems.some(
          (sys, index) =>
            sys.system_id === startSystem.system_id &&
            endSystems[index].system_id !== endSystem.system_id
        );
        const isEndStillUsed = endSystems.some(
          (sys, index) =>
            sys.system_id === endSystem.system_id &&
            startSystems[index].system_id !== startSystem.system_id
        );

        // 从图形中移除相关元素，但保留仍在使用的起点和终点圆圈
        if (pixiGraphics.current) {
          pixiGraphics.current.children = pixiGraphics.current.children.filter(
            (child) =>
              !(
                child.startSystemId === startSystem.system_id &&
                child.endSystemId === endSystem.system_id
              ) &&
              (isStartStillUsed ||
                child.systemId !== startSystem.system_id ||
                !child.isStartMarker) &&
              (isEndStillUsed ||
                child.systemId !== endSystem.system_id ||
                !child.isEndMarker)
          );
        }

        // 更新 distanceLines 和 distanceTexts
        setDistanceLines((prevLines) =>
          prevLines.filter(
            (line) =>
              !(
                line.startSystemId === startSystem.system_id &&
                line.endSystemId === endSystem.system_id
              )
          )
        );
        setDistanceTexts((prevTexts) =>
          prevTexts.filter(
            (text) =>
              !(
                text.startSystemId === startSystem.system_id &&
                text.endSystemId === endSystem.system_id
              )
          )
        );

        // 只有在起点或终点不再被使用时才从 startCircles 和 endCircles 中移除
        if (!isStartStillUsed) {
          setStartCircles((prevCircles) =>
            prevCircles.filter(
              (circle) => circle.systemId !== startSystem.system_id
            )
          );
        }
        if (!isEndStillUsed) {
          setEndCircles((prevCircles) =>
            prevCircles.filter(
              (circle) => circle.systemId !== endSystem.system_id
            )
          );
        }

      } else {
        // 处理 API 获取的诱导路径的删除逻辑

        // 找到要删除的路径的起始和结束索引
        let startIndex = -1;
        let endIndex = -1;

        for (let i = 0; i < pathData.length; i++) {
          if (pathData[i].start.system_id === startSystem.system_id) {
            startIndex = i;
          }
          if (pathData[i].end.system_id === endSystem.system_id) {
            endIndex = i;
            break;
          }
        }


        if (startIndex === -1 || endIndex === -1) {
          console.error("未找到要删除的路线");
          return;
        }

        // 获取要删除的路径段
        const pathToRemove = pathData.slice(startIndex, endIndex + 1);


        // 设置只清除诱导路线
        setIsOnlyClearJumpPath(true);
        // 更新状态
        setPathData((prevData) =>
          prevData.filter((_, index) => index < startIndex || index > endIndex)
        );

        // 从星图上移除对应的图形元素
        if (pixiGraphics.current) {
          pathToRemove.forEach((segment, index) => {
            // 移除线段
            const lineToRemove = pixiGraphics.current.children.find(
              (child) =>
                child.startSystemId === segment.start.system_id &&
                child.endSystemId === segment.end.system_id
            );
            if (lineToRemove) {
              pixiGraphics.current.removeChild(lineToRemove);
            }

            // 移除中间点的标记
            if (index > 0 && index < pathToRemove.length - 1) {
              const markerToRemove = pixiGraphics.current.children.find(
                (child) => child.systemId === segment.start.system_id
              );
              if (markerToRemove) {
                pixiGraphics.current.removeChild(markerToRemove);
              }
            }

            // 移除距离文本
            const textToRemove = pixiGraphics.current.children.find(
              (child) =>
                child.startSystemId === segment.start.system_id &&
                child.endSystemId === segment.end.system_id &&
                child.isDistanceText
            );
            if (textToRemove) {
              pixiGraphics.current.removeChild(textToRemove);
            }
          });

          // 移除起点和终点标记
          const startMarkerToRemove = pixiGraphics.current.children.find(
            (child) =>
              child.systemId === startSystem.system_id &&
              child.isStartMarker &&
              child.isInductionPath
          );
          if (startMarkerToRemove) {
            pixiGraphics.current.removeChild(startMarkerToRemove);
          }

          const endMarkerToRemove = pixiGraphics.current.children.find(
            (child) =>
              child.systemId === endSystem.system_id && child.isEndMarker
          );
          if (endMarkerToRemove) {
            pixiGraphics.current.removeChild(endMarkerToRemove);
          }
        }

      }
    }

  };
  // 使用useMemo来缓存搜索选项
  const options = useMemo(() => {
    return boardSystems
      ?.filter((item) => item.zh_name !== null)
      .map((system) => ({
        value: system.zh_name,
        label: (
          <span>
            {system.zh_name} -{" "}
            <span style={{ color: get16Color(system.security_status) }}>
              {system.security_status.toFixed(1)}
            </span>
          </span>
        ),
      }));
  }, [boardSystems]);

  // 使用useEffect来初始化PIXI应用和绘制图形
  useEffect(() => {
    if (
      systemsLoading ||
      starGateLoading ||
      constellationLoading ||
      regionsLoading ||
      !boardSystems ||
      !boardStarGate ||
      !boardConstellations ||
      !boardRegions
    )
      return;

    // 初始化PIXI应用
    if (!pixiApp.current) {
      pixiApp.current = new PIXI.Application({
        width: window.innerWidth,
        height: window.innerHeight,
        antialias: true,
        resolution: window.devicePixelRatio, // 设置分辨率为设备像素比
        autoDensity: true, // 自动密度管理
      });
      pixiContainer.current.appendChild(pixiApp.current.view);
    }

    const app = pixiApp.current;

    // 清理之前的图形
    if (pixiGraphics.current) {
      app.stage.removeChild(pixiGraphics.current);
      pixiGraphics.current.destroy();
    }

    pixiLabels.current.forEach((label) => app.stage.removeChild(label));
    pixiStarGates.current.forEach((stargate) =>
      app.stage.removeChild(stargate)
    );
    pixiLabels.current = [];
    pixiStarGates.current = [];

    // 创建一个新的容器来存储图形
    const container = new PIXI.Container();
    pixiGraphics.current = container;

    // 创建比例尺来将系统坐标映射到屏幕坐标
    const xScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.x))
      .range([50, window.innerWidth - 50]);
    const zScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.z))
      .range([window.innerHeight - 50, 50]);

    // 计算星域的平均坐标
    const regionCoordinates = {};
    boardConstellations.forEach((constellation) => {
      if (!regionCoordinates[constellation.region_id]) {
        regionCoordinates[constellation.region_id] = {
          x: [],
          y: [],
          z: [],
        };
      }
      regionCoordinates[constellation.region_id].x.push(constellation.x);
      regionCoordinates[constellation.region_id].y.push(constellation.y);
      regionCoordinates[constellation.region_id].z.push(constellation.z);
    });

    const regionAverageCoordinates = Object.keys(regionCoordinates).reduce(
      (acc, regionId) => {
        acc[regionId] = {
          x: average(regionCoordinates[regionId].x),
          y: average(regionCoordinates[regionId].y),
          z: average(regionCoordinates[regionId].z),
        };
        return acc;
      },
      {}
    );

    // 创建星域标签
    boardRegions.forEach((region) => {
      const avgCoords = regionAverageCoordinates[region.region_id];
      if (!avgCoords) return;

      const scaledX = xScale(avgCoords.x);
      const scaledZ = zScale(avgCoords.z);

      const labelContainer = new PIXI.Container();
      labelContainer.position.set(scaledX, scaledZ);
      labelContainer.visible = true; // 初始状态下显示标签

      const label = new PIXI.Text(region.zh_name, {
        fontFamily: "Helvetica",
        fontSize: 14,
        fill: 0xffffff, // 白色
        align: "center",
      });
      label.anchor.set(0.5);
      labelContainer.addChild(label);

      container.addChild(labelContainer);
      pixiRegionLabels.current.push(labelContainer);
    });

    // 创建星座标签
    boardConstellations.forEach((constellation) => {
      const { x, y, z, zh_name } = constellation;
      const scaledX = xScale(x);
      const scaledZ = zScale(z);

      // 创建一个容器来包含背景和文本
      const labelContainer = new PIXI.Container();
      labelContainer.position.set(scaledX, scaledZ);
      labelContainer.visible = false; // 初始状态下隐藏标签

      // 创建文本
      const label = new PIXI.Text(zh_name, {
        fontFamily: "Arial",
        fontSize: 13,
        fill: 0x87cefa, // 浅蓝色
        align: "center",
      });
      label.anchor.set(0.5);

      // 创建背景矩形
      const padding = 4;
      const background = new PIXI.Graphics();
      background.lineStyle(1, 0x87cefa, 1); // 浅蓝色边框
      background.beginFill(0x000000, 0.5); // 半透明黑色背景
      background.drawRect(
        -label.width / 2 - padding,
        -label.height / 2 - padding,
        label.width + padding * 2,
        label.height + padding * 2
      );
      background.endFill();

      // 将背景和文本添加到容器
      labelContainer.addChild(background);
      labelContainer.addChild(label);

      container.addChild(labelContainer);
      pixiConstellationLabels.current.push(labelContainer);
    });

    // 绘制星门
    boardStarGate.forEach((stargate) => {
      const sourceSystem = boardSystems.find(
        (system) => system.system_id === stargate.system_id
      );
      const destinationSystem = boardSystems.find(
        (system) => system.system_id === stargate.destination_system_id
      );

      if (sourceSystem && destinationSystem) {
        const sourceX = xScale(sourceSystem.x);
        const sourceZ = zScale(sourceSystem.z);
        const destX = xScale(destinationSystem.x);
        const destZ = zScale(destinationSystem.z);

        const line = new PIXI.Graphics();
        line.lineStyle(0.1, 0xffffff, 0.3);
        line.moveTo(sourceX, sourceZ);
        line.lineTo(destX, destZ);
        // 初始状态下隐藏星门
        line.visible = false;
        container.addChild(line);
        pixiStarGates.current.push(line);
      }
    });

    // 绘制星系
    boardSystems.forEach((system) => {
      const { x, z, security_status, zh_name, system_id } = system;
      const scaledX = xScale(x);
      const scaledZ = zScale(z);
      const color = getColor(security_status);

      const star = new PIXI.Graphics();
      star.lineStyle(0);
      star.beginFill(color);
      star.drawCircle(0, 0, 0.6);
      star.endFill();
      star.position.set(scaledX, scaledZ);
      star.interactive = true;
      star.buttonMode = true;
      star.on("pointerdown", () => {
        const { x, y, k } = currentTransform.current;

        setPopoverInfo((prev) => ({
          ...prev,
          open: false,
        }));

        setTimeout(() => {
          setPopoverInfo({
            open: true,
            data: {
              system_id,
              name: zh_name,
              security_status: security_status.toFixed(1),
              x: system.x,
              y: system.y,
              z: system.z,
            },
            x: scaledX * k + x - 5,
            y: scaledZ * k + y,
          });
        }, 0);
      });
      container.addChild(star);

      const label = new PIXI.Text(zh_name, {
        fontFamily: "Arial",
        fontSize: 10, // 较大的初始字号
        fill: 0xffffff,
        align: "center",

        resolution: window.devicePixelRatio * 4, // 提高分辨率
      });
      label.scale.set(0.1); // 初始缩放设置
      label.x = 0;
      label.y = 0.8;
      label.anchor.set(0.5, 0);
      label.alpha = 0.7; // 设置文字透明度为 50%
      label.visible = false; // 初始状态下隐藏标签
      star.addChild(label);
      pixiLabels.current.push(label);
    });

    app.stage.addChild(container);

    // 处理窗口大小调整
    const handleResize = () => {
      app.renderer.resize(window.innerWidth, window.innerHeight);
      container.scale.set(1, 1);
      container.position.set(0, 0);

      xScale.range([0, window.innerWidth]);
      zScale.range([window.innerHeight, 0]);

      container.removeChildren();
      boardStarGate.forEach((stargate) => {
        const sourceSystem = boardSystems.find(
          (system) => system.system_id === stargate.system_id
        );
        const destinationSystem = boardSystems.find(
          (system) => system.system_id === stargate.destination_system_id
        );

        if (sourceSystem && destinationSystem) {
          const sourceX = xScale(sourceSystem.x);
          const sourceZ = zScale(sourceSystem.z);
          const destX = xScale(destinationSystem.x);
          const destZ = zScale(destinationSystem.z);

          const line = new PIXI.Graphics();
          line.lineStyle(0.2, 0xffffff, 0.2);
          line.moveTo(sourceX, sourceZ);
          line.lineTo(destX, destZ);
          line.visible = false;
          container.addChild(line);
          pixiStarGates.current.push(line);
        }
      });

      boardSystems.forEach((system, index) => {
        const { x, z, security_status } = system;
        const scaledX = xScale(x);
        const scaledZ = zScale(z);
        const color = getColor(security_status);

        const star = new PIXI.Graphics();
        star.lineStyle(0);
        star.beginFill(color);
        star.drawCircle(0, 0, 0.8);
        star.endFill();
        star.position.set(scaledX, scaledZ);
        star.interactive = true;
        star.buttonMode = true;
        star.on("pointerdown", () => {
          const { x, y, k } = currentTransform.current;

          setPopoverInfo((prev) => ({
            ...prev,
            open: false,
          }));

          setTimeout(() => {
            setPopoverInfo({
              open: true,
              data: {
                system_id: system.system_id,
                name: system.zh_name,
                security_status: system.security_status.toFixed(1),
                x: system.x,
                y: system.y,
                z: system.z,
              },
              x: scaledX * k + x,
              y: scaledZ * k + y,
            });
          }, 0);
        });
        container.addChild(star);

        const label = pixiLabels.current[index];
        label.x = 0;
        label.y = 1;
        label.visible = false;
        star.addChild(label);
      });
    };

    window.addEventListener("resize", handleResize);

    // 初始化d3的缩放行为
    zoomBehavior.current = d3
      .zoom()
      .scaleExtent([1, 15])
      .on("zoom", (event) => {
        const { transform } = event;
        currentTransform.current = transform;

        const limitedX = Math.min(
          Math.max(transform.x, -window.innerWidth * (transform.k - 1) * 2),
          window.innerWidth * (transform.k - 1) * 2
        );
        const limitedY = Math.min(
          Math.max(transform.y, -window.innerHeight * (transform.k - 1) * 2),
          window.innerHeight * (transform.k - 1) * 2
        );

        container.position.set(limitedX, limitedY);
        container.scale.set(transform.k, transform.k);

        const showLabelsAndStargates = transform.k > 6;
        const showConstellationLabels = transform.k > 4 && transform.k <= 6;
        const showRegionLabels = transform.k <= 4;

        pixiLabels.current.forEach((label) => {
          label.visible = showLabelsAndStargates;
        });
        pixiStarGates.current.forEach((stargate) => {
          stargate.visible = showLabelsAndStargates;
        });
        pixiConstellationLabels.current.forEach((label) => {
          label.visible = showConstellationLabels;
          if (showConstellationLabels) {
            label.scale.set(1 / transform.k);
          }
        });
        pixiRegionLabels.current.forEach((label) => {
          label.visible = showRegionLabels;
          if (showRegionLabels) {
            label.scale.set(1 / transform.k);
          }
        });

        setPopoverInfo((prev) => ({
          ...prev,
          open: false,
        }));

        // 调整距离文本的字体大小和直线宽度
        if (distanceTexts.length > 0) {
          distanceTexts.forEach((text) => {
            text.style.fontSize = 20 / transform.k;
            text.resolution = 4 * transform.k;
          });
        }
        if (distanceLines.length > 0) {
          distanceLines.forEach((line) => {
            line.lineStyle(1 / transform.k, 0xffff00, 1);
          });
        }
      })
      .on("end", () => {
        // 如果有需要在缩放和平移完成后执行的逻辑，可以在这里添加
      });

    // 将d3的缩放行为应用到PIXI的视图上
    d3.select(pixiApp.current.view).call(zoomBehavior.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (pixiApp.current) {
        pixiApp.current.destroy(true, true);
      }
      pixiApp.current = null;
      pixiGraphics.current = null;
      pixiLabels.current = [];
      pixiStarGates.current = [];
      pixiConstellationLabels.current = [];
      pixiRegionLabels.current = [];
      setStartCircles([]);
      setEndCircles([]);
      setDistanceLines([]);
      setDistanceTexts([]);
    };
  }, [
    boardSystems,
    boardStarGate,
    boardConstellations,
    boardRegions,
    systemsLoading,
    starGateLoading,
    constellationLoading,
    regionsLoading,
  ]);

  // 处理搜索
  const handleSearch = (searchTerm) => {
    const selectedSystem = boardSystems.find(
      (system) => system.zh_name === searchTerm
    );
    if (selectedSystem) {
      const xScale = d3
        .scaleLinear()
        .domain(d3.extent(boardSystems, (d) => d.x))
        .range([50, window.innerWidth - 50]);
      const zScale = d3
        .scaleLinear()
        .domain(d3.extent(boardSystems, (d) => d.z))
        .range([window.innerHeight - 50, 50]);

      const scaledX = xScale(selectedSystem.x);
      const scaledZ = zScale(selectedSystem.z);

      const k = 13; // 放大倍数，可以根据需要调整

      const newX = window.innerWidth / 2 - scaledX * k + 5;
      const newY = window.innerHeight / 2 - scaledZ * k;

      d3.select(pixiApp.current.view)
        .transition()
        .duration(750)
        .call(
          zoomBehavior.current.transform,
          d3.zoomIdentity.translate(newX, newY).scale(k)
        )
        .on("end", () => {
          setPopoverInfo({
            open: true,
            data: {
              sysetem_id: selectedSystem.system_id,
              name: selectedSystem.zh_name,
              security_status: selectedSystem.security_status.toFixed(1),
              x: selectedSystem.x,
              y: selectedSystem.y,
              z: selectedSystem.z,
            },
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
        });
    }
  };

  const handleSetStartSystem = (system) => {
    setPopoverInfo((prev) => ({ ...prev, open: false }));

    const xScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.x))
      .range([50, window.innerWidth - 50]);
    const zScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.z))
      .range([window.innerHeight - 50, 50]);

    const scaledX = xScale(system.x);
    const scaledZ = zScale(system.z);

    const circle = new PIXI.Graphics();
    circle.lineStyle(0.3, 0xffffff, 1);
    circle.drawCircle(scaledX, scaledZ, 1.2);

    circle.systemId = system.system_id;
    circle.isStartMarker = true;
    circle.isCustom = true;

    if (lineMode === "Single induction") {
      // 单选模式逻辑保持不变
      if (startCircles.length > 0) {
        pixiGraphics.current.removeChild(startCircles[0]);
      }
      setStartSystems([{ ...system, isCustom: true }]);
      setStartCircles([circle]);

      if (endSystems.length > 0) {
        setCustomPaths([
          {
            start: { ...system, isCustom: true },
            end: endSystems[0],
          },
        ]);
      }
    } else {
      // 多选模式
      if (startCircles.length > endCircles.length) {
        // 如果当前正在选择起点，替换最后一个起点
        const newStartSystems = [...startSystems];
        newStartSystems[newStartSystems.length - 1] = {
          ...system,
          isCustom: true,
        };
        setStartSystems(newStartSystems);

        if (startCircles.length > 0) {
          pixiGraphics.current.removeChild(
            startCircles[startCircles.length - 1]
          );
        }
        const newStartCircles = [...startCircles];
        newStartCircles[newStartCircles.length - 1] = circle;
        setStartCircles(newStartCircles);
      } else {
        // 否则，添加新的起点
        setStartSystems((prevSystems) => [
          ...prevSystems,
          { ...system, isCustom: true },
        ]);
        setStartCircles((prevCircles) => [...prevCircles, circle]);
      }
      setSelectionState("end");
    }

    pixiGraphics.current.addChild(circle);
    setIsSelectingEnd(true);

    // 重新绘制线条
    drawLines(
      lineMode === "Single induction"
        ? [{ ...system, isCustom: true }]
        : startSystems,
      endSystems
    );
  };

  const handleSetEndSystem = (system) => {
    if (!isSelectingEnd && lineMode === "Multiple induction") return;

    setPopoverInfo((prev) => ({ ...prev, open: false }));

    const xScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.x))
      .range([50, window.innerWidth - 50]);
    const zScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.z))
      .range([window.innerHeight - 50, 50]);

    const scaledX = xScale(system.x);
    const scaledZ = zScale(system.z);

    const circle = new PIXI.Graphics();
    circle.lineStyle(0.3, 0xffffff, 1);
    circle.drawCircle(scaledX, scaledZ, 1.2);

    circle.systemId = system.system_id;
    circle.isEndMarker = true;
    circle.isCustom = true;

    let newEndSystems, newEndCircles, newCustomPaths;

    if (lineMode === "Single induction") {
      // 单选模式逻辑保持不变
      if (endCircles.length > 0) {
        pixiGraphics.current.removeChild(endCircles[0]);
      }
      newEndSystems = [{ ...system, isCustom: true }];
      newEndCircles = [circle];

      if (startSystems.length > 0) {
        newCustomPaths = [
          {
            start: startSystems[0],
            end: { ...system, isCustom: true },
          },
        ];
      }
    } else {
      // 多选模式
      newEndSystems = [...endSystems, { ...system, isCustom: true }];
      newEndCircles = [...endCircles, circle];

      if (startSystems.length > 0) {
        newCustomPaths = [
          ...customPaths,
          {
            start: startSystems[startSystems.length - 1],
            end: { ...system, isCustom: true },
          },
        ];
      }
    }

    pixiGraphics.current.addChild(circle);

    // 更新状态
    setEndSystems(newEndSystems);
    setEndCircles(newEndCircles);
    setCustomPaths(newCustomPaths || []);
    setIsSelectingEnd(false);
    setSelectionState("start");

    // 立即重新绘制线条
    drawLines(startSystems, newEndSystems);
  };

  const drawLines = (currentStartSystems, currentEndSystems) => {

    // 移除之前的所有自定义线和文本
    distanceLines.forEach((line) => {
      if (line.isCustom) {
        pixiGraphics.current.removeChild(line);
      }
    });
    distanceTexts.forEach((text) => {
      if (text.isCustom) {
        pixiGraphics.current.removeChild(text);
      }
    });

    const newLines = [];
    const newTexts = [];

    const xScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.x))
      .range([50, window.innerWidth - 50]);
    const zScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.z))
      .range([window.innerHeight - 50, 50]);

    const drawLine = (start, end) => {
      const startX = xScale(start.x);
      const startZ = zScale(start.z);
      const endX = xScale(end.x);
      const endZ = zScale(end.z);

      const line = new PIXI.Graphics();
      line.lineStyle(1 / currentTransform.current.k, 0xffff00, 1);
      line.moveTo(startX, startZ);
      line.lineTo(endX, endZ);

      line.startSystemId = start.system_id;
      line.endSystemId = end.system_id;
      line.isDistance = true;
      line.isCustom = true;

      pixiGraphics.current.addChild(line);
      newLines.push(line);

      // 计算距离并添加文本标签
      const distanceInMeters = Math.sqrt(
        Math.pow(end.x - start.x, 2) +
          Math.pow(end.y - start.y, 2) +
          Math.pow(end.z - start.z, 2)
      );
      const distanceInLightYears = distanceInMeters / 9.461e15;

      const midX = (startX + endX) / 2;
      const midZ = (startZ + endZ) / 2;

      const distanceLabel = new PIXI.Text(
        `距离: ${distanceInLightYears.toFixed(2)} 光年`,
        {
          fontFamily: "Arial",
          fontSize: 18,
          fill: 0xffff00,
          align: "center",
          resolution: window.devicePixelRatio * 4,
        }
      );
      distanceLabel.anchor.set(0.5);
      distanceLabel.position.set(midX, midZ - 5);
      distanceLabel.scale.set(1 / currentTransform.current.k);

      distanceLabel.startSystemId = start.system_id;
      distanceLabel.endSystemId = end.system_id;
      distanceLabel.isDistanceText = true;
      distanceLabel.isCustom = true;

      pixiGraphics.current.addChild(distanceLabel);
      newTexts.push(distanceLabel);
    };

    // 只绘制自定义路线
    const customStartSystems = currentStartSystems.filter(
      (system) => system.isCustom
    );
    const customEndSystems = currentEndSystems.filter(
      (system) => system.isCustom
    );

    if (lineMode === "Single induction") {
      // 单选模式下只绘制一条线
      if (customStartSystems.length > 0 && customEndSystems.length > 0) {
        drawLine(customStartSystems[0], customEndSystems[0]);
      }
    } else {
      // 多选模式：绘制多条线
      for (
        let i = 0;
        i < Math.min(customStartSystems.length, customEndSystems.length);
        i++
      ) {
        const start = customStartSystems[i];
        const end = customEndSystems[i];
        if (start && end) {
          drawLine(start, end);
        }
      }
    }

    // 更新状态
    setDistanceLines((prevLines) => [
      ...prevLines.filter((line) => !line.isCustom),
      ...newLines,
    ]);
    setDistanceTexts((prevTexts) => [
      ...prevTexts.filter((text) => !text.isCustom),
      ...newTexts,
    ]);

  };
  // 移除起点和终点的标记
  const handleRemoveTag = useCallback(() => {
    startCircles.forEach((circle) => pixiGraphics.current.removeChild(circle));
    endCircles.forEach((circle) => pixiGraphics.current.removeChild(circle));
    distanceLines.forEach((line) => pixiGraphics.current.removeChild(line));
    distanceTexts.forEach((text) => pixiGraphics.current.removeChild(text));
    setStartSystems([]);
    setEndSystems([]);
    setStartCircles([]);
    setEndCircles([]);
    setDistanceLines([]);
    setDistanceTexts([]);
  }, [startCircles, endCircles, distanceLines, distanceTexts]);

  useEffect(() => {
    if (shouldTriggerLineModeEffect) {
      // 第一个 useEffect 的逻辑
      handleRemoveTag();
      setSelectionState("start");

      // 第二个 useEffect 的逻辑
      if (startSystems.length > 0 && endSystems.length > 0) {
        drawLines(startSystems, endSystems, startCircles, endCircles);
      }
    }
  }, [lineMode, shouldTriggerLineModeEffect]);

  const handleSetLineMode = (newMode) => {
    setShouldTriggerLineModeEffect(true);
    // 从 PIXI 舞台上移除所有相关图形
    if (pixiGraphics.current) {
      distanceLines.forEach((line) => pixiGraphics.current.removeChild(line));
      distanceTexts.forEach((text) => pixiGraphics.current.removeChild(text));
      startCircles.forEach((circle) =>
        pixiGraphics.current.removeChild(circle)
      );
      endCircles.forEach((circle) => pixiGraphics.current.removeChild(circle));
    }
    setLineMode(newMode);
    // 清除所有起点、终点和连线
    setStartSystems([]);
    setEndSystems([]);
    setStartCircles([]);
    setEndCircles([]);
    setDistanceLines([]);
    setDistanceTexts([]);
  };

  //处理获得的诱导路线
  function handleJumpPath() {
    setShouldTriggerLineModeEffect(false);
    setLineMode("multiple inductions");

    // 保存自定义路线信息
    const savedCustomPaths = [...customPaths];

    // 清除之前的诱导路线和自定义路线
    pixiGraphics.current.children = pixiGraphics.current.children.filter(
      (child) =>
        !(
          child.isInductionPath ||
          child.isDistance ||
          child.isDistanceText ||
          child.isStartMarker ||
          child.isEndMarker
        )
    );

    setStartSystems([]);
    setEndSystems([]);
    setStartCircles([]);
    setEndCircles([]);
    setDistanceLines([]);
    setDistanceTexts([]);

    let currentGroup = [];
    const newInductionPaths = [];

    if (pathData) {
      pathData.forEach((item, index) => {
        newInductionPaths.push(item);
        if (item.start.move_type === "土路") {
          if (
            currentGroup.length === 0 ||
            currentGroup[currentGroup.length - 1].end.system_id ===
              item.start.system_id
          ) {
            currentGroup.push(item);
          } else {
            // 如果当前土路段和上一个土路段不相连，先处理上一个组
            handleSetPathGroup(currentGroup);
            currentGroup = [item];
          }
        } else {
          if (currentGroup.length > 0) {
            handleSetPathGroup(currentGroup);
            currentGroup = [];
          }
          handleSetPathCircle(
            boardSystems.find(
              (start) => start.system_id === item.start.system_id
            ),
            boardSystems.find((end) => end.system_id === item.end.system_id),
            item.start.move_type
          );
        }
      });

      // 处理最后一组土路（如果有的话）
      if (currentGroup.length > 0) {
        handleSetPathGroup(currentGroup);
      }

      drawPathLine();
    }

    setInductionPaths(newInductionPaths);
  }

  useEffect(() => {
    if (isOnlyClearJumpPath) {
      // 重新添加自定义路线
      customPaths.forEach((path) => {
        if (
          !startSystems.find(
            (start) => start.system_id === path.start.system_id
          ) &&
          !endSystems.find((end) => end.system_id === path.end.system_id)
        )
          addCustomPath(path.start, path.end);
      });
    }
    // 重置标志
    setIsOnlyClearJumpPath(false);
  }, [startSystems]);
  // 新增的辅助函数，用于添加自定义路径
  function addCustomPath(start, end) {
    const xScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.x))
      .range([50, window.innerWidth - 50]);
    const zScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.z))
      .range([window.innerHeight - 50, 50]);

    // 添加起点
    const startScaledX = xScale(start.x);
    const startScaledZ = zScale(start.z);
    const startCircle = new PIXI.Graphics();
    startCircle.lineStyle(0.3, 0xffffff, 1);
    startCircle.drawCircle(startScaledX, startScaledZ, 1.2);
    startCircle.systemId = start.system_id;
    startCircle.isStartMarker = true;
    startCircle.isCustom = true;
    pixiGraphics.current.addChild(startCircle);

    // 添加终点
    const endScaledX = xScale(end.x);
    const endScaledZ = zScale(end.z);
    const endCircle = new PIXI.Graphics();
    endCircle.lineStyle(0.3, 0xffffff, 1);
    endCircle.drawCircle(endScaledX, endScaledZ, 1.2);
    endCircle.systemId = end.system_id;
    endCircle.isEndMarker = true;
    endCircle.isCustom = true;
    pixiGraphics.current.addChild(endCircle);

    // 更新状态
    setStartSystems((prevSystems) => [...prevSystems, start]);
    setEndSystems((prevSystems) => [...prevSystems, end]);
    setStartCircles((prevCircles) => [...prevCircles, startCircle]);
    setEndCircles((prevCircles) => [...prevCircles, endCircle]);

    // 绘制连线
    drawCustomLine(start, end);
  }

  // 新增的辅助函数，用于绘制自定义路径的连线
  function drawCustomLine(start, end) {
    const xScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.x))
      .range([50, window.innerWidth - 50]);
    const zScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.z))
      .range([window.innerHeight - 50, 50]);

    const startX = xScale(start.x);
    const startZ = zScale(start.z);
    const endX = xScale(end.x);
    const endZ = zScale(end.z);

    const line = new PIXI.Graphics();
    line.lineStyle(1 / currentTransform.current.k, 0xffff00, 1);
    line.moveTo(startX, startZ);
    line.lineTo(endX, endZ);

    line.startSystemId = start.system_id;
    line.endSystemId = end.system_id;
    line.isDistance = true;
    line.isCustom = true;

    pixiGraphics.current.addChild(line);
    setDistanceLines((prevLines) => [...prevLines, line]);

    // 添加距离文本
    const distanceInMeters = Math.sqrt(
      Math.pow(end.x - start.x, 2) +
        Math.pow(end.y - start.y, 2) +
        Math.pow(end.z - start.z, 2)
    );
    const distanceInLightYears = distanceInMeters / 9.461e15;

    const midX = (startX + endX) / 2;
    const midZ = (startZ + endZ) / 2;

    const distanceLabel = new PIXI.Text(
      `距离: ${distanceInLightYears.toFixed(2)} 光年`,
      {
        fontFamily: "Arial",
        fontSize: 18,
        fill: 0xffff00,
        align: "center",
        resolution: window.devicePixelRatio * 4,
      }
    );
    distanceLabel.anchor.set(0.5);
    distanceLabel.position.set(midX, midZ - 5);
    distanceLabel.scale.set(1 / currentTransform.current.k);

    distanceLabel.startSystemId = start.system_id;
    distanceLabel.endSystemId = end.system_id;
    distanceLabel.isDistanceText = true;
    distanceLabel.isCustom = true;

    pixiGraphics.current.addChild(distanceLabel);
    setDistanceTexts((prevTexts) => [...prevTexts, distanceLabel]);
  }

  function handleSetPathGroup(group) {
    if (group.length === 0) return;

    const startSystem = boardSystems.find(
      (start) => start.system_id === group[0].start.system_id
    );
    const endSystem = boardSystems.find(
      (end) => end.system_id === group[group.length - 1].end.system_id
    );
    const move_type = "土路";

    handleSetPathCircle(startSystem, endSystem, move_type);
  }

  function drawPathLine() {
    const newLines = [];
    const newTexts = [];
    const xScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.x))
      .range([50, window.innerWidth - 50]);
    const zScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.z))
      .range([window.innerHeight - 50, 50]);

    pathData.forEach((item) => {
      const start = boardSystems.find(
        (system) => item.start.system_id === system.system_id
      );
      const end = boardSystems.find(
        (system) => item.end.system_id === system.system_id
      );

      const startX = xScale(start.x);
      const startZ = zScale(start.z);
      const endX = xScale(end.x);
      const endZ = zScale(end.z);

      const line = new PIXI.Graphics();
      line.lineStyle(
        1 / currentTransform.current.k,
        item.start.move_type !== "土路" ? 0xffff00 : 0xffd1dc,
        1
      );
      line.moveTo(startX, startZ);
      line.lineTo(endX, endZ);

      line.startSystemId = start.system_id;
      line.endSystemId = end.system_id;
      line.isInductionPath = true;

      pixiGraphics.current.addChild(line);
      newLines.push(line);

      if (item.start.move_type !== "土路") {
        // 计算距离并添加文本标签
        const distanceInMeters = Math.sqrt(
          Math.pow(end.x - start.x, 2) +
            Math.pow(end.y - start.y, 2) +
            Math.pow(end.z - start.z, 2)
        );
        const distanceInLightYears = distanceInMeters / 9.461e15;

        const midX = (startX + endX) / 2;
        const midZ = (startZ + endZ) / 2;

        const distanceLabel = new PIXI.Text(
          `距离: ${distanceInLightYears.toFixed(2)} 光年`,
          {
            fontFamily: "Arial",
            fontSize: 18,
            fill: 0xffff00,
            align: "center",
            resolution: window.devicePixelRatio * 4,
          }
        );
        distanceLabel.anchor.set(0.5);
        distanceLabel.position.set(midX, midZ - 5);
        distanceLabel.scale.set(1 / currentTransform.current.k);

        distanceLabel.startSystemId = start.system_id;
        distanceLabel.endSystemId = end.system_id;
        distanceLabel.isInductionPath = true;
        distanceLabel.isDistanceText = true;

        pixiGraphics.current.addChild(distanceLabel);
        newTexts.push(distanceLabel);
      }
    });

    setDistanceLines((prevLines) => [
      ...prevLines.filter((line) => !line.isInductionPath),
      ...newLines,
    ]);
    setDistanceTexts((prevTexts) => [
      ...prevTexts.filter((text) => !text.isInductionPath),
      ...newTexts,
    ]);
  }
  function handleSetPathCircle(startSystem, endSystem, move_type) {
    setPopoverInfo((prev) => ({ ...prev, open: false }));

    if (move_type !== "土路") {
      const xScale = d3
        .scaleLinear()
        .domain(d3.extent(boardSystems, (d) => d.x))
        .range([50, window.innerWidth - 50]);
      const zScale = d3
        .scaleLinear()
        .domain(d3.extent(boardSystems, (d) => d.z))
        .range([window.innerHeight - 50, 50]);

      //画起点
      const startScaledX = xScale(startSystem.x);
      const startScaledZ = zScale(startSystem.z);

      const startCircle = new PIXI.Graphics();
      startCircle.lineStyle(0.3, 0xffffff, 1);
      startCircle.drawCircle(startScaledX, startScaledZ, 1.2);

      startCircle.systemId = startSystem.system_id;
      startCircle.isStartMarker = true;

      pixiGraphics.current.addChild(startCircle);
      setStartCircles((prevCircles) => [...prevCircles, startCircle]);

      //画终点
      const endScaledX = xScale(endSystem.x);
      const endScaledZ = zScale(endSystem.z);

      const endCircle = new PIXI.Graphics();
      endCircle.lineStyle(0.3, 0xffffff, 1);
      endCircle.drawCircle(endScaledX, endScaledZ, 1.2);

      endCircle.systemId = endSystem.system_id;
      endCircle.isEndMarker = true;

      pixiGraphics.current.addChild(endCircle);
      setEndCircles((prevCircles) => [...prevCircles, endCircle]);
    }

    // 无论是否为土路，都记录起点和终点系统，并添加 move_type
    setStartSystems((prevSystems) => [
      ...prevSystems,
      {
        ...startSystem,
        name: startSystem.zh_name,
        zh_name: undefined,
        security_status: startSystem.security_status.toFixed(1),
        move_type: move_type, // 添加 move_type 属性
      },
    ]);
    setEndSystems((prevSystems) => [
      ...prevSystems,
      {
        ...endSystem,
        name: endSystem.zh_name,
        zh_name: undefined,
        security_status: endSystem.security_status.toFixed(1),
        move_type: move_type, // 添加 move_type 属性
      },
    ]);
  }

  useEffect(() => {
    if (pathData) {
      handleJumpPath();
    }
  }, [pathData]);

  const popoverContent = useMemo(() => {
    if (lineMode === "Single induction") {
      return (
        <div>
          <p>星系: {popoverInfo.data?.name}</p>
          <p>
            星系安等:{" "}
            <span
              style={{
                color: get16Color(popoverInfo.data?.security_status),
              }}
            >
              {popoverInfo.data?.security_status}
            </span>
          </p>
          <Button onClick={() => handleSetStartSystem(popoverInfo.data)}>
            设置为起点
          </Button>
          <Button onClick={() => handleSetEndSystem(popoverInfo.data)}>
            设置为终点
          </Button>
        </div>
      );
    } else {
      // 多次诱导模式
      if (selectionState === "start") {
        return (
          <div>
            <p>星系: {popoverInfo.data?.name}</p>
            <p>
              星系安等:{" "}
              <span
                style={{
                  color: get16Color(popoverInfo.data?.security_status),
                }}
              >
                {popoverInfo.data?.security_status}
              </span>
            </p>
            <Button
              onClick={() => {
                handleSetStartSystem(popoverInfo.data);
                setSelectionState("end");
              }}
            >
              选择为起点
            </Button>
          </div>
        );
      } else {
        return (
          <div>
            <p>星系: {popoverInfo.data.name}</p>
            <p>
              星系安等:{" "}
              <span
                style={{
                  color: get16Color(popoverInfo.data.security_status),
                }}
              >
                {popoverInfo.data.security_status}
              </span>
            </p>
            <div style={{ display: "flex", gap: "5px" }}>
              <Button
                onClick={() => {
                  handleSetStartSystem(popoverInfo.data);
                  setSelectionState("end");
                }}
                type="primary"
              >
                修改起点
              </Button>
              <Button
                onClick={() => {
                  handleSetEndSystem(popoverInfo.data);
                  setSelectionState("start");
                }}
              >
                选择为终点
              </Button>
            </div>
          </div>
        );
      }
    }
  }, [lineMode, selectionState, popoverInfo.data]);

  if (isDataLoading)
    return (
      <StyledDiv>
        <Spinner />
      </StyledDiv>
    );
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1000 }}>
        <SearchBox
          options={options}
          onSearch={handleSearch}
          isLoading={systemsLoading || starGateLoading}
          startSystems={startSystems}
          endSystems={endSystems}
          onRemoveInductionGroup={handleRemoveInductionGroup}
          lineMode={lineMode}
          setLineMode={handleSetLineMode}
          onJumpPath={handleJumpPath}
          setPathData={setPathData}
          customPaths={customPaths}
          path={pathData}
        />
      </div>
      <div ref={pixiContainer} style={{ width: "100%", height: "100%" }}>
        {popoverInfo.open && (
          <Popover
            content={popoverContent}
            title="星系信息"
            open={popoverInfo.open}
            trigger={null}
            onOpenChange={(open) =>
              setPopoverInfo((prev) => ({ ...prev, open }))
            }
          >
            <div
              style={{
                position: "absolute",
                top: popoverInfo.y,
                left: popoverInfo.x,
                x: popoverInfo.x,
                background: "transparent",
                border: "none",
                width: 10,
                height: 10,
                cursor: "pointer",
              }}
            />
          </Popover>
        )}
      </div>
    </div>
  );
}

export default TwoDStarMap;
