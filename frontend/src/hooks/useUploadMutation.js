import { useMutation, useQueryClient } from "react-query";
import API_URL from "../services/backendSetting";
import fetchWithAuth from "../services/fetchWithAuth";
import { message } from "antd";

// 自定义上传 hook
export const useUploadMutation = () => {
  const queryClient = useQueryClient();

  return useMutation(
    async (file) => {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetchWithAuth(`${API_URL}/uploadimage/`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorMessage = await response.json();
        throw new Error(errorMessage.error);
      }

      return response.json();
    },
    {
      onSuccess: (data) => {
        // 可以在这里更新查询缓存
        queryClient.invalidateQueries("images");
        message.success("文件上传成功");
      },
      onError: (error) => {
        console.log(error.message);
        switch (error.message) {
          case "Invalid file type. Allowed types are JPEG, PNG, GIF, WEBP, BMP, SVG.":
            message.error("只支持 JPEG, PNG, GIF, WEBP, BMP, SVG 格式的图片");
            break;

          case "File size exceeds 2MB limit.":
            message.error("文件尺寸不能大于2MB");
            break;

          case "You have exceeded the daily limit of image uploads.":
            message.error("今日上传已到达上限");
            break;

          default:
            message.error(`文件上传失败，请联系管理员`);
            break;
        }
      },
    }
  );
};
