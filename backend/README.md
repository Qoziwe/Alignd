# Backend

Flask API for Alignd. This service handles authentication, persistence, account analysis, saved reports, rate limiting, and production readiness endpoints.

## Responsibilities

- user registration and login
- token-based session management
- Instagram and TikTok profile analysis pipeline
- PostgreSQL-ready storage
- analysis history and saved report retrieval
- health and readiness checks
- production serving through Waitress

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
| `GET` | `/health` | Liveness check |
| `GET` | `/ready` | Readiness check including database ping |

## Data model

```mermaid
flowchart LR
    U[users] --> S[auth_sessions]
    U --> R[analysis_runs]
    RL[rate_limits] --> B[Backend middleware]
    R --> H[Recent analyses]
    R --> D[Saved analysis details]
```

Main tables:

- `users`
- `auth_sessions`
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

## Example production `.env`

```env
APP_ENV=production
HOST=127.0.0.1
PORT=5000
DEBUG=false
SECRET_KEY=replace_with_a_long_random_secret
FRONTEND_ORIGIN=https://your-domain.com
DATABASE_URL=postgresql://alignd:replace_with_a_strong_password@localhost:5432/alignd
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
python serve.py
```

## Tests

```bash
cd backend
python -m unittest discover -s tests -v
```

## Production notes

- Use PostgreSQL in production
- Run the service behind Nginx
- Serve the app with `serve.py`, not the Flask development server
- Keep `HOST=127.0.0.1` when using Nginx reverse proxy
- Restart the backend after each `.env` change

For the full deployment guide, see the root [README](../README.md).
