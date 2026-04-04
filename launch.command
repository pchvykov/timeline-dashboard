#!/bin/bash
# Timeline Dashboard Launcher
# Double-click this file in Finder to start the dashboard.

cd "$(dirname "$0")"
echo "Starting Timeline Dashboard..."

# Point the backend at the personal_os db (one level up from dashboard/).
# We resolve to an absolute path using $PWD (which is now the dashboard dir).
# For standalone / open-source use, remove this line and tasks.db will be
# created automatically inside the dashboard folder.
export DASHBOARD_DB_PATH="$(cd .. && pwd)/tasks.db"

# Kill any stale processes on the ports first
echo "Clearing ports..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 1

# Start backend
echo "Starting backend on :8000..."
cd backend
python3 -m uvicorn main:app --port 8000 &
BACKEND_PID=$!
cd ..

# Start frontend
echo "Starting frontend on :5173..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

# Wait for servers to be ready, then open browser
sleep 4
echo "Opening browser..."
open http://localhost:5173

echo ""
echo "Dashboard is running!"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."

# Trap exit to kill both processes
trap "echo 'Shutting down...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM EXIT
wait
