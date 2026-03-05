import { Button, Input } from "antd";
import styled from "styled-components";
import { UploadOutlined } from "@ant-design/icons";
import { message, Upload, Steps } from "antd";
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import FormError from "../../ui/FormError";
import { useUploadMutation } from "../../hooks/useUploadMutation";
import { useGetFraudReportListByUserID } from "./useGetFraudReportListByUserID";
import { getUserInfo } from "../../services/getJWTUserInfo";
import FraudReportList from "./FraudReportList";
import useSubmitFraudReport from "./useSubmitFraudReport";

const Container = styled.div`
  width: 500px;
  height: 550px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow-y: auto;
`;

const ButtonContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 20px;
  gap: 40px;
`;

const StyledSteps = styled(Steps)`
  margin-top: 25px;
  margin-bottom: 20px;
`;

const allowedFileTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
];

const { TextArea } = Input;

function ReportModal() {
  const { fraudReportList, isLoading: isLoadingReportList } =
    useGetFraudReportListByUserID();
  const [showReportPage, setShowReportPage] = useState(false);
  const submitReport = useSubmitFraudReport({ setShowReportPage });

  const { userName } = getUserInfo() || "";
  const [reportUser, setReportUser] = useState(userName);
  const [fileList, setFileList] = useState([]);
  const {
    control,
    reset,
    setError,
    formState: { errors },
    handleSubmit,
  } = useForm();

  const uploadMutation = useUploadMutation();

  const handleUpload = ({ fileList: newFileList }) => {
    // 限制文件数量为5
    const limitedFileList = newFileList.slice(0, 5);
    setFileList(limitedFileList);

    // 如果用户尝试上传超过5张图片，显示警告消息
    if (newFileList.length > 5) {
      message.warning("最多只能上传5张图片");
    }
  };

  const customRequest = async ({ file, onSuccess, onError }) => {
    // 检查文件类型
    if (!allowedFileTypes.includes(file.type)) {
      message.error("只支持 JPEG, PNG, GIF, WEBP, BMP, SVG 格式的图片");
      onError(new Error("Unsupported file type"));
      return;
    }

    // 检查文件数量
    if (fileList.length >= 5) {
      message.error("最多只能上传5张图片");
      onError(new Error("Maximum file count reached"));
      return;
    }

    try {
      const result = await uploadMutation.mutateAsync(file);
      onSuccess(result, file);
    } catch (error) {
      onError(error);
    }
  };

  function handleSubmitForm(data) {
    if (fileList.length <= 0) {
      message.warning("证据不能为空");
      return;
    }

    submitReport.mutate({
      fraud_account: data.fraud_account,
      account_type: data.beReportAccountType,
      description: data.description,
      contact_number: data.contact,
      evidence_dict: fileList.map((item) => item.response.file_url),
    });
  }
  return (
    <>
      <Container>
        <div style={{ width: "95%" }}>
          {showReportPage ? (
            <>
              <StyledSteps
                current={1}
                items={[
                  {
                    title: "提交举报",
                    status: "process",
                  },
                  {
                    title: "等待审核",
                    status: "wait",
                  },
                  {
                    title: "举报成功",
                    status: "wait",
                  },
                ]}
                size="small"
              />
              <form onSubmit={handleSubmit(handleSubmitForm)}>
                <h3>诈骗举报</h3>
                <p>举报人：</p>
                <Input
                  disabled={true}
                  value={reportUser}
                  onChange={(e) => setReportUser(e.target.value)}
                ></Input>
                <p>诈骗账号：</p>

                <Controller
                  control={control}
                  name="fraud_account"
                  rules={{ required: "诈骗账号不能为空" }}
                  render={({ field }) => <Input {...field} />}
                />

                <FormError errors={errors} errorName={"fraud_account"} />
                <p>账号类型：</p>

                <Controller
                  control={control}
                  name="beReportAccountType"
                  rules={{ required: "账号类型不能为空" }}
                  render={({ field }) => (
                    <Input {...field} placeholder="QQ、咸鱼号等" />
                  )}
                />

                <FormError errors={errors} errorName={"beReportAccountType"} />
                <p>行为描述:</p>

                <Controller
                  control={control}
                  name="description"
                  rules={{ required: "行为描述不能为空" }}
                  render={({ field }) => (
                    <TextArea
                      showCount
                      maxLength={200}
                      allowClear
                      placeholder="请详细描述被举报人的账户信息与诈骗行为"
                      {...field}
                    ></TextArea>
                  )}
                />

                <FormError errors={errors} errorName={"description"} />
                <p>您的联系方式：</p>

                <Controller
                  control={control}
                  name="contact"
                  rules={{ required: "联系方式不能为空" }}
                  render={({ field }) => (
                    <Input placeholder="QQ号，其他联系方式请备注" {...field} />
                  )}
                />

                <FormError errors={errors} errorName={"contact"} />
                <p>证据（图片-聊天记录）其他证据请进群:97585354 </p>
                <Upload
                  customRequest={customRequest}
                  listType="picture"
                  fileList={fileList}
                  onChange={handleUpload}
                  className="upload-list-inline"
                  maxCount={5}
                  multiple={true}
                >
                  <Button icon={<UploadOutlined />}>上传（最多5张）</Button>
                </Upload>

                <ButtonContainer>
                  <Button
                    htmlType="button"
                    onClick={() => setShowReportPage(false)}
                  >
                    返回
                  </Button>
                  <Button
                    type="primary"
                    htmlType="submit"
                    onClick={handleSubmit}
                    loading={submitReport.isLoading}
                  >
                    提交
                  </Button>
                </ButtonContainer>
              </form>
            </>
          ) : (
            <FraudReportList
              fraudReportList={fraudReportList}
              isLoading={isLoadingReportList}
              setShowReportPage={setShowReportPage}
            ></FraudReportList>
          )}
        </div>
      </Container>
    </>
  );
}

export default ReportModal;
