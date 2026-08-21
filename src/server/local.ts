export function isLocalAppUrl(appUrl: string | undefined): boolean {
  if (!appUrl) return false
  try {
    const hostname = new URL(appUrl).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1'
  } catch {
    return false
  }
}
