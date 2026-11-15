"""
Sawasdee Rental - Google Drive API v3 Service
Automated upload and organization for:
1. ACT & Insurance policies (Folder: 1cxfQEi9oHUIBBF4oMMHJgIvGu8fxOOEq)
2. Car inspection photos 4 angles (Folder: 1V5S_j4dXQGuUW6zCAwQaXSkYJ9XNo-Mj)
3. Payment slips (Folder: 1BqKO4TXM4sJQ5_GzKdcVPTwE_qyiAsv8)
"""

import os
import json
import time
import re
from datetime import datetime
from typing import Optional, Dict, Any, Tuple
import requests

# =========================================================================
# GOOGLE DRIVE TARGET SUB-FOLDERS (Strict Routing Rules)
# =========================================================================
# โฟลเดอร์หลัก (Root App Folder: "Sawasdee App")
PARENT_APP_FOLDER = "10f_0dbowDOMPpDL59oAjnHBgLAzBHgHO"

# 1. โฟลเดอร์ "สัญญาเช่า"
# ใส่ Folder ID ของ [สัญญาเช่า] ตรงนี้ (หรือตั้งค่า GOOGLE_DRIVE_FOLDER_CONTRACT ใน .env / Render)
FOLDER_CONTRACTS = os.environ.get("GOOGLE_DRIVE_FOLDER_CONTRACT") or "ใส่ Folder ID ของ [สัญญาเช่า] ตรงนี้"

# 2. โฟลเดอร์ "ใบตรวจสภาพรถ"
# ใส่ Folder ID ของ [ใบตรวจสภาพรถ] ตรงนี้ (หรือตั้งค่า GOOGLE_DRIVE_FOLDER_INSPECTION ใน .env / Render)
FOLDER_INSPECTIONS = os.environ.get("GOOGLE_DRIVE_FOLDER_INSPECTION") or "ใส่ Folder ID ของ [ใบตรวจสภาพรถ] ตรงนี้"

# 3. โฟลเดอร์ "ใบเสร็จ"
# ใส่ Folder ID ของ [ใบเสร็จ] ตรงนี้ (หรือตั้งค่า GOOGLE_DRIVE_FOLDER_RECEIPT ใน .env / Render)
FOLDER_RECEIPTS = os.environ.get("GOOGLE_DRIVE_FOLDER_RECEIPT") or "ใส่ Folder ID ของ [ใบเสร็จ] ตรงนี้"

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

    if any(k in dt for k in ["contract", "agreement", "สัญญา", "สัญญาเช่า"]):
        if is_valid_folder_id(FOLDER_CONTRACTS):
            return FOLDER_CONTRACTS.strip()
    elif any(k in dt for k in ["inspection", "checkout", "checkin", "ตรวจสภาพ", "ตรวจรถ", "สภาพรถ", "job"]):
        if is_valid_folder_id(FOLDER_INSPECTIONS):
            return FOLDER_INSPECTIONS.strip()
    elif any(k in dt for k in ["receipt", "deposit-receipt", "ใบเสร็จ", "มัดจำ"]):
        if is_valid_folder_id(FOLDER_RECEIPTS):
            return FOLDER_RECEIPTS.strip()
    elif any(k in dt for k in ["car", "angle", "รถ", "มุม"]):
        if is_valid_folder_id(FOLDER_CAR_ANGLES):
            return FOLDER_CAR_ANGLES.strip()
    elif any(k in dt for k in ["insurance", "act", "กรมธรรม์", "พรบ", "พ.ร.บ."]):
        if is_valid_folder_id(FOLDER_INSURANCE_ACT):
            return FOLDER_INSURANCE_ACT.strip()
    elif any(k in dt for k in ["slip", "สลิป"]):
        if is_valid_folder_id(FOLDER_PAYMENT_SLIPS):
            return FOLDER_PAYMENT_SLIPS.strip()

    return PARENT_APP_FOLDER

def resolve_folder_id(folder_id: Optional[str] = None, doc_type: Optional[str] = None) -> str:
    """Resolve Google Drive destination folder ID with safe fallback."""
    if is_valid_folder_id(folder_id):
        return folder_id.strip()
    return get_target_folder_by_doctype(doc_type)

GOOGLE_APPS_SCRIPT_URL = os.environ.get(
    "GOOGLE_DRIVE_WEBHOOK_URL",
    "https://script.google.com/macros/s/AKfycbym7RQvghcv9rODPXp_Poc_wsAgR6sX1vQhchqSvW0P_QU7B5jPlZUiwMjGC2hnlUDlvg/exec"
)

DEFAULT_FOLDER_MAP = {
    "insurance": FOLDER_INSURANCE_ACT,
    "insurance_act": FOLDER_INSURANCE_ACT,
    "act": FOLDER_INSURANCE_ACT,
    "กรมธรรม์": FOLDER_INSURANCE_ACT,
    "พรบ": FOLDER_INSURANCE_ACT,
    
    "car": FOLDER_CAR_ANGLES,
    "car_angle": FOLDER_CAR_ANGLES,
    "car_photo": FOLDER_CAR_ANGLES,
    "inspection": FOLDER_INSPECTIONS,
    
    "slip": FOLDER_PAYMENT_SLIPS,
    "payment_slip": FOLDER_PAYMENT_SLIPS,
    "deposit_slip": FOLDER_PAYMENT_SLIPS,
    "rental_slip": FOLDER_PAYMENT_SLIPS,

    "contract": FOLDER_CONTRACTS,
    "agreement": FOLDER_CONTRACTS,
    "สัญญา": FOLDER_CONTRACTS,
    "สัญญาเช่า": FOLDER_CONTRACTS,

    "receipt": FOLDER_RECEIPTS,
    "ใบเสร็จ": FOLDER_RECEIPTS,
}

def clean_plate_for_filename(plate: str) -> str:
    """Clean license plate text for filename safety while retaining Thai letters & digits."""
    if not plate:
        return "รถไม่ระบุ"
    cleaned = str(plate).strip()
    cleaned = re.sub(r'[\s/\\:*?"<>|]', '', cleaned)
    return cleaned or "รถไม่ระบุ"

def clean_ref_for_filename(ref: str) -> str:
    """Clean booking ID or reference string for filename safety."""
    if not ref:
        return f"REF{int(time.time())}"
    cleaned = str(ref).strip()
    cleaned = re.sub(r'[\s/\\:*?"<>|]', '', cleaned)
    return cleaned or f"REF{int(time.time())}"

def normalize_angle_name(sub_type: Optional[str]) -> str:
    """Normalize car 4-angle identifier to Thai naming: หน้า, ซ้าย, หลัง, ขวา."""
    st = str(sub_type or "").strip().lower()
    if any(k in st for k in ["front", "หน้า", "หน้ารถ"]):
        return "หน้า"
    if any(k in st for k in ["left", "ซ้าย"]):
        return "ซ้าย"
    if any(k in st for k in ["rear", "back", "หลัง"]):
        return "หลัง"
    if any(k in st for k in ["right", "ขวา"]):
        return "ขวา"
    return "หน้า"

def normalize_insurance_type(sub_type: Optional[str]) -> str:
    """Normalize insurance document type to Thai naming: กรมธรรม์ or พรบ."""
    st = str(sub_type or "").strip().lower()
    if any(k in st for k in ["พรบ", "พ.ร.บ.", "act", "tax"]):
        return "พรบ"
    return "กรมธรรม์"

def build_gdrive_filename(
    category: str,
    ref_or_plate: str,
    sub_type: Optional[str] = None,
    original_filename: Optional[str] = None,
    date_str: Optional[str] = None
) -> str:
    """
    Build target Google Drive filename according to strict system rules:
    - 2.1 พ.ร.บ. / กรมธรรม์: [กรมธรรม์/พรบ]_[ทะเบียนรถ]_[YYYYMMDD] (เช่น กรมธรรม์_5ขฒ5181_20261115.jpg)
    - 2.2 รูปรถ 4 มุม: รถ_[มุม(หน้า/ซ้าย/หลัง/ขวา)]_[ทะเบียนรถ]_[YYYYMMDD] (เช่น รถ_หน้า_5ขฒ5181_20261115.jpg)
    - 2.3 สลิปการโอนเงิน: สลิป_[รหัสการจอง/อ้างอิง]_[YYYYMMDD] (เช่น สลิป_MRC261115141928_20261115.jpg)
    """
    ext = "jpg"
    if original_filename and "." in original_filename:
        ext = original_filename.rsplit(".", 1)[-1].lower().strip()
        if ext not in ["jpg", "jpeg", "png", "pdf", "webp"]:
            ext = "jpg"
            
    if not date_str:
        date_str = datetime.now().strftime("%Y%m%d")
    else:
        # Strip dashes or colons if provided as YYYY-MM-DD
        date_str = re.sub(r'[^0-9]', '', str(date_str))[:8] or datetime.now().strftime("%Y%m%d")

    cat_low = str(category or "slip").lower().strip()

    if cat_low in ["insurance", "insurance_act", "act", "กรมธรรม์", "พรบ"]:
        doc_type = normalize_insurance_type(sub_type)
        plate_clean = clean_plate_for_filename(ref_or_plate)
        return f"{doc_type}_{plate_clean}_{date_str}.{ext}"

    elif cat_low in ["car", "car_angle", "car_photo", "inspection"]:
        angle = normalize_angle_name(sub_type)
        plate_clean = clean_plate_for_filename(ref_or_plate)
        return f"รถ_{angle}_{plate_clean}_{date_str}.{ext}"

    else: # slip (default)
        ref_clean = clean_ref_for_filename(ref_or_plate)
        return f"สลิป_{ref_clean}_{date_str}.{ext}"

def get_gdrive_folder_id(category: str) -> str:
    """Resolve target Google Drive folder ID for the category."""
    return resolve_folder_id(None, category)


class GoogleDriveService:
    """
    Production-ready Google Drive API v3 client using Service Account credentials.
    Zero external dependencies beyond standard 'jwt' (PyJWT/cryptography) and 'requests'.
    """
    def __init__(self):
        self._service_account_info: Optional[Dict[str, Any]] = None
        self._access_token: Optional[str] = None
        self._token_expiry: float = 0.0
        self._load_credentials()

    def _load_credentials(self) -> None:
        """Locate and parse Google Service Account credentials."""
        # 1. Environment variable containing raw JSON
        raw_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
        if raw_json:
            try:
                self._service_account_info = json.loads(raw_json)
                return
            except Exception as e:
                print(f"[GDrive] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: {e}")

        # 2. Environment variable pointing to file path
        env_file = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE")
        if env_file and os.path.exists(env_file):
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    self._service_account_info = json.load(f)
                    return
            except Exception as e:
                print(f"[GDrive] Failed to read GOOGLE_SERVICE_ACCOUNT_FILE ({env_file}): {e}")

        # 3. Default search paths
        candidate_paths = [
            "service_account.json",
            "google_service_account.json",
            "credentials.json",
            "gdrive_credentials.json",
            os.path.join(os.path.dirname(__file__), "service_account.json"),
            os.path.join(os.path.dirname(__file__), "credentials.json")
        ]
        for path in candidate_paths:
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if data.get("type") == "service_account" or "private_key" in data:
                            self._service_account_info = data
                            return
                except Exception:
                    pass

    def is_configured(self) -> bool:
        """Check if valid Google Drive credentials or Webhook URL are configured."""
        if GOOGLE_APPS_SCRIPT_URL and "script.google.com" in GOOGLE_APPS_SCRIPT_URL:
            return True
        if self._service_account_info and self._service_account_info.get("private_key") and self._service_account_info.get("client_email"):
            return True
        return False

    def get_service_account_email(self) -> Optional[str]:
        if self._service_account_info:
            return self._service_account_info.get("client_email")
        return None

    def get_access_token(self) -> Optional[str]:
        """Obtain or refresh an OAuth2 access token for Google Drive API v3."""
        if not self.is_configured():
            return None

        # Reuse cached token if valid (buffer 60 seconds)
        now = time.time()
        if self._access_token and now < (self._token_expiry - 60):
            return self._access_token

        try:
            import jwt
            client_email = self._service_account_info["client_email"]
            private_key = self._service_account_info["private_key"]
            token_uri = self._service_account_info.get("token_uri", "https://oauth2.googleapis.com/token")

            payload = {
                "iss": client_email,
                "scope": "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.file",
                "aud": token_uri,
                "exp": int(now + 3600),
                "iat": int(now)
            }

            signed_jwt = jwt.encode(payload, private_key, algorithm="RS256")
            resp = requests.post(
                token_uri,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": signed_jwt
                },
                timeout=15
            )

            if resp.status_code != 200:
                print(f"[GDrive] Token exchange failed ({resp.status_code}): {resp.text}")
                return None

            token_data = resp.json()
            self._access_token = token_data.get("access_token")
            expires_in = float(token_data.get("expires_in", 3600))
            self._token_expiry = now + expires_in
            return self._access_token

        except Exception as e:
            print(f"[GDrive] Error obtaining access token: {e}")
            return None

    def make_file_public(self, file_id: str, access_token: str) -> bool:
        """Set file permission to anyone with link can view (reader)."""
        try:
            perm_url = f"https://www.googleapis.com/drive/v3/files/{file_id}/permissions"
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            body = {"role": "reader", "type": "anyone"}
            r = requests.post(perm_url, headers=headers, json=body, timeout=10)
            return r.status_code in [200, 201]
        except Exception as e:
            print(f"[GDrive] Failed to make file {file_id} public: {e}")
            return False

    def upload_file(
        self,
        file_bytes: bytes,
        category: str = "slip",
        ref_or_plate: str = "unknown",
        sub_type: Optional[str] = None,
        original_filename: Optional[str] = None,
        content_type: str = "image/jpeg",
        date_str: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Upload file to Google Drive under specified category folder with standardized naming.
        Returns:
            {
                "success": bool,
                "file_id": str,
                "filename": str,
                "webViewLink": str,
                "direct_url": str,
                "folder_id": str
            }
        """
        target_filename = build_gdrive_filename(
            category=category,
            ref_or_plate=ref_or_plate,
            sub_type=sub_type,
            original_filename=original_filename,
            date_str=date_str
        )
        folder_id = get_gdrive_folder_id(category)

        if target_filename.lower().endswith(".pdf"):
            content_type = "application/pdf"
            if len(file_bytes) < 50 or not file_bytes.startswith(b"%PDF"):
                return {
                    "success": False,
                    "error": f"Invalid or corrupted PDF content ({len(file_bytes)} bytes). Proper PDF header required.",
                    "filename": target_filename
                }

        # 1. Priority Method: Google Apps Script Webhook (uses personal 5 TB Google One storage directly)
        if GOOGLE_APPS_SCRIPT_URL and "script.google.com" in GOOGLE_APPS_SCRIPT_URL:
            try:
                import base64
                b64_str = base64.b64encode(file_bytes).decode("utf-8")
                payload = {
                    "folder_id": folder_id,
                    "file_name": target_filename,
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
                            "filename": target_filename,
                            "webViewLink": res_json.get("webViewLink"),
                            "direct_url": res_json.get("direct_url") or f"https://lh3.googleusercontent.com/d/{res_json.get('file_id')}",
                            "folder_id": folder_id,
                            "is_gdrive": True
                        }
                    else:
                        print(f"[GDrive] Apps Script upload returned error: {res_json.get('error')}")
            except Exception as e:
                print(f"[GDrive] Apps Script upload exception: {e}")

        # 2. Method B: Direct Google Drive API v3 (Service Account)
        token = self.get_access_token()
        if not token:
            return {
                "success": False,
                "error": "Google Drive credentials not configured or failed to obtain access token.",
                "filename": target_filename,
                "folder_id": folder_id
            }

        try:
            metadata = {
                "name": target_filename,
                "parents": [folder_id]
            }

            upload_url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink"
            headers = {"Authorization": f"Bearer {token}"}

            files = {
                "data": ("metadata", json.dumps(metadata), "application/json; charset=UTF-8"),
                "file": (target_filename, file_bytes, content_type or "image/jpeg")
            }

            resp = requests.post(upload_url, headers=headers, files=files, timeout=30)
            if resp.status_code not in [200, 201]:
                err_msg = f"GDrive upload returned {resp.status_code}: {resp.text}"
                print(f"[GDrive] {err_msg}")
                return {"success": False, "error": err_msg, "filename": target_filename}

            res_json = resp.json()
            file_id = res_json.get("id")
            web_view_link = res_json.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view?usp=sharing"
            direct_url = f"https://lh3.googleusercontent.com/d/{file_id}"

            # Make readable by link
            self.make_file_public(file_id, token)

            return {
                "success": True,
                "file_id": file_id,
                "filename": target_filename,
                "webViewLink": web_view_link,
                "direct_url": direct_url,
                "folder_id": folder_id
            }

        except Exception as e:
            err_msg = f"Exception during Google Drive upload: {e}"
            print(f"[GDrive] {err_msg}")
            return {"success": False, "error": err_msg, "filename": target_filename}


# Global singleton instance
gdrive_service = GoogleDriveService()


# Expose PDF and service functions for seamless cross-import
try:
    from services.google_drive_service import (
        upload_pdf_to_drive,
        build_pdf_filename,
        upload_image_to_drive,
        PARENT_APP_FOLDER,
        FOLDER_CONTRACTS,
        FOLDER_INSPECTIONS,
        FOLDER_RECEIPTS
    )
except ImportError:
    pass
