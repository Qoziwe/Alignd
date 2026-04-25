import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import (
    UpstreamServiceError,
    clamp_score,
    create_app,
    ensure_analysis_shape,
    infer_compatibility_score,
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
        fetch_apify_items_mock.assert_called_once_with(
            "https://www.tiktok.com/@examplecreator",
            "TikTok",
            "examplecreator",
        )

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


if __name__ == "__main__":
    unittest.main()
