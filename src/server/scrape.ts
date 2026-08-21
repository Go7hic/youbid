import type { ListingMetadata } from '../domain/listing-metadata.ts'
import { sanitizeListingMetadata } from '../domain/listing-metadata.ts'

const MAX_BYTES = 512_000
const FETCH_MS = 4_000

export function isBlockedFetchHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254)
    )
  }
  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')
}

export function parseHtmlMetadata(html: string, baseUrl: string): ListingMetadata {
  const title =
    attr(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    attr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
    attr(html, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i) ||
    tag(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const description =
    attr(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
    attr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ||
    attr(html, /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i) ||
    attr(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    attr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
  const image =
    attr(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    attr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
    attr(html, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
    attr(html, /<link[^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]+href=["']([^"']+)["']/i) ||
    attr(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon)["']/i)
  return sanitizeListingMetadata({
    title: decode(title),
    description: decode(description),
    imageUrl: absolutize(image, baseUrl),
  })
}

export function parseXProfileTitle(rawTitle: string, handle: string): string {
  let title = rawTitle.trim()
  title = title.replace(/\s*[|/]\s*X\s*$/i, '')
  title = title.replace(new RegExp(`\\s*\\(@${handle}\\)\\s*$`, 'i'), '')
  if (!title || title.toLowerCase() === `@${handle.toLowerCase()}`) {
    return ''
  }
  return title
}

export async function scrapePublicUrl(
  targetUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ListingMetadata> {
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return emptyMetadata()
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || isBlockedFetchHost(parsed.hostname)) {
    return emptyMetadata()
  }

  const first = await scrapeOnce(parsed, fetchImpl)
  if (first.title || first.description) return first

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  if (host === 'x.com' || host === 'twitter.com') {
    const fallback = new URL(parsed.toString())
    fallback.hostname = host === 'x.com' ? 'twitter.com' : 'x.com'
    return scrapeOnce(fallback, fetchImpl)
  }
  return first
}

async function scrapeOnce(parsed: URL, fetchImpl: typeof fetch): Promise<ListingMetadata> {
  try {
    const response = await fetchImpl(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Mozilla/5.0 (compatible; Youbid/1.0; +https://youbid.lol)',
      },
      signal: AbortSignal.timeout(FETCH_MS),
    })
    const finalUrl = response.url || parsed.toString()
    const finalHost = new URL(finalUrl).hostname.replace(/^www\./, '')
    if (isBlockedFetchHost(finalHost) || !response.ok) return emptyMetadata()
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('html') && !contentType.includes('text/')) return emptyMetadata()
    const html = await readLimited(response)
    const metadata = parseHtmlMetadata(html, finalUrl)
    if (finalHost === 'x.com' || finalHost === 'twitter.com') {
      const handle = parsed.pathname.split('/').filter(Boolean)[0]?.replace(/^@/, '') ?? ''
      return sanitizeListingMetadata({
        title: parseXProfileTitle(metadata.title, handle),
        description: metadata.description,
        imageUrl: metadata.imageUrl,
      })
    }
    return metadata
  } catch {
    return emptyMetadata()
  }
}

function emptyMetadata(): ListingMetadata {
  return { title: '', description: '', imageUrl: null }
}

async function readLimited(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer()
  const bytes = buffer.byteLength > MAX_BYTES ? buffer.slice(0, MAX_BYTES) : buffer
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function attr(html: string, pattern: RegExp): string {
  return pattern.exec(html)?.[1]?.trim() ?? ''
}

function tag(html: string, pattern: RegExp): string {
  return decode(pattern.exec(html)?.[1] ?? '').replace(/<[^>]+>/g, '').trim()
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function absolutize(value: string, baseUrl: string): string | null {
  if (!value) return null
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return null
  }
}
