# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
```

### Testing
No test suite configured yet.

## Architecture

### Tech Stack
- **React 18.2** with Vite 5.2
- **React Router 6** for routing
- **React Query 3** for server state management
- **Styled Components** for styling
- **Ant Design** for UI components (desktop)
- **Ant Design Mobile** for mobile UI
- **Axios** for HTTP requests
- **React Hook Form** for form handling

### Project Structure
```
src/
├── pages/           # Route pages (11 pages)
├── features/        # Feature modules (Authentication, Bazaar, FraudList, PlanetaryResource, Settings, TacticalBoard)
├── services/        # API clients and utilities
├── context/         # React Context providers (Auth, IsMobile, Search)
├── hooks/           # Custom React hooks
├── ui/              # Reusable UI components
└── styles/          # Global styles
```

### Key Patterns

**Feature-based organization**: Each feature has its own directory with components, hooks, and logic.

**Custom hooks for API calls**: Each API operation has a dedicated hook (e.g., `useFraudSearch`, `usePlanetResource`).

**Context providers**:
- `AuthProvider` - JWT authentication state
- `IsMobileProvider` - Responsive design detection
- `SearchProvider` - Shared search state

**API configuration**: `src/services/backendSetting.js` contains the backend URL (currently hardcoded).

**React Query**: Configured with 180s staleTime for caching.

**Responsive design**: Separate mobile components and pages for mobile users.

### 3D Visualization
Uses **Three.js**, **PixiJS**, and **deck.gl** for tactical board star map rendering.

## Important Notes

- Backend API URL is hardcoded in `src/services/backendSetting.js` - should use environment variables
- No environment variable configuration (.env) exists
- JWT tokens stored in localStorage via AuthContext
- Mobile detection uses window.innerWidth check in IsMobileContext
