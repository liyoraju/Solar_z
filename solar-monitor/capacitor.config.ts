import type { CapacitorConfig } from '@capacitor/cli';

const API_URL = process.env.CAP_SERVER_URL || 'https://solar-z.onrender.com';

const config: CapacitorConfig = {
  appId: 'com.solarapp.monitor',
  appName: 'SolarApp',
  webDir: 'dist',
  server: {
    url: API_URL,
    cleartext: API_URL.startsWith('http://'),
  },
};

export default config;
