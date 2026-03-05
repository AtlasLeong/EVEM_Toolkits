import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import * as PIXI from "pixi.js";
import { useGetBoardSystems } from "./useGetBoardSystems";
import { useGetBoardStarGate } from "./useGetBoardStarGate";
import { Popover } from "antd";

function TwoDStarMap() {
  const { boardSystems, isLoading: systemsLoading } = useGetBoardSystems();
  const { boardStarGate, isLoading: starGateLoading } = useGetBoardStarGate();
  const pixiContainer = useRef(null);
  const pixiApp = useRef(null);
  const pixiGraphics = useRef(null);
  const pixiLabels = useRef([]);
  const pixiStarGates = useRef([]);

  const [popoverInfo, setPopoverInfo] = useState({
    visible: false,
    data: null,
    x: 0,
    y: 0,
  });

  const getColor = (value) => {
    value = parseFloat(value); // 将值转换为浮点数
    if (value <= 0) {
      return 0xff0000; // red
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

  useEffect(() => {
    if (systemsLoading || starGateLoading || !boardSystems || !boardStarGate)
      return;

    // Initialize PixiJS application
    if (!pixiApp.current) {
      pixiApp.current = new PIXI.Application({
        width: window.innerWidth,
        height: window.innerHeight,
        antialias: true, // 启用抗锯齿
      });
      pixiContainer.current.appendChild(pixiApp.current.view);
    }

    const app = pixiApp.current;

    // Clear previous graphics
    if (pixiGraphics.current) {
      app.stage.removeChild(pixiGraphics.current);
      pixiGraphics.current.destroy();
    }

    // Clear previous labels and stargates
    pixiLabels.current.forEach((label) => app.stage.removeChild(label));
    pixiStarGates.current.forEach((stargate) =>
      app.stage.removeChild(stargate)
    );
    pixiLabels.current = [];
    pixiStarGates.current = [];

    // Create a new container for all graphics and labels
    const container = new PIXI.Container();
    pixiGraphics.current = container;

    // Define scales
    const xScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.x))
      .range([50, window.innerWidth - 50]);
    const zScale = d3
      .scaleLinear()
      .domain(d3.extent(boardSystems, (d) => d.z))
      .range([window.innerHeight - 50, 50]);

    // Draw stargate links
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
        line.lineStyle(0.2, 0xffffff, 0.2); // 设置线条样式
        line.moveTo(sourceX, sourceZ);
        line.lineTo(destX, destZ);
        line.visible = false; // 初始化时不可见
        container.addChild(line);
        pixiStarGates.current.push(line);
      }
    });

    // Draw stars and labels
    boardSystems.forEach((system) => {
      const { x, z, security_status, zh_name } = system;
      const scaledX = xScale(x);
      const scaledZ = zScale(z);
      const color = getColor(security_status);

      const star = new PIXI.Graphics();
      star.lineStyle(0); // 重置线条样式，确保没有边框
      star.beginFill(color);
      star.drawCircle(0, 0, 0.8); // 将半径设为1
      star.endFill();
      star.position.set(scaledX, scaledZ);
      star.interactive = true;
      star.buttonMode = true;
      star.on("pointerdown", () => {
        setPopoverInfo({
          visible: true,
          data: {
            name: zh_name,
            security_status: security_status.toFixed(2),
          },
          x: scaledX,
          y: scaledZ,
        });
      });
      container.addChild(star);

      // Create label
      const label = new PIXI.Text(zh_name, {
        fontFamily: "Arial",
        fontSize: 15, // 设置较大的字体大小
        fill: 0xffffff,
        align: "center",
      });
      label.scale.set(0.1); // 缩小字体，达到2px效果
      label.x = 0;
      label.y = 1; // 将标签放在圆点下方
      label.anchor.set(0.5, 0); // 设置锚点为中心上方
      label.visible = false; // 初始化时不可见
      star.addChild(label); // 将标签作为星系的子对象
      pixiLabels.current.push(label);
    });

    app.stage.addChild(container);

    // Handle window resize
    const handleResize = () => {
      app.renderer.resize(window.innerWidth, window.innerHeight);
      container.scale.set(1, 1); // 重置缩放比例
      container.position.set(0, 0); // 重置位置

      // Update scales
      xScale.range([0, window.innerWidth]);
      zScale.range([window.innerHeight, 0]);

      // Redraw stargate links and stars
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
          line.lineStyle(0.2, 0xffffff, 0.2); // 设置线条样式
          line.moveTo(sourceX, sourceZ);
          line.lineTo(destX, destZ);
          line.visible = false; // 初始化时不可见
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
        star.lineStyle(0); // 重置线条样式，确保没有边框
        star.beginFill(color);
        star.drawCircle(0, 0, 0.8); // 将半径设为1
        star.endFill();
        star.position.set(scaledX, scaledZ);
        star.interactive = true;
        star.buttonMode = true;
        star.on("pointerdown", () => {
          setPopoverInfo({
            visible: true,
            data: {
              name: system.zh_name,
              security_status: system.security_status.toFixed(2),
            },
            x: scaledX,
            y: scaledZ,
          });
        });
        container.addChild(star);

        // Update label position
        const label = pixiLabels.current[index];
        label.x = 0;
        label.y = 1; // 将标签放在圆点下方
        label.visible = false; // 初始化时不可见
        star.addChild(label); // 将标签作为星系的子对象
      });
    };

    window.addEventListener("resize", handleResize);

    // D3 zoom behavior with limited pan range
    const zoom = d3
      .zoom()
      .scaleExtent([1, 10]) // 修改缩放范围
      .on("zoom", (event) => {
        const { transform } = event;
        // Limit the pan range
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

        // Show or hide labels and stargates based on zoom level
        const showLabelsAndStargates = transform.k > 6;
        pixiLabels.current.forEach((label) => {
          label.visible = showLabelsAndStargates;
        });
        pixiStarGates.current.forEach((stargate) => {
          stargate.visible = showLabelsAndStargates;
        });

        // Update Popover position if visible
        if (popoverInfo.visible) {
          const { x, y } = popoverInfo;
          const newX = x * transform.k + limitedX;
          const newY = y * transform.k + limitedY;
          setPopoverInfo((prev) => ({
            ...prev,
            x: newX,
            y: newY,
          }));
        }
      });

    d3.select(pixiApp.current.view).call(zoom);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (pixiApp.current) {
        pixiApp.current.destroy(true, true);
      }
      pixiApp.current = null;
      pixiGraphics.current = null;
      pixiLabels.current = [];
      pixiStarGates.current = [];
    };
  }, [
    boardSystems,
    boardStarGate,
    systemsLoading,
    starGateLoading,
    popoverInfo.visible,
    popoverInfo.x,
    popoverInfo.y,
  ]);

  return (
    <div ref={pixiContainer} style={{ position: "relative" }}>
      {popoverInfo.visible && (
        <Popover
          content={
            <div>
              <p>名称: {popoverInfo.data.name}</p>
              <p>安全等级: {popoverInfo.data.security_status}</p>
            </div>
          }
          title="星系信息"
          visible={popoverInfo.visible}
          onVisibleChange={(visible) =>
            setPopoverInfo((prev) => ({ ...prev, visible }))
          }
        >
          <div
            style={{
              position: "absolute",
              top: popoverInfo.y,
              left: popoverInfo.x,
              width: 0,
              height: 0,
            }}
          />
        </Popover>
      )}
    </div>
  );
}

export default TwoDStarMap;
