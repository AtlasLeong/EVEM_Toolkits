import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from "antd";
import zhCN from "antd/es/locale/zh_CN";
import GlobalStyles from "./styles/GlobalStyles";

import Planetary from "./pages/Planetary";
import InfoCenter from "./pages/InforCenter";
import FraudList from "./pages/FraudList";
import Setting from "./pages/Setting";
import Login from "./pages/Login";
import AppLayout from "./ui/AppLayout";

import { AuthProvider } from "./context/AuthContext";
import Bazaar from "./pages/Bazaar";

import dayjs from "dayjs";

import "dayjs/locale/zh-cn";
import FraudAdminLogin from "./pages/FraudAdminLogin";
import FraudAdmin from "./pages/FraudAdmin";
import TacticalBoard from "./pages/TacticalBoard";
import { IsMobileProvider } from "./context/IsMobileContext";
import MobileUser from "./pages/MobileUser";
import MobileLogin from "./features/Authentication/MobileLogin";
import MobileCalculators from "./pages/MobileCalculators";
import { SearchProvider } from "./context/SearchContext";

dayjs.locale("zh-cn");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 180 * 1000,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <IsMobileProvider>
        <AuthProvider>
          <SearchProvider>
            <ConfigProvider
              theme={{
                components: {
                  Table: {
                    rowHoverBg: "var(--color-blue-100)",
                    borderColor: "var(--color-grey-200)",
                    fontSize: 16,
                  },
                  Segmented: {
                    trackBg: "var(--color-grey-300)",
                    itemHoverBg: "var(--color-brand-200)",
                    itemColor: "black",
                    itemSelectedBg: "#007bff",
                    itemSelectedColor: "var(--color-grey-100)",
                  },
                  Descriptions: {},
                },
              }}
              locale={zhCN}
            >
              <GlobalStyles />
              <BrowserRouter>
                <Routes>
                  <Route element={<AppLayout />}>
                    <Route
                      index
                      path="/"
                      element={<Navigate replace to="fraudlist" />}
                    />
                    <Route path="infocenter" element={<InfoCenter />} />
                    <Route path="planetary" element={<Planetary />} />
                    <Route path="fraudlist" element={<FraudList />} />
                    <Route path="bazaar" element={<Bazaar />} />
                    <Route path="usersetting" element={<Setting />} />
                    <Route path="mobileuser" element={<MobileUser />} />
                    <Route path="mobilelogin" element={<MobileLogin />} />
                    <Route
                      path="mobileCalculators"
                      element={<MobileCalculators />}
                    />
                  </Route>
                  <Route path="starmap" element={<TacticalBoard />} />
                  <Route path="fraudlogin" element={<FraudAdminLogin />} />
                  <Route path="fraudadmin" element={<FraudAdmin />} />
                  <Route path="login" element={<Login />} />
                </Routes>
              </BrowserRouter>
            </ConfigProvider>
          </SearchProvider>
        </AuthProvider>
      </IsMobileProvider>
    </QueryClientProvider>
  );
}

export default App;
