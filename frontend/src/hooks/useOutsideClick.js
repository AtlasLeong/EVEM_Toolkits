// 引入 React 的 useEffect 和 useRef 钩子
import { useEffect, useRef } from "react";

/**
 * 自定义钩子 useOutsideClick，用于处理点击元素外部的事件
 * @param {Function} onClick - 当点击外部时触发的回调函数
 * @param {boolean} listenCapturing - 是否在捕获阶段监听事件，默认为 true
 */
function useOutsideClick(onClick, listenCapturing = true) {
  // 使用 useRef 创建一个 ref 对象，用于引用 DOM 元素
  const ref = useRef();

  // 使用 useEffect 钩子来处理副作用，添加和移除事件监听器
  useEffect(
    function () {
      // 定义 handleClick 函数，用于处理点击事件
      function handleClick(e) {
        // 检查点击事件的目标是否在 ref 所指向的 DOM 元素外部
        if (
          ref.current &&
          !ref.current.contains(e.target) &&
          !e.target.matches(".ant-select-dropdown *") &&
          !document.querySelector(".ant-image-preview-root") // 这里检查是否存在图片预览的根元素
        ) {
          onClick(); // 如果是外部点击，调用 onClick 回调函数
        }
      }
      // 在文档上添加点击事件监听器
      document.addEventListener("click", handleClick, listenCapturing);
      // 返回一个清理函数，用于在组件卸载时移除事件监听器
      return () =>
        document.removeEventListener("click", handleClick, listenCapturing);
    },
    [onClick, listenCapturing] // 依赖数组，当 onClick 或 listenCapturing 改变时重新执行
  );

  // 返回 ref 对象，组件中可以用这个 ref 绑定到需要检测外部点击的 DOM 元素
  return ref;
}

// 导出 useOutsideClick 钩子
export default useOutsideClick;
