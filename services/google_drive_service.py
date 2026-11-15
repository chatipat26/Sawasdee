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

# =========================================================================
# GOOGLE DRIVE TARGET SUB-FOLDERS (Strict Routing Rules)
# =========================================================================
# โฟลเดอร์หลัก (Root App Folder: "Sawasdee App")
PARENT_APP_FOLDER = "10f_0dbowDOMPpDL59oAjnHBgLAzBHgHO"

# 1. โฟลเดอร์ "สัญญาเช่า"
FOLDER_CONTRACTS = os.environ.get("GOOGLE_DRIVE_FOLDER_CONTRACT") or "1qydIOqXvi0YwTOkxGe6YOidNezLsZzzd"

# 2. โฟลเดอร์ "ใบตรวจสภาพรถ"
FOLDER_INSPECTIONS = os.environ.get("GOOGLE_DRIVE_FOLDER_INSPECTION") or "1uLqzNziLyx03aK0Ny0iiuKYHWj2QNUZl"

# 3. โฟลเดอร์ "ใบเสร็จ"
FOLDER_RECEIPTS = os.environ.get("GOOGLE_DRIVE_FOLDER_RECEIPT") or "1fR4ZtkfJJSEo6NzLKtyDD5EaiZpWWdC6"

# 4. โฟลเดอร์ "รถ" (รูปรถยนต์ 4 มุม)
# ใส่ Folder ID ของ [รถ] ตรงนี้
FOLDER_CAR_ANGLES = os.environ.get("GOOGLE_DRIVE_FOLDER_CAR_ANGLES") or "1V5S_j4dXQGuUW6zCAwQaXSkYJ9XNo-Mj"

# 5. โฟลเดอร์ "กรมธรรม์ประกันภัย" (พ.ร.บ. และ กรมธรรม์)
# ใส่ Folder ID ของ [กรมธรรม์ประกันภัย] ตรงนี้
FOLDER_INSURANCE_ACT = os.environ.get("GOOGLE_DRIVE_FOLDER_INSURANCE") or "1cxfQEi9oHUIBBF4oMMHJgIvGu8fxOOEq"

# 6. โฟลเดอร์ "สลิปการเงิน"
# ใส่ Folder ID ของ [สลิปการเงิน] ตรงนี้
FOLDER_PAYMENT_SLIPS = os.environ.get("GOOGLE_DRIVE_FOLDER_PAYMENT_SLIPS") or "1BqKO4TXM4sJQ5_GzKdcVPTwE_qyiAsv8"

def is_valid_folder_id(fid: Optional[str]) -> bool:
    """Validate if folder ID is a legitimate alphanumeric Google Drive ID."""
    if not fid or not isinstance(fid, str):
        return False
    s = fid.strip()
    if "ใส่" in s or "ตรงนี้" in s or len(s) < 15:
        return False
    return True

def get_target_folder_by_doctype(doc_type: Optional[str] = None) -> str:
    """
    Map document or upload category to target Google Drive Sub-folder ID:
    - สัญญาเช่า -> FOLDER_CONTRACTS
    - ใบตรวจสภาพรถ -> FOLDER_INSPECTIONS
    - ใบเสร็จ -> FOLDER_RECEIPTS
    - รูปรถยนต์ 4 มุม -> FOLDER_CAR_ANGLES
    - พ.ร.บ. / กรมธรรม์ -> FOLDER_INSURANCE_ACT
    - สลิปการโอนเงิน -> FOLDER_PAYMENT_SLIPS
    """
    if not doc_type:
        return PARENT_APP_FOLDER

    dt = str(doc_type).lower().strip()

    # 1. สัญญาเช่า (Contracts)
    if any(k in dt for k in ["contract", "agreement", "สัญญา", "สัญญาเช่า"]):
        if is_valid_folder_id(FOLDER_CONTRACTS):
            return FOLDER_CONTRACTS.strip()

    # 2. ใบตรวจสภาพรถ (Inspections / Job Sheet / Checkout / Checkin)
    elif any(k in dt for k in ["inspection", "checkout", "checkin", "ตรวจสภาพ", "ตรวจรถ", "สภาพรถ", "job"]):
        if is_valid_folder_id(FOLDER_INSPECTIONS):
            return FOLDER_INSPECTIONS.strip()

    # 3. ใบเสร็จรับเงิน (Receipts / Deposit Receipt)
    elif any(k in dt for k in ["receipt", "deposit-receipt", "ใบเสร็จ", "มัดจำ"]):
        if is_valid_folder_id(FOLDER_RECEIPTS):
            return FOLDER_RECEIPTS.strip()

    # 4. รูปรถ 4 มุม
    elif any(k in dt for k in ["car", "angle", "รถ", "มุม"]):
        if is_valid_folder_id(FOLDER_CAR_ANGLES):
            return FOLDER_CAR_ANGLES.strip()

    # 5. พ.ร.บ. / กรมธรรม์
    elif any(k in dt for k in ["insurance", "act", "กรมธรรม์", "พรบ", "พ.ร.บ."]):
        if is_valid_folder_id(FOLDER_INSURANCE_ACT):
            return FOLDER_INSURANCE_ACT.strip()

    # 6. สลิปการโอนเงิน
    elif any(k in dt for k in ["slip", "สลิป"]):
        if is_valid_folder_id(FOLDER_PAYMENT_SLIPS):
            return FOLDER_PAYMENT_SLIPS.strip()

    return PARENT_APP_FOLDER

def resolve_folder_id(folder_id: Optional[str] = None, doc_type: Optional[str] = None) -> str:
    """
    Resolve Google Drive destination folder ID:
    Prioritizes valid folder_id, then maps from doc_type, falling back safely to root app folder.
    """
    if is_valid_folder_id(folder_id):
        return folder_id.strip()
    return get_target_folder_by_doctype(doc_type)

GOOGLE_APPS_SCRIPT_URL = os.environ.get(
    "GOOGLE_DRIVE_WEBHOOK_URL",
    "https://script.google.com/macros/s/AKfycbym7RQvghcv9rODPXp_Poc_wsAgR6sX1vQhchqSvW0P_QU7B5jPlZUiwMjGC2hnlUDlvg/exec"
)

try:
    from googleapiclient.http import MediaIoBaseUpload
except ImportError:
    MediaIoBaseUpload = None

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
    """Return True if Google Drive integration is configured via Apps Script Webhook or Service Account."""
    if GOOGLE_APPS_SCRIPT_URL and "script.google.com" in GOOGLE_APPS_SCRIPT_URL:
        return True
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
    # 1. Read file bytes with seek(0) rewind safety
    try:
        if hasattr(file, "seek"):
            try:
                file.seek(0)
            except Exception:
                pass

        if hasattr(file, "read"):
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
    except Exception as e:
        return {"success": False, "error": f"Error reading file bytes: {e}", "file_name": file_name}

    if not file_bytes or len(file_bytes) == 0:
        return {"success": False, "error": "File is empty (0 bytes)", "file_name": file_name}

    # Safeguard: Validate PDF header and MIME type
    if file_name.lower().endswith(".pdf"):
        content_type = "application/pdf"
        if len(file_bytes) < 50 or not file_bytes.startswith(b"%PDF"):
            return {
                "success": False,
                "error": f"Invalid or corrupted PDF content ({len(file_bytes)} bytes). Proper PDF header required.",
                "file_name": file_name
            }

    # Resolve destination folder ID: Check folder_id validity -> Doc Type mapping -> Fallback to Root
    target_folder = resolve_folder_id(folder_id, file_name)

    # 2. Priority Method: Google Apps Script Web App (Executes under personal 5 TB Google One storage directly)
    if GOOGLE_APPS_SCRIPT_URL and "script.google.com" in GOOGLE_APPS_SCRIPT_URL:
        try:
            import base64
            import requests

            b64_str = base64.b64encode(file_bytes).decode("utf-8")
            payload = {
                "folder_id": target_folder,
                "file_name": file_name,
                "mime_type": content_type or "image/jpeg",
                "file_base64": b64_str
            }
            resp = requests.post(GOOGLE_APPS_SCRIPT_URL, json=payload, timeout=35, allow_redirects=True)
            if resp.status_code == 200:
                res_json = resp.json()
                if res_json.get("success"):
                    return {
                        "success": True,
                        "file_id": res_json.get("file_id"),
                        "file_name": file_name,
                        "webViewLink": res_json.get("webViewLink"),
                        "direct_url": res_json.get("direct_url") or f"https://lh3.googleusercontent.com/d/{res_json.get('file_id')}",
                        "webContentLink": res_json.get("webContentLink"),
                        "folder_id": target_folder,
                        "is_gdrive": True
                    }
                else:
                    print(f"[GDrive] Apps Script returned error: {res_json.get('error')}")
            else:
                print(f"[GDrive] Apps Script returned status {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"[GDrive] Notice: Apps Script upload exception: {e}")

    # 3. Method B: Direct Google Drive API v3 (Service Account / Shared Drive)
    try:
        service = get_drive_service()
        if not service:
            return {
                "success": False,
                "error": "Google Drive credentials not configured. Please place credentials.json in project root or configure GOOGLE_DRIVE_WEBHOOK_URL.",
                "file_name": file_name,
                "folder_id": target_folder,
                "is_gdrive": False
            }

        # 2. Prepare upload payload with specific parents folder
        mime = content_type or "image/jpeg"
        media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime, resumable=True)
        file_metadata = {
            "name": file_name,
            "parents": [target_folder]
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
            "folder_id": target_folder,
            "is_gdrive": True
        }

    except Exception as e:
        err_msg = f"Exception during Google Drive upload: {e}"
        print(f"[GDrive] {err_msg}")
        return {
            "success": False,
            "error": err_msg,
            "file_name": file_name,
            "folder_id": target_folder,
            "is_gdrive": False
        }


def build_pdf_filename(doc_type: str, ref_id: str, date_str: Optional[str] = None) -> str:
    """
    Build standardized PDF filename for Google Drive:
    Format: [ประเภทเอกสาร]_[รหัสการจอง/เลขที่อ้างอิง]_[YYYYMMDD].pdf
    Examples:
    - สัญญาเช่า_MRC261115141928_20261115.pdf
    - ใบตรวจสภาพรถ_MRC261115141928_20261115.pdf
    - ใบเสร็จ_MRC261115141928_20261115.pdf
    """
    clean_ref = re.sub(r'[\s/\\:*?"<>|]', '', str(ref_id or "REF")).strip()
    if not date_str:
        date_str = datetime.now().strftime("%Y%m%d")
    clean_type = str(doc_type or "เอกสาร").strip()
    return f"{clean_type}_{clean_ref}_{date_str}.pdf"


def upload_pdf_to_drive(
    file_bytes: Union[bytes, bytearray],
    folder_id: Optional[str] = None,
    file_name: str = "document.pdf",
    doc_type: Optional[str] = None
) -> Dict[str, Any]:
    """Upload generated PDF bytes to Google Drive with MIME type application/pdf and automated sub-folder routing."""
    target_folder = resolve_folder_id(folder_id, doc_type or file_name)
    return upload_image_to_drive(
        file=file_bytes,
        folder_id=target_folder,
        file_name=file_name,
        content_type="application/pdf"
    )
