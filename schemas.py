import json
from datetime import datetime, date
from typing import Union
from typing import Optional, Any
from pydantic import BaseModel, Field, ConfigDict, field_validator


class VehicleBase(BaseModel):
    plate: str
    brand: str
    model: str
    car_group: Optional[str] = "รถเก๋ง (Sedan/Hatchback)"
    fuel_system: Optional[str] = "เบนซิน"
    cc_ev: Optional[str] = "1200"
    owner_company: Optional[str] = "Sawasdee Rent A Car"
    color: Optional[str] = "-"
    mileage: Optional[str] = "0"
    daily_rate: Optional[float] = 1000.0
    weekly_rate: Optional[float] = 6000.0
    monthly_rate: Optional[float] = 20000.0
    vin: Optional[str] = "-"
    tax_expire_date: Optional[str] = "-"
    prb_expire_date: Optional[str] = "-"
    insurance_expire_date: Optional[str] = "-"
    insurance_company: Optional[str] = "-"
    car_owner: Optional[str] = "-"
    beneficiary: Optional[str] = "-"
    register_year: Optional[str] = "-"
    prb_price: Optional[float] = 0.0
    insurance_premium: Optional[float] = 0.0
    last_service_date: Optional[str] = "-"
    next_service_date: Optional[str] = "-"
    next_service_mileage: Optional[float] = 0.0
    car_status: Optional[str] = "ว่างพร้อมใช้งาน"
    is_debt_free: Optional[bool] = False
    finance_company: Optional[str] = "-"
    installment_amount: Optional[float] = 0.0
    total_installments: Optional[int] = 0
    current_installment: Optional[int] = 0
    payment_due_date: Optional[str] = "-"
    notes: Optional[str] = ""
    image_url: Optional[str] = ""

    # Backward compatibility / Frontend payload aliases
    reg_year: Optional[str] = "-"
    ins_company: Optional[str] = "-"
    act_price: Optional[float] = 0.0
    ins_premium: Optional[float] = 0.0
    next_engine_oil_mileage: Optional[float] = 0.0
    next_engine_oil_date: Optional[str] = "-"
    chassis_no: Optional[str] = "-"
    tax_expiry: Optional[str] = "-"
    act_expiry: Optional[str] = "-"
    ins_expiry: Optional[str] = "-"
    fuel_type: Optional[str] = "เบนซิน"
    engine_cc: Optional[str] = "1200"
    company: Optional[str] = "Sawasdee Rent A Car"
    owner: Optional[str] = "-"
    price_day: Optional[float] = 1000.0
    price_week: Optional[float] = 6000.0
    price_month: Optional[float] = 20000.0
    status: Optional[str] = "ว่างพร้อมใช้งาน"
    image: Optional[str] = ""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class VehicleCreate(VehicleBase):
    finance_company: Optional[str] = None
    installment_amount: Optional[float] = 0.0
    total_installments: Optional[int] = 0
    current_installment: Optional[int] = 0
    payment_due_date: Optional[str] = None
    next_service_mileage: Optional[float] = 0.0
    is_debt_free: Optional[bool] = False


class VehicleUpdate(VehicleBase):
    plate: Optional[str] = None
    finance_company: Optional[str] = None
    installment_amount: Optional[float] = 0.0
    total_installments: Optional[int] = 0
    current_installment: Optional[int] = 0
    payment_due_date: Optional[str] = None
    next_service_mileage: Optional[float] = 0.0
    is_debt_free: Optional[bool] = False


class VehicleResponse(VehicleBase):
    finance_company: Optional[str] = None
    installment_amount: Optional[float] = 0.0
    total_installments: Optional[int] = 0
    current_installment: Optional[int] = 0
    payment_due_date: Optional[str] = None
    next_service_mileage: Optional[float] = 0.0
    is_debt_free: Optional[bool] = False


# Strict 1:1 Aliases for Car/Vehicle
CarBase = VehicleBase
CarCreate = VehicleCreate
CarUpdate = VehicleUpdate
CarResponse = VehicleResponse


class CustomerBase(BaseModel):
    full_name: str
    phone_number: Optional[str] = "-"
    id_card_no: Optional[str] = "-"
    driver_license_no: Optional[str] = "-"
    nationality: Optional[str] = "THAI"
    whatsapp: Optional[str] = "-"
    dob: Optional[str] = "-"
    license_expire_date: Optional[str] = "-"
    home_address: Optional[str] = "-"
    current_address: Optional[str] = "-"

    # Backward compatibility aliases
    contact_no: Optional[str] = "-"
    phone: Optional[str] = "-"
    passport_id: Optional[str] = "-"
    id_card: Optional[str] = "-"
    licence_no: Optional[str] = "-"
    driver_license: Optional[str] = "-"
    licence_expiry: Optional[str] = "-"
    thai_address: Optional[str] = "-"
    address: Optional[str] = "-"
    nickname: Optional[str] = None
    email: Optional[str] = "-"
    line_id: Optional[str] = "-"
    line_user_id: Optional[str] = None
    notes: Optional[str] = ""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(CustomerBase):
    full_name: Optional[str] = None


class CustomerResponse(CustomerBase):
    pass


class WorkOrderCreate(BaseModel):
    booking_id: Optional[str] = None
    car_id: Optional[str] = None
    work_type: Optional[str] = "Dispatch"  # 'Dispatch' or 'Return'
    staff_id: Optional[str] = None
    appointment_datetime: Optional[Union[datetime, str]] = None
    location: Optional[str] = None
    job_status: Optional[str] = "Pending"
    description: Optional[str] = None
    cost: Optional[float] = 0.0


class WorkOrderResponse(BaseModel):
    id: str
    booking_id: Optional[str] = None
    car_id: Optional[str] = None
    work_type: Optional[str] = None
    staff_id: Optional[str] = None
    appointment_datetime: Optional[Union[datetime, str]] = None
    location: Optional[str] = None
    job_status: Optional[str] = "Pending"
    description: Optional[str] = None
    cost: Optional[float] = 0.0
    created_at: Optional[Union[datetime, str]] = None


class BookingBase(BaseModel):
    booking_id: Optional[str] = None
    car_id: Optional[str] = None
    customer: Optional[str] = None
    start_date: Optional[Union[date, str]] = None
    start_time: Optional[str] = "09:00"
    end_date: Optional[Union[date, str]] = None
    end_time: Optional[str] = "09:00"
    total_days: Optional[float] = 1.0
    daily_rate: Optional[float] = 0.0
    total_price: Optional[float] = 0.0
    base_price: Optional[float] = 0.0
    discount: Optional[float] = 0.0
    net_price: Optional[float] = 0.0
    deposit_paid: Optional[bool] = False
    deposit_amount: Optional[float] = 5000.0
    deposit_payment_method: Optional[str] = "เงินสด"
    rental_paid: Optional[bool] = False
    rental_amount_paid: Optional[float] = 0.0
    remaining_rental: Optional[float] = 0.0
    rental_payment_method: Optional[str] = "เงินสด"
    status: Optional[str] = "รอชำระมัดจำ"
    loc_delivery: Optional[str] = "Sukhumvit"
    loc_return: Optional[str] = "Sukhumvit"
    worker_delivery: Optional[str] = None
    worker_return: Optional[str] = None
    dispatch_closed: Optional[bool] = False
    return_closed: Optional[bool] = False
    dispatch_date: Optional[Union[datetime, str]] = None
    return_date: Optional[Union[datetime, str]] = None
    dispatch_mileage: Optional[str] = None
    return_mileage: Optional[str] = None
    dispatch_fuel: Optional[str] = None
    return_fuel: Optional[str] = None
    dispatch_notes: Optional[str] = None
    return_notes: Optional[str] = None
    dispatch_photos: Optional[Union[list, dict, str]] = Field(default_factory=list)
    return_photos: Optional[Union[list, dict, str]] = Field(default_factory=list)
    payment_slip_url: Optional[str] = None
    payment_type: Optional[str] = None
    google_drive_link: Optional[str] = None
    contract_issued: Optional[bool] = False
    contract_type: Optional[str] = "รายวัน"
    extension_history: Optional[Union[list, dict, str]] = Field(default_factory=list)
    is_fully_paid: Optional[bool] = False
    contract_pdf_url: Optional[str] = None
    checkout_pdf_url: Optional[str] = None
    checkin_pdf_url: Optional[str] = None
    inspection_categories: Optional[Union[dict, list, str]] = None
    inspection_categories_out: Optional[Union[dict, list, str]] = None
    inspection_categories_in: Optional[Union[dict, list, str]] = None
    created_by: Optional[str] = "admin"
    created_at: Optional[Union[datetime, str]] = None

    @field_validator("extension_history", "dispatch_photos", "return_photos", mode="before")
    @classmethod
    def parse_json_list(cls, v):
        if v is None:
            return []
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, list) else [parsed]
            except Exception:
                return []
        if isinstance(v, list):
            return v
        return [v]

    @field_validator("is_fully_paid", mode="before")
    @classmethod
    def parse_bool_paid(cls, v):
        if v is None:
            return False
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.strip().lower() in ("true", "1", "yes", "t", "y")
        return bool(v)

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class BookingCreate(BookingBase):
    pass


class BookingUpdate(BookingBase):
    pass


class BookingResponse(BookingBase):
    pass
