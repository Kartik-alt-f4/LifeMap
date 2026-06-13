import { useState, useEffect, useCallback } from 'react'
import { getState, getConfig } from './api.js'
import Navbar           from './components/Navbar.jsx'
import Dashboard        from './pages/Dashboard.jsx'
import Skills           from './pages/Skills.jsx'
import Stats            from './pages/Stats.jsx'
import Shop             from './pages/Shop.jsx'
import Settings         from './pages/Settings.jsx'
import Graphs           from './pages/Graphs.jsx'
import AddTaskModal     from './components/AddTaskModal.jsx'
import MobileProfile    from './components/MobileProfile.jsx'

const TABS = ['today', 'chat', 'add', 'shop', 'profile']

function LifeMapLogo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M32 4 L52 12 V28 C52 42 43 53 32 60 C21 53 12 42 12 28 V12 Z" fill="white" opacity="0.15"/>
      <path d="M32 10 L46 32 L32 54 L18 32 Z" fill="white"/>
      <path d="M26 22 L32 16 L38 22 L34 22 L34 38 L40 38 L32 46 L24 38 L30 38 L30 22 Z" fill="#0F172A"/>
      <circle cx="32" cy="16" r="3" fill="#0F172A"/>
      <circle cx="24" cy="40" r="2.5" fill="#0F172A"/>
      <circle cx="40" cy="40" r="2.5" fill="#0F172A"/>
    </svg>
  )
}

function MobileBottomNav({ activeTab, onTab, onAdd }) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Main navigation">
      <button
        className={`mob-tab${activeTab === 'today' ? ' active' : ''}`}
        onClick={() => onTab('today')}
        aria-label="Today"
      >
        <span className="mob-tab-icon">📋</span>
        <span className="mob-tab-label">Today</span>
      </button>

      <button
        className={`mob-tab${activeTab === 'chat' ? ' active' : ''}`}
        onClick={() => onTab('chat')}
        aria-label="Chat"
      >
        <span className="mob-tab-icon">◈</span>
        <span className="mob-tab-label">Chat</span>
      </button>

      <button className="mob-tab mob-fab" onClick={onAdd} aria-label="Add task">
        <div className="mob-fab-circle">
          <LifeMapLogo size={22} />
        </div>
      </button>

      <button
        className={`mob-tab${activeTab === 'shop' ? ' active' : ''}`}
        onClick={() => onTab('shop')}
        aria-label="Shop"
      >
        <span className="mob-tab-icon">◆</span>
        <span className="mob-tab-label">Shop</span>
      </button>

      <button
        className={`mob-tab${activeTab === 'profile' ? ' active' : ''}`}
        onClick={() => onTab('profile')}
        aria-label="Profile"
      >
        <span className="mob-tab-icon">👤</span>
        <span className="mob-tab-label">Profile</span>
      </button>
    </nav>
  )
}

export default function App() {
  const [modal,       setModal]       = useState(null)
  const [activeTab,   setActiveTab]   = useState('today')
  const [showAdd,     setShowAdd]     = useState(false)
  const [playerState, setPlayerState] = useState(null)
  const [config,      setConfig]      = useState(null)
  const [isMobile,    setIsMobile]    = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const refreshState = useCallback(async () => {
    try { setPlayerState(await getState()) } catch (e) { console.error(e) }
  }, [])

  useEffect(() => {
    Promise.all([getState(), getConfig()])
      .then(([state, cfg]) => {
        setPlayerState(state)
        setConfig(cfg)
        window.LIFEMAP_CONFIG = cfg
      })
      .catch(console.error)

    const interval = setInterval(refreshState, 60_000)
    return () => clearInterval(interval)
  }, [refreshState])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setModal(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleTab = (tab) => {
    if (tab === 'add') { setShowAdd(true); return }
    setActiveTab(tab)
  }

  const renderMobileContent = () => {
    switch (activeTab) {
      case 'today':
        return (
          <Dashboard
            playerState={playerState}
            config={config}
            onRefresh={refreshState}
            mobileView="today"
          />
        )
      case 'chat':
        return (
          <Dashboard
            playerState={playerState}
            config={config}
            onRefresh={refreshState}
            mobileView="chat"
          />
        )
      case 'shop':
        return (
          <div className="mobile-page">
            <div className="mobile-page-header">
              <span className="mobile-page-title">SHOP</span>
              {playerState && (
                <span className="mobile-page-gold">◆ {playerState.available_gold}g</span>
              )}
            </div>
            <Shop playerState={playerState} onRefresh={refreshState} />
          </div>
        )
      case 'profile':
        return (
          <MobileProfile
            playerState={playerState}
            config={config}
            onRefresh={refreshState}
            onSaved={() => {
              getConfig().then(c => { setConfig(c); window.LIFEMAP_CONFIG = c })
            }}
          />
        )
      default:
        return null
    }
  }

  return (
    <>
      <Navbar
        playerState={playerState}
        activeModal={modal}
        onOpenModal={setModal}
        onRefresh={refreshState}
        onAddTask={() => setShowAdd(true)}
      />

      {/* ── MOBILE layout ── */}
      {isMobile ? (
        <>
          <div className="mobile-content">
            {renderMobileContent()}
          </div>
          <MobileBottomNav
            activeTab={activeTab}
            onTab={handleTab}
            onAdd={() => setShowAdd(true)}
          />
        </>
      ) : (
        /* ── DESKTOP layout ── */
        <>
          <Dashboard
            playerState={playerState}
            config={config}
            onRefresh={refreshState}
          />

          {modal === 'skills' && (
            <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
              <div className="modal">
                <div className="modal-header">
                  <span className="modal-title">Skills</span>
                  <button className="modal-close" onClick={() => setModal(null)}>✕</button>
                </div>
                <div className="modal-body"><Skills /></div>
              </div>
            </div>
          )}

          {modal === 'stats' && (
            <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
              <div className="modal">
                <div className="modal-header">
                  <span className="modal-title">Stats</span>
                  <button className="modal-close" onClick={() => setModal(null)}>✕</button>
                </div>
                <div className="modal-body"><Stats /></div>
              </div>
            </div>
          )}

          {modal === 'shop' && (
            <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
              <div className="modal">
                <div className="modal-header">
                  <span className="modal-title">Shop</span>
                  <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--gold)' }}>
                    ◆ {playerState?.available_gold ?? 0}g available
                  </span>
                  <button className="modal-close" onClick={() => setModal(null)}>✕</button>
                </div>
                <div className="modal-body">
                  <Shop playerState={playerState} onRefresh={refreshState} />
                </div>
              </div>
            </div>
          )}

          {modal === 'graphs' && (
            <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
              <div className="modal" style={{ width:'min(860px, calc(100vw - 32px))' }}>
                <div className="modal-header">
                  <span className="modal-title">Graphs</span>
                  <button className="modal-close" onClick={() => setModal(null)}>✕</button>
                </div>
                <div className="modal-body"><Graphs /></div>
              </div>
            </div>
          )}

          {modal === 'settings' && (
            <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setModal(null)}>
              <div className="modal" style={{ width:'min(780px, calc(100vw - 32px))' }}>
                <div className="modal-header">
                  <span className="modal-title">Settings</span>
                  <button className="modal-close" onClick={() => setModal(null)}>✕</button>
                </div>
                <Settings
                  config={config}
                  onSaved={() => {
                    getConfig().then(c => { setConfig(c); window.LIFEMAP_CONFIG = c })
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* Add task modal — both platforms */}
      {showAdd && (
        <AddTaskModal
          config={config}
          onClose={() => setShowAdd(false)}
          onAdded={async () => {
            setShowAdd(false)
            await refreshState()
          }}
        />
      )}
    </>
  )
}