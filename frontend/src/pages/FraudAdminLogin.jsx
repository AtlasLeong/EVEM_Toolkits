import { Button, Flex, Input } from "antd";
import { useNavigate } from "react-router-dom";
import { FaArrowLeftLong } from "react-icons/fa6";
import styled from "styled-components";
import { useContext, useEffect } from "react";
import { AuthContext } from "../context/AuthContext";
import { useCheckFraudAdmin } from "../features/FraudList/useCheckFraudAdmin";
import Spinner from "../ui/Spinner";
import { Controller, useForm } from "react-hook-form";
import FormError from "../ui/FormError";
import useFraudAdminLogin from "../features/FraudList/useFraudAdminLogin";

const StyledReturn = styled.p`
  margin-top: 20px;
  margin-left: 40px;
  cursor: pointer;
  display: flex;
  align-items: center;
  &:hover {
    text-decoration: underline;
  }
`;

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

const LoginContainer = styled.div`
  background-color: var(--color-grey-100);
  border-radius: 30px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.35);
  position: relative;
  overflow: hidden;
  width: 500px;
  max-width: 100%;
  min-height: 480px;
  backdrop-filter: blur(10px);
`;

const CustomFelxDiv = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
`;

const StyledInput = styled(Input)`
  width: 70%;
`;

const StyledP = styled.p`
  width: 100px;
  display: flex;
  justify-content: center;
  align-items: center;
`;

function FraudAdminLogin() {
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useContext(AuthContext);
  const { checkFraudLogin, isLoading } = useCheckFraudAdmin(isAuthenticated);
  const {
    reset,
    formState: { errors },
    handleSubmit,
    control,
    setError,
  } = useForm();

  const AdminLogin = useFraudAdminLogin({ setError });

  function onSubmit(data) {
    AdminLogin.mutate({
      adminEmail: data.adminEmail,
      adminPassword: data.adminPassword,
    });
    reset();
  }

  function handleIndex() {
    navigate("/");
  }

  useEffect(() => {
    if (checkFraudLogin?.message === "Authorized Users") {
      navigate("/fraudadmin");
    }
  }, [navigate, checkFraudLogin]);

  return (
    <StyledComponent>
      <LoginContainer>
        {isLoading ? (
          <CustomFelxDiv>
            <Spinner style={{ marginTop: "180px" }} />
          </CustomFelxDiv>
        ) : checkFraudLogin?.message === "UnAuthorized Users" ? (
          <>
            <StyledReturn onClick={handleIndex}>
              <FaArrowLeftLong />
              返回首页
            </StyledReturn>
            <CustomFelxDiv
              style={{ marginTop: "120px", flexDirection: "column" }}
            >
              <h2>非授权用户！</h2>
              <Button
                style={{ marginTop: "30px" }}
                danger={true}
                onClick={() => logout()}
              >
                登出
              </Button>
            </CustomFelxDiv>
          </>
        ) : (
          <>
            <form onSubmit={handleSubmit(onSubmit)}>
              <StyledReturn onClick={handleIndex}>
                <FaArrowLeftLong />
                返回首页
              </StyledReturn>
              <CustomFelxDiv
                style={{ marginTop: "70px", marginBottom: "30px" }}
              >
                <h2>名单管理登录</h2>
              </CustomFelxDiv>

              <CustomFelxDiv style={{ flexDirection: "column", gap: "20px" }}>
                <Controller
                  control={control}
                  name="adminEmail"
                  rules={{
                    required: "邮箱不能为空",
                  }}
                  render={({ field }) => (
                    <Flex style={{ whiteSpace: "pre" }}>
                      <StyledP>管理员邮箱 </StyledP>
                      <StyledInput {...field}></StyledInput>
                    </Flex>
                  )}
                />

                <Controller
                  control={control}
                  name="adminPassword"
                  rules={{
                    required: "密码不能为空",
                  }}
                  render={({ field }) => (
                    <Flex style={{ whiteSpace: "pre" }}>
                      <StyledP>密码 </StyledP>
                      <StyledInput.Password
                        {...field}
                        style={{ width: "65%" }}
                      />
                    </Flex>
                  )}
                />
              </CustomFelxDiv>
              <CustomFelxDiv style={{ marginTop: "5px" }}>
                <FormError
                  errors={errors}
                  errorName={"adminPassword"}
                  inlineBlock={true}
                />
              </CustomFelxDiv>
              <CustomFelxDiv style={{ marginTop: "30px" }}>
                <Button
                  size="large"
                  type="primary"
                  htmlType="submit"
                  loading={AdminLogin.isLoading}
                >
                  登录
                </Button>
              </CustomFelxDiv>
            </form>
          </>
        )}
      </LoginContainer>
    </StyledComponent>
  );
}

export default FraudAdminLogin;
