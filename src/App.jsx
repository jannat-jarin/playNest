import React, { useEffect, useState } from 'react'
import GamePlayer from './GamePlayer'
import Admin from './Admin'

const Icon = ({ name }) => {
  const icons = { home: '⌂', grid: '▦', spark: '✦', info: 'i', mail: '✉', menu: '☰', close: '×', search: '⌕', arrow: '→', play: '▶', back: '←' }
  return <span className="icon" aria-hidden="true">{icons[name]}</span>
}

function App() {
  const [view, setView] = useState({ type: 'home' })
  const [games, setGames] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [catalogueError, setCatalogueError] = useState('')
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [menuOpen, setMenuOpen] = useState(false)
  const filtered = games.filter(game => (selectedCategory === 'All' || game.category === selectedCategory) && game.title.toLowerCase().includes(query.toLowerCase()))
  const loadCatalogue = async () => { setLoading(true); try { const res=await fetch('/api/games'); const data=await res.json(); if(!res.ok) throw new Error(data.error||'Could not load games.'); setGames(data.games); setCategories(data.categories); setCatalogueError('') } catch(e) { setCatalogueError(e.message); setGames([]) } finally { setLoading(false) } }
  useEffect(() => { loadCatalogue() }, [])

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [view])
  const goHome = () => { setView({ type: 'home' }); setMenuOpen(false) }
  const openGame = game => { setView({ type: 'game', game }); setMenuOpen(false) }
  const openPage = page => { setView(page === 'Admin' ? { type: 'admin' } : { type: 'page', page }); setMenuOpen(false) }

  return <div className="app-shell">
    <Sidebar active={view.type === 'home' ? 'Home' : ''} onHome={goHome} onPage={openPage} />
    <header className="mobile-header"><button className="brand" onClick={goHome}><span>Play</span>Nest</button><button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu"><Icon name={menuOpen ? 'close' : 'menu'} /></button></header>
    {menuOpen && <nav className="mobile-menu"><button onClick={goHome}>Home</button><button onClick={() => openPage('About')}>About</button><button onClick={() => openPage('Contact')}>Contact</button></nav>}
    <main className="main-content">
      {view.type === 'home' && <Home games={games} categories={categories} loading={loading} error={catalogueError} retry={loadCatalogue} query={query} setQuery={setQuery} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} filtered={filtered} onGame={openGame} />}
      {view.type === 'game' && <GameDetail game={view.game} onBack={goHome} onGame={openGame} />}
      {view.type === 'page' && <InfoPage page={view.page} onBack={goHome} />}
      {view.type === 'admin' && <Admin onBack={goHome} onChanged={loadCatalogue} />}
      <Footer onPage={openPage} />
    </main>
  </div>
}

function Sidebar({ active, onHome, onPage }) { return <aside className="sidebar"><button className="brand" onClick={onHome}><span>Play</span>Nest</button><nav><button className={active === 'Home' ? 'active' : ''} onClick={onHome}><Icon name="home" /> Home</button><button onClick={onHome}><Icon name="grid" /> Browse games</button><button onClick={onHome}><Icon name="spark" /> New & trending</button></nav><div className="sidebar-bottom"><button onClick={() => onPage('About')}><Icon name="info" /> About</button><button onClick={() => onPage('Contact')}><Icon name="mail" /> Contact</button><button onClick={() => onPage('Admin')}>Owner admin</button><div className="side-promo"><strong>PlayNest Plus</strong><span>Premium perks are coming soon.</span><b>Coming soon</b></div></div></aside> }

function Home({ games, categories, loading, error, retry, query, setQuery, selectedCategory, setSelectedCategory, filtered, onGame }) { const hero = games.find(g=>g.featured) || games[0]; if(loading)return <section className="info-page"><p>Loading games…</p></section>; if(error)return <section className="info-page"><h1>Games are unavailable</h1><p>{error}</p><button className="primary" onClick={retry}>Try again</button></section>; if(!games.length)return <section className="info-page"><h1>No games available yet</h1><p>The catalogue is being prepared. Please check back soon.</p></section>; return <>
  <section className="topbar"><div><p className="eyebrow">THE PLAYGROUND IS OPEN</p><h1>Find your next <em>favourite game.</em></h1></div><label className="search"><Icon name="search" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search games..." aria-label="Search games" /></label></section>
  <section className="hero"><img src={hero.art} alt={`${hero.title} artwork`} /><div className="hero-copy"><span className="pill">FEATURED GAME</span><h2>{hero.title}</h2><p>{hero.description}</p><button className="primary" onClick={() => onGame(hero)}><Icon name="play" /> Play {hero.title}</button></div><div className="hero-stat"><strong>4.9</strong><span>player rating</span></div></section>
  <Ad />
  <section className="section"><div className="section-heading"><div><p className="eyebrow">PICK A MOOD</p><h2>Explore categories</h2></div><button className="text-button" onClick={() => setSelectedCategory('All')}>View all <Icon name="arrow" /></button></div><div className="categories"><button className={selectedCategory === 'All' ? 'selected' : ''} onClick={() => setSelectedCategory('All')}>All games</button>{categories.map((category, i) => <button key={category} className={selectedCategory === category ? 'selected' : ''} style={{ '--i': i }} onClick={() => setSelectedCategory(category)}>{category}</button>)}</div></section>
  <GameSection title={query || selectedCategory !== 'All' ? 'Matching games' : 'Popular games'} eyebrow={query || selectedCategory !== 'All' ? 'YOUR RESULTS' : 'MOST PLAYED THIS WEEK'} items={query || selectedCategory !== 'All' ? filtered : (games.filter(g=>g.popular).length?games.filter(g=>g.popular):games.slice(0,4))} onGame={onGame} empty query={query} reset={() => { setQuery(''); setSelectedCategory('All') }} />
  {!query && selectedCategory === 'All' && <GameSection title="New games" eyebrow="JUST LANDED" items={games.filter(game => game.isNew)} onGame={onGame} />}
  <Ad compact />
  <section className="premium"><div><span className="pill">PLAYNEST PLUS</span><h2>More play, <em>coming soon.</em></h2><p>A future home for member-only challenges, custom themes and more ways to play.</p></div><div className="premium-orb">+</div></section>
</> }

function GameSection({ title, eyebrow, items, onGame, empty, query, reset }) { return <section className="section games-section"><div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{items.length > 0 && <span className="game-count">{items.length} games</span>}</div>{items.length ? <div className="game-grid">{items.map(game => <GameCard key={game.id} game={game} onClick={() => onGame(game)} />)}</div> : <div className="empty"><div>⌕</div><h3>No games found</h3><p>We couldn’t find anything matching “{query}”. Try a different title or browse all games.</p><button className="primary" onClick={reset}>Reset filters</button></div>}</section> }
function GameCard({ game, onClick }) { return <button className="game-card" onClick={onClick}><div className="game-art"><img src={game.art} alt="" /><span>{game.tag}</span><div className="play-overlay"><Icon name="play" /></div></div><div className="game-card-info"><div><h3>{game.title}</h3><p>{game.category}</p></div><Icon name="arrow" /></div></button> }
function Ad({ compact = false }) { return <aside className={'ad ' + (compact ? 'compact' : '')}><span>ADVERTISEMENT</span><div>{compact ? 'Your next favourite game could go here' : 'A space for future partners & player rewards'}</div></aside> }
function GameDetail({ game, onBack, onGame }) { return <>
  <button className="back" onClick={onBack}><Icon name="back" /> Back to games</button><section className="detail-hero"><div className="detail-art"><img src={game.art} alt={`${game.title} artwork`} /></div><div><p className="eyebrow">{game.category.toUpperCase()} · {game.tag.toUpperCase()}</p><h1>{game.title}</h1><p className="detail-copy">{game.description}</p><div className="controls"><strong>Controls</strong><span>{game.controls}</span></div></div></section>
  {game.gameType==='external'?<section className="external-player"><iframe title={game.title} src={game.embedUrl} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" allow="fullscreen"/><p>External game embed. PlayNest does not control third-party availability.</p></section>:<GamePlayer game={game} />}
  <Ad compact />
</> }
function InfoPage({ page, onBack }) { const content = { About: ['About PlayNest', 'PlayNest is a bright, friendly place to discover browser games. We’re building a curated collection of quick, satisfying games for every kind of break.'], Contact: ['Contact PlayNest', 'Questions, ideas, or feedback? Reach our team at hello@playnest.example. This is contact information only; a contact form will be considered in a future release.'], 'Privacy Policy': ['Privacy Policy', 'PlayNest does not currently offer accounts, payments, or gameplay tracking. As the portal grows, this policy will be updated before any personal data collection is introduced.'], Terms: ['Terms of Use', 'PlayNest is an early-stage browser gaming portal. Game availability and features may change as the platform develops. Please enjoy the catalogue responsibly.'] }[page]; return <section className="info-page"><button className="back" onClick={onBack}><Icon name="back" /> Back to games</button><p className="eyebrow">PLAYNEST</p><h1>{content[0]}</h1><p>{content[1]}</p></section> }
function Footer({ onPage }) { return <footer><button className="brand" onClick={() => onPage('About')}><span>Play</span>Nest</button><p>Small games. Big breaks.</p><nav><button onClick={() => onPage('About')}>About</button><button onClick={() => onPage('Contact')}>Contact</button><button onClick={() => onPage('Privacy Policy')}>Privacy Policy</button><button onClick={() => onPage('Terms')}>Terms</button></nav><small>© 2026 PlayNest. Built for play.</small></footer> }
export default App
