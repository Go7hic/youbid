import { env } from 'cloudflare:workers'

import type { ProductionConfig, PublicCheckoutConfig } from './contracts.ts'
import { isLocalAppUrl } from './local.ts'

interface RateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>
}

type WorkerEnv = {
  DB: D1Database
  RESOLVE_LIMITER?: RateLimiter
  APP_URL?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  TURNSTILE_SECRET?: string
  TURNSTILE_SITE_KEY?: string
  OWNER_COOKIE_SECRET?: string
}

const LOCAL_OWNER_SECRET = 'youbid-local-owner-cookie-secret'

function workerEnv(): WorkerEnv {
  return env as unknown as WorkerEnv
}

export function database(): D1Database {
  return workerEnv().DB
}

/**
 * Returns true when the caller may proceed. The binding is absent in local dev,
 * where an unthrottled scraper costs nothing.
 */
export async function allowResolve(clientIp: string | null): Promise<boolean> {
  const limiter = workerEnv().RESOLVE_LIMITER
  if (!limiter) return true
  const { success } = await limiter.limit({ key: clientIp ?? 'anonymous' })
  return success
}

export function readProductionConfig(): ProductionConfig {
  const value = workerEnv()
  return {
    appUrl: value.APP_URL,
    stripeSecretKey: emptyToUndefined(value.STRIPE_SECRET_KEY),
    stripeWebhookSecret: emptyToUndefined(value.STRIPE_WEBHOOK_SECRET),
    turnstileSecret: emptyToUndefined(value.TURNSTILE_SECRET),
    turnstileSiteKey: emptyToUndefined(value.TURNSTILE_SITE_KEY),
    ownerCookieSecret: emptyToUndefined(value.OWNER_COOKIE_SECRET),
  }
}

export function ownerSigningSecret(config: ProductionConfig): string | null {
  if (config.ownerCookieSecret) return config.ownerCookieSecret
  if (!config.stripeSecretKey) return LOCAL_OWNER_SECRET
  return null
}

export function isLocalDevelopment(config: ProductionConfig = readProductionConfig()): boolean {
  return isLocalAppUrl(config.appUrl)
}

/** Absolute origin without a trailing slash, for canonical links in machine-readable routes. */
export function siteOrigin(config: ProductionConfig = readProductionConfig()): string {
  return (config.appUrl ?? 'https://youbid.lol').replace(/\/+$/, '')
}

export function publicCheckoutConfig(config: ProductionConfig = readProductionConfig()): PublicCheckoutConfig {
  const turnstileSiteKey = config.turnstileSiteKey ?? null
  if (config.stripeSecretKey && config.appUrl) {
    return { mode: 'stripe', turnstileSiteKey }
  }
  if (isLocalAppUrl(config.appUrl)) {
    return { mode: 'mock', turnstileSiteKey }
  }
  return { mode: 'unavailable', turnstileSiteKey }
}

export function stripeIsConfigured(config: ProductionConfig = readProductionConfig()): boolean {
  return Boolean(config.stripeSecretKey && config.stripeWebhookSecret && config.appUrl)
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value ? value : undefined
}
