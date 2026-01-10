#!/bin/bash
#
# Check connection to a ComfyUI instance
# Usage: ./check-connection.sh <comfyui-url>
#

set -e

URL="${1:-http://localhost:8188}"

echo "Checking connection to: $URL"
echo ""

# Test basic connectivity
echo -n "1. Basic connectivity... "
if curl -s --connect-timeout 5 "$URL" > /dev/null 2>&1; then
    echo "✓ OK"
else
    echo "✗ FAILED"
    echo "   Cannot reach $URL"
    echo "   Check URL and ensure ComfyUI is running"
    exit 1
fi

# Test API endpoint
echo -n "2. API endpoint... "
RESPONSE=$(curl -s --connect-timeout 5 "$URL/system_stats" 2>&1)
if echo "$RESPONSE" | grep -q "system"; then
    echo "✓ OK"
else
    echo "✗ FAILED"
    echo "   API not responding correctly"
    echo "   Response: $RESPONSE"
    exit 1
fi

# Test model listing
echo -n "3. Model listing... "
MODELS=$(curl -s --connect-timeout 10 "$URL/object_info/CheckpointLoaderSimple" 2>&1)
if echo "$MODELS" | grep -q "ckpt_name"; then
    echo "✓ OK"
    # Extract and show model count
    MODEL_COUNT=$(echo "$MODELS" | grep -o '"ckpt_name"' | wc -l || echo "0")
    echo "   Found checkpoint loader"
else
    echo "⚠ WARNING"
    echo "   Could not verify models (may still work)"
fi

# Test queue endpoint
echo -n "4. Queue endpoint... "
QUEUE=$(curl -s --connect-timeout 5 "$URL/queue" 2>&1)
if echo "$QUEUE" | grep -q "queue_running\|queue_pending"; then
    echo "✓ OK"
else
    echo "⚠ WARNING"
    echo "   Queue endpoint returned unexpected format"
fi

echo ""
echo "=========================================="
echo "Connection test complete!"
echo "=========================================="
echo ""
echo "ComfyUI URL: $URL"
echo ""
echo "Add this to your MCP config:"
echo ""
echo "  \"env\": {"
echo "    \"COMFYUI_URL\": \"$URL\""
echo "  }"
echo ""
