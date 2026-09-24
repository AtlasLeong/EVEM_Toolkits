export const BOARD_KINDS = [
  { kind: 'war', label: '战争沙盘板', description: '敌我兵力与战区协同' },
  { kind: 'pirate', label: '海盗情报板', description: '目标活动与伏击线索' },
]

export function boardsForOrganization(organization) {
  if (Array.isArray(organization?.boards)) return organization.boards
  return organization ? [{ id: null, name: '战争沙盘板', kind: 'war', is_default: true }] : []
}

export function selectTacticalBoard(boards = [], requested = null) {
  if (!Array.isArray(boards) || !boards.length) return null
  const explicit = boards.find((board) => String(board.id) === String(requested))
  return explicit || boards.find((board) => board.is_default && board.kind === 'war') || boards[0]
}

export function createBoardAttemptSignature(kind, value, boardType) {
  return JSON.stringify([kind, String(value).trim(), kind === 'create' ? boardType : null])
}
