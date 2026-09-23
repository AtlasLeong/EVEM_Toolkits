// A deliberately narrow return path. Other login entry points retain their default.
export function loginDestination(search) {
  const next = new URLSearchParams(search).get('next') || ''
  return /^\/starsea(?:\/(?:new|mine|review(?:\/[1-9]\d*)?|[1-9]\d*(?:\/edit)?))?$/.test(next) ||
    /^\/tactical\?organization=[1-9]\d*$/.test(next) ? next : '/fraudlist'
}
