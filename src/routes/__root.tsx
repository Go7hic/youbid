import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  notFoundComponent: NotFound,
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      { title: 'Youbid · you bid, you get' },
      {
        name: 'description',
        content: 'Bid for a verified place on the Youbid product leaderboard.',
      },
      { property: 'og:title', content: 'Youbid · you bid, you get' },
      { property: 'og:description', content: 'Bid for a verified place on the Youbid product leaderboard.' },
      { name: 'twitter:title', content: 'Youbid · you bid, you get' },
      { property: 'og:image', content: 'https://youbid.lol/favicon.png' },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:image', content: 'https://youbid.lol/favicon.png' },
    ],
    links: [
      { rel: 'icon', href: '/favicon.png', type: 'image/png' },
      { rel: 'apple-touch-icon', href: '/favicon.png' },
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}

        <Scripts />
      </body>
    </html>
  )
}

function NotFound() {
  return (
    <main className="site-shell">
      <section className="page-panel">
        <p className="page-kicker">404</p>
        <h1>This page is not on Youbid</h1>
        <p className="page-lead">The public board, live stats, and receipts are the routes that exist.</p>
        <Link className="primary-button modal-primary" to="/">
          Back to the board
        </Link>
      </section>
    </main>
  )
}
