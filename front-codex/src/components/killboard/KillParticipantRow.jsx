import { Crosshair, UserRound } from 'lucide-react'
import GameItemImage from '../GameItemImage'
import { participantIdentity, participantShipLabel, shipImage } from '../../utils/killboardPresentation'

export default function KillParticipantRow({ row }) {
  const identity = participantIdentity(row)
  const ship = participantShipLabel(row)
  const image = shipImage(row)
  return <div className="kb-participant kb-participant--with-ship">
    <div className={`kb-participant-icon${row.is_final_blow ? ' is-final' : ''}`} aria-hidden="true">
      {row.is_final_blow ? <Crosshair size={17} /> : <UserRound size={17} />}
    </div>
    <div className="kb-participant-main">
      <strong title={identity.name}>{identity.name}</strong>
      <span title={identity.corporation}>{identity.corporation}</span>
    </div>
    <div className="kb-participant-stats">
      {row.is_final_blow ? <em>最后一击</em> : row.is_top_damage ? <em>最高伤害</em> : null}
      <b>{row.damage != null ? `${Number(row.damage).toLocaleString()} 伤害` : '伤害未知'}</b>
    </div>
    <span className="kb-participant-ship" title={ship}><span>舰船</span>{image ? <GameItemImage src={image} fallback={<span aria-hidden="true" />} /> : null}{ship}</span>
  </div>
}
