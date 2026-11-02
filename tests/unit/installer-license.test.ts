// The Windows installer's license page wraps text itself, so the beforePack hook
// (scripts/installer-license.cjs) joins each LICENSE paragraph onto one line.
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { describe, it, expect } from 'vitest'

const require = createRequire(import.meta.url)
const { unwrapParagraphs } = require('../../scripts/installer-license.cjs') as {
  unwrapParagraphs: (text: string) => string
}

describe('unwrapParagraphs', () => {
  it('joins wrapped lines and keeps blank lines between paragraphs', () => {
    expect(unwrapParagraphs('Title\n\nOne two\nthree four\n  five\n\nLast\n')).toBe(
      'Title\r\n\r\nOne two three four five\r\n\r\nLast\r\n',
    )
  })

  it('accepts CRLF input', () => {
    expect(unwrapParagraphs('a\r\nb\r\n\r\nc\r\n')).toBe('a b\r\n\r\nc\r\n')
  })

  it('keeps every word of the repository LICENSE', () => {
    const license = readFileSync('LICENSE', 'utf8')
    const unwrapped = unwrapParagraphs(license)
    expect(unwrapped.split(/\s+/).filter(Boolean)).toEqual(license.split(/\s+/).filter(Boolean))
    expect(unwrapped.split('\r\n\r\n')).toHaveLength(license.trim().split(/\n\s*\n/).length)
  })
})
