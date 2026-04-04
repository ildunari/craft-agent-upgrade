import { describe, expect, it } from 'bun:test'
import { buildRightSidebarParam, parseRightSidebarParam } from '../route-parser'

describe('route-parser: document sidebar', () => {
  it('parses the document sidebar param', () => {
    expect(parseRightSidebarParam('document')).toEqual({ type: 'document' })
  })

  it('builds the document sidebar param', () => {
    expect(buildRightSidebarParam({ type: 'document' })).toBe('document')
  })
})
