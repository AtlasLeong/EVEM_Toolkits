import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Shield, AlertTriangle, User, Calendar, Tag, ChevronRight, X } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { searchFraud } from '../services/apiFraudList'
import { PageHeader, Card, Input, Button, Badge, Spinner, Empty, Skeleton } from '../ui/index'

// 安全等级颜色映射
const securityColor = (level) => {
  if (!level) return 'default'
  const l = String(level).toLowerCase()
  if (l.includes('高') || l.includes('high')) return 'red'
  if (l.includes('中') || l.includes('med'))  return 'gold'
  return 'green'
}

// 骨架屏
function ResultSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="glass rounded-2xl p-5 flex items-center gap-4">
          <Skeleton className="w-10 h-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

// 单条记录卡片
function FraudCard({ item, index, onClick }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04, ease: [0.25, 0.1, 0.25, 1] }}
      onClick={() => onClick(item)}
      className="glass rounded-2xl p-5 flex items-center gap-4 cursor-pointer
                 hover:border-white/[0.14] hover:bg-white/[0.06] transition-all duration-200 group"
    >
      {/* 头像 */}
      <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
        <AlertTriangle size={16} className="text-red-400" strokeWidth={2} />
      </div>

      {/* 主信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-white/90 text-[15px] truncate">
            {item.fraud_account || item.fraudAccount || '未知账号'}
          </span>
          {item.account_type && (
            <Badge variant="default">{item.account_type}</Badge>
          )}
        </div>
        <p className="text-sm text-white/40 truncate">
          {item.fraud_type || item.fraudType || '诈骗类型未分类'}
          {item.remark && <span className="ml-2 text-white/25">· {item.remark}</span>}
        </p>
      </div>

      {/* 右侧信息 */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {item.group_name && (
          <div className="text-right hidden lg:block">
            <p className="text-xs text-white/30">来源</p>
            <p className="text-xs text-white/55 font-medium">{item.group_name}</p>
          </div>
        )}
        <Badge variant="red">
          <Shield size={10} strokeWidth={2.5} />
          举报
        </Badge>
        <ChevronRight
          size={16}
          className="text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all duration-200"
        />
      </div>
    </motion.div>
  )
}

// 详情抽屉
function DetailDrawer({ item, onClose }) {
  if (!item) return null
  const fields = [
    { label: '账号',     value: item.fraud_account || item.fraudAccount },
    { label: '账号类型', value: item.account_type },
    { label: '诈骗类型', value: item.fraud_type || item.fraudType },
    { label: '来源群组', value: item.group_name },
    { label: '备注',     value: item.remark },
    { label: '举报时间', value: item.created_at || item.createdAt },
    { label: '审核人',   value: item.approver },
  ].filter(f => f.value)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-lg glass rounded-3xl p-6 card-shadow"
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.10] flex items-center justify-center transition-colors"
        >
          <X size={14} className="text-white/50" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertTriangle size={20} className="text-red-400" strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">
              {item.fraud_account || item.fraudAccount}
            </h2>
            <p className="text-sm text-white/40">诈骗账号详情</p>
          </div>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          {fields.map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between gap-4">
              <span className="text-sm text-white/35 flex-shrink-0 w-20">{label}</span>
              <span className="text-sm text-white/80 text-right">{value}</span>
            </div>
          ))}
        </div>

        {/* Evidence images */}
        {item.evidence_images?.length > 0 && (
          <div className="mt-5 pt-5 border-t border-white/[0.06]">
            <p className="text-xs text-white/35 mb-3">证据截图</p>
            <div className="grid grid-cols-3 gap-2">
              {item.evidence_images.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt="证据"
                  className="w-full aspect-square object-cover rounded-xl border border-white/[0.06]"
                />
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// ── 主页面 ────────────────────────────────────────────────────
export default function FraudList() {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState([])
  const [searched, setSearched]   = useState(false)
  const [selected, setSelected]   = useState(null)

  const { mutate: search, isPending } = useMutation({
    mutationFn: searchFraud,
    onSuccess: (data) => {
      setResults(Array.isArray(data) ? data : [])
      setSearched(true)
    },
    onError: () => setSearched(true),
  })

  const handleSearch = () => {
    if (!query.trim()) return
    search({ fraud_account: query.trim() })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSearch()
  }

  return (
    <>
      <PageHeader
        title="诈骗名单"
        subtitle="查询 EVE Echoes 游戏中已记录的诈骗账号"
      />

      {/* 搜索区 */}
      <Card className="mb-6">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
            />
            <Input
              className="pl-9"
              placeholder="输入角色名、游戏 ID 或账号..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <Button
            variant="gold"
            size="md"
            onClick={handleSearch}
            disabled={isPending || !query.trim()}
            className="flex-shrink-0 min-w-[88px] justify-center"
          >
            {isPending ? <Spinner size={14} /> : <><Search size={13} strokeWidth={2.3} />查询</>}
          </Button>
        </div>

        {/* 搜索提示 */}
        {!searched && (
          <p className="mt-3 text-xs text-white/25 flex items-center gap-1.5">
            <Shield size={11} strokeWidth={2} className="text-gold-500/60" />
            数据来源于玩家社区举报，仅供参考，请自行甄别
          </p>
        )}
      </Card>

      {/* 结果区 */}
      <AnimatePresence mode="wait">
        {isPending ? (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ResultSkeleton />
          </motion.div>
        ) : searched ? (
          results.length > 0 ? (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              {/* 结果统计 */}
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-white/40">
                  共找到 <span className="text-gold-400 font-semibold">{results.length}</span> 条记录
                </p>
              </div>
              {results.map((item, i) => (
                <FraudCard key={item.id || i} item={item} index={i} onClick={setSelected} />
              ))}
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Card>
                <Empty
                  icon={Shield}
                  title="未找到相关记录"
                  desc="该账号暂无诈骗记录，请保持警惕"
                />
              </Card>
            </motion.div>
          )
        ) : null}
      </AnimatePresence>

      {/* 详情弹窗 */}
      <AnimatePresence>
        {selected && <DetailDrawer item={selected} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </>
  )
}
