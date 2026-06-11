// src/screens/ShopScreen.jsx
import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getShop, buyItem, getState } from '../api'
import { colors } from '../theme'

const BASE = 'https://lifemap-b0ms.onrender.com'

async function logLeisure(shopItemId, quantity = 1) {
  const res = await fetch(`${BASE}/leisure/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop_item_id: shopItemId, quantity })
  })
  if (!res.ok) throw new Error('Log failed')
  return res.json()
}

async function getTodayLeisure() {
  const res = await fetch(`${BASE}/leisure/today`)
  if (!res.ok) return []
  return res.json()
}

function getUnitLabel(unit, quantity) {
  if (unit === 'minutes') return `${quantity}min`
  if (unit === 'boolean') return 'done'
  return `×${quantity}`
}

function ShopCard({ item, gold, freeleisure, onBuy, onLog, buying, logging, todayCount }) {
  const canAfford     = freeleisure && item.type === 'leisure' ? true : gold >= item.cost_gold
  const isDayOff      = item.type === 'day_off' || item.type === 'day_off_plus'
  const alreadyBought = isDayOff && item.purchased_today > 0
  const isLeisure     = item.type === 'leisure'
  const isBuying      = buying === item.id
  const isLogging     = logging === item.id

  const typeColor = item.type === 'day_off_plus' ? colors.gold
    : item.type === 'day_off' ? colors.success
    : colors.accent

  return (
    <View style={[styles.card, alreadyBought && styles.cardActive, item.type === 'day_off_plus' && styles.cardGold]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemName}>{item.name}</Text>
          {item.type === 'day_off_plus' && (
            <Text style={styles.typeTag}>DAY OFF+  · all leisure free</Text>
          )}
          {item.type === 'day_off' && (
            <Text style={styles.typeTag}>DAY OFF · mandatory met</Text>
          )}
        </View>
        {alreadyBought && <Text style={[styles.activeBadge, { color: typeColor }]}>✓ ACTIVE</Text>}
      </View>

      <Text style={styles.itemDesc}>{item.description}</Text>

      <View style={styles.cardBottom}>
        <Text style={[styles.cost, freeleisure && isLeisure && styles.costFree]}>
          {freeleisure && isLeisure ? '◆ FREE' : `◆ ${item.cost_gold}g`}
        </Text>

        <View style={styles.cardActions}>
          {/* Buy button */}
          {!alreadyBought && (
            <TouchableOpacity
              style={[styles.buyBtn, (!canAfford || isBuying) && styles.btnDisabled]}
              onPress={() => onBuy(item)}
              disabled={!canAfford || isBuying || !!buying}
            >
              <Text style={[styles.buyBtnText, (!canAfford || isBuying) && styles.btnTextDim]}>
                {isBuying ? '…' : 'Buy'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Log counter — leisure items only */}
          {isLeisure && (
            <View style={styles.counterWrap}>
              {todayCount > 0 && (
                <Text style={styles.countBadge}>
                  {getUnitLabel(item.tracking_unit, todayCount)}
                </Text>
              )}
              <TouchableOpacity
                style={[styles.logBtn, isLogging && styles.btnDisabled]}
                onPress={() => onLog(item)}
                disabled={isLogging}
              >
                <Text style={styles.logBtnText}>{isLogging ? '…' : '+'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </View>
  )
}

export default function ShopScreen() {
  const insets  = useSafeAreaInsets()
  const [items,       setItems]       = useState([])
  const [gold,        setGold]        = useState(0)
  const [freeleisure, setFreeLeisure] = useState(false)
  const [leisureLogs, setLeisureLogs] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [refreshing,  setRefreshing]  = useState(false)
  const [buying,      setBuying]      = useState(null)
  const [logging,     setLogging]     = useState(null)

  const load = useCallback(async () => {
    try {
      const [shopData, state, logs] = await Promise.all([
        getShop(), getState(), getTodayLeisure()
      ])
      setItems(shopData)
      setGold(state.available_gold)
      setFreeLeisure(state.free_leisure_today ?? false)
      setLeisureLogs(logs)
    } catch (e) { console.error(e) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Sum today's quantity per item
  const todayCounts = {}
  for (const log of leisureLogs) {
    const id = log.shop_item_id
    todayCounts[id] = (todayCounts[id] ?? 0) + log.quantity
  }

  const handleBuy = (item) => {
    const costLine = freeleisure && item.type === 'leisure'
      ? 'This is FREE today (Day Off+).'
      : `This costs ◆ ${item.cost_gold}g. You have ◆ ${gold}g.`

    Alert.alert(`Buy ${item.name}?`, costLine, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Buy',
        onPress: async () => {
          setBuying(item.id)
          try {
            await buyItem(item.id)
            await load()
          } catch (e) {
            Alert.alert('Error', e.message)
          } finally {
            setBuying(null)
          }
        }
      }
    ])
  }

  const handleLog = async (item) => {
    setLogging(item.id)
    try {
      await logLeisure(item.id, 1)
      await load()
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setLogging(null)
    }
  }

  if (loading) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color={colors.accent} size="large" /></View>
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.heading}>SHOP</Text>
        <View style={styles.headerRight}>
          {freeleisure && <Text style={styles.freeBadge}>LEISURE FREE</Text>}
          <Text style={styles.goldBadge}>◆ {gold}g</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={i => String(i.id)}
        renderItem={({ item }) => (
          <ShopCard
            item={item}
            gold={gold}
            freeleisure={freeleisure}
            onBuy={handleBuy}
            onLog={handleLog}
            buying={buying}
            logging={logging}
            todayCount={todayCounts[item.id] ?? 0}
          />
        )}
        contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 80 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor={colors.accent} />
        }
        ListEmptyComponent={<Text style={styles.empty}>No items in shop.</Text>}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg },
  center:       { alignItems: 'center', justifyContent: 'center' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  heading:      { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.4 },
  headerRight:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  freeBadge:    { fontSize: 9, fontWeight: '700', color: colors.gold, backgroundColor: 'rgba(240,180,41,0.12)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(240,180,41,0.3)', letterSpacing: 0.5 },
  goldBadge:    { fontSize: 13, fontWeight: '600', color: colors.gold },
  card:         { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, gap: 8 },
  cardActive:   { borderColor: 'rgba(62,207,142,0.35)', backgroundColor: 'rgba(62,207,142,0.04)' },
  cardGold:     { borderColor: 'rgba(240,180,41,0.35)', backgroundColor: 'rgba(240,180,41,0.04)' },
  cardTop:      { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  itemName:     { fontSize: 14, fontWeight: '600', color: colors.text },
  typeTag:      { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, marginTop: 2 },
  activeBadge:  { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  itemDesc:     { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  cardBottom:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  cost:         { fontSize: 14, fontWeight: '600', color: colors.gold },
  costFree:     { color: colors.success },
  cardActions:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buyBtn:       { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 6, borderWidth: 1, borderColor: colors.accent },
  buyBtnText:   { fontSize: 12, fontWeight: '700', color: colors.accent },
  counterWrap:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countBadge:   { fontSize: 11, fontWeight: '600', color: colors.textMuted, backgroundColor: colors.surface2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  logBtn:       { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accentDim, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  logBtnText:   { fontSize: 18, color: colors.accent, fontWeight: '300', lineHeight: 22 },
  btnDisabled:  { opacity: 0.4 },
  btnTextDim:   { color: colors.textDim },
  empty:        { textAlign: 'center', color: colors.textMuted, marginTop: 60, fontSize: 13 },
})