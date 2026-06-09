import { useState, useEffect } from 'react'
import { getShop, buyItem } from '../api.js'

export default function Shop({ playerState, onRefresh }) {
  const [items,   setItems]  = useState(null)
  const [loading, setLoad]   = useState(true)
  const [buying,  setBuying] = useState(null)

  const load = async () => {
    setLoad(true)
    try { setItems(await getShop()) } catch (e) { console.error(e) }
    finally { setLoad(false) }
  }

  useEffect(() => { load() }, [])

  const handleBuy = async (item) => {
    if (buying) return
    setBuying(item.id)
    try { await buyItem(item.id); await load(); onRefresh() }
    catch (e) { alert(e.message) }
    finally { setBuying(null) }
  }

  const available = playerState?.available_gold ?? 0

  return (
    <div className="shop-grid">
      {loading ? [0,1,2].map(i => <div key={i} className="skeleton" style={{ height:110 }} />) :
       (items || []).map(item => {
        const canAfford     = available >= item.cost_gold
        const isDayOff      = item.type === 'day_off'
        const alreadyBought = isDayOff && item.purchased_today > 0
        return (
          <div key={item.id} className={`shop-item${alreadyBought ? ' day-off-active' : ''}`}>
            <div className="shop-item-name">{item.name}</div>
            <div className="shop-item-desc">{item.description}</div>
            <div className="shop-item-footer">
              <span className="shop-cost">◆ {item.cost_gold}g</span>
              {alreadyBought
                ? <span className="shop-active-badge">✓ Active</span>
                : <button className="shop-buy" disabled={!canAfford || buying === item.id} onClick={() => handleBuy(item)}>
                    {buying === item.id ? '...' : 'Buy'}
                  </button>
              }
            </div>
          </div>
        )
      })}
    </div>
  )
}