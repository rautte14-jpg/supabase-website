// Consume changes before dispatching a refresh. A new event received during or
// after dispatch must remain dirty for the next refresh, without a cleanup race.
export function createLiveRefresh({ dependencies, invalidate, refresh, isHidden }) {
  const dirty = new Set()
  return {
    mark(table) {
      if (!table) {
        invalidate()
        dirty.add('*')
      } else {
        if (!dirty.has(table)) invalidate(table)
        dirty.add(table)
      }
    },
    flush(route) {
      if (isHidden()) return false
      const tables = dependencies[route] || []
      const all = dirty.has('*')
      const changed = tables.filter(table => all || dirty.has(table))
      if (!changed.length) return false
      if (all) {
        // Expand the wildcard so other modules also refresh on navigation.
        Object.values(dependencies).flat().forEach(table => dirty.add(table))
        dirty.delete('*')
      }
      changed.forEach(table => { dirty.delete(table); invalidate(table) })
      refresh()
      return true
    },
  }
}
