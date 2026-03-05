# 可通过该方法获取
def getPlanetResourcesList(base_url):
    data = [
        {
            "label": "船菜",
            "options": [
                {
                    "label": "光泽合金",
                    "value": "光泽合金",
                    "icon": base_url + "planet-nobg/Glossy-Alloys.png",
                },
                {
                    "label": "光彩合金",
                    "value": "光彩合金",
                    "icon": base_url + "planet-nobg/GlossyColor-Alloys.png",
                },
                {
                    "label": "闪光合金",
                    "value": "闪光合金",
                    "icon": base_url + "planet-nobg/Flash-Alloy.png",
                },
                {
                    "label": "浓缩合金",
                    "value": "浓缩合金",
                    "icon": base_url + "planet-nobg/Concentrated-Alloys.png",
                },
                {
                    "label": "精密合金",
                    "value": "精密合金",
                    "icon": base_url + "planet-nobg/Precision-Alloys.png",
                },
                {
                    "label": "杂色复合物",
                    "value": "杂色复合物",
                    "icon": base_url + "planet-nobg/Miscellaneous-Colour-Compounds.png",
                },
                {
                    "label": "纤维复合物",
                    "value": "纤维复合物",
                    "icon": base_url + "planet-nobg/Fibre-Compounds.png",
                },
                {
                    "label": "透光复合物",
                    "value": "透光复合物",
                    "icon": base_url + "planet-nobg/Translucent-Complexes.png",
                },
                {
                    "label": "多样复合物",
                    "value": "多样复合物",
                    "icon": base_url + "planet-nobg/Multi-colour-complexes.png",
                },
                {
                    "label": "光滑复合物",
                    "value": "光滑复合物",
                    "icon": base_url + "planet-nobg/Smooth-Complexes.png",
                },
                {
                    "label": "晶体复合物",
                    "value": "晶体复合物",
                    "icon": base_url + "planet-nobg/Crystal-Complexes.png",
                },
                {
                    "label": "黑暗复合物",
                    "value": "黑暗复合物",
                    "icon": base_url + "planet-nobg/Dark-Complexes.png",
                },
                {
                    "label": "基础金属",
                    "value": "基础金属",
                    "icon": base_url + "planet-nobg/Base-metals.png",
                },
                {
                    "label": "重金属",
                    "value": "重金属",
                    "icon": base_url + "planet-nobg/Heavy-metals.png",
                },
                {
                    "label": "贵金属",
                    "value": "贵金属",
                    "icon": base_url + "planet-nobg/Precious-Metals.png",
                },
                {
                    "label": "反应金属",
                    "value": "反应金属",
                    "icon": base_url + "planet-nobg/Reactive-metals.png",
                },
                {
                    "label": "有毒金属",
                    "value": "有毒金属",
                    "icon": base_url + "planet-nobg/Toxic-metals.png",
                },
            ]
        },
        {
            "label": "建筑菜",
            "options": [
                {
                    "label": "活性气体",
                    "value": "活性气体",
                    "icon": base_url + "planet-nobg/Active-gases.png",
                },
                {
                    "label": "稀有气体",
                    "value": "稀有气体",
                    "icon": base_url + "planet-nobg/Rare-gases.png",
                },
                {
                    "label": "工业纤维",
                    "value": "工业纤维",
                    "icon": base_url + "planet-nobg/Industrial-Fibres.png",
                },
                {
                    "label": "超张力塑料",
                    "value": "超张力塑料",
                    "icon": base_url + "planet-nobg/Super-Tensioned-Plastics.png",
                },
                {
                    "label": "聚芳酰胺",
                    "value": "聚芳酰胺",
                    "icon": base_url + "planet-nobg/Polyarylamides.png",
                },
                {
                    "label": "冷却剂",
                    "value": "冷却剂",
                    "icon": base_url + "planet-nobg/Coolants.png",
                },
                {
                    "label": "凝缩液",
                    "value": "凝缩液",
                    "icon": base_url + "planet-nobg/Condensate.png",
                },
                {
                    "label": "建筑模块",
                    "value": "建筑模块",
                    "icon": base_url + "planet-nobg/Building-blocks.png",
                },
                {
                    "label": "纳米体",
                    "value": "纳米体",
                    "icon": base_url + "planet-nobg/Nanobodies.png",
                },
                {
                    "label": "硅结构铸材",
                    "value": "硅结构铸材",
                    "icon": base_url + "planet-nobg/Silicon-structural-castings.png",
                },
                {
                    "label": "灵巧单元建筑模块",
                    "value": "灵巧单元建筑模块",
                    "icon": base_url + "planet-nobg/Dexterity-Unit-Building-Blocks.png",
                },
                # {
                #     "label": "合成纺织品",
                #     "value": "合成纺织品",
                #     "icon": base_url + "planet-nobg/Synthetic-Textiles.png",
                # },
            ]
        },
        {
            "label": "燃料",
            "options": [
                {
                    "label": "重水",
                    "value": "重水",
                    "icon": base_url + "planet-nobg/Heavy-Water.png",
                },
                {
                    "label": "悬浮等离子",
                    "value": "悬浮等离子",
                    "icon": base_url + "planet-nobg/Suspended-Plasma.png",
                },
                {
                    "label": "液化臭氧",
                    "value": "液化臭氧",
                    "icon": base_url + "planet-nobg/Liquefied-ozone.png",
                },
                {
                    "label": "离子溶液",
                    "value": "离子溶液",
                    "icon": base_url + "planet-nobg/Ionic-solutions.png",
                },
                {
                    "label": "同位素燃料",
                    "value": "同位素燃料",
                    "icon": base_url + "planet-nobg/Isotope-fuels.png",
                },
                {
                    "label": "等离子体团",
                    "value": "等离子体团",
                    "icon": base_url + "planet-nobg/Plasma-Cluster.png",
                },
            ]
        },
        # Add more menu categories here
    ]
    return data
