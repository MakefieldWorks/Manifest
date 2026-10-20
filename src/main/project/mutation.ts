// The hand-off between a pure planner (nodes, templates, imports) and
// ProjectManager.commitProjectMutation. Planners describe the next project
// and the search-index work as data; the manager decides whether it may
// commit (interrupted history, external changes, running operations) and
// performs the side effects in a fixed order.

import type { ManifestNode, Project } from '../../shared/types'

// Applied in field order: remove, then upsert, or a full rebuild instead.
export interface SearchUpdate {
  remove?: string[]
  upsert?: ManifestNode[]
  rebuild?: true
}

export interface ProjectMutation {
  next: Project
  label: string
  search: SearchUpdate
}
