# ooppssie

AI-powered Instagram and TikTok profile analysis with account parsing, trend matching, content ideas, hooks, recommendations, authentication, and saved report history.

This repository contains two separate modules:

- `frontend` - React + Vite application
- `backend` - Flask API with PostgreSQL-ready persistence

## What the product does

ooppssie takes an Instagram or TikTok profile URL, fetches profile data through Apify, researches fresh trends with Gemini and Google Search grounding, sends the normalized account data plus the trend research to Gemini, and returns a structured report with:

- profile positioning
- audience summary
- compatibility score
- current trend cards
- content ideas
- hooks
- strategic recommendations

## Architecture

```mermaid
flowchart LR
    U[User] --> F[Frontend<br/>React + Vite]
    F -->|Auth / Analysis Requests| B[Backend API<br/>Flask + Socket.IO]
    B -->|Read / Write| DB[(PostgreSQL)]
    B -->|Profile Fetch| A[Apify Instagram / TikTok Scrapers]
    B -->|Fresh Trend Research| GT[Gemini + Google Search]
    B -->|AI Analysis| G[Gemini 2.5 Flash]
    G --> B
    A --> B
    B --> F
    F --> U
```

## Report flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant Apify
    participant Gemini
    participant Postgres

    User->>Frontend: Submit Instagram or TikTok profile URL
    Frontend->>Backend: POST /analyze-account
    Backend->>Postgres: Check auth, rate limits, cache
    Backend->>Apify: Fetch profile data
    Apify-->>Backend: Raw account payload
    Backend->>Gemini: Fresh trend research prompt with Google Search
    Gemini-->>Backend: Current trend research + sources
    Backend->>Gemini: Structured profile matching prompt
    Gemini-->>Backend: JSON analysis
    Backend->>Postgres: Save analysis run
    Backend-->>Frontend: Final report
    Frontend-->>User: Render result screen
```

## Highlights

| Area | Included |
| --- | --- |
| Auth | Register, login, session validation, logout |
| Storage | PostgreSQL-ready database layer, saved analysis history |
| Security | Rate limiting, CORS control, session tokens, security headers |
| Analysis | Apify parsing + fresh trend research + Gemini structured output |
| Admin | `/adminpanel`, global analytics, filters, logs, and realtime Socket.IO updates |
| Frontend | Auth flow, real API errors, saved report navigation |
| Operations | Health check, readiness check, production entrypoint |
| Testing | Backend unit/integration tests, frontend utility tests |

## Monorepo layout

```text
ooppssie/
+-- backend/
|   +-- app.py
|   +-- serve.py
|   +-- requirements.txt
|   +-- tests/
|   \-- README.md
+-- frontend/
|   +-- src/
|   +-- public/
|   +-- package.json
|   \-- README.md
\-- README.md
```

## Local development

### 1. Backend environment

Create `backend/.env` from `backend/.env.example`.

Recommended local values:

```env
APP_ENV=development
HOST=0.0.0.0
PORT=5000
DEBUG=true
SECRET_KEY=dev-secret-change-me
FRONTEND_ORIGIN=http://127.0.0.1:3000,http://localhost:3000
DATABASE_URL=sqlite:///backend/data/ooppssie.db
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
ADMIN_USERNAME=Lekim
# Local development may use plaintext. Production must use ADMIN_PASSWORD_HASH.
ADMIN_PASSWORD=replace_with_local_admin_password
ADMIN_ALLOW_LOCAL_ORIGINS=true
ADMIN_SESSION_TTL_HOURS=12
```

### 2. Frontend environment

Create `frontend/.env` from `frontend/.env.example`.

```env
VITE_API_URL=http://127.0.0.1:5000
```

### 3. Run locally

Backend:

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.
Admin panel: `http://127.0.0.1:3000/adminpanel`.

## Test and build commands

Backend:

```bash
cd backend
python -m unittest discover -s tests -v
```

Frontend:

```bash
cd frontend
npm run lint
npm run test
npm run build
```

## Production deployment on one Ubuntu 22.04 server

This section assumes you want both modules on one server under `/www`:

- backend source: `/www/ooppssie/backend`
- frontend source: `/www/ooppssie/frontend`

If your host uses `/var/www` instead, replace `/www` with `/var/www`.

### Recommended topology

```mermaid
flowchart TD
    Internet --> N[Nginx]
    N -->|Static files| FE[/www/ooppssie/frontend/dist]
    N -->|/api/* + WebSocket reverse proxy| BE[Backend on 127.0.0.1:5000]
    BE --> PG[(PostgreSQL)]
    BE --> AP[Apify]
    BE --> GM[Gemini]
```

### 1. Install base packages

```bash
sudo apt update
sudo apt install -y nginx python3 python3-venv python3-pip postgresql postgresql-contrib git curl
```

Install Node.js 20 if it is not already available:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Copy the project to the server

```bash
sudo mkdir -p /www/ooppssie
sudo chown -R $USER:$USER /www/ooppssie
cd /www/ooppssie
```

Then upload or clone the project into that directory so you end up with:

```text
/www/ooppssie/backend
/www/ooppssie/frontend
```

### 3. Create PostgreSQL database

```bash
sudo -u postgres psql
```

Inside PostgreSQL:

```sql
CREATE USER ooppssie WITH PASSWORD 'replace_with_a_strong_password';
CREATE DATABASE ooppssie OWNER ooppssie;
GRANT ALL PRIVILEGES ON DATABASE ooppssie TO ooppssie;
\q
```

### 4. Configure the backend

```bash
cd /www/ooppssie/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
```

Edit `/www/ooppssie/backend/.env`:

Generate the admin password hash before filling `ADMIN_PASSWORD_HASH`:

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
```

Quick backend smoke test:

```bash
source /www/ooppssie/backend/venv/bin/activate
cd /www/ooppssie/backend
gunicorn --worker-class eventlet -w 1 --bind 127.0.0.1:5000 app:app
```

If it starts correctly, stop it with `Ctrl+C`.

### 5. Configure the frontend

```bash
cd /www/ooppssie/frontend
npm install
cp .env.example .env
```

Edit `/www/ooppssie/frontend/.env`:

```env
VITE_API_URL=https://your-domain.com/api
```

Build the frontend:

```bash
cd /www/ooppssie/frontend
npm run build
```

### 6. Create a systemd service for the backend

Create `/etc/systemd/system/ooppssie-backend.service`:

```ini
[Unit]
Description=ooppssie backend service
After=network.target postgresql.service

[Service]
User=www-data
Group=www-data
WorkingDirectory=/www/ooppssie/backend
Environment=PYTHONUNBUFFERED=1
ExecStart=/www/ooppssie/backend/venv/bin/gunicorn --worker-class eventlet -w 1 --bind 127.0.0.1:5000 app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Set permissions and enable the service:

```bash
sudo chown -R www-data:www-data /www/ooppssie
sudo systemctl daemon-reload
sudo systemctl enable ooppssie-backend
sudo systemctl start ooppssie-backend
sudo systemctl status ooppssie-backend
```

### 7. Configure Nginx

Create `/etc/nginx/sites-available/ooppssie`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /www/ooppssie/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:5000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/socket.io/ {
        proxy_pass http://127.0.0.1:5000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/ooppssie /etc/nginx/sites-enabled/ooppssie
sudo nginx -t
sudo systemctl reload nginx
```

### 8. Enable HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

If you also use `www.your-domain.com`, include it in the command.

### 9. Open the firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 10. Verify production

Check backend health:

```bash
curl http://127.0.0.1:5000/health
curl http://127.0.0.1:5000/ready
```

Check the public site:

```bash
curl -I https://your-domain.com
curl -I https://your-domain.com/api/health
```

Then verify manually in the browser:

1. Open the frontend.
2. Register a new user.
3. Run one analysis.
4. Open the saved report from the recent analyses section.
5. Open `/adminpanel`, login as `Lekim`, and verify the analysis appears live.

## Update workflow on the server

When you deploy a new version:

```bash
cd /www/ooppssie
```

Update backend:

```bash
cd /www/ooppssie/backend
source venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart ooppssie-backend
```

Update frontend:

```bash
cd /www/ooppssie/frontend
npm install
npm run build
sudo systemctl reload nginx
```

## Troubleshooting

### Frontend shows CORS errors

- Check `FRONTEND_ORIGIN` in `backend/.env`
- Check that the frontend domain exactly matches the configured origin
- Restart the backend service after changing `.env`

### `ready` fails

- Check PostgreSQL is running
- Check `DATABASE_URL`
- Check the database user has access to the `ooppssie` database

### Backend returns `500`

- Check `journalctl -u ooppssie-backend -n 100 --no-pager`
- Check `APIFY_TOKEN`, `GEMINI_API_KEY`, and `SECRET_KEY`
- Make sure the backend virtual environment is active and dependencies are installed

### Frontend loads but API requests fail

- Check `VITE_API_URL` before building the frontend
- Check Nginx `/api/` proxy configuration
- Check that the backend service is listening on `127.0.0.1:5000`

## Module docs

- [Backend README](./backend/README.md)
- [Frontend README](./frontend/README.md)
