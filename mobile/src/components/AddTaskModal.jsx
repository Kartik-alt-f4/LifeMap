// src/components/AddTaskModal.jsx
import { useState } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Alert
} from 'react-native'
import { createTask } from '../api'
import { colors } from '../theme'

const TYPES      = ['anchor','mandatory','project','bonus','habit','routine']
const PRIORITIES = ['P0','P1','P2','P3']
const DIFFS      = ['low','medium','high']
const BLOCKS     = ['morning','noon','evening','night','midnight']

function todayStr() { return new Date().toISOString().split('T')[0] }

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

export default function AddTaskModal({ visible, onClose, onAdded }) {
  const [title,       setTitle]      = useState('')
  const [taskType,    setTaskType]   = useState('habit')
  const [priority,    setPriority]   = useState('P2')
  const [difficulty,  setDifficulty] = useState('medium')
  const [timeBlock,   setTimeBlock]  = useState('')
  const [description, setDesc]       = useState('')
  const [isRecovery,  setRecovery]   = useState(false)
  const [isRecurring, setRecurring]  = useState(false)
  const [schedDate,   setSchedDate]  = useState('')
  const [schedTime,   setSchedTime]  = useState('')
  const [submitting,  setSubmitting] = useState(false)

  const reset = () => {
    setTitle(''); setTaskType('habit'); setPriority('P2'); setDifficulty('medium')
    setTimeBlock(''); setDesc(''); setRecovery(false); setRecurring(false)
    setSchedDate(''); setSchedTime('')
  }

  const submit = async () => {
    if (!title.trim()) { Alert.alert('Title required'); return }
    setSubmitting(true)
    try {
      let scheduled_at = null
      let scheduled_for = todayStr()

      if (schedDate) {
        scheduled_for = schedDate
        if (schedTime) {
          scheduled_at = new Date(`${schedDate}T${schedTime}:00`).toISOString()
        }
      }

      await createTask({
        title:        title.trim(),
        task_type:    taskType,
        priority,
        difficulty,
        time_block:   timeBlock || null,
        description:  description.trim() || null,
        is_recovery:  isRecovery,
        is_recurring: isRecurring,
        scheduled_for,
        scheduled_at,
      })
      reset()
      onAdded()
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setSubmitting(false)
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
          <View style={s.sheetHeader}>
            <Text style={s.title}>New Task</Text>
            <TouchableOpacity onPress={() => { reset(); onClose() }}>
              <Text style={s.closeX}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 12 }}>

            <View style={s.field}>
              <Text style={s.label}>TITLE *</Text>
              <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="What needs to be done?" placeholderTextColor={colors.textDim} autoFocus />
            </View>

            <View style={s.field}>
              <Text style={s.label}>DESCRIPTION <Text style={s.optional}>(AI generates if blank)</Text></Text>
              <TextInput style={[s.input, { height: 64, textAlignVertical: 'top' }]} value={description} onChangeText={setDesc} placeholder="What does this involve? More context = better stat matching." placeholderTextColor={colors.textDim} multiline />
            </View>

            <View style={s.field}>
              <Text style={s.label}>TYPE</Text>
              <Seg options={TYPES} value={taskType} onChange={setTaskType} />
            </View>

            <View style={s.field}>
              <Text style={s.label}>PRIORITY</Text>
              <Seg options={PRIORITIES} value={priority} onChange={setPriority} colorMap={prColors} />
            </View>

            <View style={s.field}>
              <Text style={s.label}>DIFFICULTY</Text>
              <Seg options={DIFFS} value={difficulty} onChange={setDifficulty} />
            </View>

            <View style={s.field}>
              <Text style={s.label}>TIME BLOCK <Text style={s.optional}>(optional)</Text></Text>
              <Seg options={BLOCKS} value={timeBlock} onChange={setTimeBlock} allowDeselect />
            </View>

            <View style={s.field}>
              <Text style={s.label}>SCHEDULE FOR LATER <Text style={s.optional}>(optional)</Text></Text>
              <View style={s.schedRow}>
                <TextInput
                  style={[s.input, { flex: 1 }]}
                  value={schedDate}
                  onChangeText={setSchedDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textDim}
                  keyboardType="numeric"
                  maxLength={10}
                />
                <TextInput
                  style={[s.input, { flex: 1 }]}
                  value={schedTime}
                  onChangeText={setSchedTime}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.textDim}
                  keyboardType="numeric"
                  maxLength={5}
                />
              </View>
              <Text style={s.schedHint}>Leave blank for today. Date format: 2026-06-15  Time: 20:00</Text>
            </View>

            <Toggle label="Recurring task (daily template)" value={isRecurring} onChange={setRecurring} />
            <Toggle label="Recovery task (+15 energy)" value={isRecovery} onChange={setRecovery} />
          </ScrollView>

          <View style={s.actions}>
            <TouchableOpacity style={s.cancelBtn} onPress={() => { reset(); onClose() }}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.submitBtn, submitting && s.submitDisabled]} onPress={submit} disabled={submitting}>
              <Text style={s.submitText}>{submitting ? 'Adding…' : isRecurring ? 'Add recurring' : 'Add task'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const s = StyleSheet.create({
  overlay:      { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet:        { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingTop: 12, maxHeight: '92%', borderTopWidth: 1, borderColor: colors.borderHi },
  handle:       { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title:        { fontSize: 14, fontWeight: '700', color: colors.text, letterSpacing: 0.4 },
  closeX:       { fontSize: 16, color: colors.textMuted, padding: 4 },
  field:        { gap: 6 },
  label:        { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1 },
  optional:     { fontWeight: '400', color: colors.textDim, letterSpacing: 0 },
  input:        { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 11, fontSize: 13, color: colors.text },
  segGroup:     { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  segBtn:       { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
  segActive:    { borderColor: colors.accent, backgroundColor: colors.accentDim },
  segText:      { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  schedRow:     { flexDirection: 'row', gap: 8 },
  schedHint:    { fontSize: 10, color: colors.textDim },
  toggleRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleLabel:  { fontSize: 13, color: colors.text },
  track:        { width: 36, height: 20, borderRadius: 10, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', paddingHorizontal: 2 },
  trackOn:      { backgroundColor: colors.accentDim, borderColor: colors.accent },
  thumb:        { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.textMuted },
  thumbOn:      { backgroundColor: colors.accent, alignSelf: 'flex-end' },
  actions:      { flexDirection: 'row', gap: 8, marginTop: 14 },
  cancelBtn:    { flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  cancelText:   { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  submitBtn:    { flex: 2, padding: 12, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center' },
  submitDisabled:{ opacity: 0.5 },
  submitText:   { fontSize: 13, color: '#fff', fontWeight: '700' },
})