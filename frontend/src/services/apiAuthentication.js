import API_URL from "./backendSetting";
import fetchWithAuth from "./fetchWithAuth";

export async function register({
  userName,
  email,
  password,
  verificationCode,
}) {
  const res = await fetch(`${API_URL}/user/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userName, email, password, verificationCode }),
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error);
  }
  const data = await res.json();
  return data;
}

export async function login({ login_email, login_password }) {
  const res = await fetch(`${API_URL}/user/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ login_email, login_password }),
  });
  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error);
  }
  const data = await res.json();
  return data;
}

export async function signupCheck(userName, email) {
  const res = await fetch(`${API_URL}/user/signupcheck`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(userName, email),
  });
  if (!res.ok) {
    throw new Error("Error to check signup info");
  }
  const data = await res.json();
  return data;
}

export async function emailVerification(email) {
  const res = await fetch(`${API_URL}/user/emailcode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(email),
  });
  if (!res.ok) {
    throw new Error("Error to send email verification code");
  }
  const data = await res.json();
  return data;
}

export async function changePassword(
  oldPassword,
  newPassword,
  confirmPassword
) {
  const res = await fetchWithAuth(`${API_URL}/user/changepwd`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(oldPassword, newPassword, confirmPassword),
  });
  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.error);
  }
  const data = await res.json();
  return data;
}

export async function forgetEmaillCheck(email) {
  const res = await fetch(`${API_URL}/user/forgetemailcheck`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(email),
  });
  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.error);
  }
  const data = await res.json();
  return data;
}

export async function forgetPassword(
  forgetEmail,
  forgetEmailVerification,
  newPassword,
  confirmPassword
) {
  const res = await fetch(`${API_URL}/user/forgetPassword`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      forgetEmail,
      forgetEmailVerification,
      newPassword,
      confirmPassword
    ),
  });
  if (!res.ok) {
    const errorMessage = await res.json();
    throw new Error(errorMessage.error);
  }
  const data = await res.json();
  return data;
}
