/**
 * Sawasdee Rental - High-Speed SPA Application Logic
 */
var isRent = false;

class App {
  constructor() {
    let savedUser = null;
    try {
      // Clear legacy persistent localStorage user so new visits always require login
      localStorage.removeItem("sawasdee_user");
      // Check 6-hour session timeout (6 * 60 * 60 * 1000 ms)
      const loginTime = parseInt(sessionStorage.getItem("sawasdee_login_time") || "0", 10);
      const SESSION_TIMEOUT_MS = 6 * 60 * 60 * 1000;
      if (loginTime && (Date.now() - loginTime > SESSION_TIMEOUT_MS)) {
        sessionStorage.removeItem("sawasdee_user");
        sessionStorage.removeItem("sawasdee_login_time");
        savedUser = null;
      } else {
        // Use sessionStorage so credentials persist only within active browser session/tab
        savedUser = JSON.parse(sessionStorage.getItem("sawasdee_user") || "null");
      }
    } catch (e) {
      savedUser = null;
    }
    this.user = savedUser;

    this.cars = [];
    this.customers = [];
    this.bookings = [];
    this.backofficeJobs = [];
    this.completedJobs = [];
    this.users = [];
    this.maintenanceRecords = [];
    this.activeModule = "frontoffice";
    this.activeTab = "fleet";
    this.uploadedPhotos = [];
    this.currentSelectedBooking = null;
    // Search and Dashboard Charts State
    this.sidebarSearchKw = "";
    this.donutCharts = {};
    this.trendChart = null;
    this.trendMetric = "rev";
    this.selectedTrendCompanies = ["Sawasdee Rent A Car", "P.D.P. Co., Ltd.", "Sawasdee Car Rent"];

    // Modal & Selection State Management
    this.selectedVehicle = null;
    this.isModalOpen = false;

    this.init();
  }

  async init() {
    const dismissSplash = () => {
      const splash = document.getElementById("app-splash-screen");
      if (splash) {
        if (!splash.classList.contains("fade-out")) {
          splash.classList.add("fade-out");
        }
        setTimeout(() => {
          if (splash) splash.style.display = "none";
        }, 500);
      }
    };

    // Absolute fallback: never leave splash hanging beyond 2.5 seconds under any circumstance
    const fallbackTimer = setTimeout(() => {
      dismissSplash();
    }, 2500);

    try {
      try { this.initGlobalEnterKeyNavigation(); } catch (e) { console.warn("EnterKeyNav err:", e); }
      try { this.initLanguage(); } catch (e) { console.warn("InitLang err:", e); }
      try { this.setupDatePickers(); } catch (e) { console.warn("DatePickers err:", e); }
      try { this.updateAuthUI(); } catch (e) { console.warn("UpdateAuthUI err:", e); }

      const splashStatus = document.getElementById("app-splash-status");

      if (this.user) {
        if (splashStatus) splashStatus.textContent = "กำลังโหลดข้อมูลระบบ...";
        try {
          // Timeout fetchInitialData so slow API never freezes the app on splash
          await Promise.race([
            this.fetchInitialData(),
            new Promise(res => setTimeout(res, 3500))
          ]);
        } catch (fetchErr) {
          console.error("fetchInitialData err:", fetchErr);
        }
        try { this.startLiveSyncPoller(); } catch (pollErr) { console.warn("startLiveSyncPoller err:", pollErr); }
        clearTimeout(fallbackTimer);
        setTimeout(dismissSplash, 250);
      } else {
        clearTimeout(fallbackTimer);
        setTimeout(dismissSplash, 300);
      }
    } catch (fatalErr) {
      console.error("App init fatal error:", fatalErr);
      clearTimeout(fallbackTimer);
      dismissSplash();
    }
  }

  checkSessionTimeout() {
    if (!this.user) return false;
    const loginTime = parseInt(sessionStorage.getItem("sawasdee_login_time") || "0", 10);
    const SESSION_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours
    if (loginTime && (Date.now() - loginTime > SESSION_TIMEOUT_MS)) {
      this.logout();
      const isEn = (this.currentLang === "EN");
      alert(isEn ? "Session expired (6 hours timeout). Please log in again." : "เซสชันการใช้งานหมดอายุ (ครบ 6 ชั่วโมง) กรุณาเข้าสู่ระบบใหม่อีกครั้งเพื่อความปลอดภัย");
      return true;
    }
    return false;
  }

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
  }

  initLanguage() {
    this.currentLang = localStorage.getItem("sawasdee_lang") || "TH";
    this.applyLanguage();
  }

  toggleLanguage() {
    this.currentLang = (this.currentLang === "EN") ? "TH" : "EN";
    localStorage.setItem("sawasdee_lang", this.currentLang);
    this.applyLanguage();
  }

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
    if (optBksAll) optBksAll.textContent = isEn ? "All" : "ทั้งหมด";
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
        indicator.textContent = isEn ? "▼ Click to expand" : "▼ คลิกเพื่อแสดงเนื้อหา";
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

  initGlobalEnterKeyNavigation() {
    document.addEventListener("keydown", (e) => {
      // Only handle Enter without Ctrl / Meta / Alt, and ignore IME composition
      if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;

      const activeEl = document.activeElement;
      if (!activeEl) return;

      // Special handling for Auth Gate Screen (Enter navigation & submit)
      if (activeEl.closest("#auth-gate-screen")) {
        if (activeEl.id === "gate-login-username") {
          e.preventDefault();
          const pEl = document.getElementById("gate-login-password");
          if (pEl) pEl.focus();
          return;
        }
        if (activeEl.id === "gate-login-password") {
          e.preventDefault();
          this.submitGateLogin();
          return;
        }
      }

      const tag = activeEl.tagName.toLowerCase();
      // Allow textarea to insert line breaks normally
      if (tag === "textarea") return;
      // Allow buttons to be triggered normally on Enter
      if (tag === "button") return;

      // Only handle input and select
      if (tag !== "input" && tag !== "select") return;

      const inputType = (activeEl.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "file"].includes(inputType)) return;

      // Prevent default form submit or page reload
      e.preventDefault();

      // Find the logical container context:
      // 1. Is it inside an open modal?
      const openModal = activeEl.closest(".modal-backdrop.active, .modal-backdrop[style*='display: flex'], .modal-backdrop[style*='display: block'], .modal-backdrop");
      let container = null;
      if (openModal && window.getComputedStyle(openModal).display !== "none") {
        container = openModal.querySelector(".modal-dialog, .modal-box, .modal-content") || openModal;
      } else {
        // 2. Is it inside an active tab?
        container = activeEl.closest(".tab-content.active, .tab-pane.active") || activeEl.closest(".tab-content");
      }
      if (!container) {
        // 3. Fallback to closest section, card, form, or body
        container = activeEl.closest(".card, form, main") || document.body;
      }

      // Query candidate form elements within this container
      const selector = [
        'input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([disabled]):not([readonly])',
        'select:not([disabled]):not([readonly])'
      ].join(", ");

      const candidates = Array.from(container.querySelectorAll(selector));
      const visibleFields = candidates.filter(el => {
        if (el.disabled || el.readOnly || el.type === "hidden") return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        return (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
      });

      const currIndex = visibleFields.indexOf(activeEl);

      // Support Shift + Enter to navigate to previous field
      if (e.shiftKey) {
        if (currIndex > 0) {
          const prevEl = visibleFields[currIndex - 1];
          prevEl.focus();
          if (typeof prevEl.select === "function" && prevEl.tagName.toLowerCase() === "input" && !["date", "time", "color", "range"].includes(prevEl.type)) {
            prevEl.select();
          }
        }
        return;
      }

      // Enter to navigate to next field
      if (currIndex >= 0 && currIndex < visibleFields.length - 1) {
        const nextEl = visibleFields[currIndex + 1];
        nextEl.focus();
        if (typeof nextEl.select === "function" && nextEl.tagName.toLowerCase() === "input" && !["date", "time", "color", "range"].includes(nextEl.type)) {
          nextEl.select();
        }
      } else if (currIndex === visibleFields.length - 1) {
        // At the last field in container: focus the primary action / submit button
        const primaryBtn = container.querySelector(
          'button.btn-primary:not([disabled]):not([style*="display: none"]), button[type="submit"]:not([disabled]):not([style*="display: none"]), .btn-save:not([disabled])'
        );
        if (primaryBtn && window.getComputedStyle(primaryBtn).display !== "none") {
          primaryBtn.focus();
        }
      }
    });

    // Dismiss custom searchable dropdowns when clicking outside
    document.addEventListener("click", (e) => {
      const container = document.getElementById("mnt-car-dropdown-container");
      if (container && !container.contains(e.target)) {
        const listEl = document.getElementById("mnt-car-dropdown-list");
        if (listEl) listEl.style.display = "none";
      }
      const swapContainer = document.getElementById("insp-swap-car-dropdown-container");
      if (swapContainer && !swapContainer.contains(e.target)) {
        const swapList = document.getElementById("insp-swap-car-dropdown-list");
        if (swapList) swapList.style.display = "none";
      }
    });
  }

  getThaiDateTime(offsetDays = 0) {
    const now = new Date(Date.now() + offsetDays * 86400000);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(now);
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    let yr = parseInt(map.year, 10);
    if (yr > 2400) {
      yr -= 543; // Always ensure 4-digit Gregorian year (YYYY) for HTML5 <input type="date">
    }
    const h = map.hour === "24" ? "00" : map.hour;
    const dStr = `${yr}-${map.month}-${map.day}`;
    const tStr = `${h}:${map.minute}`;
    return {
      date: dStr,
      time: tStr,
      dateStr: dStr,
      timeStr: tStr
    };
  }

  setupDatePickers() {
    const thNow = this.getThaiDateTime(0);
    const thNext3 = this.getThaiDateTime(3);
    const sDate = document.getElementById("filter-start-date");
    const eDate = document.getElementById("filter-end-date");
    if (sDate) {
      sDate.value = thNow.date;
      sDate.min = thNow.date;
    }
    if (eDate) {
      eDate.value = thNext3.date;
      eDate.min = thNow.date;
    }
    const sTime = document.getElementById("filter-start-time");
    const eTime = document.getElementById("filter-end-time");
    if (sTime) sTime.value = thNow.time;
    if (eTime) eTime.value = thNow.time;

    // Enforce min date to prevent backdated entries
    const wSDate = document.getElementById("walkin-start-date");
    const wEDate = document.getElementById("walkin-end-date");
    if (wSDate) {
      wSDate.min = thNow.date;
      if (!wSDate.value) wSDate.value = thNow.date;
    }
    if (wEDate) {
      wEDate.min = thNow.date;
      if (!wEDate.value) wEDate.value = thNext3.date;
    }
    const aDispDate = document.getElementById("assign-disp-date");
    const aDispSDate = document.getElementById("assign-disp-start-date");
    if (aDispDate) aDispDate.min = thNow.date;
    if (aDispSDate) aDispSDate.min = thNow.date;
  }

  updateAuthUI() {
    const gateScreen = document.getElementById("auth-gate-screen");
    const mainWrapper = document.getElementById("main-app-wrapper");
    const sbName = document.getElementById("sb-user-name");
    const sbRole = document.getElementById("sb-user-role");
    const sbAdminBtn = document.getElementById("sb-admin-staff-btn");
    const headerName = document.getElementById("user-display-name");
    const headerRole = document.getElementById("user-role-tag");

    if (!this.user || !this.user.username) {
      if (gateScreen) gateScreen.style.display = "flex";
      if (mainWrapper) mainWrapper.style.display = "none";
      return;
    }

    if (gateScreen) gateScreen.style.display = "none";
    if (mainWrapper) mainWrapper.style.display = "flex";

    const un = this.user.name || this.user.username || "admin";
    const role = this.user.role || "Admin";
    const isAdmin = (role === "Admin" || (this.user.username && this.user.username.toLowerCase() === "admin"));
    const roleLabel = isAdmin ? "👑 ผู้ดูแลระบบ (Admin)" : "👷 พนักงานปฏิบัติงาน";

    if (sbName) sbName.textContent = this.user.username || un;
    if (sbRole) sbRole.textContent = roleLabel;
    if (headerName) headerName.textContent = un;
    if (headerRole) {
      headerRole.textContent = role;
      headerRole.style.background = isAdmin ? "#FEF3C7" : "#EFF6FF";
      headerRole.style.color = isAdmin ? "#92400E" : "#1E40AF";
    }

    if (sbAdminBtn) {
      sbAdminBtn.style.display = isAdmin ? "flex" : "none";
    }
  }

  async fetchInitialData() {
    try {
      await Promise.all([
        this.loadUsers().catch(e => console.error("loadUsers err:", e)),
        this.loadCars().catch(e => console.error("loadCars err:", e)),
        this.loadCustomers().catch(e => console.error("loadCustomers err:", e)),
        this.loadBookings().catch(e => console.error("loadBookings err:", e)),
        this.loadBackOfficeJobs().catch(e => console.error("loadBackOfficeJobs err:", e)),
        this.loadMaintenanceRecords().catch(e => console.error("loadMaintenance err:", e)),
        this.loadDashboardKPIs().catch(e => console.error("loadDashboardKPIs err:", e)),
        this.loadHpLeasingData().catch(e => console.error("loadHpLeasing err:", e))
      ]);
      this.onFilterChange();
    } catch (e) {
      console.error("Initial load error:", e);
      try {
        this.onFilterChange();
      } catch (err2) {}
    }
  }

  startLiveSyncPoller() {
    setInterval(async () => {
      try {
        if (this.checkSessionTimeout()) return;
        const res = await fetch("/api/status");
        if (res.ok) {
          const st = await res.json();
          const syncTxt = document.getElementById("sync-time-txt");
          if (syncTxt) syncTxt.textContent = st.last_sync_formatted || "เมื่อสักครู่";
          if (st.data_signature && this.lastDataSignature && st.data_signature !== this.lastDataSignature) {
            this.lastDataSignature = st.data_signature;
            await this.fetchInitialData();
          } else if (st.data_signature && !this.lastDataSignature) {
            this.lastDataSignature = st.data_signature;
            if (typeof st.total_bookings === "number" && st.total_bookings !== this.bookings.length) {
              await this.fetchInitialData();
            }
          }
        }
      } catch (e) {}
    }, 8000);
  }

  async manualSync() {
    this.showToast("🔄 กำลังซิงค์ข้อมูลกับฐานข้อมูล PostgreSQL...", "info");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        await this.fetchInitialData();
        this.showToast("✅ ซิงค์ข้อมูลล่าสุดสำเร็จเรียบร้อย!", "success");
      }
    } catch (e) {
      this.showToast("⚠️ การซิงค์ขัดข้อง: " + e.message, "danger");
    }
  }

  // --- API Loaders ---
  async loadCars() {
    const sDate = document.getElementById("filter-start-date")?.value;
    const eDate = document.getElementById("filter-end-date")?.value;
    const url = `/api/cars?start_date=${sDate || ''}&end_date=${eDate || ''}`;
    const res = await fetch(url);
    if (res.ok) {
      this.cars = await res.json();
      this.populateFleetDropdowns();
      this.populateCarFormCreatableSelects();
      this.renderFleetCards();
      this.renderFleetOverviewTable();
      if (this.activeModule === "dashboard") {
        this.renderDashboardCharts();
      }
    }
  }

  populateFleetDropdowns() {
    const isEn = (this.currentLang === "EN");
    const allText = isEn ? "All" : "ทั้งหมด";

    // 1. Group Dropdown
    const selGroup = document.getElementById("filter-group");
    if (selGroup) {
      const curVal = selGroup.value;
      const groups = Array.from(new Set(this.cars.map(c => (c.car_group || "").trim()).filter(Boolean))).sort();
      selGroup.innerHTML = `<option value="ทั้งหมด">${allText}</option>` + 
        groups.map(g => `<option value="${g}">${g}</option>`).join("");
      if (curVal && (curVal === "ทั้งหมด" || groups.includes(curVal))) {
        selGroup.value = curVal;
      }
    }

    // 2. Brand Dropdown
    const selBrand = document.getElementById("filter-brand");
    if (selBrand) {
      const curVal = selBrand.value;
      const brands = Array.from(new Set(this.cars.map(c => (c.brand || "").trim()).filter(Boolean))).sort();
      selBrand.innerHTML = `<option value="ทั้งหมด">${allText}</option>` + 
        brands.map(b => `<option value="${b}">${b}</option>`).join("");
      if (curVal && (curVal === "ทั้งหมด" || brands.includes(curVal))) {
        selBrand.value = curVal;
      }
    }

    // 3. Company Dropdown
    const selComp = document.getElementById("filter-company");
    if (selComp) {
      const curVal = selComp.value;
      const companies = Array.from(new Set(this.cars.map(c => (c.company || c.owner_company || "").trim()).filter(Boolean))).sort();
      selComp.innerHTML = `<option value="ทั้งหมด">${allText}</option>` + 
        companies.map(co => `<option value="${co}">${co}</option>`).join("");
      if (curVal && (curVal === "ทั้งหมด" || companies.includes(curVal))) {
        selComp.value = curVal;
      }
    }
  }

  toggleBookingFilterCollapse() {
    this.bookingFilterCollapsed = !this.bookingFilterCollapsed;
    const content = document.getElementById("booking-bar-collapsible-content");
    const txt = document.getElementById("btn-toggle-filter-text");
    const isEn = (this.currentLang === "EN");
    if (content) {
      content.style.display = this.bookingFilterCollapsed ? "none" : "block";
    }
    if (txt) {
      txt.textContent = this.bookingFilterCollapsed
        ? (isEn ? "Show Filters ▾" : "แสดงตัวกรอง ▾")
        : (isEn ? "Hide Filters ▴" : "ซ่อนตัวกรอง ▴");
    }
  }

  resetFleetFilters() {
    const selGroup = document.getElementById("filter-group");
    const selBrand = document.getElementById("filter-brand");
    const selComp = document.getElementById("filter-company");
    const selStatus = document.getElementById("filter-status");
    const sDate = document.getElementById("filter-start-date");
    const sTime = document.getElementById("filter-start-time");
    const eDate = document.getElementById("filter-end-date");
    const eTime = document.getElementById("filter-end-time");
    const sbSearch = document.getElementById("sb-search-input");

    if (selGroup) selGroup.value = "ทั้งหมด";
    if (selBrand) selBrand.value = "ทั้งหมด";
    if (selComp) selComp.value = "ทั้งหมด";
    if (selStatus) selStatus.value = "ทั้งหมด";

    const thNow = this.getThaiDateTime(0);
    const thNext3 = this.getThaiDateTime(3);
    if (sDate) sDate.value = thNow.date;
    if (eDate) eDate.value = thNext3.date;
    if (sTime) sTime.value = thNow.time;
    if (eTime) eTime.value = thNow.time;
    if (sbSearch) sbSearch.value = "";
    this.sidebarSearchKw = "";

    this.loadCars();
    this.onFilterChange();
    this.showToast(this.currentLang === "EN" ? "🔄 All filters have been reset" : "🔄 คืนค่าตัวกรองทั้งหมดเรียบร้อย (เวลาไทย)", "info");
  }

  onDateFilterChange() {
    this.onFilterChange();
    this.loadCars();
  }

  async loadCustomers() {
    const res = await fetch("/api/customers");
    if (res.ok) {
      this.customers = await res.json();
      const badge = document.getElementById("badge-customers-count");
      if (badge) badge.textContent = this.customers.length;
      this.renderCustomersTable();
      this.populateCustomerDropdowns();
    }
  }

  async loadBookings() {
    try {
      const res = await fetch("/api/bookings");
      if (res.ok) {
        const raw = await res.json();
        this.bookings = (Array.isArray(raw) ? raw : []).map(b => {
          if (!b) return {};
          let ext = b.extension_history;
          if (typeof ext === "string") {
            try { ext = JSON.parse(ext); } catch (e) { ext = []; }
          }
          if (!Array.isArray(ext)) ext = [];
          return {
            ...b,
            booking_id: b.booking_id || "",
            car_id: b.car_id || "",
            customer: b.customer || "",
            status: b.status || "รอชำระมัดจำ",
            extension_history: ext,
            is_fully_paid: Boolean(b.is_fully_paid || b.rental_paid),
            contract_pdf_url: b.contract_pdf_url || ""
          };
        });
        const badge = document.getElementById("badge-frontoffice-bks");
        if (badge) badge.textContent = this.bookings.length;
        try { this.renderBookingsTable(); } catch (e) { console.error("renderBookingsTable error:", e); }
        try { this.populateBookingDropdowns(); } catch (e) { console.error("populateBookingDropdowns error:", e); }
      }
    } catch (err) {
      console.error("loadBookings fetch error:", err);
      this.bookings = this.bookings || [];
    }
  }

  async loadBackOfficeJobs() {
    const res = await fetch("/api/backoffice/jobs");
    if (res.ok) {
      this.backofficeJobs = await res.json();
      const badge = document.getElementById("badge-backoffice-jobs");
      if (badge) badge.textContent = this.backofficeJobs.length;
      this.populateBackofficeStaffFilter();
      this.renderBackofficeCalendar();
      this.renderBackOfficeJobs();
    }
  }

    async loadDashboardKPIs() {
    try {
      const res = await fetch(`/api/dashboard/stats?_t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
      });
      if (res.ok) {
        this.dashboardStats = await res.json();
        this.rawKpiData = this.dashboardStats;
      }
    } catch (e) {
      console.error("[Dashboard] Error fetching /api/dashboard/stats:", e);
    }

    try {
      this.updateDashboardKPIsFromScope();
    } catch (e) {
      console.error("[Dashboard] Error in updateDashboardKPIsFromScope:", e);
    }

    try {
      this.renderDashboardCharts();
    } catch (e) {
      console.error("[Dashboard] Error in renderDashboardCharts:", e);
    }

    try {
      await this.loadMonthlyReports();
    } catch (e) {
      console.error("[Dashboard] Error in loadMonthlyReports:", e);
    }

    try {
      await this.loadFinanceSummary();
    } catch (e) {
      console.error("[Dashboard] Error in loadFinanceSummary:", e);
    }

    try {
      this.renderFleetOverviewTable();
    } catch (e) {
      console.error("[Dashboard] Error in renderFleetOverviewTable:", e);
    }
  }

  onDashboardScopeChange() {
    this.updateDashboardKPIsFromScope();
    this.renderFleetOverviewTable();
  }

  matchesCompanyScope(rawCompany, scopeVal) {
    if (!scopeVal || scopeVal === "ทั้งหมด") return true;
    const raw = String(rawCompany || "").trim();
    if (raw === scopeVal) return true;
    if (scopeVal === "Sawasdee Rent A Car" && (raw.includes("สวัสดี เรนทัล") || raw.includes("Sawasdee Rental"))) return true;
    if (scopeVal === "P.D.P. Co., Ltd." && (raw.includes("P.D.P") || raw.includes("พี.ดี.พี"))) return true;
    if (scopeVal === "Sawasdee Car Rent" && raw.includes("บี คลิ๊ก")) return true;
    return false;
  }

    updateDashboardKPIsFromScope() {
    try {
      const isEn = (this.currentLang === "EN");
      const data = this.dashboardStats || {};
      const sc = data.status_counts || data.status_breakdown || data.fleet_status_breakdown || {};

      // Robust fallback extraction: never NaN or undefined
      let totalFleet = Number(data.total_fleet ?? data.total_cars ?? (this.cars || []).length ?? 0);
      let availCars = Number(sc.available ?? data.available ?? data.available_cars ?? 0);
      let onRentCars = Number(sc.on_rent ?? sc.rented ?? sc.onRent ?? data.on_rent ?? data.rented_cars ?? 0);
      let bookedCars = Number(sc.booked ?? sc.reserved ?? data.booked ?? data.booked_cars ?? 0);
      let maintCars = Number(sc.maintenance ?? sc.maint ?? data.maintenance ?? data.maintenance_cars ?? 0);

      // FOOLPROOF FALLBACK: If status counts from API are all 0 but this.cars exists in memory
      if (availCars === 0 && onRentCars === 0 && bookedCars === 0 && maintCars === 0 && (this.cars || []).length > 0) {
        totalFleet = this.cars.length;
        this.cars.forEach(c => {
          const st = String(c.status || c.car_status || "").trim().toLowerCase();
          const fKey = String(c.fleet_status_key || "").trim().toLowerCase();
          const isOnRent = Boolean(c.is_on_rent);
          if (isOnRent || fKey === "on_rent" || fKey === "rented" || st.includes("เช่า") || st.includes("rent") || st.includes("รอรับคืน")) {
            onRentCars++;
          } else if (fKey === "maintenance" || fKey === "repair" || st.includes("ซ่อม") || st.includes("ไม่พร้อม") || st.includes("ระงับ") || st.includes("maint") || st.includes("ต่อทะเบียน") || st.includes("ต่อภาษี") || st.includes("workshop") || st.includes("renewal")) {
            const pNorm = String(c.plate || "").replace(/[\s\-\.]+/g, "").toLowerCase();
            const hasActiveMaint = (this.maintenanceRecords || []).some(m => {
              const mpNorm = String(m.car_id || "").replace(/[\s\-\.]+/g, "").toLowerCase();
              const mSt = String(m.status || "").trim();
              return (m.car_id === c.plate || mpNorm === pNorm) && !["เสร็จสิ้น", "ยกเลิก", "completed", "canceled"].includes(mSt.toLowerCase());
            });
            if (hasActiveMaint) {
              maintCars++;
            } else {
              availCars++;
            }
          } else if (fKey === "booked" || fKey === "reserved" || st.includes("จอง") || st.includes("book") || st.includes("reserv") || st.includes("ติดจอง") || st.includes("ส่งมอบ")) {
            bookedCars++;
          } else {
            availCars++;
          }
        });
      }

      // Card 2: on_rent + booked (strictly never including available)
      const activeRentals = (onRentCars + bookedCars);
      const utilRate = (totalFleet > 0 ? ((activeRentals / totalFleet) * 100).toFixed(1) : "0.0");
      const totalRev = Number(data.total_revenue ?? 0);

      const elTotal = document.getElementById("kpi-total-cars");
      const elAvail = document.getElementById("kpi-avail-pill");
      const elActive = document.getElementById("kpi-active-rentals");
      const elMaint = document.getElementById("kpi-maint-pill");
      const elUtil = document.getElementById("kpi-utilization");
      const elRev = document.getElementById("kpi-total-revenue");
      const elInst = document.getElementById("kpi-monthly-installments");
      const elUpd = document.getElementById("dash-last-updated-txt");

      const totalFleetInstallments = (this.cars || []).reduce((sum, c) => {
        const isDebtFree = Boolean(c.is_debt_free);
        const instAmt = parseFloat(c.installment_amount || 0);
        if (!isDebtFree && instAmt > 0) return sum + instAmt;
        return sum;
      }, 0);

      // Card 1: total_fleet and available
      if (elTotal) elTotal.textContent = totalFleet;
      if (elAvail) elAvail.textContent = isEn ? `Available ${availCars} cars` : `พร้อมให้บริการ ${availCars} คัน`;
      
      // Card 2: on_rent + booked and maintenance
      if (elActive) elActive.textContent = activeRentals;
      if (elMaint) elMaint.textContent = isEn ? `Maintenance ${maintCars} cars` : `ซ่อมบำรุง ${maintCars} คัน`;
      
      // Card 3: utilization rate
      if (elUtil) elUtil.textContent = `${utilRate}%`;
      
      // Card 4: revenue
      if (elRev) elRev.textContent = `฿${Number(totalRev).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (elInst) elInst.textContent = `฿${totalFleetInstallments.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
      if (elUpd) {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, "0");
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const yyyy = now.getFullYear();
        const hh = String(now.getHours()).padStart(2, "0");
        const min = String(now.getMinutes()).padStart(2, "0");
        elUpd.textContent = isEn 
          ? `🕒 Real-time updated at ${dd}/${mm}/${yyyy} ${hh}:${min}` 
          : `🕒 ข้อมูลอัปเดตล่าสุด ณ ${dd}/${mm}/${yyyy} ${hh}:${min}`;
      }
    } catch (err) {
      console.error("[Dashboard] Error in updateDashboardKPIsFromScope:", err);
    }
  }

  async loadMonthlyReports() {
    const mPicker = document.getElementById("report-month-picker");
    const mVal = mPicker ? mPicker.value : "";
    const url = mVal ? `/api/reports/monthly?month=${mVal}` : `/api/reports/monthly`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      this.completedJobs = data.jobs || [];
      this.renderCompletedJobsTable();
      this.renderTrendChart();
    }
  }

  async loadUsers() {
    const res = await fetch("/api/users");
    if (res.ok) {
      this.users = await res.json();
      this.renderUsersTable();
      const pendingCnt = this.users.filter(u => u.status === "pending").length;
      const bPending = document.getElementById("badge-pending-users");
      if (bPending) {
        bPending.style.display = pendingCnt > 0 ? "inline-block" : "none";
        bPending.textContent = pendingCnt;
      }
      this.populateStaffDropdowns();
    }
  }

  // --- UI Module Navigation ---
  switchModule(modName) {
    this.activeModule = modName;
    document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
    const navBtn = document.getElementById(`nav-${modName}`);
    if (navBtn) navBtn.classList.add("active");

    ["frontoffice", "backoffice", "maintenance", "customers", "dashboard", "users"].forEach(m => {
      const sec = document.getElementById(`module-${m}`);
      if (sec) sec.style.display = (m === modName) ? "block" : "none";
    });

    if (modName === "backoffice") {
      this.loadBackOfficeJobs();
      setTimeout(() => {
        if (this.boCalendar) this.boCalendar.updateSize();
      }, 120);
    }
    if (modName === "maintenance") this.loadMaintenanceRecords();
    if (modName === "customers") this.renderCustomersTable();
    if (modName === "dashboard") {
      this.loadDashboardKPIs();
      this.loadMonthlyExpenses();
      setTimeout(() => this.renderDashboardCharts(), 150);
    }
    if (modName === "users") this.loadUsers();
  }

  async switchTab(tabName) {
    this.activeTab = tabName;
    document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
    const tabBtn = document.getElementById(`tab-btn-${tabName}`);
    if (tabBtn) tabBtn.classList.add("active");

    ["fleet", "deposit", "assign", "contract", "dashboard_bks"].forEach(t => {
      const pane = document.getElementById(`subtab-${t}`);
      if (pane) pane.style.display = (t === tabName) ? "block" : "none";
    });

    if (!this.users || this.users.length <= 1) {
      await this.loadUsers();
    }

    if (tabName === "assign") {
      this.populateBookingDropdowns();
      this.populateStaffDropdowns();
      const dispSel = document.getElementById("assign-disp-bk");
      const retSel = document.getElementById("assign-ret-bk");
      if (dispSel && !dispSel.value && this.currentSelectedBooking?.booking_id) {
        dispSel.value = this.currentSelectedBooking.booking_id;
      }
      if (retSel && !retSel.value && (dispSel?.value || this.currentSelectedBooking?.booking_id)) {
        retSel.value = dispSel?.value || this.currentSelectedBooking.booking_id;
      }
      this.onSelectAssignDispBooking();
      this.onSelectAssignRetBooking();
      this.setAssignMode(this.assignMode || "Dispatch");
    } else if (tabName === "contract") {
      this.populateBookingDropdowns();
      this.populateStaffDropdowns();
      const contractSel = document.getElementById("contract-sel-bk");
      if (contractSel) {
        if (!contractSel.value) {
          if (this.currentSelectedBooking?.booking_id) {
            contractSel.value = this.currentSelectedBooking.booking_id;
          } else {
            const activeBks = this.bookings.filter(b => b.status !== "ยกเลิก" && b.status !== "เสร็จสิ้น");
            if (activeBks.length > 0) {
              contractSel.value = activeBks[0].booking_id;
            } else if (this.bookings.length > 0) {
              contractSel.value = this.bookings[0].booking_id;
            }
          }
        }
        this.onSelectContractBooking();
      }
    } else if (tabName === "deposit") {
      this.populateBookingDropdowns();
      const depSel = document.getElementById("deposit-sel-booking");
      if (depSel && !depSel.value && this.currentSelectedBooking?.booking_id) {
        depSel.value = this.currentSelectedBooking.booking_id;
        this.onSelectDepositBooking();
      }
    }
  }

  // --- Duration & Filter Engine ---
  parseIsoDate(dStr) {
    if (!dStr) return null;
    if (dStr instanceof Date) {
      const d = new Date(dStr.getTime());
      d.setHours(0, 0, 0, 0);
      return d;
    }
    const s = String(dStr).trim().split("T")[0];
    if (s.includes("-")) {
      const parts = s.split("-");
      if (parts.length === 3) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0, 0);
      }
    }
    if (s.includes("/")) {
      const parts = s.split("/");
      if (parts.length === 3) {
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10), 0, 0, 0, 0);
      }
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      return d;
    }
    return null;
  }

  calcDuration() {
    const isEn = (this.currentLang === "EN");
    const sDate = document.getElementById("filter-start-date")?.value;
    const sTime = document.getElementById("filter-start-time")?.value || "10:00";
    const eDate = document.getElementById("filter-end-date")?.value;
    const eTime = document.getElementById("filter-end-time")?.value || "10:00";

    if (!sDate || !eDate) return { days: 1, text: isEn ? "1 Day" : "1 วัน" };

    const start = new Date(`${sDate}T${sTime}`);
    const end = new Date(`${eDate}T${eTime}`);
    if (end <= start) return { days: 1, text: isEn ? "1 Day (Minimum)" : "1 วัน (ขั้นต่ำ)" };

    const diffMs = end - start;
    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const remMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const baseDays = Math.floor(totalHours / 24);
    const extraHours = totalHours % 24;

    let billableDays = baseDays;
    let desc = "";

    if (extraHours > 4 || (extraHours === 4 && remMins > 0)) {
      billableDays = baseDays + 1;
      desc = isEn
        ? `${billableDays} Days (${billableDays * 24} Hrs · +${extraHours}h OT)`
        : `${billableDays} วัน (${billableDays * 24} ชม. · เกิน ${extraHours} ชม. ปรับเป็น 1 วัน)`;
    } else {
      billableDays = Math.max(1, baseDays);
      if (extraHours > 0 || remMins > 0) {
        desc = isEn
          ? `${billableDays} Days (${billableDays * 24} Hrs · Grace period)`
          : `${billableDays} วัน (${billableDays * 24} ชม. · อนุโลม ≤ 4 ชม.)`;
      } else {
        desc = isEn
          ? `${billableDays} Days (${billableDays * 24} Hrs)`
          : `${billableDays} วัน (${billableDays * 24} ชม.)`;
      }
    }

    return { days: billableDays, text: desc };
  }

  onFilterChange() {
    const dur = this.calcDuration();
    const durTxt = document.getElementById("calc-duration-text");
    if (durTxt) durTxt.textContent = dur.text;

    this.renderFleetCards();
  }

  // --- Rate Engine for Daily, Weekly, Monthly ---
  getCarRates(car) {
    const c = car || {};
    const dayRaw = parseFloat(c.price_day);
    const priceDay = dayRaw > 0 ? dayRaw : parseFloat(c.daily_rate || 1000);
    const rawWeek = parseFloat(c.price_week) > 0 ? parseFloat(c.price_week) : parseFloat(c.weekly_rate || 0);
    const rawMonth = parseFloat(c.price_month) > 0 ? parseFloat(c.price_month) : parseFloat(c.monthly_rate || 0);
    const priceWeek = rawWeek > 0 ? rawWeek : (priceDay * 6);
    const priceMonth = rawMonth > 0 ? rawMonth : (priceDay * 20);
    return { priceDay, priceWeek, priceMonth };
  }

  calculateCarRentalPrice(car, days, contractType = "รายวัน") {
    const isEn = (this.currentLang === "EN");
    const { priceDay, priceWeek, priceMonth } = this.getCarRates(car);
    const billableDays = Math.max(1, parseInt(days, 10) || 1);
    let basePrice = 0;
    let breakdownText = "";

    const isWeekly = contractType === "รายสัปดาห์" || contractType === "Weekly";
    const isMonthly = contractType === "รายเดือน" || contractType === "Monthly";

    if (isWeekly) {
      if (billableDays <= 7) {
        basePrice = priceWeek;
        breakdownText = isEn
          ? `Weekly Rate (1 Week): ฿${priceWeek.toLocaleString()} / Week`
          : `เรทรายสัปดาห์ (1 สัปดาห์): ฿${priceWeek.toLocaleString()} / สัปดาห์`;
      } else {
        const weeks = Math.floor(billableDays / 7);
        const remDays = billableDays % 7;
        basePrice = (weeks * priceWeek) + (remDays * priceDay);
        if (remDays === 0) {
          breakdownText = isEn
            ? `Weekly Rate: ${weeks} Weeks (${billableDays} Days) × ฿${priceWeek.toLocaleString()}`
            : `เรทรายสัปดาห์: ${weeks} สัปดาห์ (${billableDays} วัน) × ฿${priceWeek.toLocaleString()}`;
        } else {
          breakdownText = isEn
            ? `Weekly Rate: ${weeks} Weeks (฿${(weeks * priceWeek).toLocaleString()}) + Extra ${remDays} Days (฿${(remDays * priceDay).toLocaleString()})`
            : `เรทรายสัปดาห์: ${weeks} สัปดาห์ (฿${(weeks * priceWeek).toLocaleString()}) + เศษ ${remDays} วัน (฿${(remDays * priceDay).toLocaleString()})`;
        }
      }
    } else if (isMonthly) {
      if (billableDays <= 30) {
        basePrice = priceMonth;
        breakdownText = isEn
          ? `Monthly Rate (1 Month): ฿${priceMonth.toLocaleString()} / Month`
          : `เรทรายเดือน (1 เดือน): ฿${priceMonth.toLocaleString()} / เดือน`;
      } else {
        const months = Math.floor(billableDays / 30);
        const remDays = billableDays % 30;
        basePrice = (months * priceMonth) + (remDays * priceDay);
        if (remDays === 0) {
          breakdownText = isEn
            ? `Monthly Rate: ${months} Months (${billableDays} Days) × ฿${priceMonth.toLocaleString()}`
            : `เรทรายเดือน: ${months} เดือน (${billableDays} วัน) × ฿${priceMonth.toLocaleString()}`;
        } else {
          breakdownText = isEn
            ? `Monthly Rate: ${months} Months (฿${(months * priceMonth).toLocaleString()}) + Extra ${remDays} Days (฿${(remDays * priceDay).toLocaleString()})`
            : `เรทรายเดือน: ${months} เดือน (฿${(months * priceMonth).toLocaleString()}) + เศษ ${remDays} วัน (฿${(remDays * priceDay).toLocaleString()})`;
        }
      }
    } else {
      // รายวัน (Daily)
      basePrice = billableDays * priceDay;
      breakdownText = isEn
        ? `Daily Rate: ${billableDays} Days × ฿${priceDay.toLocaleString()}/day = ฿${basePrice.toLocaleString()}`
        : `เรทรายวัน: ${billableDays} วัน × ฿${priceDay.toLocaleString()}/วัน = ฿${basePrice.toLocaleString()}`;
    }

    return { basePrice, breakdownText, priceDay, priceWeek, priceMonth };
  }

  formatPlateDisplay(plate) {
    const str = String(plate || "").trim();
    const isRed = str.includes("ป้ายแดง") || str.toLowerCase().includes("red");
    const parts = str.split(/\s+/);
    let plateNo = str;
    let province = "กรุงเทพมหานคร";

    if (parts.length >= 3 && ["กรุงเทพ", "กทม", "เชียงใหม่", "ชลบุรี", "ภูเก็ต"].some(pv => parts[parts.length - 1].includes(pv))) {
      plateNo = parts.slice(0, parts.length - 1).join(" ");
      province = parts[parts.length - 1];
    } else if (parts.length === 2 && ["กรุงเทพ", "กทม", "เชียงใหม่", "ชลบุรี", "ภูเก็ต"].some(pv => parts[1].includes(pv))) {
      plateNo = parts[0];
      province = parts[1];
    }
    return { plateNo, province, isRed };
  }

  getCarExpiryAlerts(c, lang = null) {
    const isEn = (lang === "EN" || (!lang && this.currentLang === "EN"));
    const l = isEn ? "EN" : "TH";
    const dict = (window.translations && window.translations[l]) ? window.translations[l] : null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checks = [
      { key: "insurance", name: dict ? dict.insurance : (isEn ? "Insurance" : "ประกันภัย"), dateStr: c.insurance_expire_date || c.ins_expiry || c.ins_expire_date || c.insurance_expiry },
      { key: "prb", name: dict ? dict.act : (isEn ? "PRB" : "พ.ร.บ."), dateStr: c.prb_expire_date || c.act_expiry || c.prb_expiry || c.prb_date || c.act_expire_date },
      { key: "tax", name: dict ? dict.tax : (isEn ? "Tax" : "ภาษี"), dateStr: c.tax_expire_date || c.tax_expiry || c.tax_expire }
    ];

    if (!c.is_debt_free && (c.payment_due_date || c.installment_due_date)) {
      checks.push({
        key: "finance",
        name: isEn ? "Payment Due" : "วันตัดงวด",
        dateStr: c.payment_due_date || c.installment_due_date,
        maxDays: 7
      });
    }

    const alerts = [];

    for (const item of checks) {
      if (!item.dateStr || String(item.dateStr).trim() === "-" || String(item.dateStr).trim() === "") continue;
      const cleanDateStr = String(item.dateStr).trim().split("T")[0].split(" ")[0];
      const parts = cleanDateStr.split(/[\/-]/);
      let expD = null;
      if (parts.length === 3) {
        let y = 0, m = 0, d = 0;
        if (parts[0].length === 4) {
          y = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          d = parseInt(parts[2], 10);
        } else {
          d = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          y = parseInt(parts[2], 10);
        }
        if (y > 2400) y -= 543;
        expD = new Date(y, m, d);
      }
      if (!expD || isNaN(expD.getTime())) continue;
      expD.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expD.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const maxAlertDays = item.maxDays || 30;
      if (diffDays <= maxAlertDays) {
        let badge = null;
        if (diffDays <= 0) {
          const daysAgo = Math.abs(diffDays);
          const txt = (item.key === "finance")
            ? (diffDays === 0
                ? (isEn ? "Payment Due Today!" : "ตัดงวดวันนี้!")
                : (isEn ? `Payment ${daysAgo}d Overdue` : `ตัดงวดเกินกำหนด ${daysAgo} วัน`))
            : ((item.key === "prb" && dict?.prb_alert_expired)
                ? dict.prb_alert_expired
                : (diffDays === 0
                    ? (dict ? `${item.name} ${dict.due_today}` : (isEn ? `${item.name} today` : `${item.name} หมดอายุวันนี้`))
                    : (dict ? `${item.name} ${dict.overdue_days.replace('{days}', daysAgo)}` : (isEn ? `${item.name} ${daysAgo}d overdue` : `${item.name} เกินกำหนด ${daysAgo} วัน`))));
          badge = {
            key: item.key,
            text: txt,
            bg: "#FEE2E2",
            border: "#FECACA",
            color: "#991B1B",
            dot: "#EF4444",
            diff: diffDays
          };
        } else {
          const txt = (item.key === "finance")
            ? (isEn ? `Payment Due in ${diffDays}d` : `ตัดงวดในอีก ${diffDays} วัน`)
            : ((item.key === "prb" && dict?.prb_alert_in_days)
                ? dict.prb_alert_in_days.replace('{days}', diffDays)
                : (dict ? `${item.name} ${dict.in_days.replace('{days}', diffDays)}` : (isEn ? `${item.name} in ${diffDays}d` : `${item.name} เหลือ ${diffDays} วัน`)));
          badge = {
            key: item.key,
            text: txt,
            bg: diffDays <= 3 ? "#FEF2F2" : "#FEF3C7",
            border: diffDays <= 3 ? "#FECACA" : "#FDE68A",
            color: diffDays <= 3 ? "#991B1B" : "#92400E",
            dot: diffDays <= 3 ? "#EF4444" : "#F59E0B",
            diff: diffDays
          };
        }
        if (badge) alerts.push(badge);
      }
    }

    // Sort by diff ascending (expired / most urgent first)
    alerts.sort((a, b) => a.diff - b.diff);
    return alerts;
  }

  getCarExpiryAlert(c, lang = null) {
    const list = this.getCarExpiryAlerts(c, lang);
    return list.length > 0 ? list[0] : null;
  }

  checkFinancePaymentDueAlerts() {
    if (!this.cars || typeof this.cars !== "object") return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueCars = [];
    const carList = Array.isArray(this.cars) ? this.cars : Object.values(this.cars);

    for (const c of carList) {
      if (!c || c.is_debt_free || !c.payment_due_date || c.payment_due_date === "-" || c.payment_due_date === "") continue;
      const cleanDateStr = String(c.payment_due_date).trim().split("T")[0].split(" ")[0];
      const parts = cleanDateStr.split(/[\/-]/);
      let expD = null;
      if (parts.length === 3) {
        let y = 0, m = 0, d = 0;
        if (parts[0].length === 4) {
          y = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          d = parseInt(parts[2], 10);
        } else {
          d = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          y = parseInt(parts[2], 10);
        }
        if (y > 2400) y -= 543;
        expD = new Date(y, m, d);
      }
      if (!expD || isNaN(expD.getTime())) continue;
      expD.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expD.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 7) {
        dueCars.push({ plate: c.plate, diffDays, car: c });
      }
    }

    if (dueCars.length > 0 && !this._financeAlertNotified) {
      this._financeAlertNotified = true;
      const count = dueCars.length;
      const isEn = (this.currentLang === "EN");
      const msg = isEn
        ? `⚠️ Finance Alert: ${count} vehicle(s) have installment payment due within 7 days!`
        : `⚠️ แจ้งเตือนวันตัดงวด: มีรถยนต์ ${count} คัน ถึงกำหนดชำระค่างวดภายใน 7 วัน!`;
      this.showToast(msg, "warning");
    }
    return dueCars;
  }

  toggleCarExpander(plate) {
    const safeId = String(plate || "").replace(/[^a-zA-Z0-9]/g, "_");
    const panel = document.getElementById(`exp-panel-${safeId}`);
    const arrow = document.getElementById(`exp-arrow-${safeId}`);
    if (!panel) return;
    const isOpen = panel.classList.contains("active");
    if (isOpen) {
      panel.classList.remove("active");
      if (arrow) arrow.textContent = "▼";
    } else {
      panel.classList.add("active");
      if (arrow) arrow.textContent = "▲";
    }
  }

  // --- Rendering: Fleet Cards ---
  renderFleetCards() {
    const container = document.getElementById("fleet-cards-container");
    if (!container) return;

    const isEn = (this.currentLang === "EN");
    const groupFilter = document.getElementById("filter-group")?.value || "ทั้งหมด";
    const brandFilter = document.getElementById("filter-brand")?.value || "ทั้งหมด";
    const companyFilter = document.getElementById("filter-company")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("filter-status")?.value || "ทั้งหมด";
    const dur = this.calcDuration();
    const kw = (this.sidebarSearchKw || "").toLowerCase().trim();

    const isAllVal = (v) => { const s = String(v == null ? "" : v).trim().toLowerCase(); return s === "" || s === "all" || s === "ทั้งหมด"; };
    const filtered = this.cars.filter(c => {
      // 1. Group filter
      if (!isAllVal(groupFilter)) {
        const cg = (c.car_group || "").toLowerCase();
        if (!cg.includes(groupFilter.toLowerCase())) return false;
      }

      // 2. Brand filter
      if (!isAllVal(brandFilter)) {
        if ((c.brand || "").trim().toLowerCase() !== brandFilter.trim().toLowerCase()) return false;
      }

      // 3. Company filter
      if (!isAllVal(companyFilter)) {
        if ((c.company || c.owner_company || "").trim() !== companyFilter.trim()) return false;
      }

      // 3b. Active Bookings and Date Overlap Calculations
      const normCarPlate = this.normalizePlate(c.plate);
      const activeBookings = (this.bookings || []).filter(b => {
        if (this.normalizePlate(b.car_id) !== normCarPlate) return false;
        const bStat = String(b.status || "").trim();
        return !["เสร็จสิ้น", "ยกเลิก", "Completed", "Canceled", "completed", "canceled"].includes(bStat);
      });
      const hasAnyActiveBooking = activeBookings.length > 0;

      const lockS = document.getElementById("filter-start-date")?.value;
      const lockE = document.getElementById("filter-end-date")?.value;
      let searchS = this.parseIsoDate(lockS);
      let searchE = this.parseIsoDate(lockE);
      if (searchS && !searchE) searchE = new Date(searchS.getTime());
      if (searchE && !searchS) searchS = new Date(searchE.getTime());
      if (searchS && searchE && searchE < searchS) searchE = new Date(searchS.getTime());

      let hasOverlapOnSelectedDates = false;
      if (searchS && searchE) {
        hasOverlapOnSelectedDates = activeBookings.some(b => {
          const bStart = this.parseIsoDate(b.start_date);
          const bEnd = this.parseIsoDate(b.end_date);
          if (!bStart || !bEnd) return false;
          if (bStart.getTime() === bEnd.getTime() || searchS.getTime() === searchE.getTime()) {
            return (searchS <= bEnd) && (searchE >= bStart);
          }
          return (searchS < bEnd) && (searchE > bStart);
        });
      }

      // 4. Status Filter (4 exact options: ทั้งหมด, ว่าง, ติดจอง, กำลังเช่า)
      const cleanStat = String(statusFilter || "").trim();
      const isStatusAll = isAllVal(cleanStat) || cleanStat === "ทั้งหมด" || cleanStat === "All";
      const isStatusAvail = cleanStat === "ว่าง" || cleanStat === "Available";
      const isStatusBooked = cleanStat === "ติดจอง" || cleanStat === "Reserved";
      const isStatusRenting = cleanStat === "กำลังเช่า" || cleanStat === "On Rent" || cleanStat === "Currently Renting";

      const hasBookingOnRent = activeBookings.some(b => b.status === "กำลังเช่า" || b.status === "รอรับคืน");
      const isTrulyOnRent = hasBookingOnRent || (c.is_on_rent && c.status === "กำลังเช่า");

      if (isStatusRenting) {
        // เลือก "กำลังเช่า": แสดงรถที่สถานะปัจจุบันคือ On Rent (ลูกค้ากำลังใช้งาน)
        if (!isTrulyOnRent) return false;
      } else if (isStatusBooked) {
        // เลือก "ติดจอง": แสดงรถที่มีการสร้าง Booking ไว้แล้ว (มีคิวในระบบ) หรือสถานะติดจอง
        if (isTrulyOnRent) return false;
        if (!hasAnyActiveBooking && c.status !== "ติดจอง" && c.fleet_status_key !== "reserved" && c.fleet_status_key !== "unavailable") {
          return false;
        }
      } else if (isStatusAvail) {
        // เลือก "ว่าง": แสดงเฉพาะรถที่ ไม่มี คิวจองทับซ้อน (Overlap) ในช่วงวันที่เลือก และสถานะรถปัจจุบันไม่ใช่ "กำลังเช่า"
        if (isTrulyOnRent || c.status === "กำลังเช่า") return false;
        if (c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง" || c.status === "สถานะซ่อมบำรุง") return false;
        if (c.fleet_status_key === "unavailable" || c.status === "ติดจอง" || c.fleet_status_key === "reserved") return false;
        if (searchS && searchE) {
          if (hasOverlapOnSelectedDates) return false;
        } else {
          // If no specific dates selected, car must not be occupied currently
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const overlapsToday = activeBookings.some(b => {
            const bs = this.parseIsoDate(b.start_date);
            const be = this.parseIsoDate(b.end_date);
            return bs && be && today >= bs && today <= be;
          });
          if (overlapsToday) return false;
        }
      } else if (isStatusAll) {
        // เลือก "ทั้งหมด": แสดงรถทุกคัน (ที่ผ่านเงื่อนไขตัวกรองวันที่ และหมวดหมู่อื่นๆ)
        if (searchS && searchE) {
          if (c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง" || c.status === "สถานะซ่อมบำรุง") return false;
          if (c.fleet_status_key === "unavailable" || hasOverlapOnSelectedDates) return false;
          if (isTrulyOnRent) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (searchS <= today && searchE >= today) return false;
          }
        }
      }

      // 5. Sidebar Search keyword (supports plate, brand, model, VIN/chassis, owner, beneficiary, insurance, notes)
      if (kw) {
        const target = `${c.plate || ''} ${c.brand || ''} ${c.model || ''} ${c.car_group || ''} ${c.company || ''} ${c.color || ''} ${c.chassis_no || ''} ${c.ins_company || ''} ${c.owner || ''} ${c.beneficiary || ''} ${c.notes || ''}`.toLowerCase();
        const targetClean = target.replace(/[- ]/g, '');
        const kwClean = kw.replace(/[- ]/g, '');
        if (!target.includes(kw) && !targetClean.includes(kwClean)) return false;
      }

      return true;
    });

    const countTxt = document.getElementById("calc-cars-count");
    if (countTxt) {
      const availCount = filtered.filter(c => {
        if (c.status === "กำลังเช่า" || c.is_on_rent) return false;
        if (c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง" || c.status === "สถานะซ่อมบำรุง") return false;
        return c.fleet_status_key === "available" || c.fleet_status_key === "reserved" || c.status === "ว่างพร้อมใช้งาน";
      }).length;
      countTxt.textContent = isEn
        ? `Available: ${availCount} / ${filtered.length} cars`
        : `ว่างพร้อมใช้งาน: ${availCount} / ${filtered.length} คัน`;
    }

    this.checkFinancePaymentDueAlerts();

    if (filtered.length === 0) {
      container.innerHTML = isEn
        ? `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748B;">No vehicles match current filters</div>`
        : `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748B;">ไม่พบรถยนต์ตามตัวกรองที่เลือก</div>`;
      return;
    }

    const buildCardHtml = (c, idx) => {
      const isAvail = c.fleet_status_key === "available" || c.fleet_status_key === "reserved";
      const autoType = dur.days >= 30 ? (isEn ? "Monthly" : "รายเดือน") : (dur.days >= 7 ? (isEn ? "Weekly" : "รายสัปดาห์") : (isEn ? "Daily" : "รายวัน"));
      const _rp = this.calculateCarRentalPrice(c, dur.days, autoType) || {};
      const basePrice = Number(_rp.basePrice) || 0;
      const priceDay = Number(_rp.priceDay) || 0;
      const priceWeek = Number(_rp.priceWeek) || 0;
      const priceMonth = Number(_rp.priceMonth) || 0;
      const carImg = (c.image || "").trim();
      const safePlate = String(c.plate || "").replace(/'/g, "\\'");
      const safeId = `${idx}_${String(c.plate || "").replace(/[^a-zA-Z0-9]/g, "_")}`;

      // 1. Car Code & Category Tag (SW001 & NIMBLE)
      const carCode = c.car_code || c.code || `SW${String(idx + 1).padStart(3, '0')}`;
      const rawGrp = String(c.car_group || 'SEDAN').toUpperCase();
      let catTag = rawGrp.replace(/\(.*?\)/g, '').trim();
      if (rawGrp.includes("รถเก๋ง") || catTag.includes("SEDAN")) {
        catTag = (idx % 2 === 0) ? "NIMBLE" : "SEDAN";
      } else if (catTag.includes("SUV")) {
        catTag = (idx % 2 === 0) ? "ASPIRE" : "SUV";
      } else if (catTag.includes("VAN") || rawGrp.includes("ตู้")) {
        catTag = "PRESTIGE";
      } else if (!catTag) {
        catTag = "FLEET";
      }

      const { plateNo, province, isRed } = this.formatPlateDisplay(c.plate);

      // Active Bookings for this specific car
      const normCarPlate = this.normalizePlate(c.plate);
      const cardActiveBookings = (this.bookings || []).filter(b => {
        if (this.normalizePlate(b.car_id) !== normCarPlate) return false;
        const bStat = String(b.status || "").trim();
        return !["เสร็จสิ้น", "ยกเลิก", "Completed", "Canceled", "completed", "canceled"].includes(bStat);
      });
      const hasAnyActiveBooking = cardActiveBookings.length > 0;
      const hasBookingOnRent = cardActiveBookings.some(b => b.status === "กำลังเช่า" || b.status === "รอรับคืน");
      const isTrulyOnRent = hasBookingOnRent || (c.is_on_rent && c.status === "กำลังเช่า");

      // 3. Status Pill
      const l = isEn ? "EN" : "TH";
      const dict = (window.translations && window.translations[l]) ? window.translations[l] : null;
      let statusText = (dict && dict.available) || (isEn ? "Available" : "ว่างพร้อมใช้งาน");
      let statusBg = "#ECFDF5", statusBorder = "#A7F3D0", statusColor = "#065F46", statusDot = "#10B981";

      if (c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง" || c.status === "สถานะซ่อมบำรุง") {
        statusText = (dict && dict.workshop) || (isEn ? "Workshop" : "ซ่อมบำรุง");
        statusBg = "#FFF7ED"; statusBorder = "#FED7AA"; statusColor = "#9A3412"; statusDot = "#F97316";
      } else if (isTrulyOnRent) {
        statusText = (dict && dict.on_rent) || (isEn ? "On rent" : "กำลังเช่า");
        statusBg = "#EFF6FF"; statusBorder = "#BFDBFE"; statusColor = "#1E40AF"; statusDot = "#3B82F6";
      } else if (c.status === "ติดจอง" || c.fleet_status_key === "reserved" || c.fleet_status_key === "unavailable" || hasAnyActiveBooking) {
        // Booked (deposit stage / awaiting hand-over) -> STRICTLY "Reserved / ติดจอง", never "On rent"
        statusText = (dict && dict.reserved) || (isEn ? "Reserved" : "ติดจอง");
        statusBg = "#FEFCE8"; statusBorder = "#FEF08A"; statusColor = "#A16207"; statusDot = "#F59E0B";
      }

      // 4. Expiry Alert Pills (Insurance, PRB, Tax)
      const alerts = this.getCarExpiryAlerts(c, l);
      const alertPillHtml = (alerts && alerts.length > 0)
        ? alerts.map(a => `
            <span class="car-pill" style="background:${a.bg}; border:1px solid ${a.border}; color:${a.color};">
              <span class="car-pill-dot" style="background:${a.dot};"></span> ${a.text}
            </span>
          `).join("")
        : "";

      const fuelLabel = String(c.fuel_type || '').trim() || (isEn ? 'Petrol' : 'เบนซิน');
      const carSpecsSub = `${c.reg_year || c.year || '2024'} · ${String(c.color || 'WHITE').toUpperCase()} · ${fuelLabel}`;
      const dailyRateLabel = (dict && dict.daily_rate) || (isEn ? 'Daily Rate' : 'ค่าเช่ารายวัน');
      const detailsLabel = (dict && dict.details) || (isEn ? 'Details' : 'ดูรายละเอียด');
      const bookNowLabel = isAvail
        ? ((dict && dict.book_now) || (isEn ? 'Book Now' : 'จองรถ'))
        : ((dict && dict.queue) || (isEn ? 'Queue' : 'จองคิว'));
      const bookTitle = !isAvail
        ? (isEn ? "Reserved - click to reserve queue" : "ติดจอง - คลิกเพื่อจองคิวต่อ")
        : bookNowLabel;
      const durLabel = dur.days > 0
        ? (isEn ? `${dur.days}d ฿${basePrice.toLocaleString()}` : `${dur.days} วัน ฿${basePrice.toLocaleString()}`)
        : "";
      const eyeIcon = `<svg class="car-plate-eye" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
      const plateInner = isRed
        ? `<div class="thai-plate-text"><div class="thai-plate-num">${isEn ? "Red Plate" : "ป้ายแดง"}</div><div class="thai-plate-prov">${isEn ? "Red plate" : "ป้ายแดง"}</div></div>`
        : `<div class="thai-plate-text"><div class="thai-plate-num">${plateNo}</div><div class="thai-plate-prov">${province}</div></div>`;
      const plateHtml = `<div class="thai-plate-badge${isRed ? " red-plate" : ""}" id="plate-badge-${safeId}" role="button" tabindex="0" title="${detailsLabel}" onclick="app.openCarDetailsModal('${safePlate}')">${eyeIcon}${plateInner}</div>`;

      return `
        <div class="car-card-modern">
          <div class="car-top-row">
            <div class="car-code-group">
              <button type="button" class="car-code-book" title="${bookTitle}" onclick="app.openBookModal('${safePlate}')">
                <span class="car-code-title">${carCode}</span>
                <svg class="car-code-book-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
              </button>
              <div class="car-cat-subtag">${catTag}</div>
            </div>
            ${plateHtml}
          </div>

          <div class="car-model-title">${c.brand || ''} ${c.model || ''}</div>
          <div class="car-specs-subtitle">${carSpecsSub}</div>

          <div class="car-pills-row">
            <span class="car-pill" style="background:${statusBg}; border:1px solid ${statusBorder}; color:${statusColor}; cursor:pointer;" onclick="app.openCarScheduleModal('${safePlate}')" title="${isEn ? 'Click to view vehicle schedule & queue' : 'คลิกเพื่อดูปฏิทินคิวงานของรถคันนี้'}">
              <span class="car-pill-dot" style="background:${statusDot};"></span> ${statusText}
            </span>
            ${alertPillHtml}
            <span class="car-rate-chip" title="${dailyRateLabel}">
              <b>฿${priceDay.toLocaleString()}</b>${durLabel ? `<span>${durLabel}</span>` : ""}
            </span>
          </div>
        </div>
      `;
    };

    container.innerHTML = filtered.map((c, idx) => {
      try {
        return buildCardHtml(c, idx);
      } catch (err) {
        console.error("renderFleetCards: card build failed", c && c.plate, err);
        const sp = String((c && c.plate) || "").replace(/'/g, "\\'");
        const cCode = (c && (c.car_code || c.code)) || `SW${String(idx + 1).padStart(3, '0')}`;
        const cCat = String((c && c.car_group) || 'SEDAN').toUpperCase().replace(/\(.*?\)/g, '').trim() || 'FLEET';
        const pDay = Number(c && (c.daily_rate || c.price_per_day || c.rental_rate || 1000)) || 1000;
        const cStat = String((c && c.status) || 'ว่างพร้อมใช้งาน');
        return `
        <div class="car-card-modern">
          <div class="car-top-row">
            <div class="car-code-group">
              <button type="button" class="car-code-book" title="${isEn ? 'Book Now' : 'จองรถ'}" onclick="app.openBookModal('${sp}')">
                <span class="car-code-title">${cCode}</span>
                <svg class="car-code-book-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
              </button>
              <div class="car-cat-subtag">${cCat}</div>
            </div>
            <div class="thai-plate-badge" role="button" title="${isEn ? 'Details' : 'ดูรายละเอียด'}" onclick="app.openCarDetailsModal('${sp}')">
              <div class="thai-plate-text"><div class="thai-plate-num">${(c && c.plate) || ''}</div><div class="thai-plate-prov">${(c && c.province) || 'กรุงเทพมหานคร'}</div></div>
            </div>
          </div>
          <div class="car-model-title">${(c && c.brand) || ''} ${(c && c.model) || ''}</div>
          <div class="car-specs-subtitle">${(c && c.year) || '2024'} · ${String((c && c.color) || 'WHITE').toUpperCase()} · ${(c && c.fuel_type) || 'เบนซิน'}</div>
          <div class="car-pills-row">
            <span class="car-pill" style="background:#ECFDF5; border:1px solid #A7F3D0; color:#065F46; cursor:pointer;" onclick="app.openCarScheduleModal('${sp}')" title="คลิกเพื่อดูปฏิทินคิวงาน">
              <span class="car-pill-dot" style="background:#10B981;"></span> ${cStat}
            </span>
            <span class="car-rate-chip">
              <b>฿${pDay.toLocaleString()}</b>
            </span>
          </div>
        </div>`;
      }
    }).join("");
  }

  // --- Fleet Car Details Popup Modal State Management & Actions ---
  setSelectedVehicle(vehicle) {
    this.selectedVehicle = vehicle || null;
  }

  setIsModalOpen(isOpen) {
    this.isModalOpen = Boolean(isOpen);
    const m = document.getElementById("modal-car-details");
    if (m) {
      if (this.isModalOpen) {
        this.modalZIndex = (this.modalZIndex || 2000) + 10;
        m.style.zIndex = String(this.modalZIndex);
        m.classList.add("open");
      } else {
        m.classList.remove("open");
      }
    }
  }

  closeCarDetailsModal() {
    this.setIsModalOpen(false);
    this.setSelectedVehicle(null);
  }

  openCarDetailsModal(plateOrEl) {
    const isEn = (this.currentLang === "EN");
    let plate = plateOrEl;
    if (plateOrEl && typeof plateOrEl === "object" && plateOrEl.getAttribute) {
      plate = plateOrEl.getAttribute("data-plate") || plateOrEl.dataset?.plate;
    }
    const cleanPlate = String(plate || "").trim();
    const car = (this.cars || []).find(c => c.plate === cleanPlate)
      || (this.cars || []).find(c => String(c.plate).trim() === cleanPlate)
      || (this.cars || []).find(c => this.normalizePlate(c.plate) === this.normalizePlate(cleanPlate));

    if (!car) {
      this.showToast(isEn ? "Vehicle not found" : "ไม่พบข้อมูลรถยนต์", "danger");
      return;
    }

    // 1. Update State (Mission 1)
    this.setSelectedVehicle(car);
    this.setIsModalOpen(true);

    const c = this.selectedVehicle;
    const safePlate = String(c.plate || "").replace(/'/g, "\\'");
    const rates = this.getCarRates(c);
    const dur = this.calcDuration ? this.calcDuration() : { days: 1, hours: 0, text: "1 วัน" };
    const priceDay = rates.day || 1000;
    const priceWeek = rates.week || 6000;
    const priceMonth = rates.month || 20000;
    const autoType = dur.days >= 30 ? (isEn ? "Monthly" : "รายเดือน") : (dur.days >= 7 ? (isEn ? "Weekly" : "รายสัปดาห์") : (isEn ? "Daily" : "รายวัน"));

    let totalPrice = priceDay * Math.max(1, dur.days || 1);
    try {
      if (typeof this.calculateCarRentalPrice === "function") {
        const calc = this.calculateCarRentalPrice(c, dur.days, autoType);
        if (calc && typeof calc.basePrice === "number") {
          totalPrice = calc.basePrice;
        }
      }
    } catch (e) {
      console.warn("Pricing calculation error in modal:", e);
    }

    const isAvail = (c.status === "ว่างพร้อมใช้งาน" || c.fleet_status_key === "available");
    const carImg = c.image && c.image !== "-" ? c.image : "";

    const prbVal = (c.prb_price !== undefined && c.prb_price !== null && c.prb_price !== '' && Number(c.prb_price) > 0)
      ? Number(c.prb_price)
      : ((c.act_price !== undefined && c.act_price !== null && c.act_price !== '' && Number(c.act_price) > 0) ? Number(c.act_price) : null);
    const prbFormatted = (prbVal !== null && !isNaN(prbVal) && prbVal > 0)
      ? '฿' + prbVal.toLocaleString(undefined, {minimumFractionDigits: (prbVal % 1 === 0 ? 0 : 2), maximumFractionDigits: 2})
      : '-';

    const insVal = (c.insurance_premium !== undefined && c.insurance_premium !== null && c.insurance_premium !== '' && Number(c.insurance_premium) > 0)
      ? Number(c.insurance_premium)
      : ((c.ins_premium !== undefined && c.ins_premium !== null && c.ins_premium !== '' && Number(c.ins_premium) > 0) ? Number(c.ins_premium) : null);
    const insFormatted = (insVal !== null && !isNaN(insVal) && insVal > 0)
      ? '฿' + insVal.toLocaleString(undefined, {minimumFractionDigits: (insVal % 1 === 0 ? 0 : 2), maximumFractionDigits: 2})
      : '-';

    const regYearDisplay = (c.register_year && c.register_year !== '-') ? c.register_year : (c.reg_year || '-');
    const insCompanyDisplay = (c.insurance_company && c.insurance_company !== '-') ? c.insurance_company : (c.ins_company || c.insurance_brand || '-');
    const financeCompanyDisplay = (c.finance_company && c.finance_company !== '-') ? c.finance_company : (c.is_debt_free ? (isEn ? 'Debt Free' : 'ปลอดภาระ') : '-');
    const nextServiceMil = (c.next_service_mileage !== undefined && c.next_service_mileage !== null && Number(c.next_service_mileage) > 0)
      ? Number(c.next_service_mileage)
      : ((c.next_engine_oil_mileage && Number(c.next_engine_oil_mileage) > 0) ? Number(c.next_engine_oil_mileage) : null);
    const nextServiceMilFormatted = (nextServiceMil !== null && !isNaN(nextServiceMil) && nextServiceMil > 0) ? nextServiceMil.toLocaleString() + ' km' : '-';

    const titleEl = document.getElementById("modal-car-details-title");
    if (titleEl) {
      titleEl.textContent = `${c.brand || ''} ${c.model || ''}`;
    }

    const plateBadge = document.getElementById("car-details-plate-badge");
    if (plateBadge) {
      plateBadge.innerHTML = `
        <span style="display:inline-block; border:1.5px solid #1E293B; border-radius:4px; padding:2px 8px; font-size:12px; font-weight:800; background:#FFF; color:#1E293B; letter-spacing:0.5px;">
          ${c.plate}
        </span>
      `;
    }

    const statusBadge = document.getElementById("car-details-status-badge");
    if (statusBadge) {
      let statusBg = "#DCFCE7", statusColor = "#166534", statusBorder = "#86EFAC";
      if (c.status === "ซ่อมบำรุง") {
        statusBg = "#FEE2E2"; statusColor = "#991B1B"; statusBorder = "#FCA5A5";
      } else if (c.status === "ติดจอง" || c.status === "เตรียมส่งมอบ") {
        statusBg = "#FFF7ED"; statusColor = "#9A3412"; statusBorder = "#FED7AA";
      } else if (c.status === "กำลังเช่า") {
        statusBg = "#EFF6FF"; statusColor = "#1E40AF"; statusBorder = "#BFDBFE";
      }
      statusBadge.innerHTML = `
        <span style="display:inline-block; background:${statusBg}; color:${statusColor}; border:1px solid ${statusBorder}; border-radius:12px; padding:2px 10px; font-size:11.5px; font-weight:700;">
          ${c.status || "ว่างพร้อมใช้งาน"}
        </span>
      `;
    }

    const bodyEl = document.getElementById("car-details-modal-body");
    if (!bodyEl) return;

    bodyEl.innerHTML = `
      <!-- Top Row: Photo & Pricing Summary -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
        <!-- Photo Box -->
        <div style="position:relative; border-radius:10px; overflow:hidden; border:1px solid #E2E8F0; background:#0F172A; min-height:190px; display:flex; align-items:center; justify-content:center;">
          ${carImg ? `<img src="${carImg}" alt="${c.brand || ''} ${c.model || ''}" style="width:100%; height:190px; object-fit:cover; display:block;">` : `<div style="color:#94A3B8; font-size:13px; font-weight:600; text-align:center; padding:20px;">${isEn ? 'No Vehicle Photo' : 'ยังไม่มีรูปภาพรถยนต์'}</div>`}
          <button type="button" onclick="app.triggerCarPhotoUpload('${safePlate}')" class="btn btn-sm" style="position:absolute; bottom:10px; right:10px; background:rgba(255,255,255,0.95); border:1px solid #CBD5E1; border-radius:20px; padding:4px 12px; font-size:11.5px; font-weight:700; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.15);">
            ${isEn ? 'Upload Photo' : 'อัปโหลดรูปรถ'}
          </button>
        </div>

        <!-- Pricing Rates Card -->
        <div style="background:#FAF7F2; border:1px solid #FED7AA; border-radius:10px; padding:14px; display:flex; flex-direction:column; justify-content:space-between;">
          <div>
            <div style="font-size:12px; font-weight:700; color:#C2410C; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
              ${isEn ? 'Rental Pricing Rates' : 'อัตราค่าเช่า'}
            </div>
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom:12px; background:#FFF; border:1px solid #E2E8F0; border-radius:8px; padding:8px; text-align:center;">
              <div>
                <div style="font-size:10.5px; color:#64748B;">${isEn ? 'Daily' : 'รายวัน'}</div>
                <div style="font-weight:800; font-size:13px; color:#1E293B;">฿${priceDay.toLocaleString()}</div>
              </div>
              <div>
                <div style="font-size:10.5px; color:#64748B;">${isEn ? 'Weekly' : 'รายสัปดาห์'}</div>
                <div style="font-weight:800; font-size:13px; color:#1E293B;">฿${priceWeek.toLocaleString()}</div>
              </div>
              <div>
                <div style="font-size:10.5px; color:#64748B;">${isEn ? 'Monthly' : 'รายเดือน'}</div>
                <div style="font-weight:800; font-size:13px; color:#1E293B;">฿${priceMonth.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <div style="background:#FFF7ED; border:1px solid #FDBA74; border-radius:8px; padding:10px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:11px; color:#9A3412; font-weight:600;">${isEn ? `Calculated (${dur.days || 1}d ${dur.hours || 0}h)` : `คำนวณตามระยะเวลา (${dur.days || 1} วัน ${dur.hours || 0} ชม.)`}</div>
              <div style="font-size:10.5px; color:#64748B;">${isEn ? 'Based on active dates filter' : 'ตามช่วงเวลาเช่าที่เลือกด้านบน'}</div>
            </div>
            <div style="font-size:18px; font-weight:800; color:#EA580C;">
              ฿${totalPrice.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <!-- Mid Grid: Specifications & Detailed Records (Swapped top-right and bottom-right cards) -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:16px;">
        <!-- Top-Left: ข้อมูลตัวรถเชิงลึก -->
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px;">
          <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span>${isEn ? 'Vehicle Specifications' : 'ข้อมูลตัวรถเชิงลึก'}</span>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11.5px;">
            <div><b style="color:#64748B;">${isEn ? 'Group:' : 'กลุ่มรถ:'}</b> ${c.car_group || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Reg Year:' : 'ปีจดทะเบียน:'}</b> ${regYearDisplay}</div>
            <div><b style="color:#64748B;">${isEn ? 'Color:' : 'สีตัวถัง:'}</b> ${c.color || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Fuel:' : 'เชื้อเพลิง:'}</b> ${c.fuel_type || c.fuel_system || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Engine CC:' : 'ขนาด CC:'}</b> ${c.engine_cc || c.cc_ev || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Mileage:' : 'เลขไมล์:'}</b> ${Number(String(c.mileage || '0').replace(/,/g, '')).toLocaleString()} km</div>
            <div style="grid-column: span 2;"><b style="color:#64748B;">${isEn ? 'VIN (Chassis):' : 'เลขตัวถัง:'}</b> <code>${c.chassis_no || c.vin || '-'}</code></div>
            <div style="grid-column: span 2;"><b style="color:#64748B;">${isEn ? 'Owner / Company:' : 'ผู้ถือกรรมสิทธิ์:'}</b> ${c.company || c.owner_company || c.owner || c.car_owner || '-'}</div>
          </div>
        </div>

        <!-- Top-Right: กำหนดเช็คระยะ & การเงิน (Moved from bottom-right) -->
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px;">
          <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span>${isEn ? 'Service Due & Financing' : 'กำหนดเช็คระยะ & การเงิน'}</span>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11.5px;">
            <div><b style="color:#64748B;">${isEn ? 'Last Service:' : 'เช็คล่าสุด:'}</b> ${c.last_service_date || '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Next Service Date:' : 'เช็คถัดไป (วันที่):'}</b> <span style="font-weight:700; color:#0369A1;">${c.next_service_date || c.next_engine_oil_date || c.next_service || '-'}</span></div>
            <div><b style="color:#64748B;">${isEn ? 'Next Mileage:' : 'เช็คถัดไป (ไมล์):'}</b> <span style="font-weight:700; color:#0369A1;">${nextServiceMilFormatted}</span></div>
            <div><b style="color:#64748B;">${isEn ? 'Finance Co:' : 'บริษัทไฟแนนซ์:'}</b> ${financeCompanyDisplay}</div>
            <div><b style="color:#64748B;">${isEn ? 'Installment/Mo:' : 'ค่างวด/เดือน:'}</b> ${(c.installment_amount || c.hp_installment) ? Number(c.installment_amount || c.hp_installment).toLocaleString() + ' ฿' : '-'}</div>
            <div><b style="color:#64748B;">${isEn ? 'Due Date:' : 'วันตัดงวด:'}</b> ${c.payment_due_date || '-'}</div>
          </div>
        </div>

        <!-- Bottom-Left: ข้อมูลกรมธรรม์ประกันภัย -->
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px;">
          <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span>${isEn ? 'Insurance Policy' : 'ข้อมูลกรมธรรม์ประกันภัย'}</span>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11.5px;">
            <div><b style="color:#64748B;">${isEn ? 'Company:' : 'บริษัทประกัน:'}</b> ${insCompanyDisplay}</div>
            <div><b style="color:#64748B;">${isEn ? 'Expiry:' : 'วันหมดอายุ:'}</b> <span style="color:#DC2626; font-weight:700;">${c.ins_expiry || c.insurance_expire_date || '-'}</span></div>
            <div><b style="color:#64748B;">${isEn ? 'Premium:' : 'เบี้ยประกัน:'}</b> <span style="font-weight:700; color:#0F172A;">${insFormatted}</span></div>
          </div>
        </div>

        <!-- Bottom-Right: ข้อมูล พ.ร.บ. และภาษี (Moved from top-right) -->
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:12px;">
          <div style="font-size:12px; font-weight:700; color:#334155; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <span>${isEn ? 'ACT & Tax Registration' : 'ข้อมูล พ.ร.บ. และภาษี'}</span>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11.5px;">
            <div><b style="color:#64748B;">${isEn ? 'ACT Expiry:' : 'หมดอายุ พ.ร.บ.:'}</b> <span style="color:#DC2626; font-weight:700;">${c.act_expiry || c.prb_expire_date || '-'}</span></div>
            <div><b style="color:#64748B;">${isEn ? 'Tax Expiry:' : 'หมดอายุภาษี:'}</b> <span style="color:#DC2626; font-weight:700;">${c.tax_expiry || c.tax_expire_date || '-'}</span></div>
            <div><b style="color:#64748B;">${isEn ? 'PRB Price:' : 'ราคา พ.ร.บ.:'}</b> <span style="font-weight:700; color:#0F172A;">${prbFormatted}</span></div>
          </div>
        </div>
      </div>

      <!-- Notes if any -->
      ${c.notes ? `
        <div style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:8px; padding:10px 14px; margin-bottom:16px; font-size:12px; color:#92400E;">
          <b>${isEn ? 'Notes / Remarks:' : 'หมายเหตุ:'}</b> ${c.notes}
        </div>
      ` : ''}


      <!-- Maintenance Tracker & ROI Section (MISSION 2) -->
      <div style="background:#FFFFFF; border:1.5px solid #CBD5E1; border-radius:10px; padding:14px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <div style="font-size:13px; font-weight:800; color:#1E293B; display:flex; align-items:center; gap:6px;">
            <span>🔧</span>
            <span>${isEn ? 'Maintenance History & Vehicle ROI' : 'ประวัติซ่อมบำรุง & วิเคราะห์กำไรสุทธิ (ROI)'}</span>
          </div>
          <span id="car-roi-badge" style="font-size:12px; font-weight:700; padding:3px 10px; border-radius:12px; background:#F1F5F9; color:#475569;">
            ${isEn ? 'Calculating...' : 'กำลังคำนวณ...'}
          </span>
        </div>

        <!-- 3 ROI KPI Cards -->
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin-bottom:12px; text-align:center;">
          <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:8px; padding:8px;">
            <div style="font-size:10.5px; color:#15803D; font-weight:700;">${isEn ? 'Total Revenue' : 'รายได้รวมสะสม'}</div>
            <div id="car-roi-income" style="font-size:14px; font-weight:800; color:#16A34A; margin-top:2px;">฿0.00</div>
          </div>
          <div style="background:#FFF1F2; border:1px solid #FECDD3; border-radius:8px; padding:8px;">
            <div style="font-size:10.5px; color:#BE123C; font-weight:700;">${isEn ? 'Total Maintenance Cost' : 'ค่าซ่อมบำรุงสะสม'}</div>
            <div id="car-roi-cost" style="font-size:14px; font-weight:800; color:#E11D48; margin-top:2px;">฿0.00</div>
          </div>
          <div id="car-roi-profit-card" style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:8px;">
            <div style="font-size:10.5px; color:#475569; font-weight:700;">${isEn ? 'Net Profit / ROI' : 'กำไรสุทธิ (ROI)'}</div>
            <div id="car-roi-profit" style="font-size:14px; font-weight:800; color:#0F172A; margin-top:2px;">฿0.00</div>
          </div>
        </div>

        <!-- Add Maintenance Form -->
        <div style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; padding:10px; margin-bottom:10px;">
          <div style="font-size:11.5px; font-weight:700; color:#334155; margin-bottom:6px;">
            ${isEn ? '+ Record New Maintenance Entry' : '➕ บันทึกรายการซ่อมบำรุงใหม่'}
          </div>
          <div style="display:grid; grid-template-columns: 140px 1fr 120px auto; gap:8px; align-items:center;">
            <input type="date" id="maint-input-date" class="form-control" style="font-size:11.5px; padding:5px 8px;" value="${new Date().toISOString().split('T')[0]}">
            <input type="text" id="maint-input-desc" class="form-control" style="font-size:11.5px; padding:5px 8px;" placeholder="${isEn ? 'Description (e.g. Oil change, brakes)' : 'รายการซ่อม (เช่น ถ่ายน้ำมันเครื่อง, ผ้าเบรก, ยาง)'}">
            <input type="number" id="maint-input-cost" class="form-control" style="font-size:11.5px; padding:5px 8px;" placeholder="${isEn ? 'Cost (฿)' : 'ค่าใช้จ่าย (฿)'}" min="0" step="any">
            <button type="button" onclick="app.submitCarMaintenance('${safePlate}')" class="btn btn-sm btn-primary" style="font-size:11.5px; padding:6px 14px; white-space:nowrap;">
              ${isEn ? 'Save' : 'บันทึก'}
            </button>
          </div>
        </div>

        <!-- Maintenance History Table -->
        <div class="table-responsive" style="max-height:160px; overflow-y:auto; border:1px solid #E2E8F0; border-radius:6px;">
          <table class="custom-table" style="margin:0; font-size:11.5px;">
            <thead style="position:sticky; top:0; background:#F1F5F9; z-index:1;">
              <tr>
                <th style="padding:6px 8px;">${isEn ? 'Date' : 'วันที่'}</th>
                <th style="padding:6px 8px;">${isEn ? 'Description' : 'รายการซ่อมบำรุง'}</th>
                <th style="padding:6px 8px; text-align:right;">${isEn ? 'Cost (฿)' : 'ค่าใช้จ่าย (฿)'}</th>
                <th style="padding:6px 8px; text-align:center; width:50px;">${isEn ? 'Action' : 'จัดการ'}</th>
              </tr>
            </thead>
            <tbody id="car-details-maint-tbody">
              <tr>
                <td colspan="4" style="text-align:center; color:#94A3B8; padding:12px;">${isEn ? 'Loading maintenance records...' : 'กำลังโหลดประวัติซ่อมบำรุง...'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Bottom Actions Bar -->
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding-top:12px; border-top:1px solid #E2E8F0; flex-wrap:wrap;">
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" onclick="app.closeModal('modal-car-details'); app.openEditCarModal('${safePlate}')" class="btn btn-secondary" style="font-size:12px; padding:7px 12px; border-radius:6px; cursor:pointer;">
            ${isEn ? 'Edit Details' : 'แก้ไขข้อมูล'}
          </button>
          <button type="button" onclick="app.closeModal('modal-car-details'); app.openNewMaintenanceModal('${safePlate}')" class="btn btn-secondary" style="font-size:12px; padding:7px 12px; border-radius:6px; background:#FFF7ED; color:#C2410C; border-color:#FDBA74; cursor:pointer;">
            ${isEn ? 'Maintenance Order' : 'เปิดใบงานซ่อมบำรุง'}
          </button>
          <button type="button" onclick="app.closeModal('modal-car-details'); app.deleteCarByPlate('${safePlate}')" class="btn btn-danger" style="font-size:12px; padding:7px 12px; border-radius:6px; cursor:pointer;">
            ${isEn ? 'Delete Car' : 'ลบรายการรถ'}
          </button>
        </div>

        <div style="display:flex; gap:8px;">
          <button type="button" onclick="app.closeModal('modal-car-details')" class="btn btn-secondary" style="font-size:12px; padding:7px 14px; border-radius:6px; cursor:pointer;">
            ${isEn ? 'Close' : 'ปิด'}
          </button>
        </div>
      </div>
    `;

    this.openModal("modal-car-details");
    this.loadCarMaintenances(cleanPlate);
  }

  // --- Quick Car Photo Upload & Edit Car Modal ---
  triggerCarPhotoUpload(plate) {
    this.quickUploadTargetPlate = plate;
    const inp = document.getElementById("quick-car-photo-input");
    if (inp) {
      inp.value = "";
      inp.click();
    }
  }

  async onQuickCarPhotoSelected(input) {
    if (!input.files || input.files.length === 0 || !this.quickUploadTargetPlate) return;
    const plate = this.quickUploadTargetPlate;
    const file = input.files[0];
    const car = this.cars.find(c => c.plate === plate);
    if (!car) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      this.showToast(`⏳ กำลังอัปโหลดรูปภาพสำหรับรถทะเบียน ${plate}...`, "info");
      const upRes = await fetch("/api/upload-photo", { method: "POST", body: formData });
      const upData = await upRes.json();
      if (!upData.success || !upData.url) {
        throw new Error(upData.detail || "อัปโหลดรูปภาพไม่สำเร็จ");
      }

      const payload = Object.assign({}, car, { plate: plate, image: upData.url });
      const saveRes = await fetch("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const saveData = await saveRes.json();
      if (saveData.success) {
        this.showToast(`✅ อัปเดตรูปภาพรถทะเบียน ${plate} เรียบร้อยแล้ว!`, "success");
        await this.loadCars();
      }
    } catch (e) {
      this.showToast("❌ อัปโหลดรูปรถไม่สำเร็จ: " + e.message, "danger");
    }
  }

  normalizePlate(plate) {
    if (!plate) return "";
    return String(plate).replace(/[\s\-\.]+/g, "").toLowerCase();
  }

  checkDuplicatePlate(val) {
    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const warnEl = document.getElementById("edit-car-plate-warn");
    const clean = this.normalizePlate(val);
    if (!clean) {
      if (warnEl) warnEl.style.display = "none";
      return false;
    }
    const origClean = this.normalizePlate(origPlate);
    const dup = this.cars.find(c => {
      const cClean = this.normalizePlate(c.plate);
      if (origClean && cClean === origClean) return false;
      return cClean === clean;
    });
    if (dup) {
      if (warnEl) {
        warnEl.textContent = `⚠️ ทะเบียน '${val}' ซ้ำกับ '${dup.brand} ${dup.model}' (ทะเบียน ${dup.plate}) ในระบบแล้ว`;
        warnEl.style.display = "block";
      }
      return true;
    } else {
      if (warnEl) warnEl.style.display = "none";
      return false;
    }
  }

  checkDuplicateChassis(val) {
    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const warnEl = document.getElementById("edit-car-vin-warn");
    const cleanVin = String(val || "").trim().toUpperCase();
    if (!cleanVin || cleanVin === "-" || cleanVin.length < 8) {
      if (warnEl) warnEl.style.display = "none";
      return false;
    }
    const origClean = this.normalizePlate(origPlate);
    const dup = this.cars.find(c => {
      const cClean = this.normalizePlate(c.plate);
      if (origClean && cClean === origClean) return false;
      const existingVin = String(c.chassis_no || "").trim().toUpperCase();
      return existingVin && existingVin === cleanVin;
    });
    if (dup) {
      if (warnEl) {
        warnEl.textContent = `⚠️ เลขตัวถัง '${cleanVin}' ซ้ำกับ '${dup.brand} ${dup.model}' (ทะเบียน ${dup.plate})`;
        warnEl.style.display = "block";
      }
      return true;
    } else {
      if (warnEl) warnEl.style.display = "none";
      return false;
    }
  }

  updateCarFormField(field, val) {
    if (!this.carFormData) this.carFormData = {};
    this.carFormData[field] = val;
    if (field === 'reg_year' || field === 'register_year') {
      this.carFormData.register_year = val;
      this.carFormData.reg_year = val;
    } else if (field === 'ins_company' || field === 'insurance_company') {
      this.carFormData.insurance_company = val;
      this.carFormData.ins_company = val;
    } else if (field === 'prb_price' || field === 'act_price') {
      this.carFormData.prb_price = val;
      this.carFormData.act_price = val;
    } else if (field === 'insurance_premium' || field === 'ins_premium') {
      this.carFormData.insurance_premium = val;
      this.carFormData.ins_premium = val;
    } else if (field === 'next_service_mileage' || field === 'next_engine_oil_mileage') {
      this.carFormData.next_service_mileage = val;
      this.carFormData.next_engine_oil_mileage = val;
    } else if (field === 'next_service_date' || field === 'next_engine_oil_date') {
      this.carFormData.next_service_date = val;
      this.carFormData.next_engine_oil_date = val;
    } else if (field === 'finance_company') {
      this.carFormData.finance_company = val;
    }
  }

  clearCarPhoto() {
    const previewEl = document.getElementById("edit-car-img-preview");
    const noImgEl = document.getElementById("edit-car-no-img-text");
    const urlEl = document.getElementById("edit-car-image-url");
    const fileEl = document.getElementById("edit-car-photo-file");
    if (previewEl) {
      previewEl.src = "";
      previewEl.style.display = "none";
    }
    if (noImgEl) noImgEl.style.display = "block";
    if (urlEl) urlEl.value = "";
    if (fileEl) fileEl.value = "";
    if (this.carFormData) this.carFormData.image = "";
  }

  openEditCarModal(plate) {
    const isEn = (this.currentLang === "EN");
    const isNew = !plate;
    const car = (!isNew && this.cars.find(c => c.plate === plate)) || {};

    const regYearInit = (car.register_year && car.register_year !== '-') ? car.register_year : (car.reg_year || "-");
    const insCompInit = (car.insurance_company && car.insurance_company !== '-') ? car.insurance_company : (car.ins_company || "-");
    const prbPriceInit = car.prb_price !== undefined && car.prb_price !== null && car.prb_price !== "" ? car.prb_price : (car.act_price !== undefined && car.act_price !== null && car.act_price !== "" ? car.act_price : "");
    const insPremInit = car.insurance_premium !== undefined && car.insurance_premium !== null && car.insurance_premium !== "" ? car.insurance_premium : (car.ins_premium !== undefined && car.ins_premium !== null && car.ins_premium !== "" ? car.ins_premium : "");
    const nextMileageInit = car.next_service_mileage !== undefined && car.next_service_mileage !== null && Number(car.next_service_mileage) > 0
      ? car.next_service_mileage
      : (car.next_engine_oil_mileage && Number(car.next_engine_oil_mileage) > 0 ? car.next_engine_oil_mileage : "");
    const finCompInit = car.finance_company || "-";

    // Initialize carFormData state to prevent data loss on editing/typing
    this.carFormData = {
      plate: car.plate || "",
      brand: car.brand || "Toyota",
      model: car.model || "",
      car_group: car.car_group || "รถเก๋ง (Sedan/Hatchback)",
      fuel_type: car.fuel_system || car.fuel_type || "เบนซิน",
      fuel_system: car.fuel_system || car.fuel_type || "เบนซิน",
      engine_cc: car.cc_ev || car.engine_cc || "1200",
      cc_ev: car.cc_ev || car.engine_cc || "1200",
      company: car.owner_company || car.company || "บจก.สวัสดี เรนทัล (Sawasdee Rental)",
      owner_company: car.owner_company || car.company || "บจก.สวัสดี เรนทัล (Sawasdee Rental)",
      color: car.color || "",
      mileage: car.mileage || "15,000",
      price_day: car.daily_rate !== undefined ? car.daily_rate : (car.price_day !== undefined ? car.price_day : 1000),
      daily_rate: car.daily_rate !== undefined ? car.daily_rate : (car.price_day !== undefined ? car.price_day : 1000),
      price_week: car.weekly_rate !== undefined ? car.weekly_rate : (car.price_week !== undefined ? car.price_week : 6000),
      weekly_rate: car.weekly_rate !== undefined ? car.weekly_rate : (car.price_week !== undefined ? car.price_week : 6000),
      price_month: car.monthly_rate !== undefined ? car.monthly_rate : (car.price_month !== undefined ? car.price_month : 20000),
      monthly_rate: car.monthly_rate !== undefined ? car.monthly_rate : (car.price_month !== undefined ? car.price_month : 20000),
      chassis_no: car.vin || car.chassis_no || "-",
      vin: car.vin || car.chassis_no || "-",
      tax_expiry: this.dmyToYmd(car.tax_expire_date || car.tax_expiry),
      tax_expire_date: this.dmyToYmd(car.tax_expire_date || car.tax_expiry),
      act_expiry: this.dmyToYmd(car.prb_expire_date || car.act_expiry),
      prb_expire_date: this.dmyToYmd(car.prb_expire_date || car.act_expiry),
      ins_expiry: this.dmyToYmd(car.insurance_expire_date || car.ins_expiry),
      insurance_expire_date: this.dmyToYmd(car.insurance_expire_date || car.ins_expiry),
      ins_company: insCompInit,
      insurance_company: insCompInit,
      owner: car.car_owner || car.owner || "-",
      car_owner: car.car_owner || car.owner || "-",
      beneficiary: car.beneficiary || car.owner_company || car.company || "-",
      reg_year: regYearInit,
      register_year: regYearInit,
      prb_price: prbPriceInit,
      act_price: prbPriceInit,
      insurance_premium: insPremInit,
      ins_premium: insPremInit,
      last_service_date: this.dmyToYmd(car.last_service_date),
      next_service_date: this.dmyToYmd(car.next_service_date || car.next_engine_oil_date || car.next_service || ""),
      next_engine_oil_date: this.dmyToYmd(car.next_service_date || car.next_engine_oil_date || car.next_service || ""),
      next_service_mileage: nextMileageInit,
      next_engine_oil_mileage: nextMileageInit,
      notes: car.notes || "",
      status: car.car_status || car.status || "ว่างพร้อมใช้งาน",
      car_status: car.car_status || car.status || "ว่างพร้อมใช้งาน",
      is_debt_free: car.is_debt_free !== undefined ? Boolean(car.is_debt_free) : (!car.installment_amount),
      finance_company: finCompInit,
      installment_amount: car.installment_amount !== undefined ? car.installment_amount : 0,
      total_installments: car.total_installments !== undefined ? car.total_installments : 48,
      current_installment: car.current_installment !== undefined ? car.current_installment : 0,
      payment_due_date: this.dmyToYmd(car.payment_due_date),
      image: car.image_url || car.image || "",
      image_url: car.image_url || car.image || ""
    };

    const titleEl = document.getElementById("modal-edit-car-title");
    if (titleEl) {
      if (isEn) {
        titleEl.textContent = isNew
          ? "Add New Vehicle to Fleet"
          : `Edit Vehicle Details & Photo (${plate})`;
      } else {
        titleEl.textContent = isNew
          ? "เพิ่มรถยนต์ใหม่เข้าสู่ระบบ (Add New Vehicle)"
          : `แก้ไขข้อมูลรถยนต์ & อัปโหลดรูปรถ (${plate})`;
      }
    }

    const origPlateEl = document.getElementById("edit-car-original-plate");
    if (origPlateEl) origPlateEl.value = isNew ? "" : (car.plate || plate);

    const warnEl = document.getElementById("edit-car-plate-warn");
    if (warnEl) warnEl.style.display = "none";
    const vinWarnEl = document.getElementById("edit-car-vin-warn");
    if (vinWarnEl) vinWarnEl.style.display = "none";

    const delBtn = document.getElementById("btn-modal-car-delete");
    if (delBtn) {
      delBtn.style.display = isNew ? "none" : "inline-flex";
      delBtn.innerHTML = isEn ? "Delete This Vehicle" : "ลบข้อมูลรถยนต์คันนี้";
    }

    const cancelBtn = document.getElementById("btn-modal-car-cancel");
    if (cancelBtn) cancelBtn.textContent = isEn ? "Cancel" : "ยกเลิก";
    const saveBtn = document.getElementById("btn-submit-edit-car");
    if (saveBtn) saveBtn.textContent = isEn ? "Save Vehicle Data" : "บันทึกข้อมูลรถยนต์";

    const plateEl = document.getElementById("edit-car-plate");
    if (plateEl) {
      plateEl.value = car.plate || "";
      plateEl.readOnly = false;
      plateEl.style.background = "#FFFFFF";
    }

    const previewEl = document.getElementById("edit-car-img-preview");
    const noImgEl = document.getElementById("edit-car-no-img-text");
    const carImg = (car.image || "").trim();
    if (previewEl && noImgEl) {
      if (carImg) {
        previewEl.src = carImg;
        previewEl.style.display = "block";
        noImgEl.style.display = "none";
      } else {
        previewEl.src = "";
        previewEl.style.display = "none";
        noImgEl.style.display = "block";
      }
    }

    const urlEl = document.getElementById("edit-car-image-url");
    if (urlEl) urlEl.value = car.image || "";

    const fileEl = document.getElementById("edit-car-photo-file");
    if (fileEl) fileEl.value = "";

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val !== undefined && val !== null ? val : "";
    };

    setVal("edit-car-brand", car.brand || "Toyota");
    setVal("edit-car-model", car.model || "");
    setVal("edit-car-group", car.car_group || "รถเก๋ง (Sedan/Hatchback)");
    setVal("edit-car-fuel", car.fuel_system || car.fuel_type || "เบนซิน");
    setVal("edit-car-cc", car.cc_ev || car.engine_cc || "1200");
    setVal("edit-car-company", car.owner_company || car.company || "บจก.สวัสดี เรนทัล (Sawasdee Rental)");
    setVal("edit-car-color", car.color || "");
    setVal("edit-car-mileage", car.mileage || "15,000");
    setVal("edit-car-pday", car.daily_rate !== undefined && car.daily_rate !== null ? car.daily_rate : (car.price_day !== undefined ? car.price_day : 1000));
    setVal("edit-car-pweek", car.weekly_rate !== undefined && car.weekly_rate !== null ? car.weekly_rate : (car.price_week !== undefined ? car.price_week : 6000));
    setVal("edit-car-pmonth", car.monthly_rate !== undefined && car.monthly_rate !== null ? car.monthly_rate : (car.price_month !== undefined ? car.price_month : 20000));
    setVal("edit-car-vin", car.vin || car.chassis_no || "-");
    setVal("edit-car-tax", this.dmyToYmd(car.tax_expire_date || car.tax_expiry));
    setVal("edit-car-act", this.dmyToYmd(car.prb_expire_date || car.act_expiry));
    setVal("edit-car-ins", this.dmyToYmd(car.insurance_expire_date || car.ins_expiry));
    setVal("edit-car-ins-comp", car.insurance_company || car.ins_company || "-");
    setVal("edit-car-owner", car.car_owner || car.owner || "-");
    setVal("edit-car-beneficiary", car.beneficiary || car.owner_company || car.company || "-");
    setVal("edit-car-reg-year", car.register_year || car.reg_year || "-");
    setVal("edit-car-prb-price", car.prb_price !== undefined && car.prb_price !== null ? car.prb_price : (car.act_price !== undefined && car.act_price !== null ? car.act_price : ""));
    setVal("edit-car-ins-premium", car.insurance_premium !== undefined && car.insurance_premium !== null ? car.insurance_premium : (car.ins_premium !== undefined && car.ins_premium !== null ? car.ins_premium : ""));
    setVal("edit-car-last-srv", this.dmyToYmd(car.last_service_date));
    const srvDateVal = car.next_service_date || car.next_engine_oil_date || car.next_service || "";
    setVal("edit-car-next-srv-date", this.dmyToYmd(srvDateVal));
    const srvMileageVal = car.next_service_mileage !== undefined && car.next_service_mileage !== null && Number(car.next_service_mileage) > 0
      ? car.next_service_mileage
      : (car.next_engine_oil_mileage && Number(car.next_engine_oil_mileage) > 0 ? car.next_engine_oil_mileage : "");
    setVal("edit-car-next-srv-mileage", srvMileageVal);
    setVal("edit-car-notes", car.notes || "");
    setVal("edit-car-status", car.car_status || car.status || "ว่างพร้อมใช้งาน");

    const isDebtFree = car.is_debt_free !== undefined ? Boolean(car.is_debt_free) : (!car.installment_amount);
    const debtFreeEl = document.getElementById("edit-car-debt-free");
    if (debtFreeEl) {
      debtFreeEl.checked = isDebtFree;
      this.onDebtFreeToggle(isDebtFree);
    }
    this.populateFinanceCompanyDropdown(car.finance_company || "");
    this.populateCarFormCreatableSelects();
    setVal("edit-car-installment-amount", car.installment_amount !== undefined ? car.installment_amount : 0);
    setVal("edit-car-total-installments", car.total_installments !== undefined ? car.total_installments : 48);
    setVal("edit-car-current-installment", car.current_installment !== undefined ? car.current_installment : 0);
    setVal("edit-car-payment-due-date", this.dmyToYmd(car.payment_due_date));

    this.openModal("modal-edit-car");
    setTimeout(() => {
      const plateEl = document.getElementById("edit-car-plate");
      if (plateEl) {
        plateEl.focus();
        if (isNew) plateEl.select();
      }
    }, 120);
  }

  onDebtFreeToggle(isDebtFree) {
    const fieldsContainer = document.getElementById("edit-car-installment-fields");
    if (fieldsContainer) {
      fieldsContainer.style.display = isDebtFree ? "none" : "block";
    }
  }

  getExistingFinanceCompanies() {
    const baseDefaults = [
      "โตโยต้า ลีสซิ่ง (Toyota Leasing)",
      "ทีทีบีไดรฟ์ / ธนชาต (ttb DRIVE)",
      "กรุงศรี ออโต้ (Krungsri Auto)",
      "กสิกร ลีสซิ่ง (KLeasing)",
      "ฮอนด้า ลีสซิ่ง (Honda Leasing)",
      "ไทยพาณิชย์ (SCB)",
      "เกียรตินาคินภัทร (KKP)",
      "ทิสโก้ (TISCO)"
    ];
    const found = new Set();
    (this.cars || []).forEach(c => {
      const fc = String(c.finance_company || "").trim();
      if (fc && !["-", "None", "none", "null", ""].includes(fc)) {
        found.add(fc);
      }
    });
    const combined = [...baseDefaults];
    Array.from(found).sort().forEach(item => {
      if (!combined.includes(item)) {
        combined.push(item);
      }
    });
    return combined;
  }

  async populateFinanceCompanyDropdown(selectedVal = "") {
    const inputEl = document.getElementById("edit-car-finance-company");
    const datalistEl = document.getElementById("finance-companies-list");
    if (!inputEl) return;

    let companies = [];
    try {
      const res = await fetch("/api/finance-companies");
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.companies) && data.companies.length > 0) {
          companies = data.companies;
        }
      }
    } catch (e) {
      console.warn("Could not fetch finance companies from API, using fallback", e);
    }

    if (!companies.length) {
      companies = this.getExistingFinanceCompanies();
    }

    if (datalistEl) {
      datalistEl.innerHTML = "";
      companies.forEach(comp => {
        const opt = document.createElement("option");
        opt.value = comp;
        datalistEl.appendChild(opt);
      });
    }

    const cleanSel = String(selectedVal || "").trim();
    if (cleanSel && !["-", "None", "none", "null"].includes(cleanSel)) {
      inputEl.value = cleanSel;
    } else {
      inputEl.value = "";
    }
  }

  onFinanceCompanyChange(val) {
    // Handled natively by single creatable/searchable datalist input
  }

  async populateCarFormCreatableSelects() {
    let opts = null;
    try {
      const res = await fetch("/api/cars/options");
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          opts = data;
        }
      }
    } catch (e) {
      console.warn("Could not fetch car options from API, fallback to client cars", e);
    }

    if (!opts) {
      const bSet = new Set(), mSet = new Set(), coSet = new Set(), clSet = new Set(), icSet = new Set(), owSet = new Set(), bfSet = new Set(), yrSet = new Set();
      (this.cars || []).forEach(c => {
        if (c.brand) bSet.add(c.brand);
        if (c.model) mSet.add(c.model);
        if (c.company) coSet.add(c.company);
        if (c.color) clSet.add(c.color);
        if (c.ins_company) icSet.add(c.ins_company);
        if (c.owner) owSet.add(c.owner);
        if (c.beneficiary) bfSet.add(c.beneficiary);
        if (c.reg_year) yrSet.add(String(c.reg_year));
      });
      opts = {
        brands: Array.from(bSet),
        models: Array.from(mSet),
        companies: Array.from(coSet),
        colors: Array.from(clSet),
        ins_companies: Array.from(icSet),
        owners: Array.from(owSet),
        beneficiaries: Array.from(bfSet),
        reg_years: Array.from(yrSet)
      };
    }

    const fillDatalist = (id, items) => {
      const dl = document.getElementById(id);
      if (!dl || !Array.isArray(items)) return;
      dl.innerHTML = "";
      items.forEach(val => {
        const clean = String(val || "").trim();
        if (clean && !["-", "None", "none", "null"].includes(clean)) {
          const opt = document.createElement("option");
          opt.value = clean;
          dl.appendChild(opt);
        }
      });
    };

    fillDatalist("car-brands-list", opts.brands);
    fillDatalist("car-models-list", opts.models);
    fillDatalist("car-companies-list", opts.companies);
    fillDatalist("car-colors-list", opts.colors);
    fillDatalist("car-ins-comps-list", opts.ins_companies);
    fillDatalist("car-owners-list", opts.owners);
    fillDatalist("car-beneficiaries-list", opts.beneficiaries);
    fillDatalist("car-reg-years-list", opts.reg_years);
  }

  onCarImageUrlInput(val) {
    const previewEl = document.getElementById("edit-car-img-preview");
    const noImgEl = document.getElementById("edit-car-no-img-text");
    const cleanUrl = String(val || "").trim();
    if (previewEl && noImgEl) {
      if (cleanUrl) {
        previewEl.src = cleanUrl;
        previewEl.style.display = "block";
        noImgEl.style.display = "none";
      } else {
        previewEl.src = "";
        previewEl.style.display = "none";
        noImgEl.style.display = "block";
      }
    }
  }

  async onEditCarModalPhotoSelected(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);

    try {
      this.showToast(`กำลังอัปโหลดรูปภาพ ${file.name}...`, "info");
      const res = await fetch("/api/upload-photo", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        const previewEl = document.getElementById("edit-car-img-preview");
        const noImgEl = document.getElementById("edit-car-no-img-text");
        const urlEl = document.getElementById("edit-car-image-url");
        if (previewEl) {
          previewEl.src = data.url;
          previewEl.style.display = "block";
        }
        if (noImgEl) noImgEl.style.display = "none";
        if (urlEl) urlEl.value = data.url;
        this.showToast("อัปโหลดรูปภาพสำเร็จ! กดบันทึกข้อมูลรถยนต์เพื่อยืนยัน", "success");
      } else {
        this.showToast("อัปโหลดรูปไม่สำเร็จ", "danger");
      }
    } catch (e) {
      this.showToast("อัปโหลดรูปไม่สำเร็จ: " + e.message, "danger");
    }
  }

  async submitEditCar(e) {
    if (e && e.preventDefault) {
      e.preventDefault();
    } else if (window.event && window.event.preventDefault) {
      window.event.preventDefault();
    }

    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const fd = this.carFormData || {};
    const getVal = (id, fdKey, def = "") => {
      const el = document.getElementById(id);
      if (el && el.value !== undefined && el.value !== null && String(el.value).trim() !== "") {
        return el.value;
      }
      if (fd && fd[fdKey] !== undefined && fd[fdKey] !== null && String(fd[fdKey]).trim() !== "") {
        return fd[fdKey];
      }
      return el ? el.value : def;
    };

    const plate = String(getVal("edit-car-plate", "plate", "")).trim();
    const brand = String(getVal("edit-car-brand", "brand", "")).trim();
    const model = String(getVal("edit-car-model", "model", "")).trim();

    if (!plate) {
      this.showToast("⚠️ กรุณาระบุเลขทะเบียนรถ", "warning");
      return;
    }
    if (!brand || !model) {
      this.showToast("⚠️ กรุณาระบุยี่ห้อและรุ่นรถยนต์", "warning");
      return;
    }

    if (this.checkDuplicatePlate(plate)) {
      const msg = (this.currentLang === "EN")
        ? "Duplicate Data: Vehicle plate or VIN (Chassis No) already exists in system"
        : "ข้อมูลซ้ำ: พบเลขทะเบียนหรือเลขตัวถังนี้ในระบบแล้ว";
      alert(`⚠️ ${msg}`);
      this.showToast(`⚠️ ${msg}`, "danger");
      const plateEl = document.getElementById("edit-car-plate");
      if (plateEl) {
        plateEl.focus();
        plateEl.select();
      }
      return;
    }

    const vinVal = String(getVal("edit-car-vin", "vin", getVal("edit-car-vin", "chassis_no", "-"))).trim();
    if (this.checkDuplicateChassis(vinVal)) {
      const msg = (this.currentLang === "EN")
        ? "Duplicate Data: Vehicle plate or VIN (Chassis No) already exists in system"
        : "ข้อมูลซ้ำ: พบเลขทะเบียนหรือเลขตัวถังนี้ในระบบแล้ว";
      alert(`⚠️ ${msg}`);
      this.showToast(`⚠️ ${msg}`, "danger");
      const vinEl = document.getElementById("edit-car-vin");
      if (vinEl) {
        vinEl.focus();
        vinEl.select();
      }
      return;
    }

    const existing = this.cars.find(c => c.plate === (origPlate || plate)) || {};
    const imgUrl = (document.getElementById("edit-car-image-url")?.value || "").trim() || fd.image || existing.image || "";

    const rawPrb = getVal("edit-car-prb-price", "prb_price", getVal("edit-car-prb-price", "act_price", ""));
    const prbPrice = (rawPrb !== "" && rawPrb !== null && !isNaN(rawPrb)) ? parseFloat(rawPrb) : 0.0;
    const rawInsPrem = getVal("edit-car-ins-premium", "insurance_premium", getVal("edit-car-ins-premium", "ins_premium", ""));
    const insPremium = (rawInsPrem !== "" && rawInsPrem !== null && !isNaN(rawInsPrem)) ? parseFloat(rawInsPrem) : 0.0;

    const rawNextSrvDate = getVal("edit-car-next-srv-date", "next_service_date", getVal("edit-car-next-srv-date", "next_engine_oil_date", ""));
    const dmyNextSrvDate = rawNextSrvDate ? (rawNextSrvDate.includes("-") ? this.ymdToDmy(rawNextSrvDate) : rawNextSrvDate) : "-";
    const rawNextSrvMileage = getVal("edit-car-next-srv-mileage", "next_service_mileage", getVal("edit-car-next-srv-mileage", "next_engine_oil_mileage", "0"));
    const nextSrvMileage = parseFloat(rawNextSrvMileage || "0") || 0;

    const isDebtFree = document.getElementById("edit-car-debt-free") ? Boolean(document.getElementById("edit-car-debt-free").checked) : Boolean(fd.is_debt_free);
    const regYearVal = String(getVal("edit-car-reg-year", "register_year", getVal("edit-car-reg-year", "reg_year", "-"))).trim() || "-";
    const insCompVal = String(getVal("edit-car-ins-comp", "insurance_company", getVal("edit-car-ins-comp", "ins_company", "-"))).trim() || "-";
    const finCompVal = isDebtFree ? "-" : (String(getVal("edit-car-finance-company", "finance_company", "-")).trim() || "-");

    const payload = {
      original_plate: origPlate,
      plate: plate,
      brand: brand,
      model: model,
      car_group: getVal("edit-car-group", "car_group", "รถเก๋ง (Sedan/Hatchback)"),
      fuel_system: getVal("edit-car-fuel", "fuel_system", getVal("edit-car-fuel", "fuel_type", "เบนซิน")),
      fuel_type: getVal("edit-car-fuel", "fuel_system", getVal("edit-car-fuel", "fuel_type", "เบนซิน")),
      cc_ev: String(getVal("edit-car-cc", "cc_ev", getVal("edit-car-cc", "engine_cc", "1200"))).trim(),
      engine_cc: String(getVal("edit-car-cc", "cc_ev", getVal("edit-car-cc", "engine_cc", "1200"))).trim(),
      owner_company: String(getVal("edit-car-company", "owner_company", getVal("edit-car-company", "company", "Sawasdee Rent A Car"))).trim(),
      company: String(getVal("edit-car-company", "owner_company", getVal("edit-car-company", "company", "Sawasdee Rent A Car"))).trim(),
      color: String(getVal("edit-car-color", "color", "-")).trim(),
      mileage: String(getVal("edit-car-mileage", "mileage", "0")).trim(),
      daily_rate: parseInt(getVal("edit-car-pday", "daily_rate", getVal("edit-car-pday", "price_day", 1000)) || "1000", 10),
      price_day: parseInt(getVal("edit-car-pday", "daily_rate", getVal("edit-car-pday", "price_day", 1000)) || "1000", 10),
      weekly_rate: parseInt(getVal("edit-car-pweek", "weekly_rate", getVal("edit-car-pweek", "price_week", 6000)) || "6000", 10),
      price_week: parseInt(getVal("edit-car-pweek", "weekly_rate", getVal("edit-car-pweek", "price_week", 6000)) || "6000", 10),
      monthly_rate: parseInt(getVal("edit-car-pmonth", "monthly_rate", getVal("edit-car-pmonth", "price_month", 20000)) || "20000", 10),
      price_month: parseInt(getVal("edit-car-pmonth", "monthly_rate", getVal("edit-car-pmonth", "price_month", 20000)) || "20000", 10),
      vin: vinVal,
      chassis_no: vinVal,
      tax_expire_date: this.ymdToDmy(getVal("edit-car-tax", "tax_expire_date", getVal("edit-car-tax", "tax_expiry", ""))) || "-",
      tax_expiry: this.ymdToDmy(getVal("edit-car-tax", "tax_expire_date", getVal("edit-car-tax", "tax_expiry", ""))) || "-",
      prb_expire_date: this.ymdToDmy(getVal("edit-car-act", "prb_expire_date", getVal("edit-car-act", "act_expiry", ""))) || "-",
      act_expiry: this.ymdToDmy(getVal("edit-car-act", "prb_expire_date", getVal("edit-car-act", "act_expiry", ""))) || "-",
      insurance_expire_date: this.ymdToDmy(getVal("edit-car-ins", "insurance_expire_date", getVal("edit-car-ins", "ins_expiry", ""))) || "-",
      ins_expiry: this.ymdToDmy(getVal("edit-car-ins", "insurance_expire_date", getVal("edit-car-ins", "ins_expiry", ""))) || "-",
      insurance_company: insCompVal,
      ins_company: insCompVal,
      car_owner: String(getVal("edit-car-owner", "car_owner", getVal("edit-car-owner", "owner", "-"))).trim(),
      owner: String(getVal("edit-car-owner", "car_owner", getVal("edit-car-owner", "owner", "-"))).trim(),
      beneficiary: String(getVal("edit-car-beneficiary", "beneficiary", "-")).trim(),
      register_year: regYearVal,
      reg_year: regYearVal,
      prb_price: prbPrice,
      act_price: prbPrice,
      insurance_premium: insPremium,
      ins_premium: insPremium,
      last_service_date: this.ymdToDmy(getVal("edit-car-last-srv", "last_service_date", "")) || "-",
      next_service_date: dmyNextSrvDate,
      next_engine_oil_date: dmyNextSrvDate,
      next_service_mileage: nextSrvMileage,
      next_engine_oil_mileage: nextSrvMileage,
      next_service: dmyNextSrvDate !== "-" ? dmyNextSrvDate : (nextSrvMileage > 0 ? String(nextSrvMileage) : "-"),
      notes: String(getVal("edit-car-notes", "notes", "")).trim(),
      car_status: getVal("edit-car-status", "car_status", getVal("edit-car-status", "status", "ว่างพร้อมใช้งาน")),
      status: getVal("edit-car-status", "car_status", getVal("edit-car-status", "status", "ว่างพร้อมใช้งาน")),
      image_url: imgUrl,
      image: imgUrl,
      is_debt_free: isDebtFree,
      finance_company: finCompVal,
      installment_amount: isDebtFree ? 0 : (parseFloat(getVal("edit-car-installment-amount", "installment_amount", 0)) || 0),
      total_installments: isDebtFree ? 0 : (parseInt(getVal("edit-car-total-installments", "total_installments", 0), 10) || 0),
      current_installment: isDebtFree ? 0 : (parseInt(getVal("edit-car-current-installment", "current_installment", 0), 10) || 0),
      payment_due_date: isDebtFree || !getVal("edit-car-payment-due-date", "payment_due_date", "") ? "-" : String(getVal("edit-car-payment-due-date", "payment_due_date", "-")).trim()
    };

    try {
      let res = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.status === 404) {
        res = await fetch("/api/cars", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        this.closeModal("modal-edit-car");
        if (origPlate && origPlate !== plate) {
          const oldIdx = this.cars.findIndex(c => c.plate === origPlate);
          if (oldIdx >= 0) this.cars.splice(oldIdx, 1);
        }
        const idx = this.cars.findIndex(c => c.plate === plate);
        if (idx >= 0) {
          Object.assign(this.cars[idx], payload);
        } else {
          this.cars.unshift(payload);
        }
        this.renderFleetCards();
        this.renderFleetOverviewTable();
        this.populateFleetDropdowns();
        const successMsg = (this.currentLang === "EN")
          ? `Vehicle data saved successfully (${plate})`
          : `บันทึกข้อมูลรถยนต์ทะเบียน ${plate} เรียบร้อยแล้ว!`;
        this.showToast(`✅ ${successMsg}`, "success");
        this.loadCars().catch(err => console.error("loadCars background err:", err));
      } else {
        const isEn = (this.currentLang === "EN");
        let errMsg = data.message || data.detail || (isEn ? "Failed to save vehicle" : "บันทึกข้อมูลไม่สำเร็จ");
        if (typeof errMsg === "object" && errMsg.message) errMsg = errMsg.message;
        if (res.status === 409 || data.error === "duplicate_vehicle") {
          errMsg = this.t("duplicate_vehicle_error");
          const plateEl = document.getElementById("edit-car-plate");
          if (plateEl) {
            plateEl.focus();
            plateEl.select();
          }
        }
        this.showToast(`⚠️ ${errMsg}`, "danger");
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async deleteCurrentEditingCar() {
    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const plate = (document.getElementById("edit-car-plate")?.value || "").trim();
    const target = origPlate || plate;
    if (!target) return;
    const ok = await this.deleteCarByPlate(target);
    if (ok) {
      this.closeModal("modal-edit-car");
    }
  }

  async deleteCarByPlate(plate) {
    if (!plate) return false;
    const car = this.cars.find(c => c.plate === plate) || {};
    const label = car.brand && car.model ? `${car.brand} ${car.model} (${plate})` : plate;
    const conf = confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบรถยนต์ "${label}" ออกจากระบบ?\n\n⚠️ คำเตือน: ระบบจะไม่อนุญาตให้ลบหากมีรายการจองหรือสัญญาที่ยังไม่เสร็จสิ้น`);
    if (!conf) return false;

    try {
      this.showToast(`⏳ กำลังลบข้อมูลรถยนต์ ${plate}...`, "info");
      const res = await fetch(`/api/cars/${encodeURIComponent(plate)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const norm = this.normalizePlate(plate);
        this.cars = this.cars.filter(c => c.plate !== plate && this.normalizePlate(c.plate) !== norm);
        this.renderFleetCards();
        this.renderFleetOverviewTable();
        this.populateFleetDropdowns();
        this.showToast(`🗑️ ลบข้อมูลรถยนต์ทะเบียน ${plate} เรียบร้อยแล้ว!`, "success");
        await this.loadCars();
        return true;
      } else {
        alert("❌ ไม่สามารถลบรถยนต์คันนี้ได้:\n" + (data.detail || "เกิดข้อผิดพลาดในการลบ"));
        this.showToast("❌ ลบไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
        return false;
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
      return false;
    }
  }

  // --- Modal: Book Car ---
  openBookModal(plate) {
    try {
      const cleanPlate = String(plate || "").trim();
      const car = (this.cars || []).find(c => c.plate === cleanPlate || (this.normalizePlate && this.normalizePlate(c.plate) === this.normalizePlate(cleanPlate))) || { plate: cleanPlate, brand: "", model: "", price_day: 1000 };

      const plateInp = document.getElementById("book-car-plate");
      if (plateInp) plateInp.value = car.plate || cleanPlate;

      const thNow = this.getThaiDateTime ? this.getThaiDateTime(0) : { date: new Date().toISOString().split("T")[0], time: "10:00" };
      const thNext3 = this.getThaiDateTime ? this.getThaiDateTime(3) : { date: new Date(Date.now() + 3*86400000).toISOString().split("T")[0], time: "10:00" };

      // Read directly from DOM Instant Booking Bar inputs to prevent lost references
      const rawSDate = document.getElementById("filter-start-date")?.value;
      const rawSTime = document.getElementById("filter-start-time")?.value;
      const rawEDate = document.getElementById("filter-end-date")?.value;
      const rawETime = document.getElementById("filter-end-time")?.value;

      let fSDate = rawSDate && rawSDate.trim() ? rawSDate.trim() : thNow.date;
      let fSTime = rawSTime && rawSTime.trim() ? rawSTime.trim() : thNow.time;
      let fEDate = rawEDate && rawEDate.trim() ? rawEDate.trim() : (fSDate || thNext3.date);
      let fETime = rawETime && rawETime.trim() ? rawETime.trim() : fSTime;

      // Prevent backdated booking
      if (fSDate < thNow.date) {
        fSDate = thNow.date;
      }
      if (fEDate < fSDate) {
        fEDate = fSDate;
      }

      const mSDate = document.getElementById("book-modal-start-date");
      const mSTime = document.getElementById("book-modal-start-time");
      const mEDate = document.getElementById("book-modal-end-date");
      const mETime = document.getElementById("book-modal-end-time");

      if (mSDate) {
        mSDate.value = fSDate;
        mSDate.min = thNow.date;
      }
      if (mSTime) mSTime.value = fSTime;
      if (mEDate) {
        mEDate.value = fEDate;
        mEDate.min = fSDate;
      }
      if (mETime) mETime.value = fETime;

      const discInp = document.getElementById("book-discount-input");
      if (discInp) discInp.value = 0;

      this.recalcBookingModalFromDates(true);
      this.populateCustomerDropdowns(this.lastAddedCustomerName || null);
      this.openModal("modal-book-car");
    } catch (err) {
      console.error("openBookModal error:", err);
      this.showToast("เกิดข้อผิดพลาดในการเปิดหน้าต่างจอง: " + err.message, "danger");
    }
  }

  setBookingModalDurationDays(targetDays) {
    const sDateInput = document.getElementById("book-modal-start-date");
    const eDateInput = document.getElementById("book-modal-end-date");
    if (!sDateInput || !eDateInput || !sDateInput.value) return;

    let [y, m, d] = sDateInput.value.split("-").map(n => parseInt(n, 10));
    if (y > 2400) y -= 543;
    const target = new Date(y, m - 1, d + targetDays);
    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, "0");
    const dd = String(target.getDate()).padStart(2, "0");
    eDateInput.value = `${yyyy}-${mm}-${dd}`;
    this.recalcBookingModalFromDates(false);
  }

  recalcBookingModalFromDates(fromDateChange = false) {
    const plate = document.getElementById("book-car-plate")?.value;
    const car = this.cars.find(c => c.plate === plate) || { brand: "", model: "", plate: plate || "-", price_day: 1000 };
    const thNow = this.getThaiDateTime(0);
    const mSDate = document.getElementById("book-modal-start-date");
    const mEDate = document.getElementById("book-modal-end-date");

    if (mSDate) {
      if (!mSDate.min) mSDate.min = thNow.date;
      if (mSDate.value && mSDate.value < thNow.date) {
        mSDate.value = thNow.date;
      }
    }
    if (mEDate && mSDate) {
      mEDate.min = mSDate.value || thNow.date;
      if (mEDate.value && mEDate.value < mSDate.value) {
        mEDate.value = mSDate.value;
      }
    }

    const sDate = mSDate?.value || thNow.date;
    const sTime = document.getElementById("book-modal-start-time")?.value || thNow.time;
    const eDate = mEDate?.value || thNow.date;
    const eTime = document.getElementById("book-modal-end-time")?.value || thNow.time;

    const start = new Date(`${sDate}T${sTime}`);
    const end = new Date(`${eDate}T${eTime}`);

    let days = 1;
    let baseDays = 1;
    let extraHours = 0;
    let remMins = 0;
    let isOver4 = false;
    let isInvalidDate = false;

    if (end <= start) {
      days = 1;
      baseDays = 1;
      isInvalidDate = true;
    } else {
      const diffMs = end - start;
      const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
      remMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      baseDays = Math.floor(totalHours / 24);
      extraHours = totalHours % 24;
      if (extraHours > 4 || (extraHours === 4 && remMins > 0)) {
        days = baseDays + 1;
        isOver4 = true;
      } else {
        days = Math.max(1, baseDays);
      }
    }

    const cTypeEl = document.getElementById("book-contract-type");
    if (fromDateChange && cTypeEl) {
      if (days >= 30) {
        cTypeEl.value = "รายเดือน";
      } else if (days >= 7) {
        cTypeEl.value = "รายสัปดาห์";
      } else {
        cTypeEl.value = "รายวัน";
      }
    }

    const cType = cTypeEl?.value || "รายวัน";
    const { basePrice, breakdownText, priceDay, priceWeek, priceMonth } = this.calculateCarRentalPrice(car, days, cType);

    // 1. Render Day & Duration Counter Box (Screenshot 1: เพิ่มตัวเลขการนับวัน)
    const durationBox = document.getElementById("book-modal-duration-box");
    if (durationBox) {
      let statusNotice = "";
      let boxBorder = "#BFDBFE";
      let boxBg = "#EFF6FF";

      if (isInvalidDate) {
        boxBorder = "#FCA5A5";
        boxBg = "#FEF2F2";
        statusNotice = `<span style="color:#DC2626; font-size:12px; font-weight:700;">⚠️ วัน-เวลาคืนรถต้องอยู่หลังเวลารับรถ (ระบบคำนวณขั้นต่ำคิดเป็น 1 วัน)</span>`;
      } else if (isOver4) {
        boxBorder = "#FDBA74";
        boxBg = "#FFF7ED";
        statusNotice = `<span style="color:#C2410C; font-size:12px;">⚠️ คืนรถเกินเวลา <b>${extraHours} ชม. ${remMins} นาที</b> (เกิน 4 ชม. ปรับคิดเพิ่ม 1 วันเต็ม ➔ คิดรวม <b>${days} วัน</b>)</span>`;
      } else if (extraHours > 0 || remMins > 0) {
        boxBorder = "#BFDBFE";
        boxBg = "#EFF6FF";
        statusNotice = `<span style="color:#1D4ED8; font-size:12px;">⏱️ เกินเวลา <b>${extraHours} ชม. ${remMins} นาที</b> (อนุโลมไม่เกิน 4 ชม. ไม่คิดวันเพิ่ม ➔ คิด <b>${days} วัน</b>)</span>`;
      } else {
        boxBorder = "#BBF7D0";
        boxBg = "#F0FDF4";
        statusNotice = `<span style="color:#15803D; font-size:12px;">🟢 ตรงเวลาพอดี <b>${days} วันเต็ม</b> (${days * 24} ชั่วโมง)</span>`;
      }

      let quickAdjustHtml = "";
      if (cType === "รายสัปดาห์" && days < 7) {
        quickAdjustHtml = `
          <button type="button" onclick="app.setBookingModalDurationDays(7)" style="margin-left:auto; background:#FFFFFF; border:1px solid #3B82F6; color:#1D4ED8; padding:3px 9px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;" title="ปรับวันคืนรถให้ครบ 7 วันพอดี">
            ⚡ ปรับวันคืนรถเป็น 7 วัน (1 สัปดาห์)
          </button>
        `;
      } else if (cType === "รายเดือน" && days < 30) {
        quickAdjustHtml = `
          <button type="button" onclick="app.setBookingModalDurationDays(30)" style="margin-left:auto; background:#FFFFFF; border:1px solid #3B82F6; color:#1D4ED8; padding:3px 9px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;" title="ปรับวันคืนรถให้ครบ 30 วันพอดี">
            ⚡ ปรับวันคืนรถเป็น 30 วัน (1 เดือน)
          </button>
        `;
      }

      durationBox.style.background = boxBg;
      durationBox.style.borderColor = boxBorder;
      durationBox.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:13.5px; font-weight:700; color:#1E293B;">จำนวนวันเช่ารวม:</span>
            <span style="background:#1D4ED8; color:#FFFFFF; font-size:15px; font-weight:800; padding:3px 14px; border-radius:20px; box-shadow:0 1px 3px rgba(0,0,0,0.12);">
              ${days} วัน
            </span>
          </div>
          ${quickAdjustHtml}
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          ${statusNotice}
        </div>
      `;
    }

    // 2. Render Top Car Preview Box (Clean professional layout)
    const preview = document.getElementById("book-car-preview");
    if (preview) {
      const activeStyle = "background:#FFFBEB; color:#B45309; border:1.5px solid #F59E0B; font-weight:800;";
      const inactiveStyle = "background:#F1F5F9; color:#475569; border:1px solid #E2E8F0;";

      preview.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
          <div>
            <b style="font-size:15px; color:#1E293B;">${car.brand || ''} ${car.model || ''}</b> | ทะเบียน: <b style="color:#D97706;">${car.plate}</b><br/>
            <span style="font-size:12px; color:#64748B;">กลุ่ม: ${car.car_group || 'รถยนต์'} | เชื้อเพลิง: ${car.fuel_type || car.fuel_system || 'เบนซิน'} | ผู้ถือกรรมสิทธิ์: ${car.owner_company || car.company || '-'}</span>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; color:#64748B; margin-bottom:3px;">อัตราค่าเช่า:</div>
            <div style="display:flex; gap:4px; font-size:11.5px; justify-content:flex-end; flex-wrap:wrap;">
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายวัน' ? activeStyle : inactiveStyle}">฿${priceDay.toLocaleString()}/วัน</span>
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายสัปดาห์' ? activeStyle : inactiveStyle}">฿${priceWeek.toLocaleString()}/สัปดาห์</span>
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายเดือน' ? activeStyle : inactiveStyle}">฿${priceMonth.toLocaleString()}/เดือน</span>
            </div>
          </div>
        </div>
        <div style="margin-top:7px; padding-top:6px; border-top:1px dashed #E2E8F0; font-size:12px; color:#475569;">
          <b>การคำนวณราคา (${cType}):</b> <span style="color:#D97706; font-weight:700;">${breakdownText}</span>
        </div>
      `;
    }

    const pInput = document.getElementById("book-price-input");
    if (pInput) pInput.value = basePrice;
    this.recalcBookingModalPrice();
  }

  recalcBookingModalPrice() {
    const p = parseFloat(document.getElementById("book-price-input")?.value || 0);
    const d = parseFloat(document.getElementById("book-discount-input")?.value || 0);
    const net = Math.max(0, p - d);
    document.getElementById("book-modal-net-price").textContent = `฿${net.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;
  }

  // Returns the first active booking of the car that overlaps [sDate, eDate] (YYYY-MM-DD), else null
  findBookingConflict(plate, sDate, eDate, excludeId = null) {
    if (!plate || !sDate || !eDate) return null;
    const norm = (v) => String(v || "").split("T")[0];
    return (this.bookings || []).find(b => {
      if (b.car_id !== plate) return false;
      if (excludeId && b.booking_id === excludeId) return false;
      if (b.status === "เสร็จสิ้น" || b.status === "ยกเลิก") return false;
      const bs = norm(b.start_date), be = norm(b.end_date);
      if (!bs || !be) return false;
      return !(be < sDate || bs > eDate);
    }) || null;
  }

  async submitInstantBooking() {
    const thNow = this.getThaiDateTime(0);
    const plate = document.getElementById("book-car-plate").value;
    const cust = document.getElementById("book-cust-select").value;
    const cType = document.getElementById("book-contract-type").value;
    const sDate = document.getElementById("book-modal-start-date")?.value || document.getElementById("filter-start-date").value;
    const sTime = document.getElementById("book-modal-start-time")?.value || document.getElementById("filter-start-time").value || thNow.time;
    const eDate = document.getElementById("book-modal-end-date")?.value || document.getElementById("filter-end-date").value;
    const eTime = document.getElementById("book-modal-end-time")?.value || document.getElementById("filter-end-time").value || thNow.time;
    const baseP = parseFloat(document.getElementById("book-price-input").value);
    const disc = parseFloat(document.getElementById("book-discount-input").value || 0);

    // Validation: prevent backdated booking / contracts
    if (sDate < thNow.date) {
      alert(`⚠️ ไม่อนุญาตให้ทำสัญญาหรือจองรถย้อนหลัง!\nวันที่เริ่มต้น (${sDate}) ต้องไม่น้อยกว่าวันนี้ (${thNow.date})`);
      this.showToast(`⚠️ ไม่อนุญาตให้ทำสัญญาย้อนหลัง: วันที่เริ่มต้นต้องเป็น ${thNow.date} ขึ้นไป`, "danger");
      return;
    }
    if (eDate < sDate) {
      alert(`⚠️ วันที่สิ้นสุดสัญญา (${eDate}) ต้องไม่น้อยกว่าวันที่เริ่มต้น (${sDate})`);
      this.showToast(`⚠️ วันที่สิ้นสุดสัญญาต้องไม่น้อยกว่าวันที่เริ่มต้น`, "danger");
      return;
    }

    const overlap = this.findBookingConflict(plate, sDate, eDate);
    if (overlap) {
      alert(`⚠️ ไม่สามารถจองได้: วันที่ทับซ้อนกับคิวเดิมของรถคันนี้\n\nรหัสจอง: ${overlap.booking_id}\nลูกค้า: ${overlap.customer}\nช่วงวันที่: ${overlap.start_date_formatted || overlap.start_date} - ${overlap.end_date_formatted || overlap.end_date}\n\nกรุณาเลือกช่วงวันที่อื่นที่ว่าง`);
      this.showToast("⚠️ วันที่ทับซ้อนกับคิวเดิม ระบบระงับการบันทึกการจอง", "danger");
      return;
    }

    const payload = {
      car_id: plate,
      customer: cust,
      contract_type: cType,
      start_date: sDate,
      end_date: eDate,
      start_time: sTime,
      end_time: eTime,
      base_price: baseP,
      discount: disc,
      deposit_amount: 5000.0,
      created_by: this.user ? this.user.username : "admin"
    };

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || "ไม่สามารถสร้างรายการจองได้");
      }
      if (data.success) {
        this.closeModal("modal-book-car");
        this.showToast(`🎉 สร้างการจอง ${data.booking_id} เรียบร้อย!`, "success");
        await this.loadBookings();
        await this.loadCars();

        // Switch to Tab 2 (Deposit) and auto-select this booking
        this.switchTab("deposit");
        const sel = document.getElementById("deposit-sel-booking");
        if (sel) {
          sel.value = data.booking_id;
          this.onSelectDepositBooking();
        }
      }
    } catch (e) {
      alert(`❌ สร้างรายการจองไม่สำเร็จ:\n${e.message}`);
      this.showToast("เกิดข้อผิดพลาดในการสร้างการจอง: " + e.message, "danger");
    }
  }

  // --- Tab 2: Deposit & Settle Logic ---
  populateBookingDropdowns() {
    const isEn = (this.currentLang === "EN");
    const depSel = document.getElementById("deposit-sel-booking");
    const assignDispSel = document.getElementById("assign-disp-bk");
    const assignRetSel = document.getElementById("assign-ret-bk");
    const contractSel = document.getElementById("contract-sel-bk");

    const activeBks = this.bookings.filter(b => b.status !== "ยกเลิก" && b.status !== "เสร็จสิ้น");
    const allValidBks = this.bookings.filter(b => b.status !== "ยกเลิก");

    const renderOpts = (bks) => `
      <option value="">-- ${isEn ? 'Please select a booking' : 'กรุณาเลือกรายการจอง'} --</option>
      ${bks.map(b => {
        const sFmt = b.start_date_formatted || b.start_date || "-";
        const eFmt = b.end_date_formatted || b.end_date || "-";
        return `<option value="${b.booking_id}">${b.booking_id} | ${b.car_id} (${b.customer}) 📅 ${sFmt} - ${eFmt} [${isEn ? 'Status' : 'สถานะ'}: ${b.status}]</option>`;
      }).join("")}
    `;

    if (depSel) {
      const cur = depSel.value;
      depSel.innerHTML = renderOpts(activeBks);
      if (cur) depSel.value = cur;
    }
    if (assignDispSel) {
      const cur = assignDispSel.value;
      assignDispSel.innerHTML = renderOpts(activeBks);
      if (cur) assignDispSel.value = cur;
    }
    if (assignRetSel) {
      const cur = assignRetSel.value;
      assignRetSel.innerHTML = renderOpts(activeBks);
      if (cur) assignRetSel.value = cur;
    }
    if (contractSel) {
      const cur = contractSel.value;
      contractSel.innerHTML = renderOpts(allValidBks.length > 0 ? allValidBks : this.bookings);
      if (cur) contractSel.value = cur;
    }
  }

  onSelectDepositBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("deposit-sel-booking")?.value;
    const summary = document.getElementById("deposit-booking-summary");
    const actionSec = document.getElementById("deposit-action-section");
    const btnSettle = document.getElementById("btn-settle-rental");
    const btnDlDep = document.getElementById("btn-dl-dep-receipt");
    const btnDlRent = document.getElementById("btn-dl-rent-receipt");
    const btnDlContract = document.getElementById("btn-dl-contract-from-dep");
    const btnSaveSlip = document.getElementById("btn-save-slip-only");

    if (!bkId) {
      if (summary) summary.style.display = "none";
      if (actionSec) actionSec.style.display = "none";
      return;
    }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (!b) return;

    this.currentSelectedBooking = b;
    if (summary) summary.style.display = "block";
    if (actionSec) actionSec.style.display = "block";

    const isDep = b.deposit_paid;
    const isRent = b.rental_paid;
    const netP = parseFloat(b.net_price || 0);

    // 1. Populate amount & payment method (Fixed 5,000 THB)
    const amtEl = document.getElementById("deposit-amount-input");
    if (amtEl) amtEl.value = 5000;
    const methEl = document.getElementById("deposit-method-input");
    if (methEl && b.deposit_method) {
      methEl.value = b.deposit_method;
    }

    // 2. Populate ref number
    const refEl = document.getElementById("deposit-ref-input");
    if (refEl) {
      refEl.value = b.deposit_ref || b.rental_ref || "";
    }
    const alsoRentCb = document.getElementById("deposit-also-rent");
    if (alsoRentCb) {
      alsoRentCb.checked = Boolean(b.rental_paid || b.payment_type === "มัดจำและค่าเช่า");
    }
    const gdriveEl = document.getElementById("deposit-gdrive-input");
    if (gdriveEl) gdriveEl.value = b.google_drive_link || "";

    // 3. Populate slip URL and preview
    if (b.deposit_slip) {
      const urlInput = document.getElementById("deposit-slip-url");
      if (urlInput) urlInput.value = b.deposit_slip;
      this.showDepositSlipPreview(b.deposit_slip, isEn ? `Deposit Slip (${b.booking_id})` : `สลิปมัดจำ (${b.booking_id})`);
    } else if (b.rental_slip) {
      const urlInput = document.getElementById("deposit-slip-url");
      if (urlInput) urlInput.value = b.rental_slip;
      this.showDepositSlipPreview(b.rental_slip, isEn ? `Rental Fee Slip (${b.booking_id})` : `สลิปค่าเช่า (${b.booking_id})`);
    } else {
      this.clearDepositSlip(false);
    }

    // 4. Render detailed summary with slip badges
    let slipBadges = [];
    if (b.deposit_ref) {
      slipBadges.push(`<span>🧾 <b>${isEn ? 'Slip Ref:' : 'เลขที่ Ref สลิป:'}</b> <code style="background:#FEF3C7; color:#92400E; padding:2px 7px; border-radius:4px; font-weight:700; font-size:12px;">${b.deposit_ref}</code></span>`);
    }
    if (b.deposit_slip) {
      slipBadges.push(`<span>📎 <b>${isEn ? 'Deposit Slip:' : 'สลิปมัดจำ:'}</b> <a href="${b.deposit_slip}" target="_blank" style="color:#0284C7; font-weight:700; text-decoration:underline;">🖼️ ${isEn ? 'Click to view slip' : 'คลิกเปิดดูรูปสลิป'}</a></span>`);
    }
    if (b.rental_ref && b.rental_ref !== b.deposit_ref) {
      slipBadges.push(`<span>🧾 <b>${isEn ? 'Rental Ref:' : 'Ref ค่าเช่า:'}</b> <code style="background:#E0F2FE; color:#0369A1; padding:2px 7px; border-radius:4px; font-weight:700; font-size:12px;">${b.rental_ref}</code></span>`);
    }
    if (b.rental_slip && b.rental_slip !== b.deposit_slip) {
      slipBadges.push(`<span>📎 <b>${isEn ? 'Rental Slip:' : 'สลิปค่าเช่า:'}</b> <a href="${b.rental_slip}" target="_blank" style="color:#0284C7; font-weight:700; text-decoration:underline;">🖼️ ${isEn ? 'Click to view slip' : 'คลิกเปิดดูรูปสลิป'}</a></span>`);
    }

    summary.innerHTML = `
      <div class="deposit-summary-rows">
        <div class="deposit-summary-row"><span>${isEn ? 'ID' : 'รหัส'}</span><b>${b.booking_id}</b><span>${b.car_id || ''}</span></div>
        <div class="deposit-summary-row"><span>${isEn ? 'Customer' : 'ลูกค้า'}</span><b>${b.customer || '-'}</b><span>${b.customer_phone || ''}</span></div>
        <div class="deposit-summary-row"><span>${isEn ? 'Dates' : 'ระยะเวลา'}</span><b>${b.start_date_formatted || b.start_date || '-'} – ${b.end_date_formatted || b.end_date || '-'}</b></div>
        <div class="deposit-summary-row"><span>${isEn ? 'Net' : 'ค่าเช่าสุทธิ'}</span><b class="deposit-summary-price">฿${netP.toLocaleString()}</b><span style="color:${isDep ? '#059669' : '#DC2626'};">${isDep ? (isEn ? 'Deposit paid' : 'มัดจำชำระแล้ว') : (isEn ? 'Deposit pending' : 'รอมัดจำ')}</span></div>
        ${b.payment_type ? `<div class="deposit-summary-row"><span>${isEn ? 'Type' : 'ประเภท'}</span><b>${b.payment_type}</b></div>` : ''}
        ${b.google_drive_link ? `<a class="deposit-summary-slip" href="${b.google_drive_link}" target="_blank">${isEn ? 'Google Drive' : 'Google Drive'}</a>` : ''}
        ${b.deposit_slip ? `<a class="deposit-summary-slip" href="${b.deposit_slip}" target="_blank">${isEn ? 'View slip' : 'ดูสลิป'}</a>` : ''}
        ${slipBadges.length > 0 ? `<div class="deposit-summary-extra">${slipBadges.join("")}</div>` : ''}
      </div>
    `;

    if (btnSaveSlip) btnSaveSlip.style.display = isDep ? "inline-flex" : "none";
    if (btnSettle) { const remVal = parseFloat(b.remaining_rental !== undefined ? b.remaining_rental : (b.rental_paid ? 0 : netP)); btnSettle.style.display = ((!isRent && isDep) || remVal > 0) ? "inline-flex" : "none"; }
    if (btnDlDep) btnDlDep.style.display = isDep ? "inline-flex" : "none";
    if (btnDlRent) btnDlRent.style.display = isRent ? "inline-flex" : "none";
    if (btnDlContract) btnDlContract.style.display = "inline-flex";
  }

  async onDepositSlipSelected(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);

    const statusEl = document.getElementById("deposit-slip-status");
    if (statusEl) statusEl.innerHTML = `<span style="color:#2563EB;">⏳ กำลังอัปโหลด...</span>`;

    try {
      this.showToast(`⏳ กำลังอัปโหลดสลิป ${file.name}...`, "info");
      const res = await fetch("/api/upload-photo", { method: "POST", body: formData });
      const data = await res.json();
      if (!data.success || !data.url) {
        throw new Error(data.detail || "อัปโหลดรูปภาพสลิปไม่สำเร็จ");
      }

      const slipUrl = data.url;
      const urlInput = document.getElementById("deposit-slip-url");
      if (urlInput) urlInput.value = slipUrl;

      this.showDepositSlipPreview(slipUrl, file.name);
      this.showToast(`✅ อัปโหลดรูปสลิปเรียบร้อย!`, "success");
    } catch (err) {
      console.error("Upload slip error:", err);
      if (statusEl) statusEl.innerHTML = `<span style="color:#DC2626;">❌ อัปโหลดไม่สำเร็จ</span>`;
      this.showToast("อัปโหลดสลิปไม่สำเร็จ: " + err.message, "danger");
    }
  }

  showDepositSlipPreview(url, fileName = "สลิปหลักฐานการชำระเงิน") {
    const box = document.getElementById("deposit-slip-preview-box");
    const img = document.getElementById("deposit-slip-preview-img");
    const link = document.getElementById("deposit-slip-preview-link");
    const nameEl = document.getElementById("deposit-slip-preview-name");
    const openBtn = document.getElementById("deposit-slip-open-btn");
    const statusEl = document.getElementById("deposit-slip-status");

    if (box && img && link) {
      box.style.display = "flex";
      img.src = url;
      link.href = url;
      if (openBtn) openBtn.href = url;
      if (nameEl) nameEl.textContent = fileName || "สลิปหลักฐานการชำระเงิน";
      if (statusEl) statusEl.innerHTML = `<b style="color:#059669;">✔️ แนบสลิปแล้ว</b>`;
    }
  }

  clearDepositSlip(resetFile = true) {
    const urlInput = document.getElementById("deposit-slip-url");
    if (urlInput) urlInput.value = "";
    const box = document.getElementById("deposit-slip-preview-box");
    if (box) box.style.display = "none";
    const statusEl = document.getElementById("deposit-slip-status");
    if (statusEl) statusEl.textContent = "ยังไม่ได้แนบสลิป";
    if (resetFile) {
      const fileInput = document.getElementById("deposit-slip-file");
      if (fileInput) fileInput.value = "";
    }
  }

  async submitDeposit() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depAmt = parseFloat(document.getElementById("deposit-amount-input").value) || 0;
    const depMethod = document.getElementById("deposit-method-input").value;
    const depRef = (document.getElementById("deposit-ref-input")?.value || "").trim();
    const slipUrl = (document.getElementById("deposit-slip-url")?.value || "").trim();
    const gdriveLink = (document.getElementById("deposit-gdrive-input")?.value || "").trim();
    const alsoRent = Boolean(document.getElementById("deposit-also-rent")?.checked);
    const payType = alsoRent ? "มัดจำและค่าเช่า" : "มัดจำประกันสัญญา";

    try {
      this.showToast(`⏳ กำลังบันทึกรับเงินมัดจำ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: bkId,
          amount: depAmt,
          payment_method: depMethod,
          ref_id: depRef,
          slip_image_url: slipUrl || gdriveLink,
          deposit_amount: depAmt,
          payment_ref: depRef,
          deposit_ref: depRef,
          slip_url: slipUrl,
          payment_type: payType,
          google_drive_link: gdriveLink,
          also_pay_rental: alsoRent
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("บันทึกข้อมูลการเงินสำเร็จ", "success");
        if (typeof Swal !== "undefined") {
          Swal.fire({
            icon: 'success',
            title: 'บันทึกข้อมูลการเงินสำเร็จ',
            text: `บันทึกเงินมัดจำสำหรับใบจอง ${bkId} เรียบร้อยแล้ว`,
            timer: 2000,
            showConfirmButton: false
          });
        }
        await this.loadBookings();
        await this.loadCars();
        if (typeof this.loadDashboardKPIs === "function") {
          await this.loadDashboardKPIs();
        }
        this.onSelectDepositBooking();
        await this.goToTabWithBooking("assign", bkId);
      } else {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
    } catch (e) {
      console.error("[Deposit] Error submitting deposit:", e);
      this.showToast("เกิดข้อผิดพลาด: " + (e.message || "ไม่สามารถบันทึกข้อมูลการเงินได้"), "danger");
      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: e.message || 'ไม่สามารถบันทึกข้อมูลการเงินได้'
        });
      }
    }
  }

  async submitSettle() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depMethod = document.getElementById("deposit-method-input").value;
    const depRef = (document.getElementById("deposit-ref-input")?.value || "").trim();
    const slipUrl = (document.getElementById("deposit-slip-url")?.value || "").trim();
    const gdriveLink = (document.getElementById("deposit-gdrive-input")?.value || "").trim();
    const rentAmt = parseFloat(this.currentSelectedBooking?.remaining_rental || this.currentSelectedBooking?.net_price || 0);

    try {
      this.showToast(`⏳ กำลังบันทึกชำระค่าเช่าคงเหลือ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: bkId,
          amount: rentAmt,
          payment_method: depMethod,
          ref_id: depRef,
          slip_image_url: slipUrl || gdriveLink,
          payment_ref: depRef,
          rental_ref: depRef,
          slip_url: slipUrl
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("บันทึกข้อมูลการเงินสำเร็จ", "success");
        if (typeof Swal !== "undefined") {
          Swal.fire({
            icon: 'success',
            title: 'บันทึกข้อมูลการเงินสำเร็จ',
            text: `บันทึกชำระค่าเช่าสำหรับใบจอง ${bkId} เรียบร้อยแล้ว`,
            timer: 2000,
            showConfirmButton: false
          });
        }
        await this.loadBookings();
        this.onSelectDepositBooking();
      } else {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
    } catch (e) {
      console.error("[Settle] Error submitting settle:", e);
      this.showToast("เกิดข้อผิดพลาด: " + (e.message || "ไม่สามารถบันทึกข้อมูลการเงินได้"), "danger");
      if (typeof Swal !== "undefined") {
        Swal.fire({
          icon: 'error',
          title: 'เกิดข้อผิดพลาด',
          text: e.message || 'ไม่สามารถบันทึกข้อมูลการเงินได้'
        });
      }
    }
  }

  async submitUpdateSlipOnly() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depRef = (document.getElementById("deposit-ref-input")?.value || "").trim();
    const slipUrl = (document.getElementById("deposit-slip-url")?.value || "").trim();
    const alsoRent = Boolean(document.getElementById("deposit-also-rent")?.checked);
    const payType = alsoRent ? "มัดจำและค่าเช่า" : (this.currentSelectedBooking?.payment_type || "มัดจำประกันสัญญา");
    const gdriveLink = (document.getElementById("deposit-gdrive-input")?.value || "").trim();

    try {
      this.showToast(`⏳ กำลังอัปเดตสลิปและเลข Ref สำหรับ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/payment-slip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_ref: depRef,
          slip_url: slipUrl,
          payment_type: payType,
          google_drive_link: gdriveLink
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ อัปเดตสลิปและเลข Ref ${bkId} เรียบร้อย!`, "success");
        await this.loadBookings();
        this.onSelectDepositBooking();
      } else {
        throw new Error(data.detail || "อัปเดตไม่สำเร็จ");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Tab 3: Dispatch & Return Assign ---
  populateStaffDropdowns() {
    const dispW = document.getElementById("assign-disp-worker");
    const retW = document.getElementById("assign-ret-worker");
    const walkinW = document.getElementById("walkin-worker-select");
    const approved = (this.users || []).filter(u => !u.status || u.status === "approved");
    const opts = approved.map(u => {
      const uname = u.username;
      const label = (u.name && u.name !== uname) ? `${uname} (${u.name})` : uname;
      return `<option value="${uname}">${label} [${u.role || 'Staff'}]</option>`;
    }).join("");
    const fallback = `<option value="admin">admin (ผู้ดูแลระบบ) [Admin]</option>`;

    [dispW, retW, walkinW].forEach(sel => {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = opts || fallback;
      if (cur && cur !== "Wait" && cur !== "-" && Array.from(sel.options).some(o => o.value === cur)) {
        sel.value = cur;
      } else if (sel.options.length > 0) {
        sel.selectedIndex = 0;
      }
    });
  }

  // --- Unified Work Order (Dispatch / Return conditional rendering) ---
  setAssignMode(mode) {
    const isDisp = mode !== "Return";
    this.assignMode = isDisp ? "Dispatch" : "Return";
    const dispCard = document.getElementById("assign-card-disp");
    const retCard = document.getElementById("assign-card-ret");
    if (dispCard) dispCard.style.display = isDisp ? "block" : "none";
    if (retCard) retCard.style.display = isDisp ? "none" : "block";
    document.querySelectorAll('input[name="assign-mode"]').forEach(r => { r.checked = (r.value === this.assignMode); });
    const dispSel = document.getElementById("assign-disp-bk");
    const retSel = document.getElementById("assign-ret-bk");
    if (isDisp && dispSel && retSel && retSel.value && dispSel.value !== retSel.value) {
      dispSel.value = retSel.value;
      this.onSelectAssignDispBooking();
    } else if (!isDisp && dispSel && retSel && dispSel.value && retSel.value !== dispSel.value) {
      retSel.value = dispSel.value;
      this.onSelectAssignRetBooking();
    }
  }

  async goToTabWithBooking(tabName, bkId) {
    if (bkId) {
      const b = this.bookings.find(x => x.booking_id === bkId);
      if (b) this.currentSelectedBooking = b;
    }
    await this.switchTab(tabName);
    if (!bkId) return;
    if (tabName === "deposit") {
      const sel = document.getElementById("deposit-sel-booking");
      if (sel) {
        sel.value = bkId;
        this.onSelectDepositBooking();
      }
    } else if (tabName === "assign") {
      this.confirmedAssignSides = this.confirmedAssignSides || {};
      this.confirmedAssignSides[bkId] = { Dispatch: false, Return: false };
      const sel = document.getElementById("assign-disp-bk");
      if (sel) {
        sel.value = bkId;
        this.onSelectAssignDispBooking();
      }
      const retSel = document.getElementById("assign-ret-bk");
      if (retSel) {
        retSel.value = bkId;
        this.onSelectAssignRetBooking();
      }
      const bkObj = this.bookings.find(x => x.booking_id === bkId);
      this.setAssignMode(bkObj && ["กำลังเช่า", "เตรียมรับคืน"].includes(bkObj.status) ? "Return" : "Dispatch");
    } else if (tabName === "contract") {
      const sel = document.getElementById("contract-sel-bk");
      if (sel) {
        sel.value = bkId;
        this.onSelectContractBooking();
      }
    }
  }

  onSelectAssignDispBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("assign-disp-bk")?.value;
    const form = document.getElementById("assign-disp-form");
    if (!bkId) {
      if (form) form.style.display = "none";
      return;
    }
    if (form) form.style.display = "block";
    this.populateStaffDropdowns();

    // Auto-sync right-side Return Work Order dropdown to the same booking
    const retSel = document.getElementById("assign-ret-bk");
    if (retSel && retSel.value !== bkId) {
      retSel.value = bkId;
      this.onSelectAssignRetBooking();
    }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (b) {
      const dispPrintBtn = document.getElementById("btn-assign-disp-print-pdf");
      if (dispPrintBtn) {
        dispPrintBtn.href = b.checkout_pdf_url || `/api/pdf/inspection/${bkId}?type=checkout`;
        dispPrintBtn.style.display = "block";
        dispPrintBtn.onclick = (e) => {
          e.preventDefault();
          this.printInspectionForm('Dispatch');
        };
      }
      const sDateEl = document.getElementById("assign-disp-start-date");
      const eDateEl = document.getElementById("assign-disp-end-date");
      const dispDateEl = document.getElementById("assign-disp-date");
      const locEl = document.getElementById("assign-disp-loc");
      const timeEl = document.getElementById("assign-disp-time");
      const workerEl = document.getElementById("assign-disp-worker");
      const bannerEl = document.getElementById("assign-disp-status-banner");

      const thNow = this.getThaiDateTime(0);
      const sVal = b.start_date || thNow.date;
      const eVal = b.end_date || thNow.date;
      if (sDateEl) sDateEl.value = sVal;
      if (eDateEl) eDateEl.value = eVal;
      if (dispDateEl) dispDateEl.value = sVal;
      if (locEl) locEl.value = b.loc_delivery || "";
      if (timeEl) timeEl.value = b.start_time || thNow.time;
      if (workerEl) {
        const w = String(b.worker_delivery || "").trim();
        if (w && w !== "Wait" && w !== "-" && Array.from(workerEl.options).some(o => o.value === w)) {
          workerEl.value = w;
        } else if (workerEl.options.length > 0) {
          workerEl.selectedIndex = 0;
        }
      }

      const odoEl = document.getElementById("assign-disp-odometer");
      const fuelEl = document.getElementById("assign-disp-fuel");
      const notesEl = document.getElementById("assign-disp-notes");
      const photosUrlEl = document.getElementById("assign-disp-photos-url");
      const photosPrevEl = document.getElementById("assign-disp-photos-preview");

      if (odoEl) odoEl.value = b.odometer_out || b.dispatch_mileage || "";
      const savedDispCats = b.inspection_categories_out || b.inspection_categories;
      ['petrol', 'cleanliness', 'tires', 'interior', 'underhood'].forEach(k => {
        const el = document.getElementById("assign-disp-chk-" + k);
        if (el) el.checked = savedDispCats ? (savedDispCats[k] !== false) : true;
      });
      if (fuelEl) fuelEl.value = b.fuel_out || b.dispatch_fuel || fuelEl.value;
      if (notesEl) notesEl.value = b.inspection_notes_out || b.dispatch_notes || b.remarks || "";
      if (photosUrlEl) photosUrlEl.value = b.inspection_photos_out || "";
      this.assignDispPhotos = b.inspection_photos_out ? b.inspection_photos_out.split(",").map(x => x.trim()).filter(Boolean) : [];
      if (photosPrevEl) {
        photosPrevEl.innerHTML = (this.assignDispPhotos || []).map(url => `
          <a href="${url}" target="_blank" style="display:inline-block; border-radius:6px; overflow:hidden; border:1px solid #CBD5E1;">
            <img src="${url}" style="width:60px; height:45px; object-fit:cover; display:block;">
          </a>
        `).join("");
      }

      if (bannerEl) {
        const isDep = Boolean(b.deposit_paid);
        const isRent = Boolean(b.rental_paid);
        const netP = parseFloat(b.net_price || 0);
        const wDel = String(b.worker_delivery || "").trim();
        const hasDriver = wDel && wDel !== "Wait" && wDel !== "-";
        const sFmt = b.start_date_formatted || sVal;
        const eFmt = b.end_date_formatted || eVal;

        let html = `
          <div style="background:#FAF7F2; border:1px solid #E5E7EB; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#1F2937;">
            📅 <b>${isEn ? 'Pick-up Schedule:' : 'กำหนดส่งมอบรถ:'}</b> <span style="color:#EA580C; font-weight:700;">${sFmt} (${b.start_time || '10:00'}${isEn ? '' : ' น.'})</span> &nbsp;|&nbsp; <b>${isEn ? 'Return Schedule:' : 'กำหนดคืนรถ:'}</b> <span style="font-weight:700;">${eFmt} (${b.end_time || '10:00'}${isEn ? '' : ' น.'})</span>
          </div>
        `;
        if (!isDep) {
          html += `
            <div style="background:#FFFBEB; border:1px solid #F59E0B; border-radius:8px; padding:10px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-size:12.5px; color:#92400E;"><b>🟡 ${isEn ? 'Booking Status: Awaiting Deposit' : 'สถานะการจอง: รอชำระเงินมัดจำ'}</b> (${isEn ? 'Driver can be assigned in advance' : 'สามารถมอบหมายคนขับล่วงหน้าได้'})</div>
              <button type="button" onclick="app.goToTabWithBooking('deposit', '${b.booking_id}')" class="btn btn-secondary" style="padding:4px 10px; font-size:12px; font-weight:700;">💳 ${isEn ? 'Collect Deposit' : 'ไปรับมัดจำ'}</button>
            </div>
          `;
        }
        if (isRent) {
          html += `
            <div style="background:#ECFDF5; border:1px solid #10B981; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#065F46; font-weight:700;">
              ✅ ${isEn ? 'Rental fee fully paid' : 'ชำระค่าเช่ารถครบถ้วนแล้ว'} (฿${netP.toLocaleString('th-TH', {minimumFractionDigits: 2})})
            </div>
          `;
          if (b.contract_issued) {
            html += `
              <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#166534; font-weight:700;">
                ✅ ${isEn ? 'Rental contract issued (Ready for vehicle delivery)' : 'ออกสัญญาเช่าเรียบร้อยแล้ว (พร้อมส่งมอบรถยนต์)'}
              </div>
            `;
          } else {
            html += `
              <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:8px; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                <div style="font-size:12.5px; color:#1E40AF;">📝 <b>${isEn ? 'Awaiting Contract:' : 'รอออกสัญญาเช่า:'}</b> ${isEn ? 'Please issue contract in Tab 4 before vehicle handover' : 'กรุณาไปออกสัญญาเช่าในแท็บ 4 ก่อนส่งมอบรถยนต์'}</div>
                <button type="button" onclick="app.goToTabWithBooking('contract', '${b.booking_id}')" class="btn btn-primary btn-sm" style="padding:4px 10px; font-size:11.5px; font-weight:700;">📝 ${isEn ? 'Go to Contract' : 'ไปหน้าสัญญา ➔'}</button>
              </div>
            `;
          }
        } else {
          html += `
            <div style="background:#EFF6FF; border:1px solid #93C5FD; border-radius:8px; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-size:12.5px; color:#1E40AF;">⏳ <b>${isEn ? 'Pending Rental Fee on Pick-up:' : 'รอชำระค่าเช่าวันรับรถ:'}</b> ฿${netP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
              <button type="button" onclick="app.openSettleModal('${b.booking_id}')" class="btn btn-secondary" style="padding:4px 10px; font-size:12px; font-weight:700;">💳 ${isEn ? 'Pay Rental Fee' : 'กดจ่ายเงินค่าเช่า'}</button>
            </div>
          `;
        }
        if (hasDriver) {
          html += `
            <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:8px 12px; font-size:12.5px; color:#166534;">
              🚚 <b>${isEn ? 'Dispatch Staff Assigned:' : 'มอบหมายพนักงานจัดส่งแล้ว:'}</b> ${wDel} (${isEn ? 'Date' : 'วันที่'} ${sFmt} ${isEn ? 'Time' : 'เวลา'} ${b.start_time || '10:00'}${isEn ? '' : ' น.'})
            </div>
          `;
        }
        bannerEl.innerHTML = html;
      }
    }
  }

  onSelectAssignRetBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("assign-ret-bk")?.value;
    const form = document.getElementById("assign-ret-form");
    if (!bkId) {
      if (form) form.style.display = "none";
      return;
    }
    if (form) form.style.display = "block";
    this.populateStaffDropdowns();
    const dispSel = document.getElementById("assign-disp-bk");
    if (dispSel && dispSel.value !== bkId) {
      dispSel.value = bkId;
    }
    const b = this.bookings.find(x => x.booking_id === bkId);
    if (b) {
      const retPrintBtn = document.getElementById("btn-assign-ret-print-pdf");
      if (retPrintBtn) {
        retPrintBtn.href = b.checkin_pdf_url || `/api/pdf/inspection/${bkId}?type=checkin`;
        retPrintBtn.style.display = "block";
        retPrintBtn.onclick = (e) => {
          e.preventDefault();
          this.printInspectionForm('Return');
        };
      }
      const sDateEl = document.getElementById("assign-ret-start-date");
      const eDateEl = document.getElementById("assign-ret-end-date");
      const retDateEl = document.getElementById("assign-ret-date");
      const locEl = document.getElementById("assign-ret-loc");
      const timeEl = document.getElementById("assign-ret-time");
      const workerEl = document.getElementById("assign-ret-worker");
      const bannerEl = document.getElementById("assign-ret-status-banner");

      const thNow = this.getThaiDateTime(0);
      const sVal = b.start_date || thNow.date;
      const eVal = b.end_date || thNow.date;
      if (sDateEl) sDateEl.value = sVal;
      if (eDateEl) eDateEl.value = eVal;
      if (retDateEl) retDateEl.value = eVal;
      if (locEl) locEl.value = b.loc_return || b.loc_delivery || "";
      if (timeEl) timeEl.value = b.end_time || thNow.time;
      if (workerEl) {
        const w = String(b.worker_return || "").trim();
        if (w && w !== "Wait" && w !== "-" && Array.from(workerEl.options).some(o => o.value === w)) {
          workerEl.value = w;
        } else if (workerEl.options.length > 0) {
          workerEl.selectedIndex = 0;
        }
      }

      const odoEl = document.getElementById("assign-ret-odometer");
      const fuelEl = document.getElementById("assign-ret-fuel");
      const notesEl = document.getElementById("assign-ret-notes");
      const photosUrlEl = document.getElementById("assign-ret-photos-url");
      const photosPrevEl = document.getElementById("assign-ret-photos-preview");
      const badgeEl = document.getElementById("assign-ret-compare-badge");

      if (odoEl) odoEl.value = b.odometer_in || b.return_mileage || "";
      const savedRetCats = b.inspection_categories_in || b.inspection_categories;
      ['petrol', 'cleanliness', 'tires', 'interior', 'underhood'].forEach(k => {
        const el = document.getElementById("assign-ret-chk-" + k);
        if (el) el.checked = savedRetCats ? (savedRetCats[k] !== false) : true;
      });
      if (fuelEl) fuelEl.value = b.fuel_in || b.return_fuel || fuelEl.value;
      if (notesEl) notesEl.value = b.inspection_notes_in || b.return_notes || b.remarks || "";
      if (photosUrlEl) photosUrlEl.value = b.inspection_photos_in || "";
      this.assignRetPhotos = b.inspection_photos_in ? b.inspection_photos_in.split(",").map(x => x.trim()).filter(Boolean) : [];
      if (photosPrevEl) {
        photosPrevEl.innerHTML = (this.assignRetPhotos || []).map(url => `
          <a href="${url}" target="_blank" style="display:inline-block; border-radius:6px; overflow:hidden; border:1px solid #CBD5E1;">
            <img src="${url}" style="width:60px; height:45px; object-fit:cover; display:block;">
          </a>
        `).join("");
      }

      if (badgeEl) {
        const outOdoFmt = b.odometer_out ? `${Number(b.odometer_out).toLocaleString()} กม.` : 'ไม่ได้ระบุ';
        const outFuelFmt = b.fuel_out || 'ไม่ได้ระบุ';
        const outNotesFmt = b.inspection_notes_out ? `"${b.inspection_notes_out}"` : 'ไม่มีบันทึก';
        badgeEl.innerHTML = `📌 <b>ข้อมูลตอนส่งมอบ (Outbound):</b> เลขไมล์: <span style="font-weight:700; color:#B45309;">${outOdoFmt}</span> | ระดับน้ำมัน: <span style="font-weight:700; color:#B45309;">${outFuelFmt}</span> | ตำหนิเดิม: <span style="font-style:italic;">${outNotesFmt}</span>`;
      }
      this.recalcReturnInspectionDiff();

      if (bannerEl) {
        const wRet = String(b.worker_return || "").trim();
        const hasDriver = wRet && wRet !== "Wait" && wRet !== "-";
        const sFmt = b.start_date_formatted || sVal;
        const eFmt = b.end_date_formatted || eVal;
        let html = `
          <div style="background:#FAF7F2; border:1px solid #E5E7EB; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12.5px; color:#1F2937;">
            📅 <b>${isEn ? 'Return Schedule:' : 'กำหนดรับรถคืน:'}</b> <span style="color:#EA580C; font-weight:700;">${eFmt} (${b.end_time || '10:00'}${isEn ? '' : ' น.'})</span> &nbsp;|&nbsp; <b>${isEn ? 'Rental Start:' : 'วันเริ่มเช่า:'}</b> <span>${sFmt}</span>
          </div>
        `;
        if (hasDriver) {
          html += `
            <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:8px 12px; font-size:12.5px; color:#166534;">
              🔙 <b>${isEn ? 'Return Staff Assigned:' : 'มอบหมายพนักงานรับรถคืนแล้ว:'}</b> ${wRet} (${isEn ? 'Date' : 'วันที่'} ${eFmt} ${isEn ? 'Time' : 'เวลา'} ${b.end_time || '10:00'}${isEn ? '' : ' น.'})
            </div>
          `;
        }
        bannerEl.innerHTML = html;
      }
    }
  }


  async handleInspectionPhotoUpload(input, mode) {
    if (!input.files || input.files.length === 0) return;
    const isDisp = mode === "Dispatch";
    const prevEl = document.getElementById(isDisp ? "assign-disp-photos-preview" : "assign-ret-photos-preview");
    const urlInput = document.getElementById(isDisp ? "assign-disp-photos-url" : "assign-ret-photos-url");
    if (isDisp) this.assignDispPhotos = this.assignDispPhotos || [];
    else this.assignRetPhotos = this.assignRetPhotos || [];
    const photosArr = isDisp ? this.assignDispPhotos : this.assignRetPhotos;

    for (let i = 0; i < input.files.length; i++) {
      const file = input.files[i];
      const formData = new FormData();
      formData.append("file", file);
      try {
        this.showToast(`กำลังอัปโหลดรูปสภาพรถ ${file.name}...`, "info");
        const res = await fetch("/api/upload-photo", { method: "POST", body: formData });
        const data = await res.json();
        if (data.success && data.url) {
          photosArr.push(data.url);
          this.showToast(`📸 แนบรูป ${file.name} เรียบร้อย!`, "success");
        }
      } catch (e) {
        this.showToast(`อัปโหลดรูป ${file.name} ไม่สำเร็จ: ` + e.message, "danger");
      }
    }
    if (urlInput) urlInput.value = photosArr.join(",");
    if (prevEl) {
      prevEl.innerHTML = photosArr.map(url => `
        <a href="${url}" target="_blank" style="display:inline-block; border-radius:6px; overflow:hidden; border:1px solid #CBD5E1;">
          <img src="${url}" style="width:60px; height:45px; object-fit:cover; display:block;">
        </a>
      `).join("");
    }
  }

  recalcReturnInspectionDiff() {
    const bkId = document.getElementById("assign-ret-bk")?.value;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    const odoDiffEl = document.getElementById("assign-ret-mileage-diff");
    const fuelDiffEl = document.getElementById("assign-ret-fuel-diff");
    const inOdoVal = parseFloat(document.getElementById("assign-ret-odometer")?.value || "");

    if (b && odoDiffEl) {
      const outOdoVal = parseFloat(b.odometer_out || "");
      if (!isNaN(outOdoVal) && !isNaN(inOdoVal) && inOdoVal > 0) {
        const diff = inOdoVal - outOdoVal;
        if (diff >= 0) {
          odoDiffEl.innerHTML = `<span style="color:#059669; font-weight:700;">▲ ใช้งานไป ${diff.toLocaleString()} กม. (จากเลขไมล์ส่งมอบ ${outOdoVal.toLocaleString()})</span>`;
        } else {
          odoDiffEl.innerHTML = `<span style="color:#DC2626; font-weight:700;">⚠️ เลขไมล์น้อยกว่าตอนส่งมอบ (${outOdoVal.toLocaleString()} กม.) กรุณาตรวจสอบ</span>`;
        }
      } else {
        odoDiffEl.innerHTML = "";
      }
    }

    if (b && fuelDiffEl) {
      const outFuel = b.fuel_out || "";
      const inFuel = document.getElementById("assign-ret-fuel")?.value || "";
      if (outFuel && inFuel) {
        const fuelScore = (f) => {
          if (f.includes("เต็มถัง") || f.includes("Full")) return 4;
          if (f.includes("3/4")) return 3;
          if (f.includes("1/2")) return 2;
          if (f.includes("1/4")) return 1;
          return 0;
        };
        const sOut = fuelScore(outFuel);
        const sIn = fuelScore(inFuel);
        if (sIn < sOut) {
          fuelDiffEl.innerHTML = `<span style="color:#DC2626; font-weight:700;">⚠️ น้ำมันน้อยกว่าตอนส่งมอบ (${outFuel}) กรุณาพิจารณาคิดค่าน้ำมันเพิ่ม</span>`;
        } else if (sIn > sOut) {
          fuelDiffEl.innerHTML = `<span style="color:#059669; font-weight:700;">✅ น้ำมันมากกว่าตอนส่งมอบ (${outFuel})</span>`;
        } else {
          fuelDiffEl.innerHTML = `<span style="color:#4B5563;">ระดับน้ำมันเท่ากับตอนส่งมอบ</span>`;
        }
      } else {
        fuelDiffEl.innerHTML = "";
      }
    }
  }

  async submitAssign(jobType, actionType = "prepare") {
    const isDisp = jobType === "Dispatch";
    const bkId = document.getElementById(isDisp ? "assign-disp-bk" : "assign-ret-bk").value;
    const worker = document.getElementById(isDisp ? "assign-disp-worker" : "assign-ret-worker").value;
    const loc = document.getElementById(isDisp ? "assign-disp-loc" : "assign-ret-loc").value;
    const tVal = document.getElementById(isDisp ? "assign-disp-time" : "assign-ret-time").value;
    const sDate = (isDisp ? document.getElementById("assign-disp-date")?.value : null) || document.getElementById(isDisp ? "assign-disp-start-date" : "assign-ret-start-date")?.value || "";
    const eDate = (!isDisp ? document.getElementById("assign-ret-date")?.value : null) || document.getElementById(isDisp ? "assign-disp-end-date" : "assign-ret-end-date")?.value || "";

    const bkObj = (this.bookings || []).find(x => x.booking_id === bkId);
    if (actionType === "handover") {
      if (bkObj && !bkObj.deposit_paid) {
        alert("⚠️ ยังไม่ได้ชำระเงินมัดจำ ไม่สามารถส่งมอบรถได้ (กรุณาไปที่แท็บ \"2. เงินมัดจำ & การเงิน\")");
        return;
      }
      if (bkObj && !bkObj.rental_paid) {
        alert("⚠️ ยังไม่ได้ชำระค่าเช่าคงเหลือ กรุณาชำระค่าเช่าให้เรียบร้อยก่อนส่งมอบรถ (สามารถกดปุ่ม \"กดจ่ายเงินค่าเช่า\" ในหน้านี้ได้ทันที)");
        this.openSettleModal(bkId);
        return;
      }
      if (bkObj && !bkObj.contract_issued) {
        alert("⚠️ สถานะรถจะเปลี่ยนเป็น \"กำลังเช่า\" ได้ก็ต่อเมื่อ \"ออกสัญญาเช่าแล้ว\" เท่านั้น ห้ามเปลี่ยนเป็นกำลังเช่าก่อนออกสัญญาเด็ดขาด กรุณาไปที่แท็บ \"4. จัดทำสัญญาเช่า\" เพื่อตรวจสอบและออกสัญญาเช่าให้เรียบร้อยก่อน");
        return;
      }
    }

    if (actionType === "complete") {
      // Route to inspection modal to ensure checklist and disposition branching (Branch A vs B)
      this.openHandoverModal(bkId, "Return");
      return;
    }

    const thNow = this.getThaiDateTime(0);
    if (isDisp && sDate && sDate < thNow.dateStr && actionType !== "handover") {
      if (!confirm(`⚠️ วันที่ส่งมอบ (${sDate}) เป็นวันย้อนหลังก่อนวันปัจจุบัน (${thNow.dateStr})\nคุณต้องการดำเนินการต่อหรือไม่?`)) {
        return;
      }
    }

    // Construct appointment_datetime from date + time
    const apptDate = isDisp ? sDate : eDate;
    const apptDatetime = (apptDate && tVal) ? `${apptDate} ${tVal}:00` : (apptDate || null);

    // TARGET MISSION 2 & 3: Decoupled API call to insert into work_order_logs
    try {
      await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_type: jobType,
          booking_id: bkId,
          staff_id: worker,
          appointment_datetime: apptDatetime,
          location: loc,
          job_status: actionType === "complete" ? "Completed" : "Pending",
          description: `ใบงาน${isDisp ? "ส่งมอบรถ (Dispatch)" : "รับรถคืน (Return)"} นัดหมาย: ${apptDatetime || '-'} สถานที่: ${loc || '-'}`
        })
      });
    } catch (woErr) {
      console.warn("[WorkOrder] Decoupled work order log creation notice:", woErr);
    }

    try {
      const res = await fetch(`/api/bookings/${bkId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_type: jobType,
          action_type: actionType === "handover" ? "handover_now" : (actionType === "complete" ? "complete_now" : "assign"),
          worker: worker,
          staff_id: worker,
          location: loc,
          time: tVal,
          start_date: sDate,
          end_date: eDate,
          appointment_datetime: apptDatetime,
          odometer: (document.getElementById(isDisp ? "assign-disp-odometer" : "assign-ret-odometer")?.value || "").trim(),
          odometer_out: isDisp ? (document.getElementById("assign-disp-odometer")?.value || "").trim() : undefined,
          odometer_in: !isDisp ? (document.getElementById("assign-ret-odometer")?.value || "").trim() : undefined,
          fuel_level: (document.getElementById(isDisp ? "assign-disp-fuel" : "assign-ret-fuel")?.value || "").trim(),
          fuel_out: isDisp ? (document.getElementById("assign-disp-fuel")?.value || "").trim() : undefined,
          fuel_in: !isDisp ? (document.getElementById("assign-ret-fuel")?.value || "").trim() : undefined,
          inspection_notes: (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim(),
          inspection_notes_out: isDisp ? (document.getElementById("assign-disp-notes")?.value || "").trim() : undefined,
          inspection_notes_in: !isDisp ? (document.getElementById("assign-ret-notes")?.value || "").trim() : undefined,
          remarks: (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim(),
          damage_notes: (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim(),
          inspection_categories: {
            petrol: Boolean(document.getElementById(isDisp ? "assign-disp-chk-petrol" : "assign-ret-chk-petrol")?.checked),
            cleanliness: Boolean(document.getElementById(isDisp ? "assign-disp-chk-cleanliness" : "assign-ret-chk-cleanliness")?.checked),
            tires: Boolean(document.getElementById(isDisp ? "assign-disp-chk-tires" : "assign-ret-chk-tires")?.checked),
            interior: Boolean(document.getElementById(isDisp ? "assign-disp-chk-interior" : "assign-ret-chk-interior")?.checked),
            underhood: Boolean(document.getElementById(isDisp ? "assign-disp-chk-underhood" : "assign-ret-chk-underhood")?.checked)
          },
          inspection_categories_out: isDisp ? {
            petrol: Boolean(document.getElementById("assign-disp-chk-petrol")?.checked),
            cleanliness: Boolean(document.getElementById("assign-disp-chk-cleanliness")?.checked),
            tires: Boolean(document.getElementById("assign-disp-chk-tires")?.checked),
            interior: Boolean(document.getElementById("assign-disp-chk-interior")?.checked),
            underhood: Boolean(document.getElementById("assign-disp-chk-underhood")?.checked)
          } : undefined,
          inspection_categories_in: !isDisp ? {
            petrol: Boolean(document.getElementById("assign-ret-chk-petrol")?.checked),
            cleanliness: Boolean(document.getElementById("assign-ret-chk-cleanliness")?.checked),
            tires: Boolean(document.getElementById("assign-ret-chk-tires")?.checked),
            interior: Boolean(document.getElementById("assign-ret-chk-interior")?.checked),
            underhood: Boolean(document.getElementById("assign-ret-chk-underhood")?.checked)
          } : undefined,
          inspection_photos: (isDisp ? (this.assignDispPhotos || []) : (this.assignRetPhotos || [])).length > 0
            ? (isDisp ? this.assignDispPhotos : this.assignRetPhotos).join(",")
            : (document.getElementById(isDisp ? "assign-disp-photos-url" : "assign-ret-photos-url")?.value || "")
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("สร้างใบงานสำเร็จ", "success");
        if (typeof Swal !== "undefined") {
          Swal.fire({
            icon: 'success',
            title: 'สร้างใบงานสำเร็จ',
            text: `บันทึกใบงาน ${isDisp ? 'ส่งมอบรถ (Dispatch)' : 'รับรถคืน (Return)'} ลงระบบเรียบร้อยแล้ว`,
            timer: 2000,
            showConfirmButton: false
          });
        }
        this.confirmedAssignSides = this.confirmedAssignSides || {};
        if (!this.confirmedAssignSides[bkId]) {
          this.confirmedAssignSides[bkId] = { Dispatch: false, Return: false };
        }
        this.confirmedAssignSides[bkId][jobType] = true;

        await this.loadBookings();
        await this.loadCars();
        await this.loadBackOfficeJobs();
        if (isDisp) this.onSelectAssignDispBooking();
        else this.onSelectAssignRetBooking();

        if (actionType === "handover") {
          this.showToast(`🎉 ส่งมอบรถ ${bkId} เรียบร้อย! เปลี่ยนสถานะเป็น "กำลังเช่า" 🚗💨`, "success");
        } else if (actionType === "complete") {
          this.showToast(`🏁 รับรถคืน ${bkId} เรียบร้อย! เปลี่ยนสถานะเป็น "เสร็จสิ้น" และปล่อยรถว่างแล้ว 🎉`, "success");
        } else {
          if (isDisp) {
            this.showToast(`✅ บันทึกนัดหมายส่งมอบรถ (${data.booking?.status || 'เตรียมส่งมอบ'}) เรียบร้อย! กำลังไปหน้าจัดทำสัญญา...`, "success");
            this.switchTab("contract");
            const selContractBk = document.getElementById("contract-sel-bk");
            if (selContractBk) {
              selContractBk.value = bkId;
              this.onSelectContractBooking();
            }
          } else {
            this.showToast(`✅ บันทึกเตรียมนัดหมายรับรถคืน (${data.booking?.status || 'เสร็จสิ้น'}) เรียบร้อย!`, "success");
          }
        }
      } else {
        throw new Error(data.detail || data.error || "บันทึกใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async printInspectionForm(jobType) {
    const isEn = (this.currentLang === "EN");
    const isDisp = jobType === "Dispatch";
    const bkId = document.getElementById(isDisp ? "assign-disp-bk" : "assign-ret-bk")?.value;
    if (!bkId) {
      alert(isEn ? "Please select a booking first." : "กรุณาเลือกรหัสการจองก่อนพิมพ์ใบตรวจสภาพรถ");
      return;
    }

    const odoVal = (document.getElementById(isDisp ? "assign-disp-odometer" : "assign-ret-odometer")?.value || "").trim();
    const fuelVal = (document.getElementById(isDisp ? "assign-disp-fuel" : "assign-ret-fuel")?.value || "").trim();
    const notesVal = (document.getElementById(isDisp ? "assign-disp-notes" : "assign-ret-notes")?.value || "").trim();
    const catsObj = {
      petrol: Boolean(document.getElementById(isDisp ? "assign-disp-chk-petrol" : "assign-ret-chk-petrol")?.checked),
      cleanliness: Boolean(document.getElementById(isDisp ? "assign-disp-chk-cleanliness" : "assign-ret-chk-cleanliness")?.checked),
      tires: Boolean(document.getElementById(isDisp ? "assign-disp-chk-tires" : "assign-ret-chk-tires")?.checked),
      interior: Boolean(document.getElementById(isDisp ? "assign-disp-chk-interior" : "assign-ret-chk-interior")?.checked),
      underhood: Boolean(document.getElementById(isDisp ? "assign-disp-chk-underhood" : "assign-ret-chk-underhood")?.checked)
    };

    const bObj = (this.bookings || []).find(x => x.booking_id === bkId) || {};
    const workerVal = document.getElementById(isDisp ? "assign-disp-worker" : "assign-ret-worker")?.value;
    const staffName = workerVal || (isDisp ? bObj.worker_delivery : bObj.worker_return) || "Staff";

    try {
      this.showToast(isEn ? "Generating Inspection PDF..." : "กำลังสร้างเอกสารใบตรวจสภาพรถ...", "info");
      const res = await fetch(`/api/bookings/${bkId}/generate-inspection-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspection_type: isDisp ? "checkout" : "checkin",
          odometer: odoVal,
          odometer_out: isDisp ? odoVal : undefined,
          odometer_in: !isDisp ? odoVal : undefined,
          fuel_level: fuelVal,
          fuel_out: isDisp ? fuelVal : undefined,
          fuel_in: !isDisp ? fuelVal : undefined,
          notes: notesVal,
          remarks: notesVal,
          damage_notes: notesVal,
          inspection_notes: notesVal,
          inspection_notes_out: isDisp ? notesVal : undefined,
          inspection_notes_in: !isDisp ? notesVal : undefined,
          inspection_categories: catsObj,
          inspection_categories_out: isDisp ? catsObj : undefined,
          inspection_categories_in: !isDisp ? catsObj : undefined,
          staff_name: staffName,
          customer_signature: bObj.customer || "Customer"
        })
      });
      const data = await res.json();
      if (data.success && data.pdf_url) {
        if (isDisp) bObj.checkout_pdf_url = data.pdf_url;
        else bObj.checkin_pdf_url = data.pdf_url;
        window.open(data.pdf_url + '?t=' + Date.now(), '_blank');
      } else {
        throw new Error(data.detail || "สร้าง PDF ไม่สำเร็จ");
      }
    } catch (e) {
      console.error(e);
      this.showToast("เกิดข้อผิดพลาดในการพิมพ์ใบตรวจสภาพ: " + e.message, "danger");
    }
  }

  // --- Tab 4: Contract Formulation & Document Center ---
  onSelectContractBooking() {
    const isEn = (this.currentLang === "EN");
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const card = document.getElementById("contract-details-card");
    const emptyMsg = document.getElementById("contract-empty-msg");
    if (!card) return;

    if (!bkId) {
      card.style.display = "none";
      if (emptyMsg) emptyMsg.style.display = (this.bookings && this.bookings.length === 0) ? "block" : "none";
      return;
    }

    const b = this.bookings.find(x => x.booking_id === bkId);
    if (!b) {
      card.style.display = "none";
      if (emptyMsg) emptyMsg.style.display = "block";
      return;
    }

    if (emptyMsg) emptyMsg.style.display = "none";
    card.style.display = "block";

    const cust = this.customers.find(c => c.full_name === b.customer) || {};
    const car = this.cars.find(c => c.plate === b.car_id) || {};

    // Financial & Status variables declared upfront to avoid ReferenceError / TDZ
    const netP = parseFloat(b.net_price || 0);
    const depAmt = parseFloat(b.deposit_amount || 5000);
    const isDep = !!b.deposit_paid;
    const isRent = !!b.rental_paid;
    const remP = isRent ? 0 : parseFloat(b.remaining_rental !== undefined ? b.remaining_rental : netP);

    // Header with badges
    const header = document.getElementById("contract-header-info");
    if (header) {
      const isIssued = !!b.contract_issued;
      header.innerHTML = `
        <div>
          <span style="font-size:18px; font-weight:800; color:#1E3A8A; letter-spacing:0.5px;">📄 ${isEn ? 'Rental Contract ID:' : 'สัญญาเช่ารหัส:'} ${b.booking_id}</span>
          <span style="margin-left:8px;" class="badge ${isIssued ? 'badge-success' : 'badge-warning'}">
            ${isIssued ? (isEn ? '✅ Contract Issued' : '✅ ออกสัญญาเรียบร้อยแล้ว') : (isEn ? '⏳ Awaiting Issuance' : '⏳ รอยืนยันออกสัญญา')}
          </span>
          <span style="margin-left:4px;" class="badge badge-info">${b.status}</span>
        </div>
        <div style="font-size:12px; color:#64748B;">
          📅 ${isEn ? 'Created:' : 'จัดทำ:'} ${b.start_date_formatted || b.start_date} | ${isEn ? 'Recorded by:' : 'ผู้บันทึก:'} ${b.created_by || 'Admin'}
        </div>
      `;
    }

    // Customer
    const custEl = document.getElementById("contract-cust-info");
    if (custEl) {
      custEl.innerHTML = `
        • <b>${isEn ? 'Tenant Name:' : 'ชื่อผู้เช่า:'}</b> ${b.customer}<br/>
        • <b>${isEn ? 'Passport / ID Card:' : 'Passport / เลขบัตร:'}</b> ${cust.passport_id || b.customer_id_card || '-'}<br/>
        • <b>${isEn ? 'Phone / Contact:' : 'เบอร์ติดต่อ:'}</b> ${b.customer_phone || cust.contact_no || '-'}<br/>
        • <b>${isEn ? 'Driving License:' : 'ใบขับขี่:'}</b> ${cust.licence_no || '-'}<br/>
        • <b>${isEn ? 'Nationality:' : 'สัญชาติ:'}</b> ${cust.nationality || 'THAI'}
      `;
    }

    // Car
    const carEl = document.getElementById("contract-car-info");
    if (carEl) {
      carEl.innerHTML = `
        • <b>${isEn ? 'License Plate:' : 'หมายเลขทะเบียน:'}</b> <b style="color:#D97706;">${b.car_id}</b><br/>
        • <b>${isEn ? 'Brand / Model:' : 'ยี่ห้อ/รุ่น:'}</b> ${car.brand || b.car_brand || ''} ${car.model || b.car_model || ''}<br/>
        • <b>${isEn ? 'Group / Color:' : 'กลุ่มรถ/สี:'}</b> ${car.car_group || '-'} / ${car.color || '-'}<br/>
        • <b>${isEn ? 'Company / Fleet:' : 'บริษัทสังกัด:'}</b> ${car.company || '-'}<br/>
        • <b>${isEn ? 'Vehicle Status:' : 'สถานะรถ:'}</b> ${car.fleet_status_desc || car.status || (isEn ? 'Ready for Service' : 'พร้อมใช้งาน')}
      `;
    }

    // Schedule (Editable Thailand Date & Time)
    const schedEl = document.getElementById("contract-sched-info");
    if (schedEl) {
      const thNow = this.getThaiDateTime(0);
      const curSDate = b.start_date || thNow.dateStr;
      const curSTime = b.start_time || thNow.timeStr;
      const curEDate = b.end_date || this.getThaiDateTime(3).dateStr;
      const curETime = b.end_time || thNow.timeStr;
      const curLoc = b.loc_delivery || (isEn ? 'Front Office / Branch' : 'หน้าร้าน / สาขา');
      const isBackdated = curSDate < thNow.dateStr;

      schedEl.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:6px;">
          <div>
            • <b>${isEn ? 'Contract Start (Pick-up Thai Time):' : 'เริ่มสัญญา (Pick-up เวลาไทย):'}</b>
            <div style="display:flex; gap:6px; margin-top:3px;">
              <input type="date" id="contract-edit-start-date" class="form-control" style="padding:4px 8px; font-size:12.5px; border-color:${isBackdated ? '#EF4444' : '#CBD5E1'};" value="${curSDate}" min="${thNow.dateStr}" onchange="app.onContractStartDateChange(this.value)">
              <input type="time" id="contract-edit-start-time" class="form-control" style="padding:4px 8px; font-size:12.5px; max-width:115px;" value="${curSTime}">
            </div>
            <div id="contract-start-date-warn" style="display:${isBackdated ? 'block' : 'none'}; color:#DC2626; font-size:11.5px; font-weight:600; margin-top:4px; background:#FEF2F2; padding:6px 10px; border-radius:6px; border:1px solid #FCA5A5;">
              ${isEn
                ? `⚠️ Backdating protection: Start date (${curSDate}) is in the past (Today is ${thNow.dateStr}). Backdated contracts are not allowed. Please select today or future date.`
                : `⚠️ ป้องกันการลงสัญญาย้อนหลัง: วันที่เริ่มสัญญา (${curSDate}) เป็นวันที่ในอดีต (วันนี้คือ ${thNow.dateStr}) ไม่อนุญาตให้บันทึกสัญญาย้อนหลัง กรุณาแก้ไขวันเริ่มสัญญาเป็นวันนี้หรือวันในอนาคต`}
            </div>
          </div>
          <div>
            • <b>${isEn ? 'Contract End (Return Thai Time):' : 'สิ้นสุดสัญญา (Return เวลาไทย):'}</b>
            <div style="display:flex; gap:6px; margin-top:3px;">
              <input type="date" id="contract-edit-end-date" class="form-control" style="padding:4px 8px; font-size:12.5px;" value="${curEDate}" min="${curSDate > thNow.dateStr ? curSDate : thNow.dateStr}">
              <input type="time" id="contract-edit-end-time" class="form-control" style="padding:4px 8px; font-size:12.5px; max-width:115px;" value="${curETime}">
            </div>
          </div>
          <div>
            • <b>${isEn ? 'Delivery Location:' : 'สถานที่ส่งมอบ:'}</b>
            <input type="text" id="contract-edit-loc" class="form-control" style="padding:4px 8px; font-size:12.5px; margin-top:3px;" value="${curLoc}">
          </div>
          <div>• <b>${isEn ? 'Assigned Staff:' : 'พนักงานส่งมอบ:'}</b> ${b.worker_delivery || (isEn ? 'Unassigned' : 'ยังไม่ได้มอบหมาย')}</div>
          <div>• <b>${isEn ? 'Current Booking Status:' : 'สถานะการจองปัจจุบัน:'}</b> <span class="badge ${b.status === 'กำลังเช่า' ? 'badge-primary' : (b.status === 'เสร็จสิ้น' ? 'badge-success' : 'badge-info')}">${b.status}</span></div>
          <div style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;">
            <button type="button" onclick="app.setContractToCurrentThaiTime()" class="btn btn-outline btn-sm" style="font-size:11.5px; padding:4px 10px;" title="${isEn ? 'Set dates to current Thai time' : 'ปรับวันและเวลาให้ตรงกับปัจจุบัน'}">
              🕒 ${isEn ? 'Use Current Time' : 'ใช้วัน-เวลาปัจจุบัน'}
            </button>
            <button type="button" onclick="app.saveContractSchedule()" class="btn btn-primary btn-sm" style="font-size:11.5px; padding:4px 10px;">
              💾 ${isEn ? 'Save Schedule' : 'บันทึกวัน-เวลาสัญญา'}
            </button>
            ${['รอส่งมอบ', 'เตรียมส่งมอบ'].includes(b.status) && b.contract_issued ? `
            <button type="button" onclick="app.quickConfirmHandover('${b.booking_id}')" class="btn btn-success btn-sm" style="font-size:11.5px; padding:4px 10px; font-weight:600;" title="${isEn ? 'Handed vehicle over to customer ➔ Update status to Renting' : 'ส่งมอบรถให้ลูกค้าแล้ว ➔ ปรับสถานะเป็น กำลังเช่า'}">
              🚚 ${isEn ? 'Handed Over (Renting) ➔' : 'ส่งมอบรถแล้ว (กำลังเช่า) ➔'}
            </button>` : ''}
            ${['กำลังเช่า', 'เตรียมรับคืน'].includes(b.status) ? `
            <button type="button" onclick="app.openExtendContract()" class="btn btn-warning btn-sm" style="font-size:11.5px; padding:4px 10px; font-weight:700; background:#f59e0b; border-color:#d97706; color:#1F2937;" title="${isEn ? 'Extend Contract Period' : 'ต่อสัญญา (Extend Contract)'}">
              📝 ${isEn ? 'Extend Contract' : 'ต่อสัญญา (Extend Contract)'}
            </button>` : ''}
          </div>
          ${!isRent ? `
            <div style="background:#FFFBEB; border:1.5px solid #FCD34D; border-radius:6px; padding:7px 10px; font-size:12px; color:#92400E; margin-top:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
              <span>⏳ <b>รอชำระค่าเช่าคงเหลือ: ฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</b></span>
              <button type="button" onclick="app.openSettleModal('${b.booking_id}')" class="btn btn-sm btn-success" style="padding:3px 10px; font-size:11.5px; font-weight:700; background:#10B981; border-color:#059669;">
                💳 ${isEn ? 'Pay Rental Balance' : 'รับชำระค่าเช่าคงเหลือ'}
              </button>
            </div>
          ` : (!b.contract_issued ? `
            <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:6px; padding:7px 10px; font-size:12px; color:#1E40AF; margin-top:8px;">
              📝 <b>ชำระค่าเช่าครบแล้ว</b> ➔ กรุณากดปุ่ม <b>"📝 ดาวน์โหลดสัญญาเช่า (PDF)"</b> เพื่อออกสัญญาและเริ่มการเช่าทันที
            </div>
          ` : `
            <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:6px; padding:7px 10px; font-size:12px; color:#166534; margin-top:8px;">
              ✅ <b>ออกสัญญาเช่าเรียบร้อยแล้ว</b> พร้อมส่งมอบรถ (กำลังเช่า)
            </div>
          `)}
        </div>
      `;
    }

    // Financial
    const netEl = document.getElementById("contract-net-price");
    if (netEl) netEl.textContent = `฿${netP.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;

    const depEl = document.getElementById("contract-dep-status");
    if (depEl) {
      let refText = b.deposit_ref ? ` (Ref: ${b.deposit_ref})` : '';
      let slipLink = b.deposit_slip ? ` <a href="${b.deposit_slip}" target="_blank" style="color:#0284C7; font-size:12px; text-decoration:underline; font-weight:700;">[📎 ${isEn ? 'View Slip' : 'ดูสลิป'}]</a>` : '';
      depEl.innerHTML = isDep 
        ? `<span style="color:#059669;">${isEn ? 'Paid' : 'ชำระแล้ว'} (฿${depAmt.toLocaleString()})${refText}${slipLink}</span>`
        : `<span style="color:#DC2626;">${isEn ? 'Pending Deposit' : 'รอมัดจำ'} (฿${depAmt.toLocaleString()})</span>`;
    }

    const remEl = document.getElementById("contract-rem-price");
    if (remEl) {
      remEl.innerHTML = isRent 
        ? `<span style="color:#059669;">฿0.00 (${isEn ? 'Fully Paid' : 'ชำระครบแล้ว'})</span>`
        : `<span style="color:#E85826;">฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
           <button type="button" onclick="app.openSettleModal('${b.booking_id}')" class="btn btn-sm btn-success" style="padding:2px 8px; font-size:11px; font-weight:700; margin-left:6px; vertical-align:middle; background:#10B981; border-color:#059669;">
             💳 ${isEn ? 'Pay Balance' : 'รับชำระค่าเช่า'}
           </button>`;
    }

    const contractInspBtn = document.getElementById("btn-contract-print-inspection");
    if (contractInspBtn) {
      contractInspBtn.href = b.checkout_pdf_url || b.checkin_pdf_url || `/api/pdf/inspection/${b.booking_id}`;
      contractInspBtn.style.display = "inline-flex";
    }
    // Extend-contract button only for rentals that are currently On Rent
    const extBtn = document.getElementById("btn-extend-contract");
    if (extBtn) extBtn.style.display = ["กำลังเช่า", "เตรียมรับคืน"].includes(b.status) ? "inline-flex" : "none";
    this.closeExtendContract();

    // Status pill
    const pill = document.getElementById("contract-issued-status-pill");
    if (pill) {
      pill.innerHTML = "";
    }
  }

  onContractStartDateChange(val) {
    const thNow = this.getThaiDateTime(0);
    const warnEl = document.getElementById("contract-start-date-warn");
    const sDateInput = document.getElementById("contract-edit-start-date");
    const eDateInput = document.getElementById("contract-edit-end-date");

    if (eDateInput && val) {
      eDateInput.min = val;
      if (eDateInput.value && eDateInput.value < val) {
        eDateInput.value = val;
      }
    }

    if (val && val < thNow.dateStr) {
      if (sDateInput) sDateInput.style.borderColor = "#EF4444";
      if (warnEl) {
        warnEl.style.display = "block";
        warnEl.innerHTML = `⚠️ ป้องกันการลงสัญญาย้อนหลัง: วันที่เริ่มสัญญา (${val}) เป็นวันที่ในอดีต (วันนี้คือ ${thNow.dateStr}) ไม่อนุญาตให้บันทึกสัญญาย้อนหลัง กรุณาแก้ไขวันเริ่มสัญญาเป็นวันนี้หรือวันในอนาคต`;
      }
    } else {
      if (sDateInput) sDateInput.style.borderColor = "#CBD5E1";
      if (warnEl) warnEl.style.display = "none";
    }
  }

  async setContractToCurrentThaiTime() {
    const thNow = this.getThaiDateTime(0);
    const sDateEl = document.getElementById("contract-edit-start-date");
    const sTimeEl = document.getElementById("contract-edit-start-time");
    const eTimeEl = document.getElementById("contract-edit-end-time");
    if (sDateEl) {
      sDateEl.value = thNow.dateStr;
      this.onContractStartDateChange(thNow.dateStr);
    }
    if (sTimeEl) sTimeEl.value = thNow.timeStr;
    if (eTimeEl) eTimeEl.value = thNow.timeStr;
    await this.saveContractSchedule();
  }

  async saveContractSchedule(silent = false) {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    if (!bkId) return;
    const sDate = document.getElementById("contract-edit-start-date")?.value;
    const sTime = document.getElementById("contract-edit-start-time")?.value;
    const eDate = document.getElementById("contract-edit-end-date")?.value;
    const eTime = document.getElementById("contract-edit-end-time")?.value;
    const loc = document.getElementById("contract-edit-loc")?.value;

    const thNow = this.getThaiDateTime(0);

    // Validation: prevent backdated contract start date
    if (sDate && sDate < thNow.dateStr) {
      alert(`⚠️ ป้องกันการลงสัญญาเช่าย้อนหลัง!\n\nไม่สามารถบันทึกวันเริ่มสัญญาเป็นวันที่ในอดีตได้ (${sDate})\nวันที่ปัจจุบันของระบบคือ: ${thNow.dateStr}\n\nกรุณาเลือกวันเริ่มสัญญาเป็นวันนี้หรือวันในอนาคต`);
      const sDateEl = document.getElementById("contract-edit-start-date");
      if (sDateEl) {
        sDateEl.value = thNow.dateStr;
        this.onContractStartDateChange(thNow.dateStr);
        sDateEl.focus();
      }
      return;
    }

    if (eDate && sDate && eDate < sDate) {
      alert(`⚠️ วันสิ้นสุดสัญญา (${eDate}) ต้องไม่เกิดขึ้นก่อนวันเริ่มสัญญา (${sDate})`);
      return;
    }

    const payload = {};
    if (sDate) payload.start_date = sDate;
    if (sTime) payload.start_time = sTime;
    if (eDate) payload.end_date = eDate;
    if (eTime) payload.end_time = eTime;
    if (loc !== undefined) payload.loc_delivery = loc;

    try {
      const res = await fetch(`/api/bookings/${bkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.detail) {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
      if (data.success) {
        if (!silent) {
          this.showToast("✅ บันทึกวัน-เวลาสัญญาเช่า (เวลาประเทศไทย) เรียบร้อย!", "success");
        }
        await this.loadBookings();
        this.onSelectContractBooking();
      }
    } catch (e) {
      if (!silent) this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
      alert(e.message);
    }
  }

  async quickConfirmHandover(bkId) {
    if (!bkId) return;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    if (!b) return;
    const carPlate = b.car_id || "";
    const custName = b.customer || "";

    if (!b.deposit_paid) {
      alert("⚠️ ยังไม่ได้ชำระเงินมัดจำ ไม่สามารถส่งมอบรถได้ (กรุณาไปที่แท็บ \"2. เงินมัดจำ & การเงิน\")");
      return;
    }
    if (!b.rental_paid) {
      alert("⚠️ ยังไม่ได้ชำระค่าเช่าคงเหลือ กรุณาชำระค่าเช่าให้เรียบร้อยก่อนส่งมอบรถ (สามารถกดปุ่ม \"รับชำระค่าเช่าคงเหลือ\" ได้ทันที)");
      this.openSettleModal(bkId);
      return;
    }
    if (!b.contract_issued) {
      alert("⚠️ สถานะรถจะเปลี่ยนเป็น \"กำลังเช่า\" ได้ก็ต่อเมื่อ \"ออกสัญญาเช่าแล้ว\" เท่านั้น ห้ามเปลี่ยนเป็นกำลังเช่าก่อนออกสัญญาเด็ดขาด กรุณาตรวจสอบเอกสารและกดยืนยันออกสัญญาด้านล่างก่อน");
      return;
    }
    
    if (!confirm(`🚚 ยืนยันการส่งมอบรถ ${carPlate} ให้คุณ ${custName} เรียบร้อยแล้ว?\n\nระบบจะปรับสถานะรายการจองเป็น "กำลังเช่า" และปรับสถานะรถเป็น "กำลังเช่า" ทันที`)) {
      return;
    }

    try {
      const res = await fetch(`/api/bookings/${bkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "กำลังเช่า" })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🎉 ส่งมอบรถ ${carPlate} สำเร็จ! สถานะเปลี่ยนเป็น "กำลังเช่า" 🚗💨`, "success");
        await this.loadBookings();
        await this.loadCars();
        if (this.activeTab === "contract") this.onSelectContractBooking();
        if (this.activeTab === "assign") {
          this.onSelectAssignDispBooking();
          this.onSelectAssignRetBooking();
        }
      } else {
        throw new Error(data.detail || "อัปเดตสถานะไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async quickConfirmReturn(bkId) {
    if (!bkId) return;
    // Strictly open Return Inspection Checklist to enforce Branch A vs Branch B disposition
    this.openHandoverModal(bkId, "Return");
  }

  async markContractIssued() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    if (!bkId) return;
    try {
      const res = await fetch(`/api/bookings/${bkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract_issued: true })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast("✅ บันทึกสถานะออกสัญญาเช่าเรียบร้อย!", "success");
        await this.loadBookings();
        this.onSelectContractBooking();
      } else {
        throw new Error(data.detail || "ไม่สามารถออกสัญญาได้");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Extend Contract (Flow 6.2) with full-payment Checkbox ---
  openExtendContract() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    const panel = document.getElementById("contract-extend-panel");
    if (!b || !panel) return;
    if (!["กำลังเช่า", "เตรียมรับคืน"].includes(b.status)) {
      alert("⚠️ ต่อสัญญาได้เฉพาะรายการที่อยู่ในสถานะ \"กำลังเช่า\" เท่านั้น");
      return;
    }
    const curEnd = String(b.end_date || "").split("T")[0];
    const dEl = document.getElementById("contract-extend-end-date");
    const tEl = document.getElementById("contract-extend-end-time");
    const cbEl = document.getElementById("contract-extend-also-rent");
    const info = document.getElementById("contract-extend-current");
    if (info) info.textContent = `สัญญาเดิมสิ้นสุด: ${b.end_date_formatted || curEnd} (${b.end_time || "10:00"} น.)`;
    if (dEl) {
      const d = new Date(`${curEnd}T00:00:00`);
      d.setDate(d.getDate() + 1);
      const nextDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      dEl.min = nextDay;
      dEl.value = nextDay;
    }
    if (tEl) tEl.value = b.end_time || "10:00";
    if (cbEl) cbEl.checked = true;
    panel.style.display = "block";
    this.onExtendDateChange();
  }

  closeExtendContract() {
    const panel = document.getElementById("contract-extend-panel");
    if (panel) panel.style.display = "none";
  }

  async onExtendDateChange() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const newEnd = document.getElementById("contract-extend-end-date")?.value;
    const prev = document.getElementById("contract-extend-preview");
    const btn = document.getElementById("btn-submit-extend");
    if (!prev || !bkId || !newEnd) return;
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bkId)}/extend-check?new_end_date=${encodeURIComponent(newEnd)}`);
      const data = await res.json();
      if (data.ok) {
        prev.innerHTML = `<span style="color:#15803D; font-weight:700;">✅ คิวว่าง ต่อสัญญาได้</span> · เพิ่ม ${data.extra_days} วัน · ค่าเช่าเพิ่ม ฿${Number(data.extra_price).toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
        if (btn) btn.disabled = false;
      } else {
        prev.innerHTML = `<span style="color:#DC2626; font-weight:700;">⛔ ${data.message || "ไม่สามารถต่อสัญญาได้"}</span>`;
        if (btn) btn.disabled = true;
      }
    } catch (e) {
      prev.textContent = "ไม่สามารถตรวจสอบคิวได้: " + e.message;
    }
  }

  async submitExtendContract() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    const newEnd = document.getElementById("contract-extend-end-date")?.value;
    const newTime = document.getElementById("contract-extend-end-time")?.value;
    const alsoRent = Boolean(document.getElementById("contract-extend-also-rent")?.checked);
    const payMethod = document.getElementById("contract-extend-method")?.value || "โอนเงิน / สแกน QR";
    if (!bkId || !newEnd) {
      alert("กรุณาระบุวันที่ต่อสัญญาใหม่");
      return;
    }
    const bObj = this.bookings.find(x => x.booking_id === bkId) || {};
    const conflict = this.findBookingConflict(
      bObj.car_id,
      String(bObj.end_date || "").split("T")[0],
      newEnd,
      bkId
    );
    if (conflict) {
      alert(`⚠️ ไม่สามารถต่อสัญญาได้: ติดจองคิวอื่นในวันที่จะต่อ\n\nรหัสจอง: ${conflict.booking_id}\nลูกค้า: ${conflict.customer}\nช่วงวันที่: ${conflict.start_date_formatted || conflict.start_date} - ${conflict.end_date_formatted || conflict.end_date}`);
      return;
    }
    const payNote = alsoRent ? `พร้อมรับชำระค่าเช่าเต็มจำนวน (${payMethod})` : "โดยรอรับชำระค่าเช่าภายหลัง";
    if (!confirm(`ยืนยันต่อสัญญา ${bkId} ถึงวันที่ ${newEnd} ${payNote} และออกสัญญาเช่าใหม่?`)) return;
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bkId)}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_end_date: newEnd,
          new_end_time: newTime,
          also_pay_rental: alsoRent,
          payment_method: payMethod
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.error || "ต่อสัญญาไม่สำเร็จ");
      }
      this.closeExtendContract();
      this.showToast(`🔁 ต่อสัญญา ${bkId} ถึง ${newEnd} เรียบร้อย (+${data.extra_days} วัน ฿${Number(data.extra_price).toLocaleString("th-TH")}) — บันทึกสัญญาใหม่เป็น PDF`, "success");
      await this.loadBookings();
      await this.loadCars();
      this.onSelectContractBooking();
      if (data.pdf_url) window.open(`${data.pdf_url}&t=${Date.now()}`, "_blank");
      if (alsoRent) {
        alert(`✅ ต่อสัญญาและรับชำระค่าเช่าเต็มจำนวน (฿${Number(data.extra_price).toLocaleString("th-TH")}) เรียบร้อยแล้ว`);
      } else {
        alert("✅ ออกสัญญาเช่าใหม่เรียบร้อย (ไฟล์ PDF ถูกดาวน์โหลดแล้ว)\nกรุณาชำระค่าเช่าส่วนที่ต่อที่หน้า \"ชำระเงิน\"");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  goToDepositFromContract() {
    const bkId = document.getElementById("contract-sel-bk")?.value;
    this.switchTab("deposit");
    if (bkId) {
      const depSel = document.getElementById("deposit-sel-booking");
      if (depSel) {
        depSel.value = bkId;
        this.onSelectDepositBooking();
      }
    }
  }

  // --- Document Center & PDF Download Handlers ---
  async downloadContractPdf(bkId) {
    const selBk = document.getElementById("contract-sel-bk")?.value;
    const id = bkId || selBk || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดสัญญาเช่า", "warning");
      return;
    }
    if (selBk && id === selBk && document.getElementById("contract-edit-start-time")) {
      await this.saveContractSchedule(true);
    }
    const pdfUrl = `/api/pdf/contract/${encodeURIComponent(id)}`;
    this.showToast(`📝 กำลังดาวน์โหลดสัญญาเช่า PDF สำหรับ ${id}...`, "info");
    window.open(`${pdfUrl}?t=${Date.now()}`, "_blank");

    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_issued: true,
          contract_pdf_url: pdfUrl,
          status: "กำลังเช่า",
          dispatch_closed: true
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🎉 ออกสัญญาและส่งมอบรถ ${id} เรียบร้อย! เปลี่ยนสถานะเป็น "กำลังเช่า" 🚗💨`, "success");
        await this.loadBookings();
        await this.loadCars();
        await this.loadBackOfficeJobs();
        this.onSelectContractBooking();
      } else if (data.detail) {
        console.warn("Handover on contract download:", data.detail);
      }
    } catch (e) {
      console.error("Contract handover auto-trigger error:", e);
    }
  }

  downloadDepositReceipt(bkId) {
    const id = bkId || document.getElementById("contract-sel-bk")?.value || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดใบเสร็จมัดจำ", "warning");
      return;
    }
    this.showToast(`🧾 กำลังดาวน์โหลดใบเสร็จรับเงินมัดจำ PDF สำหรับ ${id}...`, "info");
    window.open(`/api/pdf/deposit-receipt/${encodeURIComponent(id)}?t=${Date.now()}`, "_blank");
  }

  downloadRentalReceipt(bkId) {
    const id = bkId || document.getElementById("contract-sel-bk")?.value || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดใบเสร็จค่าเช่า", "warning");
      return;
    }
    this.showToast(`🧾 กำลังดาวน์โหลดใบเสร็จรับเงินค่าเช่า PDF สำหรับ ${id}...`, "info");
    window.open(`/api/pdf/receipt/${encodeURIComponent(id)}?t=${Date.now()}`, "_blank");
  }

  downloadJobPdf(bkId) {
    const id = bkId || document.getElementById("contract-sel-bk")?.value || document.getElementById("deposit-sel-booking")?.value || this.currentSelectedBooking?.booking_id;
    if (!id) {
      this.showToast("⚠️ กรุณาเลือกรายการจองก่อนดาวน์โหลดใบตรวจสภาพรถ", "warning");
      return;
    }
    this.showToast(`📋 กำลังดาวน์โหลดใบตรวจสภาพรถ PDF สำหรับ ${id}...`, "info");
    window.open(`/api/pdf/job/${encodeURIComponent(id)}?t=${Date.now()}`, "_blank");
  }

  // --- Tab 5: Bookings Table ---
  renderBookingsTable() {
    const tbody = document.getElementById("bookings-table-body");
    if (!tbody) return;

    const kw = (document.getElementById("bks-search-input")?.value || "").toLowerCase().trim();
    const isEn = (this.currentLang === "EN");
    const stFilter = document.getElementById("bks-status-filter")?.value || "ทั้งหมด";

    const filtered = this.bookings.filter(b => {
      if (stFilter !== "ทั้งหมด" && stFilter !== "All" && b.status !== stFilter) return false;
      if (kw) {
        const s = `${b.booking_id} ${b.car_id} ${b.customer} ${b.status}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#64748B;">${isEn ? 'No bookings found' : 'ไม่พบรายการจอง'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(b => {
      const isDep = b.deposit_paid;
      const isRent = b.rental_paid;
      const netP = parseFloat(b.net_price || 0);

      let depBadge = isDep 
        ? `<span class="badge badge-success">${isEn ? 'Deposit Paid' : 'มัดจำแล้ว'}</span>` 
        : `<span class="badge badge-warning">${isEn ? 'Pending Deposit' : 'รอมัดจำ'}</span>`;
      let rentBadge = isRent 
        ? `<span class="badge badge-success">${isEn ? 'Fully Paid' : 'จ่ายครบ'}</span>` 
        : `<span class="badge badge-danger">${isEn ? 'Unpaid' : 'ค้างชำระ'}</span>`;

      return `
        <tr>
          <td>
            <b style="color:#D97706;">${b.booking_id}</b>
          </td>
          <td>
            <b>${b.car_id}</b><br/>
            <span style="font-size:11px; color:#64748B;">${b.car_brand || ''} ${b.car_model || ''}</span>
          </td>
          <td>
            <b>${b.customer}</b><br/>
            <span style="font-size:11px; color:#64748B;">📞 ${b.customer_phone || '-'}</span>
          </td>
          <td style="font-size:12px;">
            ${b.start_date_formatted} (${b.start_time || '10:00'})<br/>
            ${isEn ? 'to' : 'ถึง'} ${b.end_date_formatted} (${b.end_time || '10:00'})
          </td>
          <td style="font-weight:700; color:#1E293B;">
            ฿${netP.toLocaleString()}
          </td>
          <td>
            ${depBadge} ${rentBadge}
            ${b.deposit_ref ? `<div style="font-size:10.5px; color:#475569; margin-top:3px;">Ref: <code style="background:#FEF3C7; color:#92400E; padding:1px 4px; border-radius:3px;">${b.deposit_ref}</code></div>` : ''}
          </td>
          <td>
            <div style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
              <span class="badge ${
                b.status === 'กำลังเช่า' ? 'badge-primary' : 
                (b.status === 'เสร็จสิ้น' ? 'badge-success' : 
                (b.status === 'ยกเลิก' ? 'badge-danger' : 
                (b.status === 'เตรียมส่งมอบ' ? 'badge-warning' : 'badge-info')))
              }">${b.status}</span>
              ${['รอส่งมอบ', 'เตรียมส่งมอบ'].includes(b.status) ? (
                b.contract_issued ? `
                  <button type="button" onclick="app.quickConfirmHandover('${b.booking_id}')" class="btn btn-sm btn-success" style="font-size:11px; padding:2px 8px; white-space:nowrap; border-radius:4px; font-weight:600;" title="${isEn ? 'Handed vehicle over ➔ Update status to Renting' : 'ส่งมอบรถแล้ว ➔ ปรับสถานะเป็น กำลังเช่า'}">
                    🚚 ${isEn ? 'Handed Over' : 'ส่งมอบรถแล้ว'}
                  </button>
                ` : `
                  <button type="button" onclick="app.goToTabWithBooking('contract', '${b.booking_id}')" class="btn btn-sm btn-secondary" style="font-size:10.5px; padding:2px 6px; white-space:nowrap; border-radius:4px; font-weight:600; background:#EFF6FF; border-color:#BFDBFE; color:#1E40AF;" title="${isEn ? 'Issue contract in Tab 4 first' : 'ต้องออกสัญญาเช่าในแท็บ 4 ก่อนส่งมอบรถ'}">
                    📝 ${isEn ? 'Issue Contract' : 'รอออกสัญญา'}
                  </button>
                `
              ) : ''}
              ${['กำลังเช่า', 'เตรียมรับคืน'].includes(b.status) ? `
                <button type="button" onclick="app.openHandoverModal('${b.booking_id}', 'Return')" class="btn btn-sm btn-warning" style="font-size:11px; padding:2px 8px; white-space:nowrap; color:#1E293B; border-radius:4px; font-weight:600;" title="${isEn ? 'Customer returned vehicle ➔ Inspection & Return Checklist' : 'ลูกค้านำรถมาคืน ➔ ตรวจสภาพตาม Checklist และรับรถคืน'}">
                  🏁 ${isEn ? 'Return & Inspect' : 'ตรวจรับรถคืน'}
                </button>
              ` : ''}
            </div>
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${(b.deposit_slip || b.rental_slip) ? `
              <a href="${b.deposit_slip || b.rental_slip}" target="_blank" class="btn btn-sm btn-secondary" style="background:#EFF6FF; border-color:#93C5FD; color:#1D4ED8; font-weight:700;" title="${isEn ? 'View Payment Slip' : 'ดูสลิปหลักฐานการชำระเงิน'} (Ref: ${b.deposit_ref || b.rental_ref || '-'})">📎 ${isEn ? 'Slip' : 'สลิป'}</a>
            ` : ''}
            <a href="${b.contract_pdf_url || `/api/pdf/contract/${b.booking_id}`}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Rental Agreement PDF' : 'สัญญาเช่า (Rental Agreement PDF)'}">📝</a>
            <a href="/api/pdf/deposit-receipt/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Deposit Receipt PDF' : 'ใบเสร็จมัดจำ (Deposit Receipt PDF)'}">🛡️</a>
            <a href="/api/pdf/receipt/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Rental Receipt PDF' : 'ใบเสร็จค่าเช่า (Rental Receipt PDF)'}">🧾</a>
            <a href="${b.checkout_pdf_url || b.checkin_pdf_url || `/api/pdf/job/${b.booking_id}`}" target="_blank" class="btn btn-sm btn-secondary" style="${(b.checkout_pdf_url || b.checkin_pdf_url) ? 'background:#EFF6FF; border-color:#93C5FD; color:#1D4ED8; font-weight:700;' : ''}" title="${isEn ? 'Inspection Checklist PDF' : 'ใบตรวจสภาพรถ (Checklist PDF)'}">📋</a>
            ${(b.checkout_pdf_url || b.checkin_pdf_url) ? `
              <a href="${b.checkout_pdf_url || b.checkin_pdf_url}" target="_blank" class="btn btn-sm" style="font-size:11px; padding:2px 6px; font-weight:700; white-space:nowrap; text-decoration:none; border-radius:4px; color:#2563EB; border:1px solid #93C5FD; background:#F8FAFC;" title="${isEn ? 'Print Inspection PDF' : 'พิมพ์ใบตรวจสภาพรถ (Print Inspection PDF)'}">🖨️ ${isEn ? 'Inspection' : 'ใบตรวจสภาพ'}</a>
            ` : ''}
            <button onclick="app.deleteBooking('${b.booking_id}')" class="btn btn-sm btn-danger" title="${isEn ? 'Delete Booking' : 'ลบรายการจอง'}">🗑️</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async deleteBooking(bkId) {
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบรายการจอง ${bkId}?`)) return;
    try {
      const res = await fetch(`/api/bookings/${bkId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        this.showToast(`ลบรายการจอง ${bkId} เรียบร้อย`, "success");
        await this.loadBookings();
        await this.loadCars();
      }
    } catch (e) {
      this.showToast("ลบไม่สำเร็จ: " + e.message, "danger");
    }
  }

  // --- Back Office Calendar & Rendering ---
  populateBackofficeStaffFilter() {
    const sel = document.getElementById("bo-staff-filter");
    if (!sel) return;
    const currentVal = sel.value || this.boStaffFilter || "";
    const isEn = (this.currentLang === "EN");
    const staffSet = new Set();
    (this.backofficeJobs || []).forEach(j => {
      const w = String(j.worker || "").trim();
      if (w && w !== "-" && w !== "ยังไม่มอบหมาย") {
        staffSet.add(w);
      }
    });
    let html = `<option value="">${isEn ? 'All Staff (ทุกคน)' : 'ทุกคน (All Staff)'}</option>`;
    Array.from(staffSet).sort().forEach(st => {
      html += `<option value="${st}">${st}</option>`;
    });
    sel.innerHTML = html;
    if (currentVal) sel.value = currentVal;
  }

  onBackofficeStaffFilterChange(staff) {
    this.boStaffFilter = staff || "";
    this.renderBackofficeCalendar();
    this.renderBackOfficeJobs();
  }

  setBackofficeViewMode(mode) {
    this.boViewMode = mode;
    const calWrap = document.getElementById("bo-calendar-wrapper");
    const tblWrap = document.getElementById("bo-full-table-card");
    const btnCal = document.getElementById("btn-bo-view-calendar");
    const btnTbl = document.getElementById("btn-bo-view-table");

    if (mode === "calendar") {
      if (calWrap) calWrap.style.display = "block";
      if (tblWrap) tblWrap.style.display = "none";
      if (btnCal) {
        btnCal.className = "btn btn-sm btn-primary";
        btnCal.style.cssText = "font-size:12px; padding:4px 12px; font-weight:700;";
      }
      if (btnTbl) {
        btnTbl.className = "btn btn-sm btn-secondary";
        btnTbl.style.cssText = "font-size:12px; padding:4px 12px;";
      }
      setTimeout(() => {
        if (this.boCalendar) {
          this.boCalendar.updateSize();
        } else {
          this.renderBackofficeCalendar();
        }
      }, 80);
    } else {
      if (calWrap) calWrap.style.display = "none";
      if (tblWrap) tblWrap.style.display = "block";
      if (btnCal) {
        btnCal.className = "btn btn-sm btn-secondary";
        btnCal.style.cssText = "font-size:12px; padding:4px 12px;";
      }
      if (btnTbl) {
        btnTbl.className = "btn btn-sm btn-primary";
        btnTbl.style.cssText = "font-size:12px; padding:4px 12px; font-weight:700;";
      }
      this.renderBackOfficeJobs();
    }
  }

  renderBackofficeCalendar() {
    const calendarEl = document.getElementById("backoffice-calendar");
    if (!calendarEl) return;
    if (typeof FullCalendar === "undefined") {
      console.warn("FullCalendar is not loaded yet");
      return;
    }

    const isEn = (this.currentLang === "EN");
    const staffFilter = (document.getElementById("bo-staff-filter")?.value || this.boStaffFilter || "").trim();

    const jobs = (this.backofficeJobs || []).filter(j => {
      if (staffFilter && String(j.worker || "").trim() !== staffFilter) {
        return false;
      }
      return true;
    });

    const events = jobs.map(j => {
      const isDisp = j.job_type === "Dispatch";
      const isMnt = j.is_maintenance || j.job_type === "Maintenance" || j.job_type === "Renewal";
      
      let title = "";
      let color = "#2563EB";
      let startStr = j.date_iso;

      if (isMnt) {
        title = `[🛠️ ${isEn ? 'Maint' : 'ซ่อม'}] ${j.car_id || ''} (${j.booking_id})`;
        color = "#EA580C"; // Orange for maintenance/renewal
        startStr = j.start_date || j.date_iso;
      } else if (isDisp) {
        title = `[🚚 ${isEn ? 'Dispatch' : 'ส่ง'}] ${j.car_id || ''} - ${j.customer || ''} (${j.booking_id})`;
        color = "#2563EB"; // Blue for dispatch
        if (j.start_date && j.start_time) {
          startStr = `${j.start_date}T${j.start_time}`;
        } else if (j.start_date) {
          startStr = j.start_date;
        }
      } else {
        title = `[🔙 ${isEn ? 'Return' : 'รับคืน'}] ${j.car_id || ''} - ${j.customer || ''} (${j.booking_id})`;
        color = "#16A34A"; // Green for return
        if (j.end_date && j.end_time) {
          startStr = `${j.end_date}T${j.end_time}`;
        } else if (j.end_date) {
          startStr = j.end_date;
        }
      }

      return {
        id: `${j.job_type}_${j.booking_id}`,
        title: title,
        start: startStr,
        backgroundColor: color,
        borderColor: color,
        textColor: "#FFFFFF",
        extendedProps: j
      };
    });

    if (this.boCalendar) {
      this.boCalendar.removeAllEvents();
      this.boCalendar.addEventSource(events);
      this.boCalendar.setOption('locale', isEn ? 'en' : 'th');
      this.boCalendar.updateSize();
      return;
    }

    this.boCalendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      navLinks: true,
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listMonth'
      },
      locale: isEn ? 'en' : 'th',
      buttonText: isEn ? {
        today: 'Today',
        month: 'Month',
        week: 'Week',
        list: 'List'
      } : {
        today: 'วันนี้',
        month: 'ปฏิทิน',
        week: 'สัปดาห์',
        list: 'รายการ'
      },
      events: events,
      eventTimeFormat: {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      },
      displayEventTime: true,
      dayMaxEvents: 3,
      navLinkDayClick: (date, jsEvent) => {
        if (jsEvent && jsEvent.preventDefault) jsEvent.preventDefault();
        const dStr = typeof date === "string" ? date : (date.toISOString ? date.toISOString().split("T")[0] : String(date));
        if (this.boCalendar) {
          try {
            this.boCalendar.changeView('timeGridWeek', date);
          } catch(e) {
            try {
              this.boCalendar.changeView('listWeek', date);
            } catch(e2) {
              this.boCalendar.gotoDate(date);
            }
          }
        }
        this.onCalendarDateClick(dStr);
      },
      dateClick: (info) => {
        const dStr = info.dateStr || (info.date && info.date.toISOString ? info.date.toISOString().split("T")[0] : "");
        const targetDate = info.date || dStr;
        if (this.boCalendar && this.boCalendar.view && this.boCalendar.view.type === 'dayGridMonth') {
          try {
            this.boCalendar.changeView('timeGridWeek', targetDate);
          } catch(e) {
            try {
              this.boCalendar.changeView('listWeek', targetDate);
            } catch(e2) {
              this.boCalendar.gotoDate(targetDate);
            }
          }
        }
        this.onCalendarDateClick(dStr);
      },
      eventClick: (info) => {
        this.onCalendarEventClick(info.event);
      }
    });

    this.boCalendar.render();
  }

  onCalendarDateClick(dateStr) {
    const dayCard = document.getElementById("bo-day-jobs-card");
    const dayTbody = document.getElementById("bo-day-jobs-tbody");
    const dayTitle = document.getElementById("bo-day-jobs-title");
    if (!dayCard || !dayTbody) return;

    const isEn = (this.currentLang === "EN");
    const matched = (this.backofficeJobs || []).filter(j => {
      const d1 = j.date_iso;
      const d2 = j.start_date;
      const d3 = j.end_date;
      return d1 === dateStr || d2 === dateStr || d3 === dateStr;
    });

    if (dayTitle) {
      dayTitle.textContent = isEn
        ? `📋 Work Orders for ${dateStr} (${matched.length} jobs)`
        : `📋 ตารางงานประจำวันที่ ${dateStr} (${matched.length} รายการ)`;
    }

    if (matched.length === 0) {
      dayTbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:#64748B;">${isEn ? 'No work orders scheduled on this date' : 'ไม่มีงานที่นัดหมายในวันนี้'}</td></tr>`;
    } else {
      dayTbody.innerHTML = matched.map(j => this.renderSingleBackofficeJobRow(j, isEn)).join("");
    }

    dayCard.style.display = "block";
    dayCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  onCalendarEventClick(calEvent) {
    const j = calEvent.extendedProps;
    if (!j) return;
    const isEn = (this.currentLang === "EN");

    const dayCard = document.getElementById("bo-day-jobs-card");
    const dayTbody = document.getElementById("bo-day-jobs-tbody");
    const dayTitle = document.getElementById("bo-day-jobs-title");
    if (dayCard && dayTbody) {
      if (dayTitle) {
        dayTitle.textContent = isEn
          ? `📋 Work Order: ${j.booking_id} (${j.job_type})`
          : `📋 รายละเอียดใบงาน: ${j.booking_id} (${j.job_type})`;
      }
      dayTbody.innerHTML = this.renderSingleBackofficeJobRow(j, isEn);
      dayCard.style.display = "block";
      dayCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    if (j.is_maintenance || j.job_type === "Maintenance" || j.job_type === "Renewal") {
      this.openCloseMaintenanceModal(j.booking_id);
    } else {
      this.openHandoverModal(j.booking_id, j.job_type);
    }
  }

  renderSingleBackofficeJobRow(j, isEn) {
    const isDisp = j.job_type === "Dispatch";
    const isMnt = j.is_maintenance || j.job_type === "Maintenance" || j.job_type === "Renewal";
    let typeBadge = '';
    if (j.job_type === "Maintenance") {
      typeBadge = `<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-weight:700;">${isEn ? 'Maintenance' : 'ซ่อมบำรุง'}</span>`;
    } else if (j.job_type === "Renewal") {
      typeBadge = `<span class="badge" style="background:#F0FDF4; color:#15803D; border:1px solid #BBF7D0; font-weight:700;">${isEn ? 'Renewal' : 'ต่อทะเบียน/พรบ./ประกัน'}</span>`;
    } else if (isDisp) {
      typeBadge = `<span class="badge badge-info">${isEn ? 'Dispatch' : 'ส่งมอบรถ (Dispatch)'}</span>`;
    } else {
      typeBadge = `<span class="badge badge-warning">${isEn ? 'Return' : 'รับรถคืน (Return)'}</span>`;
    }

    let actionButtons = '';
    if (isMnt) {
      const isRenewalJob = j.job_type === "Renewal" || (j.order_type && (String(j.order_type).includes("ต่อทะเบียน") || String(j.order_type).includes("ประกัน") || String(j.order_type).includes("พ.ร.บ.") || String(j.order_type).includes("ภาษี") || String(j.order_type).includes("แพ็กคู่")));
      const btnLabel = isRenewalJob ? (isEn ? "Submit / Update" : "ส่งงาน / อัปเดตวัน") : (isEn ? "Inspect & Close" : "ตรวจรับ & ปิดงาน");
      actionButtons = `
        <a href="/api/pdf/maintenance/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Print Job PDF' : 'พิมพ์ใบงาน PDF'}">${isEn ? 'Job PDF' : 'ใบงาน PDF'}</a>
        <button onclick="app.openCloseMaintenanceModal('${j.booking_id}')" class="btn btn-sm btn-success" style="font-weight:700;" title="${btnLabel}">
          ${btnLabel}
        </button>
      `;
    } else {
      const lockTitle = isEn ? 'Wait for Dispatch completion' : 'ต้องปิดงานส่งมอบก่อน';
      const inspectBtnLabel = isEn ? 'Inspect & Complete' : 'ตรวจรับส่ง & ปิดงาน';
      actionButtons = `
        <a href="/api/pdf/job/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Inspection PDF' : 'ใบตรวจสภาพ PDF'}">PDF</a>
        <button onclick="app.openHandoverModal('${j.booking_id}', '${j.job_type}')" class="btn btn-sm btn-primary" ${j.is_locked ? `disabled title="${lockTitle}"` : ''}>
          ${inspectBtnLabel}
        </button>
      `;
    }

    let statusBadge = '';
    if (j.status === "กำลังซ่อมบำรุง") {
      statusBadge = `<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74;">${isEn ? '🛠️ In Maintenance' : '🛠️ กำลังซ่อมบำรุง'}</span>`;
    } else if (j.status === "กำลังต่อภาษี/ประกัน") {
      statusBadge = `<span class="badge" style="background:#FEF3C7; color:#D97706; border:1px solid #FCD34D;">${isEn ? '⏳ Renewing Tax/Ins.' : '⏳ กำลังต่อภาษี/ประกัน'}</span>`;
    } else {
      let displayStatus = j.status;
      if (isEn) {
        if (displayStatus === "รอส่งมอบ") displayStatus = "Ready for Dispatch";
        else if (displayStatus === "กำลังเช่า") displayStatus = "Active Rental";
        else if (displayStatus === "รอรับคืน") displayStatus = "Ready for Return";
        else if (displayStatus === "🔒 รอส่งรถก่อน") displayStatus = "🔒 Wait for Dispatch";
        else if (displayStatus === "รอชำระมัดจำ") displayStatus = "Pending Deposit";
      }
      statusBadge = `<span class="badge badge-gray">${displayStatus}</span>`;
    }

    return `
      <tr>
        <td>${typeBadge}</td>
        <td><b style="color:#D97706;">${j.booking_id}</b></td>
        <td><b>${j.car_id}</b></td>
        <td>
          <b>${j.customer}</b><br/>
          ${j.customer_phone && j.customer_phone !== '-' ? `<a href="tel:${j.customer_phone}" style="color:#2563EB; font-size:11.5px; text-decoration:none;">📞 ${j.customer_phone}</a>` : ''}
        </td>
        <td style="font-size:12px;">${j.schedule}</td>
        <td><span style="font-weight:600; color:#334155;">${j.worker}</span></td>
        <td style="max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${j.location}">
          ${j.location.startsWith("http") ? `<a href="${j.location}" target="_blank" style="color:#2563EB;">📍 แผนที่นัดหมาย</a>` : j.location}
        </td>
        <td>${statusBadge}</td>
        <td style="text-align:center; white-space:nowrap;">
          ${actionButtons}
        </td>
      </tr>
    `;
  }

  renderBackOfficeJobs() {
    const tbody = document.getElementById("backoffice-jobs-tbody");
    if (!tbody) return;

    const boKw = (document.getElementById("bo-search-input")?.value || "").toLowerCase().trim();
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();
    const kw = boKw || sbKw;
    const staffFilter = (document.getElementById("bo-staff-filter")?.value || this.boStaffFilter || "").trim();

    const filtered = (this.backofficeJobs || []).filter(j => {
      if (staffFilter && String(j.worker || "").trim() !== staffFilter) {
        return false;
      }
      if (kw) {
        const s = `${j.booking_id} ${j.car_id} ${j.customer} ${j.job_type} ${j.worker || ''} ${j.location || ''}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    const isEn = (this.currentLang === "EN");
    if (filtered.length === 0) {
      const emptyMsg = isEn ? "No work orders in the system currently" : "ไม่มีใบงานในระบบขณะนี้";
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748B;">${emptyMsg}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(j => this.renderSingleBackofficeJobRow(j, isEn)).join("");
  }

  // --- Modal: Handover Inspection ---
  // --- Interactive Car Diagram Defect Marker ---
  initDamageCanvas() {
    const canvas = document.getElementById("insp-car-diagram-canvas");
    if (!canvas) return;
    this.damageMarks = this.damageMarks || [];
    this.currentDamageTool = this.currentDamageTool || "dent";
    this.redrawDamageCanvas();
    this.setDamageTool(this.currentDamageTool);

    if (!canvas._hasDamageHandler) {
      canvas._hasDamageHandler = true;
      const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
          x: (clientX - rect.left) * scaleX,
          y: (clientY - rect.top) * scaleY
        };
      };
      const addMark = (e) => {
        e.preventDefault();
        const pos = getPos(e);
        this.damageMarks.push({
          x: pos.x,
          y: pos.y,
          type: this.currentDamageTool
        });
        this.redrawDamageCanvas();
      };
      canvas.addEventListener("click", addMark);
    }
  }

  setDamageTool(tool) {
    this.currentDamageTool = tool;
    const btnDent = document.getElementById("btn-tool-dent");
    const btnScratch = document.getElementById("btn-tool-scratch");
    if (btnDent && btnScratch) {
      if (tool === "dent") {
        btnDent.style.boxShadow = "0 0 0 2px #DC2626";
        btnDent.style.borderColor = "#DC2626";
        btnScratch.style.boxShadow = "none";
        btnScratch.style.borderColor = "#93C5FD";
      } else {
        btnScratch.style.boxShadow = "0 0 0 2px #2563EB";
        btnScratch.style.borderColor = "#2563EB";
        btnDent.style.boxShadow = "none";
        btnDent.style.borderColor = "#FCA5A5";
      }
    }
  }

  clearDamageCanvas() {
    this.damageMarks = [];
    this.redrawDamageCanvas();
  }

  redrawDamageCanvas() {
    const canvas = document.getElementById("insp-car-diagram-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#FAFAFA";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#CBD5E1";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#475569";
    ctx.font = "bold 10px Sarabun, sans-serif";
    ctx.textAlign = "center";

    // 1. FRONT
    ctx.fillText("FRONT", 65, 20);
    ctx.strokeStyle = "#64748B";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(30, 26, 70, 50);
    ctx.strokeRect(36, 30, 16, 12);
    ctx.strokeRect(78, 30, 16, 12);
    ctx.strokeRect(45, 60, 40, 10);

    // 2. REAR
    ctx.fillText("REAR", 65, 115);
    ctx.strokeRect(30, 122, 70, 50);
    ctx.strokeRect(36, 126, 16, 12);
    ctx.strokeRect(78, 126, 16, 12);
    ctx.strokeRect(48, 142, 34, 14);

    // 3. TOP VIEW
    ctx.fillText("TOP VIEW", 240, 18);
    ctx.strokeRect(205, 24, 70, 160);
    ctx.strokeRect(213, 50, 54, 25);
    ctx.strokeRect(213, 85, 54, 45);
    ctx.strokeRect(213, 138, 54, 25);

    // 4. LEFT
    ctx.fillText("LEFT SIDE", 400, 20);
    ctx.strokeRect(335, 28, 130, 48);
    ctx.beginPath(); ctx.arc(360, 78, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(440, 78, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(365, 34, 32, 20);
    ctx.strokeRect(402, 34, 32, 20);

    // 5. RIGHT
    ctx.fillText("RIGHT SIDE", 400, 115);
    ctx.strokeRect(335, 122, 130, 48);
    ctx.beginPath(); ctx.arc(360, 172, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(440, 172, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(365, 128, 32, 20);
    ctx.strokeRect(402, 128, 32, 20);

    (this.damageMarks || []).forEach(m => {
      ctx.beginPath();
      if (m.type === "dent") {
        ctx.fillStyle = "#DC2626";
        ctx.font = "bold 15px Arial, sans-serif";
        ctx.fillText("X", m.x, m.y + 5);
        ctx.strokeStyle = "rgba(220, 38, 38, 0.4)";
        ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = "#2563EB";
        ctx.font = "bold 15px Arial, sans-serif";
        ctx.fillText("D", m.x, m.y + 5);
        ctx.strokeStyle = "rgba(37, 99, 235, 0.4)";
        ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  getCarDiagramBase64() {
    const canvas = document.getElementById("insp-car-diagram-canvas");
    if (!canvas) return null;
    return canvas.toDataURL("image/png");
  }

  openHandoverModal(bkId, jobType) {
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    if (jobType === "Dispatch") {
      if (b && !b.deposit_paid) {
        alert("⚠️ ยังไม่ได้ชำระเงินมัดจำ ไม่สามารถส่งมอบรถได้ (กรุณาไปที่แท็บ \"2. เงินมัดจำ & การเงิน\")");
        return;
      }
      if (b && !b.rental_paid) {
        alert("⚠️ ยังไม่ได้ชำระค่าเช่าคงเหลือ กรุณาชำระค่าเช่าให้เรียบร้อยก่อนส่งมอบรถ");
        this.openSettleModal(bkId);
        return;
      }
      if (b && !b.contract_issued) {
        alert("⚠️ สถานะรถจะเปลี่ยนเป็น \"กำลังเช่า\" ได้ก็ต่อเมื่อ \"ออกสัญญาเช่าแล้ว\" เท่านั้น ห้ามเปลี่ยนเป็นกำลังเช่าก่อนออกสัญญาเด็ดขาด กรุณาไปที่แท็บ \"4. จัดทำสัญญาเช่า\" เพื่อตรวจสอบและออกสัญญาเช่าให้เรียบร้อยก่อน");
        return;
      }
    }

    document.getElementById("insp-bk-id").value = bkId;
    document.getElementById("insp-job-type").value = jobType;
    document.getElementById("modal-handover-title").textContent = jobType === "Dispatch"
      ? `🚚 ตรวจสภาพและส่งมอบรถ (Dispatch - ${bkId})`
      : `🔙 ตรวจสภาพและรับรถคืน (Return - ${bkId})`;

    const condSec = document.getElementById("insp-return-condition-section");
    if (condSec) {
      condSec.style.display = jobType === "Return" ? "block" : "none";
      const radNorm = document.getElementById("insp-cond-normal");
      if (radNorm) radNorm.checked = true;

      // Check if early return (returning before contract end date)
      const badgeEarly = document.getElementById("insp-early-return-badge");
      if (badgeEarly && b) {
        const endStr = b.end_date ? (typeof b.end_date === "string" ? b.end_date.split("T")[0] : "") : "";
        const todayStr = new Date().toISOString().split("T")[0];
        if (endStr && todayStr < endStr) {
          badgeEarly.style.display = "inline-block";
          const dmy = this.ymdToDmy ? this.ymdToDmy(endStr) : endStr;
          badgeEarly.textContent = `⚡ คืนรถก่อนกำหนดสัญญา (ครบกำหนดจริง: ${dmy})`;
        } else {
          badgeEarly.style.display = "none";
        }
      }

      // Reset Branch B sub-options
      const radEnd = document.getElementById("insp-sub-end-contract");
      if (radEnd) radEnd.checked = true;
      const swapInput = document.getElementById("insp-swap-car-search");
      if (swapInput) swapInput.value = "";
      const swapPlate = document.getElementById("insp-swap-selected-plate");
      if (swapPlate) swapPlate.value = "";
      const swapBadge = document.getElementById("insp-swap-selected-badge");
      if (swapBadge) {
        swapBadge.style.display = "none";
        swapBadge.innerHTML = "";
      }

      this.onInspConditionChange("normal");
    }

    this.uploadedPhotos = [];
    const photoContainer = document.getElementById("insp-uploaded-photos");
    if (photoContainer) photoContainer.innerHTML = "";
    this.damageMarks = [];
    setTimeout(() => this.initDamageCanvas(), 60);

    const pdfContainer = document.getElementById("insp-pdf-result-container");
    const modalPrintBtn = document.getElementById("btn-modal-print-inspection");
    if (pdfContainer && modalPrintBtn) {
      const existingPdf = (jobType === "Dispatch" ? b?.checkout_pdf_url : b?.checkin_pdf_url);
      if (existingPdf) {
        modalPrintBtn.href = existingPdf;
        pdfContainer.style.display = "flex";
      } else {
        pdfContainer.style.display = "none";
      }
    }
    this.openModal("modal-handover");
  }

  onInspConditionChange(cond) {
    const normInfo = document.getElementById("insp-cond-normal-info");
    const repInfo = document.getElementById("insp-cond-repair-info");
    const submitBtn = document.getElementById("btn-submit-inspection");

    if (cond === "needs_repair") {
      if (normInfo) normInfo.style.display = "none";
      if (repInfo) repInfo.style.display = "block";
      const isSwap = document.getElementById("insp-sub-swap-car")?.checked;
      this.onInspBranchBActionChange(isSwap ? "swap_car" : "end_contract");
    } else {
      if (normInfo) normInfo.style.display = "block";
      if (repInfo) repInfo.style.display = "none";
      if (submitBtn) submitBtn.innerHTML = `✅ ยืนยันบันทึกผล & ปิดงาน`;
      this.recalcInspRefundPreview();
    }
  }

  onInspBranchBActionChange(action) {
    const swapPanel = document.getElementById("insp-swap-car-panel");
    const depositPreview = document.getElementById("insp-deposit-calc-preview");
    const swapWarning = document.getElementById("insp-swap-damage-warning");
    const submitBtn = document.getElementById("btn-submit-inspection");

    if (action === "swap_car") {
      if (swapPanel) swapPanel.style.display = "block";
      if (depositPreview) depositPreview.style.display = "none";
      if (swapWarning) swapWarning.style.display = "block";
      if (submitBtn) submitBtn.innerHTML = `🔄 ยืนยันสลับรถทดแทน & ส่งรถเก่าเข้าซ่อม`;
      this.populateInspSwapCars();
    } else {
      if (swapPanel) swapPanel.style.display = "none";
      if (depositPreview) depositPreview.style.display = "block";
      if (swapWarning) swapWarning.style.display = "none";
      if (submitBtn) submitBtn.innerHTML = `✅ ยืนยันบันทึกผล & ปิดงาน`;
      this.recalcInspRefundPreview();
    }
  }

  populateInspSwapCars(searchKw = "") {
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (!listEl) return;

    const bkId = document.getElementById("insp-bk-id")?.value;
    const currentBooking = (this.bookings || []).find(x => x.booking_id === bkId);
    const currentPlate = currentBooking?.car_id || "";

    // Show only cars that are Available ("ว่างพร้อมใช้งาน") and not the currently rented car
    const availableCars = (this.cars || []).filter(c => {
      const isAvailable = (c.status === "ว่างพร้อมใช้งาน" || c.status === "ว่าง" || !c.status);
      return isAvailable && c.plate !== currentPlate;
    });

    const kw = (searchKw || "").toLowerCase().trim();
    const filtered = availableCars.filter(c => {
      if (!kw) return true;
      const plateMatch = (c.plate || "").toLowerCase().includes(kw);
      const brandMatch = (c.brand || "").toLowerCase().includes(kw);
      const modelMatch = (c.model || "").toLowerCase().includes(kw);
      const colorMatch = (c.color || "").toLowerCase().includes(kw);
      return plateMatch || brandMatch || modelMatch || colorMatch;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding:10px 12px; color:#94A3B8; font-size:12px; text-align:center;">${availableCars.length === 0 ? "⚠️ ไม่มีรถยนต์ที่ว่างพร้อมใช้งานในขณะนี้" : `ไม่พบรถที่ตรงกับ "${kw}"`}</div>`;
      return;
    }

    const currentSelected = document.getElementById("insp-swap-selected-plate")?.value || "";
    listEl.innerHTML = filtered.map(c => {
      const isSelected = c.plate === currentSelected;
      const priceStr = c.price_day || c.daily_rate ? `฿${Number(c.price_day || c.daily_rate).toLocaleString()}/วัน` : '';
      return `
        <div class="insp-swap-car-option-item ${isSelected ? 'selected' : ''}" 
             onclick="app.selectInspSwapCar('${c.plate}')"
             title="${c.plate} - ${c.brand || ''} ${c.model || ''}">
          <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:8px;">
            <span style="font-weight:800; color:#0F172A; margin-right:6px;">${c.plate}</span>
            <span style="color:#334155; font-weight:600;">${c.brand || ''} ${c.model || ''}</span>
            ${c.color ? `<span style="color:#64748B; font-size:11.5px; margin-left:4px;">(${c.color})</span>` : ''}
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            ${priceStr ? `<span style="font-size:11px; color:#D97706; font-weight:600;">${priceStr}</span>` : ''}
            <span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; background:#ECFDF5; color:#065F46; white-space:nowrap;">
              ว่าง
            </span>
          </div>
        </div>
      `;
    }).join("");
  }

  showInspSwapCarDropdown(show = true) {
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (!listEl) return;
    if (show) {
      this.populateInspSwapCars(document.getElementById("insp-swap-car-search")?.value || "");
      listEl.style.display = "block";
    } else {
      listEl.style.display = "none";
    }
  }

  toggleInspSwapCarDropdown() {
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (!listEl) return;
    if (listEl.style.display === "none" || !listEl.style.display) {
      this.showInspSwapCarDropdown(true);
      document.getElementById("insp-swap-car-search")?.focus();
    } else {
      this.showInspSwapCarDropdown(false);
    }
  }

  filterInspSwapCars(kw) {
    this.populateInspSwapCars(kw);
    const listEl = document.getElementById("insp-swap-car-dropdown-list");
    if (listEl) listEl.style.display = "block";
  }

  selectInspSwapCar(plate) {
    const car = (this.cars || []).find(c => c.plate === plate);
    const searchInput = document.getElementById("insp-swap-car-search");
    const hiddenPlate = document.getElementById("insp-swap-selected-plate");
    const badgeEl = document.getElementById("insp-swap-selected-badge");

    if (car) {
      if (searchInput) searchInput.value = `${car.plate} - ${car.brand || ''} ${car.model || ''} (${car.color || ''})`;
      if (hiddenPlate) hiddenPlate.value = car.plate;
      if (badgeEl) {
        badgeEl.style.display = "block";
        badgeEl.innerHTML = `✅ <b>เลือกรถทดแทน:</b> <span style="font-weight:800; color:#065F46;">${car.plate}</span> (${car.brand || ''} ${car.model || ''}) — ลูกค้าจะได้รับรถคันนี้ไปใช้งานต่อจนครบกำหนดสัญญา`;
      }
    }
    this.showInspSwapCarDropdown(false);
  }

  recalcInspRefundPreview() {
    const depAmt = 5000; // STRICT RULE: Fixed 5,000 THB deposit always
    const repCost = parseFloat(document.getElementById("insp-repair-cost")?.value || 0);
    const isRepair = document.getElementById("insp-cond-repair")?.checked;
    const isSwap = document.getElementById("insp-sub-swap-car")?.checked;

    const prevEl = document.getElementById("insp-deposit-calc-preview");
    if (!prevEl) return;

    if (isRepair) {
      if (isSwap) {
        prevEl.style.display = "none";
        return;
      }
      prevEl.style.display = "block";
      const deducted = Math.min(repCost, depAmt);
      const refund = Math.max(0, depAmt - deducted);
      prevEl.innerHTML = `
        💵 <b>สรุปการเงินมัดจำ:</b> มัดจำเดิม ฿5,000 | หักค่าซ่อม ฿${deducted.toLocaleString()} | <b>คืนมัดจำสุทธิ: <span style="color:#15803D;">฿${refund.toLocaleString()}</span></b>
      `;
    } else {
      prevEl.style.display = "block";
      prevEl.innerHTML = `
        💵 <b>คืนเงินมัดจำเต็มจำนวน:</b> <b style="color:#15803D;">฿5,000</b>
      `;
    }
  }

  openSettleModal(bkId) {
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    if (!b) return;
    const netP = parseFloat(b.net_price || 0);
    const remP = parseFloat(b.remaining_rental !== undefined ? b.remaining_rental : netP);
    
    document.getElementById("modal-settle-bk-id").value = bkId;
    const sumEl = document.getElementById("modal-settle-summary");
    if (sumEl) {
      sumEl.innerHTML = `
        <b>รหัสการจอง:</b> <span style="color:#C2410C;">${b.booking_id}</span> | <b>ทะเบียน:</b> ${b.car_id}<br/>
        <b>ผู้เช่า:</b> ${b.customer} | <b>ยอดสัญญาเต็ม:</b> ฿${netP.toLocaleString()}
      `;
    }
    const amtEl = document.getElementById("modal-settle-amount");
    if (amtEl) amtEl.value = `฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;

    const refEl = document.getElementById("modal-settle-ref");
    if (refEl) refEl.value = b.rental_ref || "";
    const slipEl = document.getElementById("modal-settle-slip-url");
    if (slipEl) slipEl.value = b.rental_slip || "";

    this.openModal("modal-settle-rental");
  }

  async handleSettleSlipUpload(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);
    try {
      this.showToast(`กำลังอัปโหลดสลิป ${file.name}...`, "info");
      const res = await fetch("/api/upload-photo", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        document.getElementById("modal-settle-slip-url").value = data.url;
        this.showToast("📸 อัปโหลดสลิปเรียบร้อย!", "success");
      }
    } catch (e) {
      this.showToast("อัปโหลดไม่สำเร็จ: " + e.message, "danger");
    }
  }

  async submitSettleFromModal() {
    const bkId = document.getElementById("modal-settle-bk-id")?.value;
    if (!bkId) return;
    const method = document.getElementById("modal-settle-method")?.value || "โอนเงิน / สแกน QR";
    const ref = (document.getElementById("modal-settle-ref")?.value || "").trim();
    const slip = (document.getElementById("modal-settle-slip-url")?.value || "").trim();

    try {
      this.showToast(`⏳ กำลังบันทึกชำระค่าเช่า ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_method: method,
          payment_ref: ref,
          slip_url: slip
        })
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-settle-rental");
        this.showToast(`🎉 ชำระค่าเช่าสำหรับ ${bkId} เรียบร้อย! พร้อมจัดทำสัญญาเช่า`, "success");
        await this.loadBookings();
        if (this.activeTab === "contract") this.onSelectContractBooking();
        if (this.activeTab === "assign") {
          this.onSelectAssignDispBooking();
          this.onSelectAssignRetBooking();
        }
        if (this.activeTab === "deposit") this.onSelectDepositBooking();
      } else {
        throw new Error(data.detail || "ชำระค่าเช่าไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async handlePhotoUpload(input) {
    if (!input.files || input.files.length === 0) return;
    const container = document.getElementById("insp-uploaded-photos");

    for (let file of input.files) {
      const formData = new FormData();
      formData.append("file", file);

      try {
        this.showToast(`กำลังอัปโหลด ${file.name}...`, "info");
        const res = await fetch("/api/upload-photo", { method: "POST", body: formData });
        const data = await res.json();
        if (data.success) {
          this.uploadedPhotos.push(data.url);
          const thumb = document.createElement("img");
          thumb.src = data.url;
          thumb.style.width = "50px";
          thumb.style.height = "50px";
          thumb.style.objectFit = "cover";
          thumb.style.borderRadius = "6px";
          thumb.style.border = "1px solid #CBD5E1";
          container.appendChild(thumb);
          this.showToast(`📸 อัปโหลดรูปภาพสำเร็จ!`, "success");
        }
      } catch (e) {
        this.showToast("อัปโหลดไม่สำเร็จ: " + e.message, "danger");
      }
    }
  }

  async submitInspection() {
    const bkId = document.getElementById("insp-bk-id").value;
    const jobType = document.getElementById("insp-job-type").value;
    const fuel = document.getElementById("insp-fuel-select").value;
    const mileage = document.getElementById("insp-mileage-input").value;
    const notes = document.getElementById("insp-notes-input").value;
    const isRepair = document.getElementById("insp-cond-repair")?.checked;
    const damageDesc = (document.getElementById("insp-damage-desc")?.value || "").trim();
    const repairCost = parseFloat(document.getElementById("insp-repair-cost")?.value || 0);
    const serviceCenter = (document.getElementById("insp-service-center")?.value || "").trim();

    // Check Branch B sub-option (end_contract vs swap_vehicle)
    let branchBAction = "end_contract";
    let swapNewPlate = "";
    if (jobType === "Return" && isRepair) {
      const isSwap = document.getElementById("insp-sub-swap-car")?.checked;
      if (isSwap) {
        branchBAction = "swap_vehicle";
        swapNewPlate = (document.getElementById("insp-swap-selected-plate")?.value || "").trim();
        if (!swapNewPlate) {
          alert("⚠️ กรุณาเลือกรถคันใหม่สำหรับเปลี่ยนทดแทนให้ลูกค้าก่อนกดยืนยัน");
          return;
        }
      }
    }

    const payload = {
      fuel_level: fuel,
      mileage: mileage,
      notes: notes,
      photos: this.uploadedPhotos,
      condition: (jobType === "Return" && isRepair) ? "needs_repair" : "normal",
      damage_desc: damageDesc,
      repair_cost: repairCost,
      service_center: serviceCenter,
      action: branchBAction,
      new_car_id: swapNewPlate
    };

    // TARGET MISSION 2 & 3: Generate official inspection checklist PDF
    const diagramBase64 = this.getCarDiagramBase64();
    let genPdfUrl = null;
    try {
      const bObj = (this.bookings || []).find(x => x.booking_id === bkId);
      const genRes = await fetch(`/api/bookings/${bkId}/generate-inspection-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inspection_type: jobType === "Dispatch" ? "checkout" : "checkin",
          odometer: mileage,
          odometer_out: jobType === "Dispatch" ? mileage : undefined,
          odometer_in: jobType !== "Dispatch" ? mileage : undefined,
          fuel_level: fuel,
          fuel_out: jobType === "Dispatch" ? fuel : undefined,
          fuel_in: jobType !== "Dispatch" ? fuel : undefined,
          notes: notes,
          remarks: notes,
          damage_notes: notes,
          damage_desc: damageDesc,
          car_diagram: diagramBase64,
          inspection_categories: bObj?.inspection_categories || (jobType === "Dispatch" ? bObj?.inspection_categories_out : bObj?.inspection_categories_in) || {
            petrol: true, cleanliness: true, tires: true, interior: true, underhood: true
          },
          staff_name: (jobType === "Dispatch" ? bObj?.worker_delivery : bObj?.worker_return) || "Staff",
          customer_signature: bObj?.customer || "Customer"
        })
      });
      const genData = await genRes.json();
      if (genData.success && genData.pdf_url) {
        genPdfUrl = genData.pdf_url;
        if (bObj) {
          if (jobType === "Dispatch") bObj.checkout_pdf_url = genPdfUrl;
          else bObj.checkin_pdf_url = genPdfUrl;
        }
      }
    } catch (pdfErr) {
      console.warn("[Inspection PDF] Notice generating inspection checklist PDF:", pdfErr);
    }

    const endpoint = jobType === "Dispatch" ? `/api/bookings/${bkId}/close-dispatch` : `/api/bookings/${bkId}/close-return`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-handover");
        if (jobType === "Return" && isRepair) {
          if (branchBAction === "swap_vehicle") {
            this.showToast(`🔄 สลับรถทดแทนเป็น ${swapNewPlate} เรียบร้อย (รถเดิมเข้าซ่อมบำรุง & แขวนยอดค่าเสียหาย ฿${repairCost.toLocaleString()})`, "success");
          } else {
            this.showToast(`⚠️ รับคืนรถ ${bkId} เรียบร้อย (ส่งซ่อมบำรุง & หักมัดจำ ฿${repairCost.toLocaleString()})`, "warning");
          }
        } else {
          this.showToast(`🎉 ปิดงาน ${jobType} สำหรับ ${bkId} สมบูรณ์!`, "success");
        }
        if (typeof Swal !== "undefined" && genPdfUrl) {
          Swal.fire({
            icon: 'success',
            title: jobType === 'Dispatch' ? 'ส่งมอบรถสำเร็จ!' : 'รับรถคืนสำเร็จ!',
            html: `
              <p style="color:#475569; font-size:13.5px; margin-bottom:14px;">ระบบได้สร้างเอกสารใบตรวจสภาพรถยนต์ (Inspection Checklist PDF) พร้อมบันทึกลงฐานข้อมูลเรียบร้อยแล้ว</p>
              <a href="${genPdfUrl}" target="_blank" class="btn btn-primary" style="font-weight:700; padding:10px 20px; font-size:14px; text-decoration:none; display:inline-block; background:#EA580C; border-color:#EA580C;">
                🖨️ พิมพ์ใบตรวจสภาพรถ (Print Inspection PDF)
              </a>
            `,
            showConfirmButton: true,
            confirmButtonText: 'ปิดหน้าต่าง'
          });
        }
        await this.loadBackOfficeJobs();
        await this.loadBookings();
        await this.loadCars();
        if (jobType === "Return") await this.loadDashboardKPIs();
        if (this.activeTab === "contract") this.onSelectContractBooking();
        if (this.activeTab === "assign") {
          this.onSelectAssignDispBooking();
          this.onSelectAssignRetBooking();
        }
      } else {
        throw new Error(data.detail || "ปิดงานไม่สำเร็จ");
      }
    } catch (e) {
      alert(e.message);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Customers Table & Add/Edit/Delete Operations ---
  renderCustomersTable() {
    const tbody = document.getElementById("customers-table-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("cust-search-input")?.value || "").toLowerCase().trim();
    const filtered = this.customers.filter(c => {
      if (kw) {
        const s = `${c.full_name} ${c.contact_no} ${c.passport_id} ${c.licence_no}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    tbody.innerHTML = filtered.map(c => {
      const safeName = String(c.full_name || '').replace(/'/g, "\\'");
      const isDefault = c.full_name === "ลูกค้าทั่วไป (Walk-in)";
      return `
        <tr>
          <td><b>${c.full_name}</b></td>
          <td>
            📞 ${c.contact_no || '-'}<br/>
            ${c.whatsapp && c.whatsapp !== '-' ? `<span style="font-size:11px; color:#10B981;">WA: ${c.whatsapp}</span>` : ''}
          </td>
          <td>${c.passport_id || '-'}</td>
          <td>${c.licence_no || '-'}</td>
          <td>${c.nationality || 'THAI'}</td>
          <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${c.thai_address}">${c.thai_address || '-'}</td>
          <td style="text-align:center; white-space:nowrap;">
            <button type="button" onclick="app.openEditCustomerModal('${safeName}')" class="btn btn-sm btn-secondary" title="ดู/แก้ไขข้อมูลลูกค้า" style="padding:3px 8px; font-size:12px; margin-right:4px;">
              ✏️
            </button>
            ${!isDefault ? `
              <button type="button" onclick="app.deleteCustomer('${safeName}')" class="btn btn-sm btn-danger" title="ลบข้อมูลลูกค้านี้" style="padding:3px 8px; font-size:12px;">
                🗑️
              </button>
            ` : ''}
          </td>
        </tr>
      `;
    }).join("");
  }

  populateCustomerDropdowns(preferredName = null) {
    if (preferredName) {
      this.lastAddedCustomerName = preferredName;
    }
    const sel = document.getElementById("book-cust-select");
    if (sel) {
      const curVal = preferredName || this.lastAddedCustomerName || sel.value || "";
      sel.innerHTML = this.customers.map(c => `<option value="${c.full_name}">${c.full_name} (📞 ${c.contact_no || '-'})</option>`).join("");
      if (curVal && Array.from(sel.options).some(o => o.value === curVal)) {
        sel.value = curVal;
      }
      this.onSelectBookingCustomer();
    }
    const walkinSel = document.getElementById("walkin-cust-select");
    if (walkinSel) {
      const curVal = preferredName || this.lastAddedCustomerName || walkinSel.value || "";
      walkinSel.innerHTML = '<option value="">-- เลือกลูกค้าผู้เช่า --</option>' +
        this.customers.map(c => `<option value="${c.full_name}">${c.full_name} (📞 ${c.contact_no || '-'})</option>`).join("");
      if (curVal && Array.from(walkinSel.options).some(o => o.value === curVal)) {
        walkinSel.value = curVal;
      }
      this.onSelectWalkinCustomer();
    }
  }

  onSelectBookingCustomer() {
    const sel = document.getElementById("book-cust-select");
    const badge = document.getElementById("book-cust-info-badge");
    if (!sel || !badge) return;
    const name = sel.value;
    const cust = this.customers.find(c => c.full_name === name);
    if (!cust) {
      badge.style.display = "none";
      return;
    }
    badge.style.display = "block";
    badge.innerHTML = `
      <div style="line-height:1.5;">
        <b>${cust.full_name}</b> | เบอร์โทร: <b>${cust.contact_no || '-'}</b> | เลขบัตร/Passport: <b style="color:#2563EB;">${cust.passport_id || '-'}</b> | ใบขับขี่: <b>${cust.licence_no || '-'}</b><br/>
        ที่อยู่: <span style="color:#64748B;">${cust.thai_address || cust.home_address || '-'}</span>
      </div>
    `;
  }

  onSelectWalkinCustomer() {
    const sel = document.getElementById("walkin-cust-select");
    const badge = document.getElementById("walkin-cust-info-badge");
    if (!sel || !badge) return;
    const name = sel.value;
    const cust = this.customers.find(c => c.full_name === name);
    if (!cust) {
      badge.style.display = "none";
      return;
    }
    badge.style.display = "block";
    badge.innerHTML = `
      <div style="line-height:1.5;">
        <b>${cust.full_name}</b> | เบอร์โทร: <b>${cust.contact_no || '-'}</b> | เลขบัตร/Passport: <b style="color:#2563EB;">${cust.passport_id || '-'}</b> | ใบขับขี่: <b>${cust.licence_no || '-'}</b>
      </div>
    `;
  }

  openEditCustomerModal(customerName) {
    const cust = this.customers.find(c => c.full_name === customerName);
    if (!cust) {
      this.showToast("⚠️ ไม่พบข้อมูลลูกค้าที่ต้องการแก้ไข", "warning");
      return;
    }
    document.getElementById("cust-original-name").value = cust.full_name;
    document.getElementById("cust-name-in").value = cust.full_name || "";
    const pVal = cust.phone_number || cust.contact_no || cust.phone;
    document.getElementById("cust-phone-in").value = (pVal && pVal !== "-") ? pVal : "";
    const idVal = cust.id_card_no || cust.passport_id || cust.id_card;
    document.getElementById("cust-pass-in").value = (idVal && idVal !== "-") ? idVal : "";
    const licVal = cust.driver_license_no || cust.licence_no || cust.driver_license;
    document.getElementById("cust-lic-in").value = (licVal && licVal !== "-") ? licVal : "";
    document.getElementById("cust-nat-in").value = cust.nationality || "THAI";
    document.getElementById("cust-wa-in").value = (cust.whatsapp && cust.whatsapp !== "-") ? cust.whatsapp : "";
    document.getElementById("cust-dob-in").value = this.dmyToYmd(cust.dob) || "";
    document.getElementById("cust-licexp-in").value = this.dmyToYmd(cust.license_expire_date || cust.licence_expiry) || "";
    document.getElementById("cust-home-in").value = (cust.home_address && cust.home_address !== "-") ? cust.home_address : "";
    const currVal = cust.current_address || cust.thai_address || cust.address;
    document.getElementById("cust-thai-in").value = (currVal && currVal !== "-") ? currVal : "";
    const emailVal = cust.email;
    const emailEl = document.getElementById("cust-email-in");
    if (emailEl) emailEl.value = (emailVal && emailVal !== "-") ? emailVal : "";
    const lineVal = cust.line_user_id || cust.line_id;
    const lineEl = document.getElementById("cust-line-in");
    if (lineEl) lineEl.value = (lineVal && lineVal !== "-") ? lineVal : "";

    document.getElementById("modal-cust-title").textContent = `✏️ ดูและแก้ไขข้อมูลลูกค้า (${cust.full_name})`;
    const btnSave = document.getElementById("btn-modal-cust-save");
    if (btnSave) btnSave.textContent = "💾 บันทึกการแก้ไข";

    const btnDel = document.getElementById("btn-modal-cust-delete");
    if (btnDel) {
      btnDel.style.display = cust.full_name === "ลูกค้าทั่วไป (Walk-in)" ? "none" : "inline-flex";
    }

    const warnPhone = document.getElementById("cust-phone-warn");
    if (warnPhone) { warnPhone.style.display = "none"; warnPhone.textContent = ""; }
    const warnPass = document.getElementById("cust-pass-warn");
    if (warnPass) { warnPass.style.display = "none"; warnPass.textContent = ""; }

    this.openModal("modal-add-customer");
    setTimeout(() => document.getElementById("cust-phone-in")?.focus(), 80);
  }

  openEditSelectedCustomerModal(context = 'book') {
    const selId = context === 'book' ? "book-cust-select" : "walkin-cust-select";
    const name = document.getElementById(selId)?.value;
    if (!name) {
      this.showToast("⚠️ กรุณาเลือกลูกค้าก่อนกดแก้ไข", "warning");
      return;
    }
    this.openEditCustomerModal(name);
  }

  async deleteSelectedCustomer(context = 'book') {
    const selId = context === 'book' ? "book-cust-select" : "walkin-cust-select";
    const name = document.getElementById(selId)?.value;
    if (!name) {
      this.showToast("⚠️ กรุณาเลือกลูกค้าก่อนกดลบ", "warning");
      return;
    }
    if (name === "ลูกค้าทั่วไป (Walk-in)") {
      this.showToast("⚠️ ไม่สามารถลบ 'ลูกค้าทั่วไป (Walk-in)' ได้", "warning");
      return;
    }
    await this.deleteCustomer(name);
  }

  async deleteCurrentEditingCustomer() {
    const origName = document.getElementById("cust-original-name")?.value || document.getElementById("cust-name-in")?.value;
    if (!origName) return;
    this.closeModal("modal-add-customer");
    await this.deleteCustomer(origName);
  }

  checkDuplicatePhone(val) {
    const warnEl = document.getElementById("cust-phone-warn");
    if (!warnEl) return;
    const cleanDigits = String(val || "").replace(/\D/g, "");
    if (!cleanDigits || cleanDigits.length < 9) {
      warnEl.style.display = "none";
      warnEl.textContent = "";
      return;
    }
    const normPhone = cleanDigits.startsWith("66") ? "0" + cleanDigits.slice(2) : cleanDigits;
    const origName = (document.getElementById("cust-original-name")?.value || "").trim();
    const currentName = (document.getElementById("cust-name-in")?.value || "").trim();

    const dup = (this.customers || []).find(c => {
      if (c.full_name === currentName || (origName && c.full_name === origName)) return false;
      const existPhone = String(c.contact_no || "").replace(/\D/g, "");
      if (!existPhone || existPhone.length < 9) return false;
      const existNorm = existPhone.startsWith("66") ? "0" + existPhone.slice(2) : existPhone;
      return existNorm === normPhone;
    });

    if (dup) {
      warnEl.style.display = "block";
      warnEl.innerHTML = `⚠️ เบอร์โทรศัพท์นี้ซ้ำกับลูกค้า: <b>${dup.full_name}</b> (เลขบัตร/Passport: ${dup.passport_id || '-'}) ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
    } else {
      warnEl.style.display = "none";
      warnEl.textContent = "";
    }
  }

  checkDuplicatePassport(val) {
    const warnEl = document.getElementById("cust-pass-warn");
    if (!warnEl) return;
    const clean = String(val || "").replace(/[\s-]/g, "").toLowerCase();
    if (!clean || clean === "-" || clean === "none") {
      warnEl.style.display = "none";
      warnEl.textContent = "";
      return;
    }
    const origName = (document.getElementById("cust-original-name")?.value || "").trim();
    const currentName = (document.getElementById("cust-name-in")?.value || "").trim();

    const dup = (this.customers || []).find(c => {
      if (c.full_name === currentName || (origName && c.full_name === origName)) return false;
      const existPass = String(c.passport_id || "").replace(/[\s-]/g, "").toLowerCase();
      return existPass && existPass !== "-" && existPass !== "none" && existPass === clean;
    });

    if (dup) {
      warnEl.style.display = "block";
      warnEl.innerHTML = `⚠️ หมายเลขบัตร ปชช. / พาสปอร์ตนี้ซ้ำกับลูกค้า: <b>${dup.full_name}</b> (📞 ${dup.contact_no || '-'}) ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
    } else {
      warnEl.style.display = "none";
      warnEl.textContent = "";
    }
  }

  openAddCustomerModal() {
    const origEl = document.getElementById("cust-original-name");
    if (origEl) origEl.value = "";
    ["cust-name-in", "cust-phone-in", "cust-pass-in", "cust-lic-in", "cust-wa-in", "cust-home-in", "cust-thai-in", "cust-email-in", "cust-line-in"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const titleEl = document.getElementById("modal-cust-title");
    if (titleEl) titleEl.textContent = "➕ เพิ่มข้อมูลลูกค้าใหม่ (Add New Customer)";
    const btnSave = document.getElementById("btn-modal-cust-save");
    if (btnSave) btnSave.textContent = "💾 บันทึกข้อมูลลูกค้า";
    const btnDel = document.getElementById("btn-modal-cust-delete");
    if (btnDel) btnDel.style.display = "none";

    const warnPhone = document.getElementById("cust-phone-warn");
    if (warnPhone) { warnPhone.style.display = "none"; warnPhone.textContent = ""; }
    const warnPass = document.getElementById("cust-pass-warn");
    if (warnPass) { warnPass.style.display = "none"; warnPass.textContent = ""; }

    const natEl = document.getElementById("cust-nat-in");
    if (natEl) natEl.value = "THAI";
    const dobEl = document.getElementById("cust-dob-in");
    if (dobEl) dobEl.value = "";
    const licExpEl = document.getElementById("cust-licexp-in");
    if (licExpEl) licExpEl.value = "";

    this.openModal("modal-add-customer");
    setTimeout(() => document.getElementById("cust-name-in")?.focus(), 80);
  }

  async submitNewCustomer() {
    const name = (document.getElementById("cust-name-in")?.value || "").trim();
    const origName = (document.getElementById("cust-original-name")?.value || "").trim();

    if (!name) {
      alert("กรุณาระบุชื่อ-นามสกุลลูกค้า");
      return;
    }

    // 1. Phone number duplicate check
    const phone = (document.getElementById("cust-phone-in")?.value || "").trim();
    if (phone && phone !== "-" && phone.toLowerCase() !== "none") {
      const cleanDigits = phone.replace(/\D/g, "");
      if (cleanDigits.length >= 9) {
        const normPhone = cleanDigits.startsWith("66") ? "0" + cleanDigits.slice(2) : cleanDigits;
        const dupPhone = (this.customers || []).find(c => {
          if (c.full_name === name || (origName && c.full_name === origName)) return false;
          const existPhone = String(c.contact_no || "").replace(/\D/g, "");
          if (!existPhone || existPhone.length < 9) return false;
          const existNorm = existPhone.startsWith("66") ? "0" + existPhone.slice(2) : existPhone;
          return existNorm === normPhone;
        });
        if (dupPhone) {
          this.showToast(`❌ ไม่อนุญาตให้ใช้เบอร์โทรศัพท์ซ้ำกับ '${dupPhone.full_name}'`, "danger");
          alert(`❌ ระบบไม่อนุญาตให้ใช้เบอร์โทรศัพท์ซ้ำ!\n\nเบอร์ '${phone}' ซ้ำกับข้อมูลของลูกค้า '${dupPhone.full_name}' ที่มีอยู่ในระบบแล้ว กรุณาตรวจสอบ`);
          const warnEl = document.getElementById("cust-phone-warn");
          if (warnEl) {
            warnEl.style.display = "block";
            warnEl.innerHTML = `⚠️ เบอร์โทรศัพท์นี้ซ้ำกับลูกค้า: <b>${dupPhone.full_name}</b> ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
          }
          document.getElementById("cust-phone-in")?.focus();
          return;
        }
      }
    }

    // 2. Citizen ID / Passport duplicate check
    const passId = (document.getElementById("cust-pass-in")?.value || "").trim();
    if (passId && passId !== "-" && passId.toLowerCase() !== "none") {
      const cleanPass = passId.replace(/[\s-]/g, "").toLowerCase();
      const duplicate = (this.customers || []).find(c => {
        if (c.full_name === name || (origName && c.full_name === origName)) return false;
        const existPass = String(c.passport_id || "").trim();
        if (!existPass || existPass === "-" || existPass.toLowerCase() === "none") return false;
        return existPass.replace(/[\s-]/g, "").toLowerCase() === cleanPass;
      });
      if (duplicate) {
        this.showToast(`❌ ไม่อนุญาตให้ใช้เลขบัตร/พาสปอร์ตซ้ำกับ '${duplicate.full_name}'`, "danger");
        alert(`❌ ระบบไม่อนุญาตให้ใช้เลขบัตรประชาชนหรือพาสปอร์ตซ้ำ!\n\nหมายเลข '${passId}' ซ้ำกับข้อมูลของลูกค้า '${duplicate.full_name}' ที่มีอยู่ในระบบแล้ว กรุณาตรวจสอบ`);
        const warnEl = document.getElementById("cust-pass-warn");
        if (warnEl) {
          warnEl.style.display = "block";
          warnEl.innerHTML = `⚠️ หมายเลขบัตร ปชช. / พาสปอร์ตนี้ซ้ำกับลูกค้า: <b>${duplicate.full_name}</b> ในระบบแล้ว (ห้ามใช้ซ้ำ)`;
        }
        document.getElementById("cust-pass-in")?.focus();
        return;
      }
    }

    const licNo = document.getElementById("cust-lic-in")?.value.trim() || "-";
    const nat = document.getElementById("cust-nat-in")?.value.trim() || "THAI";
    const wa = document.getElementById("cust-wa-in")?.value.trim() || "-";
    const dobVal = (document.getElementById("cust-dob-in")?.value || "").trim();
    const dobFormatted = dobVal ? (this.ymdToDmy(dobVal) || dobVal) : "-";
    const licExpVal = (document.getElementById("cust-licexp-in")?.value || "").trim();
    const licExpFormatted = licExpVal ? (this.ymdToDmy(licExpVal) || licExpVal) : "-";
    const homeAddr = document.getElementById("cust-home-in")?.value.trim() || "-";
    const currAddr = document.getElementById("cust-thai-in")?.value.trim() || "-";
    const email = document.getElementById("cust-email-in")?.value.trim() || "-";
    const lineId = document.getElementById("cust-line-in")?.value.trim() || "-";

    const payload = {
      // 10 Standard Customer Fields
      full_name: name,
      phone_number: phone || "-",
      id_card_no: passId || "-",
      driver_license_no: licNo,
      nationality: nat,
      whatsapp: wa,
      dob: dobFormatted,
      license_expire_date: licExpFormatted,
      home_address: homeAddr,
      current_address: currAddr,
      email: email,
      line_user_id: lineId,
      line_id: lineId,

      // Compatibility Aliases
      original_name: origName || name,
      contact_no: phone || "-",
      phone: phone || "-",
      passport_id: passId || "-",
      id_card: passId || "-",
      licence_no: licNo,
      driver_license: licNo,
      licence_expiry: licExpFormatted,
      home_address: homeAddr,
      thai_address: currAddr,
      address: homeAddr
    };

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const errMsg = data.detail || data.error || "เกิดข้อผิดพลาดในการบันทึกข้อมูล";
        this.showToast("❌ บันทึกไม่สำเร็จ: " + errMsg, "danger");
        alert("❌ บันทึกไม่สำเร็จ: " + errMsg);
        return;
      }
      this.lastAddedCustomerName = name;
      if (origName && origName !== name) {
        this.customers = this.customers.filter(c => c.full_name !== origName);
      }
      const existIdx = this.customers.findIndex(c => c.full_name === name);
      if (existIdx >= 0) {
        this.customers[existIdx] = payload;
      } else {
        this.customers.unshift(payload);
      }
      this.populateCustomerDropdowns(name);
      this.closeModal("modal-add-customer");
      this.showToast(`🎉 บันทึกข้อมูลลูกค้า '${name}' เรียบร้อย!`, "success");
      await this.loadCustomers();
      this.populateCustomerDropdowns(name);
      this.renderCustomersTable();
    } catch (e) {
      this.showToast("บันทึกไม่สำเร็จ: " + e.message, "danger");
    }
  }

  async deleteCustomer(name) {
    if (name === "ลูกค้าทั่วไป (Walk-in)") {
      this.showToast("⚠️ ไม่สามารถลบ 'ลูกค้าทั่วไป (Walk-in)' ได้", "warning");
      return;
    }
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลลูกค้า '${name}' ออกจากระบบ? (กรณีบันทึกผิดหรือข้อมูลซ้ำ)`)) return;
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🗑️ ลบข้อมูลลูกค้า '${name}' เรียบร้อยแล้ว`, "success");
        this.customers = this.customers.filter(c => c.full_name !== name);
        if (this.lastAddedCustomerName === name) {
          this.lastAddedCustomerName = null;
        }
        await this.loadCustomers();
        this.populateCustomerDropdowns();
        this.renderCustomersTable();
      } else {
        this.showToast("ลบไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
      }
    } catch (e) {
      this.showToast("ลบไม่สำเร็จ: " + e.message, "danger");
    }
  }

  // --- Executive Dashboard Rendering ---
  parseExpiryDateInfo(rawStr) {
    const str = String(rawStr || "").trim();
    if (!str || str === "-" || str.toLowerCase() === "none") {
      return { valid: false, dateObj: null, daysLeft: 999999, raw: "-", formatted: "-" };
    }

    let d = null;
    if (str.includes("/")) {
      const parts = str.split("/");
      if (parts.length === 3) {
        let day = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10) - 1;
        let year = parseInt(parts[2], 10);
        if (year > 2400) year -= 543;
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          d = new Date(year, month, day);
        }
      }
    } else if (str.includes("-")) {
      const parts = str.split("-");
      if (parts.length === 3) {
        let year = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10) - 1;
        let day = parseInt(parts[2], 10);
        if (year > 2400) year -= 543;
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          d = new Date(year, month, day);
        }
      }
    }

    if (!d || isNaN(d.getTime())) {
      return { valid: false, dateObj: null, daysLeft: 999999, raw: str, formatted: str };
    }

    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((targetMidnight.getTime() - todayMidnight.getTime()) / 86400000);

    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();

    return {
      valid: true,
      dateObj: d,
      daysLeft: diffDays,
      raw: str,
      formatted: `${dd}/${mm}/${yyyy}`
    };
  }

  formatExpiryStatusCell(plate, field, rawStr) {
    const info = this.parseExpiryDateInfo(rawStr);
    const safePlate = String(plate || "").replace(/'/g, "\\'");
    const labelType = field === "tax_expiry" ? "ภาษี" : (field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย");
    const mode = field === "ins_expiry" ? "ins" : "act";

    let badgeHtml = `<span style="color:#64748B; font-size:11.5px;">${info.formatted}</span>`;
    if (info.valid) {
      if (info.daysLeft < 0) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#991B1B; background:#FEE2E2; border:1px solid #FECACA; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🔴 ${info.formatted} (ขาด ${Math.abs(info.daysLeft)} วัน)
          </span>`;
      } else if (info.daysLeft === 0) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#991B1B; background:#FEE2E2; border:1px solid #FECACA; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🔴 ${info.formatted} (วันนี้!)
          </span>`;
      } else if (info.daysLeft <= 30) {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:700; color:#B45309; background:#FEF3C7; border:1px solid #FDE68A; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🟡 ${info.formatted} (เหลือ ${info.daysLeft} วัน)
          </span>`;
      } else {
        badgeHtml = `
          <span style="display:inline-flex; align-items:center; gap:4px; font-weight:600; color:#065F46; background:#ECFDF5; border:1px solid #A7F3D0; padding:2px 8px; border-radius:12px; font-size:11.5px; white-space:nowrap;">
            🟢 ${info.formatted}
          </span>`;
      }
    }

    // Check if an active renewal or maintenance job exists for this car & field
    const activeMnt = (this.maintenanceRecords || []).find(m =>
      m.car_id === plate &&
      m.status !== "เสร็จสิ้น" &&
      m.status !== "ยกเลิก" &&
      (
        ((field === "act_expiry" || field === "tax_expiry") && (String(m.order_type).includes("พ.ร.บ.") || String(m.order_type).includes("ต่อทะเบียน") || String(m.order_type).includes("แพ็กคู่"))) ||
        (field === "ins_expiry" && (String(m.order_type).includes("ประกัน") || String(m.order_type).includes("แพ็กคู่")))
      )
    );

    let actionBtnHtml = '';
    if (activeMnt) {
      actionBtnHtml = `
        <div style="display:inline-flex; align-items:center; gap:4px;">
          <button type="button" onclick="app.openCloseMaintenanceModal('${activeMnt.id}')" title="พนักงานต่อเสร็จแล้ว: คลิกเพื่อระบุวันหมดอายุใหม่ & ส่งงาน" style="background:#ECFDF5; color:#047857; border:1px solid #10B981; border-radius:6px; padding:2px 7px; font-size:11px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:2px;">
            🏁 ส่งงาน
          </button>
        </div>
      `;
    } else if (field === "tax_expiry") {
      actionBtnHtml = `
        <div style="display:inline-flex; align-items:center; gap:3px;">
          <button type="button" onclick="app.openExpiryModal('${safePlate}', 'tax_expiry')" title="ระบุ/แก้ไขวันหมดอายุภาษีโดยตรง" style="background:#F8FAFC; color:#64748B; border:1px solid #CBD5E1; border-radius:6px; padding:2px 5px; font-size:11px; cursor:pointer;">
            ✏️
          </button>
        </div>
      `;
    } else {
      actionBtnHtml = `
        <div style="display:inline-flex; align-items:center; gap:3px;">
          <button type="button" onclick="app.openRenewalOrderModal('${safePlate}', '${mode}')" title="ออกใบงานมอบหมายต่ออายุ ${labelType} (ขึ้นหน้าตารางงาน)" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; border-radius:6px; padding:2px 6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:2px;">
            📋 ออกใบงาน
          </button>
          <button type="button" onclick="app.openExpiryModal('${safePlate}', '${field}')" title="ระบุ/แก้ไขวันหมดอายุ ${labelType} โดยตรง" style="background:#F8FAFC; color:#64748B; border:1px solid #CBD5E1; border-radius:6px; padding:2px 5px; font-size:11px; cursor:pointer;">
            ✏️
          </button>
        </div>
      `;
    }

    return `
      <div style="display:flex; flex-direction:column; gap:3px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:nowrap;">
          <div>${badgeHtml}</div>
          <div style="flex-shrink:0;">${actionBtnHtml}</div>
        </div>
        ${activeMnt ? `<div style="font-size:10.5px; color:#1D4ED8; font-weight:700; display:flex; align-items:center; gap:3px;"><span>⏳ มอบหมาย:</span> <span style="color:#0F172A;">${activeMnt.assigned_worker || 'ช่าง'}</span> <span style="color:#64748B;">(${activeMnt.id})</span></div>` : ''}
      </div>
    `;
  }

  renderFleetOverviewTable() {
    const tbody = document.getElementById("fleet-overview-tbody");
    if (!tbody) return;

    const isEn = (this.currentLang === "EN");
    const summaryEl = document.getElementById("dash-fleet-expiry-summary");
    const sortMode = document.getElementById("dash-fleet-sort-select")?.value || "expiry_asc";
    const localKw = (document.getElementById("dash-fleet-search-input")?.value || "").toLowerCase().trim();
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();

    // 1. Total Fleet across all companies (Unified Dashboard)
    const scopedCars = this.cars || [];

    let expiredCount = 0;
    let warningCount = 0;
    let normalCount = 0;

    // Duplicate check across current fleet
    const seenNormPlates = new Set();
    const seenChassis = new Set();
    let dupCount = 0;
    (this.cars || []).forEach(c => {
      const np = this.normalizePlate(c.plate);
      if (seenNormPlates.has(np)) dupCount++;
      seenNormPlates.add(np);
      const ch = String(c.chassis_no || "").trim().toUpperCase();
      if (ch && ch !== "-" && ch.length >= 8) {
        if (seenChassis.has(ch)) dupCount++;
        seenChassis.add(ch);
      }
    });

    const enrichedCars = scopedCars.map(c => {
      const taxInfo = this.parseExpiryDateInfo(c.tax_expiry);
      const actInfo = this.parseExpiryDateInfo(c.act_expiry);
      const insInfo = this.parseExpiryDateInfo(c.ins_expiry);
      const minDays = Math.min(actInfo.daysLeft, insInfo.daysLeft, taxInfo.daysLeft);
      const maxDays = Math.max(actInfo.daysLeft, insInfo.daysLeft);

      if (minDays < 0) expiredCount++;
      else if (minDays <= 30) warningCount++;
      else normalCount++;

      return {
        car: c,
        taxInfo,
        actInfo,
        insInfo,
        minDays,
        maxDays
      };
    });

    const titleEl = document.getElementById("title-expander-fleet");
    if (titleEl) {
      titleEl.textContent = isEn 
        ? `Fleet Database Overview (Tax, ACT, Ins & Service — ${scopedCars.length} cars)` 
        : `ฐานข้อมูลทะเบียนรถ, ภาษี, พ.ร.บ., ประกันภัย และเช็คระยะ (Fleet Database — ${scopedCars.length} คัน)`;
    }

    if (summaryEl) {
      summaryEl.innerHTML = `
        <span style="background:#FEE2E2; color:#991B1B; border:1px solid #FECACA; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🔴 ${isEn ? `Expired: ${expiredCount} cars` : `หมดอายุ: ${expiredCount} คัน`}
        </span>
        <span style="background:#FEF3C7; color:#B45309; border:1px solid #FDE68A; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🟡 ${isEn ? `Due soon (≤30d): ${warningCount} cars` : `ใกล้หมด (≤30 วัน): ${warningCount} คัน`}
        </span>
        <span style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;">
          🟢 ${isEn ? `Normal: ${normalCount} cars` : `ปกติ: ${normalCount} คัน`}
        </span>
        <span style="background:#EFF6FF; color:#1E40AF; border:1px solid #BFDBFE; padding:3px 9px; border-radius:12px; font-size:11.5px; font-weight:700;" title="ตรวจสอบทะเบียนซ้ำและเลขตัวถังซ้ำอัตโนมัติ">
          ${dupCount === 0 ? (isEn ? 'No Duplicates' : 'ไม่พบรถซ้ำ') : (isEn ? `Duplicates (${dupCount})` : `พบรถซ้ำ (${dupCount})`)}
        </span>
      `;
    }

    // 2. Filter by search keyword (local search or sidebar search)
    let filtered = enrichedCars.filter(item => {
      const c = item.car;
      const target = `${c.plate || ''} ${c.brand || ''} ${c.model || ''} ${c.company || ''} ${c.owner || ''} ${c.beneficiary || ''} ${c.color || ''} ${c.chassis_no || ''} ${c.ins_company || ''} ${c.reg_year || ''} ${c.notes || ''} ${c.status || ''} ${c.tax_expiry || ''} ${c.act_expiry || ''} ${c.ins_expiry || ''} ${c.hp_contract_no || ''}`.toLowerCase();
      if (localKw && !target.includes(localKw)) return false;
      if (sbKw && !target.includes(sbKw)) return false;
      return true;
    });

    // 3. Sort according to selected sort mode
    filtered.sort((a, b) => {
      if (sortMode === "tax_asc") {
        if (a.taxInfo.daysLeft !== b.taxInfo.daysLeft) return a.taxInfo.daysLeft - b.taxInfo.daysLeft;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else if (sortMode === "act_asc") {
        if (a.actInfo.daysLeft !== b.actInfo.daysLeft) return a.actInfo.daysLeft - b.actInfo.daysLeft;
        if (a.insInfo.daysLeft !== b.insInfo.daysLeft) return a.insInfo.daysLeft - b.insInfo.daysLeft;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else if (sortMode === "ins_asc") {
        if (a.insInfo.daysLeft !== b.insInfo.daysLeft) return a.insInfo.daysLeft - b.insInfo.daysLeft;
        if (a.actInfo.daysLeft !== b.actInfo.daysLeft) return a.actInfo.daysLeft - b.actInfo.daysLeft;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else if (sortMode === "plate_asc") {
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      } else {
        if (a.minDays !== b.minDays) return a.minDays - b.minDays;
        if (a.maxDays !== b.maxDays) return a.maxDays - b.maxDays;
        return String(a.car.plate || "").localeCompare(String(b.car.plate || ""), "th");
      }
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:28px; color:#64748B;">${isEn ? 'No vehicles found matching the search criteria' : 'ไม่พบข้อมูลรถยนต์ที่ค้นหา'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(item => {
      const c = item.car;
      const safePlate = String(c.plate || "").replace(/'/g, "\\'");
      const rowBg = item.minDays < 0 ? "background:#FEF2F2;" : (item.minDays <= 30 ? "background:#FFFBEB;" : "");

      const activePairMnt = (this.maintenanceRecords || []).find(m =>
        m.car_id === c.plate &&
        m.status !== "เสร็จสิ้น" &&
        m.status !== "ยกเลิก" &&
        (String(m.order_type).includes("ต่อทะเบียน") || String(m.order_type).includes("ประกัน") || String(m.order_type).includes("พ.ร.บ.") || String(m.order_type).includes("แพ็กคู่"))
      );

      let renewBtnHtml = '';
      if (activePairMnt) {
        renewBtnHtml = `
          <button type="button" onclick="app.openCloseMaintenanceModal('${activePairMnt.id}')" class="btn btn-sm" style="padding:3px 7px; font-size:11px; font-weight:800; background:#ECFDF5; color:#047857; border:1px solid #10B981;" title="${isEn ? 'Renewal completed: Submit & update dates' : 'พนักงานต่อเสร็จแล้ว: ส่งงาน & อัปเดตวันหมดอายุ'}">
            ${isEn ? 'Submit Renewal' : 'ส่งงานต่ออายุ'}
          </button>
        `;
      } else {
        renewBtnHtml = `
          <button type="button" onclick="app.openRenewalOrderModal('${safePlate}', 'both')" class="btn btn-sm" style="padding:3px 7px; font-size:11px; font-weight:700; background:#FFF7ED; color:#EA580C; border:1px solid #FDBA74;" title="${isEn ? 'Create dual work order for ACT & Insurance' : 'ออกใบงานต่ออายุทั้ง พ.ร.บ. และ ประกันภัย มอบหมายพนักงาน (ขึ้นหน้าตารางงาน)'}">
            ${isEn ? 'Dual Order' : 'ต่อคู่'}
          </button>
        `;
      }

      const regYearBadge = c.reg_year && c.reg_year !== "-"
        ? `<div style="font-size:10.5px; color:#64748B;">${isEn ? 'Reg Year:' : 'ปีจด:'} <b>${c.reg_year}</b></div>`
        : "";

      const ownerTxt = c.owner && c.owner !== "-" ? c.owner : (c.company || "-");
      const benTxt = c.beneficiary && c.beneficiary !== "-" && c.beneficiary !== ownerTxt
        ? `<div style="font-size:10.5px; color:#64748B;">ผู้รับผลประโยชน์: ${c.beneficiary}</div>`
        : "";

      const insCompBadge = c.ins_company && c.ins_company !== "-"
        ? `<div style="font-size:10.5px; color:#0369A1; font-weight:700; margin-top:2px;">${c.ins_company}</div>`
        : "";

      const srvInfo = [];
      if (c.last_service_date && c.last_service_date !== "-") srvInfo.push(`ล่าสุด: ${c.last_service_date}`);
      if (c.next_service_date && c.next_service_date !== "-") srvInfo.push(`กำหนดเช็ค: ${c.next_service_date}`);
      if (c.next_service_mileage && Number(c.next_service_mileage) > 0) srvInfo.push(`ไมล์เช็ค: ${Number(c.next_service_mileage).toLocaleString()} กม.`);
      else if (c.next_service && c.next_service !== "-" && c.next_service !== c.next_service_date) srvInfo.push(`ถัดไป: ${c.next_service}`);
      const srvHtml = srvInfo.length > 0
        ? `<div style="font-size:10.5px; color:#475569;">${srvInfo.join(" | ")}</div>`
        : "";

      const hpBadge = c.hp_contract_no
        ? `<div style="font-size:10.5px; color:#7C3AED; font-weight:700;">สัญญา: ${c.hp_contract_no}${c.hp_installment ? ` (฿${Number(c.hp_installment).toLocaleString()}/ด.)` : ''}</div>`
        : "";

      const notesShort = c.notes
        ? `<div style="font-size:11px; color:#334155; max-width:210px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${String(c.notes).replace(/"/g, '&quot;')}">${c.notes}</div>`
        : `<span style="color:#94A3B8; font-size:11px;">-</span>`;

      return `
        <tr style="${rowBg} transition: background 0.25s ease;">
          <td style="white-space:nowrap;">
            <b>${c.plate}</b>
            ${regYearBadge}
          </td>
          <td>
            <b>${c.brand || ''}</b> ${c.model || ''}
            <div style="font-size:11px; color:#64748B;">${c.color || '-'}</div>
          </td>
          <td style="font-family:monospace; font-size:11.5px; color:#1E293B; white-space:nowrap;">${c.chassis_no || '-'}</td>
          <td>
            <div style="font-weight:700; font-size:12px; color:#1E293B;">${ownerTxt}</div>
            ${benTxt}
          </td>
          <td>
            <span class="badge" style="background:${c.status_bg}; color:${c.status_color}; border:1px solid ${c.status_border};">
              ${c.fleet_status_desc || c.status}
            </span>
          </td>
          <td>${this.formatExpiryStatusCell(c.plate, 'tax_expiry', c.tax_expiry)}</td>
          <td>${this.formatExpiryStatusCell(c.plate, 'act_expiry', c.act_expiry)}</td>
          <td>
            ${this.formatExpiryStatusCell(c.plate, 'ins_expiry', c.ins_expiry)}
            ${insCompBadge}
          </td>
          <td style="white-space:nowrap;">
            <div style="font-weight:700; font-size:12px;">${c.mileage || '15,000'} km</div>
            ${srvHtml}
          </td>
          <td>
            ${hpBadge}
            ${notesShort}
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${renewBtnHtml}
            <button type="button" onclick="app.openEditCarModal('${safePlate}')" class="btn btn-sm btn-secondary" style="padding:3px 7px; font-size:11.5px;" title="แก้ไขรายละเอียดรถและรูปรถ">
              ✏️
            </button>
            <button type="button" onclick="app.jumpToCarInFrontOffice('${safePlate}')" class="btn btn-sm btn-secondary" style="padding:3px 7px; font-size:11.5px;" title="ดูรถในหน้าเลือกรถยนต์">
              🔍
            </button>
            <button type="button" onclick="app.deleteCarByPlate('${safePlate}')" class="btn btn-sm" style="padding:3px 7px; font-size:11.5px; background:#FEE2E2; color:#B91C1C; border:1px solid #FCA5A5;" title="ลบรถยนต์คันนี้ออกจากระบบ">
              🗑️
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async loadHpLeasingData() {
    await this.loadMonthlyExpenses();
  }

  renderHpLeasingTable() {
    this.renderMonthlyExpensesTable();
  }


  getExpiryCycleInfo(dateObj = null) {
    const d = dateObj || new Date();
    const day = d.getDate();
    const curYear = d.getFullYear();
    const curMonth = d.getMonth() + 1; // 1..12

    let roundDay, targetYear, targetMonth, roundName, roundNameEn, badgeText, badgeTextEn;
    if (day < 16) {
      roundDay = 1;
      targetYear = curYear;
      targetMonth = curMonth;
      const mm = String(targetMonth).padStart(2, '0');
      badgeText = `รอบวันที่ 1 (เดือนนี้ ${mm}/${targetYear})`;
      badgeTextEn = `Round 1st (This Month ${mm}/${targetYear})`;
      roundName = `รอบวันที่ 1 (หมดอายุเดือนนี้ ${mm}/${targetYear})`;
      roundNameEn = `Round 1st (Expiring this month ${mm}/${targetYear})`;
    } else {
      roundDay = 16;
      // Year-end safe transition: December (12) -> January (1) of next year
      if (curMonth === 12) {
        targetYear = curYear + 1;
        targetMonth = 1;
      } else {
        targetYear = curYear;
        targetMonth = curMonth + 1;
      }
      const mm = String(targetMonth).padStart(2, '0');
      badgeText = `รอบวันที่ 16 (เดือนหน้า ${mm}/${targetYear})`;
      badgeTextEn = `Round 16th (Next Month ${mm}/${targetYear})`;
      roundName = `รอบวันที่ 16 (หมดอายุเดือนหน้า ${mm}/${targetYear})`;
      roundNameEn = `Round 16th (Expiring next month ${mm}/${targetYear})`;
    }

    const targetYM = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    return {
      roundDay,
      targetYear,
      targetMonth,
      targetYM,
      roundName,
      roundNameEn,
      badgeText,
      badgeTextEn
    };
  }

  onAlertBannerClick() {
    const cycle = this.getExpiryCycleInfo();
    const body = document.getElementById("body-expander-monthly-expenses");
    const header = document.querySelector("#expander-monthly-expenses .expander-header");
    if (body) body.style.display = "block";
    if (header) header.classList.add("open");

    this.currentCycleFilterYM = cycle.targetYM;
    this.renderMonthlyExpensesTable();

    const el = document.getElementById("expander-monthly-expenses");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    this.showToast(`🔍 เลื่อนไปที่ตารางสรุปค่าใช้จ่าย: ${cycle.roundName}`, "info");
  }

  jumpToFilteredExpensesTable() {
    this.closeModal("modal-cycle-expiries");
    this.onAlertBannerClick();
  }

  clearCycleFilter() {
    this.currentCycleFilterYM = null;
    this.renderMonthlyExpensesTable();
    this.showToast("ล้างตัวกรองรอบแจ้งเตือนแล้ว (แสดงทุกรายการ)", "info");
  }

  showExpiryCycleDetails() {
    const cycle = this.getExpiryCycleInfo();
    const data = this.monthlyExpensesData || {};
    const allExpenses = data.expenses || [];
    const isEn = (this.currentLang === "EN");

    const matched = allExpenses.filter(item => {
      const iso = String(item.due_date_iso || "");
      const isMatchYM = iso.startsWith(cycle.targetYM);
      const isOverdueInRound1 = (cycle.roundDay === 1 && item.status_key === "overdue");
      return isMatchYM || isOverdueInRound1;
    });

    const titleEl = document.getElementById("modal-cycle-title");
    if (titleEl) titleEl.textContent = isEn ? `Expiring Documents & Expenses (${cycle.roundNameEn})` : `รายการเอกสารที่ต้องต่ออายุ — ${cycle.roundName}`;

    const subEl = document.getElementById("modal-cycle-subtitle");
    if (subEl) subEl.textContent = isEn 
      ? `Cycle Round: ${cycle.roundDay}th of month | Target month: ${cycle.targetYM}`
      : `รอบการแจ้งเตือนวันที่ ${cycle.roundDay} ของเดือน | เดือนเป้าหมาย: ${cycle.targetYM}`;

    const summaryEl = document.getElementById("modal-cycle-summary-bar");
    const totalAmt = matched.reduce((sum, it) => sum + parseFloat(it.amount || 0), 0);
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <b>${isEn ? 'Cycle Round:' : 'รอบแจ้งเตือน:'}</b> <span style="font-weight:800; color:#EA580C;">${isEn ? cycle.roundNameEn : cycle.roundName}</span>
          </div>
          <div>
            <b>${isEn ? 'Total Items:' : 'รวมทั้งหมด:'}</b> <span style="font-weight:800;">${matched.length} ${isEn ? 'items' : 'รายการ'}</span>
          </div>
          <div>
            <b>${isEn ? 'Total Amount:' : 'ยอดเงินรวม:'}</b> <span style="font-weight:800; color:#15803D;">฿${totalAmt.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
          </div>
        </div>
      `;
    }

    const tbody = document.getElementById("modal-cycle-tbody");
    if (tbody) {
      if (matched.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:32px; color:#64748B;">🎉 ${isEn ? 'No documents expiring in this cycle.' : `ไม่มีเอกสารหรือค่าใช้จ่ายครบกำหนดใน ${cycle.roundName}`}</td></tr>`;
      } else {
        tbody.innerHTML = matched.map((it, idx) => {
          let badgeClass = "badge badge-success";
          let itStatus = it.status;
          if (it.status_key === "overdue" || it.days_left < 0) {
            badgeClass = "badge badge-danger";
            itStatus = isEn ? "Overdue" : "เกินกำหนด";
          } else if (it.status_key === "pending_near" || (it.status_key !== "paid" && it.days_left <= 15)) {
            badgeClass = "badge badge-warning";
            itStatus = isEn ? "Pending (Due Soon)" : "รอชำระ (ใกล้ครบกำหนด)";
          } else if (it.status_key === "pending" || (it.status_key !== "paid" && it.days_left <= 30)) {
            badgeClass = "badge badge-warning";
            itStatus = isEn ? "Pending" : "รอชำระ";
          } else {
            itStatus = isEn ? "Paid" : "ชำระแล้ว";
          }
          return `
            <tr style="background:#ffffff !important;">
              <td style="text-align:center; font-weight:700; color:#64748B; background:#ffffff !important;">${idx + 1}</td>
              <td style="background:#ffffff !important;"><b>${it.plate}</b><br/><small style="color:#64748B;">${it.model}</small></td>
              <td style="background:#ffffff !important;"><b>${it.expense_type}</b></td>
              <td style="text-align:center; font-weight:600; background:#ffffff !important;">${it.due_date || '-'}<br/><small style="color:${it.days_left < 0 ? '#DC2626' : '#64748B'};">${it.notes || ''}</small></td>
              <td style="text-align:right; font-weight:800; color:#0F172A; background:#ffffff !important;">฿${Number(it.amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
              <td style="text-align:center; background:#ffffff !important;"><span class="${badgeClass}">${itStatus}</span></td>
            </tr>
          `;
        }).join("");
      }
    }

    this.openModal("modal-cycle-expiries");
  }


  openTopExpensesModal() {
    const isEn = (this.currentLang === "EN");
    const data = this.monthlyExpensesData || {};
    const allExpenses = data.expenses || [];

    // Map: plate -> { plate, model, company, total, breakdown: [] }
    const carMap = {};

    // 1. Populate all registered cars
    (this.cars || []).forEach(c => {
      const pl = c.id || c.plate;
      if (!pl) return;
      carMap[pl] = {
        plate: pl,
        model: `${c.brand || ''} ${c.model || ''}`.trim() || '-',
        company: c.company || c.owner_company || '-',
        total: 0,
        breakdown: []
      };
    });

    // 2. Aggregate expenses for each car (ภาษี + พ.ร.บ. + ประกัน + ค่างวด)
    allExpenses.forEach(exp => {
      const pl = exp.plate;
      if (!pl) return;
      if (!carMap[pl]) {
        carMap[pl] = {
          plate: pl,
          model: exp.model || '-',
          company: exp.company || '-',
          total: 0,
          breakdown: []
        };
      }
      const amt = parseFloat(exp.amount || 0);
      carMap[pl].total += amt;
      carMap[pl].breakdown.push({
        type: exp.expense_type,
        amount: amt
      });
    });

    // 3. Convert to array and sort descending by total expenses
    const rankedCars = Object.values(carMap);
    rankedCars.sort((a, b) => b.total - a.total);

    const grandTotal = rankedCars.reduce((sum, c) => sum + c.total, 0);

    // 4. Populate Summary Ribbon
    const summaryEl = document.getElementById("modal-top-expenses-summary");
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <b>${isEn ? 'Total Vehicles:' : 'จำนวนรถทั้งหมด:'}</b> <span style="font-weight:800; color:#991B1B;">${rankedCars.length} ${isEn ? 'cars' : 'คัน'}</span>
          </div>
          <div>
            <b>${isEn ? 'Highest Expense Car:' : 'รถที่มีค่าใช้จ่ายสูงสุด:'}</b> <span style="font-weight:800; color:#DC2626;">${rankedCars[0] ? `${rankedCars[0].plate} (฿${rankedCars[0].total.toLocaleString('th-TH', {minimumFractionDigits: 2})})` : '-'}</span>
          </div>
          <div>
            <b>${isEn ? 'Total Fleet Expenses:' : 'ยอดค่าใช้จ่ายรวมทุกคัน:'}</b> <span style="font-weight:800; color:#991B1B;">฿${grandTotal.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>
          </div>
        </div>
      `;
    }

    // 5. Populate Table Body
    const tbody = document.getElementById("modal-top-expenses-tbody");
    if (tbody) {
      if (rankedCars.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; color:#64748B;">${isEn ? 'No vehicle expense data found.' : 'ไม่พบข้อมูลค่าใช้จ่ายรถยนต์'}</td></tr>`;
      } else {
        tbody.innerHTML = rankedCars.map((c, idx) => {
          const rankBadge = idx === 0 
            ? '<span style="font-size:16px;">🥇</span>' 
            : (idx === 1 ? '<span style="font-size:16px;">🥈</span>' : (idx === 2 ? '<span style="font-size:16px;">🥉</span>' : `<span style="font-weight:700; color:#64748B;">#${idx + 1}</span>`));
          const bdText = c.breakdown.length > 0 
            ? c.breakdown.map(b => `<span style="display:inline-block; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:6px; padding:1px 6px; margin:2px;">${b.type}: ฿${Number(b.amount).toLocaleString()}</span>`).join(" ")
            : '<span style="color:#94A3B8;">ไม่มีรายการค้างชำระ</span>';

          return `
            <tr style="background:#ffffff !important;">
              <td style="text-align:center; font-size:14px; background:#ffffff !important;">${rankBadge}</td>
              <td style="background:#ffffff !important;"><b style="font-size:13.5px; color:#0F172A;">${c.plate}</b></td>
              <td style="background:#ffffff !important;"><span style="font-weight:600; color:#334155;">${c.model}</span></td>
              <td style="font-size:11.5px; color:#64748B; background:#ffffff !important;">${bdText}</td>
              <td style="text-align:right; font-weight:800; color:#DC2626; font-size:13.5px; background:#ffffff !important;">฿${c.total.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
            </tr>
          `;
        }).join("");
      }
    }

    this.openModal("modal-top-expenses");
  }

  // --- Unified Monthly Expenses Tracker (ภาษี / พ.ร.บ. / ประกัน / ค่างวด) ---
  async loadMonthlyExpenses() {
    try {
      const res = await fetch(`/api/expenses/monthly?_t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
      });
      if (res.ok) {
        this.monthlyExpensesData = await res.json();
        this.renderMonthlyExpensesTable();
      }
    } catch (e) {
      console.error("loadMonthlyExpenses error:", e);
    }
  }

  renderMonthlyExpensesTable() {
    const data = this.monthlyExpensesData || {};
    const summary = data.summary || {};
    const allExpenses = data.expenses || [];
    const isEn = (this.currentLang === "EN");

    // 1. Render Top Summary Badges Strip
    const cardsEl = document.getElementById("monthly-expenses-summary-cards");
    if (cardsEl) {
      cardsEl.innerHTML = `
        <div style="background:#FEF2F2; border:1px solid #FECACA; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#991B1B; font-weight:700;">📑 ${isEn ? 'Tax Pending' : 'ภาษีประจำปีรอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#DC2626; margin-top:2px;">${summary.tax_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#92400E; font-weight:700;">🛡️ ${isEn ? 'ACT / PRB Pending' : 'พ.ร.บ. รอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#D97706; margin-top:2px;">${summary.act_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#EFF6FF; border:1px solid #BFDBFE; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#1E40AF; font-weight:700;">🚗 ${isEn ? 'Insurance Pending' : 'ประกันภัยรอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#2563EB; margin-top:2px;">${summary.insurance_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#FFF7ED; border:1px solid #FED7AA; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#C2410C; font-weight:700;">💳 ${isEn ? 'Installments Pending' : 'ค่างวดผ่อนรถรอชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#EA580C; margin-top:2px;">${summary.installment_pending || 0} ${isEn ? 'items' : 'คัน'}</div>
        </div>
        <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#166534; font-weight:700;">💰 ${isEn ? 'Total Pending Amount' : 'ยอดรวมที่ต้องชำระรอบนี้'}</div>
          <div style="font-size:18px; font-weight:800; color:#15803D; margin-top:2px;">฿${Number(summary.total_pending_amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
        </div>
      `;
    }

    // Update alert count badge on dashboard
    const cycle = this.getExpiryCycleInfo();
    const cycleMatched = allExpenses.filter(item => {
      const iso = String(item.due_date_iso || "");
      const isMatchYM = iso.startsWith(cycle.targetYM);
      const isOverdueInRound1 = (cycle.roundDay === 1 && item.status_key === "overdue");
      return isMatchYM || isOverdueInRound1;
    });
    const alertCountEl = document.getElementById("dash-alert-count");
    if (alertCountEl) alertCountEl.textContent = cycleMatched.length;

    // Optional active cycle notice banner above table
    let cycleNoticeEl = document.getElementById("monthly-expenses-cycle-notice");
    if (!cycleNoticeEl && cardsEl) {
      cycleNoticeEl = document.createElement("div");
      cycleNoticeEl.id = "monthly-expenses-cycle-notice";
      cardsEl.parentNode.insertBefore(cycleNoticeEl, cardsEl.nextSibling);
    }
    if (this.currentCycleFilterYM && cycleNoticeEl) {
      cycleNoticeEl.style.display = "block";
      cycleNoticeEl.innerHTML = `
        <div style="background:#FFF7ED; border:1px solid #FDBA74; border-radius:8px; padding:8px 14px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div style="font-size:12.5px; color:#C2410C; font-weight:700;">
            🔍 ${isEn ? 'Showing only items for:' : 'กำลังแสดงรายการเฉพาะ:'} <span>${cycle.roundName}</span> (${cycleMatched.length} ${isEn ? 'items' : 'รายการ'})
          </div>
          <button type="button" class="btn btn-sm btn-secondary" onclick="app.clearCycleFilter()" style="padding:3px 10px; font-size:11.5px; font-weight:700;">
            ✕ ${isEn ? 'Clear Filter (Show All)' : 'ล้างตัวกรองรอบนี้ (แสดงทั้งหมด)'}
          </button>
        </div>
      `;
    } else if (cycleNoticeEl) {
      cycleNoticeEl.style.display = "none";
    }

    // 2. Filter Table Items
    const kw = (document.getElementById("expense-search-kw")?.value || "").toLowerCase().trim();
    const typeFilter = document.getElementById("expense-type-filter")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("expense-status-filter")?.value || "ทั้งหมด";

    const filtered = allExpenses.filter(item => {
      if (this.currentCycleFilterYM) {
        const iso = String(item.due_date_iso || "");
        const isMatchYM = iso.startsWith(this.currentCycleFilterYM);
        const isOverdueInRound1 = (cycle.roundDay === 1 && item.status_key === "overdue");
        if (!isMatchYM && !isOverdueInRound1) return false;
      }
      if (kw) {
        const fullTxt = `${item.plate} ${item.model} ${item.company} ${item.expense_type}`.toLowerCase();
        if (!fullTxt.includes(kw)) return false;
      }
      if (typeFilter !== "ทั้งหมด") {
        if (!item.expense_type.includes(typeFilter) && item.expense_key !== typeFilter) return false;
      }
      if (statusFilter !== "ทั้งหมด") {
        if (statusFilter === "รอชำระ" && item.status_key === "paid") return false;
        if (statusFilter === "ชำระแล้ว" && item.status_key !== "paid") return false;
      }
      return true;
    });

    // 3. Render Table Body
    const tbody = document.getElementById("monthly-expenses-tbody");
    if (!tbody) return;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:36px; color:#64748B;">${isEn ? 'No expense items found matching the selected filters.' : '🎉 ไม่มีรายการค่าใช้จ่ายค้างชำระตามตัวกรองที่เลือก'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((item, idx) => {
      let badgeStyle = "background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; font-weight:700;";
      let badgeIcon = "✅";
      let displayStatus = item.status;

      // SINGLE SOURCE OF TRUTH: Directly reflect Backend status & status_key
      if (item.status_key === "paid") {
        badgeStyle = "background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; font-weight:700;";
        badgeIcon = "✅";
        displayStatus = item.status || (isEn ? "Paid" : "ชำระแล้ว");
      } else if (item.status_key === "overdue") {
        badgeStyle = "background:#FEF2F2; color:#991B1B; border:1px solid #FECACA; font-weight:800;";
        badgeIcon = "⚠️";
        displayStatus = item.status || (isEn ? "Overdue" : "เกินกำหนด");
      } else if (item.status_key === "pending_near") {
        badgeStyle = "background:#FFF7ED; color:#C2410C; border:1.5px solid #FDBA74; font-weight:800;";
        badgeIcon = "⏳";
        displayStatus = item.status || (isEn ? "Pending (Due Soon)" : "รอชำระ (ใกล้ครบกำหนด)");
      } else {
        badgeStyle = "background:#FFFBEB; color:#92400E; border:1px solid #FDE68A; font-weight:700;";
        badgeIcon = "⏳";
        displayStatus = item.status || (isEn ? "Pending" : "รอชำระ");
      }

      const safePlate = String(item.plate || "").replace(/'/g, "\\'");
      const isPaid = (item.status_key === "paid");

      return `
        <tr>
          <td style="text-align:center; font-weight:700; color:#64748B;">${idx + 1}</td>
          <td>
            <div style="font-weight:800; color:#1E293B;">🚘 ${item.plate}</div>
            <div style="font-size:12px; color:#475569;">${item.model} <span style="font-size:11px; color:#94A3B8;">(${item.company})</span></div>
          </td>
          <td>
            <span style="font-weight:700; color:#334155; font-size:12px;">${item.expense_type}</span>
          </td>
          <td style="text-align:center;">
            <div style="font-weight:700; color:#1E293B;">📅 ${item.due_date}</div>
            <div style="font-size:11px; color:${item.days_left < 0 ? '#DC2626' : (item.days_left <= 15 ? '#C2410C' : (item.days_left <= 30 ? '#D97706' : '#16A34A'))}; font-weight:600;">
              ${item.notes}
            </div>
          </td>
          <td style="text-align:right; font-weight:800; color:#1E293B; font-size:13px;">
            ฿${Number(item.amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}
          </td>
          <td style="text-align:center;">
            <span style="font-size:11.5px; padding:3px 10px; border-radius:12px; display:inline-block; ${badgeStyle}">
              ${badgeIcon} ${displayStatus}
            </span>
          </td>
          <td style="text-align:center;">
            <button type="button" class="btn btn-sm ${isPaid ? 'btn-secondary' : 'btn-primary'}" onclick="app.payMonthlyExpense('${safePlate}', '${item.expense_key}', ${item.amount || 0}, '${item.due_date}')" style="padding:4px 12px; font-size:11.5px; font-weight:700; border-radius:6px; cursor:pointer;" title="${isEn ? 'Mark as Paid & Extend Expiry Date' : 'บันทึกชำระเงินและต่ออายุวันหมดอายุอัตโนมัติ'}">
              💳 ${isEn ? 'Update Paid' : 'อัปเดตชำระเงิน'}
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async payMonthlyExpense(plate, expenseKey, amount = 0, dueDate = "") {
    if (!plate || !expenseKey) return;
    const isEn = (this.currentLang === "EN");
    const typeLabel = expenseKey === "tax" ? "ภาษีประจำปี" : (expenseKey === "act" ? "พ.ร.บ." : (expenseKey === "insurance" ? "ประกันภัย" : "ค่างวดผ่อนรถ"));
    const conf = confirm(`ยืนยันการบันทึกชำระเงิน "${typeLabel}" สำหรับรถทะเบียน ${plate} หรือไม่?

💰 ยอดเงิน: ฿${Number(amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}
💡 ระบบจะทำการบันทึกลงบัญชีรายจ่าย (financial_records) และต่ออายุรอบถัดไปให้อัตโนมัติ`);
    if (!conf) return;

    try {
      const todayIso = new Date().toISOString().split("T")[0];
      const res = await fetch("/api/expenses/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate: plate,
          car_id: plate,
          expense_type: expenseKey,
          amount: Number(amount || 0),
          payment_date: todayIso,
          due_date: dueDate
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || "เกิดข้อผิดพลาดในการอัปเดต");
      }
      this.showToast(`🎉 ${data.message} (กำหนดใหม่: ${data.new_due_date})`, "success");
      // TARGET MISSION 3: Real-time UI Refresh
      await this.loadMonthlyExpenses();
      await this.loadCars();
      if (this.loadDashboardKPIs) await this.loadDashboardKPIs();
      if (this.loadFinanceSummary) await this.loadFinanceSummary();
    } catch (e) {
      alert(`❌ อัปเดตชำระเงินไม่สำเร็จ:
${e.message}`);
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  computeRenewedDateStr(rawStr) {
    const now = new Date();
    const info = this.parseExpiryDateInfo(rawStr);
    let targetDate = null;

    if (info.valid && info.dateObj) {
      const d = info.dateObj;
      let targetYear = Math.max(d.getFullYear() + 1, now.getFullYear() + 1);
      targetDate = new Date(targetYear, d.getMonth(), d.getDate());
      const diffDays = Math.round((targetDate.getTime() - now.getTime()) / 86400000);
      if (diffDays <= 30) {
        targetDate = new Date(targetYear + 1, d.getMonth(), d.getDate());
      }
    } else {
      targetDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    }

    const dd = String(targetDate.getDate()).padStart(2, "0");
    const mm = String(targetDate.getMonth() + 1).padStart(2, "0");
    const yyyy = targetDate.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  dmyToYmd(dmyStr) {
    if (!dmyStr || dmyStr === "-" || String(dmyStr).trim().toLowerCase() === "none") return "";
    const s = String(dmyStr).trim();
    if (s.includes("-")) {
      const parts = s.split("-");
      if (parts[0].length === 4) {
        let yr = parseInt(parts[0], 10);
        if (yr > 2400) yr -= 543;
        return `${yr}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
      }
      if (parts[2].length === 4) {
        let yr = parseInt(parts[2], 10);
        if (yr > 2400) yr -= 543;
        return `${yr}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      }
    }
    if (s.includes("/")) {
      const parts = s.split("/");
      if (parts.length === 3 && parts[2].length === 4) {
        let yr = parseInt(parts[2], 10);
        if (yr > 2400) yr -= 543;
        return `${yr}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      }
    }
    return "";
  }

  ymdToDmy(ymdStr) {
    if (!ymdStr || ymdStr === "-") return "";
    const s = String(ymdStr).trim();
    if (s.includes("-")) {
      const parts = s.split("-");
      if (parts.length === 3 && parts[0].length === 4) {
        return `${parts[2].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[0]}`;
      }
    }
    return s;
  }

  openRenewalOrderModal(plate, mode = "both") {
    try {
      const car = (this.cars || []).find(c => c.plate === plate);
      if (!car) {
        this.showToast("ไม่พบข้อมูลรถยนต์ " + plate, "danger");
        return;
      }

      const modalTitleEl = document.getElementById("modal-mnt-title");
      if (modalTitleEl) {
        modalTitleEl.textContent = "📋 ออกใบงานมอบหมายต่อทะเบียนภาษี / พ.ร.บ. / ประกันภัย";
      }

      // 1. Populate car select in modal and select target plate
      const carSel = document.getElementById("mnt-car-select");
      if (carSel) {
        const opts = (this.cars || []).map(c => `<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''} (${c.color || ''}) [${c.status}]</option>`);
        carSel.innerHTML = opts.join("");
        carSel.value = plate;
      }

      // 2. Populate worker select
      const workerSel = document.getElementById("mnt-assigned-worker");
      if (workerSel) {
        const userList = (this.users || []).filter(u => u.status === "approved" || !u.status);
        const opts = userList.length > 0
          ? userList.map(u => `<option value="${u.username}">${u.username} (${u.name || u.username}) [${u.role || 'Staff'}]</option>`)
          : [
              '<option value="admin">admin (ผู้ดูแลระบบ (Admin)) [Admin]</option>',
              '<option value="chaiwat.u">chaiwat.u [Staff]</option>',
              '<option value="sam">sam [Staff]</option>',
              '<option value="sucheeda">sucheeda [Staff]</option>',
              '<option value="Chatipat">Chatipat [Staff]</option>'
            ];
        workerSel.innerHTML = opts.join("");
        if (this.user?.username && Array.from(workerSel.options).some(o => o.value === this.user.username)) {
          workerSel.value = this.user.username;
        }
      }

      // 3. Update car details pill & mileage
      this.onMaintenanceCarSelected(plate);

      // 4. Set order type and service description
      let orderType = "ต่อทะเบียนภาษี และ พ.ร.บ.";
      let serviceDesc = "";
      let garageName = "สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 5 (จตุจักร)";
      let garagePhone = "02-271-8888";
      let garageLoc = "กรมการขนส่งทางบก จตุจักร กทม.";
      let costEst = 1500;

      if (mode === "act") {
        orderType = "ต่อทะเบียนภาษี และ พ.ร.บ.";
        serviceDesc = `1. ตรวจสอบเอกสาร และ ชำระภาษีรถยนต์ประจำปี\n2. ต่ออายุ พ.ร.บ. คุ้มครองผู้ประสบภัยจากรถ (วันหมดอายุเดิม: ${car.act_expiry || '-'})\n3. รับป้ายวงกลมแสดงการเสียภาษีและสำเนากรมธรรม์ พ.ร.บ.`;
        garageName = "สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 5 (จตุจักร)";
        garagePhone = "02-271-8888";
        garageLoc = "กรมการขนส่งทางบก จตุจักร กทม.";
        costEst = 1500;
      } else if (mode === "ins") {
        orderType = "ต่อประกันภัยรถยนต์";
        serviceDesc = `1. ต่ออายุกรมธรรม์ประกันภัยรถยนต์ประจำปี (วันหมดอายุเดิม: ${car.ins_expiry || '-'})\n2. ดำเนินการออกกรมธรรม์ความคุ้มครองฉบับใหม่ พร้อมขอใบเสร็จรับเงิน`;
        garageName = "บริษัทประกันภัยรถยนต์ (ตามกรมธรรม์เดิม)";
        garagePhone = "02-123-4567";
        garageLoc = "สำนักงานใหญ่ / ตัวแทนประกันภัย";
        costEst = 15000;
      } else {
        orderType = "ต่อทะเบียนภาษี พ.ร.บ. และ ประกันภัย (แพ็กคู่)";
        serviceDesc = `1. ชำระภาษีรถยนต์ประจำปี + ต่ออายุ พ.ร.บ. (วันหมดอายุเดิม: ${car.act_expiry || '-'})\n2. ต่ออายุกรมธรรม์ประกันภัยรถยนต์ประจำปี (วันหมดอายุเดิม: ${car.ins_expiry || '-'})\n3. รับป้ายวงกลมภาษีและกรมธรรม์ประกันภัยฉบับใหม่`;
        garageName = "สำนักงานขนส่ง และ บริษัทประกันภัย";
        garagePhone = "02-271-8888";
        garageLoc = "สำนักงานขนส่งทางบก / ตัวแทนประกัน";
        costEst = 16500;
      }

      const typeSelect = document.getElementById("mnt-order-type");
      if (typeSelect) {
        let exists = Array.from(typeSelect.options).some(o => o.value === orderType);
        if (!exists) {
          const opt = document.createElement("option");
          opt.value = orderType;
          opt.textContent = `🔄 ${orderType}`;
          typeSelect.appendChild(opt);
        }
        typeSelect.value = orderType;
      }

      const formIdEl = document.getElementById("mnt-form-id");
      if (formIdEl) formIdEl.value = "";
      const itemsEl = document.getElementById("mnt-service-items");
      if (itemsEl) itemsEl.value = serviceDesc;
      const costEl = document.getElementById("mnt-cost");
      if (costEl) costEl.value = costEst;
      const centerEl = document.getElementById("mnt-service-center");
      if (centerEl) centerEl.value = garageName;
      const phoneEl = document.getElementById("mnt-service-phone");
      if (phoneEl) phoneEl.value = garagePhone;
      const locEl = document.getElementById("mnt-service-loc");
      if (locEl) locEl.value = garageLoc;

      const todayStr = new Date().toISOString().split("T")[0];
      const tmrw = new Date();
      tmrw.setDate(tmrw.getDate() + 1);
      const tmrwStr = tmrw.toISOString().split("T")[0];

      const schedDate = document.getElementById("mnt-sched-date");
      if (schedDate) schedDate.value = todayStr;
      const schedTime = document.getElementById("mnt-sched-time");
      if (schedTime) schedTime.value = "09:00";
      const expDate = document.getElementById("mnt-exp-date");
      if (expDate) expDate.value = tmrwStr;
      const expTime = document.getElementById("mnt-exp-time");
      if (expTime) expTime.value = "17:00";

      const notesEl = document.getElementById("mnt-notes");
      if (notesEl) notesEl.value = `มอบหมายพนักงานไปดำเนินการต่อทะเบียน/ประกันภัย ทะเบียน ${car.plate} (เลขตัวถัง: ${car.chassis_no || '-'})`;
      const updateCarCheck = document.getElementById("mnt-update-car-status");
      if (updateCarCheck) updateCarCheck.checked = true;

      // Open Modal
      this.openModal("modal-new-maintenance");
    } catch (err) {
      console.error("Error opening renewal modal:", err);
      alert("เกิดข้อผิดพลาดในการเปิดหน้าต่างใบงาน: " + err.message);
    }
  }

  async quickRenewCarExpiry(plate, field) {
    this.openRenewalOrderModal(plate, field === "act_expiry" ? "act" : "ins");
  }

  async quickRenewBothExpiry(plate) {
    this.openRenewalOrderModal(plate, "both");
  }

  openExpiryModal(plate, field) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    const labelType = field === "tax_expiry" ? "ภาษีรถยนต์" : (field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย");
    const currVal = car[field] || "-";
    const info = this.parseExpiryDateInfo(currVal);

    document.getElementById("expiry-modal-plate").value = plate;
    document.getElementById("expiry-modal-field").value = field;
    document.getElementById("modal-expiry-title").textContent = `🔄 อัปเดตวันหมดอายุ ${labelType} (${plate})`;
    document.getElementById("expiry-modal-car-info").textContent = `🚘 ${plate} — ${car.brand || ''} ${car.model || ''} (${car.company || ''})`;
    document.getElementById("expiry-modal-current-info").textContent = `วันหมดอายุ ${labelType} ปัจจุบัน: ${info.formatted}`;

    // Pre-fill with +1 year from old expiry date by default
    this.applyExpiryPreset("old_1y");
    this.openModal("modal-update-expiry");
  }

  applyExpiryPreset(mode) {
    const plate = document.getElementById("expiry-modal-plate")?.value;
    const field = document.getElementById("expiry-modal-field")?.value;
    const car = (this.cars || []).find(c => c.plate === plate) || {};

    let newDateStr = "";
    if (mode === "old_1y") {
      newDateStr = this.computeRenewedDateStr(car[field]);
    } else {
      const now = new Date();
      const target = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
      const dd = String(target.getDate()).padStart(2, "0");
      const mm = String(target.getMonth() + 1).padStart(2, "0");
      const yyyy = target.getFullYear();
      newDateStr = `${dd}/${mm}/${yyyy}`;
    }

    const parts = newDateStr.split("/");
    const textInput = document.getElementById("expiry-modal-text-input");
    const datePicker = document.getElementById("expiry-modal-date-picker");
    if (textInput) textInput.value = newDateStr;
    if (datePicker && parts.length === 3) {
      datePicker.value = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }
  }

  onExpiryPickerChange(isoVal) {
    if (!isoVal) return;
    const parts = isoVal.split("-");
    if (parts.length === 3) {
      const textInput = document.getElementById("expiry-modal-text-input");
      if (textInput) textInput.value = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }

  async submitExpiryModal() {
    const plate = document.getElementById("expiry-modal-plate")?.value;
    const field = document.getElementById("expiry-modal-field")?.value;
    const rawNew = (document.getElementById("expiry-modal-text-input")?.value || "").trim();
    if (!plate || !field || !rawNew) {
      this.showToast("⚠️ กรุณาระบุวันหมดอายุใหม่", "warning");
      return;
    }

    const parsed = this.parseExpiryDateInfo(rawNew);
    const finalDateStr = parsed.valid ? parsed.formatted : rawNew;
    const labelType = field === "tax_expiry" ? "ภาษีรถยนต์" : (field === "act_expiry" ? "พ.ร.บ." : "ประกันภัย");

    this.closeModal("modal-update-expiry");
    await this.saveCarExpiryUpdate(plate, field, finalDateStr, labelType);
  }

  async saveCarExpiryUpdate(plate, field, newDateStr, labelType) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    // Optimistically update in-memory car object and re-sort table immediately
    car[field] = newDateStr;
    this.renderFleetOverviewTable();

    const otherField = field === "act_expiry" ? "ins_expiry" : "act_expiry";
    const otherLabel = field === "act_expiry" ? "ประกันภัย" : "พ.ร.บ.";
    const otherInfo = this.parseExpiryDateInfo(car[otherField]);
    const sortMode = document.getElementById("dash-fleet-sort-select")?.value || "expiry_asc";

    const payload = Object.assign({}, car, {
      plate: plate,
      [field]: newDateStr
    });

    try {
      const res = await fetch("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        if (sortMode === "expiry_asc" && otherInfo.valid && otherInfo.daysLeft <= 30) {
          this.showToast(`✅ อัปเดต ${labelType} ทะเบียน ${plate} เป็น ${newDateStr} แล้ว (หมายเหตุ: ${otherLabel} ยังหมดอายุ ${otherInfo.formatted} กด 🔄 ที่ ${otherLabel} หรือปุ่ม '🔄 ต่อคู่' เพื่อให้แถวเลื่อนลงไปท้ายตาราง)`, "success");
        } else {
          this.showToast(`✅ อัปเดตวันหมดอายุ ${labelType} ทะเบียน ${plate} เป็น ${newDateStr} เรียบร้อย! (เรียงลำดับตารางใหม่แล้ว)`, "success");
        }
        await this.loadCars();
      } else {
        this.showToast("❌ อัปเดตไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
      }
    } catch (e) {
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  jumpToCarInFrontOffice(plate) {
    const sbSearch = document.getElementById("sb-search-input");
    if (sbSearch) sbSearch.value = plate;
    this.sidebarSearchKw = String(plate || "").toLowerCase().trim();
    this.switchModule("frontoffice");
    this.switchTab("fleet");
    this.renderFleetCards();
    this.showToast(`🚘 ข้ามไปยังข้อมูลรถยนต์ทะเบียน ${plate}`, "info");
  }

  toggleExpander(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;
    const header = card.querySelector(".expander-header");
    const body = card.querySelector(".expander-body");
    const indicator = card.querySelector(".expander-indicator span");
    const isEn = (this.currentLang === "EN");

    const isVisible = body && body.style.display !== "none";
    if (isVisible) {
      if (body) body.style.display = "none";
      if (header) header.classList.remove("open");
      if (indicator) indicator.textContent = isEn ? "▼ Click to expand" : "▼ คลิกเพื่อแสดงเนื้อหา";
    } else {
      if (body) body.style.display = "block";
      if (header) header.classList.add("open");
      if (indicator) indicator.textContent = isEn ? "▲ Click to collapse" : "▲ คลิกเพื่อพับเก็บ";
    }
  }

  toggleFleetTableCollapse() {
    this.toggleExpander("expander-fleet");
  }

  // --- Dashboard Charts Engine (Chart.js) ---
  renderDashboardCharts() {
    this.renderDonutCharts();
    this.renderTrendChart();
  }

  setTrendType(type) {
    this.trendType = type || "bar";
    const btnBar = document.getElementById("btn-trend-bar");
    const btnArea = document.getElementById("btn-trend-area");
    if (this.trendType === "bar") {
      if (btnBar) { btnBar.style.background = "#E85826"; btnBar.style.color = "#FFFFFF"; }
      if (btnArea) { btnArea.style.background = "transparent"; btnArea.style.color = "#6B7280"; }
    } else {
      if (btnArea) { btnArea.style.background = "#E85826"; btnArea.style.color = "#FFFFFF"; }
      if (btnBar) { btnBar.style.background = "transparent"; btnBar.style.color = "#6B7280"; }
    }
    this.renderTrendChart();
  }

    renderDonutCharts() {
    try {
      const canvas = document.getElementById("chart-fleet-status-donut");
      const badge = document.getElementById("donut-total-badge");
      const legend = document.getElementById("fleet-status-legend");
      if (!canvas) {
        console.warn("[Dashboard Donut] Canvas element #chart-fleet-status-donut not found");
        return;
      }
      if (typeof Chart === "undefined") {
        console.warn("[Dashboard Donut] Chart.js library is not loaded");
        return;
      }

      const isEn = (this.currentLang === "EN");
      const data = this.dashboardStats || {};
      const sc = data.status_counts || data.status_breakdown || data.fleet_status_breakdown || {};

      console.log("[Dashboard Donut] Raw API stats received:", data);
      console.log("[Dashboard Donut] Parsed status_counts:", sc);

      // Robust fallback extraction: never NaN or undefined
      let totalCars = Number(data.total_fleet ?? data.total_cars ?? (this.cars || []).length ?? 0);
      let availCount = Number(sc.available ?? data.available ?? data.available_cars ?? 0);
      let rentCount = Number(sc.on_rent ?? sc.rented ?? sc.onRent ?? data.on_rent ?? data.rented_cars ?? 0);
      let bookCount = Number(sc.booked ?? sc.reserved ?? data.booked ?? data.booked_cars ?? 0);
      let maintCount = Number(sc.maintenance ?? sc.maint ?? data.maintenance ?? data.maintenance_cars ?? 0);

      // FOOLPROOF FALLBACK: If status counts from API are all 0 but this.cars exists in memory
      if (availCount === 0 && rentCount === 0 && bookCount === 0 && maintCount === 0 && (this.cars || []).length > 0) {
        console.log("[Dashboard Donut] API returned all 0s, computing counts directly from this.cars:", this.cars.length);
        totalCars = this.cars.length;
        this.cars.forEach(c => {
          const st = String(c.status || c.car_status || "").trim().toLowerCase();
          const fKey = String(c.fleet_status_key || "").trim().toLowerCase();
          const isOnRent = Boolean(c.is_on_rent);
          if (isOnRent || fKey === "on_rent" || fKey === "rented" || st.includes("เช่า") || st.includes("rent") || st.includes("รอรับคืน")) {
            rentCount++;
          } else if (fKey === "maintenance" || fKey === "repair" || st.includes("ซ่อม") || st.includes("ไม่พร้อม") || st.includes("ระงับ") || st.includes("maint") || st.includes("ต่อทะเบียน") || st.includes("ต่อภาษี") || st.includes("workshop") || st.includes("renewal")) {
            const pNorm = String(c.plate || "").replace(/[\s\-\.]+/g, "").toLowerCase();
            const hasActiveMaint = (this.maintenanceRecords || []).some(m => {
              const mpNorm = String(m.car_id || "").replace(/[\s\-\.]+/g, "").toLowerCase();
              const mSt = String(m.status || "").trim();
              return (m.car_id === c.plate || mpNorm === pNorm) && !["เสร็จสิ้น", "ยกเลิก", "completed", "canceled"].includes(mSt.toLowerCase());
            });
            if (hasActiveMaint) {
              maintCount++;
            } else {
              availCount++;
            }
          } else if (fKey === "booked" || fKey === "reserved" || st.includes("จอง") || st.includes("book") || st.includes("reserv") || st.includes("ติดจอง") || st.includes("ส่งมอบ")) {
            bookCount++;
          } else {
            availCount++;
          }
        });
      }

      console.log(`[Dashboard Donut] Final counts => Available: ${availCount}, On Rent: ${rentCount}, Booked: ${bookCount}, Maintenance: ${maintCount}, Total: ${totalCars}`);

      if (badge) {
        badge.textContent = isEn ? `${totalCars} cars` : `${totalCars} คัน`;
      }

      // Safely destroy previous chart instance before re-creating
      if (this.donutChart) {
        try {
          this.donutChart.destroy();
        } catch (e) {
          console.warn("[Dashboard Donut] Error destroying existing chart:", e);
        }
        this.donutChart = null;
      }

      const labels = isEn 
        ? ["Available", "Rented", "Reserved", "Maintenance"]
        : ["ว่างพร้อมให้บริการ", "กำลังเช่า", "ติดจอง", "ซ่อมบำรุง"];
      const colors = ["#10B981", "#3B82F6", "#F59E0B", "#F97316"]; // เขียว, น้ำเงิน, เหลือง, ส้ม

      // If all counts are zero, display a friendly placeholder ring rather than a broken blank canvas
      const isAllZero = (availCount === 0 && rentCount === 0 && bookCount === 0 && maintCount === 0);
      const chartDataArr = isAllZero ? [1] : [availCount, rentCount, bookCount, maintCount];
      const chartColors = isAllZero ? ["#E2E8F0"] : colors;
      const chartLabels = isAllZero ? (isEn ? ["No data"] : ["ไม่มีข้อมูลรถ"]) : labels;

      this.donutChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: chartLabels,
          datasets: [{
            data: chartDataArr,
            backgroundColor: chartColors,
            borderColor: '#FFFFFF',
            borderWidth: 2,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '80%', // Minimalist thin donut ring
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: !isAllZero,
              callbacks: {
                label: function(ctx) {
                  const val = ctx.raw || 0;
                  const pct = totalCars > 0 ? ((val / totalCars) * 100).toFixed(1) : "0.0";
                  return isEn ? ` ${ctx.label}: ${val} cars (${pct}%)` : ` ${ctx.label}: ${val} คัน (${pct}%)`;
                }
              }
            }
          }
        }
      });

      if (legend) {
        const dataArr = [availCount, rentCount, bookCount, maintCount];
        legend.className = "grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-slate-100";
        legend.style.display = "grid";
        legend.style.gridTemplateColumns = "repeat(2, 1fr)";
        legend.style.gap = "6px 12px";
        legend.innerHTML = labels.map((lbl, idx) => {
          const val = dataArr[idx];
          const pct = totalCars > 0 ? ((val / totalCars) * 100).toFixed(1) : "0.0";
          const cDot = colors[idx];
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:4px 8px; background:#F8FAFC; border-radius:6px; border:1px solid #F1F5F9;">
              <span style="display:inline-flex; align-items:center; gap:5px; color:#475569;">
                <span style="color:${cDot}; font-size:13px; line-height:1;">●</span>
                <span style="font-weight:600;">${lbl}</span>
              </span>
              <span style="font-weight:700; color:#1E293B;">
                ${val} ${isEn ? 'cars' : 'คัน'} <span style="font-weight:400; color:#94A3B8; font-size:11px;">(${pct}%)</span>
              </span>
            </div>
          `;
        }).join("");
      }
    } catch (err) {
      console.error("[Dashboard Donut] Error in renderDonutCharts:", err);
    }
  }

  renderTrendChart() {
    const canvas = document.getElementById("chart-revenue-trend");
    if (!canvas || typeof Chart === "undefined") return;

    const isEn = (this.currentLang === "EN");
    const thMonthNames = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const enMonthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthNames = isEn ? enMonthNames : thMonthNames;

    let labels = [];
    let dataRev = [];

    if (this.dashboardStats && this.dashboardStats.monthly_trend && this.dashboardStats.monthly_trend.length > 0) {
      const mt = this.dashboardStats.monthly_trend;
      labels = mt.map(b => isEn ? `${enMonthNames[b.month]} ${b.year}` : `${b.month}. ${thMonthNames[b.month]}`);
      dataRev = mt.map(b => Number(b.revenue || 0));
    } else {
      const now = new Date();
      const monthBins = [];
      for (let i = 5; i >= 0; i--) {
        let m = now.getMonth() + 1 - i;
        let y = now.getFullYear();
        while (m <= 0) {
          m += 12;
          y -= 1;
        }
        monthBins.push({
          label: isEn ? `${monthNames[m]} ${y}` : `${m}. ${monthNames[m]}`,
          month: m,
          year: y,
          rev: 0,
          jobs: 0
        });
      }

      (this.completedJobs || []).forEach(item => {
        const dStr = String(item.completed_date || item.end_date || "");
        let dObj = null;
        if (dStr.includes("-")) {
          const p = dStr.split("-");
          if (p.length >= 3) dObj = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
        } else if (dStr.includes("/")) {
          const p = dStr.split("/");
          if (p.length >= 3) dObj = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
        }
        if (dObj && !isNaN(dObj.getTime())) {
          const m = dObj.getMonth() + 1;
          const y = dObj.getFullYear();
          const mb = monthBins.find(b => b.month === m && b.year === y);
          if (mb) {
            mb.rev += parseFloat(item.net_price || 0);
            mb.jobs += 1;
          }
        }
      });

      labels = monthBins.map(b => b.label);
      dataRev = monthBins.map(b => b.rev);
    }

    if (this.trendChart) {
      this.trendChart.destroy();
    }

    const isBar = (this.trendType || "bar") === "bar";

    const sumPill = document.getElementById("trend-summary-pill");
    if (sumPill) {
      const totalPeriodRev = dataRev.reduce((a, b) => a + Number(b || 0), 0);
      sumPill.textContent = (isEn ? "Period Rev: " : "รวม 6 เดือน: ") + "฿" + totalPeriodRev.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    }

    this.trendChart = new Chart(canvas, {
      type: isBar ? 'bar' : 'line',
      data: {
        labels: labels,
        datasets: [{
          label: isEn ? 'Total Revenue (THB)' : 'รายรับรวม (THB)',
          data: dataRev,
          backgroundColor: isBar ? '#E85826' : 'rgba(232, 88, 38, 0.12)',
          borderColor: '#E85826',
          borderWidth: isBar ? 0 : 3,
          borderRadius: isBar ? 6 : 0,
          fill: !isBar,
          tension: 0.35,
          pointRadius: isBar ? 0 : 5,
          pointBackgroundColor: '#E85826',
          pointHoverRadius: isBar ? 0 : 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const idx = ctx.dataIndex;
                const val = ctx.raw || 0;
                const jCount = dataJobs[idx] || 0;
                return isEn ? [
                  ` Total Revenue: ฿${val.toLocaleString()} THB`,
                  ` Jobs Completed: ${jCount} jobs`
                ] : [
                  ` รายรับรวม: ฿${val.toLocaleString()} บาท`,
                  ` จำนวนงาน: ${jCount} งาน`
                ];
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(val) {
                return '฿' + (val >= 1000 ? (val/1000) + 'k' : val);
              }
            },
            grid: { color: '#F3EDE4' }
          },
          x: {
            grid: { display: false }
          }
        }
      }
    });
  }

  renderCompletedJobsTable() {
    const tbody = document.getElementById("completed-jobs-tbody");
    if (!tbody) return;

    const compFilter = document.getElementById("report-company-filter")?.value || "ทั้งหมด";
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();

    const filtered = (this.completedJobs || []).filter(j => {
      if (compFilter !== "ทั้งหมด" && !this.matchesCompanyScope(j.company, compFilter)) {
        return false;
      }
      if (sbKw) {
        const s = `${j.booking_id || ''} ${j.car_id || ''} ${j.customer || ''} ${j.worker_delivery || ''} ${j.worker_return || ''} ${j.company || ''}`.toLowerCase();
        if (!s.includes(sbKw)) return false;
      }
      return true;
    });

    // Update Expander Title Count
    const isEn = (this.currentLang === "EN");
    const titleEl = document.getElementById("title-expander-completed");
    if (titleEl) {
      titleEl.textContent = isEn
        ? `Completed Jobs Archive & Monthly Reports — (${filtered.length} Records)`
        : `คลังประวัติงานเสร็จสิ้น & รีพอร์ตรายเดือน (Completed Jobs Archive) — (${filtered.length} รายการ)`;
    }

    // Update 4 Monthly Summary KPI Cards (matching app.py lines 7344-7378)
    const totalJobsCnt = filtered.length;
    const totalRevSum = filtered.reduce((sum, x) => sum + parseFloat(x.net_price || 0), 0);
    const uniqueCarsCnt = new Set(filtered.map(x => x.car_id).filter(Boolean)).size;
    const uniqueCustCnt = new Set(filtered.map(x => x.customer).filter(Boolean)).size;

    const elJobs = document.getElementById("rpt-kpi-jobs");
    const elRev = document.getElementById("rpt-kpi-rev");
    const elCars = document.getElementById("rpt-kpi-cars");
    const elCusts = document.getElementById("rpt-kpi-custs");

    if (elJobs) elJobs.innerHTML = `${totalJobsCnt} <span style="font-size:13px; font-weight:500;">${isEn ? 'jobs' : 'งาน'}</span>`;
    if (elRev) elRev.textContent = `฿${totalRevSum.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elCars) elCars.innerHTML = `${uniqueCarsCnt} <span style="font-size:13px; font-weight:500;">${isEn ? 'cars' : 'คัน'}</span>`;
    if (elCusts) elCusts.innerHTML = `${uniqueCustCnt} <span style="font-size:13px; font-weight:500;">${isEn ? 'customers' : 'ราย'}</span>`;

    const photosContainer = document.getElementById("completed-jobs-photos-container");

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding:30px; color:#64748B;">${isEn ? '💡 No completed jobs archive data available in the system.' : '💡 ยังไม่มีข้อมูลประวัติงานที่เสร็จสิ้นในระบบครับ'}</td></tr>`;
      if (photosContainer) photosContainer.innerHTML = "";
      return;
    }

    tbody.innerHTML = filtered.map(j => {
      const custObj = (this.customers || []).find(c => c.full_name === j.customer) || {};
      const phone = custObj.contact_no && custObj.contact_no !== "-" ? `<div style="font-size:11px; color:#64748B;">📞 ${custObj.contact_no}</div>` : "";
      const locStr = j.loc_return || j.loc_delivery || "-";
      const photos = Array.isArray(j.inspection_photos) ? j.inspection_photos : [];
      const pBadge = photos.length > 0
        ? `<span style="background:#E0E7FF; color:#4338CA; padding:2px 7px; border-radius:10px; font-size:11px; font-weight:700; margin-left:4px;">📸 ${photos.length} ${isEn ? 'photos' : 'รูป'}</span>`
        : "";
      let cType = j.contract_type || 'รายวัน';
      if (isEn) {
        if (cType === 'รายวัน') cType = 'Daily';
        else if (cType === 'รายสัปดาห์') cType = 'Weekly';
        else if (cType === 'รายเดือน') cType = 'Monthly';
      }
      let fuelDisp = j.fuel_level || (isEn ? '⛽ Full Tank (100%)' : '⛽ เต็มถัง (100%)');
      if (isEn && fuelDisp.includes('เต็มถัง')) {
        fuelDisp = fuelDisp.replace('เต็มถัง', 'Full Tank');
      }
      const notes = j.inspection_notes || (isEn ? "Normal inspection" : "ตรวจสภาพปกติ");

      return `
        <tr>
          <td><b style="color:#D97706;">${j.booking_id}</b></td>
          <td style="white-space:nowrap;">📅 ${j.completed_date || j.end_date || '-'}</td>
          <td style="white-space:nowrap;"><b>🚘 ${j.car_id}</b></td>
          <td>
            <b>👤 ${j.customer}</b>
            ${phone}
          </td>
          <td>${j.company || '-'}</td>
          <td><span class="badge badge-gray">${cType}</span></td>
          <td style="text-align:right; font-weight:700; color:#E85826;">฿${parseFloat(j.net_price || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
          <td style="font-size:12px;">${j.worker_delivery || '-'} / ${j.worker_return || '-'}</td>
          <td style="font-size:12px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${locStr}">${locStr}</td>
          <td>
            <div style="font-size:12px; white-space:nowrap;"><b>${fuelDisp}</b>${pBadge}</div>
            <div style="font-size:11px; color:#64748B; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${notes}">${notes}</div>
          </td>
          <td><span class="badge badge-success">${isEn ? 'Completed' : 'เสร็จสิ้น'}</span></td>
          <td style="text-align:center; white-space:nowrap;">
            <a href="/api/pdf/contract/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Download Rental Agreement PDF' : 'โหลดสัญญาเช่า PDF'}">📝</a>
            <a href="/api/pdf/receipt/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Download Receipt PDF' : 'โหลดใบเสร็จ PDF'}">🧾</a>
            <a href="/api/pdf/job/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Download Vehicle Checklist PDF' : 'โหลดลิสต์ตรวจเช็ครถ PDF'}">📋</a>
          </td>
        </tr>
      `;
    }).join("");

    // Render Collapsible Photo Gallery if any completed job has inspection photos (matching app.py lines 7468-7479)
    if (photosContainer) {
      const jobsWithPhotos = filtered.filter(j => Array.isArray(j.inspection_photos) && j.inspection_photos.length > 0);
      if (jobsWithPhotos.length === 0) {
        photosContainer.innerHTML = "";
      } else {
        const totalPhotoCnt = jobsWithPhotos.reduce((acc, j) => acc + j.inspection_photos.length, 0);
        const galleryItems = jobsWithPhotos.map(j => {
          const imgsHtml = j.inspection_photos.map(p => {
            const src = typeof p === "string" ? p : (p.data || p.url || "");
            const cap = typeof p === "object" && p.name ? p.name : (isEn ? "Vehicle inspection photo" : "ภาพสภาพรถ");
            return `
              <div style="border:1px solid #E2E8F0; border-radius:8px; padding:6px; background:#FFFFFF; text-align:center;">
                <a href="${src}" target="_blank">
                  <img src="${src}" alt="${cap}" style="width:100%; height:130px; object-fit:cover; border-radius:6px;">
                </a>
                <div style="font-size:11px; color:#64748B; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${cap}</div>
              </div>
            `;
          }).join("");

          return `
            <div style="margin-bottom:14px;">
              <div style="font-size:13px; font-weight:700; color:#1F2937; margin-bottom:6px;">
                🚘 ${j.car_id} | ${isEn ? 'Booking:' : 'รหัส:'} ${j.booking_id} (${j.customer}) — ${isEn ? 'Fuel Level:' : 'ระดับน้ำมัน:'} ${j.fuel_level || '-'}
              </div>
              <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:10px;">
                ${imgsHtml}
              </div>
            </div>
          `;
        }).join("");

        photosContainer.innerHTML = `
          <details style="background:#F8FAFC; border:1px solid #E2E8F0; border-radius:10px; padding:10px 14px;">
            <summary style="cursor:pointer; font-weight:700; font-size:13px; color:#334155;">
              📸 ${isEn ? 'Vehicle Inspection & Fuel Gauge Photos on Return' : 'คลังรูปภาพสภาพรถ & เกจ์น้ำมันตอนส่งงานปิดจ๊อบ'} (${totalPhotoCnt} ${isEn ? 'Photos' : 'รูป'}) — ${isEn ? 'Click to view evidence photos' : 'คลิกเพื่อดูภาพหลักฐาน'}
            </summary>
            <div style="margin-top:12px;">
              ${galleryItems}
            </div>
          </details>
        `;
      }
    }
  }

  async triggerLineExpiryCheck() {
    this.showToast("📲 กำลังตรวจสอบวันหมดอายุ พ.ร.บ./ประกันภัย และส่ง LINE...", "info");
    try {
      const res = await fetch("/api/line/check-expiry", { method: "POST" });
      const data = await res.json();
      if (data.sent) {
        this.showToast(`🚨 ส่งการแจ้งเตือนทาง LINE สำเร็จ: ${data.count} รายการ!`, "success");
      } else {
        this.showToast(data.message || "ไม่มีรายการครบกำหนดแจ้งเตือนในวันนี้", "info");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  // --- Admin Users Rendering ---
  renderUsersTable() {
    const tbody = document.getElementById("users-table-tbody");
    if (!tbody) return;

    tbody.innerHTML = this.users.map(u => {
      const isPending = u.status === "pending";
      const lineId = (u.line_user_id || "").trim();
      const shortLineId = lineId.length > 14 ? `${lineId.slice(0, 8)}...${lineId.slice(-4)}` : lineId;
      const lineBadge = lineId
        ? `<span class="badge badge-success" title="${lineId}">🟢 ผูกแล้ว (${shortLineId})</span>`
        : `<span class="badge badge-gray">⚪ ยังไม่ได้ผูก LINE ID</span>`;
      return `
        <tr>
          <td><b>${u.username}</b></td>
          <td>${u.name || '-'}</td>
          <td><span class="badge badge-info">${u.role || 'Staff'}</span></td>
          <td>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${lineBadge}
              <button onclick="app.editUserLineId('${u.username}', '${lineId}')" class="btn btn-sm btn-secondary" style="padding:2px 8px; font-size:11px;">🔗 ตั้งค่า LINE ID</button>
              ${lineId ? `<button onclick="app.testUserLinePush('${u.username}')" class="btn btn-sm btn-primary" style="padding:2px 8px; font-size:11px;" title="ทดสอบยิงข้อความตรงหาผู้ใช้นี้">📨 ทดสอบ</button>` : ''}
            </div>
          </td>
          <td>
            <span class="badge ${isPending ? 'badge-danger' : 'badge-success'}">
              ${isPending ? '⏳ รออนุมัติ' : '✅ ใช้งานได้'}
            </span>
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${isPending ? `<button onclick="app.approveUser('${u.username}')" class="btn btn-sm btn-success">อนุมัติ</button>` : `<button onclick="app.rejectUser('${u.username}')" class="btn btn-sm btn-secondary">ระงับ</button>`}
            ${u.username !== 'admin' ? `<button onclick="app.deleteUser('${u.username}')" class="btn btn-sm btn-danger">ลบ</button>` : ''}
          </td>
        </tr>
      `;
    }).join("");
  }

  async editUserLineId(un, currentId = "") {
    const input = prompt(`กรอกรหัส LINE User ID ของ "${un}" (เช่น Uxxxxxxxx...)
(เว้นว่างเพื่อยกเลิกการผูก LINE ID):`, currentId || "");
    if (input === null) return;
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(un)}/line-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ line_user_id: input.trim() })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ บันทึก LINE User ID สำหรับ ${un} เรียบร้อย`, "success");
        await this.loadUsers();
      } else {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async testUserLinePush(un) {
    try {
      this.showToast(`📲 กำลังส่งข้อความทดสอบหา ${un}...`, "info");
      const res = await fetch(`/api/users/${encodeURIComponent(un)}/test-line`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(`✅ ส่งข้อความ LINE ตรงหา ${un} สำเร็จ! (ใช้เพียง 1 ข้อความ)`, "success");
      } else {
        throw new Error(data.detail || "ส่งข้อความไม่สำเร็จ กรุณาตรวจสอบ LINE User ID");
      }
    } catch (e) {
      this.showToast("ส่งไม่สำเร็จ: " + e.message, "danger");
    }
  }

  async approveUser(un) {
    await fetch(`/api/users/${un}/approve`, { method: "POST" });
    this.showToast(`อนุมัติผู้ใช้ ${un} เรียบร้อย`, "success");
    await this.loadUsers();
  }

  async rejectUser(un) {
    await fetch(`/api/users/${un}/reject`, { method: "POST" });
    this.showToast(`ระงับสิทธิ์ ${un} เรียบร้อย`, "info");
    await this.loadUsers();
  }

  async deleteUser(un) {
    if (!confirm(`ต้องการลบบัญชี ${un}?`)) return;
    await fetch(`/api/users/${un}`, { method: "DELETE" });
    this.showToast(`ลบบัญชี ${un} เรียบร้อย`, "success");
    await this.loadUsers();
  }

  // --- Authentication Gate & Session Management ---
  setGateMode(mode) {
    const loginBox = document.getElementById("gate-mode-login");
    const regBox = document.getElementById("gate-mode-register");
    const forgotBox = document.getElementById("gate-mode-forgot");
    if (loginBox) loginBox.style.display = mode === "login" ? "block" : "none";
    if (regBox) regBox.style.display = mode === "register" ? "block" : "none";
    if (forgotBox) forgotBox.style.display = mode === "forgot" ? "block" : "none";

    ["login", "reg", "forgot"].forEach(m => {
      const el = document.getElementById(`gate-${m}-alert`);
      if (el) { el.style.display = "none"; el.textContent = ""; }
    });
  }

  showGateAlert(mode, type, msg) {
    const el = document.getElementById(`gate-${mode}-alert`);
    if (!el) return;
    el.className = `gate-alert ${type}`;
    el.textContent = msg;
    el.style.display = "block";
  }

  async submitGateLogin() {
    const unInput = document.getElementById("gate-login-username");
    const pwInput = document.getElementById("gate-login-password");
    const btn = document.getElementById("btn-gate-submit-login");
    const un = (unInput?.value || "").trim();
    const pw = (pwInput?.value || "").trim();

    if (!un || !pw) {
      this.showGateAlert("login", "error", "กรุณากรอกชื่อผู้ใช้งานและรหัสผ่าน");
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = "⏳ กำลังเข้าสู่ระบบ...";
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, password: pw })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      }

      this.user = data.user;
      sessionStorage.setItem("sawasdee_user", JSON.stringify(this.user));
      sessionStorage.setItem("sawasdee_login_time", Date.now().toString());
      localStorage.removeItem("sawasdee_user");
      this.updateAuthUI();
      this.showToast(`เข้าสู่ระบบสำเร็จในฐานะ: ${this.user.name || this.user.username} ☁️`, "success");

      // Load all data after login
      await this.fetchInitialData();
      this.startLiveSyncPoller();
    } catch (err) {
      this.showGateAlert("login", "error", "❌ " + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "⚡ เข้าสู่ระบบ (Login)";
      }
    }
  }

  async submitGateRegister() {
    const un = (document.getElementById("gate-reg-username")?.value || "").trim();
    const fn = (document.getElementById("gate-reg-fullname")?.value || "").trim();
    const lineId = (document.getElementById("gate-reg-line-id")?.value || "").trim();
    const p1 = (document.getElementById("gate-reg-password")?.value || "").trim();
    const p2 = (document.getElementById("gate-reg-password2")?.value || "").trim();

    if (!un) {
      this.showGateAlert("reg", "error", "กรุณากรอกชื่อผู้ใช้งาน (Username)");
      return;
    }
    if (!fn) {
      this.showGateAlert("reg", "error", "กรุณากรอกชื่อ-นามสกุลจริง");
      return;
    }
    if (!lineId) {
      this.showGateAlert("reg", "error", "กรุณากรอกไอดีไลน์ (LINE ID / LINE User ID) เพื่อใช้รับแจ้งเตือนใบงาน");
      return;
    }
    if (p1 !== p2) {
      this.showGateAlert("reg", "error", "รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }
    if (p1.length < 6) {
      this.showGateAlert("reg", "error", "รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
      return;
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, name: fn, line_user_id: lineId, password: p1 })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "ไม่สามารถลงทะเบียนได้");
      }
      this.showGateAlert("reg", "success", "✅ " + (data.message || "ลงทะเบียนสำเร็จ รอ Admin อนุมัติ"));
      setTimeout(() => {
        this.setGateMode("login");
        const uInp = document.getElementById("gate-login-username");
        if (uInp) uInp.value = un;
      }, 1500);
    } catch (err) {
      this.showGateAlert("reg", "error", "❌ " + err.message);
    }
  }

  async submitGateForgot() {
    const un = (document.getElementById("gate-forgot-username")?.value || "").trim();
    const oldP = (document.getElementById("gate-forgot-old-password")?.value || "").trim();
    const newP = (document.getElementById("gate-forgot-new-password")?.value || "").trim();

    if (!un || !newP) {
      this.showGateAlert("forgot", "error", "กรุณากรอกข้อมูลให้ครบถ้วน");
      return;
    }
    if (newP.length < 6) {
      this.showGateAlert("forgot", "error", "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
      return;
    }

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: un, old_password: oldP, new_password: newP })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "ไม่สามารถเปลี่ยนรหัสผ่านได้");
      }
      this.showGateAlert("forgot", "success", "✅ เปลี่ยนรหัสผ่านสำเร็จเรียบร้อย กรุณาเข้าสู่ระบบใหม่");
      setTimeout(() => {
        this.setGateMode("login");
      }, 1500);
    } catch (err) {
      this.showGateAlert("forgot", "error", "❌ " + err.message);
    }
  }

  handleSidebarSearch(kw) {
    this.sidebarSearchKw = (kw || "").trim().toLowerCase();
    this.renderFleetCards();
    if (this.activeModule === "backoffice") {
      this.renderBackOfficeJobs();
    }
  }

  logout() {
    this.user = null;
    sessionStorage.removeItem("sawasdee_user");
    sessionStorage.removeItem("sawasdee_login_time");
    localStorage.removeItem("sawasdee_user");
    this.updateAuthUI();
    const isEn = (this.currentLang === "EN");
    this.showToast(isEn ? "Signed out successfully" : "ออกจากระบบเรียบร้อย", "info");
  }

  // --- Maintenance & Service Module Methods ---
  formatDateDmy(dateVal) {
    if (!dateVal) return "-";
    try {
      const s = String(dateVal).split("T")[0];
      if (s.includes("-")) {
        const parts = s.split("-");
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return s;
    } catch (e) {
      return String(dateVal);
    }
  }

  async loadMaintenanceRecords() {
    try {
      const res = await fetch("/api/maintenance");
      if (res.ok) {
        this.maintenanceRecords = await res.json();
        const badge = document.getElementById("badge-maintenance-jobs");
        const activeCount = this.maintenanceRecords.filter(m => m.status !== "เสร็จสิ้น" && m.status !== "ยกเลิก").length;
        if (badge) badge.textContent = activeCount;
        this.populateMaintenanceDropdowns();
        this.renderMaintenanceRecords();
      }
    } catch (e) {
      console.error("loadMaintenanceRecords error:", e);
    }
  }

  populateMaintenanceDropdowns() {
    const carSel = document.getElementById("mnt-filter-car");
    if (carSel) {
      const cur = carSel.value;
      const isEn = (this.currentLang === "EN");
      const opts = [`<option value="ทั้งหมด">${isEn ? 'All Vehicles' : 'ทุกคัน'}</option>`];
      (this.cars || []).forEach(c => {
        opts.push(`<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''}</option>`);
      });
      carSel.innerHTML = opts.join("");
      if (cur) carSel.value = cur;
    }
  }

  renderMaintenanceRecords() {
    const tbody = document.getElementById("maintenance-records-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("mnt-search-input")?.value || "").toLowerCase().trim();
    const typeFilter = document.getElementById("mnt-filter-type")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("mnt-filter-status")?.value || "ทั้งหมด";
    const carFilter = document.getElementById("mnt-filter-car")?.value || "ทั้งหมด";

    // KPIs calculation
    const allRecords = this.maintenanceRecords || [];
    const inProg = allRecords.filter(m => m.status === "กำลังซ่อมบำรุง").length;
    const pending = allRecords.filter(m => m.status === "รอดำเนินการ").length;
    const totalCost = allRecords.reduce((sum, m) => sum + Number(m.actual_cost || m.cost || 0), 0);
    const renewals = allRecords.filter(m => {
      const t = String(m.order_type || "");
      return t.includes("ต่อทะเบียน") || t.includes("พ.ร.บ.") || t.includes("พรบ") || t.includes("ประกัน");
    }).length;

    const isEn = (this.currentLang === "EN");
    const carUnit = isEn ? "cars" : "คัน";
    const jobUnit = isEn ? "jobs" : "รายการ";

    const elInProg = document.getElementById("mnt-kpi-in-progress");
    if (elInProg) elInProg.innerHTML = `${inProg} <span style="font-size:13px; font-weight:500; color:#64748B;">${carUnit}</span>`;
    const elPending = document.getElementById("mnt-kpi-pending");
    if (elPending) elPending.innerHTML = `${pending} <span style="font-size:13px; font-weight:500; color:#64748B;">${jobUnit}</span>`;
    const elCost = document.getElementById("mnt-kpi-total-cost");
    if (elCost) elCost.textContent = `฿${totalCost.toLocaleString()}`;
    const elRen = document.getElementById("mnt-kpi-renewals");
    if (elRen) elRen.innerHTML = `${renewals} <span style="font-size:13px; font-weight:500; color:#64748B;">${jobUnit}</span>`;

    // Filter records
    const filtered = allRecords.filter(m => {
      if (carFilter !== "ทั้งหมด" && m.car_id !== carFilter) return false;
      if (statusFilter !== "ทั้งหมด" && m.status !== statusFilter) return false;
      if (typeFilter !== "ทั้งหมด") {
        if (!String(m.order_type || "").includes(typeFilter)) return false;
      }
      if (kw) {
        const s = `${m.id || ''} ${m.car_id || ''} ${m.car_brand || ''} ${m.car_model || ''} ${m.service_center || ''} ${m.service_items || ''} ${m.assigned_worker || ''} ${m.notes || ''}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    const countTxt = document.getElementById("mnt-table-count");
    if (countTxt) countTxt.textContent = filtered.length;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:32px; color:#64748B;">${isEn ? 'No maintenance work orders match the selected filters' : 'ไม่พบรายการใบงานซ่อมบำรุงตามเงื่อนไขที่เลือก'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(m => {
      const isRenewal = String(m.order_type || "").includes("ต่อทะเบียน") || String(m.order_type || "").includes("พ.ร.บ.") || String(m.order_type || "").includes("ประกัน");
      let typeBadge = '';
      if (isRenewal) {
        typeBadge = '<span class="badge" style="background:#F0FDF4; color:#15803D; border:1px solid #BBF7D0; font-weight:700;">' + m.order_type + '</span>';
      } else {
        typeBadge = '<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-weight:700;">' + m.order_type + '</span>';
      }

      let statusBadge = '';
      if (m.status === "เสร็จสิ้น") {
        statusBadge = `<span class="badge badge-success">${isEn ? '✅ Completed' : '✅ เสร็จสิ้น'}</span>`;
      } else if (m.status === "กำลังซ่อมบำรุง") {
        statusBadge = `<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74;">${isEn ? '🛠️ In Repair' : '🛠️ กำลังซ่อมบำรุง'}</span>`;
      } else if (m.status === "กำลังต่อภาษี/ประกัน") {
        statusBadge = `<span class="badge" style="background:#FEF3C7; color:#D97706; border:1px solid #FCD34D;">${isEn ? '⏳ Renewing Tax/Ins.' : '⏳ กำลังต่อภาษี/ประกัน'}</span>`;
      } else {
        statusBadge = `<span class="badge badge-warning">${isEn ? '⏳ Pending' : '⏳ ' + m.status}</span>`;
      }

      const costDisp = Number(m.actual_cost || m.cost || 0);
      const schedStr = `${this.formatDateDmy(m.schedule_date)} ➔ ${this.formatDateDmy(m.expected_finish_date)}`;

      const pdfBtnText = isEn ? "Work Order PDF" : "ใบงาน PDF";
      const finishBtnText = isRenewal ? (isEn ? 'Submit & Renew' : 'ส่งงาน/อัปเดตวัน') : (isEn ? 'Close Job' : 'ปิดงาน');
      const finishBtnTitle = isRenewal ? (isEn ? 'Submit job & specify new expiry date' : 'ส่งงาน & ระบุวันหมดอายุใหม่') : (isEn ? 'Inspect car & close work order' : 'ตรวจรับรถ & ปิดงาน');

      return `
        <tr>
          <td><b style="color:#C2410C;">${m.id}</b></td>
          <td>
            <b style="font-size:13px; color:#1F2937;">${m.car_id}</b><br/>
            <span style="font-size:11.5px; color:#64748B;">${m.car_brand || ''} ${m.car_model || ''} (${m.car_color || '-'})</span>
          </td>
          <td>${typeBadge}</td>
          <td style="max-width:200px; white-space:pre-wrap; font-size:12px; line-height:1.4;">${m.service_items || '-'}</td>
          <td><b style="color:#047857; font-size:13px;">฿${costDisp.toLocaleString()}</b></td>
          <td>
            <b style="color:#1F2937; font-size:12.5px;">${m.service_center || '-'}</b><br/>
            ${m.service_center_phone && m.service_center_phone !== '-' ? `<a href="tel:${m.service_center_phone}" style="color:#2563EB; font-size:11.5px; text-decoration:none;">${m.service_center_phone}</a>` : ''}
          </td>
          <td><span style="font-weight:600; color:#334155; font-size:12px;">${m.assigned_worker || '-'}</span></td>
          <td style="font-size:11.5px; color:#475569;">${schedStr}</td>
          <td>${statusBadge}</td>
          <td style="text-align:center; white-space:nowrap;">
            <a href="/api/pdf/maintenance/${m.id}" target="_blank" class="btn btn-sm btn-secondary" title="${pdfBtnText}">${pdfBtnText}</a>
            ${m.status !== "เสร็จสิ้น" ? `
              <button onclick="app.openCloseMaintenanceModal('${m.id}')" class="btn btn-sm btn-success" style="font-weight:700;" title="${finishBtnTitle}">
                ${finishBtnText}
              </button>
            ` : ''}
            <button onclick="app.openEditMaintenanceModal('${m.id}')" class="btn btn-sm btn-secondary" title="${isEn ? 'Edit Order' : 'แก้ไขใบงาน'}">✏️</button>
            <button onclick="app.deleteMaintenanceRecord('${m.id}')" class="btn btn-sm btn-danger" title="${isEn ? 'Delete Order' : 'ลบใบงาน'}">🗑️</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  populateMaintenanceCars(searchKw = "") {
    const listEl = document.getElementById("mnt-car-dropdown-list");
    const carSel = document.getElementById("mnt-car-select");
    const currentCarId = carSel ? carSel.value : "";

    // Always keep hidden #mnt-car-select populated with options for 100% backward compatibility
    if (carSel) {
      const opts = (this.cars || []).map(c => `<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''} (${c.color || ''}) [${c.status}]</option>`);
      carSel.innerHTML = opts.join("");
      if (currentCarId) carSel.value = currentCarId;
    }

    if (!listEl) return;
    const kw = (searchKw || "").toLowerCase().trim();
    const filtered = (this.cars || []).filter(c => {
      if (!kw) return true;
      const plateMatch = (c.plate || "").toLowerCase().includes(kw);
      const brandMatch = (c.brand || "").toLowerCase().includes(kw);
      const modelMatch = (c.model || "").toLowerCase().includes(kw);
      const colorMatch = (c.color || "").toLowerCase().includes(kw);
      const statusMatch = (c.status || "").toLowerCase().includes(kw);
      return plateMatch || brandMatch || modelMatch || colorMatch || statusMatch;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="padding:10px 14px; color:#94A3B8; font-size:12px; text-align:center;">ไม่พบข้อมูลรถยนต์ที่ตรงกับ "${kw}"</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(c => {
      const isSelected = c.plate === currentCarId;
      const statusBg = c.status === "ว่างพร้อมใช้งาน" ? "#ECFDF5" : (c.status === "สถานะซ่อมบำรุง" ? "#FEF2F2" : "#FFFBEB");
      const statusColor = c.status === "ว่างพร้อมใช้งาน" ? "#065F46" : (c.status === "สถานะซ่อมบำรุง" ? "#991B1B" : "#92400E");
      return `
        <div class="mnt-car-option-item ${isSelected ? 'selected' : ''}" 
             onclick="app.selectMaintenanceCar('${c.plate}')"
             title="${c.plate} - ${c.brand || ''} ${c.model || ''}">
          <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:8px;">
            <span style="font-weight:800; color:#0F172A; margin-right:6px;">${c.plate}</span>
            <span style="color:#334155; font-weight:600;">${c.brand || ''} ${c.model || ''}</span>
            ${c.color ? `<span style="color:#64748B; font-size:11.5px; margin-left:4px;">(${c.color})</span>` : ''}
          </div>
          <span style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; background:${statusBg}; color:${statusColor}; white-space:nowrap;">
            ${c.status || '-'}
          </span>
        </div>
      `;
    }).join("");
  }

  showMntCarDropdown(show = true) {
    const listEl = document.getElementById("mnt-car-dropdown-list");
    if (!listEl) return;
    if (show) {
      this.populateMaintenanceCars(document.getElementById("mnt-car-search-input")?.value || "");
      listEl.style.display = "block";
    } else {
      listEl.style.display = "none";
    }
  }

  toggleMntCarDropdown() {
    const listEl = document.getElementById("mnt-car-dropdown-list");
    if (!listEl) return;
    if (listEl.style.display === "none" || !listEl.style.display) {
      this.showMntCarDropdown(true);
      document.getElementById("mnt-car-search-input")?.focus();
    } else {
      this.showMntCarDropdown(false);
    }
  }

  filterMaintenanceCars(kw) {
    this.populateMaintenanceCars(kw);
    const listEl = document.getElementById("mnt-car-dropdown-list");
    if (listEl) listEl.style.display = "block";
  }

  selectMaintenanceCar(plate) {
    const car = (this.cars || []).find(c => c.plate === plate);
    const searchInput = document.getElementById("mnt-car-search-input");
    const carSel = document.getElementById("mnt-car-select");

    if (car) {
      if (searchInput) {
        searchInput.value = `${car.plate} - ${car.brand || ''} ${car.model || ''} (${car.color || ''})`;
      }
      if (carSel) {
        carSel.value = car.plate;
      }
      this.onMaintenanceCarSelected(car.plate);

      const isEdit = Boolean(document.getElementById("mnt-form-id")?.value);
      if (!isEdit) {
        const typeSel = document.getElementById("mnt-order-type");
        if (typeSel) {
          this.fetchAndPopulateLastCost(car.plate, typeSel.value);
        }
      }
    }
    this.showMntCarDropdown(false);
  }

  async fetchAndPopulateLastCost(carId, typeVal) {
    const costInput = document.getElementById("mnt-cost");
    const hintEl = document.getElementById("mnt-cost-hint");
    if (!costInput) return;
    if (!carId) {
      if (hintEl) hintEl.innerHTML = "";
      return;
    }

    if (hintEl) {
      hintEl.innerHTML = `<span style="color:#D97706;">⏳ กำลังตรวจสอบประวัติราคาเดิม...</span>`;
    }

    try {
      const resp = await fetch(`/api/maintenance/last-cost?car_id=${encodeURIComponent(carId)}&type=${encodeURIComponent(typeVal || "")}`);
      if (!resp.ok) {
        if (hintEl) hintEl.innerHTML = "";
        return;
      }
      const data = await resp.json();
      if (data && data.success && data.cost > 0) {
        costInput.value = data.cost;
        const sourceLabel = data.source === "maintenance_record"
          ? "ประวัติใบงานเดิมล่าสุด"
          : (data.source === "vehicle_maintenance" ? "ประวัติการซ่อมบำรุงเดิม" : "ค่าบริการตามสเปกรถ");
        if (hintEl) {
          hintEl.innerHTML = `<span style="color:#059669; font-weight:600;">💡 ดึงราคาล่าสุดอัตโนมัติ: ฿${Number(data.cost).toLocaleString()} (${sourceLabel}) — สามารถแก้ไขได้</span>`;
        }
      } else {
        costInput.value = 0;
        if (hintEl) {
          hintEl.innerHTML = `<span style="color:#64748B;">ไม่มีประวัติราคาเดิมในระบบ (กรุณาระบุงบประมาณตามจริง)</span>`;
        }
      }
    } catch (e) {
      console.warn("fetchAndPopulateLastCost error:", e);
      if (hintEl) hintEl.innerHTML = "";
    }
  }

  openNewMaintenanceModal(targetPlate = null, defaultType = null) {
    const workerSel = document.getElementById("mnt-assigned-worker");
    if (workerSel) {
      const userList = (this.users || []).filter(u => u.status === "approved" || !u.status);
      const opts = userList.length > 0
        ? userList.map(u => `<option value="${u.username}">${u.username} (${u.name || u.username}) [${u.role || 'Staff'}]</option>`)
        : [
            '<option value="admin">admin (ผู้ดูแลระบบ (Admin)) [Admin]</option>',
            '<option value="chaiwat.u">chaiwat.u [Staff]</option>',
            '<option value="sam">sam [Staff]</option>',
            '<option value="sucheeda">sucheeda [Staff]</option>',
            '<option value="Chatipat">Chatipat [Staff]</option>'
          ];
      workerSel.innerHTML = opts.join("");
    }

    document.getElementById("mnt-form-id").value = "";
    document.getElementById("mnt-cost").value = "";
    const hintEl = document.getElementById("mnt-cost-hint");
    if (hintEl) hintEl.innerHTML = "";
    document.getElementById("mnt-notes").value = "";
    const itemArea = document.getElementById("mnt-service-items");
    if (itemArea) itemArea.value = "";
    const gName = document.getElementById("mnt-service-center");
    if (gName) gName.value = "";
    const gPhone = document.getElementById("mnt-service-phone");
    if (gPhone) gPhone.value = "";
    const gLoc = document.getElementById("mnt-service-loc");
    if (gLoc) gLoc.value = "";
    const updateCarCheck = document.getElementById("mnt-update-car-status");
    if (updateCarCheck) updateCarCheck.checked = true;

    // Populate car options and select target
    this.populateMaintenanceCars("");
    const chosenPlate = targetPlate || (this.cars && this.cars[0] ? this.cars[0].plate : "");
    if (chosenPlate) {
      this.selectMaintenanceCar(chosenPlate);
    }

    const typeSel = document.getElementById("mnt-order-type");
    if (typeSel) {
      if (defaultType === "renewal") {
        typeSel.value = "ต่อทะเบียนภาษี และ พ.ร.บ.";
      } else {
        typeSel.value = "ซ่อมบำรุงทั่วไป / เช็คระยะ";
      }
      this.onMaintenanceTypeChange(typeSel.value);
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

    const schedDate = document.getElementById("mnt-sched-date");
    if (schedDate) schedDate.value = todayStr;
    const expDate = document.getElementById("mnt-exp-date");
    if (expDate) expDate.value = tomorrow;

    document.getElementById("modal-mnt-title").textContent = "🛠️ ออกใบงานซ่อมบำรุง / ต่อทะเบียน-ประกัน";
    this.openModal("modal-new-maintenance");
  }

  openEditMaintenanceModal(mntId) {
    const rec = (this.maintenanceRecords || []).find(m => m.id === mntId);
    if (!rec) return;

    this.openNewMaintenanceModal(rec.car_id);

    document.getElementById("modal-mnt-title").textContent = `✏️ แก้ไขใบงานซ่อมบำรุง (${mntId})`;
    document.getElementById("mnt-form-id").value = mntId;
    document.getElementById("mnt-order-type").value = rec.order_type || "ซ่อมบำรุงทั่วไป / เช็คระยะ";
    document.getElementById("mnt-service-items").value = rec.service_items || "";
    document.getElementById("mnt-cost").value = rec.cost || "";
    const hintEl = document.getElementById("mnt-cost-hint");
    if (hintEl) {
      hintEl.innerHTML = `<span style="color:#64748B;">แก้ไขค่างบประมาณของใบงาน (${mntId})</span>`;
    }
    document.getElementById("mnt-mileage").value = rec.current_mileage || "";
    document.getElementById("mnt-service-center").value = rec.service_center || "";
    document.getElementById("mnt-service-phone").value = rec.service_center_phone || "";
    document.getElementById("mnt-service-loc").value = rec.service_location || "";
    document.getElementById("mnt-assigned-worker").value = rec.assigned_worker || "admin";
    document.getElementById("mnt-sched-date").value = this.dmyToYmd(rec.schedule_date) || (rec.schedule_date || "");
    document.getElementById("mnt-sched-time").value = rec.schedule_time || "09:00";
    document.getElementById("mnt-exp-date").value = this.dmyToYmd(rec.expected_finish_date) || (rec.expected_finish_date || "");
    document.getElementById("mnt-exp-time").value = rec.expected_finish_time || "17:00";
    document.getElementById("mnt-notes").value = rec.notes || "";
    const updateCarCheck = document.getElementById("mnt-update-car-status");
    if (updateCarCheck) updateCarCheck.checked = Boolean(rec.update_car_status);
  }

  onMaintenanceCarSelected(plate) {
    const car = (this.cars || []).find(c => c.plate === plate);
    if (!car) return;

    const actEl = document.getElementById("mnt-car-act");
    if (actEl) actEl.textContent = car.act_expiry || "-";
    const insEl = document.getElementById("mnt-car-ins");
    if (insEl) insEl.textContent = car.ins_expiry || "-";
    const mileEl = document.getElementById("mnt-mileage");
    if (mileEl) mileEl.value = car.mileage || "";
  }

  onMaintenanceTypeChange(typeVal) {
    const itemArea = document.getElementById("mnt-service-items");
    const garageInput = document.getElementById("mnt-service-center");
    if (itemArea) {
      if (typeVal.includes("ต่อทะเบียน") && (!itemArea.value || itemArea.value.includes("น้ำมันเครื่อง"))) {
        itemArea.value = "1. ตรวจสภาพรถยนต์ ตรอ.\n2. ยื่นต่อภาษีประจำปี ณ กรมการขนส่งทางบก\n3. จัดทำ พ.ร.บ. คุ้มครองผู้ประสบภัยจากรถ";
        if (garageInput && !garageInput.value) {
          garageInput.value = "สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 5 (จตุจักร) / ตรอ.วิภาวดี";
        }
      } else if (typeVal.includes("ประกัน") && (!itemArea.value || itemArea.value.includes("น้ำมันเครื่อง"))) {
        itemArea.value = "1. ตรวจสอบเบี้ยประกันภัยรถยนต์ประจำปี\n2. ต่ออายุความคุ้มครองกรมธรรม์ประกันภัยรถยนต์ (ชั้น 1)";
      }
    }

    // Auto-fetch historical cost for the chosen car & order type if not in edit mode
    const isEdit = Boolean(document.getElementById("mnt-form-id")?.value);
    if (!isEdit) {
      const carSel = document.getElementById("mnt-car-select");
      const chosenPlate = carSel ? carSel.value : "";
      if (chosenPlate) {
        this.fetchAndPopulateLastCost(chosenPlate, typeVal);
      }
    }
  }

  appendMntItem(text) {
    const textarea = document.getElementById("mnt-service-items");
    if (!textarea) return;
    if (textarea.value.trim()) {
      textarea.value = textarea.value.trim() + "\n- " + text;
    } else {
      textarea.value = "- " + text;
    }
  }

  fillMntGarage(name, phone, loc) {
    const n = document.getElementById("mnt-service-center");
    if (n) n.value = name;
    const p = document.getElementById("mnt-service-phone");
    if (p) p.value = phone;
    const l = document.getElementById("mnt-service-loc");
    if (l) l.value = loc;
  }

  async submitMaintenanceOrder(openPdf = false) {
    const mntId = document.getElementById("mnt-form-id").value;
    const carId = document.getElementById("mnt-car-select").value;
    const orderType = document.getElementById("mnt-order-type").value;
    const serviceItems = document.getElementById("mnt-service-items").value.trim();
    const cost = document.getElementById("mnt-cost").value;
    const mileage = document.getElementById("mnt-mileage").value.trim();
    const serviceCenter = document.getElementById("mnt-service-center").value.trim();
    const servicePhone = document.getElementById("mnt-service-phone").value.trim();
    const serviceLoc = document.getElementById("mnt-service-loc").value.trim();
    const worker = document.getElementById("mnt-assigned-worker").value;
    const schedDate = document.getElementById("mnt-sched-date").value;
    const schedTime = document.getElementById("mnt-sched-time").value;
    const expDate = document.getElementById("mnt-exp-date").value;
    const expTime = document.getElementById("mnt-exp-time").value;
    const notes = document.getElementById("mnt-notes").value.trim();
    const updateCar = document.getElementById("mnt-update-car-status").checked;

    if (!carId) {
      alert("กรุณาเลือกรถยนต์ที่ต้องการดำเนินการ");
      return;
    }
    if (!serviceItems) {
      alert("กรุณาระบุรายการซ่อมหรือรายการบริการ");
      return;
    }

    const payload = {
      car_id: carId,
      order_type: orderType,
      service_items: serviceItems,
      cost: cost ? parseFloat(cost) : 0,
      current_mileage: mileage,
      service_center: serviceCenter || "ศูนย์บริการมาตรฐาน",
      service_center_phone: servicePhone || "-",
      service_location: serviceLoc || "-",
      assigned_worker: worker || "admin",
      schedule_date: schedDate,
      schedule_time: schedTime,
      expected_finish_date: expDate,
      expected_finish_time: expTime,
      notes: notes,
      update_car_status: updateCar,
      created_by: this.user?.name || this.user?.username || "Admin"
    };

    try {
      let res;
      if (mntId) {
        res = await fetch(`/api/maintenance/${mntId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch("/api/maintenance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-new-maintenance");
        const orderId = data.maintenance?.id || mntId;
        this.showToast(`🎉 ออกใบงาน ${orderId} สำเร็จเรียบร้อย!`, "success");
        await this.loadMaintenanceRecords();
        await this.loadCars();
        await this.loadBackOfficeJobs();

        if (openPdf && orderId) {
          window.open(`/api/pdf/maintenance/${orderId}`, "_blank");
        }
      } else {
        alert(data.detail || "บันทึกใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e.message);
    }
  }

  openCloseMaintenanceModal(mntId) {
    const rec = (this.maintenanceRecords || []).find(m => m.id === mntId);
    if (!rec) return;

    const car = (this.cars || []).find(c => c.plate === rec.car_id) || {};
    const oType = String(rec.order_type || "");
    const isRenewal = oType.includes("ต่อทะเบียน") || oType.includes("พ.ร.บ.") || oType.includes("พรบ") || oType.includes("ประกัน") || oType.includes("ภาษี") || oType.includes("แพ็กคู่");

    document.getElementById("close-mnt-id").value = mntId;
    document.getElementById("close-mnt-car-title").textContent = `🚘 ${rec.car_id} (${rec.car_brand || car.brand || ''} ${rec.car_model || car.model || ''})`;
    document.getElementById("close-mnt-summary-txt").textContent = `ใบงาน: ${mntId} | ประเภท: ${rec.order_type} | ผู้รับผิดชอบ: ${rec.assigned_worker || '-'}`;
    document.getElementById("close-mnt-actual-cost").value = rec.actual_cost || rec.cost || "";
    document.getElementById("close-mnt-mileage").value = rec.current_mileage || car.mileage || "";
    document.getElementById("close-mnt-notes").value = rec.completion_notes || (isRenewal ? "ต่อภาษี/พ.ร.บ./ประกันภัยเรียบร้อย ได้รับเอกสารครบถ้วน" : "ตรวจรับรถเรียบร้อย สภาพสมบูรณ์พร้อมใช้งาน");
    document.getElementById("close-mnt-restore-car").checked = true;
    document.getElementById("close-mnt-record-expense").checked = true;

    const renewalSec = document.getElementById("close-mnt-renewal-section");
    const taxWrapper = document.getElementById("close-mnt-tax-wrapper");
    const actWrapper = document.getElementById("close-mnt-act-wrapper");
    const insWrapper = document.getElementById("close-mnt-ins-wrapper");
    const coWrapper = document.getElementById("close-mnt-company-wrapper");
    const submitBtn = document.getElementById("close-mnt-submit-btn");

    if (isRenewal) {
      if (renewalSec) renewalSec.style.display = "block";
      const hasTax = oType.includes("ภาษี") || oType.includes("ต่อทะเบียน") || oType.includes("แพ็กคู่");
      const hasAct = oType.includes("พ.ร.บ.") || oType.includes("พรบ") || oType.includes("ต่อทะเบียน") || oType.includes("แพ็กคู่");
      const hasIns = oType.includes("ประกัน") || oType.includes("แพ็กคู่");

      if (taxWrapper) taxWrapper.style.display = hasTax ? "block" : "none";
      if (actWrapper) actWrapper.style.display = hasAct ? "block" : "none";
      if (insWrapper) insWrapper.style.display = hasIns ? "block" : "none";
      if (coWrapper) coWrapper.style.display = (hasIns || isRenewal) ? "block" : "none";

      const curTax = car.tax_expiry || "-";
      const curAct = car.act_expiry || "-";
      const curIns = car.ins_expiry || "-";
      const taxCurrentEl = document.getElementById("close-mnt-tax-current");
      const actCurrentEl = document.getElementById("close-mnt-act-current");
      const insCurrentEl = document.getElementById("close-mnt-ins-current");
      if (taxCurrentEl) taxCurrentEl.textContent = `(วันหมดอายุเดิม: ${curTax})`;
      if (actCurrentEl) actCurrentEl.textContent = `(วันหมดอายุเดิม: ${curAct})`;
      if (insCurrentEl) insCurrentEl.textContent = `(วันหมดอายุเดิม: ${curIns})`;

      // Compute next 1 year default
      const nextTaxStr = this.computeRenewedDateStr(curTax);
      const nextActStr = this.computeRenewedDateStr(curAct);
      const nextInsStr = this.computeRenewedDateStr(curIns);

      const taxInput = document.getElementById("close-mnt-tax-expiry");
      const actInput = document.getElementById("close-mnt-act-expiry");
      const insInput = document.getElementById("close-mnt-ins-expiry");
      const coInput = document.getElementById("close-mnt-insurance-company");
      const policyInput = document.getElementById("close-mnt-policy-no");

      if (taxInput) taxInput.value = this.dmyToYmd(nextTaxStr);
      if (actInput) actInput.value = this.dmyToYmd(nextActStr);
      if (insInput) insInput.value = this.dmyToYmd(nextInsStr);
      if (coInput) coInput.value = car.insurance_company || car.ins_company || "";
      if (policyInput) policyInput.value = rec.policy_no || car.insurance_policy_no || car.policy_no || "";

      if (submitBtn) submitBtn.innerHTML = "🏁 ยืนยันส่งงาน & อัปเดตวันหมดอายุ";
    } else {
      if (renewalSec) renewalSec.style.display = "none";
      if (submitBtn) submitBtn.innerHTML = "🏁 ยืนยันตรวจรับรถ & ปิดงาน";
    }

    this.openModal("modal-close-maintenance");
  }

  async submitCloseMaintenance() {
    const mntId = document.getElementById("close-mnt-id").value;
    const actualCost = document.getElementById("close-mnt-actual-cost")?.value;
    const mileage = document.getElementById("close-mnt-mileage")?.value.trim() || "";
    const notes = document.getElementById("close-mnt-notes")?.value.trim() || "";

    const renewalSec = document.getElementById("close-mnt-renewal-section");
    const isRenewal = renewalSec && renewalSec.style.display !== "none";

    let newTaxExpiry = "";
    let newActExpiry = "";
    let newInsExpiry = "";
    let insuranceCompany = "";
    let policyNo = "";

    if (isRenewal) {
      const taxRaw = document.getElementById("close-mnt-tax-expiry")?.value;
      const actRaw = document.getElementById("close-mnt-act-expiry")?.value;
      const insRaw = document.getElementById("close-mnt-ins-expiry")?.value;
      insuranceCompany = document.getElementById("close-mnt-insurance-company")?.value.trim() || "";
      policyNo = document.getElementById("close-mnt-policy-no")?.value.trim() || "";

      const taxWrapper = document.getElementById("close-mnt-tax-wrapper");
      const actWrapper = document.getElementById("close-mnt-act-wrapper");
      const insWrapper = document.getElementById("close-mnt-ins-wrapper");

      if (taxWrapper && taxWrapper.style.display !== "none" && taxRaw) {
        newTaxExpiry = this.ymdToDmy(taxRaw);
      }
      if (actWrapper && actWrapper.style.display !== "none" && actRaw) {
        newActExpiry = this.ymdToDmy(actRaw);
      }
      if (insWrapper && insWrapper.style.display !== "none" && insRaw) {
        newInsExpiry = this.ymdToDmy(insRaw);
      }
    }

    if (!mntId) return;

    try {
      const res = await fetch(`/api/maintenance/${mntId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actual_cost: actualCost ? parseFloat(actualCost) : 0,
          mileage: mileage,
          completion_notes: notes,
          new_tax_expiry: newTaxExpiry,
          new_act_expiry: newActExpiry,
          new_ins_expiry: newInsExpiry,
          insurance_company: insuranceCompany,
          policy_no: policyNo,
          recorded_by: this.user?.name || this.user?.username || "Admin"
        })
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-close-maintenance");

        // Immediately update local car object for instant UI sync
        if (this.cars) {
          const rec = (this.maintenanceRecords || []).find(m => m.id === mntId);
          const c = rec ? this.cars.find(x => x.plate === rec.car_id) : null;
          if (c) {
            if (newTaxExpiry) { c.tax_expiry = newTaxExpiry; c.tax_expire_date = this.dmyToYmd(newTaxExpiry); }
            if (newActExpiry) { c.act_expiry = newActExpiry; c.prb_expire_date = this.dmyToYmd(newActExpiry); }
            if (newInsExpiry) { c.ins_expiry = newInsExpiry; c.insurance_expire_date = this.dmyToYmd(newInsExpiry); }
            if (insuranceCompany) { c.insurance_company = insuranceCompany; c.ins_company = insuranceCompany; }
            if (policyNo) { c.insurance_policy_no = policyNo; c.policy_no = policyNo; }
            c.status = "ว่างพร้อมใช้งาน";
          }
        }

        let successMsg = `🏁 ปิดงาน ${mntId} เรียบร้อย!`;
        if (newTaxExpiry || newActExpiry || newInsExpiry) {
          const parts = [];
          if (newTaxExpiry) parts.push(`ภาษี: ${newTaxExpiry}`);
          if (newActExpiry) parts.push(`พ.ร.บ.: ${newActExpiry}`);
          if (newInsExpiry) parts.push(`ประกัน: ${newInsExpiry}`);
          successMsg = `🏁 ส่งงานสำเร็จ! อัปเดตข้อมูลรถเรียบร้อย (${parts.join(", ")})`;
        }
        this.showToast(successMsg, "success");
        await this.loadMaintenanceRecords();
        await this.loadCars();
        this.renderCars();
        this.renderExpiringAlerts();
        this.renderUnifiedExpensesTable();
        await this.loadBackOfficeJobs();
        await this.loadDashboardKPIs();
        this.renderFleetOverviewTable();
      } else {
        alert(data.detail || "ปิดงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e.message);
    }
  }

  async deleteMaintenanceRecord(mntId) {
    if (!confirm(`ยืนยันการลบใบงานซ่อมบำรุง ${mntId} ออกจากระบบถาวรใช่หรือไม่?`)) return;
    try {
      const res = await fetch(`/api/maintenance/${encodeURIComponent(mntId)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(`✅ ลบใบงาน ${mntId} และคืนสถานะรถเรียบร้อย`, "success");
        await this.loadMaintenanceRecords();
        await this.loadCars();
        await this.loadBackOfficeJobs();
        try {
          if (this.loadDashboardKPIs) await this.loadDashboardKPIs();
          if (this.loadDashboardData) await this.loadDashboardData();
          if (this.renderDashboardCharts) this.renderDashboardCharts();
        } catch (dbErr) {
          console.warn("Dashboard refetch warning:", dbErr);
        }
      } else {
        alert(data.detail || data.message || "ลบใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาดในการลบใบงาน: " + e.message);
    }
  }

  async deleteWorkOrder(orderId) {
    if (!confirm(`ยืนยันการลบใบงาน ${orderId} ออกจากระบบถาวรใช่หรือไม่?`)) return;
    try {
      const res = await fetch(`/api/work-orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast(`✅ ลบใบงาน ${orderId} เรียบร้อย`, "success");
        await this.loadBackOfficeJobs();
        await this.loadMaintenanceRecords();
        await this.loadCars();
        try {
          if (this.loadDashboardKPIs) await this.loadDashboardKPIs();
          if (this.loadDashboardData) await this.loadDashboardData();
          if (this.renderDashboardCharts) this.renderDashboardCharts();
        } catch (dbErr) {
          console.warn("Dashboard refetch warning:", dbErr);
        }
      } else {
        alert(data.detail || data.message || "ลบใบงานไม่สำเร็จ");
      }
    } catch (e) {
      alert("เกิดข้อผิดพลาด: " + e.message);
    }
  }

  // --- Modal & Toast Helpers ---
  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) {
      this.modalZIndex = (this.modalZIndex || 2000) + 10;
      m.style.zIndex = String(this.modalZIndex);
      m.style.display = "flex";
      m.classList.add("open");

      if (modalId === "modal-car-details") {
        this.isModalOpen = true;
      }

      if (modalId === "modal-edit-car") {
        setTimeout(() => {
          const plateInp = document.getElementById("edit-car-plate");
          if (plateInp) {
            plateInp.focus();
            plateInp.select();
          }
        }, 60);
      }
    }
  }

  openCarScheduleModal(plate, monthOffset = 0) {
    if (!plate) return;
    const cleanPlate = String(plate).trim();
    const car = (this.cars || []).find(c => c.plate === cleanPlate) || { plate: cleanPlate };
    const normPlate = this.normalizePlate ? this.normalizePlate(cleanPlate) : cleanPlate.replace(/\s+/g, "").toUpperCase();
    const isEn = this.currentLang === "EN";

    // Active bookings for this car
    const carBookings = (this.bookings || []).filter(b => {
      const bPlate = this.normalizePlate ? this.normalizePlate(b.car_id || b.car_plate || "") : String(b.car_id || b.car_plate || "").replace(/\s+/g, "").toUpperCase();
      if (bPlate !== normPlate) return false;
      const st = String(b.status || "").trim();
      return !["ยกเลิก", "Canceled", "canceled"].includes(st);
    });

    // Month offset tracking
    if (this._carSchedMonthOffset === undefined || monthOffset === 0) {
      this._carSchedMonthOffset = (monthOffset === 0 && this._currentSchedPlate === cleanPlate) ? (this._carSchedMonthOffset || 0) : 0;
      this._currentSchedPlate = cleanPlate;
    } else {
      this._carSchedMonthOffset += monthOffset;
    }

    const today = new Date();
    const viewDate = new Date(today.getFullYear(), today.getMonth() + this._carSchedMonthOffset, 1);
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth(); // 0-indexed

    const monthNamesTh = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
    const monthNamesEn = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthTitle = isEn ? `${monthNamesEn[month]} ${year}` : `${monthNamesTh[month]} ${year + 543}`;

    // Map each date YYYY-MM-DD
    // Color logic:
    // Yellow: Dates in "ติดจอง (Reserved)"
    // Red: Dates in "กำลังเช่า (On Rent)"
    const dateMap = {};
    carBookings.forEach(b => {
      const sStr = b.start_date ? b.start_date.split("T")[0] : null;
      const eStr = b.end_date ? b.end_date.split("T")[0] : null;
      if (!sStr || !eStr) return;

      const isRenting = (b.status === "กำลังเช่า" || b.status === "รอรับคืน" || b.status === "On rent");

      let curr = new Date(sStr + "T00:00:00");
      const endD = new Date(eStr + "T00:00:00");
      while (curr <= endD) {
        const dKey = curr.toISOString().split("T")[0];
        if (!dateMap[dKey]) dateMap[dKey] = [];
        dateMap[dKey].push({
          booking: b,
          type: isRenting ? "rent" : "reserved"
        });
        curr.setDate(curr.getDate() + 1);
      }
    });

    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayStr = this.getThaiDateTime ? this.getThaiDateTime(0).date : new Date().toISOString().split("T")[0];

    const dayHeaders = isEn ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

    let calendarCells = "";
    for (let i = 0; i < firstDayIndex; i++) {
      calendarCells += `<div style="background:#F8FAFC; border:1px solid #E2E8F0; min-height:60px; border-radius:6px; opacity:0.35;"></div>`;
    }

    for (let day = 1; day <= totalDays; day++) {
      const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dStr === todayStr;
      const entries = dateMap[dStr] || [];

      let cellBg = "#FFFFFF";
      let cellBorder = isToday ? "#3B82F6" : "#E2E8F0";
      let cellTextColor = "#1E293B";
      let badgeHtml = "";

      const hasRent = entries.some(e => e.type === "rent");
      const hasReserved = entries.some(e => e.type === "reserved");

      if (hasRent) {
        // Red: Dates in "กำลังเช่า (On Rent)"
        cellBg = "#FEE2E2";
        cellBorder = "#F87171";
        cellTextColor = "#991B1B";
        badgeHtml = `<span style="font-size:10px; font-weight:700; background:#DC2626; color:#FFF; padding:1px 5px; border-radius:4px; display:inline-block; margin-top:2px;">${isEn ? 'On Rent' : 'กำลังเช่า'}</span>`;
      } else if (hasReserved) {
        // Yellow: Dates in "ติดจอง (Reserved)"
        cellBg = "#FEF08A";
        cellBorder = "#FACC15";
        cellTextColor = "#854D0E";
        badgeHtml = `<span style="font-size:10px; font-weight:700; background:#CA8A04; color:#FFF; padding:1px 5px; border-radius:4px; display:inline-block; margin-top:2px;">${isEn ? 'Booked' : 'ติดจอง'}</span>`;
      }

      calendarCells += `
        <div style="background:${cellBg}; border:1px solid ${cellBorder}; border-radius:6px; min-height:60px; padding:4px 6px; display:flex; flex-direction:column; justify-content:space-between; ${isToday ? 'box-shadow:0 0 0 2px #93C5FD;' : ''}">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <b style="font-size:12px; color:${cellTextColor};">${day}</b>
            ${isToday ? `<span style="font-size:9px; background:#3B82F6; color:#FFF; padding:0 4px; border-radius:3px;">${isEn ? 'Today' : 'วันนี้'}</span>` : ''}
          </div>
          <div>${badgeHtml}</div>
        </div>
      `;
    }

    const modalTitleEl = document.getElementById("modal-car-schedule-title");
    if (modalTitleEl) {
      modalTitleEl.innerHTML = `
        ${isEn ? 'Vehicle Schedule & Queue' : 'ปฏิทินคิวงานของรถ'}: 
        <b>${car.brand || ''} ${car.model || ''}</b> 
        <span style="background:#1E293B; color:#FFF; padding:2px 8px; border-radius:5px; font-size:12px; margin-left:6px;">${car.plate || cleanPlate}</span>
      `;
    }

    const bodyEl = document.getElementById("modal-car-schedule-body");
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; background:#FAF7F2; padding:10px 14px; border-radius:8px; margin-bottom:12px;">
          <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#991B1B;">
              <span style="width:12px; height:12px; border-radius:3px; background:#F87171; display:inline-block;"></span>
              🔴 ${isEn ? 'On Rent' : 'กำลังเช่า'} (${carBookings.filter(b => b.status === "กำลังเช่า" || b.status === "รอรับคืน").length})
            </div>
            <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#854D0E;">
              <span style="width:12px; height:12px; border-radius:3px; background:#FACC15; display:inline-block;"></span>
              🟡 ${isEn ? 'Reserved / Booked' : 'ติดจอง / เตรียมส่งมอบ'} (${carBookings.filter(b => b.status !== "กำลังเช่า" && b.status !== "รอรับคืน").length})
            </div>
            <div style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:#166534;">
              <span style="width:12px; height:12px; border-radius:3px; background:#86EFAC; display:inline-block;"></span>
              🟢 ${isEn ? 'Available' : 'ว่างพร้อมใช้งาน'}
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button" class="btn btn-sm btn-secondary" onclick="app.openCarScheduleModal('${cleanPlate}', -1)" style="padding:3px 10px; font-size:12px;">◀ ${isEn ? 'Prev Month' : 'เดือนก่อนหน้า'}</button>
            <span style="font-weight:700; font-size:13px; color:#1E293B; min-width:130px; text-align:center;">${monthTitle}</span>
            <button type="button" class="btn btn-sm btn-secondary" onclick="app.openCarScheduleModal('${cleanPlate}', 1)" style="padding:3px 10px; font-size:12px;">${isEn ? 'Next Month' : 'เดือนถัดไป'} ▶</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:6px; margin-bottom:16px;">
          ${dayHeaders.map(h => `<div style="text-align:center; font-weight:700; font-size:11.5px; color:#64748B; padding:4px 0;">${h}</div>`).join("")}
          ${calendarCells}
        </div>

        <div style="background:#FFF; border:1px solid #E2E8F0; border-radius:8px; padding:12px; margin-top:12px;">
          <div style="font-size:13px; font-weight:700; color:#1E293B; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
            <span>📋 ${isEn ? 'Bookings & Queue for this Car' : 'รายการจองและคิวงานทั้งหมดของรถคันนี้'} (${carBookings.length})</span>
            <button type="button" class="btn btn-sm btn-primary" onclick="app.closeModal('modal-car-schedule'); app.openBookModal('${cleanPlate}');" style="padding:4px 10px; font-size:11.5px;">
              ➕ ${isEn ? 'New Booking for this Car' : 'จองรถคันนี้'}
            </button>
          </div>
          ${carBookings.length === 0 ? `
            <div style="text-align:center; padding:18px; color:#94A3B8; font-size:12.5px;">
              ${isEn ? 'No active bookings or reservations found for this vehicle.' : 'ไม่มีประวัติหรือคิวงานจองที่ค้างอยู่ รถพร้อมให้บริการ'}
            </div>
          ` : `
            <div class="table-responsive" style="max-height:220px; overflow-y:auto;">
              <table class="table" style="font-size:11.5px; margin:0;">
                <thead>
                  <tr style="background:#F8FAFC;">
                    <th>${isEn ? 'Booking ID' : 'รหัสจอง'}</th>
                    <th>${isEn ? 'Customer' : 'ผู้เช่า'}</th>
                    <th>${isEn ? 'Rental Period' : 'ช่วงเวลาเช่า'}</th>
                    <th style="text-align:center;">${isEn ? 'Status' : 'สถานะ'}</th>
                    <th style="text-align:right;">${isEn ? 'Net Price' : 'ยอดสุทธิ'}</th>
                    <th style="text-align:center;">${isEn ? 'Action' : 'จัดการ'}</th>
                  </tr>
                </thead>
                <tbody>
                  ${carBookings.map(b => {
                    const isRent = b.status === "กำลังเช่า" || b.status === "รอรับคืน";
                    const bgBadge = isRent ? "#FEE2E2" : "#FEF08A";
                    const colBadge = isRent ? "#991B1B" : "#854D0E";
                    const sDt = `${b.start_date ? b.start_date.split('T')[0] : ''} ${b.start_time || ''}`;
                    const eDt = `${b.end_date ? b.end_date.split('T')[0] : ''} ${b.end_time || ''}`;
                    return `
                      <tr>
                        <td><b>${b.booking_id}</b></td>
                        <td>${b.customer_name || '-'}</td>
                        <td>${sDt} ➔ ${eDt}</td>
                        <td style="text-align:center;">
                          <span style="background:${bgBadge}; color:${colBadge}; padding:2px 8px; border-radius:4px; font-weight:700;">
                            ${b.status}
                          </span>
                        </td>
                        <td style="text-align:right; font-weight:700;">฿${Number(b.net_price || 0).toLocaleString()}</td>
                        <td style="text-align:center;">
                          <button type="button" class="btn btn-sm btn-secondary" onclick="app.closeModal('modal-car-schedule'); app.goToTabWithBooking('assign', '${b.booking_id}');" style="padding:2px 6px; font-size:10.5px;">
                            ${isEn ? 'View' : 'ดูใบงาน'}
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join("")}
                </tbody>
              </table>
            </div>
          `}
        </div>

        <div style="display:flex; justify-content:flex-end; margin-top:14px;">
          <button type="button" class="btn btn-secondary" onclick="app.closeModal('modal-car-schedule')" style="padding:6px 16px; font-size:12px;">
            ${isEn ? 'Close' : 'ปิดหน้าต่าง'} (✕)
          </button>
        </div>
      `;
    }

    const m = document.getElementById("modal-car-schedule");
    if (m) {
      m.style.display = "flex";
    }
    this.openModal("modal-car-schedule");
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) {
      m.classList.remove("open");
      m.style.display = "none";
    }
    if (modalId === "modal-car-details") {
      this.isModalOpen = false;
      this.selectedVehicle = null;
    }
  }

  showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    if (type === "danger") icon = "⚠️";

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // =========================================================================
  // EXECUTIVE DASHBOARD INTERACTIVE KPI ACTIONS (MODALS & NAVIGATION)
  // =========================================================================

  // Action for Card 2: Jump to Front Office -> Car Selection (Fleet Showcase)
  onClickKpiFleetCard() {
    this.switchModule("frontoffice");
    this.switchTab("fleet");
    window.scrollTo({ top: 0, behavior: "smooth" });
    this.showToast("🚗 ข้ามมายังหน้าเลือกรถ & จองคิว (Fleet Showcase) เรียบร้อย", "info");
  }

  // Action for Card 1: Open Active Rentals Modal (Cars with Customers)
  openActiveRentalsModal() {
    const scopeVal = document.getElementById("dash-company-scope")?.value || "ทั้งหมด";
    const compFilter = document.getElementById("active-rentals-company-filter");
    if (compFilter && scopeVal) {
      compFilter.value = scopeVal;
    }
    const searchInp = document.getElementById("active-rentals-search");
    if (searchInp) searchInp.value = "";
    const statFilter = document.getElementById("active-rentals-status-filter");
    if (statFilter) statFilter.value = "ทั้งหมด";

    this.renderActiveRentalsTable();
    this.openModal("modal-active-rentals");
  }

  renderActiveRentalsTable() {
    const tbody = document.getElementById("active-rentals-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("active-rentals-search")?.value || "").toLowerCase().trim();
    const compFilter = document.getElementById("active-rentals-company-filter")?.value || "ทั้งหมด";
    const statusFilter = document.getElementById("active-rentals-status-filter")?.value || "ทั้งหมด";

    // 1. Gather all active bookings where status is not completed or cancelled
    const activeBks = (this.bookings || []).filter(b => {
      const st = String(b.status || "");
      return !["เสร็จสิ้น", "ยกเลิก"].includes(st);
    });

    const activeRows = [];
    const accountedPlates = new Set();

    activeBks.forEach(b => {
      const car = (this.cars || []).find(c => c.plate === b.car_id) || {};
      const cust = (this.customers || []).find(c => c.full_name === b.customer) || {};
      const company = car.company || b.company || "Sawasdee Rent A Car";

      if (!this.matchesCompanyScope(company, compFilter)) return;
      if (statusFilter !== "ทั้งหมด" && !String(b.status).includes(statusFilter)) return;

      if (kw) {
        const str = `${b.car_id || ''} ${car.brand || ''} ${car.model || ''} ${b.customer || ''} ${cust.contact_no || ''} ${b.status || ''} ${company}`.toLowerCase();
        if (!str.includes(kw)) return;
      }

      accountedPlates.add(b.car_id);
      activeRows.push({
        type: "booking",
        booking_id: b.booking_id,
        car_id: b.car_id,
        car_brand: car.brand || b.car_brand || "",
        car_model: car.model || b.car_model || "",
        car_color: car.color || "",
        company: company,
        customer: b.customer,
        customer_phone: cust.contact_no || b.customer_phone || "-",
        customer_nat: cust.nationality || "THAI",
        start_date: b.start_date_formatted || b.start_date,
        start_time: b.start_time || "10:00",
        end_date: b.end_date_formatted || b.end_date,
        end_time: b.end_time || "10:00",
        status: b.status || "กำลังเช่า",
        net_price: parseFloat(b.net_price || 0),
        deposit_paid: Boolean(b.deposit_paid),
        deposit_amount: parseFloat(b.deposit_amount || 5000),
        worker: b.worker_delivery || b.worker_return || "-",
        location: b.loc_delivery || b.loc_return || "-"
      });
    });

    // 2. Also check if any cars in this.cars have status 'กำลังเช่า', 'ติดจอง' or 'ซ่อมบำรุง' not yet in activeRows
    (this.cars || []).forEach(c => {
      if (accountedPlates.has(c.plate)) return;
      const isMaint = c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง";
      const isRent = c.fleet_status_key === "unavailable" || ["กำลังเช่า", "ติดจอง", "เตรียมส่งมอบ", "เตรียมรับคืน", "รอส่งมอบ"].includes(c.status);

      if (!isMaint && !isRent) return;
      if (!this.matchesCompanyScope(c.company, compFilter)) return;
      if (statusFilter !== "ทั้งหมด" && !String(c.status).includes(statusFilter)) return;

      if (kw) {
        const str = `${c.plate || ''} ${c.brand || ''} ${c.model || ''} ${c.status || ''} ${c.company || ''}`.toLowerCase();
        if (!str.includes(kw)) return;
      }

      activeRows.push({
        type: isMaint ? "maintenance" : "car_status",
        booking_id: "-",
        car_id: c.plate,
        car_brand: c.brand || "",
        car_model: c.model || "",
        car_color: c.color || "",
        company: c.company || "Sawasdee Rent A Car",
        customer: isMaint ? "ศูนย์บริการ/อู่ซ่อมบำรุง" : "ลูกค้าประจำ (สัญญาเดิม)",
        customer_phone: "-",
        customer_nat: "-",
        start_date: "-",
        start_time: "-",
        end_date: "-",
        end_time: "-",
        status: c.status || (isMaint ? "ซ่อมบำรุง" : "กำลังเช่า"),
        net_price: 0,
        deposit_paid: true,
        deposit_amount: 0,
        worker: "-",
        location: "-"
      });
    });

    // Update count badge
    const badge = document.getElementById("active-rentals-count-badge");
    if (badge) badge.textContent = `${activeRows.length} คัน`;

    if (activeRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:#64748B;">🔍 ไม่พบรายการรถที่กำลังเช่าหรือติดจองตามเงื่อนไขที่เลือก</td></tr>`;
      return;
    }

    tbody.innerHTML = activeRows.map((r, idx) => {
      let statusBadge = '<span class="badge badge-info">' + r.status + '</span>';
      if (r.status === "กำลังเช่า") {
        statusBadge = '<span class="badge" style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; font-weight:700;">🔑 กำลังเช่า</span>';
      } else if (r.status === "เตรียมรับคืน") {
        statusBadge = '<span class="badge" style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; font-weight:700;">🔙 เตรียมรับคืน</span>';
      } else if (r.status === "เตรียมส่งมอบ" || r.status === "รอส่งมอบ") {
        statusBadge = '<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-weight:700;">🚚 เตรียมส่งมอบ</span>';
      } else if (r.status === "ติดจอง") {
        statusBadge = '<span class="badge" style="background:#FEF3C7; color:#92400E; border:1px solid #FDE68A; font-weight:700;">📌 ติดจอง</span>';
      } else if (r.status === "ซ่อมบำรุง") {
        statusBadge = '<span class="badge" style="background:#FEF2F2; color:#991B1B; border:1px solid #FECACA; font-weight:700;">🛠️ ซ่อมบำรุง</span>';
      }

      const depositBadge = r.deposit_paid
        ? `<span style="font-size:11px; color:#047857; font-weight:700;">🟢 มัดจำแล้ว</span>`
        : `<span style="font-size:11px; color:#DC2626; font-weight:700;">🔴 รอมัดจำ</span>`;

      const rentalDatesDisplay = (r.start_date !== "-" && r.end_date !== "-")
        ? `
          <div style="font-size:12px; font-weight:700; color:#1F2937;">
            ${r.start_date} (${r.start_time}) ➔ ${r.end_date} (${r.end_time})
          </div>
          <div style="font-size:11px; color:#64748B;">รหัสจอง: <b>${r.booking_id}</b></div>
        `
        : `<span style="color:#64748B; font-size:12px;">ไม่ได้ระบุช่วงวันสัญญา</span>`;

      const phoneLink = (r.customer_phone && r.customer_phone !== "-")
        ? `<a href="tel:${r.customer_phone}" style="color:#2563EB; font-size:11.5px; text-decoration:none;">📞 ${r.customer_phone}</a>`
        : `<span style="color:#94A3B8; font-size:11px;">-</span>`;

      return `
        <tr>
          <td style="text-align:center; font-weight:700; color:#64748B;">${idx + 1}</td>
          <td>
            <b style="font-size:13.5px; color:#1F2937;">🚘 ${r.car_id}</b><br/>
            <span style="font-size:11.5px; color:#475569;">${r.car_brand} ${r.car_model} (${r.car_color || '-'})</span><br/>
            <span style="font-size:10.5px; color:#94A3B8;">🏢 ${r.company}</span>
          </td>
          <td>
            <b style="font-size:12.5px; color:#1F2937;">👤 ${r.customer}</b><br/>
            ${phoneLink}
          </td>
          <td>${rentalDatesDisplay}</td>
          <td>${statusBadge}</td>
          <td>
            <div style="font-size:11.5px; color:#334155;">📍 ${r.location}</div>
            <div style="font-size:11px; color:#64748B;">👤 ช่าง/คนส่ง: <b>${r.worker}</b></div>
          </td>
          <td style="text-align:right;">
            <b style="font-size:13.5px; color:#EA580C;">฿${r.net_price.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</b><br/>
            ${depositBadge}
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${r.booking_id !== '-' ? `
              <button onclick="app.closeModal('modal-active-rentals'); app.goToTabWithBooking('assign', '${r.booking_id}')" class="btn btn-sm btn-primary" style="padding:2px 8px; font-size:11px;" title="ไปที่ใบงานนี้">
                📋 ดูใบงาน
              </button>
            ` : `
              <button onclick="app.closeModal('modal-active-rentals'); app.jumpToCarInFrontOffice('${r.car_id}')" class="btn btn-sm btn-secondary" style="padding:2px 8px; font-size:11px;">
                🚗 ดูรถ
              </button>
            `}
          </td>
        </tr>
      `;
    }).join("");
  }

  // Action for Card 3: Open Car Profitability Modal (Ranked from highest net profit to lowest)
  openCarProfitabilityModal() {
    const scopeVal = document.getElementById("dash-company-scope")?.value || "ทั้งหมด";
    const compFilter = document.getElementById("prof-company-filter");
    if (compFilter && scopeVal) {
      compFilter.value = scopeVal;
    }
    const searchInp = document.getElementById("prof-search-input");
    if (searchInp) searchInp.value = "";
    const sortSel = document.getElementById("prof-sort-select");
    if (sortSel) sortSel.value = "profit_desc";

    this.renderCarProfitabilityTable();
    this.openModal("modal-car-profitability");
  }

  calculateCarProfitabilityList() {
    const revByCar = {};
    const rentalsByCar = {};
    const completedBids = new Set();

    (this.completedJobs || []).forEach(j => {
      const pl = j.car_id;
      if (pl) {
        const netP = parseFloat(j.net_price || 0);
        const late = parseFloat(j.late_fee || 0);
        revByCar[pl] = (revByCar[pl] || 0) + netP + late;
        rentalsByCar[pl] = (rentalsByCar[pl] || 0) + 1;
      }
      if (j.booking_id) completedBids.add(j.booking_id);
    });

    (this.bookings || []).forEach(b => {
      const pl = b.car_id;
      const bid = b.booking_id;
      if (pl && !completedBids.has(bid)) {
        if (b.rental_paid || ["กำลังเช่า", "เตรียมรับคืน", "รอส่งมอบ", "เตรียมส่งมอบ"].includes(b.status)) {
          const netP = parseFloat(b.net_price || 0);
          revByCar[pl] = (revByCar[pl] || 0) + netP;
          rentalsByCar[pl] = (rentalsByCar[pl] || 0) + 1;
        }
      }
    });

    const expByCar = {};
    const mntIds = new Set();
    (this.maintenanceRecords || []).forEach(m => {
      const pl = m.car_id;
      if (pl) {
        const cVal = parseFloat(m.actual_cost || m.cost || 0);
        expByCar[pl] = (expByCar[pl] || 0) + cVal;
      }
      if (m.id) mntIds.add(m.id);
    });

    // In case rawKpiData or financial_records has standalone expenses
    const finRecords = this.rawKpiData?.financial_records || [];
    finRecords.forEach(f => {
      const fType = f.type;
      const fAmt = parseFloat(f.amount || 0);
      const fRef = String(f.ref || "");
      const fDet = String(f.detail || "");

      let matchedPl = null;
      for (const c of (this.cars || [])) {
        if (c.plate === fRef || fDet.includes(c.plate)) {
          matchedPl = c.plate;
          break;
        }
      }

      if (matchedPl) {
        if (fType === "รายรับ" && f.category === "ค่าเช่ารถ" && !completedBids.has(fRef)) {
          revByCar[matchedPl] = (revByCar[matchedPl] || 0) + fAmt;
        } else if (fType === "รายจ่าย" && !mntIds.has(fRef)) {
          expByCar[matchedPl] = (expByCar[matchedPl] || 0) + fAmt;
        }
      }
    });

    const list = (this.cars || []).map(c => {
      const gross = Math.round((revByCar[c.plate] || 0) * 100) / 100;
      const exp = Math.round((expByCar[c.plate] || 0) * 100) / 100;
      const net = Math.round((gross - exp) * 100) / 100;
      const rCnt = rentalsByCar[c.plate] || 0;
      const margin = gross > 0 ? Math.round((net / gross) * 100) : (net < 0 ? -100 : 0);

      return {
        plate: c.plate,
        brand: c.brand || "",
        model: c.model || "",
        color: c.color || "",
        company: c.company || "Sawasdee Rent A Car",
        status: c.status || "ว่างพร้อมใช้งาน",
        total_rentals: rCnt,
        gross_revenue: gross,
        total_expense: exp,
        net_profit: net,
        margin: margin
      };
    });

    return list;
  }

  renderCarProfitabilityTable() {
    const tbody = document.getElementById("car-profitability-tbody");
    if (!tbody) return;

    const kw = (document.getElementById("prof-search-input")?.value || "").toLowerCase().trim();
    const compFilter = document.getElementById("prof-company-filter")?.value || "ทั้งหมด";
    const sortMode = document.getElementById("prof-sort-select")?.value || "profit_desc";

    let list = this.calculateCarProfitabilityList();

    // 1. Filter by company and keyword
    list = list.filter(item => {
      if (!this.matchesCompanyScope(item.company, compFilter)) return false;
      if (kw) {
        const s = `${item.plate} ${item.brand} ${item.model} ${item.company} ${item.status}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    // 2. Sort: Highest net profit first down to lowest (default)
    if (sortMode === "revenue_desc") {
      list.sort((a, b) => b.gross_revenue - a.gross_revenue || b.net_profit - a.net_profit);
    } else if (sortMode === "rentals_desc") {
      list.sort((a, b) => b.total_rentals - a.total_rentals || b.net_profit - a.net_profit);
    } else {
      // Default: Highest Net Profit first
      list.sort((a, b) => b.net_profit - a.net_profit || b.gross_revenue - a.gross_revenue || b.total_rentals - a.total_rentals);
    }

    // 3. Update top summary metrics in the modal
    const totalGross = list.reduce((acc, x) => acc + x.gross_revenue, 0);
    const totalExp = list.reduce((acc, x) => acc + x.total_expense, 0);
    const totalNet = totalGross - totalExp;

    const elGross = document.getElementById("prof-kpi-gross-rev");
    const elExp = document.getElementById("prof-kpi-total-exp");
    const elNet = document.getElementById("prof-kpi-net-profit");
    const elCars = document.getElementById("prof-kpi-total-cars");

    if (elGross) elGross.textContent = `฿${totalGross.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elExp) elExp.textContent = `-฿${totalExp.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elNet) elNet.textContent = `฿${totalNet.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    if (elCars) elCars.textContent = `${list.length} คัน`;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:#64748B;">🔍 ไม่พบข้อมูลรถยนต์ตรงกับเงื่อนไขที่ค้นหา</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((item, idx) => {
      let rankBadge = `<b style="font-size:13px; color:#64748B;">${idx + 1}</b>`;
      if (idx === 0) rankBadge = `<span style="font-size:18px;" title="อันดับ 1">🥇</span>`;
      else if (idx === 1) rankBadge = `<span style="font-size:18px;" title="อันดับ 2">🥈</span>`;
      else if (idx === 2) rankBadge = `<span style="font-size:18px;" title="อันดับ 3">🥉</span>`;

      let statusBadge = '<span class="badge badge-gray">' + item.status + '</span>';
      if (item.status === "ว่างพร้อมใช้งาน") {
        statusBadge = '<span class="badge badge-success">ว่าง</span>';
      } else if (item.status === "กำลังเช่า") {
        statusBadge = '<span class="badge badge-danger">กำลังเช่า</span>';
      } else if (item.status === "ติดจอง") {
        statusBadge = '<span class="badge badge-warning">ติดจอง</span>';
      } else if (item.status === "ซ่อมบำรุง") {
        statusBadge = '<span class="badge" style="background:#FEE2E2; color:#991B1B;">ซ่อมบำรุง</span>';
      }

      const netColor = item.net_profit > 0 ? "#15803D" : (item.net_profit < 0 ? "#DC2626" : "#475569");
      const netBg = item.net_profit > 0 ? "#F0FDF4" : (item.net_profit < 0 ? "#FEF2F2" : "#F8FAFC");
      const netBorder = item.net_profit > 0 ? "#BBF7D0" : (item.net_profit < 0 ? "#FECACA" : "#E2E8F0");

      return `
        <tr>
          <td style="text-align:center;">${rankBadge}</td>
          <td>
            <b style="font-size:13.5px; color:#1F2937;">🚘 ${item.plate}</b><br/>
            <span style="font-size:11.5px; color:#475569;">${item.brand} ${item.model} (${item.color || '-'})</span><br/>
            <span style="font-size:10.5px; color:#94A3B8;">🏢 ${item.company}</span>
          </td>
          <td style="text-align:center;">${statusBadge}</td>
          <td style="text-align:center;">
            <b style="color:#1E40AF; font-size:13px;">${item.total_rentals}</b> <span style="font-size:11px; color:#64748B;">งาน</span>
          </td>
          <td style="text-align:right;">
            <b style="color:#15803D; font-size:13px;">+฿${item.gross_revenue.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</b>
          </td>
          <td style="text-align:right;">
            <span style="color:#DC2626; font-size:12.5px;">${item.total_expense > 0 ? `-฿${item.total_expense.toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '฿0.00'}</span>
          </td>
          <td style="text-align:right; background:${netBg};">
            <span style="display:inline-block; padding:3px 10px; border-radius:8px; border:1px solid ${netBorder}; font-weight:800; font-size:14px; color:${netColor};">
              ฿${item.net_profit.toLocaleString('th-TH', { minimumFractionDigits: 2 })}
            </span>
          </td>
          <td style="text-align:center;">
            <button onclick="app.closeModal('modal-car-profitability'); app.jumpToCarInFrontOffice('${item.plate}')" class="btn btn-sm btn-secondary" style="padding:2px 8px; font-size:11px;" title="ดูข้อมูลรถคันนี้ในหน้าเลือกรถ">
              🔍 ดูรถ
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // =========================================================================
  // MISSION 2: VEHICLE MAINTENANCE TRACKER & ROI METHODS
  // =========================================================================
  async loadCarMaintenances(plate) {
    const isEn = (this.currentLang === "EN");
    const cleanPlate = String(plate || "").trim();
    if (!cleanPlate) return;

    const tbody = document.getElementById("car-details-maint-tbody");
    const incEl = document.getElementById("car-roi-income");
    const costEl = document.getElementById("car-roi-cost");
    const profitEl = document.getElementById("car-roi-profit");
    const badgeEl = document.getElementById("car-roi-badge");
    const cardEl = document.getElementById("car-roi-profit-card");

    try {
      const res = await fetch(`/api/cars/${encodeURIComponent(cleanPlate)}/maintenances`);
      if (!res.ok) throw new Error("Failed to load maintenances");
      const data = await res.json();

      const totalInc = Number(data.total_income || 0);
      const totalCost = Number(data.total_maintenance_cost || 0);
      const netProfit = Number(data.net_profit_roi || 0);

      if (incEl) incEl.textContent = "฿" + totalInc.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      if (costEl) costEl.textContent = "฿" + totalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      if (profitEl) {
        profitEl.textContent = (netProfit >= 0 ? "+฿" : "-฿") + Math.abs(netProfit).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
        profitEl.style.color = netProfit >= 0 ? "#16A34A" : "#DC2626";
      }
      if (cardEl) {
        cardEl.style.background = netProfit >= 0 ? "#F0FDF4" : "#FEF2F2";
        cardEl.style.borderColor = netProfit >= 0 ? "#BBF7D0" : "#FECACA";
      }
      if (badgeEl) {
        if (netProfit >= 0) {
          badgeEl.textContent = isEn ? "ROI: Profitable" : "กำไรสุทธิ (ROI บวก)";
          badgeEl.style.background = "#DCFCE7";
          badgeEl.style.color = "#15803D";
          badgeEl.style.border = "1px solid #86EFAC";
        } else {
          badgeEl.textContent = isEn ? "ROI: Loss" : "ขาดทุนสุทธิ (ROI ลบ)";
          badgeEl.style.background = "#FEE2E2";
          badgeEl.style.color = "#991B1B";
          badgeEl.style.border = "1px solid #FCA5A5";
        }
      }

      if (tbody) {
        const records = data.records || [];
        if (records.length === 0) {
          tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#94A3B8; padding:12px;">${isEn ? 'No maintenance records yet' : 'ยังไม่มีประวัติการซ่อมบำรุง'}</td></tr>`;
        } else {
          tbody.innerHTML = records.map(r => {
            const costNum = Number(r.cost || 0);
            const safeId = String(r.id || "");
            const safePl = String(cleanPlate).replace(/'/g, "\\'");
            const typeBadge = r.expense_type ? `<span style="display:inline-block; font-size:10.5px; font-weight:700; background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; border-radius:4px; padding:1px 6px; margin-right:6px;">${r.expense_type}</span>` : '';
            return `
              <tr>
                <td style="padding:6px 8px; white-space:nowrap; font-weight:600;">${r.date || '-'}</td>
                <td style="padding:6px 8px;">${typeBadge}${r.description || '-'}</td>
                <td style="padding:6px 8px; text-align:right; font-weight:700; color:#E11D48;">฿${costNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td style="padding:6px 8px; text-align:center;">
                  <button type="button" onclick="app.deleteCarMaintenance('${safePl}', '${safeId}')" class="btn btn-sm btn-danger" style="padding:2px 6px; font-size:11px;" title="${isEn ? 'Delete' : 'ลบ'}">
                    ✕
                  </button>
                </td>
              </tr>
            `;
          }).join("");
        }
      }
    } catch (err) {
      console.error("loadCarMaintenances error:", err);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#EF4444; padding:12px;">${isEn ? 'Failed to load maintenance records' : 'โหลดข้อมูลประวัติซ่อมไม่สำเร็จ'}</td></tr>`;
      }
    }
  }

  async submitCarMaintenance(plate) {
    const isEn = (this.currentLang === "EN");
    const dateInput = document.getElementById("maint-input-date");
    const descInput = document.getElementById("maint-input-desc");
    const costInput = document.getElementById("maint-input-cost");

    const mDate = dateInput ? dateInput.value.trim() : "";
    const mDesc = descInput ? descInput.value.trim() : "";
    const mCost = costInput ? parseFloat(costInput.value) || 0 : 0;

    if (!mDesc) {
      this.showToast(isEn ? "Please enter maintenance description" : "กรุณาระบุรายละเอียดการซ่อม", "danger");
      return;
    }

    try {
      const res = await fetch(`/api/cars/${encodeURIComponent(plate)}/maintenances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: mDate || new Date().toISOString().split("T")[0],
          description: mDesc,
          cost: mCost
        })
      });
      if (!res.ok) throw new Error("Failed to save maintenance");

      if (descInput) descInput.value = "";
      if (costInput) costInput.value = "";
      this.showToast(isEn ? "Maintenance record added successfully" : "บันทึกประวัติซ่อมบำรุงเรียบร้อยแล้ว", "success");
      await this.loadCarMaintenances(plate);
    } catch (err) {
      console.error("submitCarMaintenance error:", err);
      this.showToast(isEn ? "Error saving maintenance" : "เกิดข้อผิดพลาดในการบันทึก", "danger");
    }
  }

  async deleteCarMaintenance(plate, mId) {
    const isEn = (this.currentLang === "EN");
    if (!confirm(isEn ? "Are you sure you want to delete this maintenance entry?" : "ยืนยันการลบรายการซ่อมนี้ใช่หรือไม่?")) {
      return;
    }

    try {
      const res = await fetch(`/api/cars/${encodeURIComponent(plate)}/maintenances/${encodeURIComponent(mId)}`, {
        method: "DELETE"
      });
      if (!res.ok) throw new Error("Failed to delete");
      this.showToast(isEn ? "Maintenance record deleted" : "ลบรายการซ่อมบำรุงเรียบร้อยแล้ว", "success");
      await this.loadCarMaintenances(plate);
      await this.loadCars();
      try {
        if (this.loadDashboardKPIs) await this.loadDashboardKPIs();
        if (this.loadDashboardData) await this.loadDashboardData();
        if (this.renderDashboardCharts) this.renderDashboardCharts();
      } catch (dbErr) {
        console.warn("Dashboard refetch warning:", dbErr);
      }
    } catch (err) {
      console.error("deleteCarMaintenance error:", err);
      this.showToast(isEn ? "Error deleting maintenance" : "เกิดข้อผิดพลาดในการลบ", "danger");
    }
  }

  // =========================================================================
  // MISSION 1: FINANCIAL DASHBOARD & SHIFT CLOSING METHODS
  // =========================================================================
  setShiftClosingMode(mode) {
    this.shiftClosingMode = mode;
    const btnD = document.getElementById("btn-shift-mode-daily");
    const btnM = document.getElementById("btn-shift-mode-monthly");
    const thDate = document.getElementById("th-shift-date");

    if (btnD && btnM) {
      if (mode === "daily") {
        btnD.style.background = "#E85826";
        btnD.style.color = "#FFF";
        btnM.style.background = "transparent";
        btnM.style.color = "#475569";
        if (thDate) thDate.textContent = (this.currentLang === "EN") ? "Date (Daily)" : "วันที่ (รายวัน)";
      } else {
        btnM.style.background = "#E85826";
        btnM.style.color = "#FFF";
        btnD.style.background = "transparent";
        btnD.style.color = "#475569";
        if (thDate) thDate.textContent = (this.currentLang === "EN") ? "Period (Monthly)" : "งวดเดือน (รายเดือน)";
      }
    }
    this.renderShiftClosingTable();
  }

  filterShiftClosing() {
    this.renderShiftClosingTable();
  }

  resetShiftClosingFilter() {
    const f = document.getElementById("shift-month-filter");
    if (f) f.value = "";
    this.renderShiftClosingTable();
  }

  async loadFinanceSummary() {
    try {
      const res = await fetch("/api/finance/summary");
      if (res.ok) {
        this.financeSummaryData = await res.json();
        this.renderShiftClosingTable();
      }
    } catch (err) {
      console.error("loadFinanceSummary error:", err);
    }
  }

  renderShiftClosingTable() {
    if (!this.financeSummaryData) return;
    const isEn = (this.currentLang === "EN");
    const data = this.financeSummaryData;

    const sumTotalEl = document.getElementById("shift-sum-total");
    const sumQrEl = document.getElementById("shift-sum-qr");
    const sumCashEl = document.getElementById("shift-sum-cash");
    const sumCardEl = document.getElementById("shift-sum-card");
    const sumPaypalEl = document.getElementById("shift-sum-paypal");

    const byMethod = data.by_method || {};
    if (sumTotalEl) sumTotalEl.textContent = "฿" + Number(data.total_revenue || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumQrEl) sumQrEl.textContent = "฿" + Number(byMethod["โอนเงิน / สแกน QR"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumCashEl) sumCashEl.textContent = "฿" + Number(byMethod["เงินสด"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumCardEl) sumCardEl.textContent = "฿" + Number(byMethod["บัตรเครดิต"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (sumPaypalEl) sumPaypalEl.textContent = "฿" + Number(byMethod["PayPal"] || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});

    const tbody = document.getElementById("shift-closing-tbody");
    if (!tbody) return;

    const filterInput = document.getElementById("shift-month-filter");
    const filterVal = filterInput ? filterInput.value.trim() : "";

    const currentMode = this.shiftClosingMode || "daily";
    let rows = (currentMode === "monthly") ? (data.monthly || []) : (data.daily || []);
    if (filterVal) {
      rows = rows.filter(r => (r.month && r.month === filterVal) || (r.date && r.date.startsWith(filterVal)));
    }

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#94A3B8; padding:20px;">${isEn ? 'No financial transactions recorded for this period' : 'ไม่มีรายการรายรับในงวดที่เลือก'}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((r, idx) => {
      const periodLabel = r.date || r.month || "-";
      const totalNum = Number(r.total || 0);
      const methods = r.by_method || {};
      const qrNum = Number(methods["โอนเงิน / สแกน QR"] || 0);
      const cashNum = Number(methods["เงินสด"] || 0);
      const cardNum = Number(methods["บัตรเครดิต"] || 0);
      const paypalNum = Number(methods["PayPal"] || 0);
      const countNum = Number(r.count || 0);
      const hasRecords = Array.isArray(r.records) && r.records.length > 0;

      return `
        <tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:10px 12px; font-weight:700; color:#1E293B;">
            📅 ${periodLabel}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:800; color:#EA580C; font-size:13px;">
            ฿${totalNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${qrNum > 0 ? '#2563EB' : '#94A3B8'};">
            ${qrNum > 0 ? '฿' + qrNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${cashNum > 0 ? '#059669' : '#94A3B8'};">
            ${cashNum > 0 ? '฿' + cashNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${cardNum > 0 ? '#DB2777' : '#94A3B8'};">
            ${cardNum > 0 ? '฿' + cardNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:right; font-weight:600; color:${paypalNum > 0 ? '#7C3AED' : '#94A3B8'};">
            ${paypalNum > 0 ? '฿' + paypalNum.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
          </td>
          <td style="padding:10px 12px; text-align:center;">
            <span style="background:#F1F5F9; color:#475569; font-size:11.5px; font-weight:700; padding:2px 8px; border-radius:10px;">
              ${countNum} ${isEn ? 'tx' : 'รายการ'}
            </span>
          </td>
          <td style="padding:10px 12px; text-align:center;">
            ${hasRecords ? `
              <button type="button" onclick="app.toggleShiftRowDetails(${idx})" class="btn btn-sm btn-secondary" style="font-size:11px; padding:3px 8px;">
                🔍 ${isEn ? 'View' : 'ดูย่อย'}
              </button>
            ` : '-'}
          </td>
        </tr>
      `;
    }).join("");
  }

  toggleShiftRowDetails(idx) {
    const isEn = (this.currentLang === "EN");
    const box = document.getElementById("shift-closing-details-box");
    if (!box || !this.financeSummaryData) return;

    const currentMode = this.shiftClosingMode || "daily";
    const rows = (currentMode === "monthly") ? (this.financeSummaryData.monthly || []) : (this.financeSummaryData.daily || []);
    const row = rows[idx];
    if (!row || !Array.isArray(row.records)) {
      box.style.display = "none";
      return;
    }

    if (box.dataset.activeIdx === String(idx) && box.style.display === "block") {
      box.style.display = "none";
      box.dataset.activeIdx = "";
      return;
    }

    box.dataset.activeIdx = String(idx);
    box.style.display = "block";
    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #CBD5E1; padding-bottom:6px;">
        <b style="font-size:13px; color:#1E293B;">🔍 ${isEn ? 'Transaction Details for' : 'รายละเอียดรายการประจำงวด'} ${row.date || row.month} (${row.records.length} ${isEn ? 'items' : 'รายการ'})</b>
        <button type="button" onclick="document.getElementById('shift-closing-details-box').style.display='none'" class="btn btn-sm btn-secondary" style="padding:1px 6px; font-size:11px;">✕ ${isEn ? 'Close' : 'ปิด'}</button>
      </div>
      <div class="table-responsive" style="max-height:180px; overflow-y:auto;">
        <table class="custom-table" style="margin:0; font-size:11.5px;">
          <thead>
            <tr style="background:#E2E8F0;">
              <th>${isEn ? 'Booking / Ref' : 'รหัสจอง / อ้างอิง'}</th>
              <th>${isEn ? 'Vehicle' : 'ทะเบียนรถ'}</th>
              <th>${isEn ? 'Customer' : 'ลูกค้า'}</th>
              <th>${isEn ? 'Category' : 'หมวดหมู่'}</th>
              <th>${isEn ? 'Method' : 'ช่องทางชำระ'}</th>
              <th style="text-align:right;">${isEn ? 'Amount (฿)' : 'ยอดเงิน (฿)'}</th>
            </tr>
          </thead>
          <tbody>
            ${row.records.map(rec => `
              <tr>
                <td style="font-weight:700;">${rec.ref || '-'}</td>
                <td>${rec.car_id || '-'}</td>
                <td>${rec.customer || '-'}</td>
                <td><span style="background:#EFF6FF; color:#1D4ED8; padding:1px 6px; border-radius:4px; font-size:10.5px; font-weight:600;">${rec.category || '-'}</span></td>
                <td><span style="font-weight:600;">${rec.payment_method || '-'}</span></td>
                <td style="text-align:right; font-weight:700; color:#EA580C;">฿${Number(rec.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

}

// Global App Instance
const app = new App();
window.app = app;
