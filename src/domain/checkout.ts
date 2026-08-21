export type CheckoutStatus =
  | 'awaiting-payment'
  | 'expired'
  | 'ranked'
  | 'takeover-active'
  | 'needs-support'

export interface WebhookReceipt {
  eventId: string
  payloadHash: string
}

export interface SettlementState {
  status: CheckoutStatus
  receipts: readonly WebhookReceipt[]
  paidAmountCents: number
}

export type PaidSettlement =
  | { kind: 'settled'; state: SettlementState }
  | { kind: 'replay'; state: SettlementState }
  | { kind: 'conflict'; state: SettlementState }

export function settleVerifiedPaidEvent(
  state: SettlementState,
  event: WebhookReceipt & { amountCents: number; takeover: boolean },
): PaidSettlement {
  const existing = state.receipts.find((receipt) => receipt.eventId === event.eventId)
  if (existing?.payloadHash === event.payloadHash) return { kind: 'replay', state }
  if (existing) return { kind: 'conflict', state: { ...state, status: 'needs-support' } }

  return {
    kind: 'settled',
    state: {
      status: event.takeover ? 'takeover-active' : 'ranked',
      receipts: [...state.receipts, event],
      paidAmountCents: event.amountCents,
    },
  }
}
