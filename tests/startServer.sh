#!/bin/bash

# Script to start a simple web server for testing
# Serves test-browser.html on localhost:3333

PORT=3333
TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$TEST_DIR/.." && pwd)"

# Check if port is in use and kill the process
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    PID=$(lsof -ti :$PORT 2>/dev/null)
    if [ ! -z "$PID" ]; then
        echo "Port $PORT is in use by process $PID. Killing it..."
        kill -9 $PID 2>/dev/null
        sleep 1
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    PID=$(lsof -ti :$PORT 2>/dev/null || fuser $PORT/tcp 2>/dev/null)
    if [ ! -z "$PID" ]; then
        echo "Port $PORT is in use by process $PID. Killing it..."
        kill -9 $PID 2>/dev/null
        sleep 1
    fi
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Windows
    PID=$(netstat -ano | grep ":$PORT" | grep LISTENING | awk '{print $5}' | head -1)
    if [ ! -z "$PID" ]; then
        echo "Port $PORT is in use by process $PID. Killing it..."
        taskkill //F //PID $PID 2>/dev/null
        sleep 1
    fi
fi

echo "Starting web server on http://localhost:$PORT"
echo "Serving files from: $PROJECT_ROOT"
echo ""
echo "Open http://localhost:$PORT/tests/test-browser.html in your browser"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Detect platform and use appropriate command
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - use npx serve (works if Node.js is installed)
    if command -v npx &> /dev/null; then
        cd "$PROJECT_ROOT" && npx --yes serve -l $PORT
    elif command -v python3 &> /dev/null; then
        cd "$PROJECT_ROOT" && python3 -m http.server $PORT
    else
        echo "Error: Neither npx nor python3 found. Please install Node.js or Python."
        exit 1
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux - try various options
    if command -v npx &> /dev/null; then
        cd "$PROJECT_ROOT" && npx --yes serve -l $PORT
    elif command -v python3 &> /dev/null; then
        cd "$PROJECT_ROOT" && python3 -m http.server $PORT
    elif command -v php &> /dev/null; then
        cd "$PROJECT_ROOT" && php -S localhost:$PORT
    else
        echo "Error: No suitable web server found. Please install Node.js, Python, or PHP."
        exit 1
    fi
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Windows - try various options
    if command -v npx &> /dev/null; then
        cd "$PROJECT_ROOT" && npx --yes serve -l $PORT
    elif command -v python &> /dev/null; then
        cd "$PROJECT_ROOT" && python -m http.server $PORT
    elif command -v python3 &> /dev/null; then
        cd "$PROJECT_ROOT" && python3 -m http.server $PORT
    else
        echo "Error: No suitable web server found. Please install Node.js or Python."
        exit 1
    fi
else
    echo "Error: Unsupported platform: $OSTYPE"
    exit 1
fi
