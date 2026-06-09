import { useState, useEffect } from 'react'
import { getSkills } from '../api.js'

function buildTree(skills) {
  const roots   = skills.filter(s => !s.parent_skill_id)
  const children = skills.filter(s => s.parent_skill_id)
  const childMap = new Map()
  for (const c of children) {
    if (!childMap.has(c.parent_skill_id)) childMap.set(c.parent_skill_id, [])
    childMap.get(c.parent_skill_id).push(c)
  }
  const out = []
  const walk = (skill, depth) => {
    out.push({ skill, depth })
    const kids = (childMap.get(skill.id) || []).sort((a,b) => b.current_level - a.current_level)
    for (const k of kids) walk(k, depth + 1)
  }
  roots.sort((a,b) => b.current_level - a.current_level)
  for (const r of roots) walk(r, 0)
  return out
}

function streakClass(n) {
  if (!n || n === 0) return 'streak-zero'
  if (n <= -7) return 'streak-decay'
  return n > 0 ? 'streak-pos' : 'streak-neg'
}

export default function Skills() {
  const [skills,  setSkills]  = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSkills().then(s => { setSkills(s); setLoading(false) }).catch(console.error)
  }, [])

  const tree = skills ? buildTree(skills) : []
  let lastRootId = null

  return (
    <div className="skills-list">
      {loading ? [0,1,2].map(i => <div key={i} className="skeleton" style={{ height:56 }} />) :
       tree.length === 0 ? <div className="empty-state">No skills yet. Complete tasks to unlock them.</div> :
       tree.map(({ skill, depth }) => {
        const showSep = depth === 0 && lastRootId !== null
        if (depth === 0) lastRootId = skill.id
        return (
          <div key={skill.id}>
            {showSep && <div className="skill-separator" />}
            <div className={`skill-card${depth > 0 ? ' child' : ''}`}
              style={depth > 0 ? { marginLeft:`${depth*16}px` } : {}}>
              <div className="skill-header">
                {depth > 0 && <span className="connector">└─</span>}
                <span className="skill-name">{skill.name}</span>
                {skill.is_dynamic && <span className="skill-badge">{depth > 0 ? 'SPEC' : 'AUTO'}</span>}
                <span className="skill-level">Lv.{skill.current_level}</span>
              </div>
              <div className="skill-bar">
                <div className="skill-bar-fill" style={{ width:`${skill.xp_to_next ? Math.min(100,(skill.current_xp/skill.xp_to_next)*100) : 0}%` }} />
              </div>
              <div className="skill-footer">
                <span className="skill-xp">{skill.current_xp} / {skill.xp_to_next} XP</span>
                <span className={`stat-streak ${streakClass(skill.current_streak)}`}>
                  streak: {skill.current_streak > 0 ? '+' : ''}{skill.current_streak}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}