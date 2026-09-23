const isActive = (organization) => organization?.status === "active";

export function selectDefaultTacticalOrganization(organizations = [], { requested = null, preferRealMap = false } = {}) {
  const active = organizations.filter(isActive);
  const explicit = active.find((organization) => String(organization.id) === String(requested));
  if (explicit) return explicit.id;
  if (preferRealMap) {
    const realMap = active.find((organization) => /真实星图/.test(String(organization.name || "")));
    if (realMap) return realMap.id;
  }
  return active[0]?.id || null;
}
