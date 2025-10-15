# วิธีแก้ไข admin.html ให้เชื่อมต่อกับ HiveMQ Cloud

## ปัญหา
`admin.html` ยังใช้ `broker.hivemq.com` (public broker) และไม่มี authentication

## วิธีแก้ไข

### 1. แก้ไขส่วน HTML Form (บรรทัดประมาณ 20)

**ค้นหา:**
```html
<input type="text" class="form-control form-control-lg" id="broker-url" value="wss://broker.hivemq.com:8884/mqtt">
```

**เปลี่ยนเป็น:**
```html
<input type="text" class="form-control form-control-lg" id="broker-url" value="wss://a0fa947d537a4c1982d2d44a94275ad2.s1.eu.hivemq.cloud:8884/mqtt">
```

### 2. เพิ่ม Input Fields สำหรับ Username/Password

**ค้นหา:**
```html
<div class="col-12 col-lg-4">
  <label for="root-topic" class="form-label">Root Topic</label>
  <input type="text" class="form-control form-control-lg" id="root-topic" value="nlbot">
</div>
<div class="col-12 col-lg-2 d-grid">
  <button id="connect-btn" class="btn btn-gradient py-3">Connect</button>
</div>
```

**เปลี่ยนเป็น:**
```html
<div class="col-12 col-lg-4">
  <label for="root-topic" class="form-label">Root Topic</label>
  <input type="text" class="form-control form-control-lg" id="root-topic" value="nlbot">
</div>
<div class="col-12 col-lg-3">
  <label for="mqtt-username" class="form-label">Username</label>
  <input type="text" class="form-control form-control-lg" id="mqtt-username" value="teacher">
</div>
<div class="col-12 col-lg-3">
  <label for="mqtt-password" class="form-label">Password</label>
  <input type="password" class="form-control form-control-lg" id="mqtt-password" value="Stylor123">
</div>
<div class="col-12 col-lg-2 d-grid">
  <button id="connect-btn" class="btn btn-gradient py-3">Connect</button>
</div>
```

### 3. แก้ไขส่วน JavaScript

**ค้นหาบรรทัดประมาณ 111:**
```javascript
const brokerUrlInput = document.getElementById('broker-url'),
```

**เพิ่มตัวแปรหลัง brokerUrlInput:**
```javascript
const brokerUrlInput = document.getElementById('broker-url'),
      mqttUsernameInput = document.getElementById('mqtt-username'),
      mqttPasswordInput = document.getElementById('mqtt-password'),
```

**ค้นหาฟังก์ชัน `initializeMqtt` (บรรทัดประมาณ 198-199):**
```javascript
function initializeMqtt(brokerUrl, rootTopic) {
    client = mqtt.connect(brokerUrl);
```

**เปลี่ยนเป็น:**
```javascript
function initializeMqtt(brokerUrl, rootTopic, username, password) {
    const options = {
      reconnectPeriod: 1500,
      clean: true,
      clientId: 'admin-' + Math.random().toString(16).slice(2)
    };
    
    if (username && username.trim()) {
      options.username = username.trim();
      options.password = password ? password.trim() : '';
    }
    
    client = mqtt.connect(brokerUrl, options);
```

**ค้นหาการเรียก `initializeMqtt` (บรรทัดประมาณ 178-180):**
```javascript
const brokerUrl = brokerUrlInput.value.trim();
const rootTopic = rootTopicInput.value.trim() || 'nlbot';
initializeMqtt(brokerUrl, rootTopic);
```

**เปลี่ยนเป็น:**
```javascript
const brokerUrl = brokerUrlInput.value.trim();
const rootTopic = rootTopicInput.value.trim() || 'nlbot';
const username = mqttUsernameInput ? mqttUsernameInput.value.trim() : '';
const password = mqttPasswordInput ? mqttPasswordInput.value.trim() : '';
initializeMqtt(brokerUrl, rootTopic, username, password);
```

---

## วิธีใช้งาน

1. แก้ไขไฟล์ `admin.html` ตามขั้นตอนด้านบน
2. เปิด `admin.html` ในเบราว์เซอร์
3. จะเห็น form มี 5 fields:
   - **MQTT Broker URL**: `wss://a0fa947d537a4c1982d2d44a94275ad2.s1.eu.hivemq.cloud:8884/mqtt`
   - **Root Topic**: `nlbot`
   - **Username**: `teacher`
   - **Password**: `Stylor123`
4. คลิก **Connect**
5. ถ้าเชื่อมต่อสำเร็จ จะเห็นสถานะเป็น "Live monitoring"

---

## ทดสอบ

เปิด 2 หน้าต่าง:
1. **หน้า admin.html** - ดู teams และ messages
2. **หน้า index.html** - ส่งคำสั่ง

ถ้าทำงานได้ถูกต้อง admin จะเห็น:
- ทุก team ที่เชื่อมต่อ
- ทุก message ที่ส่ง/รับ
- สามารถส่งคำสั่ง broadcast ไปทุก team ได้
