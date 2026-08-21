import { planIgnoredEvent, planPaidSettlement, planRefundSettlement, type PaidEvent, type RefundEvent, type SettlementPlan } from '../domain/settlement.ts'
import { isReceiptReplay } from './d1-errors.ts'
import { applySettlement, loadSettlementSnapshot } from './db.ts'

export async function persistPaidEvent(db: D1Database, event: PaidEvent, nowIso: string): Promise<SettlementPlan> {
  const snapshot = await loadSettlementSnapshot(db, { eventId: event.eventId, intentId: event.intentId, nowIso })
  const plan = planPaidSettlement(snapshot, event, {
    listingId: crypto.randomUUID(),
    takeoverId: crypto.randomUUID(),
  })
  return applyPlan(db, plan)
}

export async function persistRefundEvent(db: D1Database, event: RefundEvent, nowIso: string): Promise<SettlementPlan> {
  const snapshot = await loadSettlementSnapshot(db, {
    eventId: event.eventId,
    providerOrderId: event.providerOrderId,
    nowIso,
  })
  const plan = planRefundSettlement(snapshot, event)
  return applyPlan(db, plan)
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
    if (!isReceiptReplay(error)) throw error
  }
}

async function applyPlan(db: D1Database, plan: SettlementPlan): Promise<SettlementPlan> {
  if (plan.kind === 'replay') return plan
  try {
    await applySettlement(db, plan.writes)
  } catch (error) {
    if (isReceiptReplay(error)) return { kind: 'replay', receiptStatus: plan.writes.receiptStatus }
    throw error
  }
  return plan
}
