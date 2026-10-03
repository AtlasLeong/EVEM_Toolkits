import { Compass, Globe2, ShieldCheck } from 'lucide-react'
import { PageHeader, Panel } from '../components/ui/Primitives'
import { ArrowUpRight, ChartNoAxesCombined, Factory, MessagesSquare, Radar, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import '../styles/secondaryRoutes.css'

const items = [
  {
    icon: ChartNoAxesCombined,
    title: '市场价格',
    desc: '查找商品，比较买卖报价与价格走势，为交易和生产决策提供参考。',
    to: '/market',
  },
  {
    icon: Factory,
    title: '制造估价',
    desc: '展开制造材料与生产流程，按采购或自制方案估算成本。',
    to: '/manufacturing',
  },
  {
    icon: ShieldCheck,
    title: '诈骗名单',
    desc: '快速检索高风险账号，查看来源与备注，支持用户侧举报链路。',
    to: '/fraudlist',
  },
  {
    icon: Globe2,
    title: '行星资源',
    desc: '按星域、星座、星系和资源类型查询产出，并支持个人价格配置。',
    to: '/planetary',
  },
  {
    icon: Compass,
    title: '星系导航',
    desc: '按距离和安全条件计算跃迁路径，用于路线规划和风险规避。',
    to: '/starmap',
  },
  {
    icon: Radar,
    title: '战术协作',
    desc: '在组织战术板中跟进部署与侦察上报，按成员权限协同作业。',
    to: '/tactical',
  },
  {
    icon: Users,
    title: '军团大厅',
    desc: '按活动星域与方向发现军团，查看公开资料和招募信息。',
    to: '/corporations',
  },
  {
    icon: MessagesSquare,
    title: '星海见闻',
    desc: '阅读战场记录、航行趣闻与军团声音，分享新伊甸见闻。',
    to: '/starsea',
  },
]

export default function InfoCenterPage() {
  return (
    <>
      <PageHeader title="信息中心" subtitle="了解工具功能，开始规划你的新伊甸旅程" />

      <Panel>
        <div className="feature-grid">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <article className="feature-card info-tool-card" key={item.title}>
                <span className="feature-icon">
                  <Icon size={18} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
                <Link className="info-tool-link" to={item.to} aria-label={`打开${item.title}`}>打开工具<ArrowUpRight size={15} aria-hidden="true" /></Link>
              </article>
            )
          })}
        </div>
      </Panel>
    </>
  )
}
