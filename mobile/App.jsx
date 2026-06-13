// App.jsx — 5 tabs: Today, Chat, [+], Shop, Graphs, Profile
import { useState } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar, Text, View, TouchableOpacity, StyleSheet } from 'react-native'
import Svg, { Path, Circle } from 'react-native-svg'
import TodayScreen   from './src/screens/TodayScreen'
import ChatScreen    from './src/screens/ChatScreen'
import ShopScreen    from './src/screens/ShopScreen'
import GraphsScreen  from './src/screens/GraphsScreen'
import ProfileScreen from './src/screens/ProfileScreen'
import AddTaskModal  from './src/components/AddTaskModal'
import { colors }    from './src/theme'

const Tab = createBottomTabNavigator()

function LifeMapLogo({ size = 26 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Path d="M32 4 L52 12 V28 C52 42 43 53 32 60 C21 53 12 42 12 28 V12 Z" fill="white" opacity={0.15} />
      <Path d="M32 10 L46 32 L32 54 L18 32 Z" fill="white" />
      <Path d="M26 22 L32 16 L38 22 L34 22 L34 38 L40 38 L32 46 L24 38 L30 38 L30 22 Z" fill="#0F172A" />
      <Circle cx="32" cy="16" r="3" fill="#0F172A" />
      <Circle cx="24" cy="40" r="2.5" fill="#0F172A" />
      <Circle cx="40" cy="40" r="2.5" fill="#0F172A" />
    </Svg>
  )
}

// Tab order: Today | Chat | [+FAB] | Shop | Graphs | Profile
// But bottom nav: Today | Chat | FAB | Shop | Profile  (5 visible slots)
// Graphs accessible from tab — we use 5 slots with Graphs replacing one
// Layout: Today | Chat | [+] | Shop | Profile  — Graphs in Profile? No.
// Better: Today | [+] | Chat | Shop | Profile — Graphs added via Profile or separate
// Final decision: Today | Chat | [+] | Graphs | Profile  (Shop accessible from Profile or keep)
// Keep 5: Today | Chat | FAB(+) | Shop | Profile — Graphs in Profile screen as a tab section? 
// Simplest: add Graphs as a proper tab, making 5 real tabs + FAB = 6 slots
// Use: Today | Chat | [FAB] | Shop | Profile  (5 visible) + Graphs inside Profile scroll

// Actually cleanest: 4 tabs + FAB, Graphs inside Profile
// Tab: Today | Chat | [+] | Shop | Profile
const TAB_ICONS = { Today: '📋', Chat: '◈', Shop: '◆', Profile: '👤' }

function TabBar({ state, descriptors, navigation }) {
  const [showAdd, setShowAdd] = useState(false)
  const tabs  = state.routes
  const left  = tabs.slice(0, 2)
  const right = tabs.slice(2)

  const renderTab = (route, index) => {
    const isFocused = state.index === index
    return (
      <TouchableOpacity
        key={route.key}
        style={s.tabBtn}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name)
        }}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize: 18, color: isFocused ? colors.accent : colors.textMuted }}>
          {TAB_ICONS[route.name]}
        </Text>
        <Text style={[s.tabLabel, { color: isFocused ? colors.accent : colors.textMuted }]}>
          {route.name}
        </Text>
      </TouchableOpacity>
    )
  }

  return (
    <>
      <View style={s.tabBar}>
        {left.map((r, i) => renderTab(r, i))}
        <TouchableOpacity style={s.fabSlot} onPress={() => setShowAdd(true)} activeOpacity={0.85}>
          <View style={s.fabCircle}>
            <LifeMapLogo size={24} />
          </View>
        </TouchableOpacity>
        {right.map((r, i) => renderTab(r, i + 2))}
      </View>
      <AddTaskModal visible={showAdd} onClose={() => setShowAdd(false)} onAdded={() => setShowAdd(false)} />
    </>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <NavigationContainer>
        <Tab.Navigator tabBar={props => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
          <Tab.Screen name="Today"   component={TodayScreen}   />
          <Tab.Screen name="Chat"    component={ChatScreen}    />
          <Tab.Screen name="Shop"    component={ShopScreen}    />
          <Tab.Screen name="Profile" component={ProfileScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  )
}

const s = StyleSheet.create({
  tabBar:    { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, height: 60, alignItems: 'center', paddingBottom: 4 },
  tabBtn:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 5 },
  tabLabel:  { fontSize: 9, fontWeight: '600', letterSpacing: 0.4 },
  fabSlot:   { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -18 },
  fabCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 10, borderWidth: 3, borderColor: colors.bg },
})