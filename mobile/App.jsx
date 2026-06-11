// App.jsx — root navigator
import { NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar, Text } from 'react-native'
import TodayScreen   from './src/screens/TodayScreen'
import ChatScreen    from './src/screens/ChatScreen'
import StatsScreen   from './src/screens/StatsScreen'
import ShopScreen    from './src/screens/ShopScreen'
import ProfileScreen from './src/screens/ProfileScreen'
import { colors }    from './src/theme'

const Tab = createBottomTabNavigator()

const TAB_ICONS = { Today: '📋', Chat: '◈', Stats: '📊', Shop: '◆', Profile: '👤' }

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarStyle: {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              borderTopWidth: 1,
              height: 60,
              paddingBottom: 8,
            },
            tabBarActiveTintColor:   colors.accent,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5 },
            tabBarIcon: ({ color }) => (
              <Text style={{ fontSize: 18, color }}>{TAB_ICONS[route.name]}</Text>
            ),
          })}
        >
          <Tab.Screen name="Today"   component={TodayScreen}   />
          <Tab.Screen name="Chat"    component={ChatScreen}    />
          <Tab.Screen name="Stats"   component={StatsScreen}   />
          <Tab.Screen name="Shop"    component={ShopScreen}    />
          <Tab.Screen name="Profile" component={ProfileScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  )
}