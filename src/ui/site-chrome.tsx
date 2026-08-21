import { Link } from '@tanstack/react-router'

export function SiteHeader(input: {
  visitorsOnline: number
  visitorsLastHour: number
}) {
  return (
    <header className="site-header">
      <Link className="wordmark" to="/" aria-label="Youbid home">
        <img className="wordmark-logo" src="/logo.avif" alt="" width="42" height="42" />
        youbid<span>.lol</span>
      </Link>
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
      <p>Paid placement, ranked by verified principal. No revenue share.</p>
      <nav className="footer-nav">
        <Link to="/rules">Rules</Link>
        <Link to="/stats">Stats</Link>
        <a href="https://github.com/Go7hic/youbid" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a href="https://youbid.lol">youbid.lol</a>
      </nav>
    </footer>
  )
}
