import assert from 'node:assert/strict'
import test from 'node:test'

import { isBlockedFetchHost, parseHtmlMetadata } from './scrape.ts'

test('HTML scrape reads title, description, and favicon', () => {
  const parsed = parseHtmlMetadata(
    `<html><head>
      <title>Example Product</title>
      <meta name="description" content="A public product page." />
      <link rel="icon" href="/favicon.ico" />
    </head></html>`,
    'https://example.com/app',
  )
  assert.equal(parsed.title, 'Example Product')
  assert.equal(parsed.description, 'A public product page.')
  assert.equal(parsed.imageUrl, 'https://example.com/favicon.ico')
})

test('scrape failure path is empty metadata', () => {
  const parsed = parseHtmlMetadata('', 'https://example.com/')
  assert.deepEqual(parsed, { title: '', description: '', imageUrl: null })
})

test('SSRF hosts are blocked', () => {
  assert.equal(isBlockedFetchHost('localhost'), true)
  assert.equal(isBlockedFetchHost('127.0.0.1'), true)
  assert.equal(isBlockedFetchHost('10.0.0.8'), true)
  assert.equal(isBlockedFetchHost('192.168.1.1'), true)
  assert.equal(isBlockedFetchHost('169.254.169.254'), true)
  assert.equal(isBlockedFetchHost('example.com'), false)
})
