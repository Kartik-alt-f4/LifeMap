// src/components/SettingsContent.jsx
// Full settings panel — mirrors web Settings page
import { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Switch
} from 'react-native'
import { colors } from '../theme'

const BASE = 'https://lifemap-b0ms.onrender.com'

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' }, ...options
  })
  const text = await res.text()
  if (text.startsWith('<')) throw new Error(`Server error on ${path}`)
  return JSON.parse(text)
}

function Row({ label, hint, value, onChange, readOnly }) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        {hint && <Text style={s.rowHint}>{hint}</Text>}
      </View>
      <TextInput
        style={[s.rowInput, readOnly && s.rowInputReadOnly]}
        value={String(value ?? '')}
        editable={!readOnly}
        keyboardType="numeric"
        onChangeText={v => onChange?.(Number(v))}
      />
    </View>
  )
}

function Section({ title, children }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function SaveBtn({ onPress, saving, saved }) {
  return (
    <TouchableOpacity
      style={[s.saveBtn, saved && s.saveBtnDone]}
      onPress={onPress}
      disabled={saving}
    >
      <Text style={s.saveBtnText}>
        {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save changes'}
      </Text>
    </TouchableOpacity>
  )
}

export default function SettingsContent({ onClose }) {
  const [config,    setConfig]    = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [tab,       setTab]       = useState('tasks')

  // Task rewards
  const [xpBase,   setXpBase]   = useState({})
  const [goldBase, setGoldBase] = useState({})
  const [energy,   setEnergy]   = useState({})
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)



  useEffect(() => {
    req('/config').then(cfg => {
      setConfig(cfg)
      setXpBase({ ...cfg.game.tasks.xp_base })
      setGoldBase({ ...cfg.game.tasks.gold_base })
      setEnergy({ ...cfg.game.energy })
      setLoading(false)
    }).catch(e => { Alert.alert('Error', e.message); setLoading(false) })
  }, [])

  const saveTasksEnergy = async () => {
    setSaving(true)
    try {
      const g = config.game
      await Promise.all([
        req('/config/game/tasks',  { method: 'POST', body: JSON.stringify({ ...g.tasks, xp_base: xpBase, gold_base: goldBase }) }),
        req('/config/game/energy', { method: 'POST', body: JSON.stringify(energy) }),
      ])
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { Alert.alert('Error', e.message) }
    finally { setSaving(false) }
  }



  const TABS = [
    { id: 'tasks',  label: 'Tasks' },
    { id: 'energy', label: 'Energy' },
  ]

  if (loading) return (
    <View style={s.center}><ActivityIndicator color={colors.accent} /></View>
  )

  const g = config.game

  return (
    <View style={{ flex: 1 }}>
      {/* Tab bar */}
      <View style={s.tabs}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[s.tab, tab === t.id && s.tabActive]}
            onPress={() => setTab(t.id)}
          >
            <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>

        {tab === 'tasks' && (
          <>
            <Section title="XP PER TASK TYPE">
              {Object.entries(xpBase).map(([type, val]) => (
                <Row key={type} label={type} value={val}
                  onChange={v => setXpBase(b => ({ ...b, [type]: v }))} />
              ))}
            </Section>
            <Section title="GOLD PER TASK TYPE">
              {Object.entries(goldBase).map(([type, val]) => (
                <Row key={type} label={type} value={val}
                  onChange={v => setGoldBase(b => ({ ...b, [type]: v }))} />
              ))}
            </Section>
            <Section title="DIFFICULTY OFFSETS (XP)">
              {Object.entries(g.tasks.difficulty_xp_offset).map(([d, v]) => (
                <Row key={d} label={d} value={v} readOnly hint="Edit in game.json" />
              ))}
            </Section>
            <SaveBtn onPress={saveTasksEnergy} saving={saving} saved={saved} />
          </>
        )}

        {tab === 'energy' && (
          <>
            <Section title="ENERGY">
              <Row label="Max energy"            value={energy.max}                    onChange={v => setEnergy(e => ({ ...e, max: v }))} />
              <Row label="Morning regen"          value={energy.passive_morning_regen}  onChange={v => setEnergy(e => ({ ...e, passive_morning_regen: v }))} />
              <Row label="Recovery restore"       value={energy.recovery_task_restore}  onChange={v => setEnergy(e => ({ ...e, recovery_task_restore: v }))} />
            </Section>
            <Section title="DRAIN BY TYPE">
              {Object.entries(g.energy.drain_by_type).map(([type, val]) => (
                <Row key={type} label={type} value={val} readOnly hint="Edit in game.json" />
              ))}
            </Section>
            <SaveBtn onPress={saveTasksEnergy} saving={saving} saved={saved} />
          </>
        )}

        {/* Stats editing is done via Profile → tap any stat card */}

      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  center:          { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  tabs:            { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab:             { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive:       { borderBottomWidth: 2, borderBottomColor: colors.accent },
  tabText:         { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  tabTextActive:   { color: colors.accent },
  section:         { gap: 10 },
  sectionTitle:    { fontSize: 9, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.2, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  row:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
  rowLabel:        { fontSize: 12, fontWeight: '500', color: colors.text },
  rowHint:         { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  rowInput:        { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 7, fontSize: 12, color: colors.text, fontFamily: 'monospace', width: 80, textAlign: 'right' },
  rowInputReadOnly:{ opacity: 0.5 },
  saveBtn:         { padding: 13, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', marginTop: 4 },
  saveBtnDone:     { backgroundColor: colors.success },
  saveBtnText:     { fontSize: 13, color: '#fff', fontWeight: '700' },
  hint:            { fontSize: 11, color: colors.textMuted, lineHeight: 17 },
  statBlock:       { gap: 6 },
  statName:        { fontSize: 10, fontWeight: '700', color: colors.text, letterSpacing: 0.6 },
  statInput:       { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 12, color: colors.text, minHeight: 60, textAlignVertical: 'top' },
})