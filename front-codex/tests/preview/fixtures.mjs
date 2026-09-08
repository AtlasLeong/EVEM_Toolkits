// Local visual-QA fixtures only. No production data or network calls.
const icon = '/preview-assets/Glossy-Alloys.png'
export const resources = [{ label: '船菜', options: [
  { label: '光泽合金', value: '光泽合金', icon },
  { label: '光彩合金', value: '光彩合金', icon: '/preview-assets/GlossyColor-Alloys.png' },
  { label: '基础金属', value: '基础金属', icon: '/preview-assets/Base-metals.png' },
] }, { label: '燃料', options: [{ label: '重水', value: '重水', icon: '/preview-assets/Heavy-Water.png' }] }]
const locations = [
  ['伏尔戈', 0.59, '米沃拉', 0.2, '夫斯库仑', 0.22, 'III', 29.74, 4],
  ['伏尔戈', 0.59, '以哈塔罗', 0.44, '米瑟约亚', 0.31, 'VI', 26.77, 3],
  ['德里克', 0.5, '玛莫纳', 0.16, '库哈拉赫', 0.18, 'V', 30.63, 4],
  ['静寂谷', -0.29, 'F-V9QW', -0.77, 'Y-ZXIO', -1.1, 'II', 46.4, 4],
  ['赛克特', 0.42, '门什尤', 0.05, 'J223742', -0.08, 'IV', 18.15, 2],
  ['卡多尔', 0.34, '辛迪加', 0.27, '艾玛克恩', 0.24, 'II', 24.82, 3],
  ['埃索特里亚', 0.17, '费谢尔', 0.02, 'N-5WQ6', -0.15, 'I', 15.66, 2],
  ['外环', -0.12, '贝莱特', -0.05, 'O-3DMQT', -0.16, 'III', 11.32, 1],
]
export const planetRows = locations.map(([region, region_security, constellation, constellation_security, solar_system, solar_system_security, planet_id, resource_yield, resource_level], i) => ({
  id: i + 1, resource_name: '光泽合金', resource_type: '船菜', icon, region, region_security,
  constellation, constellation_security, solar_system, solar_system_security, planet_id, resource_yield, resource_level, fuel_value: 0,
}))
export const systems = locations.map((row, i) => ({ system_id: i + 1, zh_name: row[4], en_name: ['FUSKUNEN', 'MITSOLEN', 'KUHALAH', 'Y-ZXIO', 'J223742', 'AYMA', 'N-5WQ6', 'O-3DMQT'][i],
  x: Math.cos(i * 1.4) * 2e16, y: 0, z: Math.sin(i * 1.4) * 1.5e16, security_status: row[5], region_id: 1, constellation_id: 11 }))
const records = [{ id: 1, fraud_account: '演示账号-0472', account_type: '游戏ID', fraud_type: '交易纠纷', source_group_id: 11, source_group_name: '本地演示交易群', remark: '仅用于界面验证，不对应真实用户', icon: '/favicon.png' }]
const reports = [{ id: 9, fraud_account: '演示账号-0831', account_type: 'QQ', contact_number: 'preview-only', report_status: 'pending', description: '本地演示举报，用于检查详情与表单布局。', create_time: '2026-09-08T04:30:00Z', evidence_dict: [] }]
let programmes = []
export function resolvePreviewRequest(url, method, body = {}) {
  const path = url.pathname
  const get = {
    '/api/planetresources': resources,
    '/api/regions': [{ r_id: 1, r_title: '伏尔戈', r_safetylvl: 0.59 }],
    '/api/constellations': [{ co_id: 11, co_title: '米沃拉', co_safetylvl: 0.2 }],
    '/api/solarsystem': [{ ss_id: 21, ss_title: '夫斯库仑', ss_safetylvl: 0.22 }],
    '/api/planetresourceprice': resources.flatMap(group => group.options.map(item => ({ resource_name: item.value, resource_type: group.label, resource_price: 1280 }))),
    '/api/boardsystems': systems,
    '/api/boardregions': [{ region_id: 1, zh_name: '伏尔戈' }],
    '/api/boardconstellations': [{ constellation_id: 11, region_id: 1, zh_name: '米沃拉', x: 0, y: 0, z: 0 }],
    '/api/boardstargate': systems.slice(1).map((item, i) => ({ system_id: systems[i].system_id, destination_system_id: item.system_id })),
    '/api/fraudadmincheck': { message: 'Authorized Users' },
    '/api/fraudadmingroup': [{ value: '11', label: '本地演示交易群' }],
    '/api/fraudadminlist': records,
    '/api/fraudlistreport': reports,
    '/api/fraudadminlistreport': reports,
    '/api/fraudbehaviorflow': [],
    '/api/license/codes/': { count: 1, results: [{ id: 1, code: 'LOCAL-PREVIEW-0472', is_active: true, expires_at: '2027-09-08T04:30:00Z', pc_identifier: null, remark: '本地演示', plan: { code: 'default', name: '默认组' }, extra_script_ids: [], permissions: { scripts: ['system_monitor', 'big_mining'] } }] },
  }
  if (method === 'GET' && path in get) return { status: 200, data: get[path] }
  if (path === '/api/programme') {
    if (method === 'GET') return { status: 200, data: url.searchParams.has('programme_id') ? programmes.filter(p => String(p.programme_id) === url.searchParams.get('programme_id')) : programmes }
    if (method === 'POST') { const p = { programme_id: programmes.length + 1, programme_name: body.programmeName, programme_desc: body.programmeDesc, programme_element: body.data }; programmes.push(p); return { status: 200, data: p } }
  }
  if (method === 'POST' && path === '/api/searchplanetresource') return { status: 200, data: planetRows }
  if (method === 'POST' && path === '/api/fraudsearch') return { status: 200, data: records }
  if (method === 'POST' && path === '/api/user/signupcheck') return { status: 200, data: { duplicate: null } }
  if (method === 'POST' && /\/user\/(login|fraudlogin)/.test(path)) return { status: 400, data: { error: '本地预览：请使用 previewRole 参数切换演示身份' } }
  if (method === 'POST' && path === '/api/jumppath') return { status: 200, data: [{ start: { system_id: 1, zh_name: systems[0].zh_name, move_type: '常规跳跃' }, end: { system_id: 2, zh_name: systems[1].zh_name, move_type: '常规跳跃' }, distance: '2.72' }] }
  return { status: 404, data: { error: '本地预览未配置此操作；没有连接生产服务器。' } }
}
