import { useContext, useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, CircleAlert, ShieldAlert } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import { checkFraudAdmin, fraudAdminLogin } from '../services/apiFraudList'

const EMAIL_PATTERN = /\S+@\S+\.\S{1,}/

function shouldFallbackToChinese(message) {
  if (!message) return true
  if (/[\u4e00-\u9fff]/.test(message)) return false
  return /[A-Za-z]/.test(message)
}

function normalizeAdminLoginMessage(message) {
  switch (message) {
    case 'Invalid credentials':
    case 'Invalid email or password.':
      return '管理员邮箱或密码错误'
    case 'Unauthorized admin account.':
    case 'UnAuthorized Users':
      return '当前账号没有管理员权限'
    case 'Failed check fraud admin login':
      return '管理员权限校验失败'
    default:
      return shouldFallbackToChinese(message) ? '管理员登录失败' : message || '管理员登录失败'
  }
}

function AuthMessage({ message }) {
  if (!message) return null

  return (
    <div className="auth-inline-message form-error is-error" role="alert" aria-live="polite">
      <CircleAlert size={15} />
      <span>{message}</span>
    </div>
  )
}

export default function FraudAdminLoginPage() {
  const navigate = useNavigate()
  const { isAuthenticated, login: loginAction, logout } = useContext(AuthContext)
  const [form, setForm] = useState({
    adminEmail: '',
    adminPassword: '',
  })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  const adminCheckQuery = useQuery({
    queryKey: ['fraud-admin-access', isAuthenticated],
    queryFn: checkFraudAdmin,
    enabled: isAuthenticated,
    retry: false,
  })

  const loginMutation = useMutation({
    mutationFn: fraudAdminLogin,
    onSuccess: (data) => {
      localStorage.setItem('access_token', data.access)
      localStorage.setItem('refresh_token', data.refresh)
      loginAction()
      navigate('/fraudadmin', { replace: true })
    },
    onError: (err) => {
      setError(normalizeAdminLoginMessage(err.message))
    },
  })

  useEffect(() => {
    if (adminCheckQuery.data?.message === 'Authorized Users') {
      navigate('/fraudadmin', { replace: true })
    }
  }, [adminCheckQuery.data, navigate])

  if (isAuthenticated && adminCheckQuery.data?.message === 'Authorized Users') {
    return <Navigate replace to="/fraudadmin" />
  }

  const submitLogin = (event) => {
    event.preventDefault()
    setError('')
    setFieldErrors({})

    const nextErrors = {}
    const adminEmail = form.adminEmail.trim()
    const adminPassword = form.adminPassword.trim()

    if (!adminEmail) nextErrors.adminEmail = '请输入管理员邮箱'
    else if (!EMAIL_PATTERN.test(adminEmail)) nextErrors.adminEmail = '邮箱格式错误'
    if (!adminPassword) nextErrors.adminPassword = '请输入管理员密码'

    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors)
      return
    }

    loginMutation.mutate({
      adminEmail,
      adminPassword,
    })
  }

  const showUnauthorizedHint = isAuthenticated && adminCheckQuery.data?.message === 'UnAuthorized Users'

  return (
    <div className="login-screen">
      <div className="login-card auth-card admin-login-card">
        <div className="login-brand">
          <span>
            <ShieldAlert size={18} />
          </span>
          <div>
            <h1>管理员入口</h1>
            <p>管理员认证</p>
          </div>
        </div>

        <div className="auth-section">
          <div className="pill-row">
            <Link className="ghost-btn auth-quick-btn" to="/fraudlist">
              <ArrowLeft size={14} />
              返回首页
            </Link>
          </div>

          {adminCheckQuery.isPending ? <p className="login-help">正在验证当前账号的管理员权限...</p> : null}

          {showUnauthorizedHint ? (
            <div className="admin-login-warning">
              <AuthMessage message="当前登录账号没有管理员权限" />
              <div className="right-actions">
                <button type="button" className="ghost-btn danger" onClick={logout}>
                  退出当前账号
                </button>
                <button type="button" className="primary-btn" onClick={() => navigate('/login')}>
                  切换账号
                </button>
              </div>
            </div>
          ) : (
            <form className="auth-section" onSubmit={submitLogin} noValidate>
              <div className="field-row">
                <label>管理员邮箱</label>
                <input
                  type="email"
                  className="text-input"
                  value={form.adminEmail}
                  onChange={(event) => {
                    const value = event.target.value
                    setForm((current) => ({ ...current, adminEmail: value }))
                    setFieldErrors((current) => ({ ...current, adminEmail: '' }))
                  }}
                  placeholder="输入管理员邮箱"
                  required
                />
                <AuthMessage message={fieldErrors.adminEmail} />
              </div>

              <div className="field-row">
                <label>密码</label>
                <input
                  type="password"
                  className="text-input"
                  value={form.adminPassword}
                  onChange={(event) => {
                    const value = event.target.value
                    setForm((current) => ({ ...current, adminPassword: value }))
                    setFieldErrors((current) => ({ ...current, adminPassword: '' }))
                  }}
                  placeholder="输入管理员密码"
                  required
                />
                <AuthMessage message={fieldErrors.adminPassword} />
              </div>

              <AuthMessage message={error} />

              <button className="primary-btn block" type="submit" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? '登录中...' : '管理员登录'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
