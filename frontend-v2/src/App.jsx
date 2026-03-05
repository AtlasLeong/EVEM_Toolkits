import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import AppLayout from './ui/AppLayout'
import FraudList from './pages/FraudList'
import Planetary from './pages/Planetary'
import Bazaar from './pages/Bazaar'
import TacticalBoard from './pages/TacticalBoard'
import Setting from './pages/Setting'
import Login from './pages/Login'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'

dayjs.locale('zh-cn')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 180 * 1000 },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index path="/" element={<Navigate replace to="fraudlist" />} />
              <Route path="fraudlist"   element={<FraudList />} />
              <Route path="planetary"   element={<Planetary />} />
              <Route path="bazaar"      element={<Bazaar />} />
              <Route path="starmap"     element={<TacticalBoard />} />
              <Route path="usersetting" element={<Setting />} />
            </Route>
            <Route path="login" element={<Login />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
