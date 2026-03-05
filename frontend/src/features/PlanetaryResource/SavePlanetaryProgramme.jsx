import { Input, Button } from "antd";
import FormError from "../../ui/FormError";
import { useForm, Controller } from "react-hook-form";
import styled from "styled-components";
import useSaveProgramme from "./useSaveProgramme";
import SpinnerMini from "../../ui/SpinnerMini";

const { TextArea } = Input;

const ButtonGroup = styled.div`
  display: flex;
  margin-top: 30px;
  gap: 10px;
`;

function SavePlanetaryProgramme({
  onCloseModal,
  calculatorData,
  handleSetProgremma,
}) {
  const {
    control,
    formState: { errors },
    handleSubmit,
  } = useForm();

  const saveProgramme = useSaveProgramme({ onCloseModal, handleSetProgremma });

  function onSubmitForm(data) {
    saveProgramme.mutate({
      calculatorData: { data: [...calculatorData], ...data },
    });
  }

  return (
    <div>
      <h3 style={{ marginBottom: "5px" }}>保存行星资源方案</h3>
      <form onSubmit={handleSubmit(onSubmitForm)}>
        <label htmlFor="programmeName">方案名称</label>
        <Controller
          name="programmeName"
          control={control}
          defaultValue=""
          rules={{ required: "方案名称不能为空" }}
          render={({ field }) => (
            <Input {...field} showCount maxLength={15} id="programmeName" />
          )}
        />
        <FormError errors={errors} errorName="programmeName" />

        <label htmlFor="programmeDesc">方案描述</label>
        <Controller
          name="programmeDesc"
          control={control}
          defaultValue=""
          render={({ field }) => (
            <TextArea
              {...field}
              rows={6}
              showCount
              maxLength={100}
              id="programmeDesc"
            />
          )}
        />
        <FormError errors={errors} errorName="programmeDesc" />

        <ButtonGroup>
          <Button
            htmlType="submit"
            type="primary"
            style={{ marginLeft: "auto" }}
            disabled={saveProgramme.isLoading}
          >
            {saveProgramme.isLoading ? <SpinnerMini /> : "保存"}
          </Button>
          <Button htmlType="button" danger onClick={onCloseModal}>
            返回
          </Button>
        </ButtonGroup>
      </form>
    </div>
  );
}

export default SavePlanetaryProgramme;
