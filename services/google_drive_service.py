"""
Google Drive Service for Sawasdee Rental
Automated upload and file organization for Google Drive API v3.
Target Folders:
- 1. พ.ร.บ. และ กรมธรรม์: 1cxfQEi9oHUIBBF4oMMHJgIvGu8fxOOEq
- 2. รูปรถยนต์ 4 มุม: 1V5S_j4dXQGuUW6zCAwQaXSkYJ9XNo-Mj
- 3. สลิปการโอนเงิน: 1BqKO4TXM4sJQ5_GzKdcVPTwE_qyiAsv8
"""

import os
import io
import json
import re
from datetime import datetime
from typing import Optional, Dict, Any, Union, Tuple

# Google Drive Target Folders (Strict System Rules)
FOLDER_INSURANCE_ACT = "1cxfQEi9oHUIBBF4oMMHJgIvGu8fxOOEq"
FOLDER_CAR_ANGLES = "1V5S_j4dXQGuUW6zCAwQaXSkYJ9XNo-Mj"
FOLDER_PAYMENT_SLIPS = "1BqKO4TXM4sJQ5_GzKdcVPTwE_qyiAsv8"

SCOPES = ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/drive.file"]

_drive_service_instance = None
_drive_credentials_info = None

def find_credentials_file() -> Optional[str]:
    """Locate Google Service Account credentials file from environment or candidate paths."""
    # 1. Standard Google environment variable
    env_app_cred = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if env_app_cred and os.path.exists(env_app_cred):
        return os.path.abspath(env_app_cred)

    # 2. Custom environment variable
    env_sa_file = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE")
    if env_sa_file and os.path.exists(env_sa_file):
        return os.path.abspath(env_sa_file)

    # 3. Candidate files in project root
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates = [
        "credentials.json",
        "service_account.json",
        "google_service_account.json",
        os.path.join(base_dir, "credentials.json"),
        os.path.join(base_dir, "service_account.json"),
        os.path.join(base_dir, "google_service_account.json"),
        os.path.join(os.getcwd(), "credentials.json"),
        os.path.join(os.getcwd(), "service_account.json"),
    ]
    for c in candidates:
        if os.path.exists(c) and os.path.isfile(c):
            return os.path.abspath(c)
    return None

def get_drive_service():
    """
    Build and return an authorized Google Drive API v3 service resource.
    Uses google-auth and google-api-python-client.
    """
    global _drive_service_instance, _drive_credentials_info
    if _drive_service_instance:
        return _drive_service_instance

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError as e:
        print(f"[GDrive] Missing required library: {e}")
        return None

    # Check for raw JSON string in environment variable
    raw_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if raw_json:
        try:
            info = json.loads(raw_json)
            creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
            _drive_credentials_info = info
            _drive_service_instance = build("drive", "v3", credentials=creds, cache_discovery=False)
            return _drive_service_instance
        except Exception as e:
            print(f"[GDrive] Error parsing GOOGLE_SERVICE_ACCOUNT_JSON: {e}")

    # Check for file
    cred_path = find_credentials_file()
    if cred_path:
        try:
            creds = service_account.Credentials.from_service_account_file(cred_path, scopes=SCOPES)
            with open(cred_path, "r", encoding="utf-8") as f:
                _drive_credentials_info = json.load(f)
            _drive_service_instance = build("drive", "v3", credentials=creds, cache_discovery=False)
            print(f"[GDrive] Successfully initialized Google Drive API client using {os.path.basename(cred_path)}")
            return _drive_service_instance
        except Exception as e:
            print(f"[GDrive] Error loading credentials from {cred_path}: {e}")

    return None

def is_drive_configured() -> bool:
    """Return True if Google Drive Service Account credentials are valid and ready."""
    return get_drive_service() is not None

def clean_plate_for_filename(plate: str) -> str:
    """Clean license plate text for filename safety."""
    if not plate:
        return "รถไม่ระบุ"
    cleaned = re.sub(r'[\s/\\:*?"<>|]', '', str(plate).strip())
    return cleaned or "รถไม่ระบุ"

def normalize_car_angle(angle_raw: Optional[str]) -> Tuple[str, str]:
    """
    Normalize car angle string to Thai name and DB column.
    Returns (thai_name, db_column)
    - front / หน้า -> ('หน้า', 'img_front')
    - left / ซ้าย  -> ('ซ้าย', 'img_left')
    - rear / หลัง  -> ('หลัง', 'img_rear')
    - right / ขวา  -> ('ขวา', 'img_right')
    """
    raw = str(angle_raw or "").strip().lower()
    if any(k in raw for k in ["front", "หน้า", "fore", "head"]):
        return "หน้า", "img_front"
    if any(k in raw for k in ["left", "ซ้าย"]):
        return "ซ้าย", "img_left"
    if any(k in raw for k in ["rear", "back", "หลัง"]):
        return "หลัง", "img_rear"
    if any(k in raw for k in ["right", "ขวา"]):
        return "ขวา", "img_right"
    return "หน้า", "img_front"

def build_car_filename(angle: Optional[str], plate: str, original_filename: Optional[str] = None, date_str: Optional[str] = None) -> Tuple[str, str]:
    """
    Build standardized car angle filename:
    รถ_[มุม(หน้า/ซ้าย/หลัง/ขวา)]_[ทะเบียนรถ]_[YYYYMMDD].[ext]
    (เช่น รถ_หน้า_5ขฒ5181_20261115.jpg)
    Returns: (file_name, db_column)
    """
    thai_angle, db_col = normalize_car_angle(angle)
    clean_p = clean_plate_for_filename(plate)
    if not date_str:
        date_str = datetime.now().strftime("%Y%m%d")
    else:
        date_str = re.sub(r'[^0-9]', '', str(date_str))[:8] or datetime.now().strftime("%Y%m%d")

    ext = "jpg"
    if original_filename and "." in original_filename:
        parsed_ext = original_filename.rsplit(".", 1)[-1].lower().strip()
        if parsed_ext in ["jpg", "jpeg", "png", "webp"]:
            ext = parsed_ext

    file_name = f"รถ_{thai_angle}_{clean_p}_{date_str}.{ext}"
    return file_name, db_col

def upload_image_to_drive(
    file: Any,
    folder_id: str = FOLDER_CAR_ANGLES,
    file_name: str = "car_photo.jpg",
    content_type: Optional[str] = "image/jpeg"
) -> Dict[str, Any]:
    """
    Upload an image file to Google Drive under specified folder and make it public (role: reader, type: anyone).
    Uses google-api-python-client (MediaIoBaseUpload) and google-auth.
    
    Parameters:
        file: UploadFile (FastAPI), bytes, BytesIO, or path string
        folder_id: Target Google Drive folder ID
        file_name: Target filename in Google Drive
        content_type: MIME type of the file
        
    Returns:
        {
            "success": bool,
            "file_id": str,
            "file_name": str,
            "webViewLink": str,
            "direct_url": str,
            "webContentLink": str,
            "folder_id": str,
            "is_gdrive": bool
        }
    """
    service = get_drive_service()
    if not service:
        return {
            "success": False,
            "error": "Google Drive credentials not configured. Please place credentials.json in project root or set GOOGLE_APPLICATION_CREDENTIALS.",
            "file_name": file_name,
            "folder_id": folder_id,
            "is_gdrive": False
        }

    try:
        from googleapiclient.http import MediaIoBaseUpload

        # 1. Read file bytes
        if hasattr(file, "read"):
            # Check if file has synchronous or asynchronous read
            res_bytes = file.read()
            if hasattr(res_bytes, "__await__"):
                import asyncio
                file_bytes = asyncio.run(res_bytes)
            else:
                file_bytes = res_bytes
        elif isinstance(file, (bytes, bytearray)):
            file_bytes = bytes(file)
        elif isinstance(file, str) and os.path.isfile(file):
            with open(file, "rb") as f:
                file_bytes = f.read()
        else:
            file_bytes = bytes(file)

        if not file_bytes:
            return {"success": False, "error": "File is empty (0 bytes)", "file_name": file_name}

        # 2. Prepare upload payload
        mime = content_type or "image/jpeg"
        media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime, resumable=True)
        file_metadata = {
            "name": file_name,
            "parents": [folder_id]
        }

        # 3. Execute Drive upload
        drive_file = service.files().create(
            body=file_metadata,
            media_body=media,
            fields="id, name, webViewLink, webContentLink"
        ).execute()

        file_id = drive_file.get("id")
        web_view_link = drive_file.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view?usp=sharing"
        direct_url = f"https://lh3.googleusercontent.com/d/{file_id}"

        # 4. Set Permission: Anyone with the link can view (reader)
        try:
            service.permissions().create(
                fileId=file_id,
                body={"role": "reader", "type": "anyone"},
                fields="id"
            ).execute()
        except Exception as perm_err:
            print(f"[GDrive] Warning setting public permission on file {file_id}: {perm_err}")

        return {
            "success": True,
            "file_id": file_id,
            "file_name": file_name,
            "webViewLink": web_view_link,
            "direct_url": direct_url,
            "webContentLink": drive_file.get("webContentLink"),
            "folder_id": folder_id,
            "is_gdrive": True
        }

    except Exception as e:
        err_msg = f"Exception during Google Drive upload: {e}"
        print(f"[GDrive] {err_msg}")
        return {
            "success": False,
            "error": err_msg,
            "file_name": file_name,
            "folder_id": folder_id,
            "is_gdrive": False
        }
