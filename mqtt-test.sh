#!/bin/bash

# MQTT Testing Script for HiveMQ Cloud
# =====================================

MQTT_HOST="a0fa947d537a4c1982d2d44a94275ad2.s1.eu.hivemq.cloud"
MQTT_PORT="8883"
MQTT_USER="teacher"
MQTT_PASS="Stylor123"
TOPIC="stylor/test"

echo "🔧 MQTT Testing Script"
echo "======================"
echo ""
echo "เลือกการทดสอบ:"
echo "1. ทดสอบเชื่อมต่อเดี่ยว (Single Publish)"
echo "2. ทดสอบ 50 Clients Subscribe (Background)"
echo "3. Publish ข้อความไปยัง Subscribers"
echo "4. ทดสอบแบบเต็ม (Full Test)"
echo ""
read -p "เลือก (1-4): " choice

case $choice in
    1)
        echo "📤 กำลัง publish ข้อความทดสอบ..."
        mqttx pub -h $MQTT_HOST -p $MQTT_PORT -u $MQTT_USER -P $MQTT_PASS -t test/topic -m "Ping!" -l mqtts
        ;;
    2)
        echo "📥 เริ่ม 50 clients subscribe..."
        echo "⚠️  หน้าต่างนี้จะค้างไว้เพื่อรับข้อความ"
        echo "⚠️  เปิดหน้าต่าง terminal ใหม่เพื่อ publish ข้อความ"
        echo ""
        mqttx bench sub -h $MQTT_HOST -p $MQTT_PORT -u $MQTT_USER -P $MQTT_PASS -t $TOPIC -c 50 -l mqtts --interval 100
        ;;
    3)
        echo "📤 กำลัง publish ข้อความไปยัง $TOPIC..."
        mqttx pub -h $MQTT_HOST -p $MQTT_PORT -u $MQTT_USER -P $MQTT_PASS -t $TOPIC -m "Hello everyone!" -l mqtts
        ;;
    4)
        echo "🚀 เริ่มทดสอบแบบเต็ม..."
        echo ""
        echo "Step 1: ทดสอบเชื่อมต่อเดี่ยว"
        mqttx pub -h $MQTT_HOST -p $MQTT_PORT -u $MQTT_USER -P $MQTT_PASS -t test/topic -m "Ping!" -l mqtts
        echo ""
        echo "Step 2: เริ่ม benchmark subscriber ใน background..."
        echo "⚠️  กด Ctrl+C เพื่อหยุดการทดสอบ"
        echo ""
        
        # Start subscriber in background
        mqttx bench sub -h $MQTT_HOST -p $MQTT_PORT -u $MQTT_USER -P $MQTT_PASS -t $TOPIC -c 50 -l mqtts --interval 100 &
        BENCH_PID=$!
        
        echo "⏳ รอ 8 วินาทีให้ 50 clients เชื่อมต่อ..."
        sleep 8
        
        echo ""
        echo "Step 3: Publish ข้อความทดสอบ..."
        for i in {1..3}; do
            echo "  📤 ส่งข้อความครั้งที่ $i"
            mqttx pub -h $MQTT_HOST -p $MQTT_PORT -u $MQTT_USER -P $MQTT_PASS -t $TOPIC -m "Test message #$i - Hello everyone!" -l mqtts
            sleep 2
        done
        
        echo ""
        echo "✅ ทดสอบเสร็จสิ้น!"
        echo "⚠️  Benchmark ยังทำงานอยู่ในพื้นหลัง (PID: $BENCH_PID)"
        echo "   รอสักครู่เพื่อดูผลลัพธ์แล้วกด Ctrl+C เพื่อหยุด"
        
        # Wait for user to see results
        wait $BENCH_PID
        ;;
    *)
        echo "❌ ตัวเลือกไม่ถูกต้อง"
        exit 1
        ;;
esac
