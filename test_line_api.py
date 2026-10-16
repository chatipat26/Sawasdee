import sys
import requests

# ตั้งค่า encoding ของ stdout/stderr ให้รองรับ UTF-8 (ป้องกัน UnicodeEncodeError บน Windows CP874)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ข้อมูลการตั้งค่า LINE Messaging API
LINE_CHANNEL_ACCESS_TOKEN = (
    "V9Sc5Zmu4av4UzX+NbGNmkNCWM21aKchTJQw8ueOsGwilCWGv9c+AEqFtrKC4OG0fVwFy7l+"
    "wa5FVw0nrBGx8mz6zAHcdBY5hn4eBJApNwQ7oXOhSfgvzKHjxh6UGkqytCrLndQQAcVxcI+FFcGxMwdB04t89/1O/w1cDnyilFU="
)
LINE_TARGET_USER_ID = "Ub7b6353ba826c0ba5c3d9fac3531ef77"
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
LINE_BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast"


def send_line_broadcast_message(
    message: str,
    channel_access_token: str = LINE_CHANNEL_ACCESS_TOKEN
) -> bool:
    """
    ฟังก์ชันส่งข้อความบรอดแคสต์ไปยังทุกคนที่เป็นเพื่อนกับบอท (ไม่ต้องใช้ User ID)
    """
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {channel_access_token}"
    }

    payload = {
        "messages": [
            {
                "type": "text",
                "text": message
            }
        ]
    }

    try:
        response = requests.post(
            LINE_BROADCAST_URL,
            headers=headers,
            json=payload,
            timeout=10
        )
        if response.status_code == 200:
            print("✅ ส่งข้อความ Broadcast ผ่าน LINE สำเร็จเรียบร้อย! (Status: 200 OK)")
            return True
        else:
            print(f"⚠️ ไม่สามารถส่ง Broadcast ได้ (HTTP Status: {response.status_code})")
            print(f"รายละเอียด Response: {response.text}")
            return False
    except Exception as e:
        print(f"❌ เกิดข้อผิดพลาดขณะส่ง Broadcast: {e}")
        return False


def send_line_push_message(
    to_user_id: str,
    message: str,
    channel_access_token: str = LINE_CHANNEL_ACCESS_TOKEN
) -> bool:
    """
    ฟังก์ชันส่งข้อความแจ้งเตือนไปยังผู้ใช้หรือกลุ่มผ่าน LINE Messaging API (Push Message)

    :param to_user_id: User ID, Group ID หรือ Room ID ผู้รับ
    :param message: ข้อความที่ต้องการส่ง
    :param channel_access_token: LINE Channel Access Token
    :return: True หากส่งสำเร็จ, False หากเกิดข้อผิดพลาด
    """
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {channel_access_token}"
    }

    payload = {
        "to": to_user_id,
        "messages": [
            {
                "type": "text",
                "text": message
            }
        ]
    }

    try:
        response = requests.post(
            LINE_PUSH_URL,
            headers=headers,
            json=payload,
            timeout=10
        )
        
        # ตรวจสอบ HTTP Status Code (LINE จะตอบกลับ 200 OK หากสำเร็จ)
        if response.status_code == 200:
            print("✅ ส่งข้อความแจ้งเตือนผ่าน LINE สำเร็จเรียบร้อย! (Status: 200 OK)")
            return True
        else:
            print(f"⚠️ ไม่สามารถส่งข้อความได้ (HTTP Status: {response.status_code})")
            print(f"รายละเอียด Response: {response.text}")
            return False

    except requests.exceptions.Timeout:
        print("❌ เกิดข้อผิดพลาด: Request Timeout (หมดเวลาเชื่อมต่อกับ LINE Server)")
        return False
    except requests.exceptions.ConnectionError:
        print("❌ เกิดข้อผิดพลาด: Connection Error (ไม่สามารถเชื่อมต่ออินเทอร์เน็ตหรือ LINE API ได้)")
        return False
    except requests.exceptions.RequestException as e:
        print(f"❌ เกิดข้อผิดพลาดขณะส่ง Request ไปยัง LINE API: {e}")
        return False
    except Exception as e:
        print(f"❌ เกิดข้อผิดพลาดที่ไม่คาดคิด: {e}")
        return False


if __name__ == "__main__":
    # ข้อความทดสอบแจ้งเตือนแบบ Broadcast (ส่งหาเพื่อนทุกคน)
    test_message = "🚗 [Broadcast] ทดสอบระบบแจ้งเตือนงาน SawasdeeRental ส่งหาพนักงานทุกคน!"
    
    print("=" * 60)
    print("กำลังเริ่มทดสอบส่งข้อความแจ้งเตือนผ่าน LINE Broadcast API...")
    print("ผู้รับ: พนักงานทุกคนที่เป็นเพื่อนกับบอท")
    print(f"ข้อความ: {test_message}")
    print("=" * 60)

    # เรียกใช้งานฟังก์ชัน Broadcast
    success = send_line_broadcast_message(
        message=test_message
    )

    if success:
        print("🎉 ผลการทดสอบ: ส่งข้อความ Broadcast สำเร็จ 100% (ทุกคนที่เป็นเพื่อนได้รับข้อความ)")
    else:
        print("❌ ผลการทดสอบ: การทำงานไม่สำเร็จ กรุณาตรวจสอบ Token")
