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
    installment_amount: Optional[float] = 0.0
    total_installments: Optional[int] = 0
    current_installment: Optional[int] = 0
    payment_due_date: Optional[str] = "-"
    finance_company: Optional[str] = "-"
    notes: Optional[str] = ""
    image_url: Optional[str] = ""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class VehicleCreate(VehicleBase):
    pass


class VehicleUpdate(VehicleBase):
    pass


class VehicleResponse(VehicleBase):
    pass


class CustomerBase(BaseModel):
    full_name: str
    contact_no: Optional[str] = "-"
    phone: Optional[str] = "-"
    passport_id: Optional[str] = "-"
    id_card: Optional[str] = "-"
    licence_no: Optional[str] = "-"
    driver_license: Optional[str] = "-"
    nationality: Optional[str] = "THAI"
    whatsapp: Optional[str] = "-"
    dob: Optional[str] = "-"
    licence_expiry: Optional[str] = "-"
    home_address: Optional[str] = "-"
    address: Optional[str] = "-"
    thai_address: Optional[str] = "-"
    line_id: Optional[str] = "-"
    line_user_id: Optional[str] = None
    notes: Optional[str] = ""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(CustomerBase):
    pass


class CustomerResponse(CustomerBase):
    pass
