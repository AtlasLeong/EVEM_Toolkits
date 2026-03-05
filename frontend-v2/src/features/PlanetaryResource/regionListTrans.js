export const constellationListTrans = (data) => {
  const transformedData = [];
  const regionData = {};

  data.forEach((item) => {
    const regionTitle = item.co_region_title;
    if (!regionData[regionTitle]) {
      regionData[regionTitle] = { label: regionTitle, options: [] };
    }

    regionData[regionTitle].options.push({
      co_id: item.co_id,
      co_title: item.co_title,
      co_safetylvl: item.co_safetylvl,
      co_region_id: item.co_region_id,
    });
  });

  for (const key in regionData) {
    transformedData.push(regionData[key]);
  }

  return transformedData;
};

export const solarsystemListTrans = (data) => {
  const transformedData = [];
  const constellationData = {};

  data.forEach((item) => {
    const constellationTitle = item.ss_constellation_title;
    if (!constellationData[constellationTitle]) {
      constellationData[constellationTitle] = {
        label: constellationTitle,
        options: [],
      };
    }

    constellationData[constellationTitle].options.push({
      ss_id: item.ss_id,
      ss_region_id: item.ss_region_id,
      ss_safetylvl: item.ss_safetylvl,
      ss_title: item.ss_title,
      ss_constellation_title: item.ss_constellation_title,
      ss_constellation_id: item.ss_constellation_id,
    });
  });

  for (const key in constellationData) {
    transformedData.push(constellationData[key]);
  }

  return transformedData;
};
