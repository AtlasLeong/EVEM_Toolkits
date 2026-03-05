import { jwtDecode } from "jwt-decode";

export function getUserInfo() {
  const userToken = localStorage.getItem("refresh_token");

  if (!userToken) {
    return null; // 如果没有 refresh_token，直接返回 null
  }

  try {
    const decodedToken = jwtDecode(userToken);

    const userName = decodedToken.userName;
    const userId = decodedToken.user_id;

    return { userName, userId };
  } catch (error) {
    console.error("Error decoding token:", error);
    return null; // 如果解码失败，返回 null
  }
}
