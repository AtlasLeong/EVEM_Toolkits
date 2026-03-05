import { useForm } from "react-hook-form";
import { HiArrowLeft } from "react-icons/hi2";
import FormError from "../../ui/FormError";

import styled from "styled-components";
import useForgetPasswordCheck from "./useForgetPasswordCheck";
import useForgetPassword from "./useForgetPassword";

const LinkP = styled.div`
  display: flex;
  align-items: center;
  font-size: 24px;
  cursor: pointer;
  margin: 40px 40px;
  &:hover {
    color: var(--color-blue-700);
    text-decoration: underline;
  }
`;
const EmailInputGroup = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  gap: 10px;
  button {
    height: 39.5px !important;
    font-size: 14px !important;
    padding: 0px 15px !important;
    border: 1px solid transparent !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
    letter-spacing: 0.5px !important;
    text-transform: uppercase !important;
    margin: 0% !important;
    white-space: nowrap !important;
  }
`;

const TitleDiv = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
`;

const ButtonGroup = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 20px;
`;

function ForgetPassword({
  setIsForgetPassword,
  isButtonDisabled,
  countdown,
  setIsButtonDisabled,
  setCountdown,
  emailVerificationMutation,
  resetLogin,
}) {
  const {
    register,
    setError,
    formState: { errors: forgetError },
    handleSubmit,
    watch,
  } = useForm();

  const forgetEmailCheckMutation = useForgetPasswordCheck({
    setError,
  });

  const forgetPasswordMutation = useForgetPassword({
    setError,
    setIsForgetPassword,
    resetLogin,
  });

  function onSubimt(data) {
    if (data.forgetNewPassword !== data.forgetConfirmPassword) {
      setError("forgetConfirmPassword", { message: "新密码与确认密码不一致" });
      return;
    }
    forgetPasswordMutation.mutate({
      forgetEmail: data.forgetEmail,
      forgetEmailVerification: data.forgetEmailVerification,
      forgetNewPassword: data.forgetNewPassword,
      forgetConfirmPassword: data.forgetConfirmPassword,
    });
  }

  function handleForgetEmailCheck(email) {
    forgetEmailCheckMutation.mutate({ email });
  }

  function handleForgetEmailVerifictaion() {
    const emailValue = watch("forgetEmail"); // 获取邮箱输入框的值
    handleForgetEmailCheck(emailValue);
    if (!emailValue) {
      setError("forgetEmail", { message: "邮箱不能为空" });
    }

    if (forgetError?.forgetEmail?.message || !emailValue) {
      return;
    }

    setIsButtonDisabled(true);
    emailVerificationMutation.mutate({ email: emailValue });
    setCountdown(60);
    localStorage.setItem("startTime", Date.now());
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <LinkP onClick={() => setIsForgetPassword(false)}>
        <HiArrowLeft />
        返回
      </LinkP>
      <TitleDiv>
        <h3>设置新密码</h3>
      </TitleDiv>
      <form onSubmit={handleSubmit(onSubimt)}>
        <EmailInputGroup>
          <input
            type="email"
            id="forgetEmail"
            placeholder="邮箱"
            {...register("forgetEmail", {
              required: "邮箱不能为空",
              pattern: {
                value: /\S+@\S+\.\S{1,}/,
                message: "请输入正确的邮箱",
              },
            })}
            onBlur={(e) => handleForgetEmailCheck(e.target.value)}
          />
          <button
            type="button"
            disabled={isButtonDisabled || forgetError?.forgetEmail?.message}
            onClick={handleForgetEmailVerifictaion}
            style={
              isButtonDisabled || forgetError?.forgetEmail?.message
                ? { cursor: "not-allowed" }
                : { cursor: "pointer" }
            }
          >
            {isButtonDisabled ? `${countdown}秒后可重发` : "发送验证码"}
          </button>
        </EmailInputGroup>
        <FormError errors={forgetError} errorName={"forgetEmail"} />
        <input
          type="text"
          id="emailVerification"
          placeholder="邮箱验证码"
          {...register("forgetEmailVerification", {
            required: "邮箱验证码不能为空",
          })}
        />
        <FormError errors={forgetError} errorName={"forgetEmailVerification"} />
        <input
          type="password"
          id="newPassword"
          placeholder="新密码"
          {...register("forgetNewPassword", {
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
        <FormError errors={forgetError} errorName={"forgetNewPassword"} />
        <input
          type="password"
          id="forgetConfirmPassword"
          placeholder="再次输入新密码"
          {...register("forgetConfirmPassword", {
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
        <FormError errors={forgetError} errorName={"forgetConfirmPassword"} />
        <ButtonGroup>
          <button type="submit">提交</button>
        </ButtonGroup>
      </form>
    </div>
  );
}

export default ForgetPassword;
