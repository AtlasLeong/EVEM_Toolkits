/**
 * 根据指定列获取去重后的筛选列表
 * @param {Array} searchData - 需要搜索的数据数组
 * @param {String} filterColumn - 用于筛选的列名
 * @returns {Array} - 返回一个包含去重后的筛选项的数组，每个筛选项是一个对象，包含文本和值
 */
export function getFilterList(searchData, filterColumn) {
  // 使用 map 方法从 searchData 中提取出指定列（filterColumn）的值，形成一个新的数组 nameList
  const nameList = searchData?.map((resource) => resource[filterColumn]);

  // 使用 Set 对象对 nameList 数组进行去重，然后再将 Set 转换回数组形式
  const uniqueNames = [...new Set(nameList)];

  // 将去重后的 uniqueNames 数组映射成一个新的数组 FilterList，其中每个元素都是一个对象
  // 每个对象包含两个属性：text 和 value，都设置为 resourceName 的值
  const FilterList = uniqueNames?.map((resourceName) => ({
    text: resourceName,
    value: resourceName,
  }));

  // 返回构建好的 FilterList 数组
  return FilterList;
}
