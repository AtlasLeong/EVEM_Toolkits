import { useForm } from "react-hook-form";
import RegionsSelecter from "./RegionsSelecter";
import PlanetarySelecter from "./PlanetarySelecter";
import Button from "../../ui/Button";
import Form from "../../ui/Form";
import styled from "styled-components";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { searchPlanetResources } from "../../services/apiPlanetaryResource";
import ErrorMessage from "../../ui/ErrorMessage";

const ButtonContainer = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: auto; // 确保即使表单内容不足也能把按钮推到底部
  margin: 10px;
`;

function PlanetarySearchForm({ setSearchData, setIsSearching }) {
  const { control, handleSubmit, setValue, watch, reset, setError, formState } =
    useForm({
      defaultValues: {
        region: null,
        constellation: null,
        system: null,
        planetaryResource: null,
      },
    });
  const queryClient = useQueryClient();
  const { errors } = formState;

  const { isLoading: isSearchingData, mutate } = useMutation({
    mutationFn: (formObj) => searchPlanetResources(formObj),
    mutationKey: ["planet_result"],
    onSuccess: (data) => {
      setIsSearching(isSearchingData);
      queryClient.invalidateQueries({ queryKey: ["planet_result"] });
      setSearchData(data);
      reset();
    },
    onError: (err) => {
      throw Error(err);
    },
  });

  const onSubmit = (data) => {
    if (!data.planetaryResource && !data.region) {
      setError("planetaryResource", {
        type: "manual",
        message: "行星资源 与 星域 选项不能同时为空 ",
      });
    } else {
      setIsSearching(true);
      const processedData = {
        regionValue: data.region?.map((reg) => reg.value),
        constellationValue: data.constellation?.map((co) => co.value),
        systemValue: data.system?.map((ss) => ss.value),
        planetaryResources: data.planetaryResource,
      };

      mutate(processedData);
    }
  };

  return (
    <Form onSubmit={handleSubmit(onSubmit)}>
      <PlanetarySelecter
        planetaryField={{
          ...control.register("planetaryResource"),
          value: watch("planetaryResource"),
          onChange: (planetaryOption) =>
            setValue("planetaryResource", planetaryOption),
        }}
      />
      {errors?.planetaryResource && (
        <div>
          <ErrorMessage>{errors?.planetaryResource?.message}</ErrorMessage>
        </div>
      )}
      <RegionsSelecter
        regionField={{
          ...control.register("region"),
          value: watch("region"),
          onChange: (selectedOption) => setValue("region", selectedOption),
        }}
        constellationField={{
          ...control.register("constellation"),
          value: watch("constellation"),
          onChange: (selectedOption) =>
            setValue("constellation", selectedOption),
        }}
        systemField={{
          ...control.register("system"),
          value: watch("system"),
          onChange: (selectedOption) => setValue("system", selectedOption),
        }}
        setValue={setValue} // 传递setValue函数
      />
      <ButtonContainer>
        <Button
          type="reset"
          style={{ marginRight: "10px" }}
          onClick={() => reset()}
          disabled={isSearchingData}
        >
          清除
        </Button>
        <Button type="submit" disabled={isSearchingData}>
          提交
        </Button>
      </ButtonContainer>
    </Form>
  );
}

export default PlanetarySearchForm;
