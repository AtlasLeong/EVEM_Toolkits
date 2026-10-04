export const SITE_NAME = 'EVEM 工具箱'
export const SITE_DESCRIPTION = 'EVE Echoes 玩家工具箱，提供市场行情、制造估价、星系导航与战术协作。'

// Keep titles public and stable: never interpolate account, organization or item data.
const MODULE_TITLES = [
  ['/manufacturing', '制造估价'],
  ['/market/admin', '市场管理'],
  ['/market', '市场价格'],
  ['/killboard/admin', '击毁采集后台'],
  ['/killboard', '击毁情报 KM'],
  ['/planetary', '行星资源'],
  ['/starmap', '星系导航'],
  ['/tactical/usage', '战术板使用概况'],
  ['/tactical', '战术板'],
  ['/fraudlist', '防诈名单'],
  ['/corporations/manage', '军团管理'],
  ['/corporations/review', '军团审核'],
  ['/corporations', '军团大厅'],
  ['/starsea/mine', '我的见闻'],
  ['/starsea/new', '撰写见闻'],
  ['/starsea/review', '见闻审核'],
  ['/starsea', '星海见闻'],
  ['/infocenter', '信息中心'],
  ['/feedback', '需求与反馈'],
  ['/usersetting', '账号设置'],
  ['/fraudadmin', '防诈管理'],
  ['/licenseadmin', '许可管理'],
  ['/dev/icon-verification', '客户端图标校验'],
  ['/login', '登录'],
  ['/fraudlogin', '管理员登录'],
  ['/access-denied', '查看权限'],
]

export function resolveSiteTitle(pathname) {
  const path = typeof pathname === 'string' ? pathname.split(/[?#]/, 1)[0] : ''
  const label = /^\/starsea\/[^/]+\/edit\/?$/.test(path)
    ? '撰写见闻'
    : MODULE_TITLES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1]
  return label ? `${label} · ${SITE_NAME}` : SITE_NAME
}
