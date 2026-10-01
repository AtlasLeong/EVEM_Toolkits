export function marketScopeLabel(value) {
  const label = value && typeof value === 'object' ? value.label : value
  return label === 'global' ? '吉他海四' : label || '—'
}
