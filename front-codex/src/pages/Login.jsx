import { motion } from 'framer-motion'
import { CheckCircle2, CircleAlert, Mail, RotateCcw, ShieldCheck, UserRound } from 'lucide-react'
import { useContext, useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  emailVerification,
  forgetEmaillCheck,
  forgetPassword,
  login,
  register,
  signupCheck,
} from '../services/apiAuthentication'
import { AuthContext } from '../context/AuthContext'

const EMAIL_PATTERN = /\S+@\S+\.\S{1,}/
const PASSWORD_PATTERN = /^[A-Za-z0-9@._-]+$/

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

function normalizeRegisterError(message) {
  switch (message) {
    case 'All fields must be filled and not empty.':
      return { global: '请完整填写注册信息' }
    case 'Enter a valid email.':
      return { email: '邮箱格式错误' }
    case 'Wrong Email verification code.':
      return { verificationCode: '邮箱验证码错误' }
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

function AuthMessage({ message, tone = 'error' }) {
  if (!message) return null

  const icon = tone === 'success' ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />

  return (
    <div className={`auth-inline-message form-${tone} ${tone === 'success' ? 'is-success' : 'is-error'}`} role="alert" aria-live="polite">
      {icon}
      <span>{message}</span>
    </div>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
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
    mutationFn: login,
    onSuccess: (data) => {
      localStorage.setItem('access_token', data.access)
      localStorage.setItem('refresh_token', data.refresh)
      loginAction()
      navigate('/fraudlist')
    },
    onError: (error) => {
      setLoginError(normalizeAuthMessage(error.message, '登录失败，请检查邮箱和密码'))
    },
  })

  const registerMutation = useMutation({
    mutationFn: register,
    onSuccess: (data) => {
      localStorage.setItem('access_token', data.access)
      localStorage.setItem('refresh_token', data.refresh)
      loginAction()
      navigate('/fraudlist')
    },
    onError: (error) => {
      setRegisterErrors(normalizeRegisterError(error.message))
    },
  })

  const resetMutation = useMutation({
    mutationFn: forgetPassword,
    onSuccess: () => {
      setMode('login')
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
    return <Navigate replace to="/fraudlist" />
  }

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setNotice('')
    setLoginError('')
    setLoginFieldErrors({})
    setRegisterErrors({})
    setResetErrors({})
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
      await forgetEmaillCheck({ email })
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
      return
    }

    loginMutation.mutate({
      login_email,
      login_password,
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
      return
    }

    registerMutation.mutate({
      userName,
      email,
      verificationCode,
      password: registerForm.password,
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
    <div className="login-screen">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="login-card auth-card"
      >
        <div className="login-brand">
          <span>
            <ShieldCheck size={18} />
          </span>
          <div>
            <h1>EVEM Toolkits</h1>
            <p>账号入口</p>
          </div>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="认证模式">
          <button type="button" className={`auth-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => switchMode('login')}>
            登录
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => switchMode('register')}
          >
            注册
          </button>
          <button type="button" className={`auth-tab ${mode === 'reset' ? 'active' : ''}`} onClick={() => switchMode('reset')}>
            找回密码
          </button>
        </div>

        {mode === 'login' ? (
          <form className="auth-section" onSubmit={submitLogin} noValidate>
            <div className="field-row">
              <label>邮箱</label>
              <input
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
              <AuthMessage message={loginFieldErrors.login_email} />
            </div>

            <div className="field-row">
              <label>密码</label>
              <input
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
              <AuthMessage message={loginFieldErrors.login_password} />
            </div>

            <AuthMessage message={loginError} />
            <AuthMessage message={notice} tone="success" />

            <button className="primary-btn block" type="submit" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? '登录中...' : '登录'}
            </button>
          </form>
        ) : null}

        {mode === 'register' ? (
          <form className="auth-section" onSubmit={submitRegister} noValidate>
            <div className="auth-grid">
              <div className="field-row">
                <label>用户名</label>
                <div className="auth-input-shell">
                  <UserRound size={15} />
                  <input
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
                <AuthMessage message={registerErrors.userName} />
              </div>

              <div className="field-row">
                <label>邮箱</label>
                <div className="auth-input-shell">
                  <Mail size={15} />
                  <input
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
                <AuthMessage message={registerErrors.email} />
              </div>
            </div>

            <div className="field-row">
              <label>邮箱验证码</label>
              <div className="auth-code-row">
                <input
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
              <AuthMessage message={registerErrors.verificationCode} />
            </div>

            <div className="auth-grid">
              <div className="field-row">
                <label>密码</label>
                <input
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
                <AuthMessage message={registerErrors.password} />
              </div>

              <div className="field-row">
                <label>确认密码</label>
                <input
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
                <AuthMessage message={registerErrors.confirmPassword} />
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
          <form className="auth-section" onSubmit={submitReset} noValidate>
            <div className="field-row">
              <label>注册邮箱</label>
              <div className="auth-code-row">
                <input
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
              <AuthMessage message={resetErrors.forgetEmail} />
            </div>

            <div className="field-row">
              <label>邮箱验证码</label>
              <input
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
              <AuthMessage message={resetErrors.forgetEmailVerification} />
            </div>

            <div className="auth-grid">
              <div className="field-row">
                <label>新密码</label>
                <input
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
                <AuthMessage message={resetErrors.forgetNewPassword} />
              </div>

              <div className="field-row">
                <label>确认新密码</label>
                <input
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
                <AuthMessage message={resetErrors.forgetConfirmPassword} />
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
          <button type="button" className="ghost-btn auth-quick-btn" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
            <RotateCcw size={14} />
            {mode === 'login' ? '切换到注册' : '返回登录'}
          </button>
          <p className="login-help">
            仅浏览功能可直接进入 <Link to="/fraudlist">访客模式</Link>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
