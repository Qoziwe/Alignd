import os
import logging

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from service import parse_profile


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("alignd-backend")


class ParseRequest(BaseModel):
    url: str


app = FastAPI(title="Alignd Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request, call_next):
    logger.info("Started %s %s", request.method, request.url.path)
    response = await call_next(request)
    logger.info("Finished %s %s with %s", request.method, request.url.path, response.status_code)
    return response


@app.get("/api/health")
def health_check() -> dict[str, object]:
    return {
        "ok": True,
        "service": "alignd-backend-python",
    }


@app.post("/api/parse")
def parse_endpoint(payload: ParseRequest) -> dict[str, object]:
    if not payload.url.strip():
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": "Profile URL is required.",
            },
        )

    try:
        data = parse_profile(payload.url)
    except ValueError as error:
        return JSONResponse(
            status_code=400,
            content={
                "ok": False,
                "error": str(error),
            },
        )
    except Exception as error:
        return JSONResponse(
            status_code=502,
            content={
                "ok": False,
                "error": str(error) or "Parsing failed.",
            },
        )

    return {
        "ok": True,
        "data": data.model_dump(),
    }


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "4000")),
        reload=os.getenv("RELOAD", "false").lower() == "true",
    )
