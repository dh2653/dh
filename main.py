from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import requests
from bs4 import BeautifulSoup

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "Welcome to KMOC Tide Info API"}

@app.get("/tide")
def get_tide_data(region: str, date: str):
    url = f"https://www.kmoc.go.kr/tide/{region}/{date}"  # 실제 URL로 바꿔야 함

    headers = {
        "User-Agent": "Mozilla/5.0"
    }

    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
    except requests.RequestException as e:
        return {"error": f"Request failed: {str(e)}"}

    soup = BeautifulSoup(response.text, "html.parser")

    table = soup.find("table", {"class": "tide-table"})
    if not table:
        return {"error": "No tide data found"}

    data = []
    rows = table.find_all("tr")[1:]
    for row in rows:
        cells = row.find_all("td")
        if len(cells) >= 2:
            time = cells[0].get_text(strip=True)
            tide = cells[1].get_text(strip=True)
            data.append({"time": time, "tide": tide})

    return {
        "region": region,
        "date": date,
        "data": data
    }
