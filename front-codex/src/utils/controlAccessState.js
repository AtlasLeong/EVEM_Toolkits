export const privateControlKey = identity => ['control-private', String(identity)]

export function denyControlAccess(client, identity) {
  const key = ['control-access', identity]
  void client.cancelQueries({ queryKey: key })
  void client.cancelQueries({ queryKey: privateControlKey(identity) })
  client.removeQueries({ queryKey: privateControlKey(identity) })
  const mutations = client.getMutationCache()
  for (const mutation of mutations.getAll()) {
    const mutationKey = mutation.options.mutationKey
    if (mutationKey?.[0] === 'control-private' && String(mutationKey[1]) === String(identity)) mutations.remove(mutation)
  }
  client.setQueryData(key, { can_manage: false, can_view_hotspot_changes: false, denied: true })
}
