// src/screens/ProfileScreen.jsx
import { useState, useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, TextInput,
  Alert, KeyboardAvoidingView, Platform
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getState, getStats, getSkills } from '../api'
import { colors } from '../theme'

const BASE = 'https://lifemap-b0ms.onrender.com'

const STAT_ICONS = {
  Strength:'💪', Vitality:'❤️', Agility:'⚡',
  Intelligence:'🧠', Willpower:'🔮', Charisma:'💬'
}

// ── Edit modal (used for both stat description and skill name/description) ──
function EditModal({ visible, title, fields, onSave, onClose, saving }) {
  const [vals, setVals] = useState({})

  useEffect(() => {
    if (visible) {
      const init = {}
      fields.forEach(f => { init[f.key] = f.value })
      setVals(init)
    }
  }, [visible, fields])

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>{title}</Text>
          {fields.map(f => (
            <View key={f.key} style={styles.modalField}>
              <Text style={styles.modalLabel}>{f.label}</Text>
              <TextInput
                style={[styles.modalInput, f.multiline && { height: 80, textAlignVertical: 'top' }]}
                value={vals[f.key] ?? ''}
                onChangeText={v => setVals(prev => ({ ...prev, [f.key]: v }))}
                placeholder={f.placeholder}
                placeholderTextColor={colors.textDim}
                multiline={f.multiline}
              />
              {f.hint && <Text style={styles.modalHint}>{f.hint}</Text>}
            </View>
          ))}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalSave, saving && styles.modalSaveDisabled]}
              onPress={() => onSave(vals)}
              disabled={saving}
            >
              <Text style={styles.modalSaveText}>
                {saving ? 'Saving…' : 'Save & re-embed'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ── Stat card ──
function StatCard({ stat, onEdit }) {
  const pct = Math.min(100, stat.current_value ?? 0)
  const streak = stat.current_streak ?? 0
  const streakColor = streak > 0 ? colors.success : streak < -6 ? colors.danger : colors.textMuted

  return (
    <TouchableOpacity style={styles.statCard} onPress={() => onEdit(stat)} activeOpacity={0.7}>
      <View style={styles.statCardHeader}>
        <Text style={styles.statIcon}>{STAT_ICONS[stat.name] ?? '◈'}</Text>
        <Text style={styles.statName}>{stat.name.toUpperCase()}</Text>
        <Text style={styles.statScore}>{Math.round(pct)}</Text>
        <Text style={{ fontSize: 10, color: colors.textMuted }}>✏</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.statCardFooter}>
        <Text style={styles.statDesc} numberOfLines={2}>{stat.description}</Text>
        <Text style={[styles.streakText, { color: streakColor }]}>
          {streak > 0 ? '+' : ''}{streak}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

// ── Skill card ──
function SkillCard({ skill, depth, onEdit }) {
  const pct = skill.xp_to_next
    ? Math.min(100, (skill.current_xp / skill.xp_to_next) * 100)
    : 0

  return (
    <TouchableOpacity
      style={[styles.skillCard, depth > 0 && { marginLeft: depth * 14, borderColor: 'rgba(123,110,246,0.08)' }]}
      onPress={() => onEdit(skill)}
      activeOpacity={0.7}
    >
      <View style={styles.skillHeader}>
        {depth > 0 && <Text style={styles.connector}>└─</Text>}
        <Text style={styles.skillName} numberOfLines={1}>{skill.name}</Text>
        <Text style={styles.skillBadge}>{depth > 0 ? 'SPEC' : 'AUTO'}</Text>
        <Text style={styles.skillLevel}>Lv.{skill.current_level}</Text>
        <Text style={{ fontSize: 10, color: colors.textMuted }}>✏</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.skillXp}>{skill.current_xp} / {skill.xp_to_next} XP</Text>
    </TouchableOpacity>
  )
}

function buildSkillTree(skills) {
  const roots    = skills.filter(s => !s.parent_skill_id)
  const children = skills.filter(s => s.parent_skill_id)
  const childMap = new Map()
  for (const c of children) {
    if (!childMap.has(c.parent_skill_id)) childMap.set(c.parent_skill_id, [])
    childMap.get(c.parent_skill_id).push(c)
  }
  const out = []
  const walk = (skill, depth) => {
    out.push({ skill, depth })
    const kids = (childMap.get(skill.id) || []).sort((a, b) => b.current_level - a.current_level)
    for (const k of kids) walk(k, depth + 1)
  }
  roots.sort((a, b) => b.current_level - a.current_level)
  for (const r of roots) walk(r, 0)
  return out
}

// ── Main screen ──
export default function ProfileScreen() {
  const insets = useSafeAreaInsets()
  const [player,    setPlayer]    = useState(null)
  const [stats,     setStats]     = useState([])
  const [skills,    setSkills]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [refreshing,setRefreshing]= useState(false)

  // Edit modal state
  const [editTarget, setEditTarget] = useState(null)  // { type: 'stat'|'skill', item }
  const [saving,     setSaving]     = useState(false)

  const load = useCallback(async () => {
    try {
      const [state, statData, skillData] = await Promise.all([
        getState(), getStats(), getSkills()
      ])
      setPlayer(state)
      setStats(statData)
      setSkills(skillData)
    } catch (e) { console.error(e) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSaveStat = async (vals) => {
    setSaving(true)
    try {
      // 1. Save description
      const res = await fetch(`${BASE}/stats/${editTarget.item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: vals.description })
      })
      if (!res.ok) throw new Error('Failed to save')

      // 2. Re-embed all stats
      const embedRes = await fetch(`${BASE}/stats/re-embed`, { method: 'POST' })
      if (!embedRes.ok) throw new Error('Re-embed failed')

      setEditTarget(null)
      Alert.alert('Done', 'Stat description updated and re-embedded.')
      await load()
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSkill = async (vals) => {
    setSaving(true)
    try {
      const { supabaseUrl, supabaseKey } = await fetch(`${BASE}/state`).then(() => ({}))
      // Update skill via a dedicated endpoint — we'll use PATCH /skills/:id
      const res = await fetch(`${BASE}/skills/${editTarget.item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: vals.name, description: vals.description })
      })
      if (!res.ok) throw new Error('Failed to save skill')

      setEditTarget(null)
      Alert.alert('Done', 'Skill updated.')
      await load()
    } catch (e) {
      Alert.alert('Error', e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color={colors.accent} size="large" /></View>
  }

  const xpPct = player ? Math.min(100, (player.current_xp / player.xp_to_next) * 100) : 0
  const tree  = buildSkillTree(skills)

  const statFields = editTarget?.type === 'stat' ? [
    {
      key: 'description',
      label: 'Description',
      value: editTarget.item.description,
      multiline: true,
      placeholder: 'e.g. Weightlifting, resistance training, physical labour, gym workouts',
      hint: 'Be specific — richer descriptions improve task→stat matching'
    }
  ] : []

  const skillFields = editTarget?.type === 'skill' ? [
    {
      key: 'name',
      label: 'Skill name',
      value: editTarget.item.name,
      multiline: false,
      placeholder: 'e.g. Coding, Guitar, Writing'
    },
    {
      key: 'description',
      label: 'Description',
      value: editTarget.item.description,
      multiline: true,
      placeholder: 'e.g. Programming, software development, debugging, coding tasks',
      hint: 'Tasks matching this description will grow this skill'
    }
  ] : []

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: insets.bottom + 80 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor={colors.accent} />
        }
      >
        {/* Player card */}
        {player && (
          <View style={styles.playerCard}>
            <View style={styles.playerTop}>
              <View>
                <Text style={styles.playerLevel}>Lv.{player.level}</Text>
                <Text style={styles.playerRank}>{player.rank}</Text>
              </View>
              <View style={styles.playerRight}>
                <Text style={styles.playerGold}>◆ {player.available_gold}g</Text>
                <Text style={styles.playerStreak}>
                  {player.streak > 0 ? '🔥' : ''} {player.streak}d streak
                </Text>
              </View>
            </View>
            <View style={styles.xpRow}>
              <Text style={styles.xpLabel}>XP</Text>
              <View style={styles.xpTrack}>
                <View style={[styles.xpFill, { width: `${xpPct}%` }]} />
              </View>
              <Text style={styles.xpText}>{player.current_xp} / {player.xp_to_next}</Text>
            </View>
          </View>
        )}

        {/* Stats section */}
        <Text style={styles.sectionTitle}>STATS <Text style={styles.sectionHint}>tap to edit description</Text></Text>
        <View style={styles.statsGrid}>
          {stats.map(stat => (
            <StatCard
              key={stat.id}
              stat={stat}
              onEdit={item => setEditTarget({ type: 'stat', item })}
            />
          ))}
        </View>

        {/* Skills section */}
        <Text style={styles.sectionTitle}>SKILLS <Text style={styles.sectionHint}>tap to edit name & description</Text></Text>
        {tree.length === 0
          ? <Text style={styles.empty}>No skills yet. Complete tasks to unlock them.</Text>
          : tree.map(({ skill, depth }) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              depth={depth}
              onEdit={item => setEditTarget({ type: 'skill', item })}
            />
          ))
        }
      </ScrollView>

      {/* Edit modal */}
      <EditModal
        visible={!!editTarget}
        title={editTarget?.type === 'stat'
          ? `Edit ${editTarget.item.name}`
          : `Edit skill: ${editTarget?.item.name}`
        }
        fields={editTarget?.type === 'stat' ? statFields : skillFields}
        onSave={editTarget?.type === 'stat' ? handleSaveStat : handleSaveSkill}
        onClose={() => setEditTarget(null)}
        saving={saving}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: colors.bg },
  center:           { alignItems: 'center', justifyContent: 'center' },

  // Player card
  playerCard:       { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 16, gap: 12 },
  playerTop:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  playerLevel:      { fontSize: 28, fontWeight: '700', color: colors.accent },
  playerRank:       { fontSize: 11, color: colors.textMuted, marginTop: 2, letterSpacing: 0.4 },
  playerRight:      { alignItems: 'flex-end', gap: 4 },
  playerGold:       { fontSize: 14, fontWeight: '600', color: colors.gold },
  playerStreak:     { fontSize: 12, color: colors.warning },
  xpRow:            { flexDirection: 'row', alignItems: 'center', gap: 8 },
  xpLabel:          { fontSize: 10, color: colors.textMuted, width: 22 },
  xpTrack:          { flex: 1, height: 4, backgroundColor: colors.surface3, borderRadius: 2, overflow: 'hidden' },
  xpFill:           { height: '100%', backgroundColor: colors.accent, borderRadius: 2 },
  xpText:           { fontSize: 10, color: colors.textMuted },

  // Section headers
  sectionTitle:     { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1.4 },
  sectionHint:      { fontSize: 10, fontWeight: '400', color: colors.textDim, letterSpacing: 0.3 },

  // Stats grid
  statsGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard:         { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, gap: 7, width: '48%' },
  statCardHeader:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statIcon:         { fontSize: 16 },
  statName:         { flex: 1, fontSize: 10, fontWeight: '700', color: colors.text, letterSpacing: 0.4 },
  statScore:        { fontSize: 14, fontWeight: '700', color: colors.accent },
  statCardFooter:   { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  statDesc:         { flex: 1, fontSize: 10, color: colors.textMuted, lineHeight: 14 },
  streakText:       { fontSize: 10 },

  // Skill cards
  skillCard:        { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, gap: 7 },
  skillHeader:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connector:        { fontSize: 11, color: colors.textDim },
  skillName:        { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  skillBadge:       { fontSize: 9, fontWeight: '700', color: colors.accent, backgroundColor: colors.accentDim, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  skillLevel:       { fontSize: 11, color: colors.textMuted },
  skillXp:          { fontSize: 10, color: colors.textMuted },

  // Shared bar
  barTrack:         { height: 3, backgroundColor: colors.surface3, borderRadius: 2, overflow: 'hidden' },
  barFill:          { height: '100%', backgroundColor: colors.accent, borderRadius: 2 },

  // Edit modal
  modalOverlay:     { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet:       { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, gap: 14, borderTopWidth: 1, borderColor: colors.borderHi },
  modalTitle:       { fontSize: 13, fontWeight: '700', color: colors.text, letterSpacing: 0.4 },
  modalField:       { gap: 5 },
  modalLabel:       { fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase' },
  modalInput:       { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 13, color: colors.text },
  modalHint:        { fontSize: 11, color: colors.textDim, lineHeight: 15 },
  modalActions:     { flexDirection: 'row', gap: 8, marginTop: 4 },
  modalCancel:      { flex: 1, padding: 11, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  modalCancelText:  { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  modalSave:        { flex: 2, padding: 11, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center' },
  modalSaveDisabled:{ opacity: 0.5 },
  modalSaveText:    { fontSize: 13, color: '#fff', fontWeight: '700' },

  empty:            { textAlign: 'center', color: colors.textMuted, marginTop: 20, fontSize: 12 },
})