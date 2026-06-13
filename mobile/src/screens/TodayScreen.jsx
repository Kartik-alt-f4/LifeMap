// src/screens/TodayScreen.jsx
import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getState, getTasks, completeTask, skipTask, cancelTask } from '../api'
import { colors, type as typeMap, priority as priorityColors } from '../theme'
import TaskDrawer from '../components/TaskDrawer'

function todayStr() { return new Date().toISOString().split('T')[0] }

function isOverdue(task) {
  if (task.status !== 'pending') return false
  if (task.late_multiplier < 1.0) return true
  if (task.scheduled_at) return new Date(task.scheduled_at) < new Date()
  return false
}

function StatBar({ label, value, max, color }) {
  return (
    <View style={styles.statBarWrap}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statTrack}>
        <View style={[styles.statFill, { width: `${Math.min(100, (value / max) * 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
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
        styles.taskRow,
        done    && styles.taskDone,
        skipped && styles.taskSkipped,
        overdue && !done && !skipped && styles.taskOverdue,
      ]}
      onPress={() => onPress(task)}
      activeOpacity={0.7}
    >
      <Text style={styles.taskIcon}>{done ? '✓' : ti.icon}</Text>
      <View style={styles.taskBody}>
        <Text style={[styles.taskTitle, (done || skipped) && styles.taskTitleDim]} numberOfLines={1}>
          {task.title}
        </Text>
        <View style={styles.taskMeta}>
          <Text style={[styles.tag, { color: ti.color }]}>{task.task_type}</Text>
          <Text style={[styles.tag, { color: prColor }]}>{task.priority}</Text>
          {task.time_block && <Text style={styles.tag}>{task.time_block}</Text>}
          {overdue && !done && <Text style={[styles.tag, { color: colors.danger }]}>overdue</Text>}
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  )
}

export default function TodayScreen() {
  const insets = useSafeAreaInsets()
  const [player,     setPlayer]     = useState(null)
  const [tasks,      setTasks]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState(null)
  const [date,       setDate]       = useState(todayStr())

  const isToday = date === todayStr()

  function shiftDate(days) {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().split('T')[0])
  }

  function formatDateLabel(d) {
    const dt   = new Date(d + 'T00:00:00')
    const today = new Date(); today.setHours(0,0,0,0)
    const diff  = Math.round((dt - today) / 86400000)
    if (diff === 0)  return 'Today'
    if (diff === -1) return 'Yesterday'
    if (diff === 1)  return 'Tomorrow'
    return dt.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
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

  if (loading) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color={colors.accent} size="large" /></View>
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Player header */}
      {player && (
        <View style={[
          styles.header,
          (player.day_off_granted || player.free_leisure_today) && styles.headerDayOff
        ]}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.levelText}>Lv.{player.level} <Text style={styles.rankText}>{player.rank}</Text></Text>
            </View>
            <Text style={styles.goldText}>◆ {player.available_gold}g</Text>
          </View>
          <StatBar label="XP"     value={player.current_xp}     max={player.xp_to_next}  color={colors.accent} />
          <StatBar label="Energy" value={player.energy?.current} max={player.energy?.max} color={colors.accent} />
          <View style={styles.headerBottom}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.streakText}>{player.streak > 0 ? '🔥' : ''} {player.streak}d streak</Text>
              {(player.day_off_granted || player.free_leisure_today) && (
                <Text style={styles.dayOffBadge}>
                  {player.free_leisure_today ? 'DAY OFF+' : 'DAY OFF'}
                </Text>
              )}
            </View>
            <Text style={styles.summaryText}>{pending} pending · {completed} done</Text>
          </View>
        </View>
      )}

      {/* Date navigation */}
      <View style={styles.dateNav}>
        <TouchableOpacity style={styles.dateNavBtn} onPress={() => shiftDate(-1)}>
          <Text style={styles.dateNavArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.dateLabel, !isToday && styles.dateLabelPast]}>{formatDateLabel(date)}</Text>
        <TouchableOpacity style={styles.dateNavBtn} onPress={() => shiftDate(1)}>
          <Text style={styles.dateNavArrow}>›</Text>
        </TouchableOpacity>
        {!isToday && (
          <TouchableOpacity style={styles.todayBtn} onPress={() => setDate(todayStr())}>
            <Text style={styles.todayBtnText}>Today</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Task list */}
      <FlatList
        data={tasks}
        keyExtractor={t => String(t.id)}
        renderItem={({ item }) => <TaskRow task={item} onPress={setSelected} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(date) }} tintColor={colors.accent} />
        }
        ListEmptyComponent={<Text style={styles.empty}>No tasks today.</Text>}
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

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg },
  center:       { alignItems: 'center', justifyContent: 'center' },
  header:       { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, padding: 14, gap: 8 },
  headerTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  levelText:    { fontSize: 16, fontWeight: '700', color: colors.accent },
  rankText:     { fontSize: 11, color: colors.textMuted, fontWeight: '400' },
  goldText:     { fontSize: 13, fontWeight: '600', color: colors.gold },
  statBarWrap:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statLabel:    { fontSize: 10, color: colors.textMuted, width: 40 },
  statTrack:    { flex: 1, height: 3, backgroundColor: colors.surface3, borderRadius: 2, overflow: 'hidden' },
  statFill:     { height: '100%', borderRadius: 2 },
  statValue:    { fontSize: 10, color: colors.textMuted, width: 30, textAlign: 'right' },
  headerBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  streakText:   { fontSize: 11, color: colors.warning },
  summaryText:  { fontSize: 11, color: colors.textMuted },
  taskRow:      { flexDirection: 'row', alignItems: 'center', padding: 13, paddingHorizontal: 16, borderLeftWidth: 2, borderLeftColor: 'transparent', gap: 10 },
  taskDone:     { borderLeftColor: colors.success, backgroundColor: 'rgba(62,207,142,0.05)' },
  taskSkipped:  { borderLeftColor: '#6b52c8', backgroundColor: 'rgba(107,82,200,0.05)', opacity: 0.65 },
  taskOverdue:  { borderLeftColor: colors.danger, backgroundColor: 'rgba(240,75,75,0.05)' },
  taskIcon:     { fontSize: 16, width: 22 },
  taskBody:     { flex: 1, gap: 3 },
  taskTitle:    { fontSize: 13, fontWeight: '500', color: colors.text },
  taskTitleDim: { color: colors.textMuted, textDecorationLine: 'line-through' },
  taskMeta:     { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tag:          { fontSize: 10, color: colors.textMuted },
  chevron:      { fontSize: 18, color: colors.textDim },
  empty:        { textAlign: 'center', color: colors.textMuted, marginTop: 60, fontSize: 13 },
  dateNav:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
  dateNavBtn:   { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dateNavArrow: { fontSize: 18, color: colors.textMuted },
  dateLabel:    { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '600', color: colors.text },
  dateLabelPast:{ color: colors.textMuted },
  todayBtn:     { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.accentDim, borderWidth: 1, borderColor: colors.accent },
  todayBtnText: { fontSize: 11, fontWeight: '700', color: colors.accent },
  headerDayOff: { borderBottomColor: 'rgba(62,207,142,0.35)', backgroundColor: 'rgba(62,207,142,0.04)' },
  dayOffBadge:  { fontSize: 9, fontWeight: '700', color: '#3ecf8e', backgroundColor: 'rgba(62,207,142,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, borderWidth: 1, borderColor: 'rgba(62,207,142,0.3)', letterSpacing: 0.5 },

})