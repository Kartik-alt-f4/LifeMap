// src/screens/StatsScreen.jsx
import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getStats } from '../api'
import { colors } from '../theme'

const ICONS = { Strength:'💪', Vitality:'❤️', Agility:'⚡', Intelligence:'🧠', Willpower:'🔮', Charisma:'💬' }

function StatCard({ stat }) {
  const streak      = stat.current_streak ?? 0
  const streakColor = streak > 0 ? colors.success : streak < -6 ? colors.danger : colors.textMuted
  const streakLabel = streak > 0 ? `+${streak}` : String(streak)
  const pct         = Math.min(100, stat.current_value ?? 0)

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardIcon}>{ICONS[stat.name] ?? '◈'}</Text>
        <Text style={styles.cardName}>{stat.name.toUpperCase()}</Text>
        <Text style={[styles.cardStreak, { color: streakColor }]}>streak {streakLabel}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.cardFooter}>
        <Text style={styles.cardScore}>{Math.round(pct)}</Text>
        <Text style={styles.cardDesc} numberOfLines={2}>{stat.description}</Text>
      </View>
    </View>
  )
}

export default function StatsScreen() {
  const insets = useSafeAreaInsets()
  const [stats,     setStats]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [refreshing,setRefreshing]= useState(false)

  const load = async () => {
    try { setStats(await getStats()) }
    catch (e) { console.error(e) }
    finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color={colors.accent} size="large" /></View>
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 80 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor={colors.accent} />}
    >
      <Text style={styles.heading}>STATS</Text>
      {stats.map(stat => <StatCard key={stat.id} stat={stat} />)}
      <Text style={styles.hint}>Improve stats by completing tasks. Richer stat descriptions in Settings → better matching.</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bg },
  center:     { alignItems: 'center', justifyContent: 'center' },
  heading:    { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.4, marginBottom: 4 },
  card:       { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardIcon:   { fontSize: 18 },
  cardName:   { flex: 1, fontSize: 12, fontWeight: '700', color: colors.text, letterSpacing: 0.5 },
  cardStreak: { fontSize: 11 },
  barTrack:   { height: 4, backgroundColor: colors.surface3, borderRadius: 2, overflow: 'hidden' },
  barFill:    { height: '100%', backgroundColor: colors.accent, borderRadius: 2 },
  cardFooter: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardScore:  { fontSize: 22, fontWeight: '700', color: colors.accent, minWidth: 40 },
  cardDesc:   { flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 16, marginTop: 4 },
  hint:       { fontSize: 11, color: colors.textDim, textAlign: 'center', marginTop: 8, lineHeight: 16 },
})