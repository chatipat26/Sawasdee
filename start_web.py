import uvicorn

if __name__ == "__main__":
    print("========================================================")
    print("  SAWASDEE RENTAL - HIGH SPEED WEB APPLICATION")
    print("  Starting on http://localhost:8501 ...")
    print("========================================================")
    uvicorn.run("server:app", host="0.0.0.0", port=8501, reload=False)
