# Alignd

This repository is split into two main folders:

- `frontend` - Expo React Native app
- `backend` - Python FastAPI API for OAuth account connections

This project no longer scrapes arbitrary public profiles. It works with official OAuth connections for accounts that authorize your app.

## Structure

```text
.
├─ frontend/
├─ backend/
└─ README.md
```

## Quick Start

### 1. Start the backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

### 2. Start the frontend

```bash
cd frontend
npm install
npm start
```

### 3. Configure env files

Frontend reads the API URL from `frontend/.env`:

```env
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_APP_URL=http://localhost:8081
```

Backend reads host, port, and OAuth credentials from `backend/.env`:

```env
HOST=0.0.0.0
PORT=4000
RELOAD=false
FRONTEND_SUCCESS_URL=http://localhost:8081
META_GRAPH_VERSION=v23.0
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=http://localhost:4000/api/auth/instagram/callback
INSTAGRAM_SCOPES=pages_show_list,instagram_basic
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=
TIKTOK_SCOPES=user.info.basic,user.info.profile,user.info.stats,video.list
```

## Full Setup Guide

### 0. What you need to understand first

- You need your own developer app in Meta for Developers.
- You also need your own developer app in TikTok for Developers.
- Other people will connect their Instagram or TikTok accounts to your app, not to your personal account.
- Until your apps are properly configured and, if needed, reviewed/published, usually only you plus test users/app roles can connect successfully.

### 1. Prepare local env files

Create real env files from the examples:

```bash
copy frontend\.env.example frontend\.env
copy backend\.env.example backend\.env
```

Recommended local values:

`frontend/.env`

```env
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_APP_URL=http://localhost:8081
```

`backend/.env`

```env
HOST=0.0.0.0
PORT=4000
RELOAD=false
FRONTEND_SUCCESS_URL=http://localhost:8081
META_GRAPH_VERSION=v23.0
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=http://localhost:4000/api/auth/instagram/callback
INSTAGRAM_SCOPES=pages_show_list,instagram_basic
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=
TIKTOK_SCOPES=user.info.basic,user.info.profile,user.info.stats,video.list
```

Important:

- Leave `TIKTOK_REDIRECT_URI` empty until you prepare a real HTTPS callback URL.
- TikTok web OAuth requires a registered redirect URI that is absolute, static, and starts with `https`.
- For local TikTok testing, use an HTTPS tunnel such as `ngrok` or `cloudflared`.

### 2. Meta / Instagram setup

This backend currently uses the Instagram API with Facebook Login style flow. That means the Instagram account must be a professional account and, for this code path, must be linked to a Facebook Page.

Practical steps:

1. Create a developer account on Meta for Developers.
2. Create a new app.
3. Choose a Business-style app setup.
   Exact labels in the Meta dashboard can change. This step is based on Meta's current app creation flow and the official Instagram API guidance.
4. In the app dashboard, add the Facebook Login product.
5. Open Facebook Login settings and add your callback URL to Valid OAuth Redirect URIs.
   Use the exact value from `META_REDIRECT_URI`.
6. Copy App ID and App Secret from the app settings into:
   - `META_APP_ID`
   - `META_APP_SECRET`
7. Make sure the Instagram account you want to connect is a Professional account.
   Business or Creator is required.
8. Link that Instagram professional account to a Facebook Page.
9. Make sure the Facebook user who will authorize your app has access to that Page.
10. If only you are testing, app roles/test users may be enough.
11. If other people should connect their accounts, expect to move the app to a public/live state and complete any needed review steps for requested permissions.

What this project requests from Meta right now:

- `pages_show_list`
- `instagram_basic`

Why:

- `pages_show_list` is used to inspect Pages the user can access.
- `instagram_basic` is used to read the connected Instagram professional profile/media that the backend fetches.

### 3. TikTok setup

TikTok in this project uses OAuth with Login Kit and TikTok API v2 endpoints.

Practical steps:

1. Create a developer account on TikTok for Developers.
2. Create an app in the developer portal.
3. Enable Login Kit for Web for that app.
4. Register a redirect URI for the app.
   It must exactly match `TIKTOK_REDIRECT_URI`.
5. Use a public HTTPS callback URL.
   Example:

```text
https://your-public-domain.example/api/auth/tiktok/callback
```

6. If you are testing locally, create an HTTPS tunnel to your backend, for example:

```text
https://abc123.ngrok-free.app/api/auth/tiktok/callback
```

7. Copy the TikTok app credentials into:
   - `TIKTOK_CLIENT_KEY`
   - `TIKTOK_CLIENT_SECRET`
8. Make sure the app has the scopes used by this backend:
   - `user.info.basic`
   - `user.info.profile`
   - `user.info.stats`
   - `video.list`
9. If TikTok requires scope approval or publishing for external users, complete that in the TikTok developer dashboard.

### 4. Recommended local testing strategy

Instagram is easiest to test locally first.

TikTok is usually easiest to test with:

- frontend on `http://localhost:8081`
- backend on `http://localhost:4000`
- one HTTPS tunnel that forwards to backend `:4000`

Example configuration:

`frontend/.env`

```env
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_APP_URL=http://localhost:8081
```

`backend/.env`

```env
FRONTEND_SUCCESS_URL=http://localhost:8081
META_REDIRECT_URI=http://localhost:4000/api/auth/instagram/callback
TIKTOK_REDIRECT_URI=https://abc123.ngrok-free.app/api/auth/tiktok/callback
```

How that works:

- the frontend talks to the backend on localhost
- TikTok redirects to the public HTTPS tunnel
- the tunnel forwards the callback to your local backend
- the backend then redirects the browser back to `FRONTEND_SUCCESS_URL`

### 5. Run the project

Backend:

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Frontend:

```bash
cd frontend
npm install
npm start
```

For OAuth testing, Expo Web is the easiest option because the browser redirect flow is straightforward.

### 6. How to test Instagram connection

1. Open the frontend in a browser.
2. Wait until the config cards load.
3. Make sure the Instagram card does not show missing env variables.
4. Click `Connect` on Instagram.
5. Log into the Facebook/Meta account that has access to the Facebook Page linked to your Instagram professional account.
6. Approve the requested permissions.
7. After the callback completes, the connected account should appear in the dashboard.
8. Click `Sync` to refresh profile data and recent posts.

If Instagram fails with "No Instagram professional account linked to a Facebook Page was found", this usually means one of these:

- the Instagram account is still personal
- the Instagram account is not linked to a Facebook Page
- you logged into the wrong Facebook account
- that Facebook account does not have access to the linked Page

### 7. How to test TikTok connection

1. Open the frontend in a browser.
2. Make sure the TikTok card does not show missing env variables.
3. Make sure `TIKTOK_REDIRECT_URI` is a real registered HTTPS callback.
4. Click `Connect` on TikTok.
5. Log into TikTok and approve access.
6. After the callback completes, the connected TikTok account should appear in the dashboard.
7. Click `Sync` to refresh user data and recent videos.

If TikTok fails with redirect errors, check:

- `TIKTOK_REDIRECT_URI` exactly matches the URI registered in TikTok
- the URI is HTTPS
- there are no extra query params in the registered URI
- the tunnel or public domain really forwards to your backend

### 8. Common problems

#### The Connect button is disabled

The backend is missing env values. Open the card in the UI and check the `Missing env` message.

#### OAuth opens, then returns an error

Most often:

- wrong `redirect_uri`
- app credentials do not match the app where the redirect URI was registered
- app still limited to test users / app roles
- requested scopes are not enabled or approved

#### Other people cannot connect their accounts

Most often:

- the app is still in development/testing mode
- required permissions/scopes are not approved for external users
- you added the permissions in code but not in the platform dashboard

#### TikTok works poorly on plain localhost

That is expected for web OAuth. TikTok's registered redirect URIs must be HTTPS and static.

### 9. Important implementation note

The current backend code in `backend/service.py` uses the Meta Facebook Login style flow:

- auth URL: `https://www.facebook.com/{version}/dialog/oauth`
- scopes: `pages_show_list,instagram_basic`
- page lookup through `/me/accounts`

So this implementation expects:

- Instagram Professional account
- linked Facebook Page

If you want the newer Instagram Login flow without the Page requirement, the backend needs to be rewritten for the Instagram Login product and the newer Instagram business scope names.

## Notes

- The backend is now written in Python with FastAPI.
- Instagram connection uses Meta OAuth and expects a professional Instagram account linked to a Facebook Page.
- TikTok connection uses TikTok OAuth and only grants access to the TikTok account that authorizes your app.
- The app now focuses on connected-account data instead of arbitrary public-profile scraping.
