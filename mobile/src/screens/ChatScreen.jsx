// src/screens/ChatScreen.jsx
import { useState, useRef, useEffect } from 'react'
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, KeyboardAvoidingView, Platform, ActivityIndicator
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { chat } from '../api'
import { colors } from '../theme'

export default function ChatScreen() {
  const insets  = useSafeAreaInsets()
  const listRef = useRef(null)
  const [messages, setMessages] = useState([])
  const [input,    setInput]    = useState('')
  const [sending,  setSending]  = useState(false)

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setSending(true)
    setMessages(m => [...m, { id: Date.now(), role: 'user', text }])

    try {
      const { reply } = await chat(text)
      setMessages(m => [...m, { id: Date.now() + 1, role: 'system', text: reply }])
    } catch (e) {
      setMessages(m => [...m, { id: Date.now() + 1, role: 'system', text: `⚠ ${e.message}` }])
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }, [messages])

  const renderItem = ({ item }) => (
    <View style={[styles.msgWrap, item.role === 'user' ? styles.msgUser : styles.msgSystem]}>
      <View style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleSystem]}>
        <Text style={styles.bubbleText}>{item.text}</Text>
      </View>
    </View>
  )

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.bottom + 80}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SYSTEM INTERFACE</Text>
        <Text style={styles.headerSub}>SESSION: MOBILE</Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => String(m.id)}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        ListEmptyComponent={
          <View style={styles.welcome}>
            <Text style={styles.welcomeIcon}>◈</Text>
            <Text style={styles.welcomeText}>System online. How can I help?</Text>
          </View>
        }
      />

      {sending && (
        <View style={styles.typingWrap}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.typingText}>Thinking…</Text>
        </View>
      )}

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Add a task, mark done, ask anything..."
          placeholderTextColor={colors.textDim}
          multiline
          maxLength={500}
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <TouchableOpacity style={[styles.sendBtn, sending && styles.sendBtnDisabled]} onPress={send} disabled={sending}>
          <Text style={styles.sendBtnText}>▶</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:  { fontSize: 10, fontWeight: '700', color: colors.text, letterSpacing: 1.4 },
  headerSub:    { fontSize: 10, color: colors.textDim, letterSpacing: 0.8 },
  list:         { padding: 14, gap: 10 },
  welcome:      { alignItems: 'center', justifyContent: 'center', marginTop: 80, gap: 10 },
  welcomeIcon:  { fontSize: 28, color: colors.textMuted, opacity: 0.25 },
  welcomeText:  { fontSize: 12, color: colors.textMuted, letterSpacing: 0.5 },
  msgWrap:      { maxWidth: '80%' },
  msgUser:      { alignSelf: 'flex-end' },
  msgSystem:    { alignSelf: 'flex-start' },
  bubble:       { borderRadius: 8, padding: 10, paddingHorizontal: 13 },
  bubbleUser:   { backgroundColor: colors.accentDim, borderWidth: 1, borderColor: 'rgba(123,110,246,0.20)' },
  bubbleSystem: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  bubbleText:   { fontSize: 13, color: colors.text, lineHeight: 20 },
  typingWrap:   { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, paddingHorizontal: 16 },
  typingText:   { fontSize: 12, color: colors.textMuted },
  inputBar:     { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, padding: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input:        { flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 13, color: colors.text, maxHeight: 100 },
  sendBtn:      { width: 38, height: 38, backgroundColor: colors.accent, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText:  { color: '#fff', fontSize: 12, fontWeight: '700' },
})