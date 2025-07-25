from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# CORS 허용 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "Welcome to Tide Info API", "status": "ok"}

@app.get("/tide")
def get_mock_tide_data(region: str, date: str):
    return {
        "region": region,
        "date": date,
        "data": [
            {"time": "04:12", "tide": "170cm"},
            {"time": "10:20", "tide": "80cm"},
            {"time": "16:45", "tide": "190cm"},
            {"time": "22:10", "tide": "70cm"},
        ]
    }
