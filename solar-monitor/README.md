# Lumos — Solar Energy Intelligence Platform

A modern, interactive web application for monitoring solar energy systems built with **React 19**, **Tailwind CSS v4**, **Recharts**, and **Lucide Icons**.

## Features

### Dynamic Weather Themes
- **Morning** (5:00–11:59): Warm sunrise palette with orange accents
- **Afternoon** (12:00–16:59): Bright sky blue palette
- **Evening** (17:00–19:59): Sunset orange/coral palette
- **Night** (20:00–4:59): Dark navy palette with starfield background

Themes automatically transition based on the user's local time with smooth 2-second CSS transitions.

### Real-time Telemetry
All specified labels are displayed in organized sections:
- **Photovoltaic**: PV1 Voltage, PV1 Current, PV1 Power, PV2 Voltage, PV2 Current, PV2 Power
- **Grid Parameters**: Grid Voltage R/S/T, Grid Current R/S/T, Grid Frequency
- **Power Flow**: Load Power, Inverter Power
- **Production & Savings**: Daily/Total Production, Daily Grid Export/Import, Daily/Total Savings
- **System Health**: Battery SOC, Inverter Temperature

### Interactive Charts
- **Hourly Trends**: Area chart showing PV Power vs Inverter Power over 24 hours
- **Daily Production**: Bar chart of daily kWh production and savings
- **Production vs Consumption**: Comparative area chart
- **Power Distribution**: Donut chart showing energy flow breakdown

### Visualizations
- **Energy Flow Diagram**: Animated house visualization showing solar → battery → load → grid flow
- **Battery Status**: Animated battery gauge with fill level and estimated time
- **Financial Overview**: Savings tracking with tariff rates and CO₂ impact
- **Alerts Panel**: Severity-based alert system with acknowledgment

### Responsive Design
- Desktop sidebar navigation
- Mobile bottom tab bar
- Adaptive grid layouts (2-col, 3-col, 4-col)
- Touch-friendly controls

## Tech Stack

| Technology | Version |
|-----------|---------|
| React | 19.0 |
| TypeScript | 5.7 |
| Tailwind CSS | 4.0 |
| Vite | 6.0 |
| Recharts | 2.15 |
| Lucide React | 0.460 |

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Backend Integration

The app connects to the FastAPI backend (`main.py`) via:
- **REST API**: `/api/telemetry/realtime`, `/api/analytics/overview`, etc.
- **WebSocket**: `/api/ws/telemetry` for live data streaming
- **Proxy**: Configured in `vite.config.ts` for development

## Project Structure

```
solar-monitor/
├── src/
│   ├── components/
│   │   ├── WeatherBackground.tsx   # Dynamic sky themes
│   │   ├── Header.tsx              # Top navigation bar
│   │   ├── StatsCards.tsx          # Key metric cards
│   │   ├── TelemetryGrid.tsx       # All telemetry labels
│   │   ├── ChartsSection.tsx       # Interactive charts
│   │   ├── SolarHouseVisualization.tsx  # Energy flow diagram
│   │   ├── FinancialOverview.tsx   # Savings & tariffs
│   │   ├── BatteryStatus.tsx       # Battery gauge
│   │   └── AlertsPanel.tsx         # Alert notifications
│   ├── hooks/
│   │   ├── useTheme.tsx            # Time-based theme context
│   │   ├── useWebSocket.ts         # Real-time data connection
│   │   └── useApi.ts               # API data fetching
│   ├── utils/
│   │   └── helpers.ts              # Formatting utilities
│   ├── App.tsx                     # Main application
│   ├── main.tsx                    # Entry point
│   └── index.css                   # Tailwind theme variables
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Environment Variables

Create a `.env` file in the project root:

```env
VITE_API_BASE_URL=http://localhost:8000
```

## License

MIT
