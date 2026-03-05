# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run development server
python manage.py runserver

# Apply database migrations
python manage.py migrate

# Create new migrations after model changes
python manage.py makemigrations

# Run tests for a specific app
python manage.py test Authentication
python manage.py test TacticalBoard

# Run all tests
python manage.py test

# Open Django shell
python manage.py shell

# Install dependencies
pip install -r requirements.txt
```

## Architecture

This is a **Django REST Framework** backend for the EVE Echoes Mobile (EVEM) Toolkits application — a set of game tools for the EVE Echoes mobile game. The project is called `EVE_MDjango` internally.

### Tech Stack
- **Django 4.2** with **Django REST Framework 3.15**
- **MySQL** (`eve_echoes` database, `localhost:3306`)
- **JWT authentication** via `djangorestframework-simplejwt` (access token: 10 min, refresh: 20 days)
- **Custom user model**: `Authentication.EVEMUser` (extends `AbstractUser`, adds `eve_id`, `user_corp`, `user_union`)
- **Email**: 163.com SMTP for verification codes

### App Structure

All Django apps are registered in `EVE_MDjango/settings.py` and routed under `/api/` in `EVE_MDjango/urls.py`:

| App | URL Prefix | Purpose |
|---|---|---|
| `Authentication` | `/api/user/` | User registration, login, JWT, password management, email verification |
| `ActivationCode` | `/api/activationcode/` | Software license code generation and validation |
| `StarFieldSearch` | `/api/` | Star system/region/constellation search (read-only, `managed=False`) |
| `PlanetaryResource` | `/api/` | Planetary resource search and user-saved programmes |
| `Bazaar` | `/api/` | EVE Echoes bazaar (lucky box) data and rankings |
| `FraudList` | `/api/` | In-game fraud/scammer list with reporting workflow |
| `TacticalBoard` | `/api/` | Interactive galaxy map with A* pathfinding |

### Key Architectural Patterns

**Database ownership split**: Most game data tables use `managed = False` (read from external data sources like iEVE). Only user-generated tables (`Authentication`, `ActivationCode`, `PlanetaryProgramme`, etc.) are Django-managed.

**Shared database tables across apps**: `StarFieldSearch` and `PlanetaryResource` both reference the same underlying MySQL tables (`region`, `constellation`, `solarsystem`) but define separate model classes. Changes to shared table structures require updating models in multiple apps.

**A* pathfinding in TacticalBoard**: `TacticalBoard/A_Star.py` implements a custom A* algorithm for routing between star systems in the EVE Echoes galaxy. Coordinates are stored in meters and converted to light-years by dividing by `9.461e15`. Move types are "土路" (stargate route, zero cost), "安全诱导" (safe warp induction), and "不安全诱导" (unsafe warp induction, 1.5× cost). Stargate data is returned gzip-compressed from `GetStarGateData` view.

**Email throttling**: `Authentication/throttle.py` implements per-email rate limiting (5/day, 1/minute) via `SimpleRateThrottle`. The throttle key uses the email address from request body, not IP.

**JWT token customization**: `Authentication/serializers.py` has `UserTokenObtainPairSerializer` that adds custom claims to JWT tokens. All protected views use `permission_classes = [IsAuthenticated]`.

**Activation code system**: `ActivationCode` issues time-limited software keys bound to a `pc_identifier` (machine fingerprint).

### Settings Notes
- `USE_TZ = False` — no timezone-aware datetimes; timestamps stored as naive Shanghai time or Unix epoch integers
- `CORS_ALLOW_ALL_ORIGINS = True` — CORS is fully open
- `LANGUAGE_CODE = 'zh-hans'` — Chinese locale, Chinese used extensively in field comments and response messages
- Custom email backend at `EVE_MDjango/EmailBackend.py`
