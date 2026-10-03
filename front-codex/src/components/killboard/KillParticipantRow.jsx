import { Crosshair, UserRound } from 'lucide-react'
import GameItemImage from '../GameItemImage'
import { participantIdentity, participantShipLabel, shipImage } from '../../utils/killboardPresentation'

export default function KillParticipantRow({ row }) {
  const identity = participantIdentity(row)
  const ship = participantShipLabel(row)
  const image = shipImage(row)
  const percent = row.damage_pct === null || row.damage_pct === undefined || row.damage_pct === '' ? null : Number(row.damage_pct)
  const damagePercent = Number.isFinite(percent) ? `${percent}%` : ''
  return <div className={`kb-participant kb-participant--with-ship${identity.isNpc ? ' kb-participant--npc' : ''}`}>
    <div className={`kb-participant-ship${row.is_final_blow ? ' is-final' : ''}`} title={ship || identity.name}>
      <GameItemImage src={image} alt={ship || identity.name} width={88} height={56} fallback={<span className="kb-ship-placeholder" aria-hidden="true">{row.is_final_blow ? <Crosshair size={26} /> : <UserRound size={26} />}</span>} />
    </div>
    <div className="kb-participant-main">
      <strong title={identity.name}>{identity.name}</strong>
      {identity.corporation ? <span className="kb-participant-corporation" title={identity.corporation}>军团 · {identity.corporation}</span> : null}
      {ship && ship !== identity.name ? <small className="kb-participant-hull" title={ship}>舰船 · {ship}</small> : null}
    </div>
    <div className="kb-participant-stats">
      <span className="kb-participant-badges">{row.is_final_blow ? <em className="is-final">最后一击</em> : null}{row.is_top_damage ? <em className="is-top" title="最高伤害">伤害最多</em> : null}</span>
      <b>{row.damage != null ? `${Number(row.damage).toLocaleString()} 伤害` : '伤害未知'}{damagePercent ? ` · ${damagePercent}` : ''}</b>
    </div>
  </div>
}
