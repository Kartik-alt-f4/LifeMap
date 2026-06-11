// App.jsx — root navigator with centre + tab
import { useState } from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar, Text, View, TouchableOpacity, StyleSheet } from 'react-native'
import TodayScreen   from './src/screens/TodayScreen'
import ChatScreen    from './src/screens/ChatScreen'
import ShopScreen    from './src/screens/ShopScreen'
import ProfileScreen from './src/screens/ProfileScreen'
import AddTaskModal  from './src/components/AddTaskModal'
import { colors }    from './src/theme'

const Tab = createBottomTabNavigator()

const TAB_ICONS = { Today: '📋', Chat: '◈', Shop: '◆', Profile: '👤' }

function TabBar({ state, descriptors, navigation }) {
  const [showAdd, setShowAdd] = useState(false)

  // Split tabs: 2 left, + in middle, 2 right
  const tabs = state.routes
  const left  = tabs.slice(0, 2)
  const right = tabs.slice(2)

  const renderTab = (route, index) => {
    const { options } = descriptors[route.key]
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
        <Text style={{ fontSize: 20, color: isFocused ? colors.accent : colors.textMuted }}>
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

        {/* Centre + button */}
        <TouchableOpacity style={s.fabTab} onPress={() => setShowAdd(true)} activeOpacity={0.85}>
          <View style={s.fabCircle}>
            <Text style={s.fabPlus}>+</Text>
          </View>
        </TouchableOpacity>

        {right.map((r, i) => renderTab(r, i + 2))}
      </View>

      <AddTaskModal
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={() => setShowAdd(false)}
      />
    </>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <NavigationContainer>
        <Tab.Navigator
          tabBar={props => <TabBar {...props} />}
          screenOptions={{ headerShown: false }}
        >
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
  tabBar:   { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, height: 64, alignItems: 'center', paddingBottom: 4 },
  tabBtn:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 6 },
  tabLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 0.4 },
  fabTab:   { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -20 },
  fabCircle:{ width: 54, height: 54, borderRadius: 27, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 10, borderWidth: 3, borderColor: colors.bg },
  fabPlus:  { fontSize: 32, color: '#fff', fontWeight: '300', lineHeight: 38 },
})