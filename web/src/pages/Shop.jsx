// web/src/pages/Shop.jsx
import { useState, useEffect } from 'react'
import { getShop, buyItem, getState } from '../api.js'

const BASE = ''  // relative — proxied through Vite

async function logLeisure(shopItemId, quantity = 1) {
  const res = await fetch(`/leisure/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop_item_id: shopItemId, quantity })
  })
  if (!res.ok) throw new Error('Log failed')
  return res.json()
}

async function getTodayLeisure() {
  const res = await fetch(`/leisure/today`)
  if (!res.ok) return []
  return res.json()
}

function getUnitLabel(unit, quantity) {
  if (unit === 'minutes') return `${quantity}min`
  if (unit === 'boolean') return 'done'
  return `×${Math.round(quantity)}`
}

export default function Shop({ playerState, onRefresh }) {
  const [items,       setItems]       = useState(null)
  const [loading,     setLoad]        = useState(true)
  const [buying,      setBuying]      = useState(null)
  const [logging,     setLogging]     = useState(null)
  const [leisureLogs, setLeisureLogs] = useState([])
  const [freeLeisure, setFreeLeisure] = useState(false)

  const load = async () => {
    setLoad(true)
    try {
      const [shopData, logs, state] = await Promise.all([
        getShop(), getTodayLeisure(), getState()
      ])
      setItems(shopData)
      setLeisureLogs(logs)
      setFreeLeisure(state.free_leisure_today ?? false)
    } catch (e) { console.error(e) }
    finally { setLoad(false) }
  }

  useEffect(() => { load() }, [])

  // Sum today's quantity per item
  const todayCounts = {}
  for (const log of leisureLogs) {
    todayCounts[log.shop_item_id] = (todayCounts[log.shop_item_id] ?? 0) + log.quantity
  }

  const handleBuy = async (item) => {
    if (buying) return
    setBuying(item.id)
    try { await buyItem(item.id); await load(); onRefresh() }
    catch (e) { alert(e.message) }
    finally { setBuying(null) }
  }

  const handleLog = async (item) => {
    if (logging) return
    setLogging(item.id)
    try { await logLeisure(item.id, 1); await load() }
    catch (e) { alert(e.message) }
    finally { setLogging(null) }
  }

  const available = playerState?.available_gold ?? 0

  return (
    <>
      {/* Day Off+ banner */}
      {freeLeisure && (
        <div style={{
          margin: '14px 14px 0', padding: '9px 14px',
          background: 'rgba(62,207,142,0.08)',
          border: '1px solid rgba(62,207,142,0.3)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12, color: 'var(--success)', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 8
        }}>
          <span>✦</span>
          <span>Day Off+ active — all leisure items are free today</span>
        </div>
      )}

      <div className="shop-grid">
        {loading ? [0,1,2].map(i => <div key={i} className="skeleton" style={{ height:110 }} />) :
        (items || []).map(item => {
          const canAfford     = freeLeisure && item.type === 'leisure' ? true : available >= item.cost_gold
          const isDayOff      = item.type === 'day_off' || item.type === 'day_off_plus'
          const alreadyBought = isDayOff && item.purchased_today > 0
          const isLeisure     = item.type === 'leisure'
          const todayCount    = todayCounts[item.id] ?? 0

          return (
            <div key={item.id} className={`shop-item${alreadyBought ? ' day-off-active' : ''}`}
              style={item.type === 'day_off_plus' ? { borderColor: 'rgba(240,180,41,0.4)', background: 'rgba(240,180,41,0.04)' } : {}}>

              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div className="shop-item-name">{item.name}</div>
                {alreadyBought && <span className="shop-active-badge">✓ Active</span>}
              </div>

              {item.type === 'day_off_plus' && (
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', marginTop: -4 }}>
                  DAY OFF+ · LEISURE FREE
                </div>
              )}

              <div className="shop-item-desc">{item.description}</div>

              <div className="shop-item-footer">
                <span className="shop-cost" style={freeLeisure && isLeisure ? { color: 'var(--success)' } : {}}>
                  {freeLeisure && isLeisure ? '◆ FREE' : `◆ ${item.cost_gold}g`}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {/* Today's count badge */}
                  {isLeisure && todayCount > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      padding: '2px 6px', borderRadius: 4
                    }}>
                      {getUnitLabel(item.tracking_unit, todayCount)}
                    </span>
                  )}

                  {/* Log + button — only on Day Off+ days */}
                  {isLeisure && freeLeisure && (
                    <button
                      onClick={() => handleLog(item)}
                      disabled={!!logging}
                      style={{
                        width: 26, height: 26, borderRadius: 13,
                        background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                        color: 'var(--accent)', fontSize: 16, fontWeight: 300,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', opacity: logging === item.id ? 0.5 : 1
                      }}
                    >+</button>
                  )}

                  {/* Buy button */}
                  {!alreadyBought && (
                    <button
                      className="shop-buy"
                      disabled={!canAfford || buying === item.id}
                      onClick={() => handleBuy(item)}
                    >
                      {buying === item.id ? '…' : 'Buy'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}