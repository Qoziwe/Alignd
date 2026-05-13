# Backend

Flask API for ooppssie. This service handles authentication, persistence, account analysis, saved reports, rate limiting, and production readiness endpoints.

## Responsibilities

- user registration and login
- token-based session management
- Instagram and TikTok profile analysis pipeline
- PostgreSQL-ready storage
- analysis history and saved report retrieval
- admin panel API, global analytics, analysis logging, and realtime Socket.IO events
- health and readiness checks
- production serving through Gunicorn + Eventlet

## API surface

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | Create a user and return a session token |
| `POST` | `/auth/login` | Login and return a session token |
| `GET` | `/auth/me` | Resolve the current authenticated user |
| `POST` | `/auth/logout` | Revoke the current session |
| `GET` | `/analyses` | List recent saved analyses |
| `DELETE` | `/analyses` | Clear all saved analyses for the current user |
| `POST` | `/analyses/clear` | Clear saved analyses for clients that cannot use `DELETE` |
| `GET` | `/analyses/<id>` | Load a saved analysis by id |
| `POST` | `/analyze-account` | Run a new profile analysis |
| `POST` | `/admin/auth/login` | Login to the admin panel |
| `GET` | `/admin/overview` | Admin analytics, rankings, filters, and recent analyses |
| `GET` | `/admin/analyses` | Admin list of all analyses |
| `GET` | `/admin/analyses/<id>` | Admin full analysis details |
| `POST` | `/admin/analyses/<id>/logs` | Add an admin log note to an analysis |
| `GET` | `/health` | Liveness check |
| `GET` | `/ready` | Readiness check including database ping |

## Data model

```mermaid
flowchart LR
    U[users] --> S[auth_sessions]
    U --> R[analysis_runs]
    AS[admin_sessions] --> AP[Admin panel]
    R --> AL[admin_analysis_logs]
    RL[rate_limits] --> B[Backend middleware]
    R --> H[Recent analyses]
    R --> D[Saved analysis details]
```

Main tables:

- `users`
- `auth_sessions`
- `admin_sessions`
- `admin_analysis_logs`
- `analysis_runs`
- `rate_limits`

## Analysis pipeline

```mermaid
flowchart TD
    Req[POST /analyze-account] --> Auth[Validate auth + rate limits]
    Auth --> Cache[Check recent cached analysis]
    Cache -->|cache miss| Apify[Fetch profile from Apify]
    Apify --> Normalize[Normalize account data]
    Normalize --> TrendGemini[Research fresh trends with Gemini + Google Search]
    TrendGemini --> Gemini[Match profile to researched trends]
    Gemini --> Shape[Validate and normalize response]
    Shape --> Save[Save analysis to database]
    Save --> Res[Return report JSON]
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `APP_ENV` | Yes | `development` or `production` |
| `HOST` | Yes | Bind host |
| `PORT` | Yes | Bind port |
| `DEBUG` | Yes | Debug mode toggle |
| `SECRET_KEY` | Yes | Session/security secret |
| `FRONTEND_ORIGIN` | Yes | Allowed CORS origin list, comma-separated |
| `DATABASE_URL` | Yes | PostgreSQL in production, SQLite allowed in development |
| `APIFY_TOKEN` | Yes | Apify API token |
| `APIFY_INSTAGRAM_ACTOR_ID` | No | Apify actor id for Instagram profile parsing |
| `APIFY_TIKTOK_ACTOR_ID` | No | Apify actor id for TikTok profile parsing |
| `GEMINI_API_KEY` | Yes | Gemini API key |
| `GEMINI_MODEL` | Yes | Gemini model name |
| `GEMINI_TREND_MODEL` | No | Gemini model used for the fresh trend research step. Defaults to `GEMINI_MODEL` |
| `ENABLE_SEARCH_GROUNDING` | Yes | Enable Gemini grounding tool |
| `SESSION_TTL_HOURS` | Yes | Auth session lifetime |
| `ANALYSIS_CACHE_TTL_MINUTES` | Yes | Saved cache TTL |
| `ANALYSIS_LIMIT_PER_HOUR` | Yes | User analysis limit |
| `AUTH_LIMIT_PER_15_MINUTES` | Yes | Auth request limit |
| `ADMIN_USERNAME` | Yes in production | Admin panel login |
| `ADMIN_PASSWORD_HASH` | Yes in production | Hashed admin password from `werkzeug.security.generate_password_hash` |
| `ADMIN_PASSWORD` | Development only | Plaintext admin password fallback for local development |
| `ADMIN_ALLOW_LOCAL_ORIGINS` | No | Development-only helper that allows localhost, 127.0.0.1, and private LAN origins |
| `ADMIN_SESSION_TTL_HOURS` | No | Admin session lifetime |
| `ADMIN_SESSION_COOKIE_NAME` | No | Admin session cookie name |

## Example production `.env`

Generate `ADMIN_PASSWORD_HASH` on a trusted machine:

```bash
python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('your-admin-password'))"
```

```env
APP_ENV=production
HOST=127.0.0.1
PORT=5000
DEBUG=false
SECRET_KEY=replace_with_a_long_random_secret
FRONTEND_ORIGIN=https://your-domain.com
DATABASE_URL=postgresql://ooppssie:replace_with_a_strong_password@localhost:5432/ooppssie
APIFY_TOKEN=your_apify_token
APIFY_INSTAGRAM_ACTOR_ID=apify~instagram-scraper
APIFY_TIKTOK_ACTOR_ID=clockworks~tiktok-profile-scraper
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
GEMINI_TREND_MODEL=gemini-2.5-flash
ENABLE_SEARCH_GROUNDING=true
SESSION_TTL_HOURS=24
ANALYSIS_CACHE_TTL_MINUTES=60
ANALYSIS_LIMIT_PER_HOUR=25
AUTH_LIMIT_PER_15_MINUTES=10
ADMIN_USERNAME=replace_with_admin_username
ADMIN_PASSWORD_HASH=replace_with_admin_password_hash
ADMIN_ALLOW_LOCAL_ORIGINS=false
ADMIN_SESSION_TTL_HOURS=12
ADMIN_SESSION_COOKIE_NAME=ooppssie_admin_session
```

## Local run

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

## Production run

```bash
cd backend
gunicorn --worker-class eventlet -w 1 --bind 127.0.0.1:5000 app:app
```

## Tests

```bash
cd backend
python -m unittest discover -s tests -v
```

## Production notes

- Use PostgreSQL in production
- Run the service behind Nginx
- Serve production with Gunicorn + Eventlet so Socket.IO does not run on the development Werkzeug server.
- Keep `HOST=127.0.0.1` when using Nginx reverse proxy
- Proxy `/socket.io/` with WebSocket upgrade headers if Nginx sits in front of the backend
- Restart the backend after each `.env` change

For the full deployment guide, see the root [README](../README.md).
