# Backend

Python backend on FastAPI for server-side Instagram and TikTok parsing.

## Run

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Backend settings are read from `backend/.env`.

If you want explicit Uvicorn start, this still works too:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 4000
```

`RELOAD=false` is the default for `python main.py`, because on some Windows setups the auto-reloader can hang or spawn extra silent processes.

## Endpoints

- `GET /api/health`
- `POST /api/parse` with JSON body `{ "url": "https://..." }`
