/** Site logo for a public URL. X handles keep the scraped profile photo instead. */
export function faviconUrlForTarget(targetUrl: string): string | null {
  try {
    const host = new URL(targetUrl).hostname.replace(/^www\./, '').toLowerCase()
    if (!host.includes('.')) return null
    return `https://favicon.so/${host}`
  } catch {
    return null
  }
}
