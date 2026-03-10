import API_URL from './backendSetting'
import fetchWithAuth from './fetchWithAuth'

async function parseError(response, fallback) {
  const errorData = await response.json().catch(() => ({}))
  throw new Error(errorData.error || errorData.message || fallback)
}

export async function register({ userName, email, password, verificationCode }) {
  const res = await fetch(`${API_URL}/user/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userName, email, password, verificationCode }),
  })

  if (!res.ok) {
    await parseError(res, '注册失败')
  }

  return res.json()
}

export async function login({ login_email, login_password }) {
  const res = await fetch(`${API_URL}/user/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ login_email, login_password }),
  })

  if (!res.ok) {
    await parseError(res, '登录失败')
  }

  return res.json()
}

export async function signupCheck({ userName = null, email = null } = {}) {
  const res = await fetch(`${API_URL}/user/signupcheck`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userName, email }),
  })

  if (!res.ok) {
    await parseError(res, '注册校验失败')
  }

  return res.json()
}

export async function emailVerification({ email } = {}) {
  const res = await fetch(`${API_URL}/user/emailcode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  })

  if (!res.ok) {
    await parseError(res, '验证码发送失败')
  }

  return res.json()
}

export async function changePassword({ oldPassword, newPassword, confirmPassword }) {
  const res = await fetchWithAuth(`${API_URL}/user/changepwd`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ oldPassword, newPassword, confirmPassword }),
  })

  if (!res.ok) {
    await parseError(res, '修改密码失败')
  }

  return res.json()
}

export async function forgetEmaillCheck({ email } = {}) {
  const res = await fetch(`${API_URL}/user/forgetemailcheck`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  })

  if (!res.ok) {
    await parseError(res, '邮箱校验失败')
  }

  return res.json()
}

export async function forgetPassword({
  forgetEmail,
  forgetEmailVerification,
  forgetNewPassword,
  forgetConfirmPassword,
}) {
  const res = await fetch(`${API_URL}/user/forgetPassword`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      forgetEmail,
      forgetEmailVerification,
      forgetNewPassword,
      forgetConfirmPassword,
    }),
  })

  if (!res.ok) {
    await parseError(res, '重置密码失败')
  }

  return res.json()
}
