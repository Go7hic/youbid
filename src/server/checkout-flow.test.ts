import assert from 'node:assert/strict'
import test from 'node:test'

import { isLocalAppUrl } from './local.ts'
import { parseCheckoutBody } from './parse.ts'

test('checkout body is parsed at the boundary into an absolute bid', () => {
  const parsed = parseCheckoutBody({
    requestId: 'req_1',
    amountCents: 200100,
    identity: 'https://example.com/app',
    takeover: false,
  })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.value.amountCents, 200100)
  assert.equal(parsed.value.identityInput, 'https://example.com/app')
  assert.equal(parsed.value.title, '')
  assert.equal(parsed.value.description, '')
  assert.equal(parseCheckoutBody({ requestId: 'req_1' }).ok, false)
})

test('checkout body carries listing metadata when supplied', () => {
  const parsed = parseCheckoutBody({
    requestId: 'req_2',
    amountCents: 200,
    identity: '@youbid',
    title: 'Youbid',
    description: 'Paid leaderboard',
    imageUrl: 'https://example.com/a.png',
  })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.value.title, 'Youbid')
  assert.equal(parsed.value.description, 'Paid leaderboard')
  assert.equal(parsed.value.imageUrl, 'https://example.com/a.png')
})

test('mock checkout is localhost-only', () => {
  assert.equal(isLocalAppUrl('http://localhost:3000'), true)
  assert.equal(isLocalAppUrl('http://127.0.0.1:8787'), true)
  assert.equal(isLocalAppUrl('https://youbid.lol'), false)
  assert.equal(isLocalAppUrl('https://youbid-lol.gtfx0209.workers.dev'), false)
  assert.equal(isLocalAppUrl(undefined), false)
})
