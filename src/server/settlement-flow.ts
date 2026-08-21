import { planIgnoredEvent, planPaidSettlement, planRefundSettlement, type PaidEvent, type RefundEvent, type SettlementPlan } from '../domain/settlement.ts'
import { applySettlement, loadSettlementSnapshot } from './db.ts'

export async function persistPaidEvent(db: D1Database, event: PaidEvent): Promise<SettlementPlan> {
  const snapshot = await loadSettlementSnapshot(db, { eventId: event.eventId, intentId: event.intentId })
  const plan = planPaidSettlement(snapshot, event, {
    listingId: crypto.randomUUID(),
    takeoverId: crypto.randomUUID(),
  })
  if (plan.kind === 'replay') return plan
  try {
    await applySettlement(db, plan.writes)
  } catch (error) {
    if (isUniqueConflict(error)) return { kind: 'replay', receiptStatus: 'ranked' }
    throw error
  }
  return plan
}

export async function persistRefundEvent(db: D1Database, event: RefundEvent): Promise<SettlementPlan> {
  const snapshot = await loadSettlementSnapshot(db, {
    eventId: event.eventId,
    providerOrderId: event.providerOrderId,
  })
  const plan = planRefundSettlement(snapshot, event)
  if (plan.kind === 'replay') return plan
  try {
    await applySettlement(db, plan.writes)
  } catch (error) {
    if (isUniqueConflict(error)) return { kind: 'replay', receiptStatus: 'ranked' }
    throw error
  }
  return plan
}

export async function persistIgnoredEvent(
  db: D1Database,
  event: { eventId: string; payloadHash: string; eventType: string },
): Promise<void> {
  const plan = planIgnoredEvent(event)
  if (plan.kind !== 'ignore') return
  try {
    await applySettlement(db, plan.writes)
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
  }
}

export function isUniqueConflict(error: unknown): boolean {
  return error instanceof Error && /UNIQUE|constraint/i.test(error.message)
}
