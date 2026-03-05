import { createContext, useEffect, useState } from "react";

// 创建一个 React 上下文
const isMobileContext = createContext();

function IsMobileProvider({ children }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 767);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 767);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return (
    <isMobileContext.Provider value={{ isMobile }}>
      {children}
    </isMobileContext.Provider>
  );
}

export { isMobileContext, IsMobileProvider };
