# FastAPI Marketplace

Simple demo marketplace application with:

- Backend: FastAPI
- Frontend: HTML, CSS, JavaScript
- Integration: FastAPI serves templates and static assets

## Features

1. Create item listings with name, quantity, price, and optional description.
2. Browse all current listings in a table view.
3. Purchase items by ID and quantity, with stock checks and total price calculation.
4. View a simple activity log of purchases.

Data is persisted to JSON files in the `data/` directory (`items.json`, `purchases.json`), and backend activity
is logged to `logs/activity.log`. Files are created automatically when you use the API.

## Getting started

```bash
pip install -r requirements.txt
uvicorn app_main:app --reload
```

Then open http://127.0.0.1:8000/ in your browser.
