from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Iterator
from urllib import error, parse, request
from urllib.parse import urlparse

from flask import Flask, current_app, g, jsonify, request as flask_request
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash


DEFAULT_APIFY_INSTAGRAM_ACTOR_ID = "apify~instagram-scraper"
DEFAULT_APIFY_TIKTOK_ACTOR_ID = "clockworks~tiktok-profile-scraper"
APIFY_RUN_SYNC_URL = "https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite"
DEFAULT_ANALYSIS_CACHE_TTL_MINUTES = 360
DEFAULT_SESSION_TTL_HOURS = 24
DEFAULT_ANALYSIS_LIMIT_PER_HOUR = 25
DEFAULT_AUTH_LIMIT_PER_15_MIN = 10
CACHE_SCHEMA_VERSION = "analysis-v2"
INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com"}
TIKTOK_HOSTS = {"tiktok.com", "www.tiktok.com", "m.tiktok.com"}
RESERVED_INSTAGRAM_PATHS = {"p", "reel", "reels", "stories", "explore", "accounts"}
TOP_TREND_MARKERS = ("top", "hot", "peak", "viral", "топ", "пик", "горяч", "вирус")
GROWING_TREND_MARKERS = (
    "growing",
    "rising",
    "emerging",
    "uptrend",
    "growth",
    "раст",
    "набира",
    "восход",
)
SCORE_LABELS = {
    "very high": 92,
    "очень высокая": 92,
    "high": 84,
    "высок": 84,
    "strong": 80,
    "сильн": 80,
    "medium": 62,
    "average": 62,
    "умерен": 62,
    "средн": 62,
    "low": 36,
    "низк": 36,
}
STOPWORDS = {
    "about",
    "after",
    "also",
    "that",
    "this",
    "they",
    "them",
    "with",
    "your",
    "для",
    "как",
    "или",
    "про",
    "это",
    "эта",
    "эти",
    "под",
    "его",
    "её",
    "она",
    "они",
    "что",
    "где",
    "из",
    "без",
    "при",
    "the",
    "and",
    "are",
    "for",
}


def load_dotenv_file(dotenv_path: str = ".env") -> None:
    env_file = Path(dotenv_path)
    if not env_file.exists():
        return

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key:
            os.environ.setdefault(key, value)


load_dotenv_file()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def parse_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def parse_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def clamp_score(value: Any, default: int = 0) -> int:
    parsed_score = parse_score(value)
    if parsed_score is None:
        return default
    return parsed_score


def parse_score(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return max(0, min(100, int(value)))

    text = str(value or "").strip()
    if not text:
        return None

    match = re.search(r"-?\d+", text)
    if not match:
        return None

    try:
        return max(0, min(100, int(match.group(0))))
    except ValueError:
        return None


def infer_score_from_label(value: Any) -> int | None:
    label = str(value or "").strip().lower()
    if not label:
        return None

    for marker, score in SCORE_LABELS.items():
        if marker in label:
            return score
    return None


def extract_keywords(*values: Any) -> set[str]:
    tokens: set[str] = set()
    for value in values:
        for token in re.findall(r"[A-Za-zА-Яа-яЁё0-9]{4,}", str(value or "").lower()):
            if token in STOPWORDS:
                continue
            tokens.add(token)
    return tokens


def estimate_trend_match(
    trend: dict[str, Any], account: dict[str, Any], profile_summary: dict[str, Any], trend_index: int
) -> int:
    account_keywords = extract_keywords(
        account.get("niche"),
        profile_summary.get("niche"),
        account.get("biography"),
        account.get("fullName"),
        " ".join(str(post.get("caption", "")) for post in account.get("recentPosts", [])),
    )
    trend_keywords = extract_keywords(trend.get("title"), trend.get("description"))
    overlap = len(account_keywords & trend_keywords)

    base_score = 42 + min(24, overlap * 11)
    if trend_keywords and any(keyword in str(account.get("biography", "")).lower() for keyword in trend_keywords):
        base_score += 8

    if account.get("recentPosts"):
        base_score += 6

    base_score += max(-8, 6 - trend_index * 4)
    return max(28, min(92, base_score))


def normalize_trend_type(value: Any) -> str | None:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return None

    if any(marker in normalized for marker in TOP_TREND_MARKERS):
        return "top"
    if any(marker in normalized for marker in GROWING_TREND_MARKERS):
        return "growing"
    return None


def normalize_trends(
    trends: list[Any], account: dict[str, Any], profile_summary: dict[str, Any]
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(trends):
        if not isinstance(item, dict):
            raise UpstreamServiceError("AI returned an invalid trend item.", 502)

        parsed_match = parse_score(item.get("match"))
        normalized.append(
            {
                "type": normalize_trend_type(item.get("type")),
                "title": str(item.get("title", "")).strip(),
                "description": str(item.get("description", "")).strip(),
                "match": parsed_match if parsed_match is not None else estimate_trend_match(item, account, profile_summary, index),
            }
        )

    if len(normalized) == 4:
        recognized_count = sum(1 for trend in normalized if trend["type"] in {"top", "growing"})
        if recognized_count < 4 or len({trend["type"] for trend in normalized if trend["type"]}) == 1:
            ranking = sorted(range(len(normalized)), key=lambda idx: normalized[idx]["match"], reverse=True)
            top_indices = set(ranking[:2])
            for index, trend in enumerate(normalized):
                trend["type"] = "top" if index in top_indices else "growing"
        else:
            for trend in normalized:
                trend["type"] = trend["type"] or "growing"

    return normalized


def infer_compatibility_score(
    raw_score: Any, compatibility_label: Any, trends: list[dict[str, Any]]
) -> int:
    parsed_score = parse_score(raw_score)
    if parsed_score is not None:
        return parsed_score

    label_score = infer_score_from_label(compatibility_label)
    trend_average = round(sum(trend["match"] for trend in trends) / len(trends)) if trends else None

    if label_score is not None and trend_average is not None:
        return max(0, min(100, round(label_score * 0.7 + trend_average * 0.3)))
    if label_score is not None:
        return label_score
    if trend_average is not None:
        return trend_average
    return 60


def build_allowed_origins(raw_value: str) -> set[str]:
    origins = {item.strip().rstrip("/") for item in raw_value.split(",") if item.strip()}
    expanded_origins = set(origins)

    for origin in list(origins):
        parsed = urlparse(origin)
        hostname = (parsed.hostname or "").lower()
        if hostname not in {"127.0.0.1", "localhost"}:
            continue

        counterpart = "localhost" if hostname == "127.0.0.1" else "127.0.0.1"
        netloc = counterpart
        if parsed.port:
            netloc = f"{counterpart}:{parsed.port}"

        expanded_origins.add(f"{parsed.scheme}://{netloc}".rstrip("/"))

    return expanded_origins


@dataclass(slots=True)
class AppConfig:
    app_env: str
    database_url: str
    secret_key: str
    frontend_origin: str
    apify_token: str | None
    apify_instagram_actor_id: str
    apify_tiktok_actor_id: str
    gemini_api_key: str | None
    gemini_model: str
    analysis_cache_ttl_minutes: int
    session_ttl_hours: int
    analysis_limit_per_hour: int
    auth_limit_per_15_min: int
    port: int
    host: str
    debug: bool
    enable_search_grounding: bool

    @classmethod
    def from_env(cls, overrides: dict[str, Any] | None = None) -> "AppConfig":
        source = dict(os.environ)
        if overrides:
            source.update({key: value for key, value in overrides.items() if value is not None})

        app_env = str(source.get("APP_ENV", "development")).strip().lower()
        database_url = str(
            source.get("DATABASE_URL", "sqlite:///backend/data/alignd.db")
        ).strip()
        secret_key = str(source.get("SECRET_KEY", "dev-secret-change-me")).strip()

        if app_env == "production":
            if not database_url.startswith("postgresql://") and not database_url.startswith("postgres://"):
                raise RuntimeError("Production requires PostgreSQL in DATABASE_URL.")
            if secret_key == "dev-secret-change-me":
                raise RuntimeError("Set a strong SECRET_KEY in production.")

        return cls(
            app_env=app_env,
            database_url=database_url,
            secret_key=secret_key,
            frontend_origin=str(source.get("FRONTEND_ORIGIN", "http://127.0.0.1:3000")).strip(),
            apify_token=(source.get("APIFY_TOKEN") or "").strip() or None,
            apify_instagram_actor_id=str(
                source.get("APIFY_INSTAGRAM_ACTOR_ID", DEFAULT_APIFY_INSTAGRAM_ACTOR_ID)
            ).strip(),
            apify_tiktok_actor_id=str(
                source.get("APIFY_TIKTOK_ACTOR_ID", DEFAULT_APIFY_TIKTOK_ACTOR_ID)
            ).strip(),
            gemini_api_key=(source.get("GEMINI_API_KEY") or "").strip() or None,
            gemini_model=str(source.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)).strip(),
            analysis_cache_ttl_minutes=parse_int(
                source.get("ANALYSIS_CACHE_TTL_MINUTES"), DEFAULT_ANALYSIS_CACHE_TTL_MINUTES
            ),
            session_ttl_hours=parse_int(
                source.get("SESSION_TTL_HOURS"), DEFAULT_SESSION_TTL_HOURS
            ),
            analysis_limit_per_hour=parse_int(
                source.get("ANALYSIS_LIMIT_PER_HOUR"), DEFAULT_ANALYSIS_LIMIT_PER_HOUR
            ),
            auth_limit_per_15_min=parse_int(
                source.get("AUTH_LIMIT_PER_15_MINUTES"), DEFAULT_AUTH_LIMIT_PER_15_MIN
            ),
            port=parse_int(source.get("PORT"), 5000),
            host=str(source.get("HOST", "0.0.0.0")).strip(),
            debug=parse_bool(source.get("DEBUG"), app_env != "production"),
            enable_search_grounding=parse_bool(source.get("ENABLE_SEARCH_GROUNDING"), True),
        )


class ApiError(Exception):
    def __init__(self, message: str, status_code: int = 400, details: Any | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details


class UpstreamServiceError(ApiError):
    pass


@dataclass(slots=True)
class ProfileTarget:
    platform: str
    profile_url: str
    username: str


class Database:
    def __init__(self, url: str):
        self.url = url
        self.is_sqlite = url.startswith("sqlite:///")
        self.is_postgres = url.startswith("postgresql://") or url.startswith("postgres://")
        self._lock = Lock()

        if not self.is_sqlite and not self.is_postgres:
            raise RuntimeError("Unsupported DATABASE_URL. Use postgresql://... or sqlite:///...")

        if self.is_sqlite:
            sqlite_path = url.replace("sqlite:///", "", 1)
            db_path = Path(sqlite_path)
            if db_path.parent:
                db_path.parent.mkdir(parents=True, exist_ok=True)
            self.sqlite_path = str(db_path)
        else:
            self.sqlite_path = None

    @contextmanager
    def connect(self) -> Iterator[Any]:
        if self.is_sqlite:
            connection = sqlite3.connect(self.sqlite_path)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            try:
                yield connection
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()
            return

        try:
            import psycopg
            from psycopg.rows import dict_row

            connection = psycopg.connect(self.url, row_factory=dict_row)
            try:
                yield connection
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.close()
            return
        except ModuleNotFoundError:
            pass

        import psycopg2
        from psycopg2.extras import RealDictCursor

        connection = psycopg2.connect(self.url, cursor_factory=RealDictCursor)
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _query(self, query: str) -> str:
        if self.is_sqlite:
            return query
        return query.replace("?", "%s")

    def execute(self, query: str, params: tuple[Any, ...] = ()) -> None:
        with self.connect() as connection:
            connection.execute(self._query(query), params)

    def fetch_one(self, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        with self.connect() as connection:
            cursor = connection.execute(self._query(query), params)
            row = cursor.fetchone()
            if row is None:
                return None
            return dict(row)

    def fetch_all(self, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.connect() as connection:
            cursor = connection.execute(self._query(query), params)
            rows = cursor.fetchall()
            return [dict(row) for row in rows]

    def ensure_schema(self) -> None:
        schema_statements = [
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS auth_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                last_used_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS analysis_runs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                profile_url TEXT NOT NULL,
                niche TEXT NOT NULL,
                account_payload TEXT NOT NULL,
                analysis_payload TEXT NOT NULL,
                sources_payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                cache_key TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS rate_limits (
                scope TEXT NOT NULL,
                subject TEXT NOT NULL,
                count INTEGER NOT NULL,
                window_started_at TEXT NOT NULL,
                PRIMARY KEY(scope, subject)
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
            "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth_sessions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_analysis_user_id_created_at ON analysis_runs(user_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_analysis_cache_key ON analysis_runs(cache_key)",
        ]

        with self._lock:
            for statement in schema_statements:
                self.execute(statement)

    def ping(self) -> None:
        self.fetch_one("SELECT 1 AS ok")

    def upsert_rate_limit(
        self,
        scope: str,
        subject: str,
        limit: int,
        window_seconds: int,
    ) -> tuple[bool, int]:
        now = utc_now()
        row = self.fetch_one(
            "SELECT scope, subject, count, window_started_at FROM rate_limits WHERE scope = ? AND subject = ?",
            (scope, subject),
        )

        if row is None:
            self.execute(
                """
                INSERT INTO rate_limits (scope, subject, count, window_started_at)
                VALUES (?, ?, ?, ?)
                """,
                (scope, subject, 1, now.isoformat()),
            )
            return True, limit - 1

        window_started_at = datetime.fromisoformat(row["window_started_at"])
        if now - window_started_at >= timedelta(seconds=window_seconds):
            self.execute(
                """
                UPDATE rate_limits
                SET count = ?, window_started_at = ?
                WHERE scope = ? AND subject = ?
                """,
                (1, now.isoformat(), scope, subject),
            )
            return True, limit - 1

        next_count = int(row["count"]) + 1
        if next_count > limit:
            return False, 0

        self.execute(
            "UPDATE rate_limits SET count = ? WHERE scope = ? AND subject = ?",
            (next_count, scope, subject),
        )
        return True, max(limit - next_count, 0)


def get_database() -> Database:
    return current_app.extensions["database"]


def normalize_email(value: str) -> str:
    return value.strip().lower()


def validate_email(value: str) -> str:
    normalized = normalize_email(value)
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
        raise ApiError("Введите корректный email.", 400)
    return normalized


def validate_password(value: str) -> str:
    password = value.strip()
    if len(password) < 8:
        raise ApiError("Пароль должен быть не короче 8 символов.", 400)
    return password


def validate_display_name(value: str) -> str:
    display_name = value.strip()
    if len(display_name) < 2:
        raise ApiError("Введите имя длиной не менее 2 символов.", 400)
    return display_name[:120]


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_to_payload(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "email": user["email"],
        "displayName": user["display_name"],
        "createdAt": user["created_at"],
    }


def create_user(email: str, display_name: str, password: str) -> dict[str, Any]:
    db = get_database()
    existing_user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if existing_user:
        raise ApiError("Пользователь с таким email уже существует.", 409)

    user_id = str(uuid.uuid4())
    timestamp = iso_now()
    db.execute(
        """
        INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            email,
            display_name,
            generate_password_hash(password),
            timestamp,
            timestamp,
        ),
    )
    return db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,)) or {}


def create_session(user_id: str) -> str:
    db = get_database()
    token = secrets.token_urlsafe(32)
    token_hash = hash_token(token)
    now = utc_now()
    expires_at = now + timedelta(hours=current_app.config["SESSION_TTL_HOURS"])

    db.execute(
        """
        INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid.uuid4()),
            user_id,
            token_hash,
            now.isoformat(),
            expires_at.isoformat(),
            now.isoformat(),
        ),
    )
    return token


def get_token_from_request() -> str:
    auth_header = flask_request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise ApiError("Требуется авторизация.", 401)
    return auth_header.removeprefix("Bearer ").strip()


def get_current_user() -> dict[str, Any]:
    if getattr(g, "current_user", None):
        return g.current_user

    token = get_token_from_request()
    token_hash = hash_token(token)
    db = get_database()
    session = db.fetch_one(
        """
        SELECT auth_sessions.id AS session_id, auth_sessions.user_id, auth_sessions.expires_at, users.*
        FROM auth_sessions
        JOIN users ON users.id = auth_sessions.user_id
        WHERE auth_sessions.token_hash = ?
        """,
        (token_hash,),
    )
    if not session:
        raise ApiError("Сессия не найдена. Войдите снова.", 401)

    expires_at = datetime.fromisoformat(session["expires_at"])
    if expires_at <= utc_now():
        db.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
        raise ApiError("Сессия истекла. Войдите снова.", 401)

    db.execute(
        "UPDATE auth_sessions SET last_used_at = ? WHERE token_hash = ?",
        (iso_now(), token_hash),
    )
    g.current_user = session
    g.current_token_hash = token_hash
    return session


def logout_current_user() -> None:
    token_hash = getattr(g, "current_token_hash", None)
    if token_hash:
        get_database().execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))


def json_error(message: str, status_code: int, details: Any | None = None):
    payload: dict[str, Any] = {"error": message}
    if details is not None:
        payload["details"] = details
    return jsonify(payload), status_code


def request_json() -> dict[str, Any]:
    payload = flask_request.get_json(silent=True)
    if payload is None:
        return {}
    if not isinstance(payload, dict):
        raise ApiError("Request body must be a JSON object.", 400)
    return payload


def sanitize_profile_target(raw_url: str) -> ProfileTarget:
    candidate = raw_url.strip()
    if not candidate:
        raise ApiError("Укажите ссылку на Instagram или TikTok профиль.", 400)

    if candidate.startswith("@"):
        username = candidate.removeprefix("@").strip()
        candidate = f"https://www.instagram.com/{username}/"

    if not candidate.startswith(("http://", "https://")):
        candidate = f"https://{candidate}"

    parsed = urlparse(candidate)
    hostname = (parsed.hostname or "").lower()
    if hostname in INSTAGRAM_HOSTS:
        return sanitize_instagram_profile_target(parsed)
    if hostname in TIKTOK_HOSTS:
        return sanitize_tiktok_profile_target(parsed)

    raise ApiError("Сейчас поддерживаются только ссылки на Instagram и TikTok профили.", 400)


def sanitize_instagram_profile_target(parsed) -> ProfileTarget:
    path_parts = [part for part in parsed.path.split("/") if part]
    if len(path_parts) != 1:
        raise ApiError("Нужна ссылка именно на профиль, а не на пост, reel или раздел Instagram.", 400)

    username = path_parts[0]
    if username.lower() in RESERVED_INSTAGRAM_PATHS:
        raise ApiError("Нужна ссылка именно на профиль Instagram.", 400)
    if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", username):
        raise ApiError("Некорректный username Instagram.", 400)

    return ProfileTarget("Instagram", f"https://www.instagram.com/{username}/", username)


def sanitize_tiktok_profile_target(parsed) -> ProfileTarget:
    path_parts = [part for part in parsed.path.split("/") if part]
    if len(path_parts) != 1 or not path_parts[0].startswith("@"):
        raise ApiError("Нужна ссылка именно на профиль TikTok вида https://www.tiktok.com/@username.", 400)

    username = path_parts[0].removeprefix("@")
    if not re.fullmatch(r"[A-Za-z0-9._]{2,24}", username):
        raise ApiError("Некорректный username TikTok.", 400)

    return ProfileTarget("TikTok", f"https://www.tiktok.com/@{username}", username)


def sanitize_instagram_profile_url(raw_url: str) -> str:
    target = sanitize_profile_target(raw_url)
    if target.platform != "Instagram":
        raise ApiError("Нужна ссылка именно на профиль Instagram.", 400)
    return target.profile_url


def coalesce(data: dict[str, Any], keys: list[str], default: Any = None) -> Any:
    for key in keys:
        value = data.get(key)
        if value not in (None, "", []):
            return value
    return default


def get_nested(data: dict[str, Any], key_path: str) -> Any:
    current: Any = data
    for key in key_path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def coalesce_nested(data: dict[str, Any], keys: list[str], default: Any = None) -> Any:
    for key in keys:
        value = get_nested(data, key) if "." in key else data.get(key)
        if value not in (None, "", []):
            return value
    return default


def to_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def timestamp_to_iso(value: Any) -> str:
    parsed = to_int(value)
    if parsed is None:
        return ""
    try:
        return datetime.fromtimestamp(parsed, timezone.utc).isoformat()
    except (OSError, OverflowError, ValueError):
        return ""


def normalize_post(post: dict[str, Any]) -> dict[str, Any]:
    return {
        "caption": coalesce(post, ["caption", "title"], ""),
        "likesCount": to_int(coalesce(post, ["likesCount", "likes", "likes_count"])),
        "commentsCount": to_int(coalesce(post, ["commentsCount", "comments", "comments_count"])),
        "videoViewCount": to_int(coalesce(post, ["videoViewCount", "videoPlayCount", "viewsCount"])),
        "timestamp": coalesce(post, ["timestamp", "takenAt", "createdAt"], ""),
    }


def normalize_instagram_account(item: dict[str, Any], profile_url: str, niche: str) -> dict[str, Any]:
    posts = coalesce(
        item,
        ["latestPosts", "latestIgtvVideos", "posts", "topPosts", "latestPostsVideos"],
        [],
    )
    normalized_posts = [normalize_post(post) for post in posts if isinstance(post, dict)]

    return {
        "username": coalesce(item, ["username", "userName", "ownerUsername"], "username"),
        "fullName": coalesce(item, ["fullName", "userFullName", "ownerFullName"], ""),
        "biography": coalesce(item, ["biography", "bio", "description"], ""),
        "followersCount": to_int(coalesce(item, ["followersCount", "followers", "followerCount"])),
        "followsCount": to_int(coalesce(item, ["followsCount", "followingCount", "followings"])),
        "postsCount": to_int(coalesce(item, ["postsCount", "posts", "latestPostsCount"])),
        "profilePicUrl": coalesce(
            item,
            ["profilePicUrl", "profilePicUrlHD", "profilePicture", "profilePictureUrl"],
            "",
        ),
        "externalUrl": coalesce(item, ["externalUrl", "website"], ""),
        "isVerified": to_bool(coalesce(item, ["verified", "isVerified"], False)),
        "isPrivate": to_bool(coalesce(item, ["private", "isPrivate"], False)),
        "platform": "Instagram",
        "profileUrl": profile_url,
        "niche": niche or coalesce(item, ["categoryName", "businessCategoryName"], ""),
        "recentPosts": normalized_posts[:6],
    }


def normalize_tiktok_post(post: dict[str, Any]) -> dict[str, Any]:
    return {
        "caption": coalesce_nested(
            post,
            ["text", "description", "title", "caption", "video.description", "video.title"],
            "",
        ),
        "likesCount": to_int(coalesce_nested(post, ["diggCount", "likesCount", "stats.diggCount", "video.stats.diggCount"])),
        "commentsCount": to_int(
            coalesce_nested(post, ["commentCount", "commentsCount", "stats.commentCount", "video.stats.commentCount"])
        ),
        "videoViewCount": to_int(coalesce_nested(post, ["playCount", "viewsCount", "video.playCount", "video.stats.playCount"])),
        "timestamp": coalesce_nested(post, ["createTimeISO", "timestamp", "createdAt", "video.createTimeISO"], "")
        or timestamp_to_iso(coalesce_nested(post, ["createTime", "create_time", "video.create_time"])),
    }


def normalize_tiktok_account(items: list[dict[str, Any]], profile_url: str, username: str, niche: str) -> dict[str, Any]:
    profile_item = next((item for item in items if isinstance(item.get("authorMeta"), dict)), items[0] if items else {})
    normalized_posts = [normalize_tiktok_post(post) for post in items if isinstance(post, dict)]

    resolved_username = coalesce_nested(
        profile_item,
        ["authorMeta.name", "authorMeta.uniqueId", "username", "author.username", "author.uniqueId"],
        username,
    )

    external_url = coalesce_nested(profile_item, ["authorMeta.bioLink.link", "authorMeta.bioLink", "externalUrl", "website"], "")
    if isinstance(external_url, dict):
        external_url = coalesce(external_url, ["link", "url"], "")

    return {
        "username": str(resolved_username).removeprefix("@"),
        "fullName": coalesce_nested(
            profile_item,
            ["authorMeta.nickName", "authorMeta.nickname", "nickname", "fullName", "author.nickname"],
            "",
        ),
        "biography": coalesce_nested(
            profile_item,
            ["authorMeta.signature", "authorMeta.bio", "signature", "bio", "description"],
            "",
        ),
        "followersCount": to_int(
            coalesce_nested(profile_item, ["authorMeta.fans", "authorMeta.followers", "followersCount", "followerCount"])
        ),
        "followsCount": to_int(
            coalesce_nested(profile_item, ["authorMeta.following", "authorMeta.followingCount", "followingCount", "followsCount"])
        ),
        "postsCount": to_int(coalesce_nested(profile_item, ["authorMeta.video", "authorMeta.videoCount", "videoCount", "postsCount"]))
        or len(normalized_posts),
        "profilePicUrl": coalesce_nested(
            profile_item,
            [
                "authorMeta.avatar",
                "authorMeta.avatarThumb",
                "authorMeta.avatarMedium",
                "authorMeta.avatarLarger",
                "authorMeta.originalAvatarUrl",
                "avatar",
            ],
            "",
        ),
        "externalUrl": external_url,
        "isVerified": to_bool(coalesce_nested(profile_item, ["authorMeta.verified", "verified", "isVerified"], False)),
        "isPrivate": to_bool(coalesce_nested(profile_item, ["authorMeta.privateAccount", "privateAccount", "isPrivate"], False)),
        "platform": "TikTok",
        "profileUrl": profile_url,
        "niche": niche,
        "recentPosts": normalized_posts[:6],
    }


def normalize_account(
    raw_items: list[dict[str, Any]] | dict[str, Any],
    profile_url: str,
    niche: str,
    platform: str = "Instagram",
    username: str = "",
) -> dict[str, Any]:
    items = raw_items if isinstance(raw_items, list) else [raw_items]
    if platform == "TikTok":
        return normalize_tiktok_account(items, profile_url, username, niche)
    return normalize_instagram_account(items[0], profile_url, niche)


def build_apify_url(actor_id: str) -> str:
    token = current_app.config["APIFY_TOKEN"]
    if not token:
        raise ApiError("APIFY_TOKEN is not configured on the server.", 500)
    query_string = parse.urlencode({"token": token})
    return f"{APIFY_RUN_SYNC_URL.format(actor_id=actor_id)}?{query_string}"


def build_gemini_url() -> str:
    api_key = current_app.config["GEMINI_API_KEY"]
    if not api_key:
        raise ApiError("GEMINI_API_KEY is not configured on the server.", 500)
    model = current_app.config["GEMINI_MODEL"]
    query_string = parse.urlencode({"key": api_key})
    return f"{GEMINI_BASE_URL.format(model=model)}?{query_string}"


def get_apify_actor_id(platform: str) -> str:
    if platform == "TikTok":
        return current_app.config["APIFY_TIKTOK_ACTOR_ID"]
    return current_app.config["APIFY_INSTAGRAM_ACTOR_ID"]


def build_apify_payload(profile_url: str, platform: str, username: str = "") -> dict[str, Any]:
    if platform == "TikTok":
        return {
            "profiles": [username or profile_url.rstrip("/").rsplit("/", 1)[-1].removeprefix("@")],
            "shouldDownloadCovers": False,
            "shouldDownloadSlideshowImages": False,
            "shouldDownloadSubtitles": False,
            "shouldDownloadVideos": False,
            "resultsPerPage": 6,
        }

    return {
        "directUrls": [profile_url],
        "resultsType": "details",
        "resultsLimit": 1,
    }


def fetch_apify_items(profile_url: str, platform: str = "Instagram", username: str = "") -> list[dict[str, Any]]:
    payload = build_apify_payload(profile_url, platform, username)
    apify_request = request.Request(
        build_apify_url(get_apify_actor_id(platform)),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(apify_request, timeout=180) as response:
            raw_body = response.read().decode("utf-8")
            return json.loads(raw_body) if raw_body else []
    except error.HTTPError as exc:
        raw_error = exc.read().decode("utf-8", errors="replace")
        raise UpstreamServiceError(
            "Не удалось получить данные профиля.",
            exc.code,
            raw_error or "Apify request failed.",
        ) from exc
    except error.URLError as exc:
        raise UpstreamServiceError(
            "Сервис анализа профиля временно недоступен.",
            502,
            str(exc.reason),
        ) from exc
    except json.JSONDecodeError as exc:
        raise UpstreamServiceError("Источник профиля вернул некорректный ответ.", 502) from exc


def build_analysis_prompt(account: dict[str, Any], niche: str) -> str:
    platform = str(account.get("platform") or "social media")
    prompt_payload = {
        "account": account,
        "userProvidedNiche": niche,
        "analysisGoal": (
            f"Проанализируй {platform}-профиль, его позиционирование и контент-сигналы. "
            "Сопоставь это с актуальными форматами коротких видео и паттернами контента, "
            f"которые работают сейчас для {platform}. "
            "Верни только валидный JSON на русском языке без markdown."
        ),
        "requirements": [
            "Profile summary must contain niche, compatibilityLabel, compatibilityScore, positioning, audienceSummary.",
            "Return exactly 4 trends.",
            "Return exactly 2 trends with type 'top' and 2 trends with type 'growing'.",
            "Return exactly 3 ideas.",
            "Return exactly 6 hooks.",
            "Recommendations must contain summary and 5-8 bullets.",
            "compatibilityScore must be an integer from 0 to 100 without percent signs or text.",
            "Each trends[].match must be an integer from 0 to 100 without percent signs or text.",
            "Use only 'top' or 'growing' as values for trends[].type.",
            (
                "Use this JSON shape only: "
                "{profileSummary:{niche,compatibilityLabel,compatibilityScore,positioning,audienceSummary},"
                "trends:[{type,title,description,match}],ideas:[{tag,title,hook,angle}],"
                "hooks:[string],recommendations:{summary,bullets:[string]}}"
            ),
        ],
    }
    return json.dumps(prompt_payload, ensure_ascii=False)


def extract_text_parts(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates", [])
    if not candidates:
        raise UpstreamServiceError("AI did not return any analysis.", 502)

    content = candidates[0].get("content", {})
    parts = content.get("parts", [])
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict))
    if not text:
        raise UpstreamServiceError("AI returned an empty analysis.", 502)

    return text


def parse_json_response_text(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise UpstreamServiceError("AI returned an invalid JSON payload.", 502) from exc


def extract_grounding_sources(payload: dict[str, Any]) -> list[dict[str, str]]:
    candidates = payload.get("candidates", [])
    if not candidates:
        return []

    metadata = candidates[0].get("groundingMetadata", {})
    chunks = metadata.get("groundingChunks", [])
    sources: list[dict[str, str]] = []
    seen: set[str] = set()

    for chunk in chunks:
        web_chunk = chunk.get("web", {})
        uri = web_chunk.get("uri")
        title = web_chunk.get("title")
        if not uri or uri in seen:
            continue
        seen.add(uri)
        sources.append({"title": title or uri, "url": uri})

    return sources


def ensure_analysis_shape(analysis: dict[str, Any]) -> dict[str, Any]:
    required_profile_keys = {
        "niche",
        "compatibilityLabel",
        "compatibilityScore",
        "positioning",
        "audienceSummary",
    }
    profile_summary = analysis.get("profileSummary")
    if not isinstance(profile_summary, dict) or not required_profile_keys.issubset(profile_summary):
        raise UpstreamServiceError("AI returned an incomplete profile summary.", 502)

    trends = analysis.get("trends")
    ideas = analysis.get("ideas")
    hooks = analysis.get("hooks")
    recommendations = analysis.get("recommendations")

    if not isinstance(trends, list) or len(trends) != 4:
        raise UpstreamServiceError("AI returned an invalid trends block.", 502)
    if not isinstance(ideas, list) or len(ideas) != 3:
        raise UpstreamServiceError("AI returned an invalid ideas block.", 502)
    if not isinstance(hooks, list) or len(hooks) != 6:
        raise UpstreamServiceError("AI returned an invalid hooks block.", 502)
    if not isinstance(recommendations, dict):
        raise UpstreamServiceError("AI returned an invalid recommendations block.", 502)

    bullets = recommendations.get("bullets")
    if not isinstance(bullets, list) or not (5 <= len(bullets) <= 8):
        raise UpstreamServiceError("AI returned an invalid recommendations list.", 502)

    normalized_trends = normalize_trends(trends, analysis.get("account", {}), profile_summary)
    compatibility_score = infer_compatibility_score(
        profile_summary.get("compatibilityScore"),
        profile_summary.get("compatibilityLabel"),
        normalized_trends,
    )

    return {
        "profileSummary": {
            "niche": str(profile_summary["niche"]),
            "compatibilityLabel": str(profile_summary["compatibilityLabel"]),
            "compatibilityScore": compatibility_score,
            "positioning": str(profile_summary["positioning"]),
            "audienceSummary": str(profile_summary["audienceSummary"]),
        },
        "trends": normalized_trends,
        "ideas": [
            {
                "tag": str(item.get("tag", "")),
                "title": str(item.get("title", "")),
                "hook": str(item.get("hook", "")),
                "angle": str(item.get("angle", "")),
            }
            for item in ideas
        ],
        "hooks": [str(item) for item in hooks],
        "recommendations": {
            "summary": str(recommendations.get("summary", "")),
            "bullets": [str(item) for item in bullets],
        },
    }


def generate_analysis(account: dict[str, Any], niche: str) -> tuple[dict[str, Any], list[dict[str, str]], str]:
    payload: dict[str, Any] = {
        "contents": [{"parts": [{"text": build_analysis_prompt(account, niche)}]}],
        "generationConfig": {"temperature": 0.6},
    }
    if current_app.config["ENABLE_SEARCH_GROUNDING"]:
        payload["tools"] = [{"google_search": {}}]

    gemini_request = request.Request(
        build_gemini_url(),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(gemini_request, timeout=120) as response:
            raw_body = response.read().decode("utf-8")
            response_payload = json.loads(raw_body)
    except error.HTTPError as exc:
        raw_error = exc.read().decode("utf-8", errors="replace")
        raise UpstreamServiceError(
            "Unable to complete AI analysis.",
            exc.code,
            raw_error or "Gemini request failed.",
        ) from exc
    except error.URLError as exc:
        raise UpstreamServiceError(
            "AI analysis service is temporarily unavailable.",
            502,
            str(exc.reason),
        ) from exc
    except json.JSONDecodeError as exc:
        raise UpstreamServiceError("AI analysis service returned invalid JSON.", 502) from exc

    analysis_payload = parse_json_response_text(extract_text_parts(response_payload))
    if "account" not in analysis_payload:
        analysis_payload["account"] = account
    analysis = ensure_analysis_shape(analysis_payload)
    sources = extract_grounding_sources(response_payload)
    return analysis, sources, current_app.config["GEMINI_MODEL"]


def build_cache_key(user_id: str, profile_url: str, niche: str) -> str:
    digest = hashlib.sha256(
        f"{CACHE_SCHEMA_VERSION}|{user_id}|{profile_url}|{niche.strip().lower()}".encode("utf-8")
    ).hexdigest()
    return digest


def get_cached_analysis(user_id: str, profile_url: str, niche: str) -> dict[str, Any] | None:
    db = get_database()
    cache_key = build_cache_key(user_id, profile_url, niche)
    row = db.fetch_one(
        """
        SELECT *
        FROM analysis_runs
        WHERE cache_key = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (cache_key,),
    )
    if not row:
        return None

    created_at = datetime.fromisoformat(row["created_at"])
    ttl = timedelta(minutes=current_app.config["ANALYSIS_CACHE_TTL_MINUTES"])
    if utc_now() - created_at > ttl:
        return None

    return {
        "id": row["id"],
        "account": json.loads(row["account_payload"]),
        "analysis": json.loads(row["analysis_payload"]),
        "sources": json.loads(row["sources_payload"]),
        "createdAt": row["created_at"],
    }


def save_analysis(
    user_id: str,
    profile_url: str,
    niche: str,
    account: dict[str, Any],
    analysis: dict[str, Any],
    sources: list[dict[str, str]],
) -> str:
    run_id = str(uuid.uuid4())
    created_at = iso_now()
    get_database().execute(
        """
        INSERT INTO analysis_runs (
            id, user_id, profile_url, niche, account_payload, analysis_payload, sources_payload, created_at, cache_key
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            run_id,
            user_id,
            profile_url,
            niche,
            json.dumps(account, ensure_ascii=False),
            json.dumps(analysis, ensure_ascii=False),
            json.dumps(sources, ensure_ascii=False),
            created_at,
            build_cache_key(user_id, profile_url, niche),
        ),
    )
    return run_id


def get_recent_analyses(user_id: str) -> list[dict[str, Any]]:
    rows = get_database().fetch_all(
        """
        SELECT id, profile_url, niche, account_payload, analysis_payload, created_at
        FROM analysis_runs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 8
        """,
        (user_id,),
    )

    items: list[dict[str, Any]] = []
    for row in rows:
        account = json.loads(row["account_payload"])
        analysis = json.loads(row["analysis_payload"])
        items.append(
            {
                "id": row["id"],
                "profileUrl": row["profile_url"],
                "username": account.get("username", ""),
                "niche": analysis.get("profileSummary", {}).get("niche") or row["niche"],
                "compatibilityScore": analysis.get("profileSummary", {}).get("compatibilityScore"),
                "createdAt": row["created_at"],
            }
        )
    return items


def get_analysis_run(user_id: str, run_id: str) -> dict[str, Any] | None:
    row = get_database().fetch_one(
        """
        SELECT id, profile_url, niche, account_payload, analysis_payload, sources_payload, created_at
        FROM analysis_runs
        WHERE id = ? AND user_id = ?
        LIMIT 1
        """,
        (run_id, user_id),
    )
    if not row:
        return None

    return {
        "id": row["id"],
        "account": json.loads(row["account_payload"]),
        "analysis": json.loads(row["analysis_payload"]),
        "sources": json.loads(row["sources_payload"]),
        "createdAt": row["created_at"],
        "analysisModel": current_app.config["GEMINI_MODEL"],
        "cached": True,
        "profileUrl": row["profile_url"],
        "niche": row["niche"],
    }


def consume_rate_limit(scope: str, subject: str, limit: int, window_seconds: int) -> None:
    allowed, remaining = get_database().upsert_rate_limit(scope, subject, limit, window_seconds)
    if not allowed:
        raise ApiError("Too many requests. Please try again later.", 429, {"remaining": remaining})


def get_request_subject(prefix: str) -> str:
    forwarded_for = flask_request.headers.get("X-Forwarded-For", "")
    ip = forwarded_for.split(",")[0].strip() if forwarded_for else (flask_request.remote_addr or "unknown")
    return f"{prefix}:{ip}"


def register_routes(app: Flask) -> None:
    @app.before_request
    def log_request_start() -> None:
        current_app.logger.info("%s %s", flask_request.method, flask_request.path)

    @app.after_request
    def apply_response_headers(response):
        origin = (flask_request.headers.get("Origin") or "").rstrip("/")
        allowed_origins = build_allowed_origins(current_app.config["FRONTEND_ORIGIN"])
        if origin and origin in allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if current_app.config["APP_ENV"] == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.errorhandler(ApiError)
    def handle_api_error(exc: ApiError):
        return json_error(exc.message, exc.status_code, exc.details)

    @app.errorhandler(Exception)
    def handle_unexpected_error(exc: Exception):
        current_app.logger.exception("Unhandled error", exc_info=exc)
        return json_error("Internal server error.", 500)

    @app.get("/health")
    def healthcheck():
        return jsonify({"status": "ok"})

    @app.get("/ready")
    def readiness():
        get_database().ping()
        return jsonify({"status": "ready"})

    @app.route("/auth/register", methods=["POST", "OPTIONS"])
    def register():
        if flask_request.method == "OPTIONS":
            return ("", 204)

        consume_rate_limit(
            "auth-register",
            get_request_subject("register"),
            current_app.config["AUTH_LIMIT_PER_15_MINUTES"],
            15 * 60,
        )

        payload = request_json()
        email = validate_email(str(payload.get("email", "")))
        password = validate_password(str(payload.get("password", "")))
        display_name = validate_display_name(str(payload.get("displayName", "")))

        user = create_user(email, display_name, password)
        token = create_session(user["id"])
        return jsonify({"token": token, "user": user_to_payload(user)}), 201

    @app.route("/auth/login", methods=["POST", "OPTIONS"])
    def login():
        if flask_request.method == "OPTIONS":
            return ("", 204)

        consume_rate_limit(
            "auth-login",
            get_request_subject("login"),
            current_app.config["AUTH_LIMIT_PER_15_MINUTES"],
            15 * 60,
        )

        payload = request_json()
        email = validate_email(str(payload.get("email", "")))
        password = str(payload.get("password", ""))

        user = get_database().fetch_one("SELECT * FROM users WHERE email = ?", (email,))
        if not user or not check_password_hash(user["password_hash"], password):
            raise ApiError("Invalid email or password.", 401)

        token = create_session(user["id"])
        return jsonify({"token": token, "user": user_to_payload(user)})

    @app.route("/auth/me", methods=["GET", "OPTIONS"])
    def auth_me():
        if flask_request.method == "OPTIONS":
            return ("", 204)
        user = get_current_user()
        return jsonify({"user": user_to_payload(user)})

    @app.route("/auth/logout", methods=["POST", "OPTIONS"])
    def auth_logout():
        if flask_request.method == "OPTIONS":
            return ("", 204)
        get_current_user()
        logout_current_user()
        return jsonify({"status": "logged_out"})

    @app.route("/analyses", methods=["GET", "OPTIONS"])
    def analyses():
        if flask_request.method == "OPTIONS":
            return ("", 204)
        user = get_current_user()
        return jsonify({"items": get_recent_analyses(user["id"])})

    @app.route("/analyses/<run_id>", methods=["GET", "OPTIONS"])
    def analysis_details(run_id: str):
        if flask_request.method == "OPTIONS":
            return ("", 204)
        user = get_current_user()
        analysis_run = get_analysis_run(user["id"], run_id)
        if not analysis_run:
            raise ApiError("Analysis not found.", 404)
        return jsonify(analysis_run)

    @app.route("/analyze-account", methods=["POST", "OPTIONS"])
    def analyze_account():
        if flask_request.method == "OPTIONS":
            return ("", 204)

        user = get_current_user()
        consume_rate_limit(
            "analyze-account",
            f"user:{user['id']}",
            current_app.config["ANALYSIS_LIMIT_PER_HOUR"],
            60 * 60,
        )

        payload = request_json()
        target = sanitize_profile_target(str(payload.get("profileUrl", "")))
        profile_url = target.profile_url
        niche = str(payload.get("niche", "")).strip()[:160]

        cached = get_cached_analysis(user["id"], profile_url, niche)
        if cached:
            return jsonify(
                {
                    "id": cached["id"],
                    "account": cached["account"],
                    "analysis": cached["analysis"],
                    "sources": cached["sources"],
                    "createdAt": cached["createdAt"],
                    "cached": True,
                }
            )

        items = fetch_apify_items(profile_url, target.platform, target.username)
        if not items:
            raise ApiError("Profile data was not returned. Check the link and try again.", 502)

        account = normalize_account(items, profile_url, niche, target.platform, target.username)
        analysis, sources, analysis_model = generate_analysis(account, niche)
        run_id = save_analysis(user["id"], profile_url, niche, account, analysis, sources)

        return jsonify(
            {
                "id": run_id,
                "account": account,
                "analysis": analysis,
                "sources": sources,
                "createdAt": iso_now(),
                "analysisModel": analysis_model,
                "cached": False,
            }
        )


def create_app(overrides: dict[str, Any] | None = None) -> Flask:
    config = AppConfig.from_env(overrides)

    logging.basicConfig(
        level=logging.DEBUG if config.debug else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    app = Flask(__name__)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)  # type: ignore[assignment]
    app.config.update(
        APP_ENV=config.app_env,
        DATABASE_URL=config.database_url,
        SECRET_KEY=config.secret_key,
        FRONTEND_ORIGIN=config.frontend_origin,
        APIFY_TOKEN=config.apify_token,
        APIFY_INSTAGRAM_ACTOR_ID=config.apify_instagram_actor_id,
        APIFY_TIKTOK_ACTOR_ID=config.apify_tiktok_actor_id,
        GEMINI_API_KEY=config.gemini_api_key,
        GEMINI_MODEL=config.gemini_model,
        ANALYSIS_CACHE_TTL_MINUTES=config.analysis_cache_ttl_minutes,
        SESSION_TTL_HOURS=config.session_ttl_hours,
        ANALYSIS_LIMIT_PER_HOUR=config.analysis_limit_per_hour,
        AUTH_LIMIT_PER_15_MINUTES=config.auth_limit_per_15_min,
        PORT=config.port,
        HOST=config.host,
        DEBUG=config.debug,
        ENABLE_SEARCH_GROUNDING=config.enable_search_grounding,
    )

    database = Database(config.database_url)
    database.ensure_schema()
    app.extensions["database"] = database

    register_routes(app)
    return app


app = create_app()


if __name__ == "__main__":
    app.run(
        host=app.config["HOST"],
        port=app.config["PORT"],
        debug=app.config["DEBUG"],
    )
