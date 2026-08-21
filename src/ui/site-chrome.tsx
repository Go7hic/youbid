import { Link } from '@tanstack/react-router'

export function SiteHeader(input: {
  visitorsOnline: number
  visitorsLastHour: number
}) {
  return (
    <header className="site-header">
      <div className="site-header-bar">
        <Link className="wordmark" to="/" aria-label="Youbid home">
          <img className="wordmark-logo" src="/logo.avif" alt="" width="50" height="50" />
          youbid<span>.lol</span>
        </Link>
        <nav className="header-nav" aria-label="Site">
          <Link to="/rules">Rules</Link>
          <a href="https://github.com/Go7hic/youbid" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </div>
      <div className="live-pill" aria-live="polite">
        <span className="live-dot" />
        <strong>{input.visitorsOnline.toLocaleString()} visitors online</strong>
        <span>· {input.visitorsLastHour.toLocaleString()} in the last hour · </span>
        <Link className="stats-link" to="/stats" target="_blank" rel="noreferrer">
          see stats →
        </Link>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer>
      <p>Paid placement, ranked by current verified bid. Amounts fall 3% a day. No revenue share.</p>
      <nav className="footer-nav">
        <Link to="/stats">Stats</Link>
        <a href="https://youbid.lol">youbid.lol</a>
      </nav>
    </footer>
  )
}
