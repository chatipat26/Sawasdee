"""
SawasdeeRental - FastAPI Backend Service (Decoupled Architecture)

Run directly with:
    python main.py
or
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""
import os
import uvicorn
import server

# Decoupled FastAPI app instance
app = server.app

# Decoupled REST Endpoints (/cars, /bookings, /customers)
app.add_api_route("/cars", server.list_cars, methods=["GET"])
app.add_api_route("/cars", server.create_or_update_car, methods=["POST"])
app.add_api_route("/customers", server.list_customers, methods=["GET"])
app.add_api_route("/customers", server.create_or_update_customer, methods=["POST"])
app.add_api_route("/bookings", server.list_bookings, methods=["GET"])
app.add_api_route("/bookings", server.create_booking, methods=["POST"])

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"🚀 Starting SawasdeeRental FastAPI Backend on http://{host}:{port}")
    uvicorn.run("main:app", host=host, port=port, reload=False)
