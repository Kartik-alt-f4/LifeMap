// src/notifications.js — Expo push token registration
// NOTE: Push notifications require a development build (not Expo Go)
// This file gracefully skips registration when running in Expo Go

import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { registerPush } from './api'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  false,
  }),
})

function isExpoGo() {
  return Constants.appOwnership === 'expo'
}

export async function registerForPushNotifications() {
  // Push notifications removed from Expo Go in SDK 53 — skip silently
  if (isExpoGo()) {
    console.log('[push] Skipping push registration in Expo Go')
    return null
  }

  if (!Device.isDevice) {
    console.log('[push] Not a physical device — skipping')
    return null
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') {
    console.log('[push] Permission denied')
    return null
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    })
  }

  const token = (await Notifications.getExpoPushTokenAsync()).data
  const platform = Platform.OS === 'ios' ? 'ios' : 'android'

  try {
    await registerPush(token, platform)
    console.log('[push] Token registered:', token)
  } catch (e) {
    console.error('[push] Failed to register token:', e.message)
  }

  return token
}