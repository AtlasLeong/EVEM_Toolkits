import { Breadcrumb, Button } from "antd";
import { HomeOutlined, UserOutlined } from "@ant-design/icons";
import { Flex, Input, Typography } from "antd";
import styled from "styled-components";
import { useForm, Controller } from "react-hook-form";
import FormError from "../../ui/FormError";
import useChangePassword from "./useChangePassword";

const StyledInput = styled(Input.Password)`
  width: 400px;
`;

const StyledDiv = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 90px;
  height: 100%;
`;

function ChangePassword() {
  const {
    reset,
    formState: { errors },
    handleSubmit,
    control,
    setError,
  } = useForm({
    defaultValues: {
      oldPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });
  const changePassword = useChangePassword({ setError, reset });

  function onSubmit(data) {
    if (data.newPassword !== data.confirmPassword) {
      setError("confirmPassword", { message: "新密码与确认密码不一致" });
      return;
    }

    changePassword.mutate({
      oldPassword: data.oldPassword,
      newPassword: data.newPassword,
      confirmPassword: data.confirmPassword,
    });
  }

  return (
    <div>
      <Breadcrumb
        style={{ cursor: "default" }}
        items={[
          {
            title: <HomeOutlined />,
          },
          {
            title: (
              <>
                <UserOutlined />
                <span>用户设置</span>
              </>
            ),
          },
          {
            title: "修改密码",
          },
        ]}
      />
      <StyledDiv>
        <Flex vertical gap={16}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div>
              <Typography.Title level={5}>旧密码</Typography.Title>
              <Controller
                control={control}
                name="oldPassword"
                rules={{
                  required: "旧密码不能为空",
                  pattern: {
                    value: /^[A-Za-z0-9@._-]+$/,
                    message: "只能包含字母、数字、特殊字符“@”、“.”、“-”和“_”",
                  },
                  minLength: {
                    value: 8,
                    message: "密码长度必须长于8位",
                  },
                  maxLength: {
                    value: 15,
                    message: "密码长度不能长于15位",
                  },
                }}
                render={({ field }) => <StyledInput {...field} />}
              />
            </div>
            <FormError
              errors={errors}
              errorName={"oldPassword"}
              inlineBlock={true}
            />
            <div>
              <Typography.Title level={5}>新密码</Typography.Title>
              <Controller
                control={control}
                name="newPassword"
                rules={{
                  required: "新密码不能为空",
                  pattern: {
                    value: /^[A-Za-z0-9@._-]+$/,
                    message: "只能包含字母、数字、特殊字符“@”、“.”、“-”和“_”",
                  },
                  minLength: {
                    value: 8,
                    message: "密码长度必须长于8位",
                  },
                  maxLength: {
                    value: 15,
                    message: "密码长度不能长于15位",
                  },
                }}
                render={({ field }) => <StyledInput {...field} />}
              />
            </div>
            <FormError
              errors={errors}
              errorName={"newPassword"}
              inlineBlock={true}
            />
            <div>
              <Typography.Title level={5}>再次输入新密码</Typography.Title>
              <Controller
                control={control}
                name="confirmPassword"
                rules={{
                  required: "确认密码不能为空",
                  pattern: {
                    value: /^[A-Za-z0-9@._-]+$/,
                    message: "只能包含字母、数字、特殊字符“@”、“.”、“-”和“_”",
                  },
                  minLength: {
                    value: 8,
                    message: "密码长度必须长于8位",
                  },
                  maxLength: {
                    value: 15,
                    message: "密码长度不能长于15位",
                  },
                }}
                render={({ field }) => <StyledInput {...field} />}
              />
            </div>
            <FormError
              errors={errors}
              errorName={"confirmPassword"}
              inlineBlock={true}
            />
            <Flex gap={30} style={{ marginTop: "30px" }}>
              <Button
                type="primary"
                htmlType="submit"
                style={{ marginLeft: "240px" }}
              >
                提交
              </Button>
              <Button danger={true} onClick={() => reset()} htmlType="button">
                清除
              </Button>
            </Flex>
          </form>
        </Flex>
      </StyledDiv>
    </div>
  );
}

export default ChangePassword;
