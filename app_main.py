from typing import List, Optional, Any
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import asyncio

try:
    import httpx
except Exception:
    httpx = None

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi import Request
from pydantic import BaseModel, Field, EmailStr

app = FastAPI(title="FastAPI Marketplace")


@app.middleware("http")
async def log_api_requests(request: Request, call_next):
    """Middleware to log all API requests (paths starting with /api).

    Logs method, path, query params, a redacted request body when possible,
    response status code, username (if present), and client IP.
    """
    # Only log API routes to avoid noisy static/template requests
    try:
        if not request.url.path.startswith("/api"):
            return await call_next(request)

        # Read body (may be empty). We need to recreate the request for downstream handlers.
        body_bytes = await request.body()
        body_text = body_bytes.decode("utf-8") if body_bytes else ""
        parsed_body = None
        redacted_body = None
        if body_text:
            try:
                parsed_body = json.loads(body_text)
                # If JSON object, redact sensitive keys
                if isinstance(parsed_body, dict):
                    redacted_body = {
                        k: ("REDACTED" if k.lower() in ("password", "pwd", "token") else v)
                        for k, v in parsed_body.items()
                    }
                else:
                    redacted_body = parsed_body
            except Exception:
                # Not JSON; store a trimmed string
                redacted_body = body_text[:1000]

        # Rebuild request for downstream by providing a receive that returns the original body
        async def receive() -> dict:
            return {"type": "http.request", "body": body_bytes}

        response = await call_next(Request(request.scope, receive))

        status = getattr(response, "status_code", None)

        # Determine username from query or body if available
        username = None
        try:
            if "username" in request.query_params:
                username = request.query_params.get("username")
            elif isinstance(parsed_body, dict):
                username = parsed_body.get("username") or parsed_body.get("buyer")
        except Exception:
            username = None

        detail = {
            "method": request.method,
            "path": request.url.path,
            "query": dict(request.query_params),
            "body": redacted_body,
            "status": status,
        }

        # Use existing log_event helper which will attach ts, ip and username
        log_event("http_request", detail, request=request, username=username)

        return response
    except Exception:
        # If logging fails, continue processing the request normally
        return await call_next(request)

# Serve static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
ITEMS_FILE = DATA_DIR / "items.json"
PURCHASES_FILE = DATA_DIR / "purchases.json"
USERS_FILE = DATA_DIR / "users.json"
ACTIVITY_LOG_FILE = LOGS_DIR / "activity.log"
APPLICATION_LOG_FILE = LOGS_DIR / "application.log"

# ServiceNow configuration (use env vars)
SNOW_URL = os.getenv("SERVICENOW_URL")
SNOW_USER = os.getenv("SERVICENOW_USER")
SNOW_PASS = os.getenv("SERVICENOW_PASS")
SNOW_TABLE = os.getenv("SERVICENOW_TABLE", "incident")

DATA_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)


class ItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    quantity: int = Field(..., ge=0)
    price: float = Field(..., ge=0)
    description: str | None = Field(None, max_length=500)


class Item(BaseModel):
    id: int
    name: str
    quantity: int
    price: float
    description: str | None = None
    user_id: Optional[int] = None  # ID of the user who created this listing


class PurchaseRequest(BaseModel):
    item_id: int
    quantity: int = Field(..., gt=0)
    buyer: str = Field(..., min_length=1, max_length=100)


class Purchase(BaseModel):
    id: int
    item_id: int
    quantity: int
    buyer: str
    total_price: float
    user_id: Optional[int] = None  # ID of the user who made this purchase


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6)


class UserLogin(BaseModel):
    username: str
    password: str


class User(BaseModel):
    id: int
    username: str
    email: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str


class LoginResponse(BaseModel):
    success: bool
    message: str
    user: Optional[UserResponse] = None


class UserActivity(BaseModel):
    user_id: int
    username: str
    listings_count: int
    purchases_count: int
    total_items_listed: int  # Total quantity of items listed
    total_items_purchased: int  # Total quantity of items purchased
    total_spent: float  # Total amount spent on purchases


def _read_json_list(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            return []
    except json.JSONDecodeError:
        return []


def load_items() -> List[Item]:
    raw_items = _read_json_list(ITEMS_FILE)
    return [Item(**item) for item in raw_items]


def save_items(items: List[Item]) -> None:
    with ITEMS_FILE.open("w", encoding="utf-8") as f:
        json.dump([item.dict() for item in items], f, ensure_ascii=False, indent=2)


def load_purchases() -> List[Purchase]:
    raw_purchases = _read_json_list(PURCHASES_FILE)
    return [Purchase(**purchase) for purchase in raw_purchases]


def save_purchases(purchases: List[Purchase]) -> None:
    with PURCHASES_FILE.open("w", encoding="utf-8") as f:
        json.dump([purchase.dict() for purchase in purchases], f, ensure_ascii=False, indent=2)


def log_event(action: str, detail: dict | None = None, request: Optional[Request] = None, username: Optional[str] = None) -> None:
    # IST is UTC+5:30
    ist_timezone = timezone(timedelta(hours=5, minutes=30))
    ist_time = datetime.now(ist_timezone)

    # Attempt to determine client IP
    ip = None
    if request is not None:
        try:
            # request.client may be an object with `host` or a tuple (host, port)
            client = request.client
            if hasattr(client, "host"):
                ip = client.host
            elif isinstance(client, (list, tuple)) and len(client) >= 1:
                ip = client[0]
        except Exception:
            ip = None

    # Determine username: prefer explicit param, fall back to detail
    uname = username
    if not uname and detail:
        uname = detail.get("username") or detail.get("user") or detail.get("buyer")

    # Build entry and omit username key if it's falsy
    entry: dict = {
        "ts": ist_time.isoformat(),
        "action": action,
        "ip": ip,
        "detail": detail or {},
    }
    if uname:
        entry["username"] = uname

    # Send only generic HTTP request logs to application.log; other action logs (including pincode lookups) go to activity.log
    target_file = APPLICATION_LOG_FILE if action == "http_request" else ACTIVITY_LOG_FILE
    with target_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # Decide whether this entry should be sent to ServiceNow
    try:
        should_alert = False
        # By default, send events that indicate failures or explicit test events
        if action.endswith("_failed") or action in ("test_snow",):
            should_alert = True

        # Fire-and-forget the notifier to avoid blocking request processing
        if should_alert and httpx is not None and SNOW_URL and SNOW_USER and SNOW_PASS:
            payload = {
                "short_description": f"{action} - {entry.get('detail', {}).get('username') or entry.get('username') or 'unknown'}",
                "description": json.dumps(entry, ensure_ascii=False),
            }

            async def _schedule():
                try:
                    await _post_to_servicenow_with_retries(payload)
                except Exception:
                    # On unexpected errors, persist failure to activity log directly
                    _append_log_file(ACTIVITY_LOG_FILE, {"ts": datetime.now(timezone.utc).isoformat(), "action": "servicenow_unexpected_error"})

            try:
                loop = asyncio.get_running_loop()
                loop.create_task(_schedule())
            except RuntimeError:
                # No running loop; run in background thread
                import threading
                threading.Thread(target=lambda: asyncio.run(_schedule()), daemon=True).start()
    except Exception:
        # Ensure logging never raises
        pass


def _append_log_file(target: Path, entry: dict) -> None:
    try:
        with target.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        # Best-effort only
        pass


async def _post_to_servicenow_with_retries(payload: dict[str, Any], retries: int = 3, backoff_base: float = 1.0) -> None:
    """Post payload to ServiceNow with simple retry/backoff."""
    if httpx is None:
        raise RuntimeError("httpx not installed")

    url = f"{SNOW_URL.rstrip('/')}/api/now/table/{SNOW_TABLE}"
    headers = {"Accept": "application/json", "Content-Type": "application/json"}

    attempt = 0
    last_exc = None
    async with httpx.AsyncClient(timeout=10.0, verify=True) as client:
        while attempt < retries:
            try:
                resp = await client.post(url, json=payload, headers=headers, auth=(SNOW_USER, SNOW_PASS))
                resp.raise_for_status()
                return
            except Exception as exc:
                last_exc = exc
                attempt += 1
                await asyncio.sleep(backoff_base * (2 ** (attempt - 1)))

    # If reached here, all retries failed — persist to activity log for later inspection
    failure_entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": "servicenow_notify_failed",
        "error": str(last_exc),
        "payload": payload,
    }
    _append_log_file(ACTIVITY_LOG_FILE, failure_entry)


# User management functions
def load_users() -> List[User]:
    raw_users = _read_json_list(USERS_FILE)
    return [User(**user) for user in raw_users]


def save_users(users: List[User]) -> None:
    with USERS_FILE.open("w", encoding="utf-8") as f:
        json.dump([user.dict() for user in users], f, ensure_ascii=False, indent=2)


def get_user_by_username(username: str) -> Optional[User]:
    users = load_users()
    return next((u for u in users if u.username == username), None)


def get_user_by_email(email: str) -> Optional[User]:
    users = load_users()
    return next((u for u in users if u.email == email), None)




@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/signup", response_class=HTMLResponse)
async def signup_page(request: Request):
    return templates.TemplateResponse("signup.html", {"request": request})


@app.post("/api/signup", response_model=UserResponse, status_code=201)
async def signup(payload: UserCreate, request: Request) -> UserResponse:
    """Create a new user account."""
    users = load_users()
    
    # Check if username already exists
    if get_user_by_username(payload.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # Check if email already exists
    if get_user_by_email(payload.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    next_id = max((u.id for u in users), default=0) + 1
    user = User(
        id=next_id,
        username=payload.username,
        email=payload.email,
        password=payload.password,
    )
    users.append(user)
    save_users(users)
    
    log_event("user_signup", {"user_id": user.id, "username": user.username}, request=request, username=user.username)
    
    return UserResponse(id=user.id, username=user.username, email=user.email)


@app.post("/api/login", response_model=LoginResponse)
async def login(payload: UserLogin, request: Request) -> LoginResponse:
    """Authenticate user by checking username and password directly."""
    user = get_user_by_username(payload.username)
    
    if not user or user.password != payload.password:
        log_event("login_failed", {"username": payload.username}, request=request, username=payload.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    
    log_event("user_login", {"user_id": user.id, "username": user.username}, request=request, username=user.username)
    
    return LoginResponse(
        success=True,
        message="Login successful",
        user=UserResponse(id=user.id, username=user.username, email=user.email)
    )


@app.get("/api/me", response_model=UserResponse)
async def get_current_user_info(username: str) -> UserResponse:
    """Get user information by username."""
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    return UserResponse(id=user.id, username=user.username, email=user.email)


@app.get("/api/items", response_model=List[Item])
async def list_items(request: Request) -> List[Item]:
    """List all current item listings from JSON storage."""
    items = load_items()
    log_event("list_items", {"count": len(items)}, request=request)
    return items


@app.post("/api/items", response_model=Item, status_code=201)
async def create_item(payload: ItemCreate, username: str, request: Request) -> Item:
    """Create a new item listing.

    Data is persisted to `data/items.json`.
    Requires username to associate the listing with a user.
    """
    # Get user by username
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    items = load_items()
    next_id = max((item.id for item in items), default=0) + 1
    item = Item(
        id=next_id,
        name=payload.name,
        quantity=payload.quantity,
        price=payload.price,
        description=payload.description,
        user_id=user.id,
    )
    items.append(item)
    save_items(items)
    log_event("create_item", {"item": item.dict(), "user_id": user.id, "username": user.username}, request=request, username=user.username)
    return item


@app.post("/api/purchase", response_model=Purchase, status_code=201)
async def purchase_item(payload: PurchaseRequest, username: str, request: Request) -> Purchase:
    """Purchase a quantity of an item if there is enough stock.

    Items and purchases are persisted to JSON files.
    Requires username to associate the purchase with a user.
    """
    # Get user by username
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    items = load_items()
    purchases = load_purchases()

    item = next((i for i in items if i.id == payload.item_id), None)
    if item is None:
        log_event("purchase_failed_item_not_found", {"payload": payload.dict(), "username": username}, request=request, username=username)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found"
        )

    if payload.quantity > item.quantity:
        log_event(
            "purchase_failed_insufficient_stock",
            {"payload": payload.dict(), "available_quantity": item.quantity, "username": username},
            request=request,
            username=username,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not enough stock"
        )

    # Decrement stock and record purchase
    item.quantity -= payload.quantity
    for idx, existing in enumerate(items):
        if existing.id == item.id:
            items[idx] = item
            break
    save_items(items)

    next_purchase_id = max((p.id for p in purchases), default=0) + 1
    purchase = Purchase(
        id=next_purchase_id,
        item_id=item.id,
        quantity=payload.quantity,
        buyer=payload.buyer,
        total_price=round(item.price * payload.quantity, 2),
        user_id=user.id,
    )
    purchases.append(purchase)
    save_purchases(purchases)
    log_event("purchase_item", {"purchase": purchase.dict(), "user_id": user.id, "username": user.username}, request=request, username=user.username)

    return purchase


@app.get("/api/purchases", response_model=List[Purchase])
async def list_purchases(username: Optional[str] = None, request: Request = None) -> List[Purchase]:
    """Return purchases. If `username` is provided, return only purchases made by that user."""
    purchases = load_purchases()
    if username:
        user = get_user_by_username(username)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        user_purchases = [p for p in purchases if p.user_id is not None and p.user_id == user.id]
        log_event("list_purchases_user", {"user_id": user.id, "count": len(user_purchases)}, request=request, username=user.username)
        return user_purchases

    log_event("list_purchases", {"count": len(purchases)}, request=request)
    return purchases


@app.get("/api/user/activity", response_model=UserActivity)
async def get_user_activity(username: str, request: Request) -> UserActivity:
    """Get activity statistics for a user including listings and purchases."""
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    items = load_items()
    purchases = load_purchases()
    
    # Count listings created by this user
    user_listings = [
        item for item in items 
        if item.user_id is not None and item.user_id == user.id
    ]
    listings_count = len(user_listings)
    total_items_listed = sum(item.quantity for item in user_listings)
    
    # Count purchases made by this user
    user_purchases = [
        p for p in purchases 
        if p.user_id is not None and p.user_id == user.id
    ]
    purchases_count = len(user_purchases)
    total_items_purchased = sum(p.quantity for p in user_purchases)
    total_spent = sum(p.total_price for p in user_purchases)
    
    log_event("get_user_activity", {
        "user_id": user.id,
        "listings_count": listings_count,
        "purchases_count": purchases_count,
        "username": user.username,
    }, request=request, username=user.username)
    
    return UserActivity(
        user_id=user.id,
        username=user.username,
        listings_count=listings_count,
        purchases_count=purchases_count,
        total_items_listed=total_items_listed,
        total_items_purchased=total_items_purchased,
        total_spent=round(total_spent, 2),
    )


@app.post("/api/reset", status_code=204)
async def reset_data(request: Request) -> None:
    """Reset JSON-backed data (for local development/demo only)."""
    save_items([])
    save_purchases([])
    log_event("reset_data", {}, request=request)


@app.get("/api/pincode/{pincode}")
async def pincode_lookup(pincode: str, request: Request):
    """Proxy endpoint to lookup postal pincode using external API and log the call."""
    if httpx is None:
        log_event("pincode_lookup_failed", {"pincode": pincode, "error": "httpx_not_installed"}, request=request)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Lookup service unavailable")

    url = f"https://api.postalpincode.in/pincode/{pincode}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        log_event("pincode_lookup_failed", {"pincode": pincode, "error": str(exc)}, request=request)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Postal lookup failed")

    # Log successful lookup to application log
    result_count = len(data) if isinstance(data, list) else 0
    log_event("pincode_lookup", {"pincode": pincode, "status_code": getattr(resp, 'status_code', None), "result_count": result_count}, request=request)
    return data


@app.post("/api/log_pincode")
async def log_pincode(payload: dict, request: Request):
    """Accept a small client-side log about a postal lookup and write it to activity log."""
    pincode = payload.get("pincode")
    status = payload.get("status")
    detail = {"pincode": pincode, "status": status, "meta": payload.get("meta")}
    # Log as an action that will go to activity.log
    log_event("pincode_lookup", detail, request=request)
    return {"ok": True}
