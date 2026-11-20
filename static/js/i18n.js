/**
 * Sawasdee Rental - i18n & Dual-Language (TH / EN) Engine
 * Prototype Mixin for App
 */
Object.assign(App.prototype, {
  t(key, fallback = "") {
    if (!window.translations) {
      window.translations = {
        TH: {
          available: "ว่างพร้อมใช้งาน",
          reserved: "ติดจอง",
          workshop: "ซ่อมบำรุง",
          on_rent: "กำลังเช่า",
          daily_rate: "ค่าเช่ารายวัน",
          days: "วัน",
          details: "ดูรายละเอียด",
          book_now: "จองรถ",
          queue: "จองคิว",
          add_customer: "เพิ่มลูกค้า",
          add_vehicle: "เพิ่มรถยนต์",
          quick_actions: "ปุ่มดำเนินการด่วน:",
          car_details_modal_title: "รายละเอียดรถยนต์",
          prb_price: "ราคา พ.ร.บ. (บาท)",
          insurance_premium: "เบี้ยประกัน (บาท)",
          duplicate_vehicle_error: "ข้อมูลซ้ำ: พบเลขทะเบียนหรือเลขตัวถังนี้ในระบบแล้ว",
          filter_by_staff: "กรองพนักงาน:",
          all_staff: "พนักงานทั้งหมด (All Staff)",
          calendar_view: "ปฏิทิน",
          table_view: "ตาราง",
          dispatch: "ส่งมอบรถ (Dispatch)",
          return_job: "รับรถคืน (Return)",
          insurance: "ประกันภัย",
          act: "พ.ร.บ.",
          tax: "ภาษี",
          in_days: "เหลือ {days} วัน",
          overdue_days: "เกินกำหนด {days} วัน",
          due_today: "หมดอายุวันนี้",
          red_plate: "ป้ายแดง",
          finance_company: "บริษัทไฟแนนซ์",
          select_or_enter_finance: "เลือกจากรายการ หรือพิมพ์ชื่อบริษัทไฟแนนซ์ใหม่...",
          next_engine_oil_date: "กำหนดถ่ายน้ำมันเครื่องครั้งต่อไป (วันที่)",
          next_engine_oil_mileage: "กำหนดถ่ายน้ำมันเครื่องครั้งต่อไป (เลขไมล์)",
          next_tire_change_date: "กำหนดเปลี่ยนยางครั้งต่อไป (วันที่)",
          next_tire_change_mileage: "กำหนดเปลี่ยนยางครั้งต่อไป (เลขไมล์)",
          next_service_date: "กำหนดเช็คระยะครั้งต่อไป (วันที่)",
          next_service_mileage: "กำหนดเช็คระยะครั้งต่อไป (เลขไมล์)",
          service_interval_header: "กำหนดการเช็คระยะ (น้ำมันเครื่อง & ยาง)",
          view_details_or_book: "ดูรายละเอียด / จองรถ",
          booking_bar_title: "เลือกรถยนต์ & จองด่วน (Instant Booking Bar)",
          booking_bar_subtitle: "เลือกวันรับ - คืนรถ (คำนวณระยะเวลาเช่าอัตโนมัติ)",
          category: "หมวดหมู่รถ",
          brand: "ยี่ห้อ",
          company: "บริษัท / สังกัด",
          status: "สถานะรถ",
          all: "ทั้งหมด",
          pickup_date: "วันรับรถ (Pick-up)",
          return_date: "วันคืนรถ (Return)",
          reset_filters: "ล้างตัวกรอง",
          rental_duration: "ระยะเวลาเช่า:",
          available_fleet: "ว่างพร้อมใช้งาน:",
          hide_filters: "ซ่อนตัวกรอง ▴",
          show_filters: "แสดงตัวกรอง ▾",
          prb_alert_in_days: "พ.ร.บ. เหลือ {days} วัน",
          prb_alert_expired: "พ.ร.บ. หมดอายุ",
          prb_alert_due_today: "พ.ร.บ. หมดอายุวันนี้",
          show_price_actions: "▼ แสดงราคาและทำรายการ",
          hide_price_actions: "▲ ซ่อน"
        },
        EN: {
          available: "Available",
          reserved: "Reserved",
          workshop: "Workshop",
          on_rent: "On rent",
          daily_rate: "Daily Rate",
          days: "days",
          details: "Details",
          book_now: "Book Now",
          queue: "Queue",
          add_customer: "Add Customer",
          add_vehicle: "Add Vehicle",
          quick_actions: "Quick Actions:",
          car_details_modal_title: "Vehicle Details",
          prb_price: "PRB Price (THB)",
          insurance_premium: "Insurance Premium (THB)",
          duplicate_vehicle_error: "Duplicate Data: Vehicle plate or VIN (Chassis No) already exists in system",
          filter_by_staff: "Filter by Staff:",
          all_staff: "All Staff",
          calendar_view: "Calendar",
          table_view: "Table",
          dispatch: "Dispatch",
          return_job: "Return",
          insurance: "Insurance",
          act: "PRB",
          tax: "Tax",
          in_days: "in {days} days",
          overdue_days: "{days} days overdue",
          due_today: "today",
          red_plate: "Red Plate",
          finance_company: "Finance Company",
          select_or_enter_finance: "Select or type new finance company...",
          next_engine_oil_date: "Next Engine Oil Change (Date)",
          next_engine_oil_mileage: "Next Engine Oil Change (Mileage)",
          next_tire_change_date: "Next Tire Change (Date)",
          next_tire_change_mileage: "Next Tire Change (Mileage)",
          next_service_date: "Next Service Due (Date)",
          next_service_mileage: "Next Service Due (Mileage)",
          service_interval_header: "Service Intervals (Engine Oil & Tires)",
          view_details_or_book: "View Details / Book",
          booking_bar_title: "Instant Fleet Booking",
          booking_bar_subtitle: "Select Pick-up / Return dates (Auto-calculates daily rate)",
          category: "Category",
          brand: "Brand",
          company: "Company",
          status: "Status",
          all: "All",
          pickup_date: "Pick-up Date",
          return_date: "Return Date",
          reset_filters: "Reset Filters",
          rental_duration: "Rental Duration:",
          available_fleet: "Available:",
          hide_filters: "Hide Filters ▴",
          show_filters: "Show Filters ▾",
          prb_alert_in_days: "PRB in {days} days",
          prb_alert_expired: "PRB Expired",
          prb_alert_due_today: "PRB Expired Today",
          show_price_actions: "▼ Show Price & Actions",
          hide_price_actions: "▲ Hide"
        }
      };
      window.translations_dict = window.translations;
    }
    const lang = (this.currentLang === "EN") ? "EN" : "TH";
    return window.translations[lang]?.[key] || fallback || key;
  },

  initLanguage() {
    this.currentLang = localStorage.getItem("sawasdee_lang") || "TH";
    this.applyLanguage();
  },

  toggleLanguage() {
    this.currentLang = (this.currentLang === "EN") ? "TH" : "EN";
    localStorage.setItem("sawasdee_lang", this.currentLang);
    this.applyLanguage();
  },

  applyLanguage() {
    const isEn = (this.currentLang === "EN");
    
    // 1. Language Toggle Button
    const langBtnText = document.getElementById("lang-btn-text");
    if (langBtnText) {
      langBtnText.textContent = isEn ? "🌐 ภาษาไทย" : "🌐 English";
    }

    // 2. Sidebar Navigation Items & Quick Actions
    const lblQuickAct = document.getElementById("sb-actions-header-text");
    if (lblQuickAct) lblQuickAct.textContent = this.t("quick_actions", isEn ? "Quick Actions:" : "ปุ่มดำเนินการด่วน:");
    const lblAddCust = document.getElementById("sb-lbl-add-customer");
    if (lblAddCust) lblAddCust.textContent = this.t("add_customer", isEn ? "Add Customer" : "เพิ่มลูกค้า");
    const lblAddCar = document.getElementById("sb-lbl-add-car");
    if (lblAddCar) lblAddCar.textContent = this.t("add_vehicle", isEn ? "Add Vehicle" : "เพิ่มรถยนต์");

    const lblFront = document.getElementById("nav-lbl-frontoffice");
    if (lblFront) lblFront.textContent = isEn ? "Front Office" : "Front Office";
    const lblBack = document.getElementById("nav-lbl-backoffice");
    if (lblBack) lblBack.textContent = isEn ? "Back Office (Work Orders)" : "Back Office (ตารางใบงาน)";
    const lblMaint = document.getElementById("nav-lbl-maintenance");
    if (lblMaint) lblMaint.textContent = isEn ? "Maintenance & Services" : "ซ่อมบำรุง & บริการ";
    const lblDash = document.getElementById("nav-lbl-dashboard");
    if (lblDash) lblDash.textContent = isEn ? "Dashboard & Finance" : "สรุปแดชบอร์ด & การเงิน";
    const lblHeader = document.getElementById("sb-menu-header-text");
    if (lblHeader) lblHeader.textContent = isEn ? "Main Navigation:" : "เมนูระบบงานหลัก:";
    const btnLogout = document.querySelector(".sb-logout-btn");
    if (btnLogout) {
      btnLogout.innerHTML = isEn ? '<span>🚪</span> Sign Out (Auth)' : '<span>🚪</span> ออกจากระบบ (Auth)';
    }

    // 3. Workflow Folder Tabs (1 to 5)
    const t1 = document.getElementById("tab-btn-fleet");
    if (t1) t1.innerHTML = isEn ? '<span>1.</span> Fleet & Instant Booking' : '<span>1.</span> เลือกรถยนต์ & จองด่วน';
    const t2 = document.getElementById("tab-btn-deposit");
    if (t2) t2.innerHTML = isEn ? '<span>2.</span> Deposit & Finance' : '<span>2.</span> เงินมัดจำ & การเงิน';
    const t3 = document.getElementById("tab-btn-assign");
    if (t3) t3.innerHTML = isEn ? '<span>3.</span> Dispatch/Return Orders' : '<span>3.</span> ออกใบงานส่ง/รับรถ';
    const t4 = document.getElementById("tab-btn-contract");
    if (t4) t4.innerHTML = isEn ? '<span>4.</span> Rental Agreement' : '<span>4.</span> จัดทำสัญญาเช่า';
    const t5 = document.getElementById("tab-btn-dashboard_bks");
    if (t5) t5.innerHTML = isEn ? '<span>5.</span> Booking Pipeline' : '<span>5.</span> แผงควบคุมคิวการจอง';

    // 4. Hero Section Title
    const barTitle = document.querySelector(".booking-bar h3") || document.getElementById("booking-bar-title");
    if (barTitle) {
      barTitle.textContent = isEn 
        ? "Instant Fleet Booking" 
        : "เลือกรถยนต์ & จองด่วน (Instant Booking Bar)";
    }
    const bkBarSub = document.getElementById("booking-bar-subtitle");
    if (bkBarSub) {
      bkBarSub.textContent = isEn
        ? "Select Pick-up / Return dates (Auto-calculates daily rate)"
        : "เลือกวันรับ - คืนรถ (คำนวณระยะเวลาเช่าอัตโนมัติ)";
    }
    const btnAddCustMain = document.getElementById("btn-add-customer-main");
    if (btnAddCustMain) {
      btnAddCustMain.textContent = isEn ? "Add Customer" : "เพิ่มลูกค้า";
    }

    // Tab 1 Filter Bar Labels & Options
    const lblFiltGrp = document.getElementById("lbl-filter-group");
    if (lblFiltGrp) lblFiltGrp.textContent = isEn ? "Category" : "หมวดหมู่รถ";
    const optFiltGrpAll = document.getElementById("opt-filter-group-all");
    if (optFiltGrpAll) optFiltGrpAll.textContent = isEn ? "All" : "ทั้งหมด";

    const lblFiltBrand = document.getElementById("lbl-filter-brand");
    if (lblFiltBrand) lblFiltBrand.textContent = isEn ? "Brand" : "ยี่ห้อ";
    const optFiltBrandAll = document.getElementById("opt-filter-brand-all");
    if (optFiltBrandAll) optFiltBrandAll.textContent = isEn ? "All" : "ทั้งหมด";

    const lblFiltComp = document.getElementById("lbl-filter-company");
    if (lblFiltComp) lblFiltComp.textContent = isEn ? "Company" : "บริษัท / สังกัด";
    const optFiltCompAll = document.getElementById("opt-filter-company-all");
    if (optFiltCompAll) optFiltCompAll.textContent = isEn ? "All" : "ทั้งหมด";

    const lblFiltStat = document.getElementById("lbl-filter-status");
    if (lblFiltStat) lblFiltStat.textContent = isEn ? "Status" : "สถานะรถ";
    const optFStatAll = document.getElementById("opt-filter-status-all");
    if (optFStatAll) optFStatAll.textContent = isEn ? "All" : "ทั้งหมด";
    const optFStatAvail = document.getElementById("opt-filter-status-avail");
    if (optFStatAvail) optFStatAvail.textContent = isEn ? "Available" : "ว่าง";
    const optFStatBooked = document.getElementById("opt-filter-status-booked");
    if (optFStatBooked) optFStatBooked.textContent = isEn ? "Reserved" : "ติดจอง";
    const optFStatRenting = document.getElementById("opt-filter-status-renting");
    if (optFStatRenting) optFStatRenting.textContent = isEn ? "On Rent" : "กำลังเช่า";

    const lblFiltStart = document.getElementById("lbl-filter-start");
    if (lblFiltStart) lblFiltStart.textContent = isEn ? "Pick-up Date" : "วันรับรถ (Pick-up)";
    const lblFiltEnd = document.getElementById("lbl-filter-end");
    if (lblFiltEnd) lblFiltEnd.textContent = isEn ? "Return Date" : "วันคืนรถ (Return)";

    const btnResetFilt = document.getElementById("btn-reset-filters");
    if (btnResetFilt) btnResetFilt.textContent = isEn ? "Reset Filters" : "ล้างตัวกรอง";
    const lblCalcDur = document.getElementById("lbl-calc-duration");
    if (lblCalcDur) lblCalcDur.textContent = isEn ? "Rental Duration:" : "ระยะเวลาเช่า:";
    const btnToggleFilt = document.getElementById("btn-toggle-filter-text");
    if (btnToggleFilt) {
      btnToggleFilt.textContent = this.bookingFilterCollapsed 
        ? (isEn ? "Show Filters ▾" : "แสดงตัวกรอง ▾")
        : (isEn ? "Hide Filters ▴" : "ซ่อนตัวกรอง ▴");
    }
    const btnAddCarBB = document.getElementById("btn-add-car-booking-bar");
    if (btnAddCarBB) btnAddCarBB.textContent = isEn ? "Add Vehicle" : "เพิ่มรถยนต์";


    // --- Front Office Tab 2: Deposit & Finance ---
    const t2Title = document.getElementById("title-tab2");
    if (t2Title) t2Title.textContent = isEn ? "Deposit & Payment" : "เงินมัดจำ & การเงิน (Deposit & Payment)";
    const t2Sub = document.getElementById("subtitle-tab2");
    if (t2Sub) t2Sub.textContent = isEn ? "Record security deposit and collect rental payments" : "บันทึกเงินมัดจำประกันสัญญาและชำระค่าเช่า";
    const lblDepSelBk = document.getElementById("lbl-deposit-sel-bk");
    if (lblDepSelBk) lblDepSelBk.textContent = isEn ? "Select Booking / Vehicle:" : "เลือกรหัสการจอง / ทะเบียนรถ:";
    const optDepSelDef = document.getElementById("opt-dep-sel-default");
    if (optDepSelDef) optDepSelDef.textContent = isEn ? "-- Select booking --" : "-- กรุณาเลือกรายการจอง --";

    const lblDepAmt = document.getElementById("lbl-deposit-amount");
    if (lblDepAmt) lblDepAmt.textContent = isEn ? "Deposit (THB)" : "เงินมัดจำ (บาท)";

    const lblDepMeth = document.getElementById("lbl-deposit-method");
    if (lblDepMeth) lblDepMeth.textContent = isEn ? "Payment Method" : "ช่องทางการชำระเงิน";
    const optDepMTransfer = document.getElementById("opt-dep-method-transfer");
    if (optDepMTransfer) optDepMTransfer.textContent = isEn ? "Bank Transfer" : "โอนเงินเข้าบัญชี (Bank Transfer)";
    const optDepMCredit = document.getElementById("opt-dep-method-credit");
    if (optDepMCredit) optDepMCredit.textContent = isEn ? "Credit Card" : "บัตรเครดิต (Credit Card)";
    const optDepMCash = document.getElementById("opt-dep-method-cash");
    if (optDepMCash) optDepMCash.textContent = isEn ? "Cash" : "เงินสด (Cash)";
    const optDepMPaypal = document.getElementById("opt-dep-method-paypal");
    if (optDepMPaypal) optDepMPaypal.textContent = isEn ? "PayPal / Other" : "PayPal / อื่นๆ";

    const lblDepType = document.getElementById("lbl-deposit-type");
    if (lblDepType) lblDepType.textContent = isEn ? "Payment type" : "ประเภทการชำระ";
    const optDepTypeDep = document.getElementById("opt-dep-type-deposit");
    if (optDepTypeDep) optDepTypeDep.textContent = isEn ? "Deposit" : "เงินมัดจำ";
    const optDepTypeRent = document.getElementById("opt-dep-type-rental");
    if (optDepTypeRent) optDepTypeRent.textContent = isEn ? "Rental" : "ค่าเช่า";
    const optDepTypeBoth = document.getElementById("opt-dep-type-both");
    if (optDepTypeBoth) optDepTypeBoth.textContent = isEn ? "Both" : "ทั้งสอง";
    const lblDepGdrive = document.getElementById("lbl-deposit-gdrive");
    if (lblDepGdrive) lblDepGdrive.textContent = isEn ? "Google Drive link" : "ลิงก์ Google Drive";

    const lblDepRef = document.getElementById("lbl-deposit-ref");
    if (lblDepRef) lblDepRef.textContent = isEn ? "Slip Ref / Transaction Code (Optional)" : "เลขที่อ้างอิงสลิป / รหัสธุรกรรม (ถ้ามี)";
    const hintDepRef = document.getElementById("hint-deposit-ref");
    if (hintDepRef) hintDepRef.textContent = isEn ? "Enter slip transaction number or receipt code" : "เช่น เลขที่ทำรายการบนสลิปโอนเงิน หรือหมายเลขอ้างอิง";
    const lblDepSlip = document.getElementById("lbl-deposit-slip");
    if (lblDepSlip) lblDepSlip.textContent = isEn ? "Attach Payment Slip (Optional):" : "แนบรูปสลิปหลักฐานการชำระเงิน (ถ้ามี):";
    const btnChooseSlip = document.getElementById("btn-choose-slip");
    if (btnChooseSlip) btnChooseSlip.textContent = isEn ? "Choose Slip File..." : "เลือกไฟล์สลิป...";
    const lblDepAlsoRent = document.getElementById("lbl-deposit-also-rent");
    if (lblDepAlsoRent) lblDepAlsoRent.textContent = isEn ? "Collect full rental fee now" : "รับชำระค่าเช่าเต็มจำนวนพร้อมกัน";
    const lblExtAlsoRent = document.getElementById("lbl-extend-also-rent");
    if (lblExtAlsoRent) lblExtAlsoRent.textContent = isEn ? "Collect full rental fee now" : "รับชำระค่าเช่าเต็มจำนวนพร้อมกัน";
    const lblModeDisp = document.getElementById("lbl-assign-mode-disp");
    if (lblModeDisp) lblModeDisp.textContent = isEn ? "🔘 Dispatch Work Order" : "🔘 ออกใบงานส่งรถ";
    const lblModeRet = document.getElementById("lbl-assign-mode-ret");
    if (lblModeRet) lblModeRet.textContent = isEn ? "🔘 Return Work Order" : "🔘 ออกใบงานรับรถคืน";
    const btnSubDep = document.getElementById("btn-submit-deposit");
    if (btnSubDep) btnSubDep.textContent = isEn ? "Confirm Deposit ➔" : "ยืนยันรับเงินมัดจำ ➔";
    const btnSaveSlipOnly = document.getElementById("btn-save-slip-only");
    if (btnSaveSlipOnly) btnSaveSlipOnly.textContent = isEn ? "Update Slip Only" : "อัปเดตสลิป/Ref";
    const btnSettleRent = document.getElementById("btn-settle-rental");
    if (btnSettleRent) btnSettleRent.textContent = isEn ? "Settle Rental Fee" : "รับชำระค่าเช่าคงเหลือ";
    const btnDlDepRec = document.getElementById("btn-dl-dep-receipt");
    if (btnDlDepRec) btnDlDepRec.textContent = isEn ? "Deposit Receipt (PDF)" : "ใบเสร็จมัดจำ (PDF)";
    const btnDlRentRec = document.getElementById("btn-dl-rent-receipt");
    if (btnDlRentRec) btnDlRentRec.textContent = isEn ? "Rental Receipt (PDF)" : "ใบเสร็จค่าเช่า (PDF)";
    const btnDlContractDep = document.getElementById("btn-dl-contract-from-dep");
    if (btnDlContractDep) btnDlContractDep.textContent = isEn ? "Agreement (PDF)" : "สัญญาเช่า (PDF)";
    const btnGotoAssignDep = document.getElementById("btn-goto-assign-from-dep");
    if (btnGotoAssignDep) btnGotoAssignDep.textContent = isEn ? "Work Orders ➔" : "ไปหน้าออกใบงาน ➔";
    const btnGotoContractDep = document.getElementById("btn-goto-contract-from-dep");
    if (btnGotoContractDep) btnGotoContractDep.textContent = isEn ? "Agreement ➔" : "ไปหน้าทำสัญญา ➔";

    // --- Front Office Tab 3: Dispatch/Return Orders ---
    const t3Disp = document.getElementById("title-tab3-disp");
    if (t3Disp) t3Disp.textContent = isEn ? "Dispatch Work Order" : "ออกใบงานส่งรถ";
    const lblAssignDispBk = document.getElementById("lbl-assign-disp-bk");
    if (lblAssignDispBk) lblAssignDispBk.textContent = isEn ? "Select Booking ID:" : "เลือกรหัสการจองสำหรับส่งมอบรถ:";
    const optAssignDispDef = document.getElementById("opt-assign-disp-default");
    if (optAssignDispDef) optAssignDispDef.textContent = isEn ? "-- Select Booking ID --" : "-- เลือกรหัสการจอง --";
    const lblAssignDispStart = document.getElementById("lbl-assign-disp-start");
    if (lblAssignDispStart) lblAssignDispStart.textContent = isEn ? "Start Date" : "วันที่เริ่มเช่า";
    const lblAssignDispEnd = document.getElementById("lbl-assign-disp-end");
    if (lblAssignDispEnd) lblAssignDispEnd.textContent = isEn ? "Return Date" : "วันที่คืนรถ";
    const lblAssignDispWorker = document.getElementById("lbl-assign-disp-worker");
    if (lblAssignDispWorker) lblAssignDispWorker.textContent = isEn ? "Assigned Staff" : "พนักงานส่งรถ";
    const lblAssignDispLoc = document.getElementById("lbl-assign-disp-loc");
    if (lblAssignDispLoc) lblAssignDispLoc.textContent = isEn ? "Meeting Location" : "สถานที่นัดหมายส่งรถ";
    const lblAssignDispDate = document.getElementById("lbl-assign-disp-date");
    if (lblAssignDispDate) lblAssignDispDate.textContent = isEn ? "Appointment Date" : "วันที่นัดหมาย";
    const lblAssignDispTime = document.getElementById("lbl-assign-disp-time");
    if (lblAssignDispTime) lblAssignDispTime.textContent = isEn ? "Appointment Time" : "เวลานัดหมาย";
    const btnAssignDispSched = document.getElementById("btn-assign-disp-sched");
    if (btnAssignDispSched) btnAssignDispSched.textContent = isEn ? "Schedule Dispatch" : "นัดหมายส่งมอบ";
    const btnAssignDispHandoff = document.getElementById("btn-assign-disp-handover");
    if (btnAssignDispHandoff) btnAssignDispHandoff.textContent = isEn ? "Handed Over ➔" : "ส่งมอบรถแล้ว ➔";
    const btnAssignDispContract = document.getElementById("btn-assign-disp-goto-contract");
    if (btnAssignDispContract) btnAssignDispContract.textContent = isEn ? "Agreement ➔" : "ไปหน้าทำสัญญา ➔";

    const t3Ret = document.getElementById("title-tab3-ret");
    if (t3Ret) t3Ret.textContent = isEn ? "Return Work Order" : "ออกใบงานรับรถคืน";
    const lblAssignRetBk = document.getElementById("lbl-assign-ret-bk");
    if (lblAssignRetBk) lblAssignRetBk.textContent = isEn ? "Select Booking ID:" : "เลือกรหัสการจองสำหรับรับรถคืน:";
    const optAssignRetDef = document.getElementById("opt-assign-ret-default");
    if (optAssignRetDef) optAssignRetDef.textContent = isEn ? "-- Select Booking ID --" : "-- เลือกรหัสการจอง --";
    const lblAssignRetStart = document.getElementById("lbl-assign-ret-start");
    if (lblAssignRetStart) lblAssignRetStart.textContent = isEn ? "Start Date" : "วันที่เริ่มเช่า";
    const lblAssignRetEnd = document.getElementById("lbl-assign-ret-end");
    if (lblAssignRetEnd) lblAssignRetEnd.textContent = isEn ? "Return Date" : "วันที่คืนรถ";
    const lblAssignRetWorker = document.getElementById("lbl-assign-ret-worker");
    if (lblAssignRetWorker) lblAssignRetWorker.textContent = isEn ? "Assigned Staff" : "พนักงานรับรถคืน";
    const lblAssignRetLoc = document.getElementById("lbl-assign-ret-loc");
    if (lblAssignRetLoc) lblAssignRetLoc.textContent = isEn ? "Meeting Location" : "สถานที่นัดรับรถคืน";
    const lblAssignRetDate = document.getElementById("lbl-assign-ret-date");
    if (lblAssignRetDate) lblAssignRetDate.textContent = isEn ? "Appointment Date" : "วันที่นัดหมาย";
    const lblAssignRetTime = document.getElementById("lbl-assign-ret-time");
    if (lblAssignRetTime) lblAssignRetTime.textContent = isEn ? "Appointment Time" : "เวลานัดหมาย";
    const btnAssignRetSched = document.getElementById("btn-assign-ret-sched");
    if (btnAssignRetSched) btnAssignRetSched.textContent = isEn ? "Schedule Return" : "นัดหมายรับคืน";
    const btnAssignRetComplete = document.getElementById("btn-assign-ret-complete");
    if (btnAssignRetComplete) btnAssignRetComplete.textContent = isEn ? "Return Completed ➔" : "รับคืนแล้ว (ปิดงาน) ➔";

    // --- Front Office Tab 4: Rental Agreement ---
    const t4Title = document.getElementById("title-tab4");
    if (t4Title) t4Title.textContent = isEn ? "Rental Agreements" : "จัดทำสัญญาเช่า (Rental Agreement)";
    const t4Sub = document.getElementById("subtitle-tab4");
    if (t4Sub) t4Sub.textContent = isEn ? "Digital rental agreements, e-signatures, and receipts" : "สร้างและดาวน์โหลดสัญญาเช่ารถยนต์อิเล็กทรอนิกส์พร้อมลายเซ็น";
    const lblContractSelBk = document.getElementById("lbl-contract-sel-bk");
    if (lblContractSelBk) lblContractSelBk.textContent = isEn ? "Select Booking:" : "เลือกรหัสการจอง:";
    const optContractSelDef = document.getElementById("opt-contract-sel-default");
    if (optContractSelDef) optContractSelDef.textContent = isEn ? "-- Select booking --" : "-- กรุณาเลือกรายการจอง --";
    const btnRefreshContracts = document.getElementById("btn-refresh-contracts");
    if (btnRefreshContracts) btnRefreshContracts.textContent = isEn ? "Refresh" : "รีเฟรช";
    const contractEmptyMsg = document.getElementById("contract-empty-msg");
    if (contractEmptyMsg) contractEmptyMsg.textContent = isEn ? "No active agreements found" : "ยังไม่มีรายการสัญญาเช่าในระบบ";

    const hdrContractCust = document.getElementById("hdr-contract-cust-info");
    if (hdrContractCust) hdrContractCust.textContent = isEn ? "Tenant Information" : "ข้อมูลผู้เช่า";
    const hdrContractCar = document.getElementById("hdr-contract-car-info");
    if (hdrContractCar) hdrContractCar.textContent = isEn ? "Vehicle Information" : "ข้อมูลรถยนต์";
    const hdrContractSched = document.getElementById("hdr-contract-sched-info");
    if (hdrContractSched) hdrContractSched.textContent = isEn ? "Schedule & Contract Details" : "กำหนดการ & ข้อมูลสัญญา";

    const lblContractNetP = document.getElementById("lbl-contract-net-price");
    if (lblContractNetP) lblContractNetP.textContent = isEn ? "Agreed Rental Price" : "ราคาค่าเช่าที่ตกลง";
    const lblContractDepStat = document.getElementById("lbl-contract-dep-status");
    if (lblContractDepStat) lblContractDepStat.textContent = isEn ? "Deposit Status" : "สถานะเงินมัดจำ";
    const lblContractRemP = document.getElementById("lbl-contract-rem-price");
    if (lblContractRemP) lblContractRemP.textContent = isEn ? "Remaining Rental Fee" : "ค่าเช่าคงเหลือที่ต้องชำระ";

    const hdrContractDocs = document.getElementById("hdr-contract-doc-center");
    if (hdrContractDocs) hdrContractDocs.textContent = isEn ? "PDF Document Center (Official Formats)" : "ศูนย์ดาวน์โหลดเอกสาร PDF (แบบมาตรฐานทางการ)";
    const btnDlContractPdf = document.getElementById("btn-dl-contract-pdf");
    if (btnDlContractPdf) btnDlContractPdf.textContent = isEn ? "Download Contract PDF" : "ดาวน์โหลดสัญญาเช่า (PDF)";
    const btnMarkIssued = document.getElementById("btn-mark-contract-issued");
    if (btnMarkIssued) btnMarkIssued.textContent = isEn ? "Confirm Contract Issued" : "ยืนยันออกสัญญาเรียบร้อย";

    // Tab 4 Walk-in Direct Formulation
    const tWalkin = document.getElementById("title-walkin-contract");
    if (tWalkin) tWalkin.textContent = isEn ? "New Walk-in Agreement" : "สร้างสัญญาเช่า Walk-in";
    const subWalkin = document.getElementById("subtitle-walkin-contract");
    if (subWalkin) subWalkin.textContent = isEn ? "Direct on-site agreement and immediate dispatch" : "ออกสัญญาเช่าหน้าร้านและนัดหมายส่งมอบรถทันที";
    const lblWalkinCar = document.getElementById("lbl-walkin-car");
    if (lblWalkinCar) lblWalkinCar.textContent = isEn ? "Vehicle*" : "เลือกรถยนต์*";
    const optWalkinCarDef = document.getElementById("opt-walkin-car-default");
    if (optWalkinCarDef) optWalkinCarDef.textContent = isEn ? "-- Select vehicle --" : "-- เลือกรถยนต์ --";
    const lblWalkinCust = document.getElementById("lbl-walkin-cust");
    if (lblWalkinCust) lblWalkinCust.textContent = isEn ? "Tenant*" : "ลูกค้าผู้เช่า*";
    const btnWalkinCustEdit = document.getElementById("btn-walkin-cust-edit");
    if (btnWalkinCustEdit) btnWalkinCustEdit.textContent = isEn ? "Edit" : "แก้ไข";
    const btnWalkinCustDel = document.getElementById("btn-walkin-cust-del");
    if (btnWalkinCustDel) btnWalkinCustDel.textContent = isEn ? "Delete" : "ลบ";
    const btnWalkinCustAdd = document.getElementById("btn-walkin-cust-add");
    if (btnWalkinCustAdd) btnWalkinCustAdd.textContent = isEn ? "Add Customer" : "เพิ่มลูกค้า";
    const lblWalkinStart = document.getElementById("lbl-walkin-start");
    if (lblWalkinStart) lblWalkinStart.textContent = isEn ? "Start Date & Time*" : "วันที่-เวลาเริ่มสัญญา*";
    const lblWalkinEnd = document.getElementById("lbl-walkin-end");
    if (lblWalkinEnd) lblWalkinEnd.textContent = isEn ? "End Date & Time*" : "วันที่-เวลาสิ้นสุดสัญญา*";
    const lblWalkinType = document.getElementById("lbl-walkin-type");
    if (lblWalkinType) lblWalkinType.textContent = isEn ? "Rate Plan" : "เรทราคาเช่า";
    const optWalkinDaily = document.getElementById("opt-walkin-type-daily");
    if (optWalkinDaily) optWalkinDaily.textContent = isEn ? "Daily" : "รายวัน";
    const optWalkinWeekly = document.getElementById("opt-walkin-type-weekly");
    if (optWalkinWeekly) optWalkinWeekly.textContent = isEn ? "Weekly" : "รายสัปดาห์";
    const optWalkinMonthly = document.getElementById("opt-walkin-type-monthly");
    if (optWalkinMonthly) optWalkinMonthly.textContent = isEn ? "Monthly" : "รายเดือน";
    const lblWalkinDisc = document.getElementById("lbl-walkin-discount");
    if (lblWalkinDisc) lblWalkinDisc.textContent = isEn ? "Discount (THB)" : "ส่วนลด (บาท)";
    const lblWalkinWorker = document.getElementById("lbl-walkin-worker");
    if (lblWalkinWorker) lblWalkinWorker.textContent = isEn ? "Staff" : "พนักงานส่งมอบรถ";
    const lblWalkinLoc = document.getElementById("lbl-walkin-loc");
    if (lblWalkinLoc) lblWalkinLoc.textContent = isEn ? "Location" : "สถานที่ส่งมอบรถ";
    const btnSubmitWalkin = document.getElementById("btn-submit-walkin");
    if (btnSubmitWalkin) btnSubmitWalkin.textContent = isEn ? "Create Agreement & Pay" : "ออกสัญญา & ไปชำระเงิน";

    // --- Front Office Tab 5: Booking Pipeline ---
    const t5Title = document.getElementById("title-tab5");
    if (t5Title) t5Title.textContent = isEn ? "Booking Pipeline" : "แผงควบคุมคิวการจอง (Pipeline)";
    const bksSearch = document.getElementById("bks-search-input");
    if (bksSearch) bksSearch.placeholder = isEn ? "Search ID, customer, plate..." : "ค้นหารหัส, ลูกค้า, ทะเบียน...";
    const lblBksStat = document.getElementById("lbl-bks-filter-status");
    if (lblBksStat) lblBksStat.textContent = isEn ? "Status:" : "สถานะ:";
    const optBksAll = document.getElementById("opt-bks-status-all");
    if (optBksAll) optBksAll.textContent = isEn ? "Status: Active Pipeline" : "สถานะ: งานกำลังดำเนินการ";
    const optBksDep = document.getElementById("opt-bks-status-dep");
    if (optBksDep) optBksDep.textContent = isEn ? "Waiting for Deposit" : "รอมัดจำ";
    const optBksDispWait = document.getElementById("opt-bks-status-disp-wait");
    if (optBksDispWait) optBksDispWait.textContent = isEn ? "Awaiting Dispatch" : "รอส่งมอบ";
    const optBksDispPrep = document.getElementById("opt-bks-status-disp-prep");
    if (optBksDispPrep) optBksDispPrep.textContent = isEn ? "Preparing Dispatch" : "เตรียมส่งมอบ";
    const optBksRenting = document.getElementById("opt-bks-status-renting");
    if (optBksRenting) optBksRenting.textContent = isEn ? "Active Rental" : "กำลังเช่า";
    const optBksRetPrep = document.getElementById("opt-bks-status-ret-prep");
    if (optBksRetPrep) optBksRetPrep.textContent = isEn ? "Preparing Return" : "เตรียมรับคืน";
    const optBksDone = document.getElementById("opt-bks-status-done");
    if (optBksDone) optBksDone.textContent = isEn ? "Completed" : "เสร็จสิ้น";
    const optBksCancel = document.getElementById("opt-bks-status-cancel");
    if (optBksCancel) optBksCancel.textContent = isEn ? "Cancelled" : "ยกเลิก";

    const thBksId = document.getElementById("th-bks-id");
    if (thBksId) thBksId.textContent = isEn ? "Booking ID" : "รหัสการจอง";
    const thBksCar = document.getElementById("th-bks-car");
    if (thBksCar) thBksCar.textContent = isEn ? "Vehicle" : "รถยนต์";
    const thBksCust = document.getElementById("th-bks-cust");
    if (thBksCust) thBksCust.textContent = isEn ? "Customer" : "ลูกค้า";
    const thBksDur = document.getElementById("th-bks-dur");
    if (thBksDur) thBksDur.textContent = isEn ? "Duration" : "ระยะเวลา";
    const thBksNet = document.getElementById("th-bks-net");
    if (thBksNet) thBksNet.textContent = isEn ? "Net Fee" : "ค่าเช่าสุทธิ";
    const thBksPay = document.getElementById("th-bks-payment");
    if (thBksPay) thBksPay.textContent = isEn ? "Payment Status" : "การชำระเงิน";
    const thBksStat = document.getElementById("th-bks-status");
    if (thBksStat) thBksStat.textContent = isEn ? "Status" : "สถานะ";
    const thBksAct = document.getElementById("th-bks-action");
    if (thBksAct) thBksAct.textContent = isEn ? "Actions" : "จัดการ";

    // --- Modal: Add / Edit Vehicle Details ---
    const lblCarPhoto = document.getElementById("lbl-modal-car-photo");
    if (lblCarPhoto) lblCarPhoto.textContent = isEn ? "Upload Vehicle Photo (JPG, PNG, WEBP):" : "อัปโหลดรูปรถยนต์ (JPG, PNG, WEBP):";
    const lblCarImgUrl = document.getElementById("lbl-modal-car-imgurl");
    if (lblCarImgUrl) lblCarImgUrl.textContent = isEn ? "Or enter Image URL:" : "หรือใส่ลิงก์รูปภาพ (Image URL):";
    const lblCarPlate = document.getElementById("lbl-modal-car-plate");
    if (lblCarPlate) lblCarPlate.textContent = isEn ? "License Plate (Plate)*" : "เลขทะเบียนรถ (Plate)*";
    const inpCarPlate = document.getElementById("edit-car-plate");
    if (inpCarPlate) inpCarPlate.placeholder = isEn ? "e.g. 5KOR 5181" : "เช่น 5ขศ 5181";
    const warnCarPlate = document.getElementById("edit-car-plate-warn");
    if (warnCarPlate) warnCarPlate.textContent = isEn ? "⚠️ This plate already exists in system" : "⚠️ ทะเบียนนี้มีอยู่ในระบบแล้ว";

    const lblCarBrand = document.getElementById("lbl-modal-car-brand");
    if (lblCarBrand) lblCarBrand.textContent = isEn ? "Brand / Make*" : "ยี่ห้อ (Brand)*";
    const inpCarBrand = document.getElementById("edit-car-brand");
    if (inpCarBrand) inpCarBrand.placeholder = isEn ? "e.g. Toyota" : "เช่น Toyota";

    const lblCarModel = document.getElementById("lbl-modal-car-model");
    if (lblCarModel) lblCarModel.textContent = isEn ? "Vehicle Model*" : "รุ่นรถยนต์ (Model)*";
    const inpCarModel = document.getElementById("edit-car-model");
    if (inpCarModel) inpCarModel.placeholder = isEn ? "e.g. Yaris Ativ" : "เช่น Yaris Ativ";

    const lblCarGroup = document.getElementById("lbl-modal-car-group");
    if (lblCarGroup) lblCarGroup.textContent = isEn ? "Vehicle Group*" : "กลุ่มรถ (Car Group)*";
    const optGrpSedan = document.getElementById("opt-modal-group-sedan");
    if (optGrpSedan) optGrpSedan.textContent = isEn ? "Sedan / Hatchback" : "รถเก๋ง (Sedan/Hatchback)";
    const optGrpSuv = document.getElementById("opt-modal-group-suv");
    if (optGrpSuv) optGrpSuv.textContent = isEn ? "SUV" : "SUV";
    const optGrpVan = document.getElementById("opt-modal-group-van");
    if (optGrpVan) optGrpVan.textContent = isEn ? "Van" : "รถตู้ (Van)";
    const optGrpPickup = document.getElementById("opt-modal-group-pickup");
    if (optGrpPickup) optGrpPickup.textContent = isEn ? "Pickup Truck" : "รถกระบะ";
    const optGrpSport = document.getElementById("opt-modal-group-sport");
    if (optGrpSport) optGrpSport.textContent = isEn ? "Sport / Luxury" : "รถสปอร์ต/หรูหรา";

    const lblCarFuel = document.getElementById("lbl-modal-car-fuel");
    if (lblCarFuel) lblCarFuel.textContent = isEn ? "Fuel System*" : "ระบบเชื้อเพลิง*";
    const optFuelGas = document.getElementById("opt-modal-fuel-gasoline");
    if (optFuelGas) optFuelGas.textContent = isEn ? "Gasoline" : "เบนซิน";
    const optFuelGasHyb = document.getElementById("opt-modal-fuel-gas-hybrid");
    if (optFuelGasHyb) optFuelGasHyb.textContent = isEn ? "Gasoline / Hybrid" : "เบนซิน/Hybrid";
    const optFuelDie = document.getElementById("opt-modal-fuel-diesel");
    if (optFuelDie) optFuelDie.textContent = isEn ? "Diesel" : "ดีเซล";
    const optFuelDieHyb = document.getElementById("opt-modal-fuel-die-hybrid");
    if (optFuelDieHyb) optFuelDieHyb.textContent = isEn ? "Diesel / Hybrid" : "ดีเซล/Hybrid";
    const optFuelEv = document.getElementById("opt-modal-fuel-ev");
    if (optFuelEv) optFuelEv.textContent = isEn ? "Electric (EV)" : "ไฟฟ้า (EV)";

    const lblCarCc = document.getElementById("lbl-modal-car-cc");
    if (lblCarCc) lblCarCc.textContent = isEn ? "Engine Capacity (CC / EV)" : "ขนาดเครื่องยนต์ (CC / EV)";
    const inpCarCc = document.getElementById("edit-car-cc");
    if (inpCarCc) inpCarCc.placeholder = isEn ? "e.g. 1200 or 1800" : "เช่น 1200 หรือ 1800";

    const lblCarComp = document.getElementById("lbl-modal-car-company");
    if (lblCarComp) lblCarComp.textContent = isEn ? "Ownership / Company*" : "เจ้าของกรรมสิทธิ์ / บริษัท*";
    const inpCarComp = document.getElementById("edit-car-company");
    if (inpCarComp) inpCarComp.placeholder = isEn ? "e.g. Sawasdee Rent A Car" : "เช่น Sawasdee Rent A Car";

    const lblCarColor = document.getElementById("lbl-modal-car-color");
    if (lblCarColor) lblCarColor.textContent = isEn ? "Body Color" : "สีตัวถัง (Color)";
    const inpCarColor = document.getElementById("edit-car-color");
    if (inpCarColor) inpCarColor.placeholder = isEn ? "e.g. White, Black, Grey" : "เช่น ขาว, ดำ, เทา";

    const lblCarMil = document.getElementById("lbl-modal-car-mileage");
    if (lblCarMil) lblCarMil.textContent = isEn ? "Odometer Mileage (km)" : "เลขไมล์สะสม (km)";
    const inpCarMil = document.getElementById("edit-car-mileage");
    if (inpCarMil) inpCarMil.placeholder = isEn ? "e.g. 25,000" : "เช่น 25,000";

    const lblCarPday = document.getElementById("lbl-modal-car-pday");
    if (lblCarPday) lblCarPday.textContent = isEn ? "Daily Rate (THB)*" : "ค่าเช่ารายวัน (บาท)*";
    const lblCarPweek = document.getElementById("lbl-modal-car-pweek");
    if (lblCarPweek) lblCarPweek.textContent = isEn ? "Weekly Rate (THB)" : "ค่าเช่ารายสัปดาห์ (บาท)";
    const lblCarPmonth = document.getElementById("lbl-modal-car-pmonth");
    if (lblCarPmonth) lblCarPmonth.textContent = isEn ? "Monthly Rate (THB)" : "ค่าเช่ารายเดือน (บาท)";

    const lblCarVin = document.getElementById("lbl-modal-car-vin");
    if (lblCarVin) lblCarVin.textContent = isEn ? "VIN / Chassis Number*" : "เลขตัวถัง (VIN)*";
    const warnCarVin = document.getElementById("edit-car-vin-warn");
    if (warnCarVin) warnCarVin.textContent = isEn ? "⚠️ This VIN already exists in system" : "⚠️ เลขตัวถังนี้ซ้ำกับรถคันอื่นในระบบ";

    const lblCarTax = document.getElementById("lbl-modal-car-tax");
    if (lblCarTax) lblCarTax.textContent = isEn ? "Tax Expiry Date" : "วันหมดอายุ ภาษี";
    const lblCarAct = document.getElementById("lbl-modal-car-act");
    if (lblCarAct) lblCarAct.textContent = isEn ? "ACT Expiry Date" : "วันหมดอายุ พ.ร.บ.";
    const lblCarIns = document.getElementById("lbl-modal-car-ins");
    if (lblCarIns) lblCarIns.textContent = isEn ? "Insurance Expiry Date" : "วันหมดอายุ ประกันภัย";

    const lblCarInsComp = document.getElementById("lbl-modal-car-ins-comp");
    if (lblCarInsComp) lblCarInsComp.textContent = isEn ? "Insurance Company" : "บริษัทประกันภัย";
    const inpCarInsComp = document.getElementById("edit-car-ins-comp");
    if (inpCarInsComp) inpCarInsComp.placeholder = isEn ? "e.g. Tokio Marine" : "เช่น คุ้มภัยโตเกียวมารีน";

    const lblCarOwner = document.getElementById("lbl-modal-car-owner");
    if (lblCarOwner) lblCarOwner.textContent = isEn ? "Vehicle Owner" : "เจ้าของรถ (Owner)";
    const inpCarOwner = document.getElementById("edit-car-owner");
    if (inpCarOwner) inpCarOwner.placeholder = isEn ? "e.g. SWD, B-Click" : "เช่น SWD, บีคลิ๊ก";

    const lblCarBeneficiary = document.getElementById("lbl-modal-car-beneficiary");
    if (lblCarBeneficiary) lblCarBeneficiary.textContent = isEn ? "Beneficiary" : "ผู้รับผลประโยชน์";
    const inpCarBeneficiary = document.getElementById("edit-car-beneficiary");
    if (inpCarBeneficiary) inpCarBeneficiary.placeholder = isEn ? "e.g. Sawasdee Rental" : "เช่น สวัสดี เรนทัล";

    const lblCarRegYear = document.getElementById("lbl-modal-car-reg-year");
    if (lblCarRegYear) lblCarRegYear.textContent = isEn ? "Registration Year (B.E./A.D.)" : "จดทะเบียนปี (พ.ศ.)";
    const inpCarRegYear = document.getElementById("edit-car-reg-year");
    if (inpCarRegYear) inpCarRegYear.placeholder = isEn ? "e.g. 2024 or 2567" : "เช่น 2567";

    const lblCarPrbPrice = document.getElementById("lbl-modal-car-prb-price");
    if (lblCarPrbPrice) lblCarPrbPrice.textContent = isEn ? "PRB Price (THB)" : "ราคา พ.ร.บ. (บาท)";
    const inpCarPrbPrice = document.getElementById("edit-car-prb-price");
    if (inpCarPrbPrice) inpCarPrbPrice.placeholder = isEn ? "e.g. 645.21" : "เช่น 645.21";

    const lblCarInsPrem = document.getElementById("lbl-modal-car-ins-premium");
    if (lblCarInsPrem) lblCarInsPrem.textContent = isEn ? "Insurance Premium (THB)" : "เบี้ยประกัน (บาท)";
    const inpCarInsPrem = document.getElementById("edit-car-ins-premium");
    if (inpCarInsPrem) inpCarInsPrem.placeholder = isEn ? "e.g. 15000" : "เช่น 15000";

    const lblCarLastSrv = document.getElementById("lbl-modal-car-last-srv");
    if (lblCarLastSrv) lblCarLastSrv.textContent = isEn ? "Last Service Date" : "วันที่เช็คระยะล่าสุด";
    const inpCarLastSrv = document.getElementById("edit-car-last-srv");
    if (inpCarLastSrv) inpCarLastSrv.placeholder = isEn ? "DD/MM/YYYY or -" : "DD/MM/YYYY หรือ -";

    const lblCarNextSrvDate = document.getElementById("lbl-modal-car-next-srv-date");
    if (lblCarNextSrvDate) lblCarNextSrvDate.textContent = isEn ? "Next Service Due (Date)" : "กำหนดเช็คระยะครั้งต่อไป (วันที่)";
    const lblCarNextSrvMileage = document.getElementById("lbl-modal-car-next-srv-mileage");
    if (lblCarNextSrvMileage) lblCarNextSrvMileage.textContent = isEn ? "Next Service Due (Mileage)" : "กำหนดเช็คระยะครั้งต่อไป (เลขไมล์)";
    const inpCarNextSrvMileage = document.getElementById("edit-car-next-srv-mileage");
    if (inpCarNextSrvMileage) inpCarNextSrvMileage.placeholder = isEn ? "e.g. 20000" : "เช่น 20000";

    const lblCarStatus = document.getElementById("lbl-modal-car-status");
    if (lblCarStatus) lblCarStatus.textContent = isEn ? "Vehicle Status*" : "สถานะรถยนต์*";
    const optMStatAvail = document.getElementById("opt-modal-status-available");
    if (optMStatAvail) optMStatAvail.textContent = isEn ? "Available for Service" : "ว่างพร้อมใช้งาน";
    const optMStatMaint2 = document.getElementById("opt-modal-status-maint");
    if (optMStatMaint2) optMStatMaint2.textContent = isEn ? "Maintenance" : "ซ่อมบำรุง";
    const optMStatPrep = document.getElementById("opt-modal-status-prep-disp");
    if (optMStatPrep) optMStatPrep.textContent = isEn ? "Preparing Dispatch" : "เตรียมส่งมอบ";
    const optMStatRent = document.getElementById("opt-modal-status-renting");
    if (optMStatRent) optMStatRent.textContent = isEn ? "Currently Renting" : "กำลังเช่า";
    const optMStatBook = document.getElementById("opt-modal-status-booked");
    if (optMStatBook) optMStatBook.textContent = isEn ? "Reserved" : "ติดจอง";

    const lblCarDebtFree = document.getElementById("lbl-modal-car-debt-free");
    if (lblCarDebtFree) lblCarDebtFree.textContent = isEn ? "Debt-Free / Fully Paid" : "รถปลอดภาระ / ซื้อเงินสด";
    const lblCarFinComp = document.getElementById("lbl-modal-car-finance-comp");
    if (lblCarFinComp) lblCarFinComp.textContent = this.t("finance_company");
    const inpCarFinComp = document.getElementById("edit-car-finance-company");
    if (inpCarFinComp) inpCarFinComp.placeholder = this.t("select_or_enter_finance");
    const lblCarInstAmt = document.getElementById("lbl-modal-car-installment-amt");
    if (lblCarInstAmt) lblCarInstAmt.textContent = isEn ? "Monthly Installment (THB)" : "ค่างวดต่อเดือน (THB)";
    const lblCarTotInst = document.getElementById("lbl-modal-car-total-inst");
    if (lblCarTotInst) lblCarTotInst.textContent = isEn ? "Total Installments" : "จำนวนงวดทั้งหมด";
    const lblCarCurrInst = document.getElementById("lbl-modal-car-curr-inst");
    if (lblCarCurrInst) lblCarCurrInst.textContent = isEn ? "Current Paid Installment" : "งวดปัจจุบัน (ชำระแล้ว)";
    const lblCarDueDate = document.getElementById("lbl-modal-car-due-date");
    if (lblCarDueDate) lblCarDueDate.textContent = isEn ? "Due Date" : "วันกำหนดชำระ (ทุกวันที่)";

    const lblCarNotes = document.getElementById("lbl-modal-car-notes");
    if (lblCarNotes) lblCarNotes.textContent = isEn ? "Additional Notes & Info" : "หมายเหตุ / ข้อมูลเพิ่มเติม (Notes)";
    const inpCarNotes = document.getElementById("edit-car-notes");
    if (inpCarNotes) inpCarNotes.placeholder = isEn ? "e.g. Logbook on hand, regular customer, claim history..." : "เช่น มีเล่มทะเบียน, ผู้เช่าประจำ, ประวัติเคลม...";

    const btnCarDelModal = document.getElementById("btn-modal-car-delete");
    if (btnCarDelModal) btnCarDelModal.textContent = isEn ? "Delete This Vehicle" : "ลบข้อมูลรถยนต์คันนี้";
    const btnCarCancelModal = document.getElementById("btn-modal-car-cancel");
    if (btnCarCancelModal) btnCarCancelModal.textContent = isEn ? "Cancel" : "ยกเลิก";
    const btnCarSaveModal = document.getElementById("btn-submit-edit-car");
    if (btnCarSaveModal) btnCarSaveModal.textContent = isEn ? "Save Vehicle Data" : "บันทึกข้อมูลรถยนต์";

    const modalCarDetailsTitle = document.getElementById("modal-car-details-title");
    if (modalCarDetailsTitle) modalCarDetailsTitle.textContent = isEn ? "Vehicle Details & Booking" : "ดูรายละเอียด / จองรถ";

    // 5. Search box placeholder
    const sbInput = document.getElementById("sb-search-input");
    if (sbInput) {
      sbInput.placeholder = isEn ? "Search (Booking / Plate / Customer)..." : "ค้นหา (เลขที่จอง / ทะเบียน / ลูกค้า)...";
    }

    // 6. Topbar & Sidebar Labels
    const syncLbl = document.getElementById("sync-label");
    if (syncLbl) syncLbl.textContent = isEn ? "Auto Cloud Sync:" : "ซิงค์ Cloud อัตโนมัติ:";
    const sbCardLbl = document.getElementById("sb-user-card-label");
    if (sbCardLbl) sbCardLbl.textContent = isEn ? "Logged in as:" : "เข้าสู่ระบบโดย:";
    const sbAdminStaff = document.getElementById("sb-admin-staff-text");
    if (sbAdminStaff) sbAdminStaff.textContent = isEn ? "Manage & Approve Staff" : "จัดการ & อนุมัติพนักงาน";

    // 7. Back Office Module Content
    const boTitle = document.getElementById("bo-title-text");
    if (boTitle) boTitle.textContent = isEn ? "Dispatch & Return Work Orders" : "ศูนย์จัดการใบส่งมอบและรับคืนรถยนต์";
    const boSubtitle = document.getElementById("bo-subtitle-text");
    if (boSubtitle) boSubtitle.textContent = isEn ? "Dispatch & Return Work Orders" : "ตารางใบงานและเอกสารส่งมอบ-รับคืนรถยนต์";
    const boAdminBadge = document.getElementById("bo-admin-badge");
    if (boAdminBadge) {
      const isUserAdmin = (this.user && (this.user.role === "Admin" || (this.user.username || "").toLowerCase() === "admin"));
      if (isUserAdmin) {
        boAdminBadge.textContent = isEn ? "Admin: Full Access" : "ผู้ดูแลระบบ (Admin): สิทธิ์เต็ม";
      } else {
        const uName = this.user ? this.user.username : "";
        boAdminBadge.textContent = isEn ? `Staff: ${uName}` : `พนักงาน: ${uName}`;
      }
    }
    const boSearch = document.getElementById("bo-search-input");
    if (boSearch) boSearch.placeholder = isEn ? "Search work orders..." : "ค้นหาใบงาน...";
    const boRefresh = document.getElementById("bo-refresh-btn");
    if (boRefresh) boRefresh.textContent = isEn ? "Refresh" : "รีเฟรช";
    const boTblHdr = document.getElementById("bo-table-header-text");
    if (boTblHdr) boTblHdr.textContent = isEn ? "Vehicle Dispatch & Return Work Orders" : "รายการใบงานรับ-ส่งรถยนต์";

    // 8. Back Office Table Column Headers
    const thType = document.getElementById("bo-th-type");
    if (thType) thType.textContent = isEn ? "Job Type" : "ประเภทงาน";
    const thBkid = document.getElementById("bo-th-bkid");
    if (thBkid) thBkid.textContent = isEn ? "Booking ID" : "รหัสการจอง";
    const thPlate = document.getElementById("bo-th-plate");
    if (thPlate) thPlate.textContent = isEn ? "Plate No." : "ทะเบียนรถ";
    const thCust = document.getElementById("bo-th-cust");
    if (thCust) thCust.textContent = isEn ? "Customer & Phone" : "ลูกค้า & เบอร์โทร";
    const thSched = document.getElementById("bo-th-sched");
    if (thSched) thSched.textContent = isEn ? "Schedule Date-Time" : "กำหนดวัน-เวลา";
    const thStaff = document.getElementById("bo-th-staff");
    if (thStaff) thStaff.textContent = isEn ? "Staff" : "พนักงาน";
    const thLoc = document.getElementById("bo-th-loc");
    if (thLoc) thLoc.textContent = isEn ? "Meeting Location" : "สถานที่นัดหมาย";
    const thStatus = document.getElementById("bo-th-status");
    if (thStatus) thStatus.textContent = isEn ? "Status" : "สถานะ";
    const thActs = document.getElementById("bo-th-acts");
    const boCalHead = document.getElementById("bo-calendar-heading");
    if (boCalHead) boCalHead.textContent = isEn ? "📅 Vehicle Dispatch & Return Work Orders (Calendar)" : "📅 ปฏิทินตารางงานส่งมอบ - รับคืนรถยนต์ (Schedule Calendar)";
    const legDisp = document.getElementById("legend-dispatch-lbl");
    if (legDisp) legDisp.textContent = isEn ? "Dispatch" : "ส่งมอบ (Dispatch)";
    const legRet = document.getElementById("legend-return-lbl");
    if (legRet) legRet.textContent = isEn ? "Return" : "รับคืน (Return)";
    const legMnt = document.getElementById("legend-maint-lbl");
    if (legMnt) legMnt.textContent = isEn ? "Maintenance/Renewal" : "ซ่อมบำรุง/ต่อภาษี";
    const boLblStaff = document.getElementById("bo-lbl-filter-staff");
    if (boLblStaff) boLblStaff.textContent = isEn ? "Filter Staff:" : "กรองพนักงาน:";
    const optBoStaffAll = document.getElementById("opt-bo-staff-all");
    if (optBoStaffAll) optBoStaffAll.textContent = isEn ? "All Staff" : "พนักงานทั้งหมด (All Staff)";
    const btnBoCal = document.getElementById("btn-bo-view-calendar");
    if (btnBoCal) btnBoCal.textContent = isEn ? "📅 Calendar" : "📅 ปฏิทิน";
    const btnBoTbl = document.getElementById("btn-bo-view-table");
    if (btnBoTbl) btnBoTbl.textContent = isEn ? "📋 Table" : "📋 ตาราง";
    const boDayJobsTitle = document.getElementById("bo-day-jobs-title");
    if (boDayJobsTitle) boDayJobsTitle.textContent = isEn ? "📋 Selected Date Work Orders" : "📋 งานประจำวันที่เลือก";
    const boDayJobsSub = document.getElementById("bo-day-jobs-subtitle");
    if (boDayJobsSub) boDayJobsSub.textContent = isEn ? "Click action button to open inspection form or view docs" : "คลิกที่ปุ่มจัดการเพื่อเปิดฟอร์มตรวจสภาพหรือดูเอกสาร";

    // 9. Re-render jobs in Back Office if table exists
    if (this.renderBackofficeCalendar) {
      this.renderBackofficeCalendar();
    }
    if (this.renderBackOfficeJobs) {
      this.renderBackOfficeJobs();
    }

    // 10. Maintenance & Services Module Localization
    const mTitle = document.getElementById("mnt-title-text") || document.getElementById("maint-title-text");
    if (mTitle) mTitle.textContent = isEn ? "Fleet Maintenance & Renewal Management" : "ศูนย์จัดการงานซ่อมบำรุงและต่ออายุเอกสาร";
    const mSubtitle = document.getElementById("mnt-subtitle-text") || document.getElementById("maint-subtitle-text");
    if (mSubtitle) mSubtitle.textContent = isEn ? "Fleet Maintenance & Renewal Management" : "จัดการงานซ่อมบำรุง ตรวจเช็คสภาพ ออกใบงาน และต่ออายุภาษี-พ.ร.บ.-ประกันภัย";
    const btnMntNew = document.getElementById("btn-mnt-new") || document.getElementById("btn-maint-open-modal");
    if (btnMntNew) btnMntNew.textContent = isEn ? "New Work Order" : "ออกใบงานใหม่";
    const btnMntRenew = document.getElementById("btn-mnt-renewal");
    if (btnMntRenew) btnMntRenew.textContent = isEn ? "Renewal Order" : "ออกใบงานต่ออายุเอกสาร";
    const btnMntRef = document.getElementById("btn-mnt-refresh") || document.getElementById("btn-maint-refresh");
    if (btnMntRef) btnMntRef.textContent = isEn ? "Refresh" : "รีเฟรช";

    // Maintenance KPI labels
    const mKpi1 = document.getElementById("mnt-kpi-inprog-lbl") || document.getElementById("maint-kpi-in-garage-lbl");
    if (mKpi1) mKpi1.textContent = isEn ? "In Garage / Service Center" : "กำลังซ่อมบำรุง";
    const mKpi2 = document.getElementById("mnt-kpi-pending-lbl") || document.getElementById("maint-kpi-pending-lbl");
    if (mKpi2) mKpi2.textContent = isEn ? "Pending Work Orders" : "ใบงานรอดำเนินการ";
    const mKpi3 = document.getElementById("mnt-kpi-total-lbl") || document.getElementById("maint-kpi-total-cost-lbl");
    if (mKpi3) mKpi3.textContent = isEn ? "Total Maintenance Cost" : "รวมค่าซ่อมบำรุงและบริการ";
    const mKpi4 = document.getElementById("mnt-kpi-renewal-lbl") || document.getElementById("maint-kpi-renewal-lbl");
    if (mKpi4) mKpi4.textContent = isEn ? "Tax / ACT / Insurance Renewals" : "งานต่อภาษี / พรบ. / ประกัน";

    // Maintenance filter bar
    const mLblSearch = document.getElementById("mnt-lbl-search");
    if (mLblSearch) mLblSearch.textContent = isEn ? "Search (Plate / Work Order / Garage / Issue):" : "ค้นหา (ทะเบียน / เลขใบงาน / อู่ / รายการซ่อม):";
    const mSearch = document.getElementById("mnt-search-input");
    if (mSearch) mSearch.placeholder = isEn ? "Search plate, garage, work order, details..." : "พิมพ์ค้นหา...";

    const mLblType = document.getElementById("mnt-lbl-type") || document.getElementById("maint-filter-type-lbl");
    if (mLblType) mLblType.textContent = isEn ? "Filter Job Category:" : "ประเภทงาน:";
    const optMTypeAll = document.getElementById("opt-mnt-type-all");
    if (optMTypeAll) optMTypeAll.textContent = isEn ? "All" : "ทั้งหมด";
    const optMTypeRout = document.getElementById("opt-mnt-type-routine");
    if (optMTypeRout) optMTypeRout.textContent = isEn ? "Routine / Oil Change" : "ซ่อมบำรุงทั่วไป / เช็คระยะ";
    const optMTypeEng = document.getElementById("opt-mnt-type-engine");
    if (optMTypeEng) optMTypeEng.textContent = isEn ? "Engine & Suspension" : "ซ่อมเครื่องยนต์ / ช่วงล่าง";
    const optMTypeBody = document.getElementById("opt-mnt-type-body");
    if (optMTypeBody) optMTypeBody.textContent = isEn ? "Body & Paint" : "เคาะพ่นสี / ตัวถัง";
    const optMTypeTax = document.getElementById("opt-mnt-type-tax");
    if (optMTypeTax) optMTypeTax.textContent = isEn ? "Vehicle Tax & ACT" : "ต่อทะเบียนภาษี / พ.ร.บ.";
    const optMTypeIns = document.getElementById("opt-mnt-type-ins");
    if (optMTypeIns) optMTypeIns.textContent = isEn ? "Car Insurance Renewal" : "ต่อประกันภัยรถยนต์";
    const optMTypeInsp = document.getElementById("opt-mnt-type-inspect");
    if (optMTypeInsp) optMTypeInsp.textContent = isEn ? "Vehicle Inspection (Tor Ror Or)" : "ตรวจสภาพรถ ตรอ.";

    const mLblStat = document.getElementById("mnt-lbl-status") || document.getElementById("maint-filter-status-lbl");
    if (mLblStat) mLblStat.textContent = isEn ? "Filter Status:" : "สถานะ:";
    const optMStatAll = document.getElementById("opt-mnt-status-all");
    if (optMStatAll) optMStatAll.textContent = isEn ? "All" : "ทั้งหมด";
    const optMStatRep = document.getElementById("opt-mnt-status-repairing");
    if (optMStatRep) optMStatRep.textContent = isEn ? "In Repair" : "กำลังซ่อมบำรุง";
    const optMStatPend = document.getElementById("opt-mnt-status-pending");
    if (optMStatPend) optMStatPend.textContent = isEn ? "Pending" : "รอดำเนินการ";
    const optMStatDone = document.getElementById("opt-mnt-status-done");
    if (optMStatDone) optMStatDone.textContent = isEn ? "Completed" : "เสร็จสิ้น";

    const mLblCar = document.getElementById("mnt-lbl-car");
    if (mLblCar) mLblCar.textContent = isEn ? "Select Vehicle:" : "เลือกรถ:";
    const optMCarAll = document.getElementById("opt-mnt-car-all");
    if (optMCarAll) optMCarAll.textContent = isEn ? "All Vehicles" : "ทุกคัน";

    // Maintenance Table Title & Headers
    const mTblTitlePfx = document.getElementById("mnt-table-title-prefix");
    if (mTblTitlePfx) mTblTitlePfx.textContent = isEn ? "All Maintenance & Service History Records (" : "ประวัติการซ่อมบำรุงและบริการทั้งหมด (";
    const mTblTitleSfx = document.getElementById("mnt-table-title-suffix");
    if (mTblTitleSfx) mTblTitleSfx.textContent = isEn ? " Records)" : " รายการ)";

    const thMid = document.getElementById("mnt-th-id") || document.getElementById("maint-th-wo");
    if (thMid) thMid.textContent = isEn ? "Work Order No." : "เลขที่ใบงาน";
    const thMplate = document.getElementById("mnt-th-plate") || document.getElementById("maint-th-plate");
    if (thMplate) thMplate.textContent = isEn ? "Plate & Vehicle" : "ทะเบียน & รถยนต์";
    const thMtype = document.getElementById("mnt-th-type") || document.getElementById("maint-th-type");
    if (thMtype) thMtype.textContent = isEn ? "Category" : "ประเภทงาน";
    const thMitems = document.getElementById("mnt-th-items") || document.getElementById("maint-th-detail");
    if (thMitems) thMitems.textContent = isEn ? "Service Items / Issues" : "รายการซ่อม / รายการบริการ";
    const thMcost = document.getElementById("mnt-th-cost") || document.getElementById("maint-th-cost");
    if (thMcost) thMcost.textContent = isEn ? "Cost (฿)" : "ค่าซ่อมบำรุง (฿)";
    const thMcenter = document.getElementById("mnt-th-center") || document.getElementById("maint-th-garage");
    if (thMcenter) thMcenter.textContent = isEn ? "Garage / Center" : "อู่ / ศูนย์บริการ";
    const thMworker = document.getElementById("mnt-th-worker") || document.getElementById("maint-th-staff");
    if (thMworker) thMworker.textContent = isEn ? "Assigned Staff" : "พนักงานผู้รับผิดชอบ";
    const thMsched = document.getElementById("mnt-th-sched") || document.getElementById("maint-th-date");
    if (thMsched) thMsched.textContent = isEn ? "Schedule" : "กำหนดการ";
    const thMstatus = document.getElementById("mnt-th-status") || document.getElementById("maint-th-status");
    if (thMstatus) thMstatus.textContent = isEn ? "Status" : "สถานะ";
    const thMacts = document.getElementById("mnt-th-acts") || document.getElementById("maint-th-action");
    if (thMacts) thMacts.textContent = isEn ? "Issue & Close Job" : "ออกใบงาน & ปิดงาน";

    // 11. Dashboard Module Localization
    const dTitle = document.getElementById("dash-main-title");
    if (dTitle) dTitle.innerHTML = isEn 
      ? 'Executive Dashboard & Total Fleet' 
      : 'ภาพรวมและแดชบอร์ดผู้บริหาร (Executive Dashboard & Total Fleet)';
    const dSubtitle = document.getElementById("dash-main-subtitle");
    if (dSubtitle) dSubtitle.textContent = isEn 
      ? "Fleet Overview & Real-time Metrics" 
      : "ภาพรวมสถานะฟลีทรถ รายได้ และสถิติการดำเนินงานแบบเรียลไทม์";

    const dKpiFleet = document.getElementById("dash-kpi-fleet-lbl");
    if (dKpiFleet) dKpiFleet.textContent = isEn ? "Total Fleet" : "กองยานพาหนะ (Fleet)";
    const dKpiFleetBdg = document.getElementById("dash-kpi-fleet-badge");
    if (dKpiFleetBdg) dKpiFleetBdg.textContent = isEn ? "Fleet Showcase" : "ไปหน้าเลือกรถ";

    const dKpiActive = document.getElementById("dash-kpi-active-lbl");
    if (dKpiActive) dKpiActive.textContent = isEn ? "Active Rentals" : "รถกำลังเช่า/ติดจอง (Active)";
    const dKpiActiveBdg = document.getElementById("dash-kpi-active-badge");
    if (dKpiActiveBdg) dKpiActiveBdg.textContent = isEn ? "View Active" : "ดูรถที่อยู่กับลูกค้า";

    const dKpiUtil = document.getElementById("dash-kpi-util-lbl");
    if (dKpiUtil) dKpiUtil.textContent = isEn ? "Fleet Utilization" : "อัตราการใช้รถ (Utilization)";
    const dKpiUtilBdg = document.getElementById("dash-kpi-util-badge");
    if (dKpiUtilBdg) dKpiUtilBdg.textContent = isEn ? "Profit Ranking" : "อันดับกำไรสุทธิ";

    const dKpiRev = document.getElementById("dash-kpi-rev-lbl");
    if (dKpiRev) dKpiRev.textContent = isEn ? "Total Revenue" : "รายรับสะสมรวม (Revenue)";

    const dKpiInst = document.getElementById("dash-kpi-inst-lbl");
    if (dKpiInst) dKpiInst.textContent = isEn ? "Total Monthly Fleet Installments" : "รายจ่ายค่างวดรถรวมต่อเดือน";

    const cycle = this.getExpiryCycleInfo();
    const dAlertTitle = document.getElementById("dash-alert-title");
    if (dAlertTitle) dAlertTitle.textContent = isEn 
      ? "Document Expiry Alerts (1st & 16th Cycle)" 
      : "ระบบแจ้งเตือนต่ออายุเอกสาร (รอบวันที่ 1 และ 16)";
    const dAlertBadge = document.getElementById("dash-alert-cycle-badge");
    if (dAlertBadge) dAlertBadge.textContent = isEn ? cycle.badgeTextEn : cycle.badgeText;
    const dAlertDesc = document.getElementById("dash-alert-desc");
    if (dAlertDesc) dAlertDesc.innerHTML = isEn 
      ? `1st of month: current month • 16th of month: next month • <b>Active: ${cycle.roundNameEn}</b> (Click to view)` 
      : `ทุกวันที่ 1 แจ้งเตือนหมดอายุเดือนนี้ • ทุกวันที่ 16 แจ้งเตือนหมดอายุเดือนหน้า • <b>รอบปัจจุบัน: ${cycle.roundName}</b> (คลิกแถบนี้เพื่อดูรายการ)`;
    const btnLineCheck = document.getElementById("btn-dash-line-check");
    if (btnLineCheck) btnLineCheck.textContent = isEn ? "Send LINE Alert" : "ส่งแจ้งเตือน LINE";

    const dDonutTitle = document.getElementById("dash-donut-title");
    if (dDonutTitle) dDonutTitle.textContent = isEn ? "Current Fleet Status" : "สถานะรถปัจจุบัน (Current Fleet Status)";
    const dDonutSubtitle = document.getElementById("dash-donut-subtitle");
    if (dDonutSubtitle) dDonutSubtitle.textContent = isEn ? "Real-time fleet breakdown" : "สัดส่วนสถานะรถทั้งหมดในระบบ";

    const dTrendTitle = document.getElementById("dash-trend-title");
    if (dTrendTitle) dTrendTitle.textContent = isEn ? "Total Revenue Trend" : "แนวโน้มรายรับรวม (Total Revenue Trend)";
    const dTrendSubtitle = document.getElementById("dash-trend-subtitle");
    if (dTrendSubtitle) dTrendSubtitle.textContent = isEn ? "Monthly revenue trend" : "ยอดรายรับรวมย้อนหลังรายเดือน";

    const btnTrendBar = document.getElementById("btn-trend-bar");
    if (btnTrendBar) btnTrendBar.textContent = isEn ? "Bar Chart" : "กราฟแท่ง";
    const btnTrendArea = document.getElementById("btn-trend-area");
    if (btnTrendArea) btnTrendArea.textContent = isEn ? "Area Chart" : "กราฟพื้นที่";

    const dFleetSortLbl = document.getElementById("dash-fleet-sort-lbl");
    if (dFleetSortLbl) dFleetSortLbl.textContent = isEn ? "Sort By:" : "เรียงลำดับ:";
    const optSortExp = document.getElementById("opt-dash-sort-exp");
    if (optSortExp) optSortExp.textContent = isEn ? "Nearest Expiry (Tax / ACT / Ins)" : "วันหมดอายุ ภาษี / พ.ร.บ. / ประกัน ใกล้หมดก่อน";
    const optSortTax = document.getElementById("opt-dash-sort-tax");
    if (optSortTax) optSortTax.textContent = isEn ? "Nearest Tax Expiry" : "วันหมดอายุ ภาษีรถยนต์ ใกล้หมดก่อน";
    const optSortAct = document.getElementById("opt-dash-sort-act");
    if (optSortAct) optSortAct.textContent = isEn ? "Nearest ACT Expiry" : "วันหมดอายุ พ.ร.บ. ใกล้หมดก่อน";
    const optSortIns = document.getElementById("opt-dash-sort-ins");
    if (optSortIns) optSortIns.textContent = isEn ? "Nearest Insurance Expiry" : "วันหมดอายุ ประกันภัย ใกล้หมดก่อน";
    const optSortPlate = document.getElementById("opt-dash-sort-plate");
    if (optSortPlate) optSortPlate.textContent = isEn ? "Plate No. (A-Z / 0-9)" : "เลขทะเบียนรถ (ก-ฮ / 0-9)";

    const dFleetSearch = document.getElementById("dash-fleet-search-input");
    if (dFleetSearch) dFleetSearch.placeholder = isEn ? "Search plate / VIN / model / insurance / notes..." : "ค้นหาทะเบียน / เลขถัง / รุ่น / ประกัน / หมายเหตุ...";
    const btnAddCar = document.getElementById("btn-dash-add-car");
    if (btnAddCar) btnAddCar.textContent = isEn ? "Add New Vehicle" : "เพิ่มรถใหม่";

    const thFPlate = document.getElementById("th-fleet-plate");
    if (thFPlate) thFPlate.textContent = isEn ? "Plate / Year" : "ทะเบียน / ปีจด";
    const thFBrand = document.getElementById("th-fleet-brand");
    if (thFBrand) thFBrand.textContent = isEn ? "Make / Model / Color" : "ยี่ห้อ / รุ่น / สี";
    const thFVin = document.getElementById("th-fleet-vin");
    if (thFVin) thFVin.textContent = isEn ? "VIN / Chassis No." : "หมายเลขตัวถัง (VIN)";
    const thFOwner = document.getElementById("th-fleet-owner");
    if (thFOwner) thFOwner.textContent = isEn ? "Owner / Beneficiary" : "เจ้าของ / ผู้รับผลประโยชน์";
    const thFStatus = document.getElementById("th-fleet-status");
    if (thFStatus) thFStatus.textContent = isEn ? "Status" : "สถานะ";
    const thFTax = document.getElementById("th-fleet-tax");
    if (thFTax) thFTax.textContent = isEn ? "Tax Expiry" : "วันหมดอายุ ภาษี";
    const thFAct = document.getElementById("th-fleet-act");
    if (thFAct) thFAct.textContent = isEn ? "ACT Expiry" : "วันหมดอายุ พ.ร.บ.";
    const thFIns = document.getElementById("th-fleet-ins");
    if (thFIns) thFIns.textContent = isEn ? "Insurance Expiry & Insurer" : "วันหมดอายุ ประกันภัย & บ.ประกัน";
    const thFMileage = document.getElementById("th-fleet-mileage");
    if (thFMileage) thFMileage.textContent = isEn ? "Service Mileage" : "เช็คระยะ / เลขไมล์";
    const thFNote = document.getElementById("th-fleet-note");
    if (thFNote) thFNote.textContent = isEn ? "Remarks / HP Lease" : "หมายเหตุ / สัญญาเช่าซื้อ";
    const thFAction = document.getElementById("th-fleet-action");
    if (thFAction) thFAction.textContent = isEn ? "Action" : "จัดการ";

    const dFleetTip = document.getElementById("dash-fleet-footer-tip");
    if (dFleetTip) dFleetTip.innerHTML = isEn 
      ? 'Automatic duplicate prevention (Plate and VIN). Click <b>Edit</b> to edit expiry dates or <b>Work Order</b> to assign staff immediately.' 
      : 'ระบบตรวจสอบและป้องกันรถซ้ำอัตโนมัติ (ทั้งเลขทะเบียนและเลขตัวถัง VIN) สามารถคลิก <b>แก้ไข</b> เพื่อแก้ไขวันหมดอายุภาษี/พ.ร.บ./ประกันภัย หรือกด <b>ออกใบงาน</b> เพื่อมอบหมายพนักงานได้ทันที';

    // 12. Dashboard Sub-tables (HP / Leasing & Completed Jobs)
    const thHpNo = document.getElementById("th-hp-no");
    if (thHpNo) thHpNo.textContent = isEn ? "No." : "ลำดับ";
    const thHpModel = document.getElementById("th-hp-model");
    if (thHpModel) thHpModel.textContent = isEn ? "Vehicle Model" : "รุ่นรถยนต์";
    const thHpPlate = document.getElementById("th-hp-plate");
    if (thHpPlate) thHpPlate.textContent = isEn ? "Plate / VIN" : "ทะเบียน / เลขถัง";
    const thHpContract = document.getElementById("th-hp-contract");
    if (thHpContract) thHpContract.textContent = isEn ? "Contract No." : "เลขที่สัญญา";
    const thHpDown = document.getElementById("th-hp-down");
    if (thHpDown) thHpDown.textContent = isEn ? "Down Date / Payment" : "วันดาวน์ / เงินดาวน์";
    const thHpDue = document.getElementById("th-hp-due");
    if (thHpDue) thHpDue.textContent = isEn ? "First Due / Due Date" : "งวดแรก / กำหนดชำระ";
    const thHpInst = document.getElementById("th-hp-inst");
    if (thHpInst) thHpInst.textContent = isEn ? "Monthly Installment" : "ค่างวด/เดือน";
    const thHpTerms = document.getElementById("th-hp-terms");
    if (thHpTerms) thHpTerms.textContent = isEn ? "Total Terms" : "จำนวนงวด";
    const thHpPaid = document.getElementById("th-hp-paid");
    if (thHpPaid) thHpPaid.textContent = isEn ? "Paid (THB)" : "ชำระแล้ว (บาท)";
    const thHpRem = document.getElementById("th-hp-rem");
    if (thHpRem) thHpRem.textContent = isEn ? "Remaining (THB)" : "คงเหลือ (บาท)";
    const thHpTotal = document.getElementById("th-hp-total");
    if (thHpTotal) thHpTotal.textContent = isEn ? "Total Price incl. Down" : "ราคารถรวมดาวน์";

    const titlePropIns = document.getElementById("title-property-insurance");
    if (titlePropIns) titlePropIns.textContent = isEn ? "Property & Personal Accident Insurance Policies" : "กรมธรรม์ประกันภัยทรัพย์สินและประกันอุบัติเหตุส่วนบุคคล";

    const thPropCode = document.getElementById("th-prop-code");
    if (thPropCode) thPropCode.textContent = isEn ? "Code" : "รหัส";
    const thPropItem = document.getElementById("th-prop-item");
    if (thPropItem) thPropItem.textContent = isEn ? "Policy / Property Item" : "รายการกรมธรรม์ / ทรัพย์สิน";
    const thPropOwner = document.getElementById("th-prop-owner");
    if (thPropOwner) thPropOwner.textContent = isEn ? "Insured / Owner" : "ผู้เอาประกัน / เจ้าของ";
    const thPropComp = document.getElementById("th-prop-comp");
    if (thPropComp) thPropComp.textContent = isEn ? "Insurance Company" : "บริษัทประกันภัย";
    const thPropExp = document.getElementById("th-prop-exp");
    if (thPropExp) thPropExp.textContent = isEn ? "Expiry Date" : "วันหมดอายุ";
    const thPropNotes = document.getElementById("th-prop-notes");
    if (thPropNotes) thPropNotes.textContent = isEn ? "Remarks" : "หมายเหตุ";

    // Completed Jobs Filters & Monthly KPI Labels
    const lblRptMonth = document.getElementById("lbl-report-month");
    if (lblRptMonth) lblRptMonth.textContent = isEn ? "Select Month for Report:" : "เลือกเดือนที่ต้องการดูรายงาน:";
    const lblRptComp = document.getElementById("lbl-report-company");
    if (lblRptComp) lblRptComp.textContent = isEn ? "Filter Report by Company:" : "เลือกรีพอร์ตตามบริษัท:";
    const optRptAllComp = document.getElementById("opt-report-all-comp");
    if (optRptAllComp) optRptAllComp.textContent = isEn ? "All (All Companies)" : "ทั้งหมด (ทุกบริษัท)";
    const btnRptAllM = document.getElementById("btn-report-all-months");
    if (btnRptAllM) btnRptAllM.textContent = isEn ? "View All Months" : "ดูทุกเดือนทั้งหมด";
    const btnExpCsv = document.getElementById("btn-export-csv");
    if (btnExpCsv) btnExpCsv.textContent = isEn ? "Download Completed Jobs Summary (CSV for Excel)" : "ดาวน์โหลดรายงานสรุปงานเสร็จสิ้น (CSV สำหรับ Excel)";

    const lblKpiJobs = document.getElementById("lbl-rpt-kpi-jobs");
    if (lblKpiJobs) lblKpiJobs.textContent = isEn ? "Total Completed Jobs" : "งานเสร็จสิ้นทั้งหมด";
    const lblKpiRev = document.getElementById("lbl-rpt-kpi-rev");
    if (lblKpiRev) lblKpiRev.textContent = isEn ? "Total Rental Revenue" : "รายรับรวมจากงานเช่า";
    const lblKpiCars = document.getElementById("lbl-rpt-kpi-cars");
    if (lblKpiCars) lblKpiCars.textContent = isEn ? "Active Vehicles" : "รถที่ให้บริการ";
    const lblKpiCusts = document.getElementById("lbl-rpt-kpi-custs");
    if (lblKpiCusts) lblKpiCusts.textContent = isEn ? "Total Customers" : "ลูกค้าที่ใช้บริการ";

    // Completed Jobs Table Headers
    const thRptBkid = document.getElementById("th-rpt-bkid");
    if (thRptBkid) thRptBkid.textContent = isEn ? "Booking ID" : "รหัสการจอง";
    const thRptDate = document.getElementById("th-rpt-date");
    if (thRptDate) thRptDate.textContent = isEn ? "Completed Date" : "วันที่เสร็จสิ้น";
    const thRptPlate = document.getElementById("th-rpt-plate");
    if (thRptPlate) thRptPlate.textContent = isEn ? "Plate No." : "ทะเบียนรถ";
    const thRptCust = document.getElementById("th-rpt-cust");
    if (thRptCust) thRptCust.textContent = isEn ? "Customer" : "ลูกค้า";
    const thRptComp = document.getElementById("th-rpt-comp");
    if (thRptComp) thRptComp.textContent = isEn ? "Company" : "บริษัท";
    const thRptCtype = document.getElementById("th-rpt-ctype");
    if (thRptCtype) thRptCtype.textContent = isEn ? "Contract Type" : "ประเภทสัญญา";
    const thRptRev = document.getElementById("th-rpt-rev");
    if (thRptRev) thRptRev.textContent = isEn ? "Net Revenue" : "รายรับสุทธิ";
    const thRptStaff = document.getElementById("th-rpt-staff");
    if (thRptStaff) thRptStaff.textContent = isEn ? "Staff (Dispatch/Return)" : "พนักงานส่ง-รับ";
    const thRptLoc = document.getElementById("th-rpt-loc");
    if (thRptLoc) thRptLoc.textContent = isEn ? "Location" : "สถานที่";
    const thRptFuel = document.getElementById("th-rpt-fuel");
    if (thRptFuel) thRptFuel.textContent = isEn ? "Fuel & Condition" : "เกจ์น้ำมัน & สภาพรถ";
    const thRptStatus = document.getElementById("th-rpt-status");
    if (thRptStatus) thRptStatus.textContent = isEn ? "Status" : "สถานะ";
    const thRptDocs = document.getElementById("th-rpt-docs");
    if (thRptDocs) thRptDocs.innerHTML = isEn 
      ? 'Archived Documents<br/><span style="font-size:10.5px; font-weight:normal; color:#64748B;">(📝 Contract | 🧾 Receipt | 📋 Checklist)</span>' 
      : 'เอกสารย้อนหลัง<br/><span style="font-size:10.5px; font-weight:normal; color:#64748B;">(📝 สัญญา | 🧾 ใบเสร็จ | 📋 ใบเช็ครถ)</span>';

    // 13. Expander Indicators Translation
    document.querySelectorAll(".expander-card").forEach(card => {
      const body = card.querySelector(".expander-body");
      const indicator = card.querySelector(".expander-indicator span");
      if (!indicator) return;
      const isOpen = body && body.style.display !== "none";
      if (isOpen) {
        indicator.textContent = isEn ? "▲ Click to collapse" : "▲ คลิกเพื่อพับเก็บ";
      } else {
        indicator.textContent = isEn ? "▼ Click to expand" : "▼ คลิกเพื่อกางดูข้อมูล";
      }
    });

    // 14. Trigger active module re-rendering with new language
    if (this.populateFleetDropdowns) {
      this.populateFleetDropdowns();
    }
    if (this.renderFleetCards) {
      this.renderFleetCards();
    }
    if (this.calcDuration) {
      const dur = this.calcDuration();
      const durTxt = document.getElementById("calc-duration-text");
      if (durTxt) durTxt.textContent = dur.text;
    }
    if (this.populateBookingDropdowns) {
      this.populateBookingDropdowns();
    }
    if (this.renderBookingsTable) {
      this.renderBookingsTable();
    }
    if (this.activeTab === "contract" && this.onSelectContractBooking) {
      this.onSelectContractBooking();
    }
    if (this.activeTab === "deposit" && this.onSelectDepositBooking) {
      this.onSelectDepositBooking();
    }
    if (this.activeTab === "assign") {
      if (this.onSelectAssignDispBooking) this.onSelectAssignDispBooking();
      if (this.onSelectAssignRetBooking) this.onSelectAssignRetBooking();
    }
    if (this.populateMaintenanceDropdowns) {
      this.populateMaintenanceDropdowns();
    }
    if (this.renderMaintenanceRecords) {
      this.renderMaintenanceRecords();
    }
    if (this.renderHpLeasingTable) {
      this.renderHpLeasingTable();
    }
    if (this.renderCompletedJobsTable) {
      this.renderCompletedJobsTable();
    }
    if (this.activeModule === "dashboard") {
      this.updateDashboardKPIsFromScope();
      this.renderDashboardCharts();
      this.renderFleetOverviewTable();
    }
  }
});
