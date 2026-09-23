const number = value => value.toLocaleString('zh-CN');

export default function TacticalStrengthSummary({ overview, scope, status }) {
  return <section className="tac-summary tac-strength-summary" aria-label="战术概览">
    {[["enemy", "敌方", overview.enemy], ["friendly", "己方", overview.friendly]].filter(([, , value]) => value).map(([side, label, value]) => (
      <section key={side} className={`tac-strength-card is-${side}`} aria-label={`${label}兵力估计`} title={side === 'enemy' ? '逐星系取最新人数上报；无人数上报时取舰队合计，两者不相加。过期数值仍保留并标为待复核。' : '按当前己方舰队合计，未知人数不当作零。'}>
        <div className="tac-strength-heading"><span>{label}</span><small>{scope === 'all' ? '组织全部' : '当前战区'} · {status === 'live' ? '已知估计' : '离线快照'}</small></div>
        <div className="tac-strength-value"><strong className="tac-strength-number">{value.systemCount === 0 ? '—' : value.unknownSystems && value.knownPeople === 0 ? '未知' : number(value.knownPeople)}</strong><span>人</span><small>{value.fleetCount} 支舰队 · {value.systemCount} 个星系</small></div>
        <div className="tac-strength-notes">
          {value.unknownSystems > 0 && <span>{value.unknownSystems} 个星系人数不全</span>}
          {value.staleSystems > 0 && <span className="is-stale">{value.stalePeople > 0 ? `含 ${number(value.stalePeople)} 人待复核` : `${value.staleSystems} 个星系待复核`}</span>}
          {!value.unknownSystems && !value.staleSystems && <span>{value.systemCount ? side === 'enemy' ? '人数上报优先 · 不与舰队相加' : '当前已标注舰队合计' : '暂无兵力记录'}</span>}
        </div>
      </section>
    ))}
  </section>;
}
