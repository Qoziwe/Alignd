from io import BytesIO
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
import sys
from urllib import error
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import (
    UpstreamServiceError,
    AppConfig,
    award_points,
    call_gemini_generate,
    clamp_score,
    create_app,
    ensure_analysis_shape,
    fetch_apify_items,
    get_database,
    infer_compatibility_score,
    parse_json_response_text,
    save_analysis,
)


class BackendApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_dir.name) / "test.db"
        self.app = create_app(
            {
                "APP_ENV": "development",
                "DATABASE_URL": f"sqlite:///{database_path}",
                "SECRET_KEY": "test-secret",
                "FRONTEND_ORIGIN": "http://127.0.0.1:3000",
                "ANALYSIS_CACHE_TTL_MINUTES": 360,
                "ANALYSIS_LIMIT_PER_HOUR": 10,
                "AUTH_LIMIT_PER_15_MINUTES": 20,
                "ADMIN_USERNAME": "Lekim",
                "ADMIN_PASSWORD": "002qrwaim11",
            }
        )
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def register(self, email="user@example.com", password="password123", display_name="Test User"):
        return self.client.post(
            "/auth/register",
            json={
                "email": email,
                "password": password,
                "displayName": display_name,
            },
        )

    def login(self, email="user@example.com", password="password123"):
        return self.client.post(
            "/auth/login",
            json={"email": email, "password": password},
        )

    def auth_headers(self, token: str):
        return {"Authorization": f"Bearer {token}"}

    def admin_login(self):
        return self.client.post(
            "/admin/auth/login",
            json={"username": "Lekim", "password": "002qrwaim11"},
        )

    def admin_csrf_headers(self, csrf_token: str):
        return {"X-CSRF-Token": csrf_token}

    def analysis_result(self):
        return (
            {
                "profileSummary": {
                    "niche": "Marketing",
                    "compatibilityLabel": "High",
                    "compatibilityScore": 91,
                    "positioning": "Strong creator positioning.",
                    "audienceSummary": "Audience wants practical short-form content.",
                },
                "trends": [
                    {"type": "top", "title": "T1", "description": "D1", "match": 91},
                    {"type": "top", "title": "T2", "description": "D2", "match": 88},
                    {"type": "growing", "title": "T3", "description": "D3", "match": 84},
                    {"type": "growing", "title": "T4", "description": "D4", "match": 80},
                ],
                "ideas": [
                    {"tag": "POV", "title": "I1", "hook": "H1", "angle": "A1"},
                    {"tag": "CASE", "title": "I2", "hook": "H2", "angle": "A2"},
                    {"tag": "TIP", "title": "I3", "hook": "H3", "angle": "A3"},
                ],
                "hooks": ["1", "2", "3", "4", "5", "6"],
                "recommendations": {
                    "summary": "Summary",
                    "bullets": ["b1", "b2", "b3", "b4", "b5"],
                },
            },
            [{"title": "Source", "url": "https://example.com"}],
            "gemini-2.5-flash-lite",
        )

    def test_schema_migrates_existing_trends_table(self):
        database_path = Path(self.temp_dir.name) / "legacy-trends.db"
        with sqlite3.connect(database_path) as connection:
            connection.execute(
                """
                CREATE TABLE trends (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    platform TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                INSERT INTO trends (id, title, description, platform)
                VALUES (?, ?, ?, ?)
                """,
                ("legacy-trend", "Legacy", "Old trend row", "tiktok"),
            )

        app = create_app(
            {
                "APP_ENV": "development",
                "DATABASE_URL": f"sqlite:///{database_path}",
                "SECRET_KEY": "test-secret",
                "FRONTEND_ORIGIN": "http://127.0.0.1:3000",
                "ADMIN_USERNAME": "Lekim",
                "ADMIN_PASSWORD": "002qrwaim11",
            }
        )

        with app.app_context():
            db = get_database()
            columns = db.table_columns("trends")
            self.assertIn("is_active", columns)
            self.assertIn("lifecycle_stage", columns)
            self.assertIn("saturation_sng", columns)
            self.assertIn("video_preview_url", columns)

            row = db.fetch_one("SELECT * FROM trends WHERE id = ?", ("legacy-trend",))
            self.assertIsNotNone(row)
            self.assertEqual(row["is_active"], 1)
            self.assertEqual(row["lifecycle_stage"], "emerging")
            self.assertEqual(row["saturation_sng"], 10)
            self.assertEqual(row["country_origin"], "US")

    def test_register_login_me_and_logout(self):
        register_response = self.register()
        self.assertEqual(register_response.status_code, 201)
        token = register_response.get_json()["token"]

        me_response = self.client.get("/auth/me", headers=self.auth_headers(token))
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.get_json()["user"]["email"], "user@example.com")

        logout_response = self.client.post("/auth/logout", headers=self.auth_headers(token))
        self.assertEqual(logout_response.status_code, 200)

        me_after_logout = self.client.get("/auth/me", headers=self.auth_headers(token))
        self.assertEqual(me_after_logout.status_code, 401)

        login_response = self.login()
        self.assertEqual(login_response.status_code, 200)
        self.assertIn("token", login_response.get_json())

    def test_analyze_requires_auth(self):
        response = self.client.post(
            "/analyze-account",
            json={"profileUrl": "https://www.instagram.com/example/"},
        )
        self.assertEqual(response.status_code, 401)

    @patch("app.generate_analysis")
    @patch("app.fetch_apify_items")
    def test_analyze_stores_result_and_uses_cache(self, fetch_apify_items_mock, generate_analysis_mock):
        token = self.register().get_json()["token"]

        fetch_apify_items_mock.return_value = [
            {
                "username": "example",
                "fullName": "Example",
                "biography": "Bio",
                "followersCount": 1500,
                "profilePicUrl": "https://example.com/avatar.jpg",
                "latestPosts": [{"caption": "Hello"}],
            }
        ]
        generate_analysis_mock.return_value = (
            {
                "profileSummary": {
                    "niche": "Маркетинг",
                    "compatibilityLabel": "Высокая",
                    "compatibilityScore": 91,
                    "positioning": "Сильный экспертный профиль.",
                    "audienceSummary": "Аудитория любит практические разборы.",
                },
                "trends": [
                    {"type": "top", "title": "T1", "description": "D1", "match": 91},
                    {"type": "top", "title": "T2", "description": "D2", "match": 88},
                    {"type": "growing", "title": "T3", "description": "D3", "match": 84},
                    {"type": "growing", "title": "T4", "description": "D4", "match": 80},
                ],
                "ideas": [
                    {"tag": "POV", "title": "I1", "hook": "H1", "angle": "A1"},
                    {"tag": "CASE", "title": "I2", "hook": "H2", "angle": "A2"},
                    {"tag": "TIP", "title": "I3", "hook": "H3", "angle": "A3"},
                ],
                "hooks": ["1", "2", "3", "4", "5", "6"],
                "recommendations": {
                    "summary": "Summary",
                    "bullets": ["b1", "b2", "b3", "b4", "b5"],
                },
            },
            [{"title": "Source", "url": "https://example.com"}],
            "gemini-2.5-flash-lite",
        )

        response = self.client.post(
            "/analyze-account",
            headers=self.auth_headers(token),
            json={"profileUrl": "https://www.instagram.com/example/", "niche": "Маркетинг"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.get_json()["cached"])

        cached_response = self.client.post(
            "/analyze-account",
            headers=self.auth_headers(token),
            json={"profileUrl": "https://www.instagram.com/example/", "niche": "Маркетинг"},
        )
        self.assertEqual(cached_response.status_code, 200)
        self.assertTrue(cached_response.get_json()["cached"])
        self.assertEqual(generate_analysis_mock.call_count, 1)

        history_response = self.client.get("/analyses", headers=self.auth_headers(token))
        self.assertEqual(history_response.status_code, 200)
        self.assertEqual(len(history_response.get_json()["items"]), 1)

        analysis_id = history_response.get_json()["items"][0]["id"]
        details_response = self.client.get(f"/analyses/{analysis_id}", headers=self.auth_headers(token))
        self.assertEqual(details_response.status_code, 200)
        self.assertEqual(details_response.get_json()["id"], analysis_id)
        self.assertEqual(details_response.get_json()["account"]["username"], "example")

        admin_csrf_token = self.admin_login().get_json()["admin"]["csrfToken"]
        admin_overview_response = self.client.get("/admin/overview")
        self.assertEqual(admin_overview_response.status_code, 200)
        self.assertEqual(admin_overview_response.get_json()["summary"]["totalAnalyses"], 1)

        admin_analyses_response = self.client.get("/admin/analyses")
        self.assertEqual(admin_analyses_response.status_code, 200)
        self.assertEqual(admin_analyses_response.get_json()["items"][0]["id"], analysis_id)

        log_response = self.client.post(
            f"/admin/analyses/{analysis_id}/logs",
            headers=self.admin_csrf_headers(admin_csrf_token),
            json={"message": "Checked by admin."},
        )
        self.assertEqual(log_response.status_code, 201)

        admin_detail_response = self.client.get(
            f"/admin/analyses/{analysis_id}",
        )
        self.assertEqual(admin_detail_response.status_code, 200)
        self.assertEqual(admin_detail_response.get_json()["logs"][0]["message"], "Checked by admin.")

        clear_response = self.client.delete("/analyses", headers=self.auth_headers(token))
        self.assertEqual(clear_response.status_code, 200)
        self.assertEqual(clear_response.get_json()["deletedCount"], 1)

        cleared_history_response = self.client.get("/analyses", headers=self.auth_headers(token))
        self.assertEqual(cleared_history_response.status_code, 200)
        self.assertEqual(cleared_history_response.get_json()["items"], [])

    def test_admin_auth_is_separate_from_user_auth(self):
        bad_login_response = self.client.post(
            "/admin/auth/login",
            json={"username": "Lekim", "password": "wrong-password"},
        )
        self.assertEqual(bad_login_response.status_code, 401)

        login_response = self.admin_login()
        self.assertEqual(login_response.status_code, 200)
        admin_csrf_token = login_response.get_json()["admin"]["csrfToken"]

        me_response = self.client.get("/admin/auth/me")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.get_json()["admin"]["username"], "Lekim")

        overview_response = self.client.get("/admin/overview")
        self.assertEqual(overview_response.status_code, 200)
        self.assertEqual(overview_response.get_json()["summary"]["totalAnalyses"], 0)

        logout_without_csrf = self.client.post("/admin/auth/logout")
        self.assertEqual(logout_without_csrf.status_code, 403)

        logout_response = self.client.post(
            "/admin/auth/logout",
            headers=self.admin_csrf_headers(admin_csrf_token),
        )
        self.assertEqual(logout_response.status_code, 200)

    def test_admin_trends_crud_and_user_feed(self):
        admin_response = self.admin_login()
        self.assertEqual(admin_response.status_code, 200)
        admin_csrf_token = admin_response.get_json()["admin"]["csrfToken"]

        create_response = self.client.post(
            "/admin/trends",
            headers=self.admin_csrf_headers(admin_csrf_token),
            json={
                "title": "Founder tab confession",
                "description": "Creators show open browser tabs to explain what they are building.",
                "platform": "reels",
                "niche": "startups",
                "country_origin": "US",
                "source_url": "https://example.com/reel",
                "scout_comment": "Works because it feels specific and vulnerable.",
                "viral_score": 82,
                "trend_speed": "fast",
                "saturation_sng": 18,
                "lifecycle_stage": "emerging",
            },
        )
        self.assertEqual(create_response.status_code, 201)
        trend = create_response.get_json()
        self.assertEqual(trend["title"], "Founder tab confession")
        self.assertEqual(trend["platform"], "reels")
        self.assertTrue(trend["isActive"])

        list_response = self.client.get("/admin/trends?q=founder&platform=reels")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.get_json()["total"], 1)

        patch_without_csrf = self.client.patch(
            f"/admin/trends/{trend['id']}",
            json={"lifecycle_stage": "breakout"},
        )
        self.assertEqual(patch_without_csrf.status_code, 403)

        patch_response = self.client.patch(
            f"/admin/trends/{trend['id']}",
            headers=self.admin_csrf_headers(admin_csrf_token),
            json={
                "lifecycle_stage": "breakout",
                "scout_comment": "Growth is accelerating.",
                "viral_score": 91,
                "saturation_sng": 29,
            },
        )
        self.assertEqual(patch_response.status_code, 200)
        updated_trend = patch_response.get_json()
        self.assertEqual(updated_trend["lifecycleStage"], "breakout")
        self.assertEqual(updated_trend["viralScore"], 91)

        feed_without_user = self.client.get("/trends/feed")
        self.assertEqual(feed_without_user.status_code, 401)

        user_token = self.register(email="trend-user@example.com").get_json()["token"]
        feed_response = self.client.get("/trends/feed?platform=reels", headers=self.auth_headers(user_token))
        self.assertEqual(feed_response.status_code, 200)
        feed_payload = feed_response.get_json()
        self.assertEqual(feed_payload["total"], 1)
        self.assertEqual(feed_payload["items"][0]["id"], trend["id"])
        self.assertFalse(feed_payload["hasMore"])

        delete_response = self.client.delete(
            f"/admin/trends/{trend['id']}",
            headers=self.admin_csrf_headers(admin_csrf_token),
        )
        self.assertEqual(delete_response.status_code, 200)
        self.assertEqual(delete_response.get_json()["status"], "deactivated")

        empty_feed_response = self.client.get("/trends/feed?platform=reels", headers=self.auth_headers(user_token))
        self.assertEqual(empty_feed_response.status_code, 200)
        self.assertEqual(empty_feed_response.get_json()["total"], 0)

        inactive_admin_response = self.client.get(
            "/admin/trends?is_active=inactive",
            headers=self.admin_csrf_headers(admin_csrf_token),
        )
        self.assertEqual(inactive_admin_response.status_code, 200)
        self.assertIn(trend["id"], [item["id"] for item in inactive_admin_response.get_json()["items"]])

    def test_gap_opportunities_require_user_and_rank_matching_trends(self):
        admin_csrf_token = self.admin_login().get_json()["admin"]["csrfToken"]
        create_qualifying_response = self.client.post(
            "/admin/trends",
            headers=self.admin_csrf_headers(admin_csrf_token),
            json={
                "title": "Western hook before CIS saturation",
                "description": "A trend with strong global traction and low CIS saturation.",
                "platform": "reels",
                "niche": "marketing",
                "viral_score": 86,
                "saturation_sng": 12,
                "lifecycle_stage": "emerging",
            },
        )
        self.assertEqual(create_qualifying_response.status_code, 201)
        qualifying_id = create_qualifying_response.get_json()["id"]

        create_saturated_response = self.client.post(
            "/admin/trends",
            headers=self.admin_csrf_headers(admin_csrf_token),
            json={
                "title": "Already everywhere",
                "description": "This trend is strong but already saturated in CIS.",
                "platform": "tiktok",
                "viral_score": 91,
                "saturation_sng": 75,
                "lifecycle_stage": "breakout",
            },
        )
        self.assertEqual(create_saturated_response.status_code, 201)
        saturated_id = create_saturated_response.get_json()["id"]

        unauthorized_response = self.client.get("/trends/gap-opportunities")
        self.assertEqual(unauthorized_response.status_code, 401)

        user_token = self.register(email="gap-user@example.com").get_json()["token"]
        response = self.client.get("/trends/gap-opportunities", headers=self.auth_headers(user_token))

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        item_ids = [item["id"] for item in payload["items"]]
        self.assertIn(qualifying_id, item_ids)
        self.assertNotIn(saturated_id, item_ids)

        qualifying_item = next(item for item in payload["items"] if item["id"] == qualifying_id)
        self.assertEqual(qualifying_item["opportunityScore"], 74)
        self.assertEqual(qualifying_item["opportunity_score"], 74)
        self.assertEqual(qualifying_item["predictedBreakout"], "2-4 недели")
        self.assertEqual(qualifying_item["predicted_breakout"], "2-4 недели")

    @patch("app.call_gemini_generate")
    def test_trend_remix_generates_and_stores_plan(self, call_gemini_generate_mock):
        admin_csrf_token = self.admin_login().get_json()["admin"]["csrfToken"]
        create_response = self.client.post(
            "/admin/trends",
            headers=self.admin_csrf_headers(admin_csrf_token),
            json={
                "title": "Founder tab confession",
                "description": "Creators show open browser tabs to explain what they are building.",
                "platform": "reels",
                "niche": "startups",
                "viral_score": 82,
                "saturation_sng": 18,
                "lifecycle_stage": "emerging",
            },
        )
        self.assertEqual(create_response.status_code, 201)
        trend_id = create_response.get_json()["id"]

        remix_payload = {
            "hook": "Почему ваши вкладки продают лучше лендинга",
            "scenario": ["Откройте рабочий стол", "Покажите 3 вкладки", "Объясните выбор", "Дайте вывод"],
            "shotList": ["Крупный план ноутбука", "Запись экрана", "Финальный talking head"],
            "captions": ["Вкладки раскрывают стратегию", "Покажите процесс честно", "Так выглядит фокус"],
            "hashtags": ["startup", "founder", "content", "reels", "strategy", "marketing", "creator", "business"],
            "thumbnailText": "Покажи вкладки",
            "shootingTips": ["Скрой личные данные", "Держи темп быстрым"],
            "format": "Экспертный блог",
        }
        call_gemini_generate_mock.return_value = (
            {"candidates": [{"content": {"parts": [{"text": json.dumps(remix_payload, ensure_ascii=False)}]}}]},
            "gemini-test",
        )

        user_token = self.register(email="remix-user@example.com").get_json()["token"]
        remix_response = self.client.post(
            f"/trends/{trend_id}/remix",
            headers=self.auth_headers(user_token),
            json={"format": "expert_blog"},
        )

        self.assertEqual(remix_response.status_code, 201)
        payload = remix_response.get_json()
        self.assertEqual(payload["trendId"], trend_id)
        self.assertEqual(payload["format"], "expert_blog")
        self.assertEqual(payload["result"]["hook"], remix_payload["hook"])
        self.assertEqual(payload["analysisModel"], "gemini-test")
        stats_response = self.client.get("/user/stats", headers=self.auth_headers(user_token))
        self.assertEqual(stats_response.status_code, 200)
        stats_payload = stats_response.get_json()
        self.assertEqual(stats_payload["points"], 30)
        self.assertEqual(stats_payload["rank"]["label"], "Новичок")
        self.assertEqual(stats_payload["recentEvents"][0]["eventType"], "REMIX_CREATED")

        prompt = json.loads(call_gemini_generate_mock.call_args.args[0])
        self.assertEqual(prompt["task"], "Generate a short-form video content remix plan in Russian")
        self.assertEqual(prompt["requestedFormat"], "expert_blog")
        self.assertIsNone(prompt["creatorProfile"])

        missing_trend_response = self.client.post(
            "/trends/missing/remix",
            headers=self.auth_headers(user_token),
            json={"format": "expert_blog"},
        )
        self.assertEqual(missing_trend_response.status_code, 404)

    @patch("app.call_gemini_generate")
    def test_trend_remix_repairs_invalid_json_response(self, call_gemini_generate_mock):
        admin_csrf_token = self.admin_login().get_json()["admin"]["csrfToken"]
        create_response = self.client.post(
            "/admin/trends",
            headers=self.admin_csrf_headers(admin_csrf_token),
            json={
                "title": "Receipt breakdown",
                "description": "Creators turn everyday receipts into a short analytical story.",
                "platform": "tiktok",
                "niche": "finance",
                "viral_score": 79,
                "saturation_sng": 18,
                "lifecycle_stage": "underground",
            },
        )
        self.assertEqual(create_response.status_code, 201)
        trend_id = create_response.get_json()["id"]

        repaired_payload = {
            "hook": "Этот чек показывает, где утекают деньги",
            "scenario": [
                "Покажите обычный чек крупным планом",
                "Выделите одну неожиданную трату",
                "Объясните, какую привычку она раскрывает",
                "Дайте зрителю простой вывод",
            ],
            "shotList": [
                "Крупный план чека на столе",
                "Запись экрана с подсветкой строки расходов",
                "Финальный кадр с коротким выводом",
            ],
            "captions": [
                "Один чек может рассказать больше бюджета",
                "Проверьте, куда утекают маленькие суммы",
                "Разбор трат без сложных таблиц",
            ],
            "hashtags": ["finance", "money", "budget", "creator", "tiktok", "tips", "habits", "analytics"],
            "thumbnailText": "Проверь чек",
            "shootingTips": ["Закройте личные данные", "Снимайте чек при ровном свете"],
            "format": "Экспертный разбор",
        }
        call_gemini_generate_mock.side_effect = [
            (
                {"candidates": [{"content": {"parts": [{"text": "Here is a plan, but not JSON."}]}}]},
                "gemini-test",
            ),
            (
                {"candidates": [{"content": {"parts": [{"text": json.dumps(repaired_payload, ensure_ascii=False)}]}}]},
                "gemini-test",
            ),
        ]

        user_token = self.register(email="repair-user@example.com").get_json()["token"]
        remix_response = self.client.post(
            f"/trends/{trend_id}/remix",
            headers=self.auth_headers(user_token),
            json={"format": "expert_blog"},
        )

        self.assertEqual(remix_response.status_code, 201)
        payload = remix_response.get_json()
        self.assertEqual(payload["result"]["hook"], repaired_payload["hook"])
        self.assertEqual(call_gemini_generate_mock.call_count, 2)
        self.assertEqual(call_gemini_generate_mock.call_args_list[0].kwargs["response_mime_type"], "application/json")

        repair_prompt = json.loads(call_gemini_generate_mock.call_args_list[1].args[0])
        self.assertEqual(repair_prompt["task"], "Repair an AI remix response into strict JSON")
        self.assertIn("not JSON", repair_prompt["rawResponse"])

    @patch("app.generate_analysis")
    @patch("app.fetch_apify_items")
    def test_analyze_tiktok_profile(self, fetch_apify_items_mock, generate_analysis_mock):
        token = self.register().get_json()["token"]
        fetch_apify_items_mock.return_value = [
            {
                "text": "A practical short-form video",
                "diggCount": 120,
                "commentCount": 7,
                "playCount": 3200,
                "createTime": 1700000000,
                "authorMeta": {
                    "name": "examplecreator",
                    "nickName": "Example Creator",
                    "signature": "Build in public",
                    "fans": 4200,
                    "following": 30,
                    "video": 18,
                    "avatar": "https://example.com/tiktok.jpg",
                    "verified": True,
                },
            }
        ]
        generate_analysis_mock.return_value = self.analysis_result()

        response = self.client.post(
            "/analyze-account",
            headers=self.auth_headers(token),
            json={"profileUrl": "https://www.tiktok.com/@examplecreator", "niche": "Marketing"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["account"]["platform"], "TikTok")
        self.assertEqual(payload["account"]["username"], "examplecreator")
        self.assertEqual(payload["account"]["followersCount"], 4200)
        self.assertEqual(payload["account"]["recentPosts"][0]["videoViewCount"], 3200)
        stats_response = self.client.get("/user/stats", headers=self.auth_headers(token))
        self.assertEqual(stats_response.status_code, 200)
        stats_payload = stats_response.get_json()
        self.assertEqual(stats_payload["points"], 50)
        self.assertEqual(stats_payload["recentEvents"][0]["eventType"], "FIRST_ANALYSIS")
        self.assertEqual(stats_payload["achievements"][0]["key"], "first_blood")
        fetch_apify_items_mock.assert_called_once_with(
            "https://www.tiktok.com/@examplecreator",
            "TikTok",
            "examplecreator",
        )

    def test_user_stats_unlocks_trend_hunter_after_ten_analyses(self):
        token = self.register(email="hunter@example.com").get_json()["token"]
        user_id = self.client.get("/auth/me", headers=self.auth_headers(token)).get_json()["user"]["id"]
        analysis, sources, _model = self.analysis_result()
        account = {
            "username": "hunter",
            "fullName": "Trend Hunter",
            "biography": "Tests trend discovery",
            "followersCount": 100,
            "platform": "Instagram",
            "profileUrl": "https://www.instagram.com/hunter/",
            "niche": "Marketing",
            "recentPosts": [],
        }

        with self.app.app_context():
            db = get_database()
            for index in range(10):
                save_analysis(
                    user_id,
                    f"https://www.instagram.com/hunter{index}/",
                    "Marketing",
                    account,
                    analysis,
                    sources,
                )
                award_points(db, user_id, "FIRST_ANALYSIS" if index == 0 else "ANALYSIS_DONE")

        response = self.client.get("/user/stats", headers=self.auth_headers(token))
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        achievement_keys = {achievement["key"] for achievement in payload["achievements"]}
        self.assertIn("first_blood", achievement_keys)
        self.assertIn("trend_hunter", achievement_keys)

    def test_user_stats_unlocks_remix_master_after_five_remixes(self):
        token = self.register(email="remix-master@example.com").get_json()["token"]
        user_id = self.client.get("/auth/me", headers=self.auth_headers(token)).get_json()["user"]["id"]

        with self.app.app_context():
            db = get_database()
            for index in range(5):
                db.execute(
                    """
                    INSERT INTO remixes (id, user_id, trend_id, format, result_payload, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"remix-{index}",
                        user_id,
                        "trend-id",
                        "expert_blog",
                        json.dumps({"hook": "Hook"}),
                        f"2026-05-17T10:0{index}:00+00:00",
                    ),
                )
                award_points(db, user_id, "REMIX_CREATED")

        response = self.client.get("/user/stats", headers=self.auth_headers(token))
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        achievement_keys = {achievement["key"] for achievement in payload["achievements"]}
        self.assertIn("remix_master", achievement_keys)
        self.assertEqual(payload["recentEvents"][0]["eventType"], "REMIX_CREATED")

    def test_user_remixes_returns_saved_remix_history(self):
        token = self.register(email="history@example.com").get_json()["token"]
        user_id = self.client.get("/auth/me", headers=self.auth_headers(token)).get_json()["user"]["id"]

        with self.app.app_context():
            get_database().execute(
                """
                INSERT INTO remixes (id, user_id, trend_id, format, result_payload, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    "history-remix",
                    user_id,
                    "missing-trend",
                    "humor",
                    json.dumps({"hook": "История сохранена", "hashtags": ["test"]}, ensure_ascii=False),
                    "2026-05-17T10:00:00+00:00",
                ),
            )

        response = self.client.get("/remixes", headers=self.auth_headers(token))
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["items"][0]["id"], "history-remix")
        self.assertEqual(payload["items"][0]["result"]["hook"], "История сохранена")

    def test_tiktok_video_link_is_rejected(self):
        token = self.register().get_json()["token"]

        response = self.client.post(
            "/analyze-account",
            headers=self.auth_headers(token),
            json={"profileUrl": "https://www.tiktok.com/@examplecreator/video/123"},
        )

        self.assertEqual(response.status_code, 400)

    @patch("app.generate_analysis", side_effect=UpstreamServiceError("AI failed.", 502))
    @patch("app.fetch_apify_items")
    def test_analyze_returns_error_when_ai_fails(self, fetch_apify_items_mock, _generate_analysis_mock):
        token = self.register().get_json()["token"]
        fetch_apify_items_mock.return_value = [{"username": "example", "latestPosts": []}]

        response = self.client.post(
            "/analyze-account",
            headers=self.auth_headers(token),
            json={"profileUrl": "https://www.instagram.com/example/"},
        )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.get_json()["error"], "AI failed.")

    @patch("app.request.urlopen")
    def test_apify_not_found_maps_to_bad_gateway(self, urlopen_mock):
        urlopen_mock.side_effect = error.HTTPError(
            "https://api.apify.com/v2/acts/missing/run-sync-get-dataset-items",
            404,
            "Not found",
            {},
            BytesIO(b'{"error":"actor was not found"}'),
        )

        with self.app.app_context():
            self.app.config["APIFY_TOKEN"] = "test-token"
            with self.assertRaises(UpstreamServiceError) as context:
                fetch_apify_items("https://www.instagram.com/example/")

        self.assertEqual(context.exception.status_code, 502)
        self.assertIn("Apify", context.exception.message)

    def test_ensure_analysis_shape_tolerates_non_numeric_trend_match(self):
        analysis = {
            "account": {
                "niche": "Startups",
                "biography": "Сообщество для стартапов, инвесторов и founder stories",
                "recentPosts": [
                    {"caption": "Истории стартапов и разборы питчей"},
                    {"caption": "Нетворкинг и события для founders"},
                ],
            },
            "profileSummary": {
                "niche": "Startups",
                "compatibilityLabel": "High",
                "compatibilityScore": "92",
                "positioning": "Clear founder-led positioning.",
                "audienceSummary": "Audience wants practical startup content.",
            },
            "trends": [
                {
                    "type": "top",
                    "title": "Trend 1",
                    "description": "Description 1",
                    "match": "Профиль активно публикует анонсы мероприятий.",
                },
                {"type": "top", "title": "Trend 2", "description": "Description 2", "match": "88"},
                {"type": "growing", "title": "Trend 3", "description": "Description 3", "match": 79},
                {"type": "growing", "title": "Trend 4", "description": "Description 4", "match": "score: 101"},
            ],
            "ideas": [
                {"tag": "POV", "title": "Idea 1", "hook": "Hook 1", "angle": "Angle 1"},
                {"tag": "CASE", "title": "Idea 2", "hook": "Hook 2", "angle": "Angle 2"},
                {"tag": "TIP", "title": "Idea 3", "hook": "Hook 3", "angle": "Angle 3"},
            ],
            "hooks": ["1", "2", "3", "4", "5", "6"],
            "recommendations": {
                "summary": "Summary",
                "bullets": ["b1", "b2", "b3", "b4", "b5"],
            },
        }

        normalized = ensure_analysis_shape(analysis)

        self.assertEqual(normalized["profileSummary"]["compatibilityScore"], 92)
        self.assertGreaterEqual(normalized["trends"][0]["match"], 28)
        self.assertEqual(normalized["trends"][1]["match"], 88)
        self.assertEqual(normalized["trends"][2]["match"], 79)
        self.assertEqual(normalized["trends"][3]["match"], 100)
        self.assertEqual(sum(1 for trend in normalized["trends"] if trend["type"] == "top"), 2)
        self.assertEqual(sum(1 for trend in normalized["trends"] if trend["type"] == "growing"), 2)

    def test_ensure_analysis_shape_keeps_user_requested_niche(self):
        analysis = self.analysis_result()[0]
        analysis["profileSummary"]["niche"] = "Исследование космоса, наука и астрономия"

        normalized = ensure_analysis_shape(analysis, "рецепты еды")

        self.assertEqual(normalized["profileSummary"]["niche"], "рецепты еды")

    def test_clamp_score_extracts_and_limits_values(self):
        self.assertEqual(clamp_score("87%"), 87)
        self.assertEqual(clamp_score("score: 140"), 100)
        self.assertEqual(clamp_score("нет числа"), 0)

    def test_infer_compatibility_score_uses_label_and_trend_average(self):
        trends = [
            {"match": 78},
            {"match": 74},
            {"match": 68},
            {"match": 64},
        ]

        score = infer_compatibility_score("без числа", "Высокая", trends)

        self.assertGreaterEqual(score, 75)
        self.assertLessEqual(score, 90)

    def test_parse_json_response_text_extracts_json_from_ai_wrapper(self):
        payload = parse_json_response_text(
            'Sure, here is the JSON:\n```json\n{"profileSummary": {"niche": "Games"}}\n```\nDone.'
        )

        self.assertEqual(payload["profileSummary"]["niche"], "Games")

    @patch("app.request_gemini_generate")
    def test_gemini_fallback_runs_after_retryable_error(self, request_gemini_generate_mock):
        request_gemini_generate_mock.side_effect = [
            error.HTTPError(
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
                503,
                "Service unavailable",
                {},
                BytesIO(b'{"error":{"status":"UNAVAILABLE"}}'),
            ),
            {"candidates": [{"content": {"parts": [{"text": "{}"}]}}]},
        ]

        with self.app.app_context():
            payload, model = call_gemini_generate(
                "prompt",
                "gemini-2.5-flash",
                True,
                ["gemma-4-31b-it"],
            )

        self.assertEqual(model, "gemma-4-31b-it")
        self.assertIn("candidates", payload)
        self.assertEqual(request_gemini_generate_mock.call_count, 2)
        self.assertEqual(
            request_gemini_generate_mock.call_args_list[0].args,
            ("prompt", "gemini-2.5-flash", True),
        )
        self.assertEqual(
            request_gemini_generate_mock.call_args_list[1].args,
            ("prompt", "gemma-4-31b-it", False),
        )

    def test_default_trend_fallbacks_keep_search_capable_models(self):
        config = AppConfig.from_env(
            {
                "APP_ENV": "development",
                "DATABASE_URL": "sqlite:///:memory:",
                "SECRET_KEY": "test-secret",
                "GEMINI_FALLBACK_MODELS": None,
                "GEMINI_TREND_FALLBACK_MODELS": None,
            }
        )

        self.assertEqual(config.gemini_fallback_models, ["gemma-4-31b-it"])
        self.assertEqual(config.gemini_trend_fallback_models, ["gemini-2.5-flash-lite", "gemini-2.0-flash"])
        self.assertFalse(any(model.startswith("gemma-") for model in config.gemini_trend_fallback_models))


if __name__ == "__main__":
    unittest.main()
