from sqlalchemy import Column, String, Numeric, Integer, Boolean, Text, DateTime, func
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Vehicle(Base):
    __tablename__ = "cars"

    plate = Column(String(50), primary_key=True, index=True)
    brand = Column(String(100), nullable=True)
    model = Column(String(100), nullable=True)
    car_group = Column(String(100), default="รถเก๋ง (Sedan/Hatchback)")
    fuel_system = Column(String(50), default="เบนซิน")
    cc_ev = Column(String(50), default="1200")
    owner_company = Column(String(150), default="Sawasdee Rent A Car")
    color = Column(String(50), default="-")
    mileage = Column(String(50), default="0")
    daily_rate = Column(Numeric, default=0.0)
    weekly_rate = Column(Numeric, default=0.0)
    monthly_rate = Column(Numeric, default=0.0)
    vin = Column(String(100), default="-")
    tax_expire_date = Column(String(50), default="-")
    prb_expire_date = Column(String(50), default="-")
    insurance_expire_date = Column(String(50), default="-")
    insurance_company = Column(String(150), default="-")
    car_owner = Column(String(150), default="-")
    beneficiary = Column(String(150), default="-")
    register_year = Column(String(50), default="-")
    prb_price = Column(Numeric, default=0.0)
    insurance_premium = Column(Numeric, default=0.0)
    last_service_date = Column(String(50), default="-")
    next_service_date = Column(String(50), default="-")
    next_service_mileage = Column(Numeric, default=0.0)
    car_status = Column(String(50), default="ว่างพร้อมใช้งาน")
    is_debt_free = Column(Boolean, default=False)
    finance_company = Column(String(150), default="-")
    installment_amount = Column(Numeric, default=0.0)
    total_installments = Column(Integer, default=0)
    current_installment = Column(Integer, default=0)
    payment_due_date = Column(String(50), default="-")
    notes = Column(Text, default="")
    image_url = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


Car = Vehicle


class Customer(Base):
    __tablename__ = "customers"

    full_name = Column(String(150), primary_key=True, index=True)
    phone_number = Column(String(50), nullable=True)
    id_card_no = Column(String(50), nullable=True)
    driver_license_no = Column(String(50), nullable=True)
    nationality = Column(String(50), default="THAI")
    whatsapp = Column(String(50), default="-")
    dob = Column(String(50), default="-")
    license_expire_date = Column(String(50), default="-")
    home_address = Column(Text, default="-")
    current_address = Column(Text, default="-")

    # Backward compatibility columns
    contact_no = Column(String(50), nullable=True)
    phone = Column(String(50), nullable=True)
    passport_id = Column(String(50), nullable=True)
    id_card = Column(String(50), nullable=True)
    licence_no = Column(String(50), nullable=True)
    driver_license = Column(String(50), nullable=True)
    licence_expiry = Column(String(50), default="-")
    thai_address = Column(Text, default="-")
    address = Column(Text, default="-")
    nickname = Column(String(100), nullable=True)
    email = Column(String(150), nullable=True)
    line_id = Column(String(100), nullable=True)
    line_user_id = Column(Text, nullable=True)
    notes = Column(Text, default="")
    id_card_photo = Column(Text, nullable=True)
    driver_license_photo = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class VehicleMaintenance(Base):
    __tablename__ = "vehicle_maintenances"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    car_id = Column(String(50), nullable=False, index=True)
    date = Column(String(50), nullable=False)
    description = Column(Text, nullable=False)
    cost = Column(Numeric, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

