import os

from waitress import serve

from app import app


if __name__ == "__main__":
    serve(
        app,
        host=app.config.get("HOST", os.getenv("HOST", "0.0.0.0")),
        port=int(app.config.get("PORT", os.getenv("PORT", "5000"))),
        threads=8,
    )
