import { motion, useReducedMotion } from 'framer-motion'
import { ChartNoAxesCombined, CheckCircle2, CircleAlert, Compass, Mail, RotateCcw, ShieldCheck, UserRound, Users } from 'lucide-react'
import { useContext, useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { loginDestination } from '../utils/loginDestination'
import { PUBLIC_READ_ACCESS_ENABLED } from '../utils/viewerAccess'
import {
  emailVerification,
  forgetEmaillCheck,
  forgetPassword,
  login,
  register,
  signupCheck,
} from '../services/apiAuthentication'
import { AuthContext } from '../context/AuthContext'
import { AuthSessionChangedError } from '../services/fetchWithAuth'
import '../styles/account-entry.css'

const EMAIL_PATTERN = /\S+@\S+\.\S{1,}/
const PASSWORD_PATTERN = /^[A-Za-z0-9@._-]+$/
const AUTH_MODES = [
  { key: 'login', label: '登录' },
  { key: 'register', label: '注册' },
  { key: 'reset', label: '找回密码' },
]

function readAuthTokens() {
  return { access: localStorage.getItem('access_token'), refresh: localStorage.getItem('refresh_token') }
}

function shouldFallbackToChinese(message) {
  if (!message) return true
  if (/[\u4e00-\u9fff]/.test(message)) return false
  return /[A-Za-z]/.test(message)
}

function normalizeAuthMessage(message, fallback = '操作失败，请稍后重试') {
  switch (message) {
    case 'Invalid credentials':
    case 'Invalid email or password.':
      return '邮箱或密码错误'
    case 'All fields must be filled and not empty.':
      return '请完整填写信息'
    case 'Enter a valid email.':
      return '邮箱格式错误'
    case 'Wrong Email verification code.':
      return '邮箱验证码错误'
    case 'Username is already taken.':
      return '该用户名已被使用'
    case 'Email is already in use.':
      return '该邮箱已被使用'
    case 'Enter a valid password.':
      return '密码格式错误'
    case 'Email has not been signup.':
      return '该邮箱未注册'
    case 'confirm Password failed.':
      return '两次输入的密码不一致'
    case 'Unauthorized admin account.':
    case 'UnAuthorized Users':
      return '当前账号没有管理员权限'
    case 'Failed check fraud admin login':
      return '管理员权限校验失败'
    case '验证码发送失败':
    case '邮箱校验失败':
    case '注册失败':
    case '登录失败':
    case '重置密码失败':
      return message
    default:
      return shouldFallbackToChinese(message) ? fallback : message || fallback
  }
}

function validateEmail(value) {
  if (!value) return '请输入邮箱'
  if (!EMAIL_PATTERN.test(value)) return '请输入正确的电子邮件地址'
  return ''
}

function validatePassword(value) {
  if (!value) return '请输入密码'
  if (value.length < 8 || value.length > 15) return '密码长度需为 8-15 位'
  if (!PASSWORD_PATTERN.test(value)) return '密码仅支持字母、数字和 @._-'
  return ''
}

function focusFirstInvalidField(form) {
  window.requestAnimationFrame(() => form?.querySelector('[aria-invalid="true"]')?.focus())
}

function normalizeRegisterError(message) {
  switch (message) {
    case 'All fields must be filled and not empty.':
      return { global: '请完整填写注册信息' }
    case 'Enter a valid email.':
      return { email: '邮箱格式错误' }
    case 'Wrong Email verification code.':
      return { verificationCode: '邮箱验证码错误' }
    case 'Email verification code has expired.':
      return { verificationCode: '验证码已过期，请重新获取' }
    case 'Email verification code not found.':
      return { verificationCode: '请先获取邮箱验证码' }
    case 'Username is already taken.':
      return { userName: '该用户名已被使用' }
    case 'Email is already in use.':
      return { email: '该邮箱已被使用' }
    case 'Enter a valid password.':
      return { password: '密码格式错误' }
    default:
      return { global: normalizeAuthMessage(message, '注册失败') }
    }
}

function normalizeResetError(message) {
  switch (message) {
    case 'All fields must be filled and not empty.':
      return { global: '请完整填写找回密码信息' }
    case 'Enter a valid email.':
      return { forgetEmail: '邮箱格式错误' }
    case 'Wrong Email verification code.':
      return { forgetEmailVerification: '邮箱验证码错误' }
    case 'Email verification code has expired.':
      return { forgetEmailVerification: '验证码已过期，请重新获取' }
    case 'Email verification code not found.':
      return { forgetEmailVerification: '请先获取邮箱验证码' }
    case 'Email has not been signup.':
      return { forgetEmail: '该邮箱未注册' }
    case 'confirm Password failed.':
      return { forgetConfirmPassword: '两次输入的新密码不一致' }
    case 'Enter a valid password.':
      return { forgetNewPassword: '新密码格式错误' }
    default:
      return { global: normalizeAuthMessage(message, '重置密码失败') }
  }
}

function resolveForgetEmailCheckMessage(result) {
  if (!result) return ''
  if (result.duplicate === 'error') {
    return normalizeAuthMessage(result.error || result.message, '该邮箱未注册')
  }
  return ''
}

function AuthMessage({ id, message, tone = 'error' }) {
  if (!message) return null

  const icon = tone === 'success' ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />

  return (
    <div id={id} className={`auth-inline-message form-${tone} ${tone === 'success' ? 'is-success' : 'is-error'}`} role={tone === 'success' ? 'status' : 'alert'}>
      {icon}
      <span>{message}</span>
    </div>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const destination = loginDestination(location.search, location.state?.from)
  const reduceMotion = useReducedMotion()
  const tabRefs = useRef({})
  const mountedRef = useRef(false)
  const { isAuthenticated, login: loginAction } = useContext(AuthContext)
  const [mode, setMode] = useState('login')
  const [notice, setNotice] = useState('')

  const [loginForm, setLoginForm] = useState({
    login_email: '',
    login_password: '',
  })

  const [registerForm, setRegisterForm] = useState({
    userName: '',
    email: '',
    verificationCode: '',
    password: '',
    confirmPassword: '',
  })

  const [resetForm, setResetForm] = useState({
    forgetEmail: '',
    forgetEmailVerification: '',
    forgetNewPassword: '',
    forgetConfirmPassword: '',
  })

  const [loginError, setLoginError] = useState('')
  const [loginFieldErrors, setLoginFieldErrors] = useState({})
  const [registerErrors, setRegisterErrors] = useState({})
  const [resetErrors, setResetErrors] = useState({})
  const [registerCountdown, setRegisterCountdown] = useState(0)
  const [resetCountdown, setResetCountdown] = useState(0)
  const [registerCodePending, setRegisterCodePending] = useState(false)
  const [resetCodePending, setResetCodePending] = useState(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const assertAuthSubmission = (snapshot) => {
    const current = readAuthTokens()
    if (!mountedRef.current || current.access !== snapshot.access || current.refresh !== snapshot.refresh) {
      throw new AuthSessionChangedError()
    }
  }

  const authenticate = async (request, { payload, snapshot }) => {
    assertAuthSubmission(snapshot)
    const data = await request(payload)
    assertAuthSubmission(snapshot)
    return { data, snapshot }
  }

  const commitAuthentication = ({ data, snapshot }) => {
    // A public login/register response may outlive an account change in another tab.
    assertAuthSubmission(snapshot)
    localStorage.setItem('access_token', data.access)
    localStorage.setItem('refresh_token', data.refresh)
    loginAction()
    navigate(destination)
  }

  useEffect(() => {
    if (!registerCountdown) return undefined
    const timer = window.setTimeout(() => setRegisterCountdown((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [registerCountdown])

  useEffect(() => {
    if (!resetCountdown) return undefined
    const timer = window.setTimeout(() => setResetCountdown((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resetCountdown])

  const loginMutation = useMutation({
    mutationFn: (submission) => authenticate(login, submission),
    onSuccess: commitAuthentication,
    onError: (error) => {
      if (!mountedRef.current) return
      setLoginError(normalizeAuthMessage(error.message, '登录失败，请检查邮箱和密码'))
    },
  })

  const registerMutation = useMutation({
    mutationFn: (submission) => authenticate(register, submission),
    onSuccess: commitAuthentication,
    onError: (error) => {
      if (!mountedRef.current) return
      setRegisterErrors(normalizeRegisterError(error.message))
    },
  })

  const resetMutation = useMutation({
    mutationFn: forgetPassword,
    onSuccess: () => {
      setMode('login')
      window.requestAnimationFrame(() => tabRefs.current.login?.focus())
      setNotice('密码已重置，请使用新密码登录')
      setResetErrors({})
      setResetForm({
        forgetEmail: '',
        forgetEmailVerification: '',
        forgetNewPassword: '',
        forgetConfirmPassword: '',
      })
      setLoginForm((current) => ({
        ...current,
        login_email: resetForm.forgetEmail.trim(),
      }))
    },
    onError: (error) => {
      setResetErrors(normalizeResetError(error.message))
    },
  })

  if (isAuthenticated) {
    return <Navigate replace to={destination} />
  }

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setNotice('')
    setLoginError('')
    setLoginFieldErrors({})
    setRegisterErrors({})
    setResetErrors({})
  }

  const handleTabKeyDown = (event, index) => {
    let nextIndex
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % AUTH_MODES.length
    else if (event.key === 'ArrowLeft') nextIndex = (index + AUTH_MODES.length - 1) % AUTH_MODES.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = AUTH_MODES.length - 1
    else return
    event.preventDefault()
    const nextMode = AUTH_MODES[nextIndex].key
    switchMode(nextMode)
    tabRefs.current[nextMode]?.focus()
  }

  const checkRegisterField = async (field, value) => {
    const trimmed = value.trim()

    if (field === 'userName' && !trimmed) {
      setRegisterErrors((current) => ({ ...current, userName: '请输入用户名' }))
      return false
    }

    if (field === 'email') {
      if (!trimmed) {
        setRegisterErrors((current) => ({ ...current, email: '请输入邮箱' }))
        return false
      }
      if (!EMAIL_PATTERN.test(trimmed)) {
        setRegisterErrors((current) => ({ ...current, email: '邮箱格式错误' }))
        return false
      }
    }

    try {
      const payload = field === 'userName' ? { userName: trimmed, email: null } : { userName: null, email: trimmed }
      const data = await signupCheck(payload)
      const key = field === 'userName' ? 'userName' : 'email'

      if (data?.duplicate === key) {
        setRegisterErrors((current) => ({
          ...current,
          [key]: key === 'userName' ? '该用户名已被使用' : '该邮箱已被使用',
        }))
        return false
      }

      setRegisterErrors((current) => ({ ...current, [key]: '' }))
      return true
    } catch (error) {
      setRegisterErrors((current) => ({ ...current, [field]: normalizeAuthMessage(error.message, '校验失败') }))
      return false
    }
  }

  const sendRegisterCode = async () => {
    if (registerCountdown || registerCodePending) return

    setNotice('')
    const emailOk = await checkRegisterField('email', registerForm.email)
    if (!emailOk) return

    setRegisterCodePending(true)
    try {
      await emailVerification({ email: registerForm.email.trim() })
      setRegisterCountdown(60)
      setNotice('注册验证码已发送，请检查邮箱')
      setRegisterErrors((current) => ({ ...current, verificationCode: '' }))
    } catch (error) {
      setRegisterErrors((current) => ({
        ...current,
        verificationCode: normalizeAuthMessage(error.message, '验证码发送失败'),
      }))
    } finally {
      setRegisterCodePending(false)
    }
  }

  const sendResetCode = async () => {
    if (resetCountdown || resetCodePending) return
    setNotice('')
    const email = resetForm.forgetEmail.trim()

    if (!email) {
      setResetErrors((current) => ({ ...current, forgetEmail: '请输入邮箱' }))
      return
    }

    if (!EMAIL_PATTERN.test(email)) {
      setResetErrors((current) => ({ ...current, forgetEmail: '邮箱格式错误' }))
      return
    }

    setResetCodePending(true)
    try {
      const checkResult = await forgetEmaillCheck({ email })
      const checkMessage = resolveForgetEmailCheckMessage(checkResult)

      if (checkMessage) {
        setResetErrors((current) => ({
          ...current,
          forgetEmail: checkMessage,
          forgetEmailVerification: '',
        }))
        return
      }

      await emailVerification({ email })
      setResetCountdown(60)
      setNotice('找回密码验证码已发送，请检查邮箱')
      setResetErrors((current) => ({ ...current, forgetEmail: '', forgetEmailVerification: '' }))
    } catch (error) {
      setResetErrors((current) => ({
        ...current,
        forgetEmail: normalizeAuthMessage(error.message, '邮箱校验失败'),
      }))
    } finally {
      setResetCodePending(false)
    }
  }

  const submitLogin = (event) => {
    event.preventDefault()
    setNotice('')
    setLoginError('')
    setLoginFieldErrors({})

    const login_email = loginForm.login_email.trim()
    const login_password = loginForm.login_password.trim()
    const nextErrors = {}

    const emailError = validateEmail(login_email)
    if (emailError) nextErrors.login_email = emailError
    if (!login_password) nextErrors.login_password = '请输入密码'

    if (Object.keys(nextErrors).length) {
      setLoginFieldErrors(nextErrors)
      focusFirstInvalidField(event.currentTarget)
      return
    }

    loginMutation.mutate({
      payload: { login_email, login_password },
      snapshot: readAuthTokens(),
    })
  }

  const submitRegister = async (event) => {
    event.preventDefault()
    setNotice('')
    setRegisterErrors({})

    const nextErrors = {}
    const userName = registerForm.userName.trim()
    const email = registerForm.email.trim()
    const verificationCode = registerForm.verificationCode.trim()
    const passwordError = validatePassword(registerForm.password)

    if (!userName) nextErrors.userName = '请输入用户名'
    if (!email) nextErrors.email = '请输入邮箱'
    if (email && !EMAIL_PATTERN.test(email)) nextErrors.email = '邮箱格式错误'
    if (!verificationCode) nextErrors.verificationCode = '请输入邮箱验证码'
    if (passwordError) nextErrors.password = passwordError
    if (registerForm.password !== registerForm.confirmPassword) nextErrors.confirmPassword = '两次输入的密码不一致'

    if (Object.keys(nextErrors).length) {
      setRegisterErrors(nextErrors)
      focusFirstInvalidField(event.currentTarget)
      return
    }

    registerMutation.mutate({
      payload: { userName, email, verificationCode, password: registerForm.password },
      snapshot: readAuthTokens(),
    })
  }

  const submitReset = (event) => {
    event.preventDefault()
    setNotice('')
    setResetErrors({})

    const nextErrors = {}
    const passwordError = validatePassword(resetForm.forgetNewPassword)

    if (!resetForm.forgetEmail.trim()) nextErrors.forgetEmail = '请输入邮箱'
    if (resetForm.forgetEmail.trim() && !EMAIL_PATTERN.test(resetForm.forgetEmail.trim())) {
      nextErrors.forgetEmail = '邮箱格式错误'
    }
    if (!resetForm.forgetEmailVerification.trim()) nextErrors.forgetEmailVerification = '请输入邮箱验证码'
    if (passwordError) nextErrors.forgetNewPassword = passwordError
    if (resetForm.forgetNewPassword !== resetForm.forgetConfirmPassword) {
      nextErrors.forgetConfirmPassword = '两次输入的新密码不一致'
    }

    if (Object.keys(nextErrors).length) {
      setResetErrors(nextErrors)
      focusFirstInvalidField(event.currentTarget)
      return
    }

    resetMutation.mutate({
      forgetEmail: resetForm.forgetEmail.trim(),
      forgetEmailVerification: resetForm.forgetEmailVerification.trim(),
      forgetNewPassword: resetForm.forgetNewPassword,
      forgetConfirmPassword: resetForm.forgetConfirmPassword,
    })
  }

  return (
    <main className="login-screen">
      <div className="login-layout">
      <section className="login-intro" aria-labelledby="login-intro-title">
        <div className="login-intro-brand">
          <span className="brand-mark"><img src="/evem-compass-solid.png" alt="" /></span>
          <span className="login-intro-wordmark">EVEM</span>
          <span className="login-intro-edition">EVE ECHOES TOOLKITS</span>
        </div>
        <p className="eyebrow">飞行员工具箱</p>
        <h1 id="login-intro-title" className="login-intro-title">新伊甸工作台</h1>
        <p className="login-intro-copy">从市场行情到工业估算，把每次出航需要的信息放在一起。</p>
        <ul className="login-capability-list">
          <li><ChartNoAxesCombined size={19} aria-hidden="true" /><div><strong>市场与工业</strong><span>价格曲线 · 制造估算 · 行星资源</span></div></li>
          <li><Compass size={19} aria-hidden="true" /><div><strong>星际行动</strong><span>星系导航 · 战术协作</span></div></li>
          <li><Users size={19} aria-hidden="true" /><div><strong>社区情报</strong><span>防诈查询 · 军团大厅 · 星海见闻</span></div></li>
        </ul>
      </section>
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.2 }}
        className="login-card auth-card"
      >
        <div className="login-brand">
          <span>
            <ShieldCheck size={18} />
          </span>
          <div>
            <h2>EVEM Toolkits</h2>
            <p>账号入口</p>
          </div>
        </div>

        <div className="auth-access-notice" role="note">
          <ShieldCheck size={17} aria-hidden="true" />
          <div><strong>{PUBLIC_READ_ACCESS_ENABLED ? '普通工具可作为访客浏览' : '当前部署的普通工具需要登录'}</strong><p>新邮箱可通过验证码注册。提交、保存和私人模块需要登录；管理与协作资源还需相应授权。</p></div>
        </div>
        {location.state?.reason === 'authentication' && <p className="auth-return-hint" role="status">此页面需要登录。完成登录后将返回刚才的页面。</p>}

        <div className="auth-tabs" role="tablist" aria-label="认证模式">
          {AUTH_MODES.map((tab, index) => (
            <button key={tab.key} ref={element => { tabRefs.current[tab.key] = element }} id={`auth-tab-${tab.key}`} type="button" role="tab" aria-selected={mode === tab.key} aria-controls={`auth-panel-${tab.key}`} tabIndex={mode === tab.key ? 0 : -1} className={`auth-tab ${mode === tab.key ? 'active' : ''}`} onClick={() => switchMode(tab.key)} onKeyDown={event => handleTabKeyDown(event, index)}>
              {tab.label}
            </button>
          ))}
        </div>

        {AUTH_MODES.filter(tab => tab.key !== mode).map(tab => <div key={tab.key} id={`auth-panel-${tab.key}`} role="tabpanel" aria-labelledby={`auth-tab-${tab.key}`} hidden />)}

        {mode === 'login' ? (
          <form id="auth-panel-login" role="tabpanel" aria-labelledby="auth-tab-login" className="auth-section" onSubmit={submitLogin} noValidate>
            <div className="field-row">
              <label htmlFor="login-email">邮箱</label>
              <input
                id="login-email"
                name="username"
                autoComplete="username"
                aria-invalid={Boolean(loginFieldErrors.login_email)}
                aria-describedby={loginFieldErrors.login_email ? 'login-email-error' : undefined}
                aria-label="邮箱"
                type="email"
                className="text-input"
                value={loginForm.login_email}
                onChange={(event) => {
                  const value = event.target.value
                  setLoginForm((current) => ({ ...current, login_email: value }))
                  setLoginFieldErrors((current) => ({ ...current, login_email: '' }))
                }}
                placeholder="输入邮箱地址"
                required
              />
              <AuthMessage id="login-email-error" message={loginFieldErrors.login_email} />
            </div>

            <div className="field-row">
              <label htmlFor="login-password">密码</label>
              <input
                id="login-password"
                name="password"
                autoComplete="current-password"
                aria-invalid={Boolean(loginFieldErrors.login_password)}
                aria-describedby={loginFieldErrors.login_password ? 'login-password-error' : undefined}
                aria-label="密码"
                type="password"
                className="text-input"
                value={loginForm.login_password}
                onChange={(event) => {
                  const value = event.target.value
                  setLoginForm((current) => ({ ...current, login_password: value }))
                  setLoginFieldErrors((current) => ({ ...current, login_password: '' }))
                }}
                placeholder="输入登录密码"
                required
              />
              <AuthMessage id="login-password-error" message={loginFieldErrors.login_password} />
            </div>

            <AuthMessage message={loginError} />
            <AuthMessage message={notice} tone="success" />

            <button className="primary-btn block" type="submit" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? '登录中...' : '登录'}
            </button>
          </form>
        ) : null}

        {mode === 'register' ? (
          <form id="auth-panel-register" role="tabpanel" aria-labelledby="auth-tab-register" className="auth-section" onSubmit={submitRegister} noValidate>
            <div className="auth-grid">
              <div className="field-row">
                <label htmlFor="register-username">用户名</label>
                <div className="auth-input-shell">
                  <UserRound size={15} />
                  <input
                    id="register-username"
                    name="username"
                    autoComplete="username"
                    aria-invalid={Boolean(registerErrors.userName)}
                    aria-describedby={registerErrors.userName ? 'register-username-error' : undefined}
                    aria-label="用户名"
                    type="text"
                    className="text-input auth-input"
                    value={registerForm.userName}
                    onChange={(event) => {
                      const value = event.target.value
                      setRegisterForm((current) => ({ ...current, userName: value }))
                      setRegisterErrors((current) => ({ ...current, userName: '' }))
                    }}
                    onBlur={() => checkRegisterField('userName', registerForm.userName)}
                    placeholder="输入用户名"
                    maxLength={20}
                    required
                  />
                </div>
                <AuthMessage id="register-username-error" message={registerErrors.userName} />
              </div>

              <div className="field-row">
                <label htmlFor="register-email">邮箱</label>
                <div className="auth-input-shell">
                  <Mail size={15} />
                  <input
                    id="register-email"
                    name="email"
                    autoComplete="email"
                    aria-invalid={Boolean(registerErrors.email)}
                    aria-describedby={registerErrors.email ? 'register-email-error' : undefined}
                    aria-label="邮箱"
                    type="email"
                    className="text-input auth-input"
                    value={registerForm.email}
                    onChange={(event) => {
                      const value = event.target.value
                      setRegisterForm((current) => ({ ...current, email: value }))
                      setRegisterErrors((current) => ({ ...current, email: '' }))
                    }}
                    onBlur={() => checkRegisterField('email', registerForm.email)}
                    placeholder="用于接收验证码"
                    required
                  />
                </div>
                <AuthMessage id="register-email-error" message={registerErrors.email} />
              </div>
            </div>

            <div className="field-row">
              <label htmlFor="register-code">邮箱验证码</label>
              <div className="auth-code-row">
                <input
                  id="register-code"
                  name="verificationCode"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  aria-invalid={Boolean(registerErrors.verificationCode)}
                  aria-describedby={registerErrors.verificationCode ? 'register-code-error' : undefined}
                  aria-label="邮箱验证码"
                  type="text"
                  className="text-input"
                  value={registerForm.verificationCode}
                  onChange={(event) => {
                    const value = event.target.value
                    setRegisterForm((current) => ({ ...current, verificationCode: value }))
                    setRegisterErrors((current) => ({ ...current, verificationCode: '' }))
                  }}
                  placeholder="输入邮箱验证码"
                  required
                />
                <button
                  type="button"
                  className="ghost-btn auth-code-btn"
                  onClick={sendRegisterCode}
                  disabled={registerCodePending || registerCountdown > 0}
                >
                  {registerCodePending ? '发送中...' : registerCountdown > 0 ? `${registerCountdown}s` : '发送验证码'}
                </button>
              </div>
              <AuthMessage id="register-code-error" message={registerErrors.verificationCode} />
            </div>

            <div className="auth-grid">
              <div className="field-row">
                <label htmlFor="register-password">密码</label>
                <input
                  id="register-password"
                  name="newPassword"
                  autoComplete="new-password"
                  aria-invalid={Boolean(registerErrors.password)}
                  aria-describedby={`register-password-hint${registerErrors.password ? ' register-password-error' : ''}`}
                  aria-label="密码"
                  type="password"
                  className="text-input"
                  value={registerForm.password}
                  onChange={(event) => {
                    const value = event.target.value
                    setRegisterForm((current) => ({ ...current, password: value }))
                    setRegisterErrors((current) => ({ ...current, password: '' }))
                  }}
                  placeholder="8-15 位"
                  required
                />
                <p id="register-password-hint" className="auth-field-hint">8–15 位，支持字母、数字和 @._-</p>
                <AuthMessage id="register-password-error" message={registerErrors.password} />
              </div>

              <div className="field-row">
                <label htmlFor="register-confirm-password">确认密码</label>
                <input
                  id="register-confirm-password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  aria-invalid={Boolean(registerErrors.confirmPassword)}
                  aria-describedby={registerErrors.confirmPassword ? 'register-confirm-password-error' : undefined}
                  aria-label="确认密码"
                  type="password"
                  className="text-input"
                  value={registerForm.confirmPassword}
                  onChange={(event) => {
                    const value = event.target.value
                    setRegisterForm((current) => ({ ...current, confirmPassword: value }))
                    setRegisterErrors((current) => ({ ...current, confirmPassword: '' }))
                  }}
                  placeholder="再次输入密码"
                  required
                />
                <AuthMessage id="register-confirm-password-error" message={registerErrors.confirmPassword} />
              </div>
            </div>

            <AuthMessage message={registerErrors.global} />
            <AuthMessage message={notice} tone="success" />

            <button className="primary-btn block" type="submit" disabled={registerMutation.isPending}>
              {registerMutation.isPending ? '注册中...' : '注册并登录'}
            </button>
          </form>
        ) : null}

        {mode === 'reset' ? (
          <form id="auth-panel-reset" role="tabpanel" aria-labelledby="auth-tab-reset" className="auth-section" onSubmit={submitReset} noValidate>
            <div className="field-row">
              <label htmlFor="reset-email">注册邮箱</label>
              <div className="auth-code-row">
                <input
                  id="reset-email"
                  name="username"
                  autoComplete="username"
                  aria-invalid={Boolean(resetErrors.forgetEmail)}
                  aria-describedby={resetErrors.forgetEmail ? 'reset-email-error' : undefined}
                  aria-label="注册邮箱"
                  type="email"
                  className="text-input"
                  value={resetForm.forgetEmail}
                  onChange={(event) => {
                    const value = event.target.value
                    setResetForm((current) => ({ ...current, forgetEmail: value }))
                    setResetErrors((current) => ({ ...current, forgetEmail: '' }))
                  }}
                  placeholder="输入已注册邮箱"
                  required
                />
                <button
                  type="button"
                  className="ghost-btn auth-code-btn"
                  onClick={sendResetCode}
                  disabled={resetCodePending || resetCountdown > 0}
                >
                  {resetCodePending ? '发送中...' : resetCountdown > 0 ? `${resetCountdown}s` : '发送验证码'}
                </button>
              </div>
              <AuthMessage id="reset-email-error" message={resetErrors.forgetEmail} />
            </div>

            <div className="field-row">
              <label htmlFor="reset-code">邮箱验证码</label>
              <input
                id="reset-code"
                name="verificationCode"
                autoComplete="one-time-code"
                inputMode="numeric"
                aria-invalid={Boolean(resetErrors.forgetEmailVerification)}
                aria-describedby={resetErrors.forgetEmailVerification ? 'reset-code-error' : undefined}
                aria-label="邮箱验证码"
                type="text"
                className="text-input"
                value={resetForm.forgetEmailVerification}
                onChange={(event) => {
                  const value = event.target.value
                  setResetForm((current) => ({ ...current, forgetEmailVerification: value }))
                  setResetErrors((current) => ({ ...current, forgetEmailVerification: '' }))
                }}
                placeholder="输入找回密码验证码"
                required
              />
              <AuthMessage id="reset-code-error" message={resetErrors.forgetEmailVerification} />
            </div>

            <div className="auth-grid">
              <div className="field-row">
                <label htmlFor="reset-password">新密码</label>
                <input
                  id="reset-password"
                  name="newPassword"
                  autoComplete="new-password"
                  aria-invalid={Boolean(resetErrors.forgetNewPassword)}
                  aria-describedby={`reset-password-hint${resetErrors.forgetNewPassword ? ' reset-password-error' : ''}`}
                  aria-label="新密码"
                  type="password"
                  className="text-input"
                  value={resetForm.forgetNewPassword}
                  onChange={(event) => {
                    const value = event.target.value
                    setResetForm((current) => ({ ...current, forgetNewPassword: value }))
                    setResetErrors((current) => ({ ...current, forgetNewPassword: '' }))
                  }}
                  placeholder="输入新密码"
                  required
                />
                <p id="reset-password-hint" className="auth-field-hint">8–15 位，支持字母、数字和 @._-</p>
                <AuthMessage id="reset-password-error" message={resetErrors.forgetNewPassword} />
              </div>

              <div className="field-row">
                <label htmlFor="reset-confirm-password">确认新密码</label>
                <input
                  id="reset-confirm-password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  aria-invalid={Boolean(resetErrors.forgetConfirmPassword)}
                  aria-describedby={resetErrors.forgetConfirmPassword ? 'reset-confirm-password-error' : undefined}
                  aria-label="确认新密码"
                  type="password"
                  className="text-input"
                  value={resetForm.forgetConfirmPassword}
                  onChange={(event) => {
                    const value = event.target.value
                    setResetForm((current) => ({ ...current, forgetConfirmPassword: value }))
                    setResetErrors((current) => ({ ...current, forgetConfirmPassword: '' }))
                  }}
                  placeholder="再次输入新密码"
                  required
                />
                <AuthMessage id="reset-confirm-password-error" message={resetErrors.forgetConfirmPassword} />
              </div>
            </div>

            <AuthMessage message={resetErrors.global} />
            <AuthMessage message={notice} tone="success" />

            <button className="primary-btn block" type="submit" disabled={resetMutation.isPending}>
              {resetMutation.isPending ? '提交中...' : '重置密码'}
            </button>
          </form>
        ) : null}

        <div className="auth-footer">
          <button type="button" className="ghost-btn auth-quick-btn" onClick={() => {
            const nextMode = mode === 'login' ? 'register' : 'login'
            switchMode(nextMode)
            tabRefs.current[nextMode]?.focus()
          }}>
            <RotateCcw size={14} />
            {mode === 'login' ? '切换到注册' : '返回登录'}
          </button>
          <p className="login-help">
            {PUBLIC_READ_ACCESS_ENABLED ? <>普通页面可直接进入 <Link to="/fraudlist">访客模式</Link>；私人模块仍需登录和授权。</> : '登录后可浏览普通工具；私人模块仍需相应授权。'}
          </p>
        </div>
      </motion.div>
      </div>
    </main>
  )
}
