from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re
import secrets
import sqlite3
import uuid
from collections import Counter, defaultdict
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

try:
    from flask_socketio import SocketIO, emit
except ModuleNotFoundError:
    SocketIO = None
    emit = None


DEFAULT_APIFY_INSTAGRAM_ACTOR_ID = "apify~instagram-scraper"
DEFAULT_APIFY_TIKTOK_ACTOR_ID = "clockworks~tiktok-profile-scraper"
APIFY_RUN_SYNC_URL = "https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_GEMINI_TREND_MODEL = DEFAULT_GEMINI_MODEL
DEFAULT_GEMINI_FALLBACK_MODELS = ("gemma-4-31b-it",)
DEFAULT_GEMINI_TREND_FALLBACK_MODELS = ("gemini-2.5-flash-lite", "gemini-2.0-flash")
DEFAULT_ANALYSIS_CACHE_TTL_MINUTES = 60
DEFAULT_SESSION_TTL_HOURS = 24
DEFAULT_ANALYSIS_LIMIT_PER_HOUR = 25
DEFAULT_AUTH_LIMIT_PER_15_MIN = 10
DEFAULT_ADMIN_SESSION_TTL_HOURS = 12
CACHE_SCHEMA_VERSION = "analysis-v2"
RETRYABLE_GEMINI_STATUS_CODES = {429, 500, 502, 503, 504}
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
TREND_PLATFORMS = {"tiktok", "instagram", "reels", "shorts", "youtube_shorts"}
TREND_SPEEDS = {"slow", "medium", "fast", "explosive"}
TREND_LIFECYCLE_STAGES = {"underground", "emerging", "breakout", "saturated", "dead"}
REMIX_FORMATS = {"auto", "expert_blog", "humor", "faceless", "storytelling", "educational"}


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


def parse_csv(value: Any) -> list[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


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


def is_local_development_origin(origin: str) -> bool:
    try:
        parsed = urlparse(origin)
    except ValueError:
        return False

    if parsed.scheme not in {"http", "https"}:
        return False

    hostname = (parsed.hostname or "").strip().lower()
    if hostname in {"localhost", "::1"}:
        return True

    try:
        ip_address = ipaddress.ip_address(hostname)
    except ValueError:
        return False

    return ip_address.is_loopback or ip_address.is_private or ip_address.is_link_local


def is_allowed_frontend_origin(origin: str) -> bool:
    normalized_origin = origin.rstrip("/")
    if normalized_origin in build_allowed_origins(current_app.config["FRONTEND_ORIGIN"]):
        return True
    return bool(current_app.config.get("ADMIN_ALLOW_LOCAL_ORIGINS")) and is_local_development_origin(normalized_origin)


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
    gemini_trend_model: str
    gemini_fallback_models: list[str]
    gemini_trend_fallback_models: list[str]
    analysis_cache_ttl_minutes: int
    session_ttl_hours: int
    analysis_limit_per_hour: int
    auth_limit_per_15_min: int
    admin_username: str
    admin_password: str
    admin_password_hash: str
    admin_allow_local_origins: bool
    admin_session_ttl_hours: int
    admin_session_cookie_name: str
    port: int
    host: str
    debug: bool
    enable_search_grounding: bool
    session_cookie_name: str
    session_cookie_secure: bool
    session_cookie_samesite: str

    @classmethod
    def from_env(cls, overrides: dict[str, Any] | None = None) -> "AppConfig":
        source = dict(os.environ)
        if overrides:
            source.update({key: value for key, value in overrides.items() if value is not None})

        app_env = str(source.get("APP_ENV", "development")).strip().lower()
        database_url = str(
            source.get("DATABASE_URL", "sqlite:///backend/data/ooppssie.db")
        ).strip()
        secret_key = str(source.get("SECRET_KEY", "dev-secret-change-me")).strip()
        frontend_origin = str(source.get("FRONTEND_ORIGIN", "http://127.0.0.1:3000")).strip()

        if app_env == "production":
            if not database_url.startswith("postgresql://") and not database_url.startswith("postgres://"):
                raise RuntimeError("Production requires PostgreSQL in DATABASE_URL.")
            if secret_key == "dev-secret-change-me":
                raise RuntimeError("Set a strong SECRET_KEY in production.")
            if not frontend_origin or "*" in frontend_origin:
                raise RuntimeError("Set explicit FRONTEND_ORIGIN values in production.")

        admin_username = str(source.get("ADMIN_USERNAME", "")).strip()
        admin_password = str(source.get("ADMIN_PASSWORD", "")).strip()
        admin_password_hash = str(source.get("ADMIN_PASSWORD_HASH", "")).strip()
        admin_allow_local_origins = parse_bool(
            source.get("ADMIN_ALLOW_LOCAL_ORIGINS"),
            app_env != "production",
        )
        if app_env == "production":
            if not admin_username:
                raise RuntimeError("Set ADMIN_USERNAME in production.")
            if not admin_password_hash:
                raise RuntimeError("Set ADMIN_PASSWORD_HASH in production.")
            if admin_password:
                raise RuntimeError("Do not set plaintext ADMIN_PASSWORD in production. Use ADMIN_PASSWORD_HASH.")

        return cls(
            app_env=app_env,
            database_url=database_url,
            secret_key=secret_key,
            frontend_origin=frontend_origin,
            apify_token=(source.get("APIFY_TOKEN") or "").strip() or None,
            apify_instagram_actor_id=str(
                source.get("APIFY_INSTAGRAM_ACTOR_ID", DEFAULT_APIFY_INSTAGRAM_ACTOR_ID)
            ).strip(),
            apify_tiktok_actor_id=str(
                source.get("APIFY_TIKTOK_ACTOR_ID", DEFAULT_APIFY_TIKTOK_ACTOR_ID)
            ).strip(),
            gemini_api_key=(source.get("GEMINI_API_KEY") or "").strip() or None,
            gemini_model=str(source.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)).strip(),
            gemini_trend_model=str(
                source.get("GEMINI_TREND_MODEL")
                or source.get("GEMINI_MODEL")
                or DEFAULT_GEMINI_TREND_MODEL
            ).strip(),
            gemini_fallback_models=parse_csv(
                source.get("GEMINI_FALLBACK_MODELS")
                or ",".join(DEFAULT_GEMINI_FALLBACK_MODELS)
            ),
            gemini_trend_fallback_models=parse_csv(
                source.get("GEMINI_TREND_FALLBACK_MODELS")
                or ",".join(DEFAULT_GEMINI_TREND_FALLBACK_MODELS)
            ),
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
            admin_username=admin_username,
            admin_password=admin_password,
            admin_password_hash=admin_password_hash,
            admin_allow_local_origins=admin_allow_local_origins,
            admin_session_ttl_hours=parse_int(
                source.get("ADMIN_SESSION_TTL_HOURS"), DEFAULT_ADMIN_SESSION_TTL_HOURS
            ),
            admin_session_cookie_name=str(
                source.get("ADMIN_SESSION_COOKIE_NAME", "ooppssie_admin_session")
            ).strip(),
            port=parse_int(source.get("PORT"), 5000),
            host=str(source.get("HOST", "0.0.0.0")).strip(),
            debug=parse_bool(source.get("DEBUG"), app_env != "production"),
            enable_search_grounding=parse_bool(source.get("ENABLE_SEARCH_GROUNDING"), True),
            session_cookie_name=str(source.get("SESSION_COOKIE_NAME", "ooppssie_session")).strip(),
            session_cookie_secure=parse_bool(source.get("SESSION_COOKIE_SECURE"), app_env == "production"),
            session_cookie_samesite=str(source.get("SESSION_COOKIE_SAMESITE", "Lax")).strip() or "Lax",
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
            CREATE TABLE IF NOT EXISTS admin_sessions (
                id TEXT PRIMARY KEY,
                token_hash TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                last_used_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS admin_analysis_logs (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
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
            """
            CREATE TABLE IF NOT EXISTS trends (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                platform TEXT NOT NULL,
                niche TEXT,
                country_origin TEXT DEFAULT 'US',
                source_url TEXT,
                video_preview_url TEXT,
                scout_comment TEXT,
                viral_score INTEGER DEFAULT 50,
                trend_speed TEXT DEFAULT 'medium',
                saturation_sng INTEGER DEFAULT 10,
                lifecycle_stage TEXT DEFAULT 'emerging',
                created_by_admin TEXT,
                created_at TEXT NOT NULL,
                is_active INTEGER DEFAULT 1
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS remixes (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                trend_id TEXT NOT NULL,
                format TEXT NOT NULL,
                result_payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
            "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth_sessions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_analysis_user_id_created_at ON analysis_runs(user_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_analysis_cache_key ON analysis_runs(cache_key)",
            "CREATE INDEX IF NOT EXISTS idx_analysis_created_at ON analysis_runs(created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash ON admin_sessions(token_hash)",
            "CREATE INDEX IF NOT EXISTS idx_admin_logs_run_id_created_at ON admin_analysis_logs(run_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_trends_lifecycle ON trends(lifecycle_stage, is_active, viral_score)",
        ]

        with self._lock:
            for statement in schema_statements:
                self.execute(statement)
            self.seed_preview_trends()

    def seed_preview_trends(self) -> None:
        existing = self.fetch_one("SELECT COUNT(*) AS total FROM trends")
        if parse_int(existing.get("total") if existing else 0, 0) > 0:
            return

        created_at = iso_now()
        preview_trends = [
            (
                "preview-founder-tabs",
                "Вкладки браузера как честный разбор стратегии",
                "Автор показывает 3-5 открытых вкладок и объясняет, что каждая говорит о текущем фокусе, ошибках и следующем шаге.",
                "reels",
                "стартапы, личный бренд, маркетинг",
                "US",
                "",
                "",
                "Цепляет конкретикой: зритель видит не общий совет, а реальный рабочий процесс автора.",
                86,
                "fast",
                22,
                "emerging",
                "seed",
                created_at,
                1,
            ),
            (
                "preview-receipt-ai",
                "AI-разбор бытовой траты за 20 секунд",
                "Короткий ролик превращает обычный чек, покупку или заказ в мини-кейс: что это говорит о привычках, бренде или рынке.",
                "tiktok",
                "финансы, lifestyle, образование",
                "US",
                "",
                "",
                "Формат легко адаптировать под разные ниши, а бытовой вход снижает порог внимания.",
                79,
                "medium",
                18,
                "underground",
                "seed",
                created_at,
                1,
            ),
        ]

        for trend in preview_trends:
            existing_trend = self.fetch_one("SELECT id FROM trends WHERE id = ? LIMIT 1", (trend[0],))
            if existing_trend:
                continue

            self.execute(
                """
                INSERT INTO trends (
                    id,
                    title,
                    description,
                    platform,
                    niche,
                    country_origin,
                    source_url,
                    video_preview_url,
                    scout_comment,
                    viral_score,
                    trend_speed,
                    saturation_sng,
                    lifecycle_stage,
                    created_by_admin,
                    created_at,
                    is_active
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                trend,
            )

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
    if auth_header.startswith("Bearer "):
        return auth_header.removeprefix("Bearer ").strip()

    cookie_token = flask_request.cookies.get(current_app.config["SESSION_COOKIE_NAME"], "").strip()
    if cookie_token:
        return cookie_token

    if not auth_header.startswith("Bearer "):
        raise ApiError("Требуется авторизация.", 401)
    return ""


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


def attach_session_cookie(response, token: str):
    response.set_cookie(
        current_app.config["SESSION_COOKIE_NAME"],
        token,
        max_age=current_app.config["SESSION_TTL_HOURS"] * 60 * 60,
        httponly=True,
        secure=current_app.config["SESSION_COOKIE_SECURE"],
        samesite=current_app.config["SESSION_COOKIE_SAMESITE"],
        path="/",
    )
    return response


def clear_session_cookie(response):
    response.delete_cookie(
        current_app.config["SESSION_COOKIE_NAME"],
        path="/",
        samesite=current_app.config["SESSION_COOKIE_SAMESITE"],
        secure=current_app.config["SESSION_COOKIE_SECURE"],
    )
    return response


def build_admin_csrf_token(token_hash: str) -> str:
    return hmac.new(
        current_app.config["SECRET_KEY"].encode("utf-8"),
        f"admin-csrf|{token_hash}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def admin_to_payload(session: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"username": current_app.config["ADMIN_USERNAME"]}
    if session:
        payload.update(
            {
                "sessionId": session["id"],
                "createdAt": session["created_at"],
                "expiresAt": session["expires_at"],
                "csrfToken": build_admin_csrf_token(session["token_hash"]),
            }
        )
    return payload


def create_admin_session() -> str:
    db = get_database()
    token = secrets.token_urlsafe(32)
    token_hash = hash_token(token)
    now = utc_now()
    expires_at = now + timedelta(hours=current_app.config["ADMIN_SESSION_TTL_HOURS"])

    db.execute(
        """
        INSERT INTO admin_sessions (id, token_hash, created_at, expires_at, last_used_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (str(uuid.uuid4()), token_hash, now.isoformat(), expires_at.isoformat(), now.isoformat()),
    )
    return token


def get_admin_token_from_request(required: bool = True) -> str:
    cookie_token = flask_request.cookies.get(current_app.config["ADMIN_SESSION_COOKIE_NAME"], "").strip()
    if cookie_token:
        return cookie_token

    if required:
        raise ApiError("Admin authorization is required.", 401)
    return ""


def get_admin_session_from_token(token: str, touch: bool = True) -> dict[str, Any]:
    if not token:
        raise ApiError("Admin authorization is required.", 401)

    token_hash = hash_token(token)
    db = get_database()
    session = db.fetch_one(
        "SELECT * FROM admin_sessions WHERE token_hash = ?",
        (token_hash,),
    )
    if not session:
        raise ApiError("Admin session was not found.", 401)

    expires_at = datetime.fromisoformat(session["expires_at"])
    if expires_at <= utc_now():
        db.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (token_hash,))
        raise ApiError("Admin session expired.", 401)

    if touch:
        db.execute(
            "UPDATE admin_sessions SET last_used_at = ? WHERE token_hash = ?",
            (iso_now(), token_hash),
        )

    return session


def require_admin_csrf(session: dict[str, Any]) -> None:
    require_admin_origin()
    submitted_token = flask_request.headers.get("X-CSRF-Token", "").strip()
    expected_token = build_admin_csrf_token(session["token_hash"])
    if not submitted_token or not secrets.compare_digest(submitted_token, expected_token):
        raise ApiError("Invalid admin CSRF token.", 403)


def require_admin_origin() -> None:
    if current_app.config.get("ADMIN_ALLOW_LOCAL_ORIGINS"):
        return

    origin = (flask_request.headers.get("Origin") or "").rstrip("/")
    if not origin:
        return
    if not is_allowed_frontend_origin(origin):
        raise ApiError("Admin request origin is not allowed.", 403)


def get_current_admin(require_csrf: bool = False) -> dict[str, Any]:
    if getattr(g, "current_admin", None):
        session = g.current_admin
    else:
        token = get_admin_token_from_request()
        session = get_admin_session_from_token(token)
        g.current_admin = session
        g.current_admin_token_hash = hash_token(token)

    if require_csrf:
        require_admin_csrf(session)
    return session


def logout_current_admin() -> None:
    token_hash = getattr(g, "current_admin_token_hash", None)
    if token_hash:
        get_database().execute("DELETE FROM admin_sessions WHERE token_hash = ?", (token_hash,))


def attach_admin_session_cookie(response, token: str):
    response.set_cookie(
        current_app.config["ADMIN_SESSION_COOKIE_NAME"],
        token,
        max_age=current_app.config["ADMIN_SESSION_TTL_HOURS"] * 60 * 60,
        httponly=True,
        secure=current_app.config["SESSION_COOKIE_SECURE"],
        samesite=current_app.config["SESSION_COOKIE_SAMESITE"],
        path="/",
    )
    return response


def clear_admin_session_cookie(response):
    response.delete_cookie(
        current_app.config["ADMIN_SESSION_COOKIE_NAME"],
        path="/",
        samesite=current_app.config["SESSION_COOKIE_SAMESITE"],
        secure=current_app.config["SESSION_COOKIE_SECURE"],
    )
    return response


def verify_admin_credentials(username: str, password: str) -> bool:
    expected_username = current_app.config["ADMIN_USERNAME"]
    if not expected_username or not secrets.compare_digest(username.strip(), expected_username):
        return False

    password_hash = current_app.config["ADMIN_PASSWORD_HASH"]
    if password_hash:
        return check_password_hash(password_hash, password)

    expected_password = current_app.config["ADMIN_PASSWORD"]
    return bool(expected_password) and secrets.compare_digest(password, expected_password)


def json_error(message: str, status_code: int, details: Any | None = None):
    payload: dict[str, Any] = {"error": message}
    if details is not None and status_code < 500:
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


def normalize_gemini_model_id(model: str | None) -> str:
    normalized = str(model or "").strip()
    return normalized.removeprefix("models/") or current_app.config["GEMINI_MODEL"]


def build_gemini_url(model: str | None = None) -> str:
    api_key = current_app.config["GEMINI_API_KEY"]
    if not api_key:
        raise ApiError("GEMINI_API_KEY is not configured on the server.", 500)
    model = normalize_gemini_model_id(model)
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


def build_trend_research_prompt(account: dict[str, Any], niche: str) -> str:
    platform = str(account.get("platform") or "social media")
    today = utc_now().date().isoformat()
    requested_niche = niche.strip() or "the profile's current niche"
    prompt_payload = {
        "currentDate": today,
        "platform": platform,
        "userProvidedNiche": requested_niche,
        "accountSignals": {
            "username": account.get("username"),
            "fullName": account.get("fullName"),
            "biography": account.get("biography"),
            "niche": account.get("niche"),
            "recentPosts": account.get("recentPosts", [])[:6],
            "followersCount": account.get("followersCount"),
            "postsCount": account.get("postsCount"),
        },
        "researchGoal": (
            "Use Google Search grounding actively to find the freshest short-form video trends available today. "
            "The user's requested niche is the target niche and must not be replaced by the account's existing topic. "
            f"Research current TikTok, Instagram Reels, YouTube Shorts, creator economy/news, meme formats, audio formats, "
            f"editing patterns, hooks, and recurring content structures from the last 7-14 days for this target niche: {requested_niche}. "
            "Use accountSignals only to judge applicability and adaptation difficulty for this specific account."
        ),
        "requirements": [
            "Return only valid JSON without markdown.",
            "Return exactly 8 trends.",
            "Each trend must be current, specific, actionable, and relevant to userProvidedNiche.",
            "Do not switch the target niche to the profile's detected topic even if the fit is poor.",
            "If the account and userProvidedNiche mismatch, adaptation must honestly explain the mismatch and how hard it is to bridge.",
            "Use type 'top' for currently dominant trends and 'growing' for fast-rising trends.",
            "Include freshnessWindow, evidence, and adaptation for every trend.",
            "Each sourceUrls item must be a URL string. Use sources discovered via Google Search grounding when possible.",
            (
                "Use this JSON shape only: "
                "{trends:[{type,title,description,freshnessWindow,evidence,adaptation,sourceUrls:[string]}],"
                "researchSummary:string}"
            ),
        ],
    }
    return json.dumps(prompt_payload, ensure_ascii=False)


def build_analysis_prompt(account: dict[str, Any], niche: str, trend_research: dict[str, Any] | None = None) -> str:
    platform = str(account.get("platform") or "social media")
    today = utc_now().date().isoformat()
    requested_niche = niche.strip() or "the profile's current niche"
    prompt_payload = {
        "currentDate": today,
        "account": account,
        "userProvidedNiche": requested_niche,
        "freshTrendResearch": trend_research or {},
        "analysisGoal": (
            f"Проанализируй {platform}-профиль, его позиционирование и контент-сигналы именно относительно userProvidedNiche. "
            "Не заменяй userProvidedNiche темой профиля. Если профиль о другой теме, явно оцени несоответствие и снизь совместимость. "
            "Сопоставь профиль с freshTrendResearch по userProvidedNiche: выбери самые свежие, доказуемые и применимые тренды, "
            f"которые работают на {today} для {platform}. "
            "Верни только валидный JSON на русском языке без markdown."
        ),
        "requirements": [
            "Profile summary must contain niche, compatibilityLabel, compatibilityScore, positioning, audienceSummary.",
            "profileSummary.niche must exactly equal userProvidedNiche, not the detected account topic.",
            "positioning and audienceSummary must explain fit or mismatch between the account and userProvidedNiche.",
            "Return exactly 4 trends.",
            "Return exactly 2 trends with type 'top' and 2 trends with type 'growing'.",
            "Select report trends from freshTrendResearch for userProvidedNiche unless there is a clear account-fit reason to exclude one.",
            "Trend descriptions must explain why the trend is fresh now and whether this profile can credibly use it for userProvidedNiche.",
            "Return exactly 3 ideas.",
            "Return exactly 6 hooks.",
            "Ideas, hooks, and recommendations must target userProvidedNiche, while honestly accounting for the account's current positioning.",
            "If compatibilityScore is below 30, ideas must be repositioning/bridge experiments rather than pretending the account already fits the niche.",
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


def strip_json_code_fence(text: str) -> str:
    cleaned = text.strip()
    fence_match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.IGNORECASE | re.DOTALL)
    if fence_match:
        return fence_match.group(1).strip()
    return cleaned


def extract_json_object(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue

        try:
            payload, _end = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue

        if isinstance(payload, dict):
            return payload

    raise json.JSONDecodeError("No JSON object found", text, 0)


def parse_json_response_text(text: str) -> dict[str, Any]:
    cleaned = strip_json_code_fence(text)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        try:
            return extract_json_object(cleaned)
        except json.JSONDecodeError:
            raise UpstreamServiceError("AI returned an invalid JSON payload.", 502) from exc


def source_from_url(url: Any) -> dict[str, str] | None:
    normalized_url = str(url or "").strip()
    parsed = urlparse(normalized_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return {"title": parsed.netloc, "url": normalized_url}


def merge_sources(*source_groups: list[dict[str, str]]) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    seen: set[str] = set()
    for sources in source_groups:
        for source in sources:
            url = str(source.get("url") or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            merged.append(
                {
                    "title": str(source.get("title") or url).strip(),
                    "url": url,
                }
            )
    return merged


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


def build_gemini_attempts(primary_model: str, fallback_models: list[str] | None = None) -> list[str]:
    attempts: list[str] = []
    for model in [primary_model, *(fallback_models or [])]:
        normalized = normalize_gemini_model_id(model)
        if normalized and normalized not in attempts:
            attempts.append(normalized)
    return attempts


def model_supports_search_grounding(model: str) -> bool:
    return not normalize_gemini_model_id(model).startswith("gemma-")


def build_gemini_payload(
    prompt: str,
    use_search_grounding: bool,
    response_mime_type: str | None = None,
) -> dict[str, Any]:
    generation_config: dict[str, Any] = {"temperature": 0.45}
    if response_mime_type:
        generation_config["responseMimeType"] = response_mime_type

    payload: dict[str, Any] = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": generation_config,
    }
    if use_search_grounding:
        payload["tools"] = [{"google_search": {}}]
    return payload


def request_gemini_generate(
    prompt: str,
    model: str,
    use_search_grounding: bool,
    response_mime_type: str | None = None,
) -> dict[str, Any]:
    gemini_request = request.Request(
        build_gemini_url(model),
        data=json.dumps(build_gemini_payload(prompt, use_search_grounding, response_mime_type)).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with request.urlopen(gemini_request, timeout=120) as response:
        raw_body = response.read().decode("utf-8")
        return json.loads(raw_body)


def gemini_error_message(status_code: int, fallback_was_attempted: bool) -> str:
    if status_code in {429, 503}:
        if fallback_was_attempted:
            return "AI-сервис сейчас перегружен, резервная модель тоже не ответила. Попробуйте через пару минут."
        return "AI-сервис сейчас перегружен. Попробуйте повторить анализ через пару минут."
    return "Не удалось завершить AI-анализ. Попробуйте позже."


def call_gemini_generate(
    prompt: str,
    model: str,
    use_search_grounding: bool,
    fallback_models: list[str] | None = None,
    response_mime_type: str | None = None,
) -> tuple[dict[str, Any], str]:
    attempts = build_gemini_attempts(model, fallback_models)
    fallback_was_attempted = len(attempts) > 1
    last_http_error: tuple[int, str] | None = None

    for index, attempted_model in enumerate(attempts):
        attempted_grounding = use_search_grounding and model_supports_search_grounding(attempted_model)
        attempted_response_mime_type = (
            response_mime_type if not normalize_gemini_model_id(attempted_model).startswith("gemma-") else None
        )

        try:
            return request_gemini_generate(
                prompt,
                attempted_model,
                attempted_grounding,
                attempted_response_mime_type,
            ), attempted_model
        except error.HTTPError as exc:
            raw_error = exc.read().decode("utf-8", errors="replace")
            last_http_error = (exc.code, raw_error or "Gemini request failed.")
            can_try_fallback = exc.code in RETRYABLE_GEMINI_STATUS_CODES and index < len(attempts) - 1
            if can_try_fallback:
                current_app.logger.warning(
                    "Gemini model %s failed with HTTP %s. Trying fallback model %s.",
                    attempted_model,
                    exc.code,
                    attempts[index + 1],
                )
                continue

            raise UpstreamServiceError(
                gemini_error_message(exc.code, fallback_was_attempted),
                exc.code,
                raw_error or "Gemini request failed.",
            ) from exc
        except error.URLError as exc:
            can_try_fallback = index < len(attempts) - 1
            if can_try_fallback:
                current_app.logger.warning(
                    "Gemini model %s is unavailable. Trying fallback model %s.",
                    attempted_model,
                    attempts[index + 1],
                )
                continue

            raise UpstreamServiceError(
                "AI-сервис временно недоступен. Попробуйте позже.",
                502,
                str(exc.reason),
            ) from exc
        except json.JSONDecodeError as exc:
            can_try_fallback = index < len(attempts) - 1
            if can_try_fallback:
                current_app.logger.warning(
                    "Gemini model %s returned invalid JSON. Trying fallback model %s.",
                    attempted_model,
                    attempts[index + 1],
                )
                continue

            raise UpstreamServiceError("AI-сервис вернул некорректный ответ. Попробуйте ещё раз.", 502) from exc

    status_code, raw_error = last_http_error or (502, "Gemini request failed.")
    raise UpstreamServiceError(gemini_error_message(status_code, fallback_was_attempted), status_code, raw_error)


def normalize_trend_research(research_payload: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, str]]]:
    trends = research_payload.get("trends")
    if not isinstance(trends, list) or len(trends) < 4:
        raise UpstreamServiceError("AI returned an invalid trend research block.", 502)

    normalized_trends: list[dict[str, Any]] = []
    sources: list[dict[str, str]] = []
    for item in trends[:8]:
        if not isinstance(item, dict):
            continue

        source_urls = item.get("sourceUrls")
        if not isinstance(source_urls, list):
            source_urls = []

        normalized_source_urls: list[str] = []
        for url in source_urls:
            source = source_from_url(url)
            if not source:
                continue
            normalized_source_urls.append(source["url"])
            sources.append(source)

        normalized_trends.append(
            {
                "type": normalize_trend_type(item.get("type")) or "growing",
                "title": str(item.get("title", "")).strip(),
                "description": str(item.get("description", "")).strip(),
                "freshnessWindow": str(item.get("freshnessWindow", "")).strip(),
                "evidence": str(item.get("evidence", "")).strip(),
                "adaptation": str(item.get("adaptation", "")).strip(),
                "sourceUrls": normalized_source_urls,
            }
        )

    if len(normalized_trends) < 4:
        raise UpstreamServiceError("AI returned too few usable trend research items.", 502)

    return (
        {
            "trends": normalized_trends,
            "researchSummary": str(research_payload.get("researchSummary", "")).strip(),
            "researchedAt": iso_now(),
        },
        sources,
    )


def research_fresh_trends(account: dict[str, Any], niche: str) -> tuple[dict[str, Any], list[dict[str, str]]]:
    if not current_app.config["ENABLE_SEARCH_GROUNDING"]:
        return {"trends": [], "researchSummary": "", "researchedAt": iso_now()}, []

    response_payload, _model_used = call_gemini_generate(
        build_trend_research_prompt(account, niche),
        current_app.config["GEMINI_TREND_MODEL"],
        True,
        current_app.config["GEMINI_TREND_FALLBACK_MODELS"],
    )
    research_payload = parse_json_response_text(extract_text_parts(response_payload))
    research, explicit_sources = normalize_trend_research(research_payload)
    return research, merge_sources(extract_grounding_sources(response_payload), explicit_sources)


def ensure_analysis_shape(analysis: dict[str, Any], requested_niche: str = "") -> dict[str, Any]:
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
    final_niche = requested_niche.strip() or str(profile_summary["niche"])

    return {
        "profileSummary": {
            "niche": final_niche,
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
    trend_research, trend_sources = research_fresh_trends(account, niche)
    response_payload, analysis_model = call_gemini_generate(
        build_analysis_prompt(account, niche, trend_research),
        current_app.config["GEMINI_MODEL"],
        current_app.config["ENABLE_SEARCH_GROUNDING"],
        current_app.config["GEMINI_FALLBACK_MODELS"],
    )

    analysis_payload = parse_json_response_text(extract_text_parts(response_payload))
    if "account" not in analysis_payload:
        analysis_payload["account"] = account
    analysis = ensure_analysis_shape(analysis_payload, niche)
    sources = merge_sources(trend_sources, extract_grounding_sources(response_payload))
    return analysis, sources, analysis_model


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
    admin_payload = get_admin_analysis_detail(run_id)
    if admin_payload:
        emit_admin_realtime("analysis_created", admin_payload)
        emit_admin_realtime("snapshot", build_admin_overview())
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
                "niche": row["niche"] or analysis.get("profileSummary", {}).get("niche", ""),
                "compatibilityScore": analysis.get("profileSummary", {}).get("compatibilityScore"),
                "createdAt": row["created_at"],
            }
        )
    return items


def delete_user_analyses(user_id: str) -> int:
    db = get_database()
    row = db.fetch_one(
        "SELECT COUNT(*) AS total FROM analysis_runs WHERE user_id = ?",
        (user_id,),
    )
    deleted_count = int(row["total"]) if row else 0
    db.execute("DELETE FROM analysis_runs WHERE user_id = ?", (user_id,))
    if deleted_count:
        emit_admin_realtime(
            "analyses_deleted",
            {"userId": user_id, "deletedCount": deleted_count, "createdAt": iso_now()},
        )
        emit_admin_realtime("snapshot", build_admin_overview())
    return deleted_count


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


def safe_json_loads(raw_value: Any, fallback: Any) -> Any:
    try:
        return json.loads(raw_value) if raw_value else fallback
    except (TypeError, json.JSONDecodeError):
        return fallback


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def numeric_value(value: Any) -> int:
    parsed = to_int(value)
    return parsed if parsed is not None else 0


def parse_datetime(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def row_created_at(row_or_item: dict[str, Any]) -> datetime:
    parsed = parse_datetime(row_or_item.get("created_at") or row_or_item.get("createdAt"))
    return parsed or datetime.fromtimestamp(0, timezone.utc)


def source_label(source: dict[str, Any]) -> str:
    title = str(source.get("title") or "").strip()
    url = str(source.get("url") or "").strip()
    if title:
        return title[:120]
    try:
        return urlparse(url).hostname or url
    except ValueError:
        return url[:120] or "Unknown source"


def fetch_admin_analysis_rows() -> list[dict[str, Any]]:
    return get_database().fetch_all(
        """
        SELECT
            analysis_runs.id,
            analysis_runs.user_id,
            analysis_runs.profile_url,
            analysis_runs.niche,
            analysis_runs.account_payload,
            analysis_runs.analysis_payload,
            analysis_runs.sources_payload,
            analysis_runs.created_at,
            analysis_runs.cache_key,
            users.email AS user_email,
            users.display_name AS user_display_name,
            users.created_at AS user_created_at
        FROM analysis_runs
        JOIN users ON users.id = analysis_runs.user_id
        ORDER BY analysis_runs.created_at DESC
        """
    )


def admin_logs_by_run_ids(run_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not run_ids:
        return {}

    placeholders = ", ".join("?" for _ in run_ids)
    rows = get_database().fetch_all(
        f"""
        SELECT id, run_id, message, created_at
        FROM admin_analysis_logs
        WHERE run_id IN ({placeholders})
        ORDER BY created_at DESC
        """,
        tuple(run_ids),
    )
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row["run_id"]].append(
            {
                "id": row["id"],
                "runId": row["run_id"],
                "message": row["message"],
                "createdAt": row["created_at"],
            }
        )
    return grouped


def admin_analysis_to_payload(
    row: dict[str, Any],
    include_payload: bool = False,
    logs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    account = as_dict(safe_json_loads(row.get("account_payload"), {}))
    analysis = as_dict(safe_json_loads(row.get("analysis_payload"), {}))
    sources = as_list(safe_json_loads(row.get("sources_payload"), []))
    profile_summary = as_dict(analysis.get("profileSummary"))
    recommendations = as_dict(analysis.get("recommendations"))
    trends = as_list(analysis.get("trends"))
    ideas = as_list(analysis.get("ideas"))
    hooks = as_list(analysis.get("hooks"))
    recent_posts = as_list(account.get("recentPosts"))
    username = str(account.get("username") or extract_username_from_profile_url(row["profile_url"]) or "").strip()
    niche = str(row.get("niche") or profile_summary.get("niche") or account.get("niche") or "").strip()
    compatibility_score = parse_score(profile_summary.get("compatibilityScore"))
    total_likes = sum(numeric_value(as_dict(post).get("likesCount")) for post in recent_posts)
    total_comments = sum(numeric_value(as_dict(post).get("commentsCount")) for post in recent_posts)
    total_views = sum(numeric_value(as_dict(post).get("videoViewCount")) for post in recent_posts)
    log_items = logs or []

    payload: dict[str, Any] = {
        "id": row["id"],
        "user": {
            "id": row["user_id"],
            "email": row.get("user_email", ""),
            "displayName": row.get("user_display_name", ""),
            "createdAt": row.get("user_created_at", ""),
        },
        "profileUrl": row["profile_url"],
        "username": username,
        "profileName": str(account.get("fullName") or username),
        "platform": str(account.get("platform") or "Unknown"),
        "profilePicUrl": str(account.get("profilePicUrl") or ""),
        "biography": str(account.get("biography") or ""),
        "niche": niche,
        "followersCount": account.get("followersCount"),
        "followsCount": account.get("followsCount"),
        "postsCount": account.get("postsCount"),
        "isVerified": bool(account.get("isVerified")),
        "isPrivate": bool(account.get("isPrivate")),
        "compatibilityLabel": str(profile_summary.get("compatibilityLabel") or ""),
        "compatibilityScore": compatibility_score,
        "positioning": str(profile_summary.get("positioning") or ""),
        "audienceSummary": str(profile_summary.get("audienceSummary") or ""),
        "trendsCount": len(trends),
        "ideasCount": len(ideas),
        "hooksCount": len(hooks),
        "recommendationsCount": len(as_list(recommendations.get("bullets"))),
        "sourcesCount": len(sources),
        "recentPostsCount": len(recent_posts),
        "totalLikes": total_likes,
        "totalComments": total_comments,
        "totalViews": total_views,
        "logsCount": len(log_items),
        "createdAt": row["created_at"],
        "cacheKey": row.get("cache_key", ""),
    }

    if include_payload:
        payload.update(
            {
                "account": account,
                "analysis": analysis,
                "sources": sources,
                "logs": log_items,
            }
        )

    return payload


def extract_username_from_profile_url(profile_url: str) -> str:
    try:
        parts = [part for part in urlparse(profile_url).path.split("/") if part]
    except ValueError:
        return ""
    if not parts:
        return ""
    return parts[0].removeprefix("@")


def parse_admin_filters() -> dict[str, Any]:
    args = flask_request.args
    return {
        "q": str(args.get("q", "")).strip().lower(),
        "platform": str(args.get("platform", "")).strip().lower(),
        "niche": str(args.get("niche", "")).strip().lower(),
        "user": str(args.get("user", "")).strip().lower(),
        "scoreMin": parse_score(args.get("scoreMin")),
        "scoreMax": parse_score(args.get("scoreMax")),
        "dateFrom": parse_datetime(args.get("dateFrom")),
        "dateTo": parse_datetime(args.get("dateTo")),
        "sort": str(args.get("sort", "newest")).strip().lower(),
        "limit": min(max(parse_int(args.get("limit"), 100), 1), 500),
        "offset": max(parse_int(args.get("offset"), 0), 0),
    }


def admin_item_matches_filters(item: dict[str, Any], filters: dict[str, Any]) -> bool:
    query = filters.get("q", "")
    if query:
        haystack = " ".join(
            str(value or "")
            for value in (
                item.get("profileUrl"),
                item.get("username"),
                item.get("profileName"),
                item.get("platform"),
                item.get("niche"),
                item.get("biography"),
                item.get("compatibilityLabel"),
                item.get("positioning"),
                item.get("audienceSummary"),
                item.get("user", {}).get("email"),
                item.get("user", {}).get("displayName"),
            )
        ).lower()
        if query not in haystack:
            return False

    platform = filters.get("platform", "")
    if platform and platform != "all" and str(item.get("platform", "")).lower() != platform:
        return False

    niche = filters.get("niche", "")
    if niche and niche not in str(item.get("niche", "")).lower():
        return False

    user = filters.get("user", "")
    if user:
        user_payload = item.get("user", {})
        user_haystack = f"{user_payload.get('email', '')} {user_payload.get('displayName', '')}".lower()
        if user not in user_haystack:
            return False

    score = item.get("compatibilityScore")
    score_min = filters.get("scoreMin")
    score_max = filters.get("scoreMax")
    if score_min is not None and (score is None or score < score_min):
        return False
    if score_max is not None and (score is None or score > score_max):
        return False

    created_at = parse_datetime(item.get("createdAt"))
    if filters.get("dateFrom") and (created_at is None or created_at < filters["dateFrom"]):
        return False
    if filters.get("dateTo") and (created_at is None or created_at > filters["dateTo"]):
        return False

    return True


def sort_admin_items(items: list[dict[str, Any]], sort_key: str) -> list[dict[str, Any]]:
    if sort_key == "score-high":
        return sorted(items, key=lambda item: item.get("compatibilityScore") or -1, reverse=True)
    if sort_key == "score-low":
        return sorted(items, key=lambda item: item.get("compatibilityScore") if item.get("compatibilityScore") is not None else 101)
    if sort_key == "followers-high":
        return sorted(items, key=lambda item: numeric_value(item.get("followersCount")), reverse=True)
    if sort_key == "username":
        return sorted(items, key=lambda item: str(item.get("username", "")).lower())
    return sorted(items, key=row_created_at, reverse=True)


def get_admin_analyses_payload(filters: dict[str, Any] | None = None) -> dict[str, Any]:
    filters = filters or {
        "q": "",
        "platform": "",
        "niche": "",
        "user": "",
        "scoreMin": None,
        "scoreMax": None,
        "dateFrom": None,
        "dateTo": None,
        "sort": "newest",
        "limit": 100,
        "offset": 0,
    }
    rows = fetch_admin_analysis_rows()
    log_counts = admin_logs_by_run_ids([row["id"] for row in rows])
    items = [
        admin_analysis_to_payload(row, include_payload=False, logs=log_counts.get(row["id"], []))
        for row in rows
    ]
    filtered_items = [item for item in items if admin_item_matches_filters(item, filters)]
    sorted_items = sort_admin_items(filtered_items, filters.get("sort", "newest"))
    offset = filters.get("offset", 0)
    limit = filters.get("limit", 100)

    return {
        "items": sorted_items[offset : offset + limit],
        "total": len(filtered_items),
        "limit": limit,
        "offset": offset,
    }


def counter_items(counter: Counter[str], limit: int = 10, rare: bool = False) -> list[dict[str, Any]]:
    values = [(label, count) for label, count in counter.items() if label and count > 0]
    values.sort(key=lambda item: (item[1], item[0].lower()) if rare else (-item[1], item[0].lower()))
    return [{"label": label, "value": count} for label, count in values[:limit]]


def build_admin_overview(filters: dict[str, Any] | None = None) -> dict[str, Any]:
    rows = fetch_admin_analysis_rows()
    logs = admin_logs_by_run_ids([row["id"] for row in rows])
    items = [admin_analysis_to_payload(row, logs=logs.get(row["id"], [])) for row in rows]
    now = utc_now()
    scores = [item["compatibilityScore"] for item in items if item.get("compatibilityScore") is not None]
    user_rows = get_database().fetch_all("SELECT id, email, display_name, created_at FROM users ORDER BY created_at DESC")

    platform_counter: Counter[str] = Counter()
    niche_counter: Counter[str] = Counter()
    profile_counter: Counter[str] = Counter()
    user_counter: Counter[str] = Counter()
    user_id_counter: Counter[str] = Counter()
    trend_counter: Counter[str] = Counter()
    hook_counter: Counter[str] = Counter()
    source_counter: Counter[str] = Counter()
    score_buckets: Counter[str] = Counter({"0-20": 0, "21-40": 0, "41-60": 0, "61-80": 0, "81-100": 0})
    daily_counter: Counter[str] = Counter()
    hourly_counter: Counter[str] = Counter()

    daily_keys = []
    for days_back in range(13, -1, -1):
        key = (now - timedelta(days=days_back)).date().isoformat()
        daily_counter[key] = 0
        daily_keys.append(key)

    hourly_keys = []
    current_hour = now.replace(minute=0, second=0, microsecond=0)
    for hours_back in range(23, -1, -1):
        key = (current_hour - timedelta(hours=hours_back)).isoformat()
        hourly_counter[key] = 0
        hourly_keys.append(key)

    for row, item in zip(rows, items):
        account = as_dict(safe_json_loads(row.get("account_payload"), {}))
        analysis = as_dict(safe_json_loads(row.get("analysis_payload"), {}))
        sources = as_list(safe_json_loads(row.get("sources_payload"), []))
        created_at = row_created_at(item)
        platform_counter[item.get("platform") or "Unknown"] += 1
        niche_counter[item.get("niche") or "Без ниши"] += 1
        profile_label = f"@{item.get('username')}" if item.get("username") else item.get("profileUrl", "Unknown")
        profile_counter[str(profile_label)] += 1
        user_payload = item.get("user", {})
        user_label = str(user_payload.get("displayName") or user_payload.get("email") or "Unknown user")
        user_counter[user_label] += 1
        user_id_counter[str(user_payload.get("id") or "")] += 1

        score = item.get("compatibilityScore")
        if isinstance(score, int):
            if score <= 20:
                score_buckets["0-20"] += 1
            elif score <= 40:
                score_buckets["21-40"] += 1
            elif score <= 60:
                score_buckets["41-60"] += 1
            elif score <= 80:
                score_buckets["61-80"] += 1
            else:
                score_buckets["81-100"] += 1

        date_key = created_at.date().isoformat()
        if date_key in daily_counter:
            daily_counter[date_key] += 1
        hour_key = created_at.replace(minute=0, second=0, microsecond=0).isoformat()
        if hour_key in hourly_counter:
            hourly_counter[hour_key] += 1

        for trend in as_list(analysis.get("trends")):
            title = str(as_dict(trend).get("title") or "").strip()
            if title:
                trend_counter[title[:140]] += 1

        for hook in as_list(analysis.get("hooks")):
            hook_text = str(hook).strip()
            if hook_text:
                hook_counter[hook_text[:160]] += 1

        for source in sources:
            if isinstance(source, dict):
                source_counter[source_label(source)] += 1

    analyses_payload = get_admin_analyses_payload(filters)

    return {
        "generatedAt": iso_now(),
        "realtimeAvailable": SocketIO is not None,
        "summary": {
            "totalUsers": len(user_rows),
            "totalAnalyses": len(items),
            "totalLogs": sum(len(value) for value in logs.values()),
            "uniqueProfiles": len({item.get("profileUrl") for item in items if item.get("profileUrl")}),
            "analysesLast24h": sum(1 for item in items if now - row_created_at(item) <= timedelta(hours=24)),
            "analysesLast7d": sum(1 for item in items if now - row_created_at(item) <= timedelta(days=7)),
            "averageCompatibility": round(sum(scores) / len(scores)) if scores else 0,
            "totalSources": sum(item.get("sourcesCount", 0) for item in items),
            "totalHooks": sum(item.get("hooksCount", 0) for item in items),
            "totalIdeas": sum(item.get("ideasCount", 0) for item in items),
            "totalTrends": sum(item.get("trendsCount", 0) for item in items),
        },
        "charts": {
            "platforms": counter_items(platform_counter, limit=8),
            "scoreBuckets": [{"label": label, "value": score_buckets[label]} for label in score_buckets],
            "dailyAnalyses": [{"label": key, "value": daily_counter[key]} for key in daily_keys],
            "hourlyAnalyses": [{"label": key, "value": hourly_counter[key]} for key in hourly_keys],
        },
        "rankings": {
            "topNiches": counter_items(niche_counter, limit=12),
            "rareNiches": counter_items(niche_counter, limit=12, rare=True),
            "topProfiles": counter_items(profile_counter, limit=12),
            "rareProfiles": counter_items(profile_counter, limit=12, rare=True),
            "topUsers": counter_items(user_counter, limit=12),
            "topTrends": counter_items(trend_counter, limit=12),
            "rareTrends": counter_items(trend_counter, limit=12, rare=True),
            "topHooks": counter_items(hook_counter, limit=12),
            "rareHooks": counter_items(hook_counter, limit=12, rare=True),
            "topSources": counter_items(source_counter, limit=12),
            "rareSources": counter_items(source_counter, limit=12, rare=True),
        },
        "users": [
            {
                "id": row["id"],
                "email": row["email"],
                "displayName": row["display_name"],
                "createdAt": row["created_at"],
                "analysesCount": user_id_counter.get(row["id"], 0),
            }
            for row in user_rows
        ],
        "analyses": analyses_payload,
    }


def get_admin_analysis_detail(run_id: str) -> dict[str, Any] | None:
    row = get_database().fetch_one(
        """
        SELECT
            analysis_runs.id,
            analysis_runs.user_id,
            analysis_runs.profile_url,
            analysis_runs.niche,
            analysis_runs.account_payload,
            analysis_runs.analysis_payload,
            analysis_runs.sources_payload,
            analysis_runs.created_at,
            analysis_runs.cache_key,
            users.email AS user_email,
            users.display_name AS user_display_name,
            users.created_at AS user_created_at
        FROM analysis_runs
        JOIN users ON users.id = analysis_runs.user_id
        WHERE analysis_runs.id = ?
        LIMIT 1
        """,
        (run_id,),
    )
    if not row:
        return None
    return admin_analysis_to_payload(
        row,
        include_payload=True,
        logs=admin_logs_by_run_ids([run_id]).get(run_id, []),
    )


def create_admin_analysis_log(run_id: str, message: str) -> dict[str, Any]:
    if not get_admin_analysis_detail(run_id):
        raise ApiError("Analysis not found.", 404)

    cleaned_message = message.strip()
    if not cleaned_message:
        raise ApiError("Log message cannot be empty.", 400)
    if len(cleaned_message) > 2000:
        raise ApiError("Log message is too long.", 400)

    log_id = str(uuid.uuid4())
    created_at = iso_now()
    get_database().execute(
        """
        INSERT INTO admin_analysis_logs (id, run_id, message, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (log_id, run_id, cleaned_message, created_at),
    )
    log_payload = {"id": log_id, "runId": run_id, "message": cleaned_message, "createdAt": created_at}
    emit_admin_realtime("analysis_logged", {"runId": run_id, "log": log_payload})
    emit_admin_realtime("snapshot", build_admin_overview())
    return log_payload


def trend_to_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "platform": row["platform"],
        "niche": row.get("niche") or "",
        "countryOrigin": row.get("country_origin") or "US",
        "sourceUrl": row.get("source_url") or "",
        "videoPreviewUrl": row.get("video_preview_url") or "",
        "scoutComment": row.get("scout_comment") or "",
        "viralScore": parse_int(row.get("viral_score"), 50),
        "trendSpeed": row.get("trend_speed") or "medium",
        "saturationSng": parse_int(row.get("saturation_sng"), 10),
        "lifecycleStage": row.get("lifecycle_stage") or "emerging",
        "createdByAdmin": row.get("created_by_admin") or "",
        "createdAt": row["created_at"],
        "isActive": bool(row.get("is_active")),
    }


def get_payload_value(payload: dict[str, Any], snake_key: str, camel_key: str | None = None, default: Any = None) -> Any:
    if snake_key in payload:
        return payload.get(snake_key)
    if camel_key and camel_key in payload:
        return payload.get(camel_key)
    return default


def validate_required_text(value: Any, field_name: str, min_length: int = 1, max_length: int = 1000) -> str:
    text = str(value or "").strip()
    if len(text) < min_length or len(text) > max_length:
        raise ApiError(f"{field_name} must be between {min_length} and {max_length} characters.", 400)
    return text


def validate_optional_text(value: Any, max_length: int = 1000) -> str:
    return str(value or "").strip()[:max_length]


def validate_choice(value: Any, allowed_values: set[str], field_name: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in allowed_values:
        raise ApiError(f"{field_name} is invalid.", 400)
    return normalized


def validate_percent(value: Any, field_name: str, default: int) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        raise ApiError(f"{field_name} must be an integer from 0 to 100.", 400)
    try:
        parsed_value = int(value)
    except (TypeError, ValueError):
        raise ApiError(f"{field_name} must be an integer from 0 to 100.", 400) from None
    if parsed_value < 0 or parsed_value > 100:
        raise ApiError(f"{field_name} must be an integer from 0 to 100.", 400)
    return parsed_value


def validate_active_flag(value: Any) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    if value in (0, 1, "0", "1"):
        return int(value)
    raise ApiError("is_active is invalid.", 400)


def create_admin_trend(payload: dict[str, Any], admin_session: dict[str, Any]) -> dict[str, Any]:
    trend_id = str(uuid.uuid4())
    created_at = iso_now()
    title = validate_required_text(get_payload_value(payload, "title"), "title", 3, 200)
    description = validate_required_text(get_payload_value(payload, "description"), "description", 3, 1400)
    platform = validate_choice(get_payload_value(payload, "platform"), TREND_PLATFORMS, "platform")
    lifecycle_stage = validate_choice(
        get_payload_value(payload, "lifecycle_stage", "lifecycleStage", "emerging"),
        TREND_LIFECYCLE_STAGES,
        "lifecycle_stage",
    )
    trend_speed = validate_choice(
        get_payload_value(payload, "trend_speed", "trendSpeed", "medium"),
        TREND_SPEEDS,
        "trend_speed",
    )
    viral_score = validate_percent(get_payload_value(payload, "viral_score", "viralScore", 50), "viral_score", 50)
    saturation_sng = validate_percent(
        get_payload_value(payload, "saturation_sng", "saturationSng", 10),
        "saturation_sng",
        10,
    )
    created_by_admin = current_app.config.get("ADMIN_USERNAME") or admin_session.get("id") or "admin"

    get_database().execute(
        """
        INSERT INTO trends (
            id,
            title,
            description,
            platform,
            niche,
            country_origin,
            source_url,
            video_preview_url,
            scout_comment,
            viral_score,
            trend_speed,
            saturation_sng,
            lifecycle_stage,
            created_by_admin,
            created_at,
            is_active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            trend_id,
            title,
            description,
            platform,
            validate_optional_text(get_payload_value(payload, "niche"), 240),
            validate_optional_text(get_payload_value(payload, "country_origin", "countryOrigin", "US"), 64) or "US",
            validate_optional_text(get_payload_value(payload, "source_url", "sourceUrl"), 1000),
            validate_optional_text(get_payload_value(payload, "video_preview_url", "videoPreviewUrl"), 1000),
            validate_optional_text(get_payload_value(payload, "scout_comment", "scoutComment"), 2000),
            viral_score,
            trend_speed,
            saturation_sng,
            lifecycle_stage,
            created_by_admin,
            created_at,
            1,
        ),
    )

    created_trend = get_trend_by_id(trend_id)
    if not created_trend:
        raise ApiError("Trend was not created.", 500)
    return created_trend


def build_trend_filters(include_feed_rules: bool = False) -> tuple[str, list[Any]]:
    conditions: list[str] = []
    params: list[Any] = []

    platform = str(flask_request.args.get("platform", "")).strip().lower()
    if platform and platform != "all":
        if platform not in TREND_PLATFORMS:
            raise ApiError("platform is invalid.", 400)
        conditions.append("platform = ?")
        params.append(platform)

    lifecycle_stage = str(flask_request.args.get("lifecycle_stage", "")).strip().lower()
    if lifecycle_stage:
        if lifecycle_stage not in TREND_LIFECYCLE_STAGES:
            raise ApiError("lifecycle_stage is invalid.", 400)
        conditions.append("lifecycle_stage = ?")
        params.append(lifecycle_stage)

    query = str(flask_request.args.get("q", "")).strip().lower()
    if query:
        like_query = f"%{query}%"
        conditions.append(
            "(LOWER(title) LIKE ? OR LOWER(COALESCE(niche, '')) LIKE ? OR LOWER(description) LIKE ?)"
        )
        params.extend([like_query, like_query, like_query])

    if include_feed_rules:
        conditions.append("is_active = 1")
        conditions.append("lifecycle_stage NOT IN ('saturated', 'dead')")

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    return where_clause, params


def get_admin_trends_payload() -> dict[str, Any]:
    limit = min(max(parse_int(flask_request.args.get("limit"), 50), 1), 200)
    offset = max(parse_int(flask_request.args.get("offset"), 0), 0)
    where_clause, params = build_trend_filters()
    db = get_database()
    total_row = db.fetch_one(f"SELECT COUNT(*) AS total FROM trends {where_clause}", tuple(params))
    rows = db.fetch_all(
        f"""
        SELECT *
        FROM trends
        {where_clause}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        """,
        tuple([*params, limit, offset]),
    )

    return {
        "items": [trend_to_payload(row) for row in rows],
        "total": parse_int(total_row.get("total") if total_row else 0, 0),
        "limit": limit,
        "offset": offset,
    }


def get_trend_by_id(trend_id: str) -> dict[str, Any] | None:
    row = get_database().fetch_one("SELECT * FROM trends WHERE id = ? LIMIT 1", (trend_id,))
    return trend_to_payload(row) if row else None


def update_admin_trend(trend_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not get_trend_by_id(trend_id):
        raise ApiError("Trend not found.", 404)

    updates: list[str] = []
    params: list[Any] = []
    allowed_updates = {
        "lifecycle_stage": ("lifecycleStage", lambda value: validate_choice(value, TREND_LIFECYCLE_STAGES, "lifecycle_stage")),
        "scout_comment": ("scoutComment", lambda value: validate_optional_text(value, 2000)),
        "viral_score": ("viralScore", lambda value: validate_percent(value, "viral_score", 50)),
        "saturation_sng": ("saturationSng", lambda value: validate_percent(value, "saturation_sng", 10)),
        "is_active": ("isActive", validate_active_flag),
    }

    for column, (camel_key, validator) in allowed_updates.items():
        if column not in payload and camel_key not in payload:
            continue
        updates.append(f"{column} = ?")
        params.append(validator(get_payload_value(payload, column, camel_key)))

    if not updates:
        raise ApiError("No editable trend fields were provided.", 400)

    get_database().execute(
        f"UPDATE trends SET {', '.join(updates)} WHERE id = ?",
        tuple([*params, trend_id]),
    )
    updated_trend = get_trend_by_id(trend_id)
    if not updated_trend:
        raise ApiError("Trend not found.", 404)
    return updated_trend


def deactivate_admin_trend(trend_id: str) -> None:
    if not get_trend_by_id(trend_id):
        raise ApiError("Trend not found.", 404)
    get_database().execute("UPDATE trends SET is_active = 0 WHERE id = ?", (trend_id,))


def get_trends_feed_payload() -> dict[str, Any]:
    page = max(parse_int(flask_request.args.get("page"), 1), 1)
    per_page = min(max(parse_int(flask_request.args.get("per_page"), 20), 1), 100)
    offset = (page - 1) * per_page
    where_clause, params = build_trend_filters(include_feed_rules=True)
    db = get_database()
    total_row = db.fetch_one(f"SELECT COUNT(*) AS total FROM trends {where_clause}", tuple(params))
    rows = db.fetch_all(
        f"""
        SELECT *
        FROM trends
        {where_clause}
        ORDER BY viral_score DESC, created_at DESC
        LIMIT ? OFFSET ?
        """,
        tuple([*params, per_page, offset]),
    )
    total = parse_int(total_row.get("total") if total_row else 0, 0)

    return {
        "items": [trend_to_payload(row) for row in rows],
        "total": total,
        "page": page,
        "hasMore": offset + len(rows) < total,
    }


def get_active_trend_row(trend_id: str) -> dict[str, Any]:
    row = get_database().fetch_one(
        "SELECT * FROM trends WHERE id = ? AND is_active = 1 LIMIT 1",
        (trend_id,),
    )
    if not row:
        raise ApiError("Trend not found.", 404)
    return row


def get_latest_user_analysis(user_id: str) -> dict[str, Any] | None:
    return get_database().fetch_one(
        """
        SELECT *
        FROM analysis_runs
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (user_id,),
    )


def build_creator_profile(analysis_row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not analysis_row:
        return None

    account = as_dict(safe_json_loads(analysis_row.get("account_payload"), {}))
    return {
        "username": str(account.get("username") or "").strip(),
        "biography": str(account.get("biography") or "").strip(),
        "followersCount": account.get("followersCount"),
        "platform": str(account.get("platform") or "").strip(),
    }


def build_remix_prompt(trend: dict[str, Any], creator_profile: dict[str, Any] | None, format_value: str) -> str:
    prompt_payload = {
        "task": "Generate a short-form video content remix plan in Russian",
        "currentDate": utc_now().date().isoformat(),
        "trend": {
            "title": trend["title"],
            "description": trend["description"],
            "platform": trend["platform"],
            "niche": trend.get("niche"),
            "scout_comment": trend.get("scout_comment"),
            "viral_score": trend.get("viral_score"),
        },
        "creatorProfile": creator_profile,
        "requestedFormat": format_value,
        "requirements": [
            "Return only valid JSON, no markdown, no code fences",
            "All text fields must be in Russian",
            "hook: one attention-grabbing opening line, max 12 words",
            "scenario: array of 4-5 step strings describing the content flow",
            "shotList: array of 3-5 specific shot descriptions",
            "captions: array of exactly 3 caption variants without emoji characters",
            "hashtags: array of 8-10 hashtags without # symbol",
            "thumbnailText: max 4 words for thumbnail overlay",
            "shootingTips: array of 2-3 practical filming tips",
            "format: the format name in Russian",
            "Do not use emoji characters anywhere in the JSON values",
            "Use this exact JSON shape: {hook, scenario:[string], shotList:[string], captions:[string], hashtags:[string], thumbnailText, shootingTips:[string], format}",
        ],
    }
    return json.dumps(prompt_payload, ensure_ascii=False)


def build_remix_repair_prompt(original_prompt: str, raw_response: str) -> str:
    prompt_payload = {
        "task": "Repair an AI remix response into strict JSON",
        "originalRequest": original_prompt,
        "rawResponse": raw_response[:12000],
        "requirements": [
            "Return only valid JSON, no markdown, no code fences, no commentary",
            "All text fields must be in Russian",
            "Do not use emoji characters anywhere in the JSON values",
            "Use this exact JSON shape: {hook, scenario:[string], shotList:[string], captions:[string], hashtags:[string], thumbnailText, shootingTips:[string], format}",
            "scenario must contain 4-5 strings",
            "shotList must contain 3-5 strings",
            "captions must contain exactly 3 strings",
            "hashtags must contain 8-10 strings without # symbol",
            "shootingTips must contain 2-3 strings",
            "thumbnailText must be max 4 words",
        ],
    }
    return json.dumps(prompt_payload, ensure_ascii=False)


def normalize_remix_list(value: Any, field_name: str, min_items: int, max_items: int) -> list[str]:
    if not isinstance(value, list) or not (min_items <= len(value) <= max_items):
        raise UpstreamServiceError("AI returned an incomplete remix plan.", 502)
    items = [str(item).strip() for item in value if str(item).strip()]
    if len(items) < min_items:
        raise UpstreamServiceError("AI returned an incomplete remix plan.", 502)
    if field_name == "hashtags":
        return [item.removeprefix("#") for item in items[:max_items]]
    return items[:max_items]


def normalize_remix_payload(payload: dict[str, Any]) -> dict[str, Any]:
    required_keys = {
        "hook",
        "scenario",
        "shotList",
        "captions",
        "hashtags",
        "thumbnailText",
        "shootingTips",
    }
    if not required_keys.issubset(payload):
        raise UpstreamServiceError("AI returned an incomplete remix plan.", 502)

    hook = str(payload.get("hook") or "").strip()
    thumbnail_text = str(payload.get("thumbnailText") or "").strip()
    if not hook or not thumbnail_text:
        raise UpstreamServiceError("AI returned an incomplete remix plan.", 502)

    return {
        "hook": hook,
        "scenario": normalize_remix_list(payload.get("scenario"), "scenario", 4, 5),
        "shotList": normalize_remix_list(payload.get("shotList"), "shotList", 3, 5),
        "captions": normalize_remix_list(payload.get("captions"), "captions", 3, 3),
        "hashtags": normalize_remix_list(payload.get("hashtags"), "hashtags", 8, 10),
        "thumbnailText": thumbnail_text,
        "shootingTips": normalize_remix_list(payload.get("shootingTips"), "shootingTips", 2, 3),
        "format": str(payload.get("format") or "").strip(),
    }


def parse_remix_result_text(raw_text: str) -> dict[str, Any]:
    return normalize_remix_payload(parse_json_response_text(raw_text))


def generate_remix_result(prompt: str) -> tuple[dict[str, Any], str]:
    response_payload, analysis_model = call_gemini_generate(
        prompt,
        current_app.config["GEMINI_MODEL"],
        False,
        current_app.config["GEMINI_FALLBACK_MODELS"],
        response_mime_type="application/json",
    )

    raw_text = ""
    try:
        raw_text = extract_text_parts(response_payload)
        return parse_remix_result_text(raw_text), analysis_model
    except UpstreamServiceError:
        current_app.logger.warning("Gemini returned an invalid remix JSON payload. Trying JSON repair.")
        repair_prompt = build_remix_repair_prompt(
            prompt,
            raw_text or json.dumps(response_payload, ensure_ascii=False),
        )
        repair_payload, repair_model = call_gemini_generate(
            repair_prompt,
            current_app.config["GEMINI_MODEL"],
            False,
            current_app.config["GEMINI_FALLBACK_MODELS"],
            response_mime_type="application/json",
        )
        try:
            return parse_remix_result_text(extract_text_parts(repair_payload)), repair_model
        except UpstreamServiceError as repair_exc:
            raise UpstreamServiceError(
                "AI не смог собрать план Remix. Попробуйте ещё раз.",
                502,
            ) from repair_exc


def create_trend_remix(trend_id: str, user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    format_value = str(payload.get("format") or "auto").strip().lower()
    if format_value not in REMIX_FORMATS:
        raise ApiError("format is invalid.", 400)

    consume_rate_limit(
        "remix-generate",
        f"user:{user['id']}",
        current_app.config["ANALYSIS_LIMIT_PER_HOUR"],
        60 * 60,
    )

    trend = get_active_trend_row(trend_id)
    creator_profile = build_creator_profile(get_latest_user_analysis(user["id"]))
    remix_prompt = build_remix_prompt(trend, creator_profile, format_value)
    remix_result, analysis_model = generate_remix_result(remix_prompt)
    remix_id = str(uuid.uuid4())
    created_at = iso_now()

    get_database().execute(
        """
        INSERT INTO remixes (id, user_id, trend_id, format, result_payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            remix_id,
            user["id"],
            trend_id,
            format_value,
            json.dumps(remix_result, ensure_ascii=False),
            created_at,
        ),
    )

    return {
        "id": remix_id,
        "trendId": trend_id,
        "format": format_value,
        "result": remix_result,
        "createdAt": created_at,
        "analysisModel": analysis_model,
    }


def emit_admin_realtime(event_name: str, payload: dict[str, Any]) -> None:
    try:
        socketio = current_app.extensions.get("socketio")
    except RuntimeError:
        return
    if not socketio:
        return
    socketio.emit(f"admin:{event_name}", payload, namespace="/adminpanel")


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
        elif origin and current_app.config.get("ADMIN_ALLOW_LOCAL_ORIGINS"):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-CSRF-Token"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if flask_request.path.startswith("/admin/"):
            response.headers["Cache-Control"] = "no-store"
        if current_app.config["APP_ENV"] == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.errorhandler(ApiError)
    def handle_api_error(exc: ApiError):
        if exc.details is not None and exc.status_code >= 500:
            current_app.logger.warning("API error details hidden from client: %s", exc.details)
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

    @app.route("/admin/auth/login", methods=["POST", "OPTIONS"])
    def admin_login():
        if flask_request.method == "OPTIONS":
            return ("", 204)

        require_admin_origin()
        consume_rate_limit(
            "admin-login",
            get_request_subject("admin-login"),
            current_app.config["AUTH_LIMIT_PER_15_MINUTES"],
            15 * 60,
        )

        payload = request_json()
        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", ""))
        if not verify_admin_credentials(username, password):
            raise ApiError("Invalid admin login or password.", 401)

        token = create_admin_session()
        session = get_admin_session_from_token(token, touch=False)
        response = jsonify({"admin": admin_to_payload(session)})
        return attach_admin_session_cookie(response, token)

    @app.route("/admin/auth/me", methods=["GET", "OPTIONS"])
    def admin_me():
        if flask_request.method == "OPTIONS":
            return ("", 204)
        session = get_current_admin()
        return jsonify({"admin": admin_to_payload(session)})

    @app.route("/admin/auth/logout", methods=["POST", "OPTIONS"])
    def admin_logout():
        if flask_request.method == "OPTIONS":
            return ("", 204)
        get_current_admin(require_csrf=True)
        logout_current_admin()
        response = jsonify({"status": "logged_out"})
        return clear_admin_session_cookie(response)

    @app.route("/admin/overview", methods=["GET", "OPTIONS"])
    def admin_overview():
        if flask_request.method == "OPTIONS":
            return ("", 204)
        get_current_admin()
        return jsonify(build_admin_overview(parse_admin_filters()))

    @app.route("/admin/analyses", methods=["GET", "OPTIONS"])
    def admin_analyses():
        if flask_request.method == "OPTIONS":
            return ("", 204)
        get_current_admin()
        return jsonify(get_admin_analyses_payload(parse_admin_filters()))

    @app.route("/admin/analyses/<run_id>", methods=["GET", "OPTIONS"])
    def admin_analysis_details(run_id: str):
        if flask_request.method == "OPTIONS":
            return ("", 204)
        get_current_admin()
        analysis_run = get_admin_analysis_detail(run_id)
        if not analysis_run:
            raise ApiError("Analysis not found.", 404)
        return jsonify(analysis_run)

    @app.route("/admin/analyses/<run_id>/logs", methods=["POST", "OPTIONS"])
    def admin_create_analysis_log(run_id: str):
        if flask_request.method == "OPTIONS":
            return ("", 204)
        get_current_admin(require_csrf=True)
        payload = request_json()
        log_payload = create_admin_analysis_log(run_id, str(payload.get("message", "")))
        return jsonify({"log": log_payload}), 201

    @app.route("/admin/trends", methods=["GET", "POST", "OPTIONS"])
    def admin_trends():
        if flask_request.method == "OPTIONS":
            return ("", 204)
        admin_session = get_current_admin()
        if flask_request.method == "POST":
            trend_payload = create_admin_trend(request_json(), admin_session)
            return jsonify(trend_payload), 201
        return jsonify(get_admin_trends_payload())

    @app.route("/admin/trends/<trend_id>", methods=["PATCH", "DELETE", "OPTIONS"])
    def admin_trend_details(trend_id: str):
        if flask_request.method == "OPTIONS":
            return ("", 204)
        get_current_admin(require_csrf=True)
        if flask_request.method == "DELETE":
            deactivate_admin_trend(trend_id)
            return jsonify({"status": "deactivated"})
        return jsonify(update_admin_trend(trend_id, request_json()))

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
        response = jsonify({"token": token, "user": user_to_payload(user)})
        attach_session_cookie(response, token)
        return response, 201

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
        response = jsonify({"token": token, "user": user_to_payload(user)})
        return attach_session_cookie(response, token)

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
        response = jsonify({"status": "logged_out"})
        return clear_session_cookie(response)

    @app.route("/analyses", methods=["GET", "DELETE", "OPTIONS"])
    def analyses():
        if flask_request.method == "OPTIONS":
            return ("", 204)
        user = get_current_user()
        if flask_request.method == "DELETE":
            deleted_count = delete_user_analyses(user["id"])
            return jsonify({"status": "cleared", "deletedCount": deleted_count})
        return jsonify({"items": get_recent_analyses(user["id"])})

    @app.route("/analyses/clear", methods=["POST", "OPTIONS"])
    def clear_analyses():
        if flask_request.method == "OPTIONS":
            return ("", 204)
        user = get_current_user()
        deleted_count = delete_user_analyses(user["id"])
        return jsonify({"status": "cleared", "deletedCount": deleted_count})

    @app.route("/analyses/<run_id>", methods=["GET", "OPTIONS"])
    def analysis_details(run_id: str):
        if flask_request.method == "OPTIONS":
            return ("", 204)
        user = get_current_user()
        analysis_run = get_analysis_run(user["id"], run_id)
        if not analysis_run:
            raise ApiError("Analysis not found.", 404)
        return jsonify(analysis_run)

    @app.route("/trends/feed", methods=["GET", "OPTIONS"])
    def trends_feed():
        if flask_request.method == "OPTIONS":
            return ("", 204)
        get_current_user()
        return jsonify(get_trends_feed_payload())

    @app.route("/trends/<trend_id>/remix", methods=["POST", "OPTIONS"])
    def trend_remix(trend_id: str):
        if flask_request.method == "OPTIONS":
            return ("", 204)
        user = get_current_user()
        return jsonify(create_trend_remix(trend_id, user, request_json())), 201

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


def init_admin_socketio(app: Flask) -> None:
    if SocketIO is None or emit is None:
        app.extensions["socketio"] = None
        app.logger.warning("Flask-SocketIO is not installed; admin realtime updates are disabled.")
        return

    socketio = SocketIO(
        app,
        cors_allowed_origins=list(build_allowed_origins(app.config["FRONTEND_ORIGIN"])),
        manage_session=False,
    )
    app.extensions["socketio"] = socketio

    @socketio.on("connect", namespace="/adminpanel")
    def admin_socket_connect(auth=None):
        token = flask_request.cookies.get(app.config["ADMIN_SESSION_COOKIE_NAME"], "").strip()

        try:
            get_admin_session_from_token(token)
        except ApiError:
            return False

        emit("admin:snapshot", build_admin_overview(), namespace="/adminpanel")
        return True

    @socketio.on("admin:refresh", namespace="/adminpanel")
    def admin_socket_refresh():
        emit("admin:snapshot", build_admin_overview(), namespace="/adminpanel")


def run_backend_server(app_to_run: Flask, use_waitress: bool = False) -> None:
    host = app_to_run.config.get("HOST", os.getenv("HOST", "0.0.0.0"))
    port = int(app_to_run.config.get("PORT", os.getenv("PORT", "5000")))
    socketio = app_to_run.extensions.get("socketio")

    if socketio:
        socketio.run(
            app_to_run,
            host=host,
            port=port,
            debug=app_to_run.config["DEBUG"],
            allow_unsafe_werkzeug=app_to_run.config["APP_ENV"] != "production",
        )
        return

    if use_waitress:
        from waitress import serve

        serve(app_to_run, host=host, port=port, threads=8)
        return

    app_to_run.run(
        host=host,
        port=port,
        debug=app_to_run.config["DEBUG"],
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
        GEMINI_TREND_MODEL=config.gemini_trend_model,
        GEMINI_FALLBACK_MODELS=config.gemini_fallback_models,
        GEMINI_TREND_FALLBACK_MODELS=config.gemini_trend_fallback_models,
        ANALYSIS_CACHE_TTL_MINUTES=config.analysis_cache_ttl_minutes,
        SESSION_TTL_HOURS=config.session_ttl_hours,
        ANALYSIS_LIMIT_PER_HOUR=config.analysis_limit_per_hour,
        AUTH_LIMIT_PER_15_MINUTES=config.auth_limit_per_15_min,
        ADMIN_USERNAME=config.admin_username,
        ADMIN_PASSWORD=config.admin_password,
        ADMIN_PASSWORD_HASH=config.admin_password_hash,
        ADMIN_ALLOW_LOCAL_ORIGINS=config.admin_allow_local_origins,
        ADMIN_SESSION_TTL_HOURS=config.admin_session_ttl_hours,
        ADMIN_SESSION_COOKIE_NAME=config.admin_session_cookie_name,
        PORT=config.port,
        HOST=config.host,
        DEBUG=config.debug,
        ENABLE_SEARCH_GROUNDING=config.enable_search_grounding,
        SESSION_COOKIE_NAME=config.session_cookie_name,
        SESSION_COOKIE_SECURE=config.session_cookie_secure,
        SESSION_COOKIE_SAMESITE=config.session_cookie_samesite,
    )

    database = Database(config.database_url)
    database.ensure_schema()
    app.extensions["database"] = database

    register_routes(app)
    init_admin_socketio(app)
    return app


app = create_app()


if __name__ == "__main__":
    run_backend_server(app)
