import assert from 'node:assert/strict'
import test from 'node:test'

import { isBlockedFetchHost, parseHtmlMetadata, parseXProfileTitle, scrapePublicUrl } from './scrape.ts'

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

test('X profile og title becomes a display name', () => {
  assert.equal(parseXProfileTitle('Youbid (@youbid) / X', 'youbid'), 'Youbid')
  const parsed = parseHtmlMetadata(
    `<html><head>
      <meta property="og:title" content="Youbid (@youbid) / X" />
      <meta property="og:description" content="you bid, you get" />
      <meta property="og:image" content="https://pbs.twimg.com/profile.jpg" />
    </head></html>`,
    'https://x.com/youbid',
  )
  assert.equal(parsed.title, 'Youbid (@youbid) / X')
  assert.equal(parsed.description, 'you bid, you get')
})

test('X profile unfurl reads display name, bio, and avatar', async () => {
  const html = `<html><head>
    <meta property="og:title" content="Youbid (@youbid) / X" />
    <meta property="og:description" content="you bid, you get" />
    <meta property="og:image" content="https://pbs.twimg.com/profile.jpg" />
  </head></html>`
  const metadata = await scrapePublicUrl('https://x.com/youbid', async () =>
    new Response(html, { headers: { 'content-type': 'text/html' }, status: 200 }),
  )
  assert.equal(metadata.title, 'Youbid')
  assert.equal(metadata.description, 'you bid, you get')
  assert.equal(metadata.imageUrl, 'https://pbs.twimg.com/profile.jpg')
})

test('SSRF hosts are blocked', () => {
  assert.equal(isBlockedFetchHost('localhost'), true)
  assert.equal(isBlockedFetchHost('127.0.0.1'), true)
  assert.equal(isBlockedFetchHost('10.0.0.8'), true)
  assert.equal(isBlockedFetchHost('192.168.1.1'), true)
  assert.equal(isBlockedFetchHost('169.254.169.254'), true)
  assert.equal(isBlockedFetchHost('example.com'), false)
})
