import { useEffect, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import Logo from "../../ui/Logo";
import { useForm } from "react-hook-form";
import FormError from "../../ui/FormError";

import useEmailVerification from "./useEmailVerification";
import useSignUpCheck from "./useSignUpCheck";
import useRegister from "./useRegister";
import useLogin from "./useLogin";
import ForgetPassword from "./ForgetPassword";
const StyledComponent = styled.div`
  @import url("https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap");

  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: "Montserrat", sans-serif;
  font-size: 100%;

  background-color: #c9d6ff;
  background: linear-gradient(to right, #e2e2e2, #c9d6ff);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  height: 100vh;
`;

const Container = styled.div`
  background-color: #fff;
  border-radius: 30px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.35);
  position: relative;
  overflow: hidden;
  width: 960px;
  max-width: 100%;
  min-height: 600px;
  p {
    font-size: 14px;
    line-height: 20px;
    letter-spacing: 0.3px;
    margin: 20px 0;
  }
  span {
    font-size: 15px;
  }

  a {
    color: #333;
    font-size: 13px;
    text-decoration: none;
    margin: 15px 0 10px;
  }

  button {
    background-color: #512da8;
    color: #fff;
    font-size: 16px;
    padding: 10px 45px;
    border: 1px solid transparent;
    border-radius: 8px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    margin-top: 10px;
    cursor: pointer;
  }

  button.hidden {
    background-color: transparent;
    border-color: #fff;
  }

  form {
    background-color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 0 40px;
    height: 100%;
  }

  input {
    background-color: #eee;
    border: none;
    margin: 8px 0;
    padding: 10px 15px;
    font-size: 13px;
    border-radius: 8px;
    width: 100%;
    outline: none;
  }
`;

const Move = keyframes`
    0%, 49.99%{
        opacity: 0;
        z-index: 1;
    }
    50%, 100%{
        opacity: 1;
        z-index: 5;
    }
`;

const FormContainerSignUp = styled.div`
  position: absolute;
  top: 0;
  height: 100%;
  transition: all 0.6s ease-in-out;

  left: 0;
  width: 50%;
  opacity: 0;
  z-index: 1;
  ${($props) =>
    $props.$isActive &&
    css`
      transform: translateX(100%);
      opacity: 1;
      z-index: 5;
      animation: ${Move} 0.6s;
    `}
`;

const FormContainerSignIn = styled.div`
  position: absolute;
  top: 0;
  height: 100%;
  transition: all 0.6s ease-in-out;

  left: 0;
  width: 50%;
  z-index: 2;
  ${($props) =>
    $props.$isActive &&
    css`
      transform: translateX(100%);
    `}
`;

const ToggleContainer = styled.div`
  position: absolute;
  top: 0;
  left: 50%;
  width: 50%;
  height: 100%;
  overflow: hidden;
  transition: all 0.6s ease-in-out;
  border-radius: 150px 0 0 100px;
  z-index: 1000;
  ${($props) =>
    $props.$isActive &&
    css`
      transform: translateX(-100%);
      border-radius: 0 150px 100px 0;
    `}
`;

const Toggle = styled.div`
  background-color: #512da8;
  height: 100%;
  background: linear-gradient(to right, #5c6bc0, #512da8);
  color: #fff;
  position: relative;
  left: -100%;
  height: 100%;
  width: 200%;
  transform: translateX(0);
  transition: all 0.6s ease-in-out;
  ${($props) =>
    $props.$isActive &&
    css`
      transform: translateX(50%);
    `}
`;

const TogglePanelLeft = styled.div`
  position: absolute;
  width: 50%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 0 30px;
  text-align: center;
  top: 0;
  transform: translateX(0);
  transition: all 0.6s ease-in-out;
  transform: translateX(-200%);
  ${($props) =>
    $props.$isActive &&
    css`
      transform: translateX(0);
    `}
`;
const TogglePanelRight = styled.div`
  position: absolute;
  width: 50%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 0 30px;
  text-align: center;
  top: 0;
  transform: translateX(0);
  transition: all 0.6s ease-in-out;
  right: 0;
  transform: translateX(0);
  ${($props) =>
    $props.$isActive &&
    css`
      transform: translateX(200%);
    `}
`;
const EmailInputGroup = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  gap: 10px;
  button {
    height: 39.5px;
    font-size: 14px;
    padding: 0px 15px;
    border: 1px solid transparent;
    border-radius: 8px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    margin: 0%;

    white-space: nowrap;
  }
`;

function LoginPage() {
  const [isActive, setIsActive] = useState(false);
  const [isForgetPassword, setIsForgetPassword] = useState();
  const [countdown, setCountdown] = useState(() => {
    const startTime = localStorage.getItem("startTime");
    if (!startTime) {
      return 60;
    }
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    return Math.max(60 - elapsedSeconds, 0);
  });
  const [isButtonDisabled, setIsButtonDisabled] = useState(() => {
    const startTime = localStorage.getItem("startTime");
    return startTime !== null && countdown > 0;
  });

  // Separate useForm instances for signup and login
  const {
    register: registerSignUp,
    handleSubmit: handleSubmitSignUp,
    setError: setErrorSignUp,
    watch: watchSignUp,
    formState: { errors: errorsSignUp },
  } = useForm();
  const {
    register: registerLogin,
    handleSubmit: handleSubmitLogin,
    setError: setErrorLogin,
    formState: { errors: errorsLogin },
    reset: resetLogin,
  } = useForm();

  const emailVerificationMutation = useEmailVerification({
    setError: setErrorSignUp,
  });
  const signupCheckMutation = useSignUpCheck({ setError: setErrorSignUp });
  const registerUser = useRegister({ setError: setErrorSignUp });
  const loginUser = useLogin({ setError: setErrorLogin });

  function handleEmailCheck(email) {
    signupCheckMutation.mutate({ userName: null, email: email });
  }
  function handleUserNameCheck(userName) {
    signupCheckMutation.mutate({ userName: userName, email: null });
  }

  function handleEmailVerification() {
    const emailValue = watchSignUp("email"); // 获取邮箱输入框的值
    handleEmailCheck(emailValue);
    if (!emailValue) {
      setErrorSignUp("email", { message: "邮箱不能为空" });
    }

    if (errorsSignUp?.email?.message || !emailValue) {
      return;
    }

    setIsButtonDisabled(true);
    emailVerificationMutation.mutate({ email: emailValue });
    setCountdown(60);
    localStorage.setItem("startTime", Date.now());
  }

  function onSubmitSignUp(data) {
    registerUser.mutate({
      userName: data.userName,
      verificationCode: data.emailVerification,
      email: data.email,
      password: data.password,
      eve_id: data.eve_id,
    });
  }

  function onSubmitLogin(data) {
    loginUser.mutate({
      login_email: data.login_email,
      login_password: data.login_password,
    });
  }

  useEffect(() => {
    if (isButtonDisabled && countdown > 0) {
      const timer = setInterval(() => {
        setCountdown(countdown - 1);
      }, 1000);

      return () => {
        clearInterval(timer);
      };
    }

    if (countdown === 0) {
      setIsButtonDisabled(false);
      localStorage.removeItem("startTime");
    }
  }, [isButtonDisabled, countdown]);

  return (
    <StyledComponent>
      <Container>
        <FormContainerSignUp $isActive={isActive}>
          <form onSubmit={handleSubmitSignUp(onSubmitSignUp)}>
            <h1>创建新用户</h1>
            <span>使用邮箱注册新账号</span>
            <input
              type="text"
              id="userName"
              placeholder="用户名"
              {...registerSignUp("userName", {
                required: "用户名不能为空",
                pattern: {
                  value: /^[A-Za-z0-9@._-]+$/,
                  message: "只能包含字母、数字、特殊字符“@”、“.”、“-”和“_”",
                },
              })}
              onBlur={(e) => handleUserNameCheck(e.target.value)}
            />
            <FormError errors={errorsSignUp} errorName={"userName"} />
            <EmailInputGroup>
              <input
                type="email"
                id="email"
                placeholder="邮箱"
                {...registerSignUp("email", {
                  required: "邮箱不能为空",
                  pattern: {
                    value: /\S+@\S+\.\S{1,}/,
                    message: "请输入正确的邮箱",
                  },
                })}
                onBlur={(e) => handleEmailCheck(e.target.value)}
              />
              <button
                type="button"
                disabled={isButtonDisabled || errorsSignUp?.email?.message}
                onClick={handleEmailVerification}
                style={
                  isButtonDisabled || errorsSignUp?.email?.message
                    ? { cursor: "not-allowed" }
                    : { cursor: "pointer" }
                }
              >
                {isButtonDisabled ? `${countdown}秒后可重发` : "发送验证码"}
              </button>
            </EmailInputGroup>
            <FormError errors={errorsSignUp} errorName={"email"} />
            <input
              type="text"
              id="emailVerification"
              placeholder="邮箱验证码"
              {...registerSignUp("emailVerification", {
                required: "邮箱验证码不能为空",
              })}
            />
            <FormError errors={errorsSignUp} errorName={"emailVerification"} />
            <input
              type="password"
              placeholder="密码"
              id="password"
              {...registerSignUp("password", {
                required: "密码不能为空",
                minLength: {
                  value: 8,
                  message: "密码长度必须长于8位",
                },
                pattern: {
                  value: /^[A-Za-z0-9@._-]+$/,
                  message: "只能包含字母、数字、特殊字符“@”、“.”、“-”和“_”",
                },
              })}
            />
            <FormError errors={errorsSignUp} errorName={"password"} />
            <input
              type="text"
              id="eve_id"
              placeholder="游戏ID(选填)"
              {...registerSignUp("eve_id", {
                pattern: {
                  value: /^\d+$/,
                  message: "游戏ID只能包含数字",
                },
                maxLength: {
                  value: 15,
                  massage: "游戏ID过长",
                },
              })}
            />
            <FormError errors={errorsSignUp} errorName={"eve_id"} />
            <button type="submit">注册</button>
          </form>
        </FormContainerSignUp>
        <FormContainerSignIn $isActive={isActive}>
          {isForgetPassword ? (
            <ForgetPassword
              setIsForgetPassword={setIsForgetPassword}
              countdown={countdown}
              isButtonDisabled={isButtonDisabled}
              setIsButtonDisabled={setIsButtonDisabled}
              setCountdown={setCountdown}
              emailVerificationMutation={emailVerificationMutation}
              resetLogin={resetLogin}
            />
          ) : (
            <form onSubmit={handleSubmitLogin(onSubmitLogin)}>
              <div
                style={{
                  marginLeft: "80px",
                  marginBottom: "20px",
                }}
              >
                <Logo />
              </div>
              <input
                type="email"
                id="login_email"
                placeholder="邮箱"
                {...registerLogin("login_email", {
                  required: "邮箱不能为空",
                  pattern: {
                    value: /\S+@\S+\.\S{1,}/,
                    message: "请输入正确的邮箱",
                  },
                })}
              />
              <FormError errors={errorsLogin} errorName={"login_email"} />
              <input
                type="password"
                id="login_password"
                placeholder="密码"
                {...registerLogin("login_password", {
                  required: "密码不能为空",
                })}
              />
              <FormError errors={errorsLogin} errorName={"login_password"} />
              <p
                onClick={() => setIsForgetPassword(true)}
                style={{ cursor: "pointer" }}
              >
                忘记密码?
              </p>
              <button type="submit">登录</button>
            </form>
          )}
        </FormContainerSignIn>
        <ToggleContainer $isActive={isActive}>
          <Toggle $isActive={isActive}>
            <TogglePanelLeft $isActive={isActive}>
              <h1>欢迎回来！</h1>
              <p>登入账号以使用网站的所有功能</p>
              <button className="hidden" onClick={() => setIsActive(false)}>
                登录
              </button>
            </TogglePanelLeft>
            <TogglePanelRight $isActive={isActive}>
              <h1>你好，新朋友!</h1>
              <p>请输入注册详细信息以创建用户</p>
              <button className="hidden" onClick={() => setIsActive(true)}>
                注册
              </button>
            </TogglePanelRight>
          </Toggle>
        </ToggleContainer>
      </Container>
    </StyledComponent>
  );
}

export default LoginPage;
