import React, { useEffect, useState } from "react";
import styled from "styled-components";
import Logo from "../../ui/Logo";
import { FaArrowLeftLong } from "react-icons/fa6";
import { useForm } from "react-hook-form";
import FormError from "../../ui/FormError";
import useLogin from "./useLogin";
import SpinnerMini from "../../ui/SpinnerMini";
import useSignUpCheck from "./useSignUpCheck";
import useEmailVerification from "./useEmailVerification";
import useRegister from "./useRegister";
import useForgetPasswordCheck from "./useForgetPasswordCheck";
import useForgetPassword from "./useForgetPassword";

const Container = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  input {
    font-size: 16px !important; /* 防止 iOS 自动放大 */
  }
  input:focus,
  textarea:focus,
  select:focus {
    outline: none;
    outline-offset: none;
  }
`;
// Styled components
const Card = styled.div`
  width: 90%;
  height: 500px;
  background-color: white;
  border-radius: 0.5rem;
  margin: 1.25rem;
  margin-top: 30px;
`;

const CardTop = styled.div`
  width: 20rem;
  height: 12rem;
  color: white;
  border-radius: 0.5rem 0.5rem 0 0;
  text-align: center;
`;

const StyledReturn = styled.p`
  margin-left: 40px;
  cursor: pointer;
  display: flex;
  align-items: center;
  &:hover {
    text-decoration: underline;
  }
`;

const CardBottom = styled.div`
  text-align: center;
`;

const Input = styled.input`
  width: 80%;
  height: 40px;
  margin-top: 1rem;
  padding-left: 0.6rem;
  border-radius: 0.6rem;
  border: 0.1rem solid silver;
  outline: none;
  color: rgb(107, 107, 107);

  &:focus {
    outline: 2px solid #3e9597;
    border-color: #3e9597;
  }
`;

const Paragraph = styled.div`
  font-size: 0.8rem;
  margin-top: 1rem;
  white-space: pre-wrap;
`;

const StyledP = styled.p`
  margin-right: 0.5rem;
  font-size: 16px;
  color: #3e9597;
  &:hover {
    text-decoration: underline;
  }
`;
const StyledSpan = styled.span`
  margin-right: 0.5rem;
  font-size: 16px;
  color: #3e9597;
  &:hover {
    text-decoration: underline;
  }
`;

const EmailInputGroup = styled.div`
  position: relative;
  width: 80%;
  margin: 0rem auto 0;
  display: flex;
  align-items: center;
`;

const EmailInput = styled(Input)`
  width: 100%;
  padding-right: 110px; // 为按钮留出空间
`;

const EmailButton = styled.button`
  position: absolute;
  right: 2px;
  height: 36px;
  font-size: 14px;
  padding: 0 15px;
  border: none;
  border-radius: 6px;
  background-color: #3e9597;
  color: white;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  margin-bottom: 26.5px;

  &:hover {
    background-color: #328284;
  }
`;
const Button = styled.button`
  width: 18rem;
  height: 4rem;
  color: white;
  border-radius: 0.6rem;
  border: none;

  font-size: 16px;
  &:hover {
    box-shadow: 0.2rem 0.2rem 0 rgba(0, 0, 0, 0.3);
  }
`;

const FormContainer = styled.div`
  display: flex;
  flex-direction: column;
`;

// Login component
const LoginTop = styled(CardTop)`
  background: #3e9597;
  width: 100%;
`;

const LoginBottom = styled(CardBottom)`
  margin-top: 30px;
  height: 100%;

  button {
    background: #3e9597;
    margin-top: 3.6rem;
  }
`;
const TextWrapper = styled.div`
  font-size: 16px;
  margin-top: 20px;
`;

function MobileLogin() {
  const {
    register: registerLogin,
    handleSubmit: handleSubmitLogin,
    setError: setErrorLogin,
    formState: { errors: errorsLogin },
    reset: resetLogin,
  } = useForm();

  const {
    register: registerSignUp,
    handleSubmit: handleSubmitSignUp,
    setError: setErrorSignUp,
    watch: watchSignUp,
    formState: { errors: errorsSignUp },
  } = useForm();

  const {
    register: registerForgetPassword,
    setError: setErrorForgetPassword,
    formState: { errors: forgetError },
    handleSubmit: handleSubmitForgetPassword,
    reset,
    watch,
  } = useForm();

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

  const [loginState, setLoginState] = useState("login");
  const [isForgetPassword, setIsForgetPassword] = useState(true);
  const forgetEmailCheckMutation = useForgetPasswordCheck({
    setError: setErrorForgetPassword,
  });

  const loginUser = useLogin({ setError: setErrorLogin });
  const registerUser = useRegister({ setError: setErrorSignUp });
  const signupCheckMutation = useSignUpCheck({ setError: setErrorSignUp });
  const emailVerificationMutation = useEmailVerification({
    setError: setErrorSignUp,
  });

  const forgetPasswordMutation = useForgetPassword({
    setIsForgetPassword,
    setErrorForgetPassword,
    resetLogin: reset,
  });

  function handleForgetEmailCheck(email) {
    forgetEmailCheckMutation.mutate({ email });
  }
  function handleUserNameCheck(userName) {
    signupCheckMutation.mutate({ userName: userName, email: null });
  }

  function handleEmailCheck(email) {
    signupCheckMutation.mutate({ userName: null, email: email });
  }

  function onSubmitLogin(data) {
    loginUser.mutate({
      login_email: data.login_email,
      login_password: data.login_password,
    });
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
  function onSubimtForgetPassword(data) {
    if (data.forgetNewPassword !== data.forgetConfirmPassword) {
      setErrorForgetPassword("forgetConfirmPassword", {
        message: "新密码与确认密码不一致",
      });
      return;
    }
    forgetPasswordMutation.mutate({
      forgetEmail: data.forgetEmail,
      forgetEmailVerification: data.forgetEmailVerification,
      forgetNewPassword: data.forgetNewPassword,
      forgetConfirmPassword: data.forgetConfirmPassword,
    });
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

  function handleForgetEmailVerifictaion() {
    const emailValue = watch("forgetEmail"); // 获取邮箱输入框的值
    handleForgetEmailCheck(emailValue);
    if (!emailValue) {
      setErrorForgetPassword("forgetEmail", { message: "邮箱不能为空" });
    }

    if (forgetError?.forgetEmail?.message || !emailValue) {
      return;
    }

    setIsButtonDisabled(true);
    emailVerificationMutation.mutate({ email: emailValue });
    setCountdown(60);
    localStorage.setItem("startTime", Date.now());
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

  useEffect(() => {
    if (!isForgetPassword) {
      setLoginState("login");
    }
  }, [isForgetPassword]);

  return (
    <Container>
      {loginState === "login" && (
        <Card>
          <LoginTop>
            <Container>
              <Logo />
            </Container>
            <h2>欢迎登录</h2>
          </LoginTop>
          <LoginBottom>
            <FormContainer>
              <form onSubmit={handleSubmitLogin(onSubmitLogin)}>
                <Input
                  type="email"
                  placeholder="邮箱"
                  id="login_email"
                  {...registerLogin("login_email", {
                    required: "邮箱不能为空",
                    pattern: {
                      value: /\S+@\S+\.\S{1,}/,
                      message: "请输入正确的邮箱",
                    },
                  })}
                />
                <FormError errors={errorsLogin} errorName={"login_email"} />
                <Input
                  type="password"
                  id="login_password"
                  placeholder="密码"
                  {...registerLogin("login_password", {
                    required: "密码不能为空",
                  })}
                />
                <FormError errors={errorsLogin} errorName={"login_password"} />
                <Paragraph>
                  <StyledP
                    style={{ cursor: "pointer" }}
                    onClick={() => setLoginState("forgetPassWord")}
                  >
                    忘记密码?
                  </StyledP>
                </Paragraph>
                <Button type="submit">
                  {loginUser.isLoading ? <SpinnerMini /> : `登录`}
                </Button>
              </form>
            </FormContainer>

            <TextWrapper>
              加入EVEMTK?{" "}
              <StyledSpan onClick={() => setLoginState("register")}>
                注册
              </StyledSpan>
            </TextWrapper>
          </LoginBottom>
        </Card>
      )}
      {loginState === "register" && (
        <Card>
          <LoginTop>
            <Container>
              <Logo />
            </Container>
            <h2>加入社区</h2>
          </LoginTop>
          <LoginBottom>
            <div>
              <StyledReturn onClick={() => setLoginState("login")}>
                <FaArrowLeftLong />
                返回登录
              </StyledReturn>
            </div>
            <FormContainer>
              <form onSubmit={handleSubmitSignUp(onSubmitSignUp)}>
                <Input
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
                <Input
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
                <FormError errors={errorsSignUp} errorName={"email"} />
                <EmailInputGroup>
                  <EmailInput
                    type="text"
                    id="emailVerification"
                    placeholder="邮箱验证码"
                    {...registerSignUp("emailVerification", {
                      required: "邮箱验证码不能为空",
                    })}
                  />
                  <EmailButton
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
                  </EmailButton>
                </EmailInputGroup>
                <FormError
                  errors={errorsSignUp}
                  errorName={"emailVerification"}
                />

                <Input
                  type="password"
                  placeholder="密码"
                  id="password"
                  {...registerSignUp("password", {
                    required: "密码不能为空",
                    minLength: {
                      value: 8,
                      message: "密码长度必须处于8位-20位之间",
                    },
                    maxLength: {
                      value: 20,
                      message: "密码长度必须处于8位-20位之间",
                    },
                    pattern: {
                      value: /^[A-Za-z0-9@._-]+$/,
                      message: "只能包含字母、数字、特殊字符“@”、“.”、“-”和“_”",
                    },
                  })}
                />
                <FormError errors={errorsSignUp} errorName={"password"} />
                <Button type="subimt">注册</Button>
              </form>
            </FormContainer>
          </LoginBottom>
        </Card>
      )}
      {loginState === "forgetPassWord" && (
        <Card>
          <LoginTop>
            <Container>
              <Logo />
            </Container>
            <h2>重置密码</h2>
          </LoginTop>
          <LoginBottom>
            <div>
              <StyledReturn onClick={() => setLoginState("login")}>
                <FaArrowLeftLong />
                返回登录
              </StyledReturn>
            </div>
            <FormContainer>
              <form
                onSubmit={handleSubmitForgetPassword(onSubimtForgetPassword)}
              >
                <Input
                  type="email"
                  id="forgetEmail"
                  placeholder="邮箱"
                  {...registerForgetPassword("forgetEmail", {
                    required: "邮箱不能为空",
                    pattern: {
                      value: /\S+@\S+\.\S{1,}/,
                      message: "请输入正确的邮箱",
                    },
                  })}
                  onBlur={(e) => handleForgetEmailCheck(e.target.value)}
                />
                <FormError errors={forgetError} errorName={"forgetEmail"} />
                <EmailInputGroup>
                  <EmailInput
                    type="text"
                    id="forgetEmailVerification"
                    placeholder="邮箱验证码"
                    {...registerForgetPassword("forgetEmailVerification", {
                      required: "邮箱验证码不能为空",
                    })}
                  />
                  <EmailButton
                    type="button"
                    disabled={
                      isButtonDisabled || forgetError?.forgetEmail?.message
                    }
                    onClick={handleForgetEmailVerifictaion}
                    style={
                      isButtonDisabled || forgetError?.forgetEmail?.message
                        ? { cursor: "not-allowed" }
                        : { cursor: "pointer" }
                    }
                  >
                    {isButtonDisabled ? `${countdown}秒后可重发` : "发送验证码"}
                  </EmailButton>
                </EmailInputGroup>
                <FormError
                  errors={forgetError}
                  errorName={"forgetEmailVerification"}
                />
                <Input
                  type="password"
                  id="newPassword"
                  placeholder="新密码"
                  {...registerForgetPassword("forgetNewPassword", {
                    required: "新密码不能为空",
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
                <FormError
                  errors={forgetError}
                  errorName={"forgetNewPassword"}
                />
                <Input
                  type="password"
                  id="forgetConfirmPassword"
                  placeholder="再次输入新密码"
                  {...registerForgetPassword("forgetConfirmPassword", {
                    required: "新密码不能为空",
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
                <FormError
                  errors={forgetError}
                  errorName={"forgetConfirmPassword"}
                />
                <Button type="subimt">提交</Button>
              </form>
            </FormContainer>
          </LoginBottom>
        </Card>
      )}
    </Container>
  );
}

export default MobileLogin;
