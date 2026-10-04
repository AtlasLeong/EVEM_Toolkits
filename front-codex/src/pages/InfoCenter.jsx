import { Compass, Globe2, ShieldCheck } from 'lucide-react'
import { PageHeader, Panel } from '../components/ui/Primitives'
import { ArrowUpRight, ChartNoAxesCombined, Factory, MessagesSquare, Radar, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PUBLIC_READ_ACCESS_ENABLED } from '../utils/viewerAccess'
import '../styles/secondaryRoutes.css'
import '../styles/toolGuide.css'

const publicAccessLabel = PUBLIC_READ_ACCESS_ENABLED ? '公开浏览' : '登录后浏览'

const items = [
  {
    icon: ChartNoAxesCombined,
    title: '市场价格',
    desc: '查找商品，比较买卖报价与价格走势，为交易和生产决策提供参考。',
    access: publicAccessLabel,
    condition: '查询报价无需采集管理权限；配置采集物品和任务需要市场管理权限。',
    to: '/market',
  },
  {
    icon: Factory,
    title: '制造估价',
    desc: '选择目标与数量，比较采购或自制路线，复制或导出聚合采购清单。',
    access: PUBLIC_READ_ACCESS_ENABLED ? '公开估算' : '登录后估算',
    condition: '方案与手填价格只在当前页面使用，不保存到账号；离开前请带走采购清单。',
    to: '/manufacturing',
  },
  {
    icon: ShieldCheck,
    title: '诈骗名单',
    desc: '快速检索高风险账号，查看来源与备注，支持用户侧举报链路。',
    access: publicAccessLabel,
    condition: '查询可公开使用；举报需要登录，截图上传及审核还需相应权限。',
    to: '/fraudlist',
  },
  {
    icon: Globe2,
    title: '行星资源',
    desc: '按星域、星座、星系和资源类型查询产出，并支持个人价格配置。',
    access: publicAccessLabel,
    condition: '资源查询与计算按公开工具提供；保存个人方案、管理个人价格需要登录。',
    to: '/planetary',
  },
  {
    icon: Compass,
    title: '星系导航',
    desc: '按距离和安全条件计算跃迁路径，用于路线规划和风险规避。',
    access: publicAccessLabel,
    condition: '路线计算可独立使用；不会因此取得战术组织或私有情报访问权。',
    to: '/starmap',
  },
  {
    icon: Radar,
    title: '战术协作',
    desc: '在组织战术板中跟进部署与侦察上报，按成员权限协同作业。',
    access: '介绍公开 · 协作需登录',
    condition: '登录后创建组织或申请加入；进入组织需成员资格，编辑与管理按组织角色授权。',
    to: '/tactical',
  },
  {
    icon: Users,
    title: '军团大厅',
    desc: '按活动星域与方向发现军团，查看公开资料和招募信息。',
    access: publicAccessLabel,
    condition: '只公开已发布资料；管理草稿需要登录并取得军团管理权，认领与发布需审核。',
    to: '/corporations',
  },
  {
    icon: MessagesSquare,
    title: '星海见闻',
    desc: '阅读战场记录、航行趣闻与军团声音，分享新伊甸见闻。',
    access: publicAccessLabel,
    condition: '已发布内容可浏览；撰写与自己的草稿需要登录，审核需要审核权限。',
    to: '/starsea',
  },
]

export default function InfoCenterPage() {
  return (
    <div className="tool-guide">
      <PageHeader title="信息中心" subtitle="从市场价格开始，了解工具用法与访问条件" />

      <Panel title="市场 → 制造 → 采购" subtitle="先核对报价，再比较路线，最后带走需要购买的材料。">
        <ol className="tool-guide-steps">
          <li><span className="tool-guide-step-number" aria-hidden="true">1</span><div><h3>查价格与采集时间</h3><p>按物品名称搜索，核对买卖方向、价格范围与报价时间。</p><Link to="/market">查看市场价格<ArrowUpRight size={15} aria-hidden="true" /></Link></div></li>
          <li><span className="tool-guide-step-number" aria-hidden="true">2</span><div><h3>估算制造路线</h3><p>选择目标、数量和材料效率，决定哪些中间件自造或购买。</p><Link to="/manufacturing">开始制造估价<ArrowUpRight size={15} aria-hidden="true" /></Link></div></li>
          <li><span className="tool-guide-step-number" aria-hidden="true">3</span><div><h3>核价后带走清单</h3><p>检查缺价、旧价与手填来源，再复制或导出采购项。缺价时已知成本只是小计。</p><Link to="/manufacturing#manufacturing-purchase-list">打开采购清单<ArrowUpRight size={15} aria-hidden="true" /></Link></div></li>
        </ol>
      </Panel>

      <Panel title="各模块访问条件" subtitle="登录建立账号身份；组织成员、资源所有者和管理员权限分别验证。">
        <div className="feature-grid">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <article className="feature-card info-tool-card" key={item.title}>
                <span className="feature-icon">
                  <Icon size={18} />
                </span>
                <h3>{item.title}</h3>
                <span className="tool-guide-access">{item.access}</span>
                <p>{item.desc}</p>
                <p className="tool-guide-condition">{item.condition}</p>
                <Link className="info-tool-link" to={item.to} aria-label={`打开${item.title}`}>打开工具<ArrowUpRight size={15} aria-hidden="true" /></Link>
              </article>
            )
          })}
        </div>
      </Panel>
      <aside className="tool-guide-private" aria-label="登录与授权说明">
        <h2>登录与模块授权</h2>
        <p>需求与反馈、账号设置需要登录。击毁情报 KM、战术板概况及各管理后台，还需对应模块或管理权限。普通注册不会自动取得这些权限，请联系相应负责人。</p>
        <p>组织成员资格、军团管理权与审核权限只对对应资源生效。公开浏览不会开放草稿、组织战术数据或私有情报。</p>
      </aside>
    </div>
  )
}
