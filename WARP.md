# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Key commands

### Install dependencies

```bash
pip install -r requirements.txt
```

### Run the development server

From the project root:

```bash
uvicorn app_main:app --reload
```

The app will be available at http://127.0.0.1:8000/.

### Run with a specific host/port

```bash
uvicorn app_main:app --reload --host 0.0.0.0 --port 8000
```

There is currently no configured test or lint command in this repo.
If you add tests later (e.g., with `pytest`), prefer commands like:

```bash
pytest
# single test example
pytest path/to/test_file.py -k test_name
```

## High-level architecture

### Backend (FastAPI)

- Single FastAPI app defined in `app_main.py` as `app = FastAPI(...)`.
- Static files are served from the `static/` directory, mounted at `/static` using `StaticFiles`.
- HTML templates are served from the `templates` directory via `Jinja2Templates`.
- Root route `/` renders `templates/index.html` and injects the `request` object.
- Marketplace API endpoints (JSON-backed, for demo use only):
  - `GET /api/items`: list all item listings from `data/items.json`.
  - `POST /api/items`: create a new item listing with `name`, `quantity`, `price`, and optional `description`, persisted to `data/items.json`.
  - `POST /api/purchase`: purchase a quantity of an item; validates stock, decrements quantity, and records the purchase with `total_price` in `data/purchases.json`.
  - `GET /api/purchases`: list all recorded purchases from `data/purchases.json`.
  - `POST /api/reset`: reset JSON-backed listings and purchases (for local development/demo).

Activity is additionally logged as JSON lines into `logs/activity.log` for each major backend action
(e.g., listing items, creating an item, purchasing, resetting data).

### Frontend (HTML/CSS/JS)

- `templates/index.html` is the single-page UI rendered for `/`.
  - Sections correspond to core marketplace flows: create listing, browse listings, purchase item, and view recent activity.
  - It loads `/static/styles.css` for styling and `/static/app.js` for behavior.
- `static/styles.css` contains basic layout and styling for the page, sections, buttons, tables, and text.
- `static/app.js` wires the UI to the marketplace API:
  - `requestJSON` utility wraps `fetch` with JSON handling and error reporting.
  - Functions to load items and purchases populate a table and activity log from `/api/items` and `/api/purchases`.
  - Handlers for creating listings and purchases call `POST /api/items` and `POST /api/purchase`, then refresh the UI.

The frontend is static and relies entirely on the FastAPI backend for data and state.

## Notes for future agents

- Prefer editing `app_main.py` if you are adding or modifying API routes.
- If you introduce more complexity (e.g., routers, packages, or tests), update this `WARP.md` with new commands (linting, testing) and a brief architecture note rather than listing every file.
- Keep the entrypoint (`app_main:app`) stable unless you also update `README.md` and this file to match.
