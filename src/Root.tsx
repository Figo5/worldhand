// The Worldhand main menu: choose Classic or Ascension. The choice lives in
// the URL hash (#classic / #ascension), so a reload returns to the same mode
// and either mode can be linked directly. Each mode keeps its own saves.
import { Suspense, lazy, useEffect, useState } from 'react'
import App from './App'
import './ui/ascension/ascension.css'

const AscensionRoot = lazy(() => import('./ui/ascension/AscensionRoot'))
type Mode = 'menu' | 'classic' | 'ascension'
const fromHash = (): Mode => (location.hash === '#classic' ? 'classic' : location.hash === '#ascension' ? 'ascension' : 'menu')

export default function Root() {
  const [mode, setMode] = useState<Mode>(fromHash)
  useEffect(() => {
    const h = () => setMode(fromHash())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  const go = (m: Mode) => { location.hash = m === 'menu' ? '' : m; setMode(m); window.scrollTo(0, 0) }

  if (mode === 'classic') return <App onMenu={() => go('menu')} />
  if (mode === 'ascension') {
    return (
      <Suspense fallback={<div className="asc"><p className="muted" style={{ padding: 24 }}>Loading Ascension…</p></div>}>
        <AscensionRoot onExit={() => go('menu')} />
      </Suspense>
    )
  }
  return (
    <div className="asc">
      <main className="modes" data-testid="mode-menu">
        <header className="modes-head">
          <h1>Worldhand</h1>
          <p>Poker hands that build a world. Choose how to play — each mode keeps its own saves.</p>
        </header>
        <div className="mode-cards">
          <button className="mode-card ascension" data-testid="mode-ascension" onClick={() => go('ascension')}>
            <span className="mode-tag">New · Roguelike campaign</span>
            <h2>Ascension</h2>
            <p>Six ages, six crises. Every scoring card shapes Vitality, Prosperity, Industry or Knowledge; peoples rise on the land that suits them; legendaries bend the rules. Endure every age and ascend.</p>
          </button>
          <button className="mode-card" data-testid="mode-classic" onClick={() => go('classic')}>
            <span className="mode-tag">The original · Endless</span>
            <h2>Classic</h2>
            <p>Beat escalating epoch targets with an 8-card hand, spend Seeds on Jokers and world upgrades, and grow the planet as far as three lives will carry it.</p>
          </button>
        </div>
      </main>
    </div>
  )
}
