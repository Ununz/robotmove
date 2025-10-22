#!/bin/bash

# MQTT Monitoring Script
# ส่งข้อความทุก 5 วินาทีเพื่อดูใน Dashboard

MQTT_HOST="a0fa947d537a4c1982d2d44a94275ad2.s1.eu.hivemq.cloud"
MQTT_PORT="8883"
MQTT_USER="teacher"
MQTT_PASS="Stylor123"
TOPIC="stylor/test"

echo "🔄 MQTT Continuous Monitor"
echo "==========================="
echo "กำลังส่งข้อความทุก 5 วินาที..."
echo "เปิด HiveMQ Dashboard เพื่อดูผลแบบ Real-time"
echo "กด Ctrl+C เพื่อหยุด"
echo ""

counter=1
while true; do
    timestamp=$(date "+%Y-%m-%d %H:%M:%S")
    message="Test message #$counter at $timestamp"
    
    echo "📤 [$counter] Sending: $message"
    mqttx pub -h $MQTT_HOST -p $MQTT_PORT \
              -u $MQTT_USER -P $MQTT_PASS \
              -t $TOPIC -m "$message" -l mqtts
    
    counter=$((counter + 1))
    sleep 5
done
