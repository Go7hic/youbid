const UNIQUE_VIOLATION = /UNIQUE constraint failed:\s*(.+)/i

function violatedUniqueColumns(error: unknown): string {
  if (!(error instanceof Error)) return ''
  return UNIQUE_VIOLATION.exec(error.message)?.[1] ?? ''
}

/**
 * `webhook_receipts.provider_event_id` is the only idempotency gate in settlement.
 * Any other constraint failure means the batch rolled back without applying, so it
 * has to surface as an error and let the payment provider retry rather than be
 * acknowledged as an already-processed event.
 */
export function isReceiptReplay(error: unknown): boolean {
  return violatedUniqueColumns(error).includes('webhook_receipts.provider_event_id')
}

export function isDuplicateCheckoutRequest(error: unknown): boolean {
  return violatedUniqueColumns(error).includes('checkout_intents.request_id')
}
