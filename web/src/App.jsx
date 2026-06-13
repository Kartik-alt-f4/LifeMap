import { useState, useEffect, useCallback } from 'react'
import { getState, getConfig } from './api.js'
import Navbar        from './components/Navbar.jsx'
import Dashboard     from './pages/Dashboard.jsx'
import Skills        from './pages/Skills.jsx'
import Stats         from './pages/Stats.jsx'
import Shop          from './pages/Shop.jsx'
import Settings      from './pages/Settings.jsx'
import Graphs        from './pages/Graphs.jsx'

export default function App() {
  const [modal,       setModal]       = useState(null)   // 'skills'|'stats'|'shop'|'settings'|null
  const [playerState, setPlayerState] = useState(null)
  const [config,      setConfig]      = useState(null)

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

  // Close modal on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setModal(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      <Navbar
        playerState={playerState}
        activeModal={modal}
        onOpenModal={setModal}
        onRefresh={refreshState}
      />

      {/* Dashboard is always rendered underneath */}
      <Dashboard
        playerState={playerState}
        config={config}
        onRefresh={refreshState}
        onOpenModal={setModal}
      />

      {/* Modal overlays */}
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
  )
}