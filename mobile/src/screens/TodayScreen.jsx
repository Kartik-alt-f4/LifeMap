// src/screens/TodayScreen.jsx
import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getState, getTasks, completeTask, skipTask } from '../api'
import { colors, type as typeMap, priority as priorityColors } from '../theme'

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

function TaskRow({ task, onComplete, onSkip }) {
  const overdue  = isOverdue(task)
  const done     = task.status === 'completed'
  const skipped  = task.status === 'skipped'
  const ti       = typeMap[task.task_type] ?? { icon: '◈', color: colors.textMuted }
  const prColor  = priorityColors[task.priority] ?? colors.textMuted

  return (
    <View style={[
      styles.taskRow,
      done    && styles.taskDone,
      skipped && styles.taskSkipped,
      overdue && !done && !skipped && styles.taskOverdue,
    ]}>
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
      {task.status === 'pending' && (
        <View style={styles.taskActions}>
          <TouchableOpacity style={styles.doneBtn} onPress={() => onComplete(task.id)}>
            <Text style={styles.doneBtnText}>✓</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.skipBtn} onPress={() => onSkip(task.id)}>
            <Text style={styles.skipBtnText}>–</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

export default function TodayScreen() {
  const insets = useSafeAreaInsets()
  const [player,    setPlayer]    = useState(null)
  const [tasks,     setTasks]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [refreshing,setRefreshing]= useState(false)

  const load = useCallback(async () => {
    try {
      const [state, taskData] = await Promise.all([getState(), getTasks()])
      setPlayer(state)
      setTasks(taskData)
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleComplete = async (id) => {
    try {
      await completeTask(id)
      await load()
    } catch (e) { Alert.alert('Error', e.message) }
  }

  const handleSkip = async (id) => {
    try {
      await skipTask(id)
      await load()
    } catch (e) { Alert.alert('Error', e.message) }
  }

  const pending   = tasks.filter(t => t.status === 'pending').length
  const completed = tasks.filter(t => t.status === 'completed').length

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    )
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Player header */}
      {player && (
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.levelText}>Lv.{player.level}</Text>
            <Text style={styles.rankText}>{player.rank}</Text>
            <Text style={styles.goldText}>◆ {player.available_gold}g</Text>
          </View>
          <StatBar label="XP"     value={player.current_xp}      max={player.xp_to_next}    color={colors.accent} />
          <StatBar label="Energy" value={player.energy?.current}  max={player.energy?.max}   color={colors.accent} />
          <View style={styles.streakRow}>
            <Text style={styles.streakText}>
              {player.streak > 0 ? '🔥' : ''} {player.streak} day streak
            </Text>
            <Text style={styles.summaryText}>{pending} pending · {completed} done</Text>
          </View>
        </View>
      )}

      {/* Task list */}
      <FlatList
        data={tasks}
        keyExtractor={t => String(t.id)}
        renderItem={({ item }) => (
          <TaskRow task={item} onComplete={handleComplete} onSkip={handleSkip} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load() }}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>No tasks today.</Text>
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: colors.bg },
  center:      { alignItems: 'center', justifyContent: 'center' },
  header:      { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, padding: 16, gap: 8 },
  headerRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  levelText:   { fontSize: 16, fontWeight: '700', color: colors.accent },
  rankText:    { flex: 1, fontSize: 11, color: colors.textMuted, letterSpacing: 0.5 },
  goldText:    { fontSize: 13, fontWeight: '600', color: colors.gold },
  statBarWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statLabel:   { fontSize: 10, color: colors.textMuted, width: 40 },
  statTrack:   { flex: 1, height: 3, backgroundColor: colors.surface3, borderRadius: 2, overflow: 'hidden' },
  statFill:    { height: '100%', borderRadius: 2 },
  statValue:   { fontSize: 10, color: colors.textMuted, width: 30, textAlign: 'right', fontVariant: ['tabular-nums'] },
  streakRow:   { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  streakText:  { fontSize: 11, color: colors.warning },
  summaryText: { fontSize: 11, color: colors.textMuted },
  taskRow:     { flexDirection: 'row', alignItems: 'center', padding: 12, paddingHorizontal: 16, borderLeftWidth: 2, borderLeftColor: 'transparent', gap: 10 },
  taskDone:    { borderLeftColor: colors.success, backgroundColor: 'rgba(62,207,142,0.05)' },
  taskSkipped: { borderLeftColor: '#6b52c8', backgroundColor: 'rgba(107,82,200,0.05)', opacity: 0.65 },
  taskOverdue: { borderLeftColor: colors.danger, backgroundColor: 'rgba(240,75,75,0.05)' },
  taskIcon:    { fontSize: 16, width: 22 },
  taskBody:    { flex: 1, gap: 3 },
  taskTitle:   { fontSize: 13, fontWeight: '500', color: colors.text },
  taskTitleDim:{ color: colors.textMuted, textDecorationLine: 'line-through' },
  taskMeta:    { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tag:         { fontSize: 10, color: colors.textMuted },
  taskActions: { flexDirection: 'row', gap: 6 },
  doneBtn:     { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.accentDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent },
  doneBtnText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  skipBtn:     { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  skipBtnText: { color: colors.textMuted, fontSize: 18, fontWeight: '300' },
  empty:       { textAlign: 'center', color: colors.textMuted, marginTop: 60, fontSize: 13 },
})