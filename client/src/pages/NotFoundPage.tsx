import { Link } from 'react-router'
import { useDocumentTitle } from '../hooks'

export function NotFoundPage() {
  useDocumentTitle('Page not found')
  return (
    <main className="track">
      <div className="track-card track-missing">
        <h1>Page not found</h1>
        <p>There's nothing at this address. Check the link, or start again from the home page.</p>
        <p>
          <Link to="/" className="button button-primary">
            Go to StoneTrack
          </Link>
        </p>
      </div>
    </main>
  )
}
