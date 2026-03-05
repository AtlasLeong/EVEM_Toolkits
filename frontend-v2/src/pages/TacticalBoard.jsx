import { PageHeader, Card, Empty } from '../ui/index'
import { Hammer } from 'lucide-react'

export default function TacticalBoard() {
  return (
    <>
      <PageHeader title="TacticalBoard" subtitle="即将上线" />
      <Card>
        <Empty icon={Hammer} title="页面建设中" desc="此页面正在重绘，敬请期待" />
      </Card>
    </>
  )
}
