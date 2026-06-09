#!/bin/bash
# Timeline Dashboard Launcher
# Double-click this file in Finder to start the dashboard.

cd "$(dirname "$0")"
echo "Starting Timeline Dashboard..."

# Keep this Terminal window open if anything below fails, so the error is
# visible instead of the window vanishing the moment a server crashes.
fail() {
  echo ""
  echo "❌ $1"
  echo ""
  read -n 1 -s -r -p "Press any key to close this window..."
  exit 1
}

# Point the backend at the personal_os db (one level up from dashboard/).
# For standalone / open-source use, remove this line and tasks.db will be
# created automatically inside the dashboard folder.
export DASHBOARD_DB_PATH="$(cd .. && pwd)/AGENT_CORE/tasks.db"

# ── Bootstrap dependencies if missing ───────────────────────────────────────
# venv/ and node_modules/ are gitignored, so a fresh checkout (or a cleanup)
# has neither. Without them the servers crash instantly. Build on demand.
if [ ! -x backend/venv/bin/python3 ]; then
  echo "Backend venv missing - creating it (one-time setup)..."
  python3 -m venv backend/venv || fail "Could not create backend venv (is python3 installed?)."
  backend/venv/bin/pip install --upgrade pip >/dev/null 2>&1
  backend/venv/bin/pip install -r backend/requirements.txt || fail "Backend dependency install failed."
fi

if [ ! -d frontend/node_modules ]; then
  echo "Frontend node_modules missing - running npm install (one-time setup)..."
  ( cd frontend && npm install ) || fail "npm install failed (is Node installed?)."
fi

# ── Clear stale processes on the ports ──────────────────────────────────────
echo "Clearing ports..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 1

# ── Start backend ───────────────────────────────────────────────────────────
echo "Starting backend on :8000..."
( cd backend && venv/bin/python3 -m uvicorn main:app --port 8000 ) &
BACKEND_PID=$!

# ── Start frontend ────────────────────────────────────────────────────────────
echo "Starting frontend on :5173..."
( cd frontend && npm run dev ) &
FRONTEND_PID=$!

# Trap exit to kill both processes when this window is closed / Ctrl+C.
trap "echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM EXIT

# ── Wait for both servers to actually answer before opening the browser ──────
echo "Waiting for servers..."
for i in $(seq 1 30); do
  BE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/tasks 2>/dev/null)
  FE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 2>/dev/null)
  [ "$BE" = "200" ] && [ "$FE" = "200" ] && break
  # If either background process already died, stop waiting and report.
  kill -0 "$BACKEND_PID" 2>/dev/null  || fail "Backend exited during startup - check the output above."
  kill -0 "$FRONTEND_PID" 2>/dev/null || fail "Frontend exited during startup - check the output above."
  sleep 1
done

if [ "$BE" != "200" ] || [ "$FE" != "200" ]; then
  fail "Servers did not become ready in time (backend=$BE, frontend=$FE)."
fi

echo "Opening browser..."
open http://localhost:5173

echo ""
echo "✅ Dashboard is running!"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."

wait
