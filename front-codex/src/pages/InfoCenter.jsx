import { Compass, Globe2, ShieldCheck } from 'lucide-react'
import { PageHeader, Panel } from '../components/ui/Primitives'

const items = [
  {
    icon: ShieldCheck,
    title: '诈骗名单',
    desc: '快速检索高风险账号，查看来源与备注，支持用户侧举报链路。',
  },
  {
    icon: Globe2,
    title: '行星资源',
    desc: '按星域、星座、星系和资源类型查询产出，并支持个人价格配置。',
  },
  {
    icon: Compass,
    title: '星系导航',
    desc: '按距离和安全条件计算跃迁路径，用于路线规划和风险规避。',
  },
]

export default function InfoCenterPage() {
  return (
    <>
      <PageHeader title="信息中心" subtitle="Front Codex 视觉重构版 · Desktop" />

      <Panel>
        <div className="feature-grid">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <article className="feature-card" key={item.title}>
                <span className="feature-icon">
                  <Icon size={18} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </article>
            )
          })}
        </div>
      </Panel>
    </>
  )
}
