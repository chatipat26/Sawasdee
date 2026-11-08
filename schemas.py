from datetime import datetime
from typing import Union
from typing import Optional, Any
from pydantic import BaseModel, Field, ConfigDict


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
