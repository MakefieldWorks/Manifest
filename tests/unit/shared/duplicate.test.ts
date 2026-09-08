import { describe, expect, it } from 'vitest'
import { suggestDuplicateNodeName, validateDuplicateNodeName, validateNodeName, MAX_NODE_NAME_LEN } from '../../../src/shared/validation'
import { collectSubtreeIds } from '../../../src/shared/subtree'
import type { ManifestNode } from '../../../src/shared/types'

describe('duplicate names and subtree traversal', () => {
  it('suggests available names case-insensitively without exceeding the name limit', () => {
    expect(suggestDuplicateNodeName('Device', ['Device'])).toBe('Device copy')
    expect(suggestDuplicateNodeName('Device', ['DEVICE COPY', 'Device copy 2'])).toBe('Device copy 3')
    const name = suggestDuplicateNodeName('x'.repeat(MAX_NODE_NAME_LEN), [])
    expect(validateNodeName(name).valid).toBe(true)
    expect(name).toHaveLength(MAX_NODE_NAME_LEN)
    expect(validateDuplicateNodeName('device', ['Device']).valid).toBe(false)
    expect(validateDuplicateNodeName('copy/name', []).valid).toBe(false)
    expect(validateDuplicateNodeName('New device', ['Device']).valid).toBe(true)
  })

  it('collects deep subtrees iteratively and excludes unrelated nodes', () => {
    const nodes: ManifestNode[] = Array.from({ length: 20_000 }, (_, index) => ({
      id: String(index), parentId: index === 0 ? null : String(index - 1),
      name: String(index), order: 0, properties: {}, created: '', modified: '',
    }))
    const ids = collectSubtreeIds(nodes, '10000')
    expect(ids.size).toBe(10_000)
    expect(ids.has('9999')).toBe(false)
    expect(ids.has('19999')).toBe(true)
  })
})
