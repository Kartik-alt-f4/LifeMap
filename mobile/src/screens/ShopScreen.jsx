// src/screens/ShopScreen.jsx
import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl, TextInput, Modal,
  KeyboardAvoidingView, Platform
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getShop, buyItem, getState } from '../api'
import { colors } from '../theme'

const BASE = 'https://lifemap-b0ms.onrender.com'

async function logLeisure(shopItemId, quantity = 1, unit = null) {
  const res = await fetch(`${BASE}/leisure/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop_item_id: shopItemId, quantity, unit })
  })
  if (!res.ok) throw new Error('Log failed')
  return res.json()
}

async function getTodayLeisure() {
  const res = await fetch(`${BASE}/leisure/today`)
  if (!res.ok) return []
  return res.json()
}

function formatCount(unit, quantity) {
  if (!quantity) return null
  if (unit === 'minutes') return `${Math.round(quantity)}min`
  if (unit === 'boolean') return '✓ done'
  return `×${Math.round(quantity)}`
}

// Log quantity input modal
function LogModal({ visible, item, onClose, onLog }) {
  const [qty, setQty] = useState('')
  const unit = item?.tracking_unit

  const handleLog = () => {
    const n = parseFloat(qty)
    if (!qty || isNaN(n) || n <= 0) { Alert.alert('Enter a valid amount'); return }
    onLog(n)
    setQty('')
  }

  const placeholder = unit === 'minutes' ? 'Minutes (e.g. 45)'
    : unit === 'boolean' ? '1'
    : 'Count (e.g. 3)'

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={ls.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={ls.box}>
          <Text style={ls.title}>Log {item?.name}</Text>
          <Text style={ls.subtitle}>{unit === 'minutes' ? 'How many minutes?' : unit === 'boolean' ? 'Mark as done?' : 'How many?'}</Text>
          {unit !== 'boolean' && (
            <TextInput
              style={ls.input}
              value={qty}
              onChangeText={setQty}
              placeholder={placeholder}
              placeholderTextColor={colors.textDim}
              keyboardType="numeric"
              autoFocus
            />
          )}
          <View style={ls.actions}>
            <TouchableOpacity style={ls.cancelBtn} onPress={onClose}>
              <Text style={ls.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ls.logBtn} onPress={unit === 'boolean' ? () => onLog(1) : handleLog}>
              <Text style={ls.logText}>Log</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function ShopCard({ item, gold, freeLeisure, onBuy, onLog, buying, logging, todayQty }) {
  const isLeisure     = item.type === 'leisure'
  const isDayOff      = item.type === 'day_off' || item.type === 'day_off_plus'
  const isDayOffPlus  = item.type === 'day_off_plus'
  const alreadyBought = isDayOff && item.purchased_today > 0
  const canAfford     = freeLeisure && isLeisure ? true : gold >= item.cost_gold
  const isBuying      = buying === item.id
  const isLogging     = logging === item.id
  const countLabel    = formatCount(item.tracking_unit, todayQty)

  return (
    <View style={[
      sc.card,
      alreadyBought && sc.cardActive,
      isDayOffPlus  && sc.cardGold,
    ]}>
      <View style={sc.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={sc.name}>{item.name}</Text>
          {isDayOffPlus && <Text style={sc.typeTag}>DAY OFF+ · LEISURE FREE</Text>}
          {item.type === 'day_off' && <Text style={sc.typeTag}>DAY OFF · MANDATORY MET</Text>}
        </View>
        {alreadyBought && <Text style={sc.activeBadge}>✓ ACTIVE</Text>}
      </View>

      <Text style={sc.desc}>{item.description}</Text>

      <View style={sc.footer}>
        <Text style={[sc.cost, freeLeisure && isLeisure && { color: colors.success }]}>
          {freeLeisure && isLeisure ? '◆ FREE' : `◆ ${item.cost_gold}g`}
        </Text>

        <View style={sc.actions}>
          {/* Today count + log button — leisure items only, always shown */}
          {isLeisure && (
            <View style={sc.counterGroup}>
              {countLabel && (
                <View style={sc.countBadge}>
                  <Text style={sc.countText}>{countLabel}</Text>
                </View>
              )}
              <TouchableOpacity
                style={[sc.logBtn, isLogging && sc.btnDim]}
                onPress={() => onLog(item)}
                disabled={isLogging}
              >
                <Text style={sc.logBtnText}>{isLogging ? '…' : '+'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Buy button */}
          {!alreadyBought && (
            <TouchableOpacity
              style={[sc.buyBtn, (!canAfford || isBuying) && sc.btnDim]}
              onPress={() => onBuy(item)}
              disabled={!canAfford || isBuying || !!buying}
            >
              <Text style={[sc.buyText, (!canAfford || isBuying) && { color: colors.textDim }]}>
                {isBuying ? '…' : 'Buy'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  )
}

export default function ShopScreen() {
  const insets = useSafeAreaInsets()
  const [items,       setItems]       = useState([])
  const [gold,        setGold]        = useState(0)
  const [freeLeisure, setFreeLeisure] = useState(false)
  const [logs,        setLogs]        = useState([])
  const [loading,     setLoading]     = useState(true)
  const [refreshing,  setRefreshing]  = useState(false)
  const [buying,      setBuying]      = useState(null)
  const [logging,     setLogging]     = useState(null)
  const [logModal,    setLogModal]    = useState(null) // item to log

  const load = useCallback(async () => {
    try {
      const [shopData, state, todayLogs] = await Promise.all([
        getShop(), getState(), getTodayLeisure()
      ])
      setItems(shopData)
      setGold(state.available_gold)
      setFreeLeisure(state.free_leisure_today ?? false)
      setLogs(todayLogs)
    } catch (e) { console.error(e) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Sum today quantity per item
  const todayCounts = {}
  for (const log of logs) {
    todayCounts[log.shop_item_id] = (todayCounts[log.shop_item_id] ?? 0) + log.quantity
  }

  const handleBuy = (item) => {
    const costLine = freeLeisure && item.type === 'leisure'
      ? 'Free today (Day Off+).'
      : `Costs ◆ ${item.cost_gold}g. You have ◆ ${gold}g.`
    Alert.alert(`Buy ${item.name}?`, costLine, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Buy', onPress: async () => {
        setBuying(item.id)
        try { await buyItem(item.id); await load() }
        catch (e) { Alert.alert('Error', e.message) }
        finally { setBuying(null) }
      }}
    ])
  }

  const handleLog = (item) => {
    // boolean or no unit — log directly; count/minutes — show input
    if (item.tracking_unit === 'boolean' || item.tracking_unit === 'none') {
      doLog(item, 1)
    } else {
      setLogModal(item)
    }
  }

  const doLog = async (item, qty) => {
    setLogging(item.id)
    setLogModal(null)
    try { await logLeisure(item.id, qty, item.tracking_unit); await load() }
    catch (e) { Alert.alert('Error', e.message) }
    finally { setLogging(null) }
  }

  if (loading) return (
    <View style={[sc.container, sc.center]}><ActivityIndicator color={colors.accent} size="large" /></View>
  )

  return (
    <View style={[sc.container, { paddingTop: insets.top }]}>
      <View style={sc.header}>
        <Text style={sc.heading}>SHOP</Text>
        <View style={sc.headerRight}>
          {freeLeisure && (
            <View style={sc.freeBanner}>
              <Text style={sc.freeBannerText}>LEISURE FREE</Text>
            </View>
          )}
          <Text style={sc.goldText}>◆ {gold}g</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={i => String(i.id)}
        renderItem={({ item }) => (
          <ShopCard
            item={item}
            gold={gold}
            freeLeisure={freeLeisure}
            onBuy={handleBuy}
            onLog={handleLog}
            buying={buying}
            logging={logging}
            todayQty={todayCounts[item.id] ?? 0}
          />
        )}
        contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 80 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor={colors.accent} />
        }
        ListEmptyComponent={<Text style={sc.empty}>No items in shop.</Text>}
      />

      <LogModal
        visible={!!logModal}
        item={logModal}
        onClose={() => setLogModal(null)}
        onLog={(qty) => doLog(logModal, qty)}
      />
    </View>
  )
}

const sc = StyleSheet.create({
  container:     { flex: 1, backgroundColor: colors.bg },
  center:        { alignItems: 'center', justifyContent: 'center' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  heading:       { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.4, textTransform: 'uppercase' },
  headerRight:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  freeBanner:    { backgroundColor: 'rgba(62,207,142,0.12)', borderWidth: 1, borderColor: 'rgba(62,207,142,0.3)', borderRadius: 3, paddingHorizontal: 7, paddingVertical: 3 },
  freeBannerText:{ fontSize: 9, fontWeight: '700', color: colors.success, letterSpacing: 0.6 },
  goldText:      { fontSize: 13, fontWeight: '600', color: colors.gold },
  card:          { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 13, gap: 8 },
  cardActive:    { borderColor: 'rgba(62,207,142,0.35)', backgroundColor: 'rgba(62,207,142,0.04)' },
  cardGold:      { borderColor: 'rgba(240,180,41,0.35)', backgroundColor: 'rgba(240,180,41,0.04)' },
  cardTop:       { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  name:          { fontSize: 13, fontWeight: '600', color: colors.text },
  typeTag:       { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, marginTop: 2 },
  activeBadge:   { fontSize: 9, fontWeight: '700', color: colors.success, letterSpacing: 0.5 },
  desc:          { fontSize: 11, color: colors.textMuted, lineHeight: 16 },
  footer:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  cost:          { fontSize: 13, fontWeight: '600', color: colors.gold },
  actions:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  counterGroup:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countBadge:    { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3 },
  countText:     { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  logBtn:        { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accentDim, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  logBtnText:    { fontSize: 18, color: colors.accent, fontWeight: '300', lineHeight: 22 },
  buyBtn:        { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 4, borderWidth: 1, borderColor: colors.accent },
  buyText:       { fontSize: 11, fontWeight: '700', color: colors.accent, letterSpacing: 0.5 },
  btnDim:        { opacity: 0.4 },
  empty:         { textAlign: 'center', color: colors.textMuted, marginTop: 60, fontSize: 12 },
})

const ls = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  box:        { backgroundColor: colors.surface, borderRadius: 12, padding: 20, width: '80%', gap: 14, borderWidth: 1, borderColor: colors.borderHi },
  title:      { fontSize: 14, fontWeight: '700', color: colors.text },
  subtitle:   { fontSize: 12, color: colors.textMuted },
  input:      { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 11, fontSize: 16, color: colors.text },
  actions:    { flexDirection: 'row', gap: 10 },
  cancelBtn:  { flex: 1, padding: 11, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  cancelText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  logBtn:     { flex: 1, padding: 11, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center' },
  logText:    { fontSize: 13, color: '#fff', fontWeight: '700' },
})