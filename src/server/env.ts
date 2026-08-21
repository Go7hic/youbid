import { env } from 'cloudflare:workers'

import type { ProductionConfig, PublicCheckoutConfig } from './contracts.ts'
import { isLocalAppUrl } from './local.ts'

type WorkerEnv = {
  DB: D1Database
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
