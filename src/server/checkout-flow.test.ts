import assert from 'node:assert/strict'
import test from 'node:test'

import { isDuplicateCheckoutRequest, isReceiptReplay } from './d1-errors.ts'
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
  assert.equal(parseCheckoutBody({ requestId: 'req_3', amountCents: 50, identity: 'https://example.com' }).ok, true)
  assert.equal(parseCheckoutBody({ requestId: 'req_4', amountCents: 51, identity: 'https://example.com' }).ok, false)
})

test('only a duplicate webhook receipt counts as a replay', () => {
  assert.equal(
    isReceiptReplay(new Error('D1_ERROR: UNIQUE constraint failed: webhook_receipts.provider_event_id')),
    true,
  )
})

test('a failed settlement write is never mistaken for a replay', () => {
  const failures = [
    'D1_ERROR: UNIQUE constraint failed: listings.canonical_identity',
    'D1_ERROR: UNIQUE constraint failed: provider_orders.intent_id',
    'D1_ERROR: UNIQUE constraint failed: takeover_leases.singleton_key',
    'D1_ERROR: NOT NULL constraint failed: listings.display_name',
    'D1_ERROR: FOREIGN KEY constraint failed',
    'D1_ERROR: CHECK constraint failed: principal_refunded_cents',
  ]
  for (const message of failures) {
    assert.equal(isReceiptReplay(new Error(message)), false, message)
  }
})

test('a replayed checkout request is told apart from an open top-up conflict', () => {
  assert.equal(
    isDuplicateCheckoutRequest(
      new Error('D1_ERROR: UNIQUE constraint failed: checkout_intents.owner_id, checkout_intents.request_id'),
    ),
    true,
  )
  assert.equal(
    isDuplicateCheckoutRequest(new Error('D1_ERROR: UNIQUE constraint failed: checkout_intents.listing_id')),
    false,
  )
})

test('mock checkout is localhost-only', () => {
  assert.equal(isLocalAppUrl('http://localhost:3000'), true)
  assert.equal(isLocalAppUrl('http://127.0.0.1:8787'), true)
  assert.equal(isLocalAppUrl('https://youbid.lol'), false)
  assert.equal(isLocalAppUrl('https://youbid-lol.gtfx0209.workers.dev'), false)
  assert.equal(isLocalAppUrl(undefined), false)
})
