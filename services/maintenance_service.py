"""
Maintenance and work order business services for SawasdeeRental.
"""

from typing import Optional


def execute_hard_delete_work_order_db(clean_id: str, found_car_id: Optional[str] = None):
    """Execute SQL hard delete in work_order_logs and revert car status in 1 atomic transaction."""
    try:
        from database import engine
        from sqlalchemy import text
        if engine:
            with engine.begin() as conn:
                # 1. Hard delete from work_order_logs
                conn.execute(
                    text("DELETE FROM public.work_order_logs WHERE id = :id OR booking_id = :id"),
                    {"id": clean_id}
                )
                conn.execute(
                    text("DELETE FROM public.work_order_logs WHERE description LIKE :pat"),
                    {"pat": f"%{clean_id}%"}
                )
                # 2. Hard delete from maintenance_records, maintenance_logs, vehicle_maintenances
                conn.execute(text("DELETE FROM public.maintenance_records WHERE id = :id"), {"id": clean_id})
                conn.execute(text("DELETE FROM public.maintenance_logs WHERE id = :id"), {"id": clean_id})
                try:
                    conn.execute(text("DELETE FROM public.vehicle_maintenances WHERE id::text = :id"), {"id": clean_id})
                except Exception:
                    pass

                # 3. Revert car status in cars table if car_id is identified
                if found_car_id:
                    conn.execute(
                        text("""
                            UPDATE public.cars 
                            SET car_status = 'ว่างพร้อมใช้งาน' 
                            WHERE (plate = :car_id OR plate = REPLACE(:car_id, ' ', ''))
                              AND car_status IN ('ซ่อมบำรุง', 'ต่อทะเบียน/ประกัน', 'สถานะซ่อมบำรุง', 'กำลังซ่อมบำรุง', 'กำลังต่อภาษี/ประกัน')
                        """),
                        {"car_id": found_car_id}
                    )
                    try:
                        conn.execute(
                            text("""
                                UPDATE public.cars 
                                SET status = 'ว่างพร้อมใช้งาน' 
                                WHERE (plate = :car_id OR plate = REPLACE(:car_id, ' ', ''))
                                  AND status IN ('ซ่อมบำรุง', 'ต่อทะเบียน/ประกัน', 'สถานะซ่อมบำรุง', 'กำลังซ่อมบำรุง', 'กำลังต่อภาษี/ประกัน')
                            """),
                            {"car_id": found_car_id}
                        )
                    except Exception:
                        pass
                    # Clean up any remaining orphan maintenance work orders for this car
                    conn.execute(
                        text("""
                            DELETE FROM public.work_order_logs 
                            WHERE car_id = :car_id 
                              AND work_type IN ('Maintenance', 'Renew Tax')
                              AND (booking_id IS NULL OR booking_id = '' OR booking_id = :id)
                        """),
                        {"car_id": found_car_id, "id": clean_id}
                    )
    except Exception as e:
        print(f"SQLAlchemy hard_delete error: {e}")
