import { useEffect, useRef } from 'react';
import { getApiBaseUrl } from '../services/apiConfig';

let registrationAttempted = false;

async function registerToken(token: string) {
  try {
    await fetch(`${getApiBaseUrl()}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform: 'android' }),
    });
  } catch {
    // Silently fail — push registration is best-effort
  }
}

async function setupPushNotifications() {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  const permResult = await PushNotifications.requestPermissions();
  if (permResult.receive !== 'granted') {
    return;
  }

  await PushNotifications.register();

  PushNotifications.addListener('registration', (token) => {
    registerToken(token.value);
  });

  PushNotifications.addListener('registrationError', () => {
    // Registration failed — will retry on next app launch
  });

  PushNotifications.addListener('pushNotificationReceived', () => {
    // Notification shown by OS — no action needed
  });

  PushNotifications.addListener('pushNotificationActionPerformed', () => {
    // User tapped the notification — could navigate to alerts screen
  });
}

export function usePushNotifications() {
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || registrationAttempted) return;
    attempted.current = true;
    registrationAttempted = true;

    const isNative = typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
    if (!isNative) return;

    setupPushNotifications().catch(() => {});
  }, []);
}
