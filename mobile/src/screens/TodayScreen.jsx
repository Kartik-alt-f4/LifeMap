// src/screens/TodayScreen.jsx
import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getState, getTasks, completeTask, skipTask, cancelTask } from '../api'
import { colors, type as typeMap, priority as priorityColors } from '../theme'
import TaskDrawer   from '../components/TaskDrawer'

function todayStr() { return new Date().toISOString().split('T')[0] }

function isOverdue(task) {
  if (task.status !== 'pending') return false
  if (task.late_multiplier < 1.0) return true
  if (task.scheduled_at) return new Date(task.scheduled_at) < new Date()
  return false
}

function XpBar({ current, max }) {
  const pct = Math.min(100, Math.max(0, (current / (max || 1)) * 100))
  return (
    <View style={s.barBlock}>
      <View style={s.barLabelRow}>
        <Text style={s.barLabel}>LEVEL</Text>
        <Text style={[s.barValueText, { color: colors.accent }]}>
          {current}<Text style={s.barValueMax}> / {max} XP</Text>
        </Text>
      </View>
      <View style={s.xpTrack}>
        <View style={[s.xpFill, { width: `${pct}%` }]} />
      </View>
    </View>
  )
}

function EnergyBar({ current, max }) {
  const pct   = Math.min(100, Math.max(0, (current / (max || 1)) * 100))
  const color = current < max * 0.10 ? colors.energyRecovery
              : current < max * 0.30 ? colors.energyMin
              : current < max * 0.60 ? colors.energyReduced
              : colors.energyNormal
  return (
    <View style={s.barBlock}>
      <View style={s.barLabelRow}>
        <Text style={s.barLabel}>⚡ ENERGY</Text>
        <Text style={[s.barValueText, { color }]}>
          {current}<Text style={s.barValueMax}> / {max}</Text>
        </Text>
      </View>
      <View style={s.energyTrack}>
        <View style={[s.energyFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  )
}

function TaskRow({ task, onPress }) {
  const overdue = isOverdue(task)
  const done    = task.status === 'completed'
  const skipped = task.status === 'skipped'
  const ti      = typeMap[task.task_type] ?? { icon: '◈', color: colors.textMuted }
  const prColor = priorityColors[task.priority] ?? colors.textMuted

  return (
    <TouchableOpacity
      style={[
        s.taskRow,
        done    && s.taskDone,
        skipped && s.taskSkipped,
        overdue && !done && !skipped && s.taskUrgent,
        task.late_multiplier < 1.0 && !done && s.taskCarried,
      ]}
      onPress={() => onPress(task)}
      activeOpacity={0.7}
    >
      <Text style={s.taskIcon}>{done ? '✓' : ti.icon}</Text>
      <View style={s.taskBody}>
        <View style={s.taskTitleRow}>
          <Text style={[s.taskName, (done || skipped) && s.taskNameDone]} numberOfLines={1}>
            {task.title}
          </Text>
        </View>
        <View style={s.taskMeta}>
          <Text style={[s.tag, { color: ti.color }]}>{task.task_type}</Text>
          <Text style={[s.tag, { color: prColor }]}>{task.priority}</Text>
          {task.time_block && <Text style={s.tag}>{task.time_block}</Text>}
          {task.difficulty && task.difficulty !== 'medium' && <Text style={s.tag}>{task.difficulty}</Text>}
          {overdue && !done && <Text style={[s.tag, { color: colors.danger }]}>overdue</Text>}
          {task.late_multiplier < 1.0 && !done && <Text style={[s.tag, { color: colors.warning }]}>carried</Text>}
          {task.is_recovery && <Text style={[s.tag, { color: colors.success }]}>recovery</Text>}
        </View>
      </View>
      <Text style={s.chevron}>›</Text>
    </TouchableOpacity>
  )
}

export default function TodayScreen() {
  const insets = useSafeAreaInsets()
  const [player,     setPlayer]     = useState(null)
  const [tasks,      setTasks]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected,   setSelected]   = useState(null)
  const [date,       setDate]       = useState(todayStr())

  const isToday = date === todayStr()

  function shiftDate(days) {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().split('T')[0])
  }

  function formatDateLabel(d) {
    const dt    = new Date(d + 'T00:00:00')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const diff  = Math.round((dt - today) / 86400000)
    if (diff === 0)  return 'Today'
    if (diff === -1) return 'Yesterday'
    if (diff === 1)  return 'Tomorrow'
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const load = async (d = date) => {
    try {
      const today = todayStr()
      const [state, taskData] = await Promise.all([
        getState(),
        getTasks(d === today ? undefined : d)
      ])
      setPlayer(state)
      setTasks(taskData)
    } catch (e) { console.error(e) }
    finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { load(date) }, [date])

  const handleComplete = async (id) => {
    try { await completeTask(id); await load(date) } catch (e) { console.error(e) }
  }
  const handleSkip = async (id) => {
    try { await skipTask(id); await load(date) } catch (e) { console.error(e) }
  }
  const handleCancel = async (id) => {
    try { await cancelTask(id); await load(date) } catch (e) { console.error(e) }
  }

  const pending   = tasks.filter(t => t.status === 'pending').length
  const completed = tasks.filter(t => t.status === 'completed').length
  const isDayOff  = player?.day_off_granted || player?.free_leisure_today

  if (loading) return (
    <View style={[s.container, s.center]}><ActivityIndicator color={colors.accent} size="large" /></View>
  )

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>

      {/* Player header — mirrors web navbar stat section */}
      {player && (
        <View style={[s.header, isDayOff && s.headerDayOff]}>
          {/* Row 1: level + rank + badges */}
          <View style={s.headerRow1}>
            <View style={s.levelBlock}>
              <Text style={s.levelText}>Lv.{player.level}</Text>
              <Text style={s.rankText}>{player.rank}</Text>
            </View>
            <View style={s.headerBadges}>
              {isDayOff && (
                <View style={s.dayOffBadge}>
                  <Text style={s.dayOffText}>{player.free_leisure_today ? 'DAY OFF+' : 'DAY OFF'}</Text>
                </View>
              )}
              <Text style={[s.streakBadge, player.streak > 0 && { color: colors.warning }]}>
                {player.streak > 0 ? '🔥' : ''} {player.streak}d
              </Text>
              <Text style={s.goldBadge}>◆ {player.available_gold}g</Text>
            </View>
          </View>

          {/* XP bar */}
          <XpBar current={player.current_xp} max={player.xp_to_next} />

          {/* Energy bar */}
          <EnergyBar current={player.energy?.current ?? 0} max={player.energy?.max ?? 100} />

          {/* Row 4: summary */}
          <Text style={s.summaryText}>{pending} pending · {completed} done</Text>
        </View>
      )}

      {/* Date nav — mirrors web date-selector */}
      <View style={s.dateNav}>
        <TouchableOpacity style={s.dateNavBtn} onPress={() => shiftDate(-1)}>
          <Text style={s.dateNavArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={[s.dateLabel, !isToday && { color: colors.textMuted }]}>
          {formatDateLabel(date)}
        </Text>
        <TouchableOpacity style={s.dateNavBtn} onPress={() => shiftDate(1)}>
          <Text style={s.dateNavArrow}>›</Text>
        </TouchableOpacity>
        {!isToday && (
          <TouchableOpacity style={s.todayPill} onPress={() => setDate(todayStr())}>
            <Text style={s.todayPillText}>Today</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Task list */}
      <View style={s.listHeader}>
        <Text style={s.listTitle}>TASKS</Text>
        <View style={s.countBadge}>
          <Text style={s.countText}>{pending} pending</Text>
        </View>
      </View>

      <FlatList
        data={tasks}
        keyExtractor={t => String(t.id)}
        renderItem={({ item }) => <TaskRow task={item} onPress={setSelected} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(date) }} tintColor={colors.accent} />
        }
        ListEmptyComponent={<Text style={s.empty}>No tasks for this day.</Text>}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
      />

      <TaskDrawer
        task={selected}
        visible={!!selected}
        onClose={() => setSelected(null)}
        onComplete={handleComplete}
        onSkip={handleSkip}
        onCancel={handleCancel}
        onEdited={() => { setSelected(null); load(date) }}
      />
    </View>
  )
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg },
  center:       { alignItems: 'center', justifyContent: 'center' },

  // Header — mirrors web navbar stat section
  header:       { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, padding: 14, gap: 9 },
  headerDayOff: { borderBottomColor: 'rgba(62,207,142,0.35)', backgroundColor: 'rgba(62,207,142,0.03)' },
  headerRow1:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  levelBlock:   { gap: 1 },
  levelText:    { fontSize: 20, fontWeight: '700', color: colors.accent, letterSpacing: -0.5 },
  rankText:     { fontSize: 10, color: colors.textMuted, letterSpacing: 0.5 },
  headerBadges: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  streakBadge:  { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  goldBadge:    { fontSize: 12, fontWeight: '600', color: colors.gold, fontVariant: ['tabular-nums'] },
  dayOffBadge:  { backgroundColor: 'rgba(62,207,142,0.12)', borderWidth: 1, borderColor: 'rgba(62,207,142,0.3)', borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2 },
  dayOffText:   { fontSize: 9, fontWeight: '700', color: '#3ecf8e', letterSpacing: 0.6 },

  // XP bar — thinner, accent purple
  barBlock:       { gap: 4 },
  barLabelRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barLabel:       { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' },
  barValueText:   { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barValueMax:    { color: colors.textMuted, fontWeight: '400' },
  xpTrack:        { height: 3, backgroundColor: colors.surface3, borderRadius: 2, overflow: 'hidden' },
  xpFill:         { height: '100%', backgroundColor: colors.accent, borderRadius: 2 },
  // Energy bar — taller, colour-coded
  energyTrack:    { height: 6, backgroundColor: colors.surface3, borderRadius: 3, overflow: 'hidden' },
  energyFill:     { height: '100%', borderRadius: 3 },
  summaryText:  { fontSize: 10, color: colors.textMuted },

  // Date nav
  dateNav:      { flexDirection: 'row', alignItems: 'center', padding: 10, paddingHorizontal: 14, backgroundColor: colors.surface2, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
  dateNavBtn:   { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dateNavArrow: { fontSize: 16, color: colors.textMuted },
  dateLabel:    { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600', color: colors.text, letterSpacing: 0.3 },
  todayPill:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: colors.accentDim, borderWidth: 1, borderColor: colors.accent },
  todayPillText:{ fontSize: 10, fontWeight: '700', color: colors.accent },

  // List header
  listHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  listTitle:    { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.2 },
  countBadge:   { backgroundColor: colors.surface2, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  countText:    { fontSize: 10, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  // Task rows — mirrors web task-row
  taskRow:      { flexDirection: 'row', alignItems: 'center', padding: 10, paddingHorizontal: 14, borderLeftWidth: 2, borderLeftColor: 'transparent', gap: 10 },
  taskDone:     { borderLeftColor: colors.success, backgroundColor: 'rgba(62,207,142,0.05)' },
  taskSkipped:  { borderLeftColor: '#6b52c8', backgroundColor: 'rgba(107,82,200,0.05)', opacity: 0.65 },
  taskUrgent:   { borderLeftColor: colors.danger, backgroundColor: 'rgba(240,75,75,0.05)' },
  taskCarried:  { borderLeftColor: colors.warning, backgroundColor: 'rgba(240,180,41,0.05)' },
  taskIcon:     { fontSize: 14, width: 20, color: colors.textMuted },
  taskBody:     { flex: 1, gap: 3 },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  taskName:     { fontSize: 12, fontWeight: '500', color: colors.text, flex: 1 },
  taskNameDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  taskMeta:     { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tag:          { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  chevron:      { fontSize: 16, color: colors.textDim },
  empty:        { textAlign: 'center', color: colors.textMuted, marginTop: 60, fontSize: 12 },
})