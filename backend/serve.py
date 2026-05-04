from app import app, run_backend_server


if __name__ == "__main__":
    run_backend_server(app, use_waitress=True)
