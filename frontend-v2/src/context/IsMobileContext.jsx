import { createContext, useEffect, useState } from "react";

const isMobileContext = createContext();

function getIsMobile() {
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return true;
  }
  return window.innerWidth <= 767;
}

function IsMobileProvider({ children }) {
  const [isMobile, setIsMobile] = useState(getIsMobile);

  useEffect(() => {
    const handleResize = () => setIsMobile(getIsMobile());
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

