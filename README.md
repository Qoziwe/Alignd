# Alignd

This repository is split into two main folders:

- `frontend` - Expo React Native app
- `backend` - Python FastAPI API for parsing

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
```

Backend reads host and port from `backend/.env`:

```env
HOST=0.0.0.0
PORT=4000
RELOAD=false
```

## Notes

- The backend is now written in Python with FastAPI.
- The backend currently parses public profile pages on the server side.
- Private accounts still will not be available.
- Instagram and TikTok can change their public markup at any time.
