// src/screens/GraphsScreen.jsx
import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  RefreshControl, TouchableOpacity, Dimensions
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Polyline, Polygon, Rect, Defs, LinearGradient, Stop } from 'react-native-svg'
import { colors } from '../theme'

const BASE = 'https://lifemap-b0ms.onrender.com'
const W = Dimensions.get('window').width - 28 // card width

async function getSnapshots() {
  const res = await fetch(`${BASE}/snapshots`)
  if (!res.ok) return []
  return res.json()
}

function LineChart({ data, dataKey, color, label, formatVal }) {
  if (!data.length) return null
  const values = data.map(d => d[dataKey] ?? 0)
  const max    = Math.max(...values, 1)
  const min    = Math.min(...values, 0)
  const range  = max - min || 1
  const H      = 70
  const CW     = W - 28

  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * CW
    const y = H - ((v - min) / range) * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const polyPts = `0,${H} ${pts} ${CW},${H}`
  const last = values[values.length - 1]

  return (
    <View style={g.chart}>
      <View style={g.chartHeader}>
        <Text style={g.chartLabel}>{label}</Text>
        <Text style={[g.chartValue, { color }]}>{formatVal ? formatVal(last) : last}</Text>
      </View>
      <Svg width={CW} height={H + 4} style={{ marginTop: 4 }}>
        <Defs>
          <LinearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Polygon points={polyPts} fill={`url(#grad-${dataKey})`} />
        <Polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
      <View style={g.chartFooter}>
        <Text style={g.chartDate}>{data[0]?.date?.slice(5)}</Text>
        <Text style={g.chartDate}>{data[data.length-1]?.date?.slice(5)}</Text>
      </View>
    </View>
  )
}

function BarChart({ data, dataKey, color, label }) {
  if (!data.length) return null
  const values = data.map(d => d[dataKey] ?? 0)
  const max    = Math.max(...values, 1)
  const H      = 60
  const CW     = W - 28
  const barW   = Math.max(2, (CW / values.length) - 1)

  return (
    <View style={g.chart}>
      <View style={g.chartHeader}>
        <Text style={g.chartLabel}>{label}</Text>
        <Text style={[g.chartValue, { color }]}>{values[values.length-1]}</Text>
      </View>
      <Svg width={CW} height={H + 4} style={{ marginTop: 4 }}>
        {values.map((v, i) => {
          const barH = (v / max) * H
          const x    = i * (CW / values.length)
          return (
            <Rect
              key={i}
              x={x + 0.5}
              y={H - barH}
              width={barW}
              height={barH}
              fill={color}
              opacity={0.5 + (i / values.length) * 0.5}
              rx={2}
            />
          )
        })}
      </Svg>
      <View style={g.chartFooter}>
        <Text style={g.chartDate}>{data[0]?.date?.slice(5)}</Text>
        <Text style={g.chartDate}>{data[data.length-1]?.date?.slice(5)}</Text>
      </View>
    </View>
  )
}

const RANGES = [7, 14, 30, 90]

export default function GraphsScreen() {
  const insets = useSafeAreaInsets()
  const [snapshots,  setSnapshots]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [range,      setRange]      = useState(30)

  const load = async () => {
    try { setSnapshots(await getSnapshots()) }
    catch (e) { console.error(e) }
    finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { load() }, [])

  const data = snapshots.slice(-range)

  if (loading) return (
    <View style={[g.container, g.center, { paddingTop: insets.top }]}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  )

  return (
    <View style={[g.container, { paddingTop: insets.top }]}>
      <View style={g.header}>
        <Text style={g.heading}>GRAPHS</Text>
        <View style={g.rangeTabs}>
          {RANGES.map(r => (
            <TouchableOpacity
              key={r}
              style={[g.rangeTab, range === r && g.rangeTabActive]}
              onPress={() => setRange(r)}
            >
              <Text style={[g.rangeTabText, range === r && { color: colors.accent }]}>{r}d</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor={colors.accent} />}
      >
        {!data.length ? (
          <Text style={g.empty}>No data yet — snapshots are written at EOD each day.</Text>
        ) : (
          <>
            <LineChart data={data} dataKey="current_xp"     color={colors.accent}  label="XP" />
            <LineChart data={data} dataKey="day_streak"     color={colors.warning} label="Streak" formatVal={v => `${v}d`} />
            <LineChart data={data} dataKey="available_gold" color={colors.gold}    label="Gold" formatVal={v => `◆ ${v}g`} />
            <LineChart data={data} dataKey="energy"         color={colors.success} label="Energy (EOD)" />
            <BarChart  data={data} dataKey="tasks_completed" color={colors.accent} label="Tasks completed" />
            <BarChart  data={data} dataKey="tasks_skipped"   color={colors.danger} label="Tasks skipped" />
          </>
        )}
      </ScrollView>
    </View>
  )
}

const g = StyleSheet.create({
  container:      { flex: 1, backgroundColor: colors.bg },
  center:         { alignItems: 'center', justifyContent: 'center' },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  heading:        { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.4 },
  rangeTabs:      { flexDirection: 'row', gap: 4 },
  rangeTab:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  rangeTabActive: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  rangeTabText:   { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  chart:          { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14 },
  chartHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chartLabel:     { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' },
  chartValue:     { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  chartFooter:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  chartDate:      { fontSize: 9, color: colors.textDim },
  empty:          { textAlign: 'center', color: colors.textMuted, fontSize: 12, marginTop: 40, lineHeight: 20 },
})