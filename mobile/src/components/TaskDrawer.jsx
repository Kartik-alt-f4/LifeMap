// src/components/TaskDrawer.jsx
import { useState, useEffect } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Alert
} from 'react-native'
import { editTask } from '../api'
import { colors, type as typeMap, priority as priorityColors } from '../theme'

const TYPES      = ['anchor','mandatory','project','bonus','habit','routine']
const PRIORITIES = ['P0','P1','P2','P3']
const DIFFS      = ['low','medium','high']
const BLOCKS     = ['morning','noon','evening','night','midnight']

function computeRewards(task, config) {
  const g = config?.game
  if (!g) return null
  const xp = Math.max(0,
    (g.tasks.xp_base[task.task_type]                ?? 0) +
    (g.tasks.difficulty_xp_offset?.[task.difficulty] ?? 0)
  )
  const gold = Math.max(g.tasks.gold_floor ?? 1,
    (g.tasks.gold_base[task.task_type]                ?? 0) +
    (g.tasks.difficulty_gold_offset?.[task.difficulty] ?? 0)
  )
  const energyBase   = g.energy.drain_by_type?.[task.task_type]            ?? 5
  const energyOffset = g.energy.drain_difficulty_offset?.[task.difficulty] ?? 0
  const energy       = Math.max(g.energy.drain_floor ?? 1, energyBase + energyOffset)
  return { xp, gold, energy }
}

function formatScheduledTime(scheduled_at) {
  if (!scheduled_at) return null
  const d = new Date(scheduled_at)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function Seg({ options, value, onChange, colorMap, allowDeselect }) {
  return (
    <View style={s.segGroup}>
      {options.map(o => (
        <TouchableOpacity
          key={o}
          style={[s.segBtn, value === o && s.segActive]}
          onPress={() => onChange(allowDeselect && value === o ? '' : o)}
        >
          <Text style={[s.segText, value === o && { color: colorMap?.[o] ?? colors.accent }]}>{o}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

function Toggle({ label, value, onChange }) {
  return (
    <TouchableOpacity style={s.toggleRow} onPress={() => onChange(!value)}>
      <Text style={s.toggleLabel}>{label}</Text>
      <View style={[s.track, value && s.trackOn]}>
        <View style={[s.thumb, value && s.thumbOn]} />
      </View>
    </TouchableOpacity>
  )
}

export default function TaskDrawer({ task, config, visible, onClose, onComplete, onSkip, onCancel, onEdited }) {
  const [editing,     setEditing]    = useState(false)
  const [saving,      setSaving]     = useState(false)
  const [title,       setTitle]      = useState('')
  const [taskType,    setTaskType]   = useState('')
  const [priority,    setPriority]   = useState('')
  const [difficulty,  setDifficulty] = useState('')
  const [timeBlock,   setTimeBlock]  = useState('')
  const [description, setDesc]       = useState('')
  const [isRecovery,  setRecovery]   = useState(false)
  const [schedDate,   setSchedDate]  = useState('')
  const [schedTime,   setSchedTime]  = useState('')

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setTaskType(task.task_type)
      setPriority(task.priority)
      setDifficulty(task.difficulty)
      setTimeBlock(task.time_block ?? '')
      setDesc(task.description ?? '')
      setRecovery(task.is_recovery ?? false)
      setSchedDate(task.scheduled_for ?? '')
      setSchedTime(task.scheduled_at ? new Date(task.scheduled_at).toTimeString().slice(0,5) : '')
      setEditing(false)
    }
  }, [task?.id])

  if (!task) return null

  const ti      = typeMap[task.task_type] ?? { icon: '◈', color: colors.textMuted }
  const prColor = priorityColors[task.priority] ?? colors.textMuted
  const isPending   = task.status === 'pending'
  const isCompleted = task.status === 'completed'
  const isSkipped   = task.status === 'skipped'

  // Compute rewards from config — null if config not loaded yet
  const rewards = computeRewards(
    editing ? { ...task, task_type: taskType, difficulty } : task,
    config
  )

  // Scheduled time string for display
  const scheduledTimeStr = formatScheduledTime(task.scheduled_at)

  const saveEdit = async () => {
    setSaving(true)
    try {
      let scheduled_at = task.scheduled_at
      if (schedDate && schedTime) {
        scheduled_at = new Date(`${schedDate}T${schedTime}:00`).toISOString()
      } else if (schedDate && !schedTime) {
        scheduled_at = null
      }
      await editTask(task.id, {
        title,
        task_type:    taskType,
        priority,
        difficulty,
        time_block:   timeBlock || null,
        description:  description.trim() || null,
        is_recovery:  isRecovery,
        scheduled_for: schedDate || task.scheduled_for,
        scheduled_at,
      })
      setEditing(false)
      onEdited?.()
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setSaving(false)
    }
  }

  const prColors = { P0: colors.danger, P1: colors.warning, P2: colors.accent, P3: colors.textMuted }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.typeLabel}>{ti.icon}  {task.task_type.toUpperCase()}</Text>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Text style={s.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
            {editing ? (
              <>
                <View style={s.field}><Text style={s.label}>TITLE</Text>
                  <TextInput style={s.input} value={title} onChangeText={setTitle} placeholderTextColor={colors.textDim} />
                </View>
                <View style={s.field}><Text style={s.label}>DESCRIPTION</Text>
                  <TextInput style={[s.input, { height: 72, textAlignVertical: 'top' }]} value={description} onChangeText={setDesc} placeholder="What does this involve?" placeholderTextColor={colors.textDim} multiline />
                </View>
                <View style={s.field}><Text style={s.label}>TYPE</Text>
                  <Seg options={TYPES} value={taskType} onChange={setTaskType} />
                </View>
                <View style={s.field}><Text style={s.label}>PRIORITY</Text>
                  <Seg options={PRIORITIES} value={priority} onChange={setPriority} colorMap={prColors} />
                </View>
                <View style={s.field}><Text style={s.label}>DIFFICULTY</Text>
                  <Seg options={DIFFS} value={difficulty} onChange={setDifficulty} />
                </View>
                <View style={s.field}><Text style={s.label}>TIME BLOCK</Text>
                  <Seg options={BLOCKS} value={timeBlock} onChange={setTimeBlock} allowDeselect />
                </View>
                <View style={s.field}>
                  <Text style={s.label}>SCHEDULE</Text>
                  <View style={s.schedRow}>
                    <TextInput style={[s.input, { flex: 1 }]} value={schedDate} onChangeText={setSchedDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textDim} keyboardType="numeric" maxLength={10} />
                    <TextInput style={[s.input, { flex: 1 }]} value={schedTime} onChangeText={setSchedTime} placeholder="HH:MM" placeholderTextColor={colors.textDim} keyboardType="numeric" maxLength={5} />
                  </View>
                </View>
                <Toggle label="Recovery task" value={isRecovery} onChange={setRecovery} />
              </>
            ) : (
              <>
                <Text style={s.taskTitle}>{task.title}</Text>

                {/* Tags row */}
                <View style={s.tags}>
                  <Text style={[s.tag, { color: prColor }]}>{task.priority}</Text>
                  <Text style={s.tag}>{task.difficulty}</Text>
                  {task.time_block && <Text style={s.tag}>{task.time_block}</Text>}
                  {scheduledTimeStr && (
                    <Text style={[s.tag, { color: colors.accent }]}>🕐 {scheduledTimeStr}</Text>
                  )}
                  {task.is_recovery && <Text style={[s.tag, { color: colors.success }]}>recovery</Text>}
                  {task.scheduled_for && task.scheduled_for !== new Date().toISOString().split('T')[0] &&
                    <Text style={[s.tag, { color: colors.warning }]}>{task.scheduled_for}</Text>}
                  {task.late_multiplier < 1.0 &&
                    <Text style={[s.tag, { color: colors.warning }]}>−{Math.round((1 - task.late_multiplier) * 100)}% late</Text>}
                </View>

                {/* Description */}
                {task.description
                  ? <View style={s.descBox}><Text style={s.descText}>{task.description}</Text></View>
                  : <Text style={s.descEmpty}>No description yet — AI generates after completion.</Text>
                }

                {/* Rewards row */}
                {rewards && (
                  <View style={s.rewardsRow}>
                    <View style={s.rewardItem}>
                      <Text style={s.rewardLabel}>XP</Text>
                      <Text style={[s.rewardValue, { color: colors.accent }]}>+{rewards.xp}</Text>
                    </View>
                    <View style={s.rewardDivider} />
                    <View style={s.rewardItem}>
                      <Text style={s.rewardLabel}>GOLD</Text>
                      <Text style={[s.rewardValue, { color: colors.gold }]}>+{rewards.gold}g</Text>
                    </View>
                    <View style={s.rewardDivider} />
                    <View style={s.rewardItem}>
                      <Text style={s.rewardLabel}>ENERGY</Text>
                      <Text style={[s.rewardValue, { color: colors.textMuted }]}>−{rewards.energy}⚡</Text>
                    </View>
                  </View>
                )}

                {isCompleted && <Text style={s.statusDone}>✓ Completed</Text>}
                {isSkipped   && <Text style={s.statusSkipped}>Skipped</Text>}
              </>
            )}
          </ScrollView>

          <View style={s.actions}>
            {editing ? (
              <>
                <TouchableOpacity style={s.secondaryBtn} onPress={() => setEditing(false)}>
                  <Text style={s.secondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.primaryBtn, saving && s.btnDisabled]} onPress={saveEdit} disabled={saving}>
                  <Text style={s.primaryText}>{saving ? 'Saving…' : 'Save changes'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={{ gap: 8, width: '100%' }}>
                {isPending && (
                  <TouchableOpacity style={s.primaryBtn} onPress={() => { onComplete(task.id); onClose() }}>
                    <Text style={s.primaryText}>Mark complete</Text>
                  </TouchableOpacity>
                )}
                <View style={s.rowActions}>
                  {isPending && (
                    <TouchableOpacity style={[s.secondaryBtn, { flex: 1 }]} onPress={() => setEditing(true)}>
                      <Text style={s.secondaryText}>Edit</Text>
                    </TouchableOpacity>
                  )}
                  {isPending && (
                    <TouchableOpacity style={[s.secondaryBtn, { flex: 1 }]} onPress={() => { onSkip(task.id); onClose() }}>
                      <Text style={s.secondaryText}>Skip</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {isPending && (
                  <TouchableOpacity onPress={() => Alert.alert('Cancel task?', 'Remove from today?', [
                    { text: 'No', style: 'cancel' },
                    { text: 'Yes', style: 'destructive', onPress: () => { onCancel(task.id); onClose() } }
                  ])}>
                    <Text style={s.cancelTaskText}>Cancel task</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay:       { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet:         { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingTop: 12, maxHeight: '90%', borderTopWidth: 1, borderColor: colors.borderHi },
  handle:        { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  typeLabel:     { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.6 },
  closeBtn:      { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  closeBtnText:  { fontSize: 10, color: colors.textMuted },
  taskTitle:     { fontSize: 17, fontWeight: '600', color: colors.text, lineHeight: 24 },
  tags:          { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag:           { fontSize: 10, color: colors.textMuted, backgroundColor: colors.surface2, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  descBox:       { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 11 },
  descText:      { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  descEmpty:     { fontSize: 11, color: colors.textDim, fontStyle: 'italic' },

  // Rewards row
  rewardsRow:    { flexDirection: 'row', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' },
  rewardItem:    { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3 },
  rewardDivider: { width: 1, backgroundColor: colors.border, marginVertical: 8 },
  rewardLabel:   { fontSize: 9, fontWeight: '700', color: colors.textDim, letterSpacing: 0.8 },
  rewardValue:   { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },

  statusDone:    { fontSize: 13, color: colors.success, fontWeight: '600', textAlign: 'center', paddingVertical: 4 },
  statusSkipped: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: 4 },
  field:         { gap: 6 },
  label:         { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  input:         { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 11, fontSize: 13, color: colors.text },
  segGroup:      { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  segBtn:        { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
  segActive:     { borderColor: colors.accent, backgroundColor: colors.accentDim },
  segText:       { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  schedRow:      { flexDirection: 'row', gap: 8 },
  toggleRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel:   { fontSize: 13, color: colors.text },
  track:         { width: 36, height: 20, borderRadius: 10, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', paddingHorizontal: 2 },
  trackOn:       { backgroundColor: colors.accentDim, borderColor: colors.accent },
  thumb:         { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.textMuted },
  thumbOn:       { backgroundColor: colors.accent, alignSelf: 'flex-end' },
  actions:       { marginTop: 14 },
  primaryBtn:    { padding: 13, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', width: '100%' },
  btnDisabled:   { opacity: 0.5 },
  primaryText:   { fontSize: 13, color: '#fff', fontWeight: '700' },
  rowActions:    { flexDirection: 'row', gap: 8 },
  secondaryBtn:  { padding: 11, borderRadius: 8, borderWidth: 1, borderColor: colors.borderHi, alignItems: 'center' },
  secondaryText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  cancelTaskText:{ fontSize: 12, color: colors.danger, textAlign: 'center', paddingVertical: 4 },
})