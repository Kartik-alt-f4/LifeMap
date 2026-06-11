// src/screens/ShopScreen.jsx
import { useState, useEffect, useCallback } from 'react'
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, ActivityIndicator, RefreshControl } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getShop, buyItem, getState } from '../api'
import { colors } from '../theme'

function ShopItem({ item, gold, onBuy, buying }) {
  const canAfford    = gold >= item.cost_gold
  const isDayOff     = item.type === 'day_off'
  const alreadyBought = isDayOff && item.purchased_today > 0
  const isActive     = buying === item.id

  return (
    <View style={[styles.card, alreadyBought && styles.cardActive]}>
      <View style={styles.cardTop}>
        <Text style={styles.itemName}>{item.name}</Text>
        {alreadyBought && <Text style={styles.activeBadge}>✓ ACTIVE</Text>}
      </View>
      <Text style={styles.itemDesc}>{item.description}</Text>
      <View style={styles.cardBottom}>
        <Text style={styles.cost}>◆ {item.cost_gold}g</Text>
        {!alreadyBought && (
          <TouchableOpacity
            style={[styles.buyBtn, (!canAfford || isActive) && styles.buyBtnDisabled]}
            onPress={() => onBuy(item)}
            disabled={!canAfford || isActive || !!buying}
          >
            <Text style={[styles.buyBtnText, (!canAfford || isActive) && styles.buyBtnTextDim]}>
              {isActive ? '...' : canAfford ? 'Buy' : 'Need more gold'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

export default function ShopScreen() {
  const insets  = useSafeAreaInsets()
  const [items,     setItems]     = useState([])
  const [gold,      setGold]      = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [refreshing,setRefreshing]= useState(false)
  const [buying,    setBuying]    = useState(null)

  const load = useCallback(async () => {
    try {
      const [shopData, state] = await Promise.all([getShop(), getState()])
      setItems(shopData)
      setGold(state.available_gold)
    } catch (e) { console.error(e) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleBuy = async (item) => {
    Alert.alert(
      `Buy ${item.name}?`,
      `This costs ◆ ${item.cost_gold}g. You have ◆ ${gold}g.`,
      [
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
      ]
    )
  }

  if (loading) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color={colors.accent} size="large" /></View>
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.heading}>SHOP</Text>
        <Text style={styles.goldBadge}>◆ {gold}g available</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={i => String(i.id)}
        renderItem={({ item }) => (
          <ShopItem item={item} gold={gold} onBuy={handleBuy} buying={buying} />
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
  container:       { flex: 1, backgroundColor: colors.bg },
  center:          { alignItems: 'center', justifyContent: 'center' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  heading:         { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.4 },
  goldBadge:       { fontSize: 13, fontWeight: '600', color: colors.gold },
  card:            { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, gap: 8 },
  cardActive:      { borderColor: 'rgba(62,207,142,0.35)', backgroundColor: 'rgba(62,207,142,0.05)' },
  cardTop:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemName:        { fontSize: 14, fontWeight: '600', color: colors.text },
  activeBadge:     { fontSize: 10, fontWeight: '700', color: colors.success, letterSpacing: 0.5 },
  itemDesc:        { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  cardBottom:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  cost:            { fontSize: 14, fontWeight: '600', color: colors.gold },
  buyBtn:          { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 6, borderWidth: 1, borderColor: colors.accent },
  buyBtnDisabled:  { borderColor: colors.textDim },
  buyBtnText:      { fontSize: 12, fontWeight: '700', color: colors.accent },
  buyBtnTextDim:   { color: colors.textDim },
  empty:           { textAlign: 'center', color: colors.textMuted, marginTop: 60, fontSize: 13 },
})