"""
SawasdeeRental - FastAPI Web Application (Decoupled Architecture)
100% FastAPI Backend RESTful API & High-Performance Decoupled Frontend
"""
import os
import uvicorn
from server import app

# Export FastAPI ASGI application instance
__all__ = ["app"]

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"🚀 Starting SawasdeeRental FastAPI Backend on http://{host}:{port}")
    uvicorn.run("server:app", host=host, port=port, reload=False)