/**
 * Sawasdee Rental - High-Speed SPA Application Logic
 */

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

    this.init();
  }

  async init() {
    // Safety splash dismiss fallback: never leave splash hanging beyond 2 seconds
    setTimeout(() => {
      const splash = document.getElementById("app-splash-screen");
      if (splash && !splash.classList.contains("fade-out")) {
        splash.classList.add("fade-out");
      }
    }, 2000);

    this.initGlobalEnterKeyNavigation();
    this.initLanguage();
    this.setupDatePickers();
    this.updateAuthUI();

    const splash = document.getElementById("app-splash-screen");
    const splashStatus = document.getElementById("app-splash-status");

    if (this.user) {
      if (splashStatus) splashStatus.textContent = "กำลังโหลดข้อมูลระบบ...";
      await this.fetchInitialData();
      this.startLiveSyncPoller();
      if (splash) {
        setTimeout(() => splash.classList.add("fade-out"), 250);
      }
    } else {
      // Always stop at login screen when entering without active session
      if (splash) {
        setTimeout(() => splash.classList.add("fade-out"), 300);
      }
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

    // 2. Sidebar Navigation Items
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
    if (t1) t1.innerHTML = isEn ? '<span>1.</span> 🚗 Fleet & Instant Booking' : '<span>1.</span> 🚗 เลือกรถยนต์ & จองด่วน';
    const t2 = document.getElementById("tab-btn-deposit");
    if (t2) t2.innerHTML = isEn ? '<span>2.</span> 💳 Deposit & Finance' : '<span>2.</span> 💳 เงินมัดจำ & การเงิน';
    const t3 = document.getElementById("tab-btn-assign");
    if (t3) t3.innerHTML = isEn ? '<span>3.</span> 🚚 Dispatch/Return Orders' : '<span>3.</span> 🚚 ออกใบงานส่ง/รับรถ';
    const t4 = document.getElementById("tab-btn-contract");
    if (t4) t4.innerHTML = isEn ? '<span>4.</span> 📝 Rental Agreement' : '<span>4.</span> 📝 จัดทำสัญญาเช่า';
    const t5 = document.getElementById("tab-btn-dashboard_bks");
    if (t5) t5.innerHTML = isEn ? '<span>5.</span> 📋 Booking Pipeline' : '<span>5.</span> 📋 แผงควบคุมคิวการจอง';

    // 4. Hero Section Title
    const barTitle = document.querySelector(".booking-bar h3") || document.getElementById("booking-bar-title");
    if (barTitle) {
      barTitle.textContent = isEn 
        ? "✨ 2. INSTANT BOOKING FORM (THE BOOKING BAR) — Fast Fleet Selection for Sales" 
        : "✨ 2. INSTANT BOOKING FORM (THE BOOKING BAR) — ค้นหาและเลือกรถด่วนสำหรับเซล";
    }
    const bkBarSub = document.getElementById("booking-bar-subtitle");
    if (bkBarSub) {
      bkBarSub.textContent = isEn
        ? "Select dates & times to check vehicle availability and auto-calculate rental duration (over 4 hrs rounded to 1 day)"
        : "เลือกวัน-เวลา เพื่อเช็คสถานะรถว่างและคำนวณระยะเวลาเช่าตามจริงอัตโนมัติ (เกิน 4 ชม. ปรับเป็น 1 วัน)";
    }
    const btnAddCustMain = document.getElementById("btn-add-customer-main");
    if (btnAddCustMain) {
      btnAddCustMain.textContent = isEn ? "➕ Add New Customer" : "➕ เพิ่มลูกค้าใหม่";
    }

    // Tab 1 Filter Bar Labels & Options
    const lblFiltGrp = document.getElementById("lbl-filter-group");
    if (lblFiltGrp) lblFiltGrp.textContent = isEn ? "🚘 Car Category" : "🚘 หมวดหมู่รถ (Category)";
    const optFiltGrpAll = document.getElementById("opt-filter-group-all");
    if (optFiltGrpAll) optFiltGrpAll.textContent = isEn ? "All" : "ทั้งหมด";

    const lblFiltBrand = document.getElementById("lbl-filter-brand");
    if (lblFiltBrand) lblFiltBrand.textContent = isEn ? "🏷️ Brand" : "🏷️ ยี่ห้อ (Brand)";
    const optFiltBrandAll = document.getElementById("opt-filter-brand-all");
    if (optFiltBrandAll) optFiltBrandAll.textContent = isEn ? "All" : "ทั้งหมด";

    const lblFiltComp = document.getElementById("lbl-filter-company");
    if (lblFiltComp) lblFiltComp.textContent = isEn ? "🏢 Ownership / Company" : "🏢 กรรมสิทธิ์ / บริษัท";
    const optFiltCompAll = document.getElementById("opt-filter-company-all");
    if (optFiltCompAll) optFiltCompAll.textContent = isEn ? "All" : "ทั้งหมด";

    const lblFiltStat = document.getElementById("lbl-filter-status");
    if (lblFiltStat) lblFiltStat.textContent = isEn ? "🚦 Vehicle Status" : "🚦 สถานะรถ (Status)";
    const optFStatAll = document.getElementById("opt-filter-status-all");
    if (optFStatAll) optFStatAll.textContent = isEn ? "All" : "ทั้งหมด";
    const optFStatAvail = document.getElementById("opt-filter-status-avail");
    if (optFStatAvail) optFStatAvail.textContent = isEn ? "Vacant without Bookings (🟢)" : "ว่างไม่มีการจอง (🟢)";
    const optFStatRes = document.getElementById("opt-filter-status-reserved");
    if (optFStatRes) optFStatRes.textContent = isEn ? "Booked in Advance (🟡)" : "มีการจองล่วงหน้าไว้ (🟡)";
    const optFStatUnavail = document.getElementById("opt-filter-status-unavail");
    if (optFStatUnavail) optFStatUnavail.textContent = isEn ? "Unavailable on Dates (🔴)" : "ไม่ว่างในวันที่เลือก (🔴)";
    const optFStatMaint = document.getElementById("opt-filter-status-maint");
    if (optFStatMaint) optFStatMaint.textContent = isEn ? "Maintenance Status (🟠)" : "สถานะซ่อมบำรุง (🟠)";
    const optFStatReady = document.getElementById("opt-filter-status-ready");
    if (optFStatReady) optFStatReady.textContent = isEn ? "Available for Service (🟢+🟡)" : "ว่างพร้อมใช้งาน (🟢+🟡)";
    const optFStatRenting = document.getElementById("opt-filter-status-renting");
    if (optFStatRenting) optFStatRenting.textContent = isEn ? "Currently Renting" : "กำลังเช่า";
    const optFStatBooked = document.getElementById("opt-filter-status-booked");
    if (optFStatBooked) optFStatBooked.textContent = isEn ? "Reserved" : "ติดจอง";

    const lblFiltStart = document.getElementById("lbl-filter-start");
    if (lblFiltStart) lblFiltStart.textContent = isEn ? "📅 Pick-up Date & Time" : "📅 วันที่ส่งรถ (Pick-up)";
    const lblFiltEnd = document.getElementById("lbl-filter-end");
    if (lblFiltEnd) lblFiltEnd.textContent = isEn ? "📅 Return Date & Time" : "📅 วันที่คืนรถ (Return)";

    const btnResetFilt = document.getElementById("btn-reset-filters");
    if (btnResetFilt) btnResetFilt.textContent = isEn ? "🔄 Reset Filters" : "🔄 ล้างตัวกรอง";
    const lblCalcDur = document.getElementById("lbl-calc-duration");
    if (lblCalcDur) lblCalcDur.textContent = isEn ? "⏱️ Calculated Rental Duration:" : "⏱️ ระยะเวลาเช่าคำนวณ:";
    const btnAddCarBB = document.getElementById("btn-add-car-booking-bar");
    if (btnAddCarBB) btnAddCarBB.textContent = isEn ? "➕ Add New Vehicle" : "➕ เพิ่มรถยนต์ใหม่";

    // --- Front Office Tab 2: Deposit & Finance ---
    const t2Title = document.getElementById("title-tab2");
    if (t2Title) t2Title.textContent = isEn ? "💳 Booking Deposit & Rental Payment" : "💳 ชำระเงินมัดจำประกันสัญญา & การเงิน (Booking Deposit & Rental Payment)";
    const t2Sub = document.getElementById("subtitle-tab2");
    if (t2Sub) t2Sub.textContent = isEn ? "Record deposit payment (default ฿5,000 to lock vehicle queue and issue contract) and collect remaining rental fee" : "บันทึกการรับชำระเงินมัดจำ (ค่าเริ่มต้น ฿5,000 เพื่อล็อกคิวรถและออกสัญญา) และรับชำระค่าเช่าคงเหลือ";
    const lblDepSelBk = document.getElementById("lbl-deposit-sel-bk");
    if (lblDepSelBk) lblDepSelBk.textContent = isEn ? "📌 Select Booking ID / Vehicle Plate:" : "📌 เลือกรหัสการจอง / ทะเบียนรถที่ต้องการทำรายการ:";
    const optDepSelDef = document.getElementById("opt-dep-sel-default");
    if (optDepSelDef) optDepSelDef.textContent = isEn ? "-- Please select a booking --" : "-- กรุณาเลือกรายการจอง --";

    const lblDepAmt = document.getElementById("lbl-deposit-amount");
    if (lblDepAmt) lblDepAmt.textContent = isEn ? "Deposit Amount (THB)" : "จำนวนเงินมัดจำ (บาท)";

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

    const lblDepRef = document.getElementById("lbl-deposit-ref");
    if (lblDepRef) lblDepRef.textContent = isEn ? "Slip Ref / Transaction Code (Optional)" : "เลขที่อ้างอิงสลิป / รหัสธุรกรรม (ถ้ามี)";
    const hintDepRef = document.getElementById("hint-deposit-ref");
    if (hintDepRef) hintDepRef.textContent = isEn ? "Enter slip transaction number or receipt code" : "เช่น เลขที่ทำรายการบนสลิปโอนเงิน หรือหมายเลขอ้างอิง";
    const lblDepSlip = document.getElementById("lbl-deposit-slip");
    if (lblDepSlip) lblDepSlip.textContent = isEn ? "📎 Attach Payment Slip (Optional):" : "📎 แนบรูปสลิปหลักฐานการชำระเงิน (ถ้ามี):";
    const btnChooseSlip = document.getElementById("btn-choose-slip");
    if (btnChooseSlip) btnChooseSlip.textContent = isEn ? "📁 Choose Slip File..." : "📁 เลือกไฟล์สลิป...";
    const lblDepAlsoRent = document.getElementById("lbl-deposit-also-rent");
    if (lblDepAlsoRent) lblDepAlsoRent.textContent = isEn ? "Collect full rental fee at the same time" : "รับชำระค่าเช่าเต็มจำนวนพร้อมกันทันที";
    const btnSubDep = document.getElementById("btn-submit-deposit");
    if (btnSubDep) btnSubDep.textContent = isEn ? "💾 Confirm Deposit & Proceed to Dispatch ➔" : "💾 ยืนยันรับเงินมัดจำ & ไปออกใบงาน ➔";
    const btnSaveSlipOnly = document.getElementById("btn-save-slip-only");
    if (btnSaveSlipOnly) btnSaveSlipOnly.textContent = isEn ? "📎 Update Slip Ref Only" : "📎 อัปเดตสลิป/Ref อย่างเดียว";
    const btnSettleRent = document.getElementById("btn-settle-rental");
    if (btnSettleRent) btnSettleRent.textContent = isEn ? "💵 Settle Remaining Rental Fee" : "💵 บันทึกรับชำระค่าเช่าคงเหลือ";
    const btnDlDepRec = document.getElementById("btn-dl-dep-receipt");
    if (btnDlDepRec) btnDlDepRec.textContent = isEn ? "🛡️ Deposit Receipt (PDF)" : "🛡️ ใบเสร็จมัดจำ (PDF)";
    const btnDlRentRec = document.getElementById("btn-dl-rent-receipt");
    if (btnDlRentRec) btnDlRentRec.textContent = isEn ? "🧾 Rental Receipt (PDF)" : "🧾 ใบเสร็จค่าเช่า (PDF)";
    const btnDlContractDep = document.getElementById("btn-dl-contract-from-dep");
    if (btnDlContractDep) btnDlContractDep.textContent = isEn ? "📝 Rental Contract (PDF)" : "📝 สัญญาเช่า (PDF)";
    const btnGotoAssignDep = document.getElementById("btn-goto-assign-from-dep");
    if (btnGotoAssignDep) btnGotoAssignDep.textContent = isEn ? "🚚 Go to Work Orders ➔" : "🚚 ไปหน้าออกใบงาน ➔";
    const btnGotoContractDep = document.getElementById("btn-goto-contract-from-dep");
    if (btnGotoContractDep) btnGotoContractDep.textContent = isEn ? "📝 Go to Rental Contract ➔" : "📝 ไปหน้าทำสัญญา ➔";

    // --- Front Office Tab 3: Dispatch/Return Orders ---
    const t3Disp = document.getElementById("title-tab3-disp");
    if (t3Disp) t3Disp.textContent = isEn ? "🚚 Dispatch Work Order" : "🚚 ออกใบงานส่งรถ (Dispatch Work Order)";
    const lblAssignDispBk = document.getElementById("lbl-assign-disp-bk");
    if (lblAssignDispBk) lblAssignDispBk.textContent = isEn ? "Select Booking ID for Vehicle Dispatch:" : "เลือกรหัสการจองสำหรับส่งมอบรถ:";
    const optAssignDispDef = document.getElementById("opt-assign-disp-default");
    if (optAssignDispDef) optAssignDispDef.textContent = isEn ? "-- Select Booking ID --" : "-- เลือกรหัสการจอง --";
    const lblAssignDispStart = document.getElementById("lbl-assign-disp-start");
    if (lblAssignDispStart) lblAssignDispStart.textContent = isEn ? "Rental Start Date" : "วันที่เริ่มเช่า";
    const lblAssignDispEnd = document.getElementById("lbl-assign-disp-end");
    if (lblAssignDispEnd) lblAssignDispEnd.textContent = isEn ? "Rental Return Date" : "วันที่คืนรถ";
    const lblAssignDispWorker = document.getElementById("lbl-assign-disp-worker");
    if (lblAssignDispWorker) lblAssignDispWorker.textContent = isEn ? "Assign Dispatch Staff / Driver" : "มอบหมายพนักงานส่งรถ (คนงาน/คนขับ)";
    const lblAssignDispLoc = document.getElementById("lbl-assign-disp-loc");
    if (lblAssignDispLoc) lblAssignDispLoc.textContent = isEn ? "Meeting Location for Dispatch" : "สถานที่นัดหมายส่งรถ";
    const lblAssignDispDate = document.getElementById("lbl-assign-disp-date");
    if (lblAssignDispDate) lblAssignDispDate.textContent = isEn ? "Appointment Dispatch Date" : "วันที่นัดหมายส่งมอบ";
    const lblAssignDispTime = document.getElementById("lbl-assign-disp-time");
    if (lblAssignDispTime) lblAssignDispTime.textContent = isEn ? "Appointment Time" : "เวลานัดหมาย";
    const btnAssignDispSched = document.getElementById("btn-assign-disp-sched");
    if (btnAssignDispSched) btnAssignDispSched.textContent = isEn ? "📋 Schedule (Preparing Dispatch)" : "📋 นัดหมาย (เตรียมส่งมอบ)";
    const btnAssignDispHandoff = document.getElementById("btn-assign-disp-handover");
    if (btnAssignDispHandoff) btnAssignDispHandoff.textContent = isEn ? "🚚 Vehicle Handed Over (Renting) ➔" : "🚚 ส่งมอบรถแล้ว (กำลังเช่า) ➔";
    const btnAssignDispContract = document.getElementById("btn-assign-disp-goto-contract");
    if (btnAssignDispContract) btnAssignDispContract.textContent = isEn ? "📝 Go to Rental Contract ➔" : "📝 ไปหน้าทำสัญญา ➔";

    const t3Ret = document.getElementById("title-tab3-ret");
    if (t3Ret) t3Ret.textContent = isEn ? "🔙 Return Work Order" : "🔙 ออกใบงานรับรถคืน (Return Work Order)";
    const lblAssignRetBk = document.getElementById("lbl-assign-ret-bk");
    if (lblAssignRetBk) lblAssignRetBk.textContent = isEn ? "Select Booking ID for Vehicle Return:" : "เลือกรหัสการจองสำหรับรับรถคืน:";
    const optAssignRetDef = document.getElementById("opt-assign-ret-default");
    if (optAssignRetDef) optAssignRetDef.textContent = isEn ? "-- Select Booking ID --" : "-- เลือกรหัสการจอง --";
    const lblAssignRetStart = document.getElementById("lbl-assign-ret-start");
    if (lblAssignRetStart) lblAssignRetStart.textContent = isEn ? "Rental Start Date" : "วันที่เริ่มเช่า";
    const lblAssignRetEnd = document.getElementById("lbl-assign-ret-end");
    if (lblAssignRetEnd) lblAssignRetEnd.textContent = isEn ? "Rental Return Date" : "วันที่คืนรถ";
    const lblAssignRetWorker = document.getElementById("lbl-assign-ret-worker");
    if (lblAssignRetWorker) lblAssignRetWorker.textContent = isEn ? "Assign Return Staff / Driver" : "มอบหมายพนักงานรับรถคืน";
    const lblAssignRetLoc = document.getElementById("lbl-assign-ret-loc");
    if (lblAssignRetLoc) lblAssignRetLoc.textContent = isEn ? "Return Meeting Location" : "สถานที่นัดรับรถคืน";
    const lblAssignRetDate = document.getElementById("lbl-assign-ret-date");
    if (lblAssignRetDate) lblAssignRetDate.textContent = isEn ? "Appointment Return Date" : "วันที่นัดหมายรับคืน";
    const lblAssignRetTime = document.getElementById("lbl-assign-ret-time");
    if (lblAssignRetTime) lblAssignRetTime.textContent = isEn ? "Appointment Time" : "เวลานัดหมาย";
    const btnAssignRetSched = document.getElementById("btn-assign-ret-sched");
    if (btnAssignRetSched) btnAssignRetSched.textContent = isEn ? "📋 Schedule (Preparing Return)" : "📋 นัดรับคืน (เตรียมรับคืน)";
    const btnAssignRetComplete = document.getElementById("btn-assign-ret-complete");
    if (btnAssignRetComplete) btnAssignRetComplete.textContent = isEn ? "🏁 Returned (Completed) ➔" : "🏁 รับคืนแล้ว (เสร็จสิ้น) ➔";

    // --- Front Office Tab 4: Rental Agreement ---
    const t4Title = document.getElementById("title-tab4");
    if (t4Title) t4Title.textContent = isEn ? "📝 Rental Contract Formulation & Inspection Center" : "📝 ศูนย์จัดทำและตรวจสอบสัญญาเช่า (Rental Contract Formulation & Inspection)";
    const t4Sub = document.getElementById("subtitle-tab4");
    if (t4Sub) t4Sub.textContent = isEn ? "Generate and download official vehicle rental contract (Official Rental Agreement PDF) with 100% precision coordinates and receipts" : "สร้างและดาวน์โหลดสัญญาเช่ารถยนต์ทางการ (Official Rental Agreement PDF) พิกัดมาตรฐานเป๊ะ 100% พร้อมใบเสร็จรับเงิน";
    const lblContractSelBk = document.getElementById("lbl-contract-sel-bk");
    if (lblContractSelBk) lblContractSelBk.textContent = isEn ? "📌 Select Booking for Contract / PDF Review:" : "📌 เลือกรหัสการจองสำหรับออกสัญญา / ตรวจสอบ PDF:";
    const optContractSelDef = document.getElementById("opt-contract-sel-default");
    if (optContractSelDef) optContractSelDef.textContent = isEn ? "-- Please select a booking --" : "-- กรุณาเลือกรายการจอง --";
    const btnRefreshContracts = document.getElementById("btn-refresh-contracts");
    if (btnRefreshContracts) btnRefreshContracts.textContent = isEn ? "🔄 Refresh List" : "🔄 รีเฟรชรายการ";
    const contractEmptyMsg = document.getElementById("contract-empty-msg");
    if (contractEmptyMsg) contractEmptyMsg.textContent = isEn ? "ℹ️ No active rental agreements currently in the system..." : "ℹ️ ยังไม่มีรายการสัญญาเช่าที่เปิดใช้งานอยู่ในระบบ (คุณสามารถเลือกสร้างสัญญาใหม่ได้จากแบบฟอร์ม Walk-in ด้านล่าง)";

    const hdrContractCust = document.getElementById("hdr-contract-cust-info");
    if (hdrContractCust) hdrContractCust.textContent = isEn ? "👤 Tenant Information" : "👤 ข้อมูลผู้เช่า";
    const hdrContractCar = document.getElementById("hdr-contract-car-info");
    if (hdrContractCar) hdrContractCar.textContent = isEn ? "🚘 Vehicle Information" : "🚘 ข้อมูลรถยนต์";
    const hdrContractSched = document.getElementById("hdr-contract-sched-info");
    if (hdrContractSched) hdrContractSched.textContent = isEn ? "📅 Schedule & Contract Details" : "📅 กำหนดการ & ข้อมูลสัญญา";

    const lblContractNetP = document.getElementById("lbl-contract-net-price");
    if (lblContractNetP) lblContractNetP.textContent = isEn ? "Agreed Rental Price" : "ราคาค่าเช่าที่ตกลง";
    const lblContractDepStat = document.getElementById("lbl-contract-dep-status");
    if (lblContractDepStat) lblContractDepStat.textContent = isEn ? "Deposit Status" : "สถานะเงินมัดจำ";
    const lblContractRemP = document.getElementById("lbl-contract-rem-price");
    if (lblContractRemP) lblContractRemP.textContent = isEn ? "Remaining Rental Fee" : "ค่าเช่าคงเหลือที่ต้องชำระ";

    const hdrContractDocs = document.getElementById("hdr-contract-doc-center");
    if (hdrContractDocs) hdrContractDocs.textContent = isEn ? "📑 PDF Document Center (Official Formats)" : "📑 ศูนย์ดาวน์โหลดเอกสาร PDF (แบบมาตรฐานทางการ)";
    const btnDlContractPdf = document.getElementById("btn-dl-contract-pdf");
    if (btnDlContractPdf) btnDlContractPdf.textContent = isEn ? "📝 Download Contract PDF" : "📝 ดาวน์โหลดสัญญาเช่า (PDF)";
    const btnDlContractDepRec = document.getElementById("btn-dl-contract-dep-receipt");
    if (btnDlContractDepRec) btnDlContractDepRec.textContent = isEn ? "🛡️ Deposit Receipt (PDF)" : "🛡️ ใบเสร็จมัดจำ (PDF)";
    const btnDlContractRentRec = document.getElementById("btn-dl-contract-rent-receipt");
    if (btnDlContractRentRec) btnDlContractRentRec.textContent = isEn ? "🧾 Rental Receipt (PDF)" : "🧾 ใบเสร็จรับเงินค่าเช่า (PDF)";
    const btnDlContractJob = document.getElementById("btn-dl-contract-job");
    if (btnDlContractJob) btnDlContractJob.textContent = isEn ? "📋 Inspection Checklist (PDF)" : "📋 ใบเช็ครถ/ส่งมอบ (PDF)";
    const btnMarkIssued = document.getElementById("btn-mark-contract-issued");
    if (btnMarkIssued) btnMarkIssued.textContent = isEn ? "✅ Confirm Contract Issued" : "✅ ยืนยันออกสัญญาเรียบร้อย";
    const btnGotoDepContract = document.getElementById("btn-goto-deposit-from-contract");
    if (btnGotoDepContract) btnGotoDepContract.textContent = isEn ? "💳 Go to Payment / Deposit ➔" : "💳 ไปหน้าการเงิน & รับมัดจำ ➔";

    // Tab 4 Walk-in Direct Formulation
    const tWalkin = document.getElementById("title-walkin-contract");
    if (tWalkin) tWalkin.textContent = isEn ? "➕ Direct Contract Formulation (Walk-in Direct Contract Formulation)" : "➕ สร้างสัญญาเช่าใหม่โดยตรง (Walk-in Direct Contract Formulation)";
    const subWalkin = document.getElementById("subtitle-walkin-contract");
    if (subWalkin) subWalkin.textContent = isEn ? "In case a walk-in customer signs an on-site contract, fill out details here to issue the contract and schedule dispatch immediately" : "กรณีลูกค้า Walk-in เข้ามาทำสัญญาที่หน้าร้านโดยตรง กรอกข้อมูลที่นี่เพื่อออกสัญญาและนัดหมายส่งรถได้ทันที";
    const lblWalkinCar = document.getElementById("lbl-walkin-car");
    if (lblWalkinCar) lblWalkinCar.textContent = isEn ? "🚗 Select Vehicle from Fleet*" : "🚗 เลือกรถยนต์จากฝูงรถ*";
    const optWalkinCarDef = document.getElementById("opt-walkin-car-default");
    if (optWalkinCarDef) optWalkinCarDef.textContent = isEn ? "-- Select vehicle from fleet --" : "-- เลือกรถยนต์จากฝูงรถ --";
    const lblWalkinCust = document.getElementById("lbl-walkin-cust");
    if (lblWalkinCust) lblWalkinCust.textContent = isEn ? "👤 Select Customer / Tenant*" : "👤 เลือกลูกค้าผู้เช่า*";
    const btnWalkinCustEdit = document.getElementById("btn-walkin-cust-edit");
    if (btnWalkinCustEdit) btnWalkinCustEdit.textContent = isEn ? "✏️ Edit" : "✏️ แก้ไข";
    const btnWalkinCustDel = document.getElementById("btn-walkin-cust-del");
    if (btnWalkinCustDel) btnWalkinCustDel.textContent = isEn ? "🗑️ Delete" : "🗑️ ลบ";
    const btnWalkinCustAdd = document.getElementById("btn-walkin-cust-add");
    if (btnWalkinCustAdd) btnWalkinCustAdd.textContent = isEn ? "➕ Add Customer" : "➕ เพิ่มลูกค้า";
    const lblWalkinStart = document.getElementById("lbl-walkin-start");
    if (lblWalkinStart) lblWalkinStart.textContent = isEn ? "📅 Start Date & Time (Thai Time)*" : "📅 วันที่และเวลาเริ่มสัญญา (เวลาไทย)*";
    const lblWalkinEnd = document.getElementById("lbl-walkin-end");
    if (lblWalkinEnd) lblWalkinEnd.textContent = isEn ? "📅 End Date & Time (Thai Time)*" : "📅 วันที่และเวลาสิ้นสุดสัญญา (เวลาไทย)*";
    const lblWalkinType = document.getElementById("lbl-walkin-type");
    if (lblWalkinType) lblWalkinType.textContent = isEn ? "🏷️ Contract Type / Rate" : "🏷️ ประเภทสัญญา / เรทราคา";
    const optWalkinDaily = document.getElementById("opt-walkin-type-daily");
    if (optWalkinDaily) optWalkinDaily.textContent = isEn ? "Daily" : "รายวัน";
    const optWalkinWeekly = document.getElementById("opt-walkin-type-weekly");
    if (optWalkinWeekly) optWalkinWeekly.textContent = isEn ? "Weekly" : "รายสัปดาห์";
    const optWalkinMonthly = document.getElementById("opt-walkin-type-monthly");
    if (optWalkinMonthly) optWalkinMonthly.textContent = isEn ? "Monthly" : "รายเดือน";
    const lblWalkinDisc = document.getElementById("lbl-walkin-discount");
    if (lblWalkinDisc) lblWalkinDisc.textContent = isEn ? "🏷️ Discount (THB)" : "🏷️ ส่วนลด (บาท)";
    const lblWalkinWorker = document.getElementById("lbl-walkin-worker");
    if (lblWalkinWorker) lblWalkinWorker.textContent = isEn ? "👷 Assign Delivery Staff" : "👷 พนักงานส่งมอบรถ";
    const lblWalkinLoc = document.getElementById("lbl-walkin-loc");
    if (lblWalkinLoc) lblWalkinLoc.textContent = isEn ? "📍 Delivery Location" : "📍 สถานที่ส่งมอบรถ";
    const btnSubmitWalkin = document.getElementById("btn-submit-walkin");
    if (btnSubmitWalkin) btnSubmitWalkin.textContent = isEn ? "📝 Formulate Contract & Proceed to Payment" : "📝 ออกสัญญาเช่า & ไปหน้าชำระเงิน";

    // --- Front Office Tab 5: Booking Pipeline ---
    const t5Title = document.getElementById("title-tab5");
    if (t5Title) t5Title.textContent = isEn ? "📋 Booking Queue & Master Bookings List" : "📋 แผงควบคุมคิวการจอง & รายการทั้งหมด (Master Bookings List)";
    const bksSearch = document.getElementById("bks-search-input");
    if (bksSearch) bksSearch.placeholder = isEn ? "🔍 Search booking ID, customer, plate..." : "🔍 ค้นหารหัส, ลูกค้า, ทะเบียน...";
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
    if (thBksDur) thBksDur.textContent = isEn ? "Rental Duration" : "ระยะเวลาเช่า";
    const thBksNet = document.getElementById("th-bks-net");
    if (thBksNet) thBksNet.textContent = isEn ? "Net Rental Fee" : "ค่าเช่าสุทธิ";
    const thBksPay = document.getElementById("th-bks-payment");
    if (thBksPay) thBksPay.textContent = isEn ? "Deposit & Payment Status" : "สถานะมัดจำ & ค่าเช่า";
    const thBksStat = document.getElementById("th-bks-status");
    if (thBksStat) thBksStat.textContent = isEn ? "Job Status" : "สถานะงาน";
    const thBksAct = document.getElementById("th-bks-action");
    if (thBksAct) thBksAct.textContent = isEn ? "Actions" : "จัดการ";

    // --- Modal: Add / Edit Vehicle Details ---
    const lblCarPhoto = document.getElementById("lbl-modal-car-photo");
    if (lblCarPhoto) lblCarPhoto.textContent = isEn ? "📸 Upload Vehicle Photo (JPG, PNG, WEBP):" : "📸 อัปโหลดรูปรถยนต์ (JPG, PNG, WEBP):";
    const lblCarImgUrl = document.getElementById("lbl-modal-car-imgurl");
    if (lblCarImgUrl) lblCarImgUrl.textContent = isEn ? "Or enter Image URL:" : "หรือใส่ลิงก์รูปภาพ (Image URL):";
    const lblCarPlate = document.getElementById("lbl-modal-car-plate");
    if (lblCarPlate) lblCarPlate.textContent = isEn ? "🚘 License Plate (Plate)*" : "🚘 เลขทะเบียนรถ (Plate)*";
    const inpCarPlate = document.getElementById("edit-car-plate");
    if (inpCarPlate) inpCarPlate.placeholder = isEn ? "e.g. 5KOR 5181" : "เช่น 5ขศ 5181";
    const warnCarPlate = document.getElementById("edit-car-plate-warn");
    if (warnCarPlate) warnCarPlate.textContent = isEn ? "⚠️ This plate already exists in system" : "⚠️ ทะเบียนนี้มีอยู่ในระบบแล้ว";

    const lblCarBrand = document.getElementById("lbl-modal-car-brand");
    if (lblCarBrand) lblCarBrand.textContent = isEn ? "🏷️ Brand / Make*" : "🏷️ ยี่ห้อ (Brand)*";
    const inpCarBrand = document.getElementById("edit-car-brand");
    if (inpCarBrand) inpCarBrand.placeholder = isEn ? "e.g. Toyota" : "เช่น Toyota";

    const lblCarModel = document.getElementById("lbl-modal-car-model");
    if (lblCarModel) lblCarModel.textContent = isEn ? "🚗 Vehicle Model*" : "🚗 รุ่นรถยนต์ (Model)*";
    const inpCarModel = document.getElementById("edit-car-model");
    if (inpCarModel) inpCarModel.placeholder = isEn ? "e.g. Yaris Ativ" : "เช่น Yaris Ativ";

    const lblCarGroup = document.getElementById("lbl-modal-car-group");
    if (lblCarGroup) lblCarGroup.textContent = isEn ? "💺 Vehicle Group*" : "💺 กลุ่มรถ (Car Group)*";
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
    if (lblCarFuel) lblCarFuel.textContent = isEn ? "⛽ Fuel System*" : "⛽ ระบบเชื้อเพลิง*";
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
    if (lblCarCc) lblCarCc.textContent = isEn ? "⚙️ Engine Capacity (CC / EV)" : "⚙️ ขนาดเครื่องยนต์ (CC / EV)";
    const inpCarCc = document.getElementById("edit-car-cc");
    if (inpCarCc) inpCarCc.placeholder = isEn ? "e.g. 1200 or 1800" : "เช่น 1200 หรือ 1800";

    const lblCarComp = document.getElementById("lbl-modal-car-company");
    if (lblCarComp) lblCarComp.textContent = isEn ? "🏢 Ownership / Company*" : "🏢 เจ้าของกรรมสิทธิ์ / บริษัท*";
    const inpCarComp = document.getElementById("edit-car-company");
    if (inpCarComp) inpCarComp.placeholder = isEn ? "e.g. Sawasdee Rent A Car" : "เช่น Sawasdee Rent A Car";

    const lblCarColor = document.getElementById("lbl-modal-car-color");
    if (lblCarColor) lblCarColor.textContent = isEn ? "🎨 Body Color" : "🎨 สีตัวถัง (Color)";
    const inpCarColor = document.getElementById("edit-car-color");
    if (inpCarColor) inpCarColor.placeholder = isEn ? "e.g. White, Black, Grey" : "เช่น ขาว, ดำ, เทา";

    const lblCarMil = document.getElementById("lbl-modal-car-mileage");
    if (lblCarMil) lblCarMil.textContent = isEn ? "🔢 Odometer Mileage (km)" : "🔢 เลขไมล์สะสม (km)";
    const inpCarMil = document.getElementById("edit-car-mileage");
    if (inpCarMil) inpCarMil.placeholder = isEn ? "e.g. 25,000" : "เช่น 25,000";

    const lblCarPday = document.getElementById("lbl-modal-car-pday");
    if (lblCarPday) lblCarPday.textContent = isEn ? "💰 Daily Rate (THB)*" : "💰 ค่าเช่ารายวัน (บาท)*";
    const lblCarPweek = document.getElementById("lbl-modal-car-pweek");
    if (lblCarPweek) lblCarPweek.textContent = isEn ? "💰 Weekly Rate (THB)" : "💰 ค่าเช่ารายสัปดาห์ (บาท)";
    const lblCarPmonth = document.getElementById("lbl-modal-car-pmonth");
    if (lblCarPmonth) lblCarPmonth.textContent = isEn ? "💰 Monthly Rate (THB)" : "💰 ค่าเช่ารายเดือน (บาท)";

    const lblCarVin = document.getElementById("lbl-modal-car-vin");
    if (lblCarVin) lblCarVin.textContent = isEn ? "🔑 VIN / Chassis Number*" : "🔑 เลขตัวถัง (VIN)*";
    const warnCarVin = document.getElementById("edit-car-vin-warn");
    if (warnCarVin) warnCarVin.textContent = isEn ? "⚠️ This VIN already exists in system" : "⚠️ เลขตัวถังนี้ซ้ำกับรถคันอื่นในระบบ";

    const lblCarTax = document.getElementById("lbl-modal-car-tax");
    if (lblCarTax) lblCarTax.textContent = isEn ? "🏷️ Tax Expiry Date" : "🏷️ วันหมดอายุ ภาษี";
    const lblCarAct = document.getElementById("lbl-modal-car-act");
    if (lblCarAct) lblCarAct.textContent = isEn ? "📅 ACT Expiry Date" : "📅 วันหมดอายุ พ.ร.บ.";
    const lblCarIns = document.getElementById("lbl-modal-car-ins");
    if (lblCarIns) lblCarIns.textContent = isEn ? "📅 Insurance Expiry Date" : "📅 วันหมดอายุ ประกันภัย";

    const lblCarInsComp = document.getElementById("lbl-modal-car-ins-comp");
    if (lblCarInsComp) lblCarInsComp.textContent = isEn ? "🛡️ Insurance Company" : "🛡️ บริษัทประกันภัย";
    const inpCarInsComp = document.getElementById("edit-car-ins-comp");
    if (inpCarInsComp) inpCarInsComp.placeholder = isEn ? "e.g. Tokio Marine" : "เช่น คุ้มภัยโตเกียวมารีน";

    const lblCarOwner = document.getElementById("lbl-modal-car-owner");
    if (lblCarOwner) lblCarOwner.textContent = isEn ? "👤 Vehicle Owner" : "👤 เจ้าของรถ (Owner)";
    const inpCarOwner = document.getElementById("edit-car-owner");
    if (inpCarOwner) inpCarOwner.placeholder = isEn ? "e.g. SWD, B-Click" : "เช่น SWD, บีคลิ๊ก";

    const lblCarBeneficiary = document.getElementById("lbl-modal-car-beneficiary");
    if (lblCarBeneficiary) lblCarBeneficiary.textContent = isEn ? "🏛️ Beneficiary" : "🏛️ ผู้รับผลประโยชน์";
    const inpCarBeneficiary = document.getElementById("edit-car-beneficiary");
    if (inpCarBeneficiary) inpCarBeneficiary.placeholder = isEn ? "e.g. Sawasdee Rental" : "เช่น สวัสดี เรนทัล";

    const lblCarRegYear = document.getElementById("lbl-modal-car-reg-year");
    if (lblCarRegYear) lblCarRegYear.textContent = isEn ? "📆 Registration Year (B.E./A.D.)" : "📆 จดทะเบียนปี (พ.ศ.)";
    const inpCarRegYear = document.getElementById("edit-car-reg-year");
    if (inpCarRegYear) inpCarRegYear.placeholder = isEn ? "e.g. 2024 or 2567" : "เช่น 2567";

    const lblCarLastSrv = document.getElementById("lbl-modal-car-last-srv");
    if (lblCarLastSrv) lblCarLastSrv.textContent = isEn ? "🔧 Last Service Date" : "🔧 วันที่เช็คระยะล่าสุด";
    const inpCarLastSrv = document.getElementById("edit-car-last-srv");
    if (inpCarLastSrv) inpCarLastSrv.placeholder = isEn ? "DD/MM/YYYY or -" : "DD/MM/YYYY หรือ -";

    const lblCarNextSrv = document.getElementById("lbl-modal-car-next-srv");
    if (lblCarNextSrv) lblCarNextSrv.textContent = isEn ? "⏭️ Next Scheduled Service" : "⏭️ กำหนดเช็คระยะครั้งต่อไป";
    const inpCarNextSrv = document.getElementById("edit-car-next-srv");
    if (inpCarNextSrv) inpCarNextSrv.placeholder = isEn ? "DD/MM/YYYY or Mileage" : "DD/MM/YYYY หรือ เลขไมล์";

    const lblCarStatus = document.getElementById("lbl-modal-car-status");
    if (lblCarStatus) lblCarStatus.textContent = isEn ? "🚦 Vehicle Status*" : "🚦 สถานะรถยนต์*";
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

    const lblCarNotes = document.getElementById("lbl-modal-car-notes");
    if (lblCarNotes) lblCarNotes.textContent = isEn ? "📝 Additional Notes & Info" : "📝 หมายเหตุ / ข้อมูลเพิ่มเติม (Notes)";
    const inpCarNotes = document.getElementById("edit-car-notes");
    if (inpCarNotes) inpCarNotes.placeholder = isEn ? "e.g. Logbook on hand, regular customer, claim history..." : "เช่น มีเล่มทะเบียน, ผู้เช่าประจำ, ประวัติเคลม...";

    const btnCarDelModal = document.getElementById("btn-modal-car-delete");
    if (btnCarDelModal) btnCarDelModal.textContent = isEn ? "🗑️ Delete This Vehicle" : "🗑️ ลบข้อมูลรถยนต์คันนี้";
    const btnCarCancelModal = document.getElementById("btn-modal-car-cancel");
    if (btnCarCancelModal) btnCarCancelModal.textContent = isEn ? "Cancel" : "ยกเลิก";
    const btnCarSaveModal = document.getElementById("btn-submit-edit-car");
    if (btnCarSaveModal) btnCarSaveModal.textContent = isEn ? "💾 Save Vehicle Data" : "💾 บันทึกข้อมูลรถยนต์";

    // 5. Search box placeholder
    const sbInput = document.getElementById("sb-search-input");
    if (sbInput) {
      sbInput.placeholder = isEn ? "🔍 Search (Booking / Plate / Customer)" : "🔍 ค้นหา (เลขที่จอง / ทะเบียน / ลูกค้า)";
    }

    // 6. Topbar & Sidebar Labels
    const syncLbl = document.getElementById("sync-label");
    if (syncLbl) syncLbl.textContent = isEn ? "Auto Cloud Sync:" : "ซิงค์ Cloud อัตโนมัติ:";
    const sbCardLbl = document.getElementById("sb-user-card-label");
    if (sbCardLbl) sbCardLbl.textContent = isEn ? "Logged in as:" : "เข้าสู่ระบบโดย:";
    const sbAdminStaff = document.getElementById("sb-admin-staff-text");
    if (sbAdminStaff) sbAdminStaff.textContent = isEn ? "👥 Manage & Approve Staff" : "👥 จัดการ & อนุมัติพนักงาน";

    // 7. Back Office Module Content
    const boTitle = document.getElementById("bo-title-text");
    if (boTitle) boTitle.textContent = isEn ? "Back Office (Vehicle Dispatch & Return Work Orders)" : "Back Office (ตารางใบงานสำหรับคนงาน / พนักงานขับรถ)";
    const boSubtitle = document.getElementById("bo-subtitle-text");
    if (boSubtitle) boSubtitle.textContent = isEn ? "Vehicle Dispatch & Return Work Orders Table & PDF Document Center" : "Vehicle Dispatch & Return Work Orders Table & PDF Document Center";
    const boAdminBadge = document.getElementById("bo-admin-badge");
    if (boAdminBadge) {
      const isUserAdmin = (this.user && (this.user.role === "Admin" || (this.user.username || "").toLowerCase() === "admin"));
      if (isUserAdmin) {
        boAdminBadge.textContent = isEn ? "👑 Admin Privilege: Can manage all work orders" : "👑 สิทธิ์ผู้ดูแลระบบ (Admin): สั่งงานได้ทุกใบงาน";
      } else {
        const uName = this.user ? this.user.username : "";
        boAdminBadge.textContent = isEn ? `👷 Staff Privilege: ${uName} (Assigned jobs only)` : `👷 สิทธิ์พนักงาน: ${uName} (ส่งงานได้เฉพาะงานที่ได้รับมอบหมาย)`;
      }
    }
    const boSearch = document.getElementById("bo-search-input");
    if (boSearch) boSearch.placeholder = isEn ? "🔍 Search work orders..." : "🔍 ค้นหาใบงาน...";
    const boRefresh = document.getElementById("bo-refresh-btn");
    if (boRefresh) boRefresh.textContent = isEn ? "🔄 Refresh" : "🔄 รีเฟรช";
    const boTblHdr = document.getElementById("bo-table-header-text");
    if (boTblHdr) boTblHdr.textContent = isEn ? "All Vehicle Dispatch & Return Work Orders" : "รายการใบงานรับ-ส่งรถทั้งหมดในระบบ";

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
    if (thActs) thActs.textContent = isEn ? "Documents & Actions" : "เอกสาร & ส่งงาน";

    // 9. Re-render jobs in Back Office if table exists
    if (this.renderBackOfficeJobs) {
      this.renderBackOfficeJobs();
    }

    // 10. Maintenance & Services Module Localization
    const mTitle = document.getElementById("mnt-title-text") || document.getElementById("maint-title-text");
    if (mTitle) mTitle.textContent = isEn ? "Fleet Maintenance & Service Center" : "โมดูลซ่อมบำรุง & บริการ (Fleet Maintenance & Service Center)";
    const mSubtitle = document.getElementById("mnt-subtitle-text") || document.getElementById("maint-subtitle-text");
    if (mSubtitle) mSubtitle.textContent = isEn ? "Maintenance management center for fleet inspection, work orders, and vehicle tax/ACT/insurance renewals" : "ศูนย์จัดการงานซ่อมบำรุง ตรวจเช็คสภาพ ออกใบงานให้พนักงาน และต่อทะเบียนภาษี-พรบ.-ประกันภัยรถยนต์";
    const btnMntNew = document.getElementById("btn-mnt-new") || document.getElementById("btn-maint-open-modal");
    if (btnMntNew) btnMntNew.textContent = isEn ? "➕ New Service / Work Order" : "➕ ออกใบงานซ่อมบำรุงใหม่";
    const btnMntRenew = document.getElementById("btn-mnt-renewal");
    if (btnMntRenew) btnMntRenew.textContent = isEn ? "📄 Tax/ACT/Ins Renewal Order" : "📄 ออกใบงานต่อทะเบียน-พรบ.-ประกัน";
    const btnMntRef = document.getElementById("btn-mnt-refresh") || document.getElementById("btn-maint-refresh");
    if (btnMntRef) btnMntRef.textContent = isEn ? "🔄 Refresh" : "🔄 รีเฟรช";

    // Maintenance KPI labels
    const mKpi1 = document.getElementById("mnt-kpi-inprog-lbl") || document.getElementById("maint-kpi-in-garage-lbl");
    if (mKpi1) mKpi1.textContent = isEn ? "🚗 In Garage / Service Center" : "🚗 กำลังซ่อมบำรุงในอู่/ศูนย์";
    const mKpi2 = document.getElementById("mnt-kpi-pending-lbl") || document.getElementById("maint-kpi-pending-lbl");
    if (mKpi2) mKpi2.textContent = isEn ? "⏳ Pending Work Orders" : "⏳ ใบงานรอดำเนินการ";
    const mKpi3 = document.getElementById("mnt-kpi-total-lbl") || document.getElementById("maint-kpi-total-cost-lbl");
    if (mKpi3) mKpi3.textContent = isEn ? "💰 Total Maintenance & Services Cost" : "💰 รวมค่าซ่อมบำรุงและบริการ";
    const mKpi4 = document.getElementById("mnt-kpi-renewal-lbl") || document.getElementById("maint-kpi-renewal-lbl");
    if (mKpi4) mKpi4.textContent = isEn ? "🛡️ Tax / ACT / Insurance Renewals" : "🛡️ งานต่อทะเบียน / พรบ. / ประกัน";

    // Maintenance filter bar
    const mLblSearch = document.getElementById("mnt-lbl-search");
    if (mLblSearch) mLblSearch.textContent = isEn ? "🔍 Search (Plate / Work Order / Garage / Issue):" : "🔍 ค้นหา (ทะเบียน / เลขใบงาน / อู่ / รายการซ่อม):";
    const mSearch = document.getElementById("mnt-search-input");
    if (mSearch) mSearch.placeholder = isEn ? "Search plate, garage, work order, details..." : "พิมพ์ค้นหา...";

    const mLblType = document.getElementById("mnt-lbl-type") || document.getElementById("maint-filter-type-lbl");
    if (mLblType) mLblType.textContent = isEn ? "📋 Filter Job Category:" : "📋 กรองประเภทงาน:";
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
    if (mLblStat) mLblStat.textContent = isEn ? "🚦 Filter Status:" : "🚦 กรองสถานะ:";
    const optMStatAll = document.getElementById("opt-mnt-status-all");
    if (optMStatAll) optMStatAll.textContent = isEn ? "All" : "ทั้งหมด";
    const optMStatRep = document.getElementById("opt-mnt-status-repairing");
    if (optMStatRep) optMStatRep.textContent = isEn ? "In Repair" : "กำลังซ่อมบำรุง";
    const optMStatPend = document.getElementById("opt-mnt-status-pending");
    if (optMStatPend) optMStatPend.textContent = isEn ? "Pending" : "รอดำเนินการ";
    const optMStatDone = document.getElementById("opt-mnt-status-done");
    if (optMStatDone) optMStatDone.textContent = isEn ? "Completed" : "เสร็จสิ้น";

    const mLblCar = document.getElementById("mnt-lbl-car");
    if (mLblCar) mLblCar.textContent = isEn ? "🚘 Select Vehicle:" : "🚘 เลือกรถ:";
    const optMCarAll = document.getElementById("opt-mnt-car-all");
    if (optMCarAll) optMCarAll.textContent = isEn ? "All Vehicles" : "ทุกคัน";

    // Maintenance Table Title & Headers
    const mTblTitlePfx = document.getElementById("mnt-table-title-prefix");
    if (mTblTitlePfx) mTblTitlePfx.textContent = isEn ? "📋 All Maintenance & Service History Records (" : "📋 รายการประวัติการซ่อมบำรุงและบริการทั้งหมด (";
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
      ? '<span>📊</span> Executive Dashboard & Total Fleet' 
      : '<span>📊</span> ภาพรวมและแดชบอร์ดผู้บริหาร (Executive Dashboard & Total Fleet)';
    const dSubtitle = document.getElementById("dash-main-subtitle");
    if (dSubtitle) dSubtitle.textContent = isEn 
      ? "Real-time summary of fleet metrics, revenues, and operational performance across all companies" 
      : "สรุปภาพรวมยานพาหนะ รายรับ และประสิทธิภาพการดำเนินงานรวมทุกสาขาและบริษัทในเครือ (Unified Real-Time Fleet)";

    const dKpiFleet = document.getElementById("dash-kpi-fleet-lbl");
    if (dKpiFleet) dKpiFleet.textContent = isEn ? "Total Fleet" : "กองยานพาหนะ (Fleet)";
    const dKpiFleetBdg = document.getElementById("dash-kpi-fleet-badge");
    if (dKpiFleetBdg) dKpiFleetBdg.textContent = isEn ? "➔ Fleet Showcase" : "➔ ไปหน้าเลือกรถ";

    const dKpiActive = document.getElementById("dash-kpi-active-lbl");
    if (dKpiActive) dKpiActive.textContent = isEn ? "Active / Booked Rentals" : "รถกำลังเช่า/ติดจอง (Active)";
    const dKpiActiveBdg = document.getElementById("dash-kpi-active-badge");
    if (dKpiActiveBdg) dKpiActiveBdg.textContent = isEn ? "🔍 View Active Rentals" : "🔍 ดูรถที่อยู่กับลูกค้า";

    const dKpiUtil = document.getElementById("dash-kpi-util-lbl");
    if (dKpiUtil) dKpiUtil.textContent = isEn ? "Fleet Utilization" : "อัตราการใช้รถ (Utilization)";
    const dKpiUtilBdg = document.getElementById("dash-kpi-util-badge");
    if (dKpiUtilBdg) dKpiUtilBdg.textContent = isEn ? "🏆 Net Profit Rank" : "🏆 อันดับกำไรสุทธิ";

    const dKpiRev = document.getElementById("dash-kpi-rev-lbl");
    if (dKpiRev) dKpiRev.textContent = isEn ? "Total Revenue (Revenue)" : "รายรับสะสมรวม (Revenue)";

    const dAlertTitle = document.getElementById("dash-alert-title");
    if (dAlertTitle) dAlertTitle.textContent = isEn 
      ? "🚨 Automated Tax / ACT / Insurance LINE Notification (Broadcast 20:00)" 
      : "🚨 ระบบตรวจสอบ พ.ร.บ. / ประกันภัย ผ่าน LINE อัตโนมัติ (Broadcast 20:00 น.)";
    const dAlertDesc = document.getElementById("dash-alert-desc");
    if (dAlertDesc) dAlertDesc.textContent = isEn 
      ? "Automated broadcast daily at 20:00 (30 days, 7 days prior, and expiration date) • Once renewed in the table below, alerts for that vehicle stop immediately." 
      : "ส่งแจ้งเตือนอัตโนมัติทุกวันเวลา 20:00 น. (ล่วงหน้า 30 วัน, 7 วัน และวันหมดอายุ) • เมื่อกด 🔄 อัปเดตต่ออายุในตารางด้านล่างแล้ว ระบบจะหยุดส่งแจ้งเตือนรายการนั้นทันที";
    const btnLineCheck = document.getElementById("btn-dash-line-check");
    if (btnLineCheck) btnLineCheck.textContent = isEn ? "📲 Check & Send LINE Now" : "📲 ตรวจสอบ & ส่ง LINE ทันที";

    const dDonutTitle = document.getElementById("dash-donut-title");
    if (dDonutTitle) dDonutTitle.textContent = isEn ? "Current Fleet Status" : "สถานะกองยานพาหนะปัจจุบัน (Total Fleet Status)";
    const dDonutSubtitle = document.getElementById("dash-donut-subtitle");
    if (dDonutSubtitle) dDonutSubtitle.textContent = isEn ? "Fleet status breakdown (Interactive Donut Chart)" : "สัดส่วนสถานะรถทั้งหมดในระบบ (Interactive Donut Chart)";

    const dTrendTitle = document.getElementById("dash-trend-title");
    if (dTrendTitle) dTrendTitle.textContent = isEn ? "Total Revenue Trend" : "แนวโน้มรายรับสะสมรวม (Total Revenue Trend)";
    const dTrendSubtitle = document.getElementById("dash-trend-subtitle");
    if (dTrendSubtitle) dTrendSubtitle.textContent = isEn ? "Monthly revenue trend (Interactive Total Revenue Chart)" : "ยอดรายรับรวมย้อนหลังรายเดือน (Interactive Total Revenue Chart)";

    const btnTrendBar = document.getElementById("btn-trend-bar");
    if (btnTrendBar) btnTrendBar.textContent = isEn ? "📊 Bar Chart" : "📊 กราฟแท่ง (Bar)";
    const btnTrendArea = document.getElementById("btn-trend-area");
    if (btnTrendArea) btnTrendArea.textContent = isEn ? "📈 Area Chart" : "📈 กราฟพื้นที่ (Area)";

    const dFleetSortLbl = document.getElementById("dash-fleet-sort-lbl");
    if (dFleetSortLbl) dFleetSortLbl.textContent = isEn ? "🔽 Sort By:" : "🔽 เรียงลำดับตาราง:";
    const optSortExp = document.getElementById("opt-dash-sort-exp");
    if (optSortExp) optSortExp.textContent = isEn ? "⏳ Expiry Date (Tax / ACT / Ins nearest first)" : "⏳ วันหมดอายุ ภาษี / พ.ร.บ. / ประกัน ใกล้หมดก่อน (ค่าเริ่มต้น)";
    const optSortTax = document.getElementById("opt-dash-sort-tax");
    if (optSortTax) optSortTax.textContent = isEn ? "🏷️ Tax Expiry Date nearest first" : "🏷️ วันหมดอายุ ภาษีรถยนต์ ใกล้หมดก่อน";
    const optSortAct = document.getElementById("opt-dash-sort-act");
    if (optSortAct) optSortAct.textContent = isEn ? "🛡️ ACT Expiry Date nearest first" : "🛡️ วันหมดอายุ พ.ร.บ. ใกล้หมดก่อน";
    const optSortIns = document.getElementById("opt-dash-sort-ins");
    if (optSortIns) optSortIns.textContent = isEn ? "📑 Insurance Expiry Date nearest first" : "📑 วันหมดอายุ ประกันภัย ใกล้หมดก่อน";
    const optSortPlate = document.getElementById("opt-dash-sort-plate");
    if (optSortPlate) optSortPlate.textContent = isEn ? "🚘 Plate No. (A-Z / 0-9)" : "🚘 เลขทะเบียนรถ (ก-ฮ / 0-9)";

    const dFleetSearch = document.getElementById("dash-fleet-search-input");
    if (dFleetSearch) dFleetSearch.placeholder = isEn ? "🔍 Search plate / VIN / model / insurance / notes..." : "🔍 ค้นหาทะเบียน / เลขถัง / รุ่น / ประกัน / หมายเหตุ...";
    const btnAddCar = document.getElementById("btn-dash-add-car");
    if (btnAddCar) btnAddCar.textContent = isEn ? "➕ Add New Vehicle" : "➕ เพิ่มรถใหม่";

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
      ? 'Automatic duplicate prevention (Plate and VIN). Click <b>✏️</b> to edit expiry dates or click <b>📋 Work Order</b> to assign staff immediately.' 
      : 'ระบบตรวจสอบและป้องกันรถซ้ำอัตโนมัติ (ทั้งเลขทะเบียนและเลขตัวถัง VIN) สามารถคลิก <b>✏️</b> เพื่อแก้ไขวันหมดอายุภาษี/พ.ร.บ./ประกันภัย หรือกด <b>📋 ออกใบงาน</b> เพื่อมอบหมายพนักงานได้ทันที';

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
    if (lblRptMonth) lblRptMonth.textContent = isEn ? "📅 Select Month for Report:" : "📅 เลือกเดือนที่ต้องการดูรายงาน:";
    const lblRptComp = document.getElementById("lbl-report-company");
    if (lblRptComp) lblRptComp.textContent = isEn ? "🏢 Filter Report by Company:" : "🏢 เลือกรีพอร์ตตามบริษัท:";
    const optRptAllComp = document.getElementById("opt-report-all-comp");
    if (optRptAllComp) optRptAllComp.textContent = isEn ? "All (All Companies)" : "ทั้งหมด (ทุกบริษัท)";
    const btnRptAllM = document.getElementById("btn-report-all-months");
    if (btnRptAllM) btnRptAllM.textContent = isEn ? "🔄 View All Months" : "🔄 ดูทุกเดือนทั้งหมด";
    const btnExpCsv = document.getElementById("btn-export-csv");
    if (btnExpCsv) btnExpCsv.textContent = isEn ? "📥 Download Completed Jobs Summary (CSV for Excel)" : "📥 ดาวน์โหลดรายงานสรุปงานเสร็จสิ้น (CSV สำหรับ Excel)";

    const lblKpiJobs = document.getElementById("lbl-rpt-kpi-jobs");
    if (lblKpiJobs) lblKpiJobs.textContent = isEn ? "🏁 Total Completed Jobs" : "🏁 งานเสร็จสิ้นทั้งหมด";
    const lblKpiRev = document.getElementById("lbl-rpt-kpi-rev");
    if (lblKpiRev) lblKpiRev.textContent = isEn ? "💰 Total Rental Revenue" : "💰 รายรับรวมจากงานเช่า";
    const lblKpiCars = document.getElementById("lbl-rpt-kpi-cars");
    if (lblKpiCars) lblKpiCars.textContent = isEn ? "🚘 Active Vehicles" : "🚘 รถที่ให้บริการ";
    const lblKpiCusts = document.getElementById("lbl-rpt-kpi-custs");
    if (lblKpiCusts) lblKpiCusts.textContent = isEn ? "👥 Total Customers" : "👥 ลูกค้าที่ใช้บริการ";

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
    this.showToast("🔄 กำลังซิงค์ข้อมูลกับ Supabase Cloud...", "info");
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
      this.renderFleetCards();
      this.renderFleetOverviewTable();
      if (this.activeModule === "dashboard") {
        this.renderDashboardCharts();
      }
    }
  }

  populateFleetDropdowns() {
    // 1. Group Dropdown
    const selGroup = document.getElementById("filter-group");
    if (selGroup) {
      const curVal = selGroup.value;
      const groups = Array.from(new Set(this.cars.map(c => (c.car_group || "").trim()).filter(Boolean))).sort();
      selGroup.innerHTML = '<option value="ทั้งหมด">ทั้งหมด</option>' + 
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
      selBrand.innerHTML = '<option value="ทั้งหมด">ทั้งหมด</option>' + 
        brands.map(b => `<option value="${b}">${b}</option>`).join("");
      if (curVal && (curVal === "ทั้งหมด" || brands.includes(curVal))) {
        selBrand.value = curVal;
      }
    }

    // 3. Company Dropdown
    const selComp = document.getElementById("filter-company");
    if (selComp) {
      const curVal = selComp.value;
      const companies = Array.from(new Set(this.cars.map(c => (c.company || "").trim()).filter(Boolean))).sort();
      selComp.innerHTML = '<option value="ทั้งหมด">ทั้งหมด</option>' + 
        companies.map(co => `<option value="${co}">${co}</option>`).join("");
      if (curVal && (curVal === "ทั้งหมด" || companies.includes(curVal))) {
        selComp.value = curVal;
      }
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
    this.showToast("🔄 คืนค่าตัวกรองทั้งหมดเรียบร้อย (เวลาไทย)", "info");
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
    const res = await fetch("/api/bookings");
    if (res.ok) {
      this.bookings = await res.json();
      const badge = document.getElementById("badge-frontoffice-bks");
      if (badge) badge.textContent = this.bookings.length;
      this.renderBookingsTable();
      this.populateBookingDropdowns();
    }
  }

  async loadBackOfficeJobs() {
    const res = await fetch("/api/backoffice/jobs");
    if (res.ok) {
      this.backofficeJobs = await res.json();
      const badge = document.getElementById("badge-backoffice-jobs");
      if (badge) badge.textContent = this.backofficeJobs.length;
      this.renderBackOfficeJobs();
    }
  }

  async loadDashboardKPIs() {
    try {
      const res = await fetch("/api/reports/kpis");
      if (res.ok) {
        this.rawKpiData = await res.json();
      }
      await this.loadMonthlyReports();
      this.updateDashboardKPIsFromScope();
      this.renderDashboardCharts();
      this.renderFleetOverviewTable();
    } catch (e) {}
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
    const isEn = (this.currentLang === "EN");
    const scopedCars = this.cars || [];

    const totalCars = scopedCars.length;
    const availCars = scopedCars.filter(c => c.fleet_status_key === "available" || c.status === "ว่างพร้อมใช้งาน").length;
    const maintCars = scopedCars.filter(c => c.fleet_status_key === "maintenance" || c.status === "ซ่อมบำรุง").length;
    const activeRentals = scopedCars.filter(c => c.fleet_status_key === "unavailable" || ["กำลังเช่า", "ติดจอง", "เตรียมส่งมอบ", "เตรียมรับคืน", "รอส่งมอบ"].includes(c.status)).length;
    const utilRate = totalCars > 0 ? ((activeRentals / totalCars) * 100).toFixed(1) : "0.0";

    let totalRev = 0;
    if (this.rawKpiData && this.rawKpiData.total_revenue !== undefined) {
      totalRev = parseFloat(this.rawKpiData.total_revenue || 0);
    } else {
      totalRev = (this.completedJobs || []).reduce((sum, j) => sum + parseFloat(j.net_price || 0), 0);
    }

    const elTotal = document.getElementById("kpi-total-cars");
    const elAvail = document.getElementById("kpi-avail-pill");
    const elActive = document.getElementById("kpi-active-rentals");
    const elMaint = document.getElementById("kpi-maint-pill");
    const elUtil = document.getElementById("kpi-utilization");
    const elRev = document.getElementById("kpi-total-revenue");
    const elUpd = document.getElementById("dash-last-updated-txt");

    if (elTotal) elTotal.textContent = totalCars;
    if (elAvail) elAvail.textContent = isEn ? `Available ${availCars} cars` : `พร้อมให้บริการ ${availCars} คัน`;
    if (elActive) elActive.textContent = activeRentals;
    if (elMaint) elMaint.textContent = isEn ? `Maintenance ${maintCars} cars` : `ซ่อมบำรุง ${maintCars} คัน`;
    if (elUtil) elUtil.textContent = `${utilRate}%`;
    if (elRev) elRev.textContent = `฿${totalRev.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
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

    if (modName === "backoffice") this.loadBackOfficeJobs();
    if (modName === "maintenance") this.loadMaintenanceRecords();
    if (modName === "customers") this.renderCustomersTable();
    if (modName === "dashboard") {
      this.loadDashboardKPIs();
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
    } else if (tabName === "contract") {
      this.populateBookingDropdowns();
      this.populateStaffDropdowns();
      this.populateWalkinDropdowns();
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
        ? `${baseDays} Days + Overtime ${extraHours} hrs ${remMins} mins (Over 4 hrs rounded to 1 day ➔ Total ${billableDays} Days)`
        : `${baseDays} วัน + เกินเวลา ${extraHours} ชม. ${remMins} น. (เกิน 4 ชม. ปรับเป็น 1 วัน ➔ คิด ${billableDays} วัน)`;
    } else {
      billableDays = Math.max(1, baseDays);
      if (extraHours > 0 || remMins > 0) {
        desc = isEn
          ? `${baseDays} Days + Overtime ${extraHours} hrs (Grace period ≤ 4 hrs ➔ Total ${billableDays} Days)`
          : `${baseDays} วัน + เกินเวลา ${extraHours} ชม. (อนุโลมไม่เกิน 4 ชม. ไม่คิดวันเพิ่ม ➔ คิด ${billableDays} วัน)`;
      } else {
        desc = isEn
          ? `${billableDays} Days exact (${billableDays * 24} Hours)`
          : `${billableDays} วันตรง (${billableDays * 24} ชั่วโมง)`;
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
    const priceDay = parseFloat(c.price_day !== undefined ? c.price_day : (c.daily_rate || 1000));
    const rawWeek = parseFloat(c.price_week || 0);
    const rawMonth = parseFloat(c.price_month || 0);
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

  getCarExpiryAlert(c, isEn) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checks = [
      { name: isEn ? "Insurance" : "ประกันภัย", dateStr: c.ins_expiry },
      { name: isEn ? "ACT" : "พ.ร.บ.", dateStr: c.act_expiry },
      { name: isEn ? "Tax" : "ภาษี", dateStr: c.tax_expiry }
    ];

    let minDiff = null;
    let urgentItem = null;

    for (const item of checks) {
      if (!item.dateStr || String(item.dateStr).trim() === "-" || String(item.dateStr).trim() === "") continue;
      const parts = String(item.dateStr).trim().split(/[\/-]/);
      let expD = null;
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          expD = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        } else {
          expD = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
        }
      }
      if (!expD || isNaN(expD.getTime())) continue;
      expD.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expD.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 30) {
        if (minDiff === null || diffDays < minDiff) {
          minDiff = diffDays;
          urgentItem = { name: item.name, diff: diffDays };
        }
      }
    }

    if (!urgentItem) return null;

    if (urgentItem.diff < 0) {
      const daysAgo = Math.abs(urgentItem.diff);
      return {
        text: isEn ? `${urgentItem.name} ${daysAgo} days overdue` : `${urgentItem.name} เกินกำหนด ${daysAgo} วัน`,
        bg: "#FEE2E2",
        border: "#FECACA",
        color: "#991B1B",
        dot: "#EF4444"
      };
    } else if (urgentItem.diff === 0) {
      return {
        text: isEn ? `${urgentItem.name} today` : `${urgentItem.name} หมดอายุวันนี้`,
        bg: "#FEF3C7",
        border: "#FDE68A",
        color: "#92400E",
        dot: "#F59E0B"
      };
    } else {
      return {
        text: isEn ? `${urgentItem.name} in ${urgentItem.diff} days` : `${urgentItem.name} ใน ${urgentItem.diff} วัน`,
        bg: "#FEF3C7",
        border: "#FDE68A",
        color: "#92400E",
        dot: "#F59E0B"
      };
    }
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

    const filtered = this.cars.filter(c => {
      // 1. Group filter
      if (groupFilter !== "ทั้งหมด" && groupFilter !== "All") {
        const cg = (c.car_group || "").toLowerCase();
        if (!cg.includes(groupFilter.toLowerCase())) return false;
      }

      // 2. Brand filter
      if (brandFilter !== "ทั้งหมด" && brandFilter !== "All") {
        if ((c.brand || "").toLowerCase() !== brandFilter.toLowerCase()) return false;
      }

      // 3. Company filter
      if (companyFilter !== "ทั้งหมด" && companyFilter !== "All") {
        if ((c.company || "").trim() !== companyFilter.trim()) return false;
      }

      // 4. Status filter (matching app.py exactly)
      if (statusFilter.startsWith("ว่างไม่มีการจอง") || statusFilter.startsWith("Vacant without Bookings")) {
        if (c.fleet_status_key !== "available") return false;
      } else if (statusFilter.startsWith("มีการจองล่วงหน้าไว้") || statusFilter.startsWith("Booked in Advance")) {
        if (c.fleet_status_key !== "reserved") return false;
      } else if (statusFilter.startsWith("ไม่ว่างในวันที่เลือก") || statusFilter.startsWith("Unavailable on Dates")) {
        if (c.fleet_status_key !== "unavailable") return false;
      } else if (statusFilter.startsWith("สถานะซ่อมบำรุง") || statusFilter === "ซ่อมบำรุง" || statusFilter.startsWith("Maintenance")) {
        if (c.fleet_status_key !== "maintenance") return false;
      } else if (statusFilter.startsWith("ว่างพร้อมใช้งาน") || statusFilter.startsWith("Available for Service")) {
        if (c.fleet_status_key !== "available" && c.fleet_status_key !== "reserved") return false;
      } else if (statusFilter === "กำลังเช่า" || statusFilter === "Currently Renting") {
        if (c.status !== "กำลังเช่า" && c.fleet_status_key !== "unavailable") return false;
      } else if (statusFilter === "ติดจอง" || statusFilter === "Reserved") {
        if (c.status !== "ติดจอง" && c.fleet_status_key !== "reserved") return false;
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
      const availCount = filtered.filter(c => c.fleet_status_key === "available" || c.fleet_status_key === "reserved").length;
      countTxt.textContent = isEn
        ? `Available vehicles ready for service: ${availCount} / ${filtered.length} cars`
        : `พบรถว่างพร้อมให้บริการ: ${availCount} / ${filtered.length} คัน`;
    }

    if (filtered.length === 0) {
      container.innerHTML = isEn
        ? `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748B;">🔍 No vehicles found matching the selected criteria</div>`
        : `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#64748B;">🔍 ไม่พบรถยนต์ตามเงื่อนไขที่เลือก</div>`;
      return;
    }

    container.innerHTML = filtered.map((c, idx) => {
      const isAvail = c.fleet_status_key === "available" || c.fleet_status_key === "reserved";
      const autoType = dur.days >= 30 ? (isEn ? "Monthly" : "รายเดือน") : (dur.days >= 7 ? (isEn ? "Weekly" : "รายสัปดาห์") : (isEn ? "Daily" : "รายวัน"));
      const { basePrice, priceDay, priceWeek, priceMonth } = this.calculateCarRentalPrice(c, dur.days, autoType);
      const defImg = "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500";
      const carImg = c.image || defImg;
      const safePlate = String(c.plate || "").replace(/'/g, "\\'");
      const safeId = String(c.plate || "").replace(/[^a-zA-Z0-9]/g, "_");

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

      // 2. Thai License Plate Badge
      const { plateNo, province, isRed } = this.formatPlateDisplay(c.plate);
      const plateHtml = isRed
        ? `<div class="thai-plate-badge red-plate">
             <div class="thai-plate-num">${isEn ? "Red Plate" : "ป้ายแดง"}</div>
             <div class="thai-plate-prov">${isEn ? "Red plate" : "Red plate"}</div>
           </div>`
        : `<div class="thai-plate-badge">
             <div class="thai-plate-num">${plateNo}</div>
             <div class="thai-plate-prov">${province}</div>
           </div>`;

      // 3. Status Pill
      let statusText = isEn ? "Available" : "ว่างไม่มีการจอง";
      let statusBg = "#ECFDF5", statusBorder = "#A7F3D0", statusColor = "#065F46", statusDot = "#10B981";
      if (c.fleet_status_key === "reserved") {
        statusText = isEn ? "Reserved" : "ติดจอง";
        statusBg = "#FEFCE8"; statusBorder = "#FEF08A"; statusColor = "#A16207"; statusDot = "#F59E0B";
      } else if (c.fleet_status_key === "maintenance") {
        statusText = isEn ? "Workshop" : "ซ่อมบำรุง";
        statusBg = "#FFF7ED"; statusBorder = "#FED7AA"; statusColor = "#9A3412"; statusDot = "#F97316";
      } else if (c.fleet_status_key === "unavailable" || c.status === "กำลังเช่า") {
        statusText = isEn ? "On rent" : "กำลังเช่า";
        statusBg = "#EFF6FF"; statusBorder = "#BFDBFE"; statusColor = "#1E40AF"; statusDot = "#3B82F6";
      }

      // 4. Expiry Alert Pill (Insurance, ACT, Tax)
      const alertInfo = this.getCarExpiryAlert(c, isEn);
      const alertPillHtml = alertInfo
        ? `<span class="car-pill" style="background:${alertInfo.bg}; border:1px solid ${alertInfo.border}; color:${alertInfo.color};">
             <span class="car-pill-dot" style="background:${alertInfo.dot};"></span> ${alertInfo.text}
           </span>`
        : "";

      const carSpecsSub = `${c.reg_year || c.year || '2024'} · ${String(c.color || 'WHITE').toUpperCase()} · ${c.fuel_type || 'Petrol'}`;

      return `
        <div class="car-card-modern">
          <!-- MISSION 1: หน้าการ์ด (CARD FRONT) -->
          <div class="car-top-row">
            <div class="car-code-group">
              <div class="car-code-title">${carCode}</div>
              <div class="car-cat-subtag">${catTag}</div>
            </div>
            ${plateHtml}
          </div>

          <div class="car-model-title">${c.brand || ''} ${c.model || ''}</div>
          <div class="car-specs-subtitle">${carSpecsSub}</div>

          <div class="car-pills-row">
            <span class="car-pill" style="background:${statusBg}; border:1px solid ${statusBorder}; color:${statusColor};">
              <span class="car-pill-dot" style="background:${statusDot};"></span> ${statusText}
            </span>
            ${alertPillHtml}
          </div>

          <!-- MISSION 2: ซ่อนรูปภาพและข้อมูลเชิงลึกใน EXPANDER (100% DATASET RETENTION) -->
          <button type="button" class="car-expander-toggle-btn" onclick="app.toggleCarExpander('${safePlate}')">
            <span>${isEn ? '🔍 View Image & Details' : '🔍 ดูรูปรถและข้อมูลเพิ่มเติม'}</span>
            <span id="exp-arrow-${safeId}">▼</span>
          </button>

          <div id="exp-panel-${safeId}" class="car-expander-content">
            <!-- 1. Vehicle Photo -->
            <div class="car-expander-img-box">
              <img src="${carImg}" alt="${c.brand} ${c.model}" onerror="this.src='${defImg}'">
              <button type="button" onclick="app.triggerCarPhotoUpload('${safePlate}')" class="btn btn-sm" style="position:absolute; bottom:8px; right:8px; background:rgba(255,255,255,0.92); border:1px solid #CBD5E1; border-radius:20px; padding:3px 10px; font-size:11px; font-weight:700; cursor:pointer;">
                📸 ${isEn ? 'Upload Photo' : 'อัปโหลดรูป'}
              </button>
            </div>

            <!-- 2. ข้อมูลกรมธรรม์ประกันภัย -->
            <div class="car-exp-section">
              <div class="car-exp-section-title">🛡️ ${isEn ? 'Insurance Policy' : 'ข้อมูลกรมธรรม์ประกันภัย'}</div>
              <div class="car-exp-grid">
                <div><b>${isEn ? 'Company:' : 'ยี่ห้อ/บริษัท:'}</b> ${c.insurance_brand || c.ins_company || '-'}</div>
                <div><b>${isEn ? 'Premium:' : 'เบี้ยประกัน:'}</b> ${c.insurance_premium ? Number(c.insurance_premium).toLocaleString() + ' ฿' : '-'}</div>
                <div><b>${isEn ? 'Coverage:' : 'ทุนประกัน:'}</b> ${c.insurance_coverage ? Number(c.insurance_coverage).toLocaleString() + ' ฿' : '-'}</div>
                <div><b>${isEn ? 'Start:' : 'วันเริ่ม:'}</b> ${c.ins_start_date || '-'}</div>
                <div><b>${isEn ? 'Expiry:' : 'วันหมดอายุ:'}</b> <span style="color:#DC2626; font-weight:700;">${c.ins_expiry || '-'}</span></div>
              </div>
            </div>

            <!-- 3. ข้อมูล พ.ร.บ. และภาษี -->
            <div class="car-exp-section">
              <div class="car-exp-section-title">📄 ${isEn ? 'ACT & Tax Registration' : 'ข้อมูล พ.ร.บ. และภาษี'}</div>
              <div class="car-exp-grid">
                <div><b>${isEn ? 'ACT Brand:' : 'ยี่ห้อ พ.ร.บ.:'}</b> ${c.act_brand || '-'}</div>
                <div><b>${isEn ? 'ACT Price:' : 'ราคา พ.ร.บ.:'}</b> ${c.act_price ? Number(c.act_price).toLocaleString() + ' ฿' : '-'}</div>
                <div><b>${isEn ? 'ACT Expiry:' : 'หมดอายุ พ.ร.บ.:'}</b> <span style="color:#DC2626; font-weight:700;">${c.act_expiry || '-'}</span></div>
                <div><b>${isEn ? 'Tax Year:' : 'ปีภาษี:'}</b> ${c.tax_year || '-'}</div>
                <div><b>${isEn ? 'Tax Expiry:' : 'หมดอายุภาษี:'}</b> <span style="color:#DC2626; font-weight:700;">${c.tax_expiry || '-'}</span></div>
              </div>
            </div>

            <!-- 4. ข้อมูลสัญญาเช่าซื้อ / ลิสซิ่ง (HP / Leasing) -->
            <div class="car-exp-section">
              <div class="car-exp-section-title">💳 ${isEn ? 'Hire Purchase / Leasing' : 'ข้อมูลสัญญาเช่าซื้อ / ลิสซิ่ง (HP / Leasing)'}</div>
              <div class="car-exp-grid">
                <div><b>${isEn ? 'Contract No:' : 'เลขที่สัญญา:'}</b> ${c.leasing_contract || c.hp_contract_no || '-'}</div>
                <div><b>${isEn ? 'Installment/Mo:' : 'ค่างวด/เดือน:'}</b> ${(c.leasing_installment_amount || c.hp_installment) ? Number(c.leasing_installment_amount || c.hp_installment).toLocaleString() + ' ฿' : '-'}</div>
                <div><b>${isEn ? 'Total Terms:' : 'จำนวนงวด:'}</b> ${c.leasing_total_installments || '-'} ${isEn ? 'terms' : 'งวด'}</div>
                <div><b>${isEn ? 'Current Term:' : 'งวดปัจจุบัน:'}</b> ${c.leasing_current_installment || '-'}</div>
                <div><b>${isEn ? 'Last Paid:' : 'ชำระล่าสุด:'}</b> ${c.leasing_last_payment_date || '-'}</div>
              </div>
            </div>

            <!-- 5. ข้อมูลตัวรถเชิงลึก -->
            <div class="car-exp-section">
              <div class="car-exp-section-title">🚘 ${isEn ? 'Vehicle Specifications' : 'ข้อมูลตัวรถเชิงลึก'}</div>
              <div class="car-exp-grid">
                <div><b>${isEn ? 'Plate:' : 'ทะเบียน:'}</b> ${c.plate}</div>
                <div><b>${isEn ? 'Mileage:' : 'เลขไมล์:'}</b> ${Number(String(c.mileage || '0').replace(/,/g, '')).toLocaleString()} km</div>
                <div><b>${isEn ? 'Engine No:' : 'เลขเครื่อง:'}</b> ${c.engine_no || '-'}</div>
                <div><b>${isEn ? 'VIN (Chassis):' : 'เลขตัวถัง:'}</b> ${c.chassis_no || '-'}</div>
                <div><b>${isEn ? 'Engine CC:' : 'ขนาด CC:'}</b> ${c.engine_cc || '1500'} cc</div>
                <div><b>${isEn ? 'Fuel:' : 'เชื้อเพลิง:'}</b> ${c.fuel_type || 'Gasoline'}</div>
                <div><b>${isEn ? 'Ownership:' : 'กรรมสิทธิ์:'}</b> ${c.company || c.owner || 'Sawasdee'}</div>
                <div><b>${isEn ? 'Manager:' : 'ผู้ดูแล:'}</b> ${c.manager || '-'}</div>
              </div>
            </div>

            <!-- 6. อัตราค่าเช่าที่ตั้งไว้ -->
            <div class="car-exp-section">
              <div class="car-exp-section-title">💰 ${isEn ? 'Rental Pricing Rates' : 'อัตราค่าเช่าที่ตั้งไว้'}</div>
              <div class="car-exp-grid">
                <div><b>${isEn ? 'Daily:' : 'รายวัน:'}</b> ฿${priceDay.toLocaleString()}/d</div>
                <div><b>${isEn ? 'Weekly:' : 'รายสัปดาห์:'}</b> ฿${priceWeek.toLocaleString()}/w</div>
                <div><b>${isEn ? 'Monthly:' : 'รายเดือน:'}</b> ฿${priceMonth.toLocaleString()}/m</div>
                <div><b>${isEn ? `Rental (${dur.days}d):` : `คำนวณ (${dur.days} วัน):`}</b> <b style="color:#E85826;">฿${basePrice.toLocaleString()}</b></div>
              </div>
            </div>

            <!-- 7. ปุ่ม Action ต่างๆ -->
            <div style="display:flex; gap:6px; margin-top:10px; flex-wrap:wrap;">
              <button onclick="app.openBookModal('${safePlate}')" class="btn btn-sm ${isAvail ? 'btn-primary' : 'btn-secondary'}" style="flex:1; min-width:130px;" ${!isAvail ? `title="${isEn ? 'This vehicle is reserved, but you can inspect details or queue up' : 'รถคันนี้ติดจอง แต่สามารถคลิกดูรายละเอียดหรือจองคิวต่อได้'}"` : ''}>
                ${isAvail ? (isEn ? '⚡ Book Now' : '⚡ สร้างสัญญาเช่า / จอง') : (isEn ? '📅 Reserve Queue' : '📅 จองคิว')}
              </button>
              <button type="button" onclick="app.openNewMaintenanceModal('${safePlate}')" class="btn btn-sm" style="padding:4px 8px; font-size:11px; background:#FFF7ED; border:1px solid #FDBA74; color:#C2410C; border-radius:6px; font-weight:700; cursor:pointer;" title="${isEn ? 'Report maintenance / Issue renewal order' : 'แจ้งซ่อมบำรุง / ออกใบงานต่อทะเบียน-ประกัน'}">
                🛠️ ${isEn ? 'Maintenance' : 'ซ่อมบำรุง'}
              </button>
              <button type="button" onclick="app.openEditCarModal('${safePlate}')" class="btn btn-sm btn-secondary" style="padding:4px 8px; font-size:11px; background:#FAF7F2; border:1px solid #D1D5DB; color:#374151; border-radius:6px;" title="${isEn ? 'Edit car details & photo' : 'แก้ไขรายละเอียดรถและรูปรถ'}">
                ✏️ ${isEn ? 'Edit' : 'แก้ไข'}
              </button>
              <button type="button" onclick="app.deleteCarByPlate('${safePlate}')" class="btn btn-sm btn-danger" style="padding:4px 8px; font-size:11px; background:#FEE2E2; border:1px solid #FCA5A5; color:#DC2626; border-radius:6px; cursor:pointer;" title="${isEn ? 'Delete this car from system' : 'ลบข้อมูลรถยนต์คันนี้ออกจากระบบ'}">
                🗑️ ${isEn ? 'Delete' : 'ลบ'}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");
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

  openEditCarModal(plate) {
    const isEn = (this.currentLang === "EN");
    const isNew = !plate;
    const car = (!isNew && this.cars.find(c => c.plate === plate)) || {};
    const defImg = "https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&q=80&w=500";

    const titleEl = document.getElementById("modal-edit-car-title");
    if (titleEl) {
      if (isEn) {
        titleEl.textContent = isNew
          ? "➕ Add New Vehicle to Fleet"
          : `✏️ Edit Vehicle Details & Photo (${plate})`;
      } else {
        titleEl.textContent = isNew
          ? "➕ เพิ่มรถยนต์ใหม่เข้าสู่ระบบ (Add New Vehicle)"
          : `✏️ แก้ไขข้อมูลรถยนต์ & อัปโหลดรูปรถ (${plate})`;
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
      delBtn.innerHTML = isEn ? "🗑️ Delete This Vehicle" : "🗑️ ลบข้อมูลรถยนต์คันนี้";
    }

    const cancelBtn = document.getElementById("btn-modal-car-cancel");
    if (cancelBtn) cancelBtn.textContent = isEn ? "Cancel" : "ยกเลิก";
    const saveBtn = document.getElementById("btn-submit-edit-car");
    if (saveBtn) saveBtn.textContent = isEn ? "💾 Save Vehicle Data" : "💾 บันทึกข้อมูลรถยนต์";

    const plateEl = document.getElementById("edit-car-plate");
    if (plateEl) {
      plateEl.value = car.plate || "";
      plateEl.readOnly = false;
      plateEl.style.background = "#FFFFFF";
    }

    const previewEl = document.getElementById("edit-car-img-preview");
    if (previewEl) previewEl.src = car.image || defImg;

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
    setVal("edit-car-fuel", car.fuel_type || "เบนซิน");
    setVal("edit-car-cc", car.engine_cc || "1200");
    setVal("edit-car-company", car.company || "บจก.สวัสดี เรนทัล (Sawasdee Rental)");
    setVal("edit-car-color", car.color || "");
    setVal("edit-car-mileage", car.mileage || "15,000");
    setVal("edit-car-pday", car.price_day !== undefined ? car.price_day : 1000);
    setVal("edit-car-pweek", car.price_week !== undefined ? car.price_week : 6000);
    setVal("edit-car-pmonth", car.price_month !== undefined ? car.price_month : 20000);
    setVal("edit-car-vin", car.chassis_no || "-");
    setVal("edit-car-tax", car.tax_expiry || "-");
    setVal("edit-car-act", car.act_expiry || "-");
    setVal("edit-car-ins", car.ins_expiry || "-");
    setVal("edit-car-ins-comp", car.ins_company || "-");
    setVal("edit-car-owner", car.owner || "-");
    setVal("edit-car-beneficiary", car.beneficiary || car.company || "-");
    setVal("edit-car-reg-year", car.reg_year || "-");
    setVal("edit-car-last-srv", car.last_service_date || "-");
    setVal("edit-car-next-srv", car.next_service || "-");
    setVal("edit-car-notes", car.notes || "");
    setVal("edit-car-status", car.status || "ว่างพร้อมใช้งาน");

    this.openModal("modal-edit-car");
  }

  async onEditCarModalPhotoSelected(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append("file", file);

    try {
      this.showToast(`⏳ กำลังอัปโหลดรูปภาพ ${file.name}...`, "info");
      const res = await fetch("/api/upload-photo", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success && data.url) {
        const previewEl = document.getElementById("edit-car-img-preview");
        const urlEl = document.getElementById("edit-car-image-url");
        if (previewEl) previewEl.src = data.url;
        if (urlEl) urlEl.value = data.url;
        this.showToast("📸 อัปโหลดรูปภาพสำเร็จ! กดบันทึกข้อมูลรถยนต์เพื่อยืนยัน", "success");
      } else {
        this.showToast("❌ อัปโหลดรูปไม่สำเร็จ", "danger");
      }
    } catch (e) {
      this.showToast("❌ อัปโหลดรูปไม่สำเร็จ: " + e.message, "danger");
    }
  }

  async submitEditCar() {
    const origPlate = (document.getElementById("edit-car-original-plate")?.value || "").trim();
    const plate = (document.getElementById("edit-car-plate")?.value || "").trim();
    const brand = (document.getElementById("edit-car-brand")?.value || "").trim();
    const model = (document.getElementById("edit-car-model")?.value || "").trim();
    if (!plate) {
      this.showToast("⚠️ กรุณาระบุเลขทะเบียนรถ", "warning");
      return;
    }
    if (!brand || !model) {
      this.showToast("⚠️ กรุณาระบุยี่ห้อและรุ่นรถยนต์", "warning");
      return;
    }

    if (this.checkDuplicatePlate(plate)) {
      alert(`⚠️ ไม่สามารถบันทึกได้!\nเลขทะเบียนรถ '${plate}' ซ้ำกับรถคันอื่นที่มีอยู่ในระบบแล้ว กรุณาตรวจสอบและแก้ไขเลขทะเบียน`);
      this.showToast(`⚠️ เลขทะเบียนรถ '${plate}' ซ้ำกับรถคันอื่นในระบบแล้ว`, "danger");
      const plateEl = document.getElementById("edit-car-plate");
      if (plateEl) {
        plateEl.focus();
        plateEl.select();
      }
      return;
    }

    const vinVal = (document.getElementById("edit-car-vin")?.value || "-").trim();
    if (this.checkDuplicateChassis(vinVal)) {
      alert(`⚠️ ไม่สามารถบันทึกได้!\nเลขตัวถัง (VIN) '${vinVal}' ซ้ำกับรถคันอื่นที่มีอยู่ในระบบแล้ว กรุณาตรวจสอบอีกครั้ง`);
      this.showToast(`⚠️ เลขตัวถัง (VIN) '${vinVal}' ซ้ำกับรถคันอื่นในระบบแล้ว`, "danger");
      const vinEl = document.getElementById("edit-car-vin");
      if (vinEl) {
        vinEl.focus();
        vinEl.select();
      }
      return;
    }

    const existing = this.cars.find(c => c.plate === (origPlate || plate)) || {};
    const imgUrl = (document.getElementById("edit-car-image-url")?.value || "").trim() || existing.image || "";

    const payload = {
      original_plate: origPlate,
      plate: plate,
      brand: brand,
      model: model,
      car_group: document.getElementById("edit-car-group")?.value || "รถเก๋ง (Sedan/Hatchback)",
      fuel_type: document.getElementById("edit-car-fuel")?.value || "เบนซิน",
      engine_cc: (document.getElementById("edit-car-cc")?.value || "1200").trim(),
      company: (document.getElementById("edit-car-company")?.value || "Sawasdee Rent A Car").trim(),
      color: (document.getElementById("edit-car-color")?.value || "-").trim(),
      mileage: (document.getElementById("edit-car-mileage")?.value || "0").trim(),
      price_day: parseInt(document.getElementById("edit-car-pday")?.value || "1000", 10),
      price_week: parseInt(document.getElementById("edit-car-pweek")?.value || "6000", 10),
      price_month: parseInt(document.getElementById("edit-car-pmonth")?.value || "20000", 10),
      chassis_no: vinVal,
      tax_expiry: (document.getElementById("edit-car-tax")?.value || "-").trim(),
      act_expiry: (document.getElementById("edit-car-act")?.value || "-").trim(),
      ins_expiry: (document.getElementById("edit-car-ins")?.value || "-").trim(),
      ins_company: (document.getElementById("edit-car-ins-comp")?.value || "-").trim(),
      owner: (document.getElementById("edit-car-owner")?.value || "-").trim(),
      beneficiary: (document.getElementById("edit-car-beneficiary")?.value || "-").trim(),
      reg_year: (document.getElementById("edit-car-reg-year")?.value || "-").trim(),
      last_service_date: (document.getElementById("edit-car-last-srv")?.value || "-").trim(),
      next_service: (document.getElementById("edit-car-next-srv")?.value || "-").trim(),
      notes: (document.getElementById("edit-car-notes")?.value || "").trim(),
      status: document.getElementById("edit-car-status")?.value || "ว่างพร้อมใช้งาน",
      image: imgUrl
    };

    try {
      const res = await fetch("/api/cars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
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
        this.showToast(`✅ บันทึกข้อมูลรถยนต์ทะเบียน ${plate} เรียบร้อยแล้ว!`, "success");
        await this.loadCars();
      } else {
        this.showToast("❌ บันทึกไม่สำเร็จ: " + (data.detail || "เกิดข้อผิดพลาด"), "danger");
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
    const car = this.cars.find(c => c.plate === plate);
    if (!car) return;

    document.getElementById("book-car-plate").value = plate;
    const thNow = this.getThaiDateTime(0);
    const thNext3 = this.getThaiDateTime(3);
    let fSDate = document.getElementById("filter-start-date")?.value || thNow.date;
    const fSTime = document.getElementById("filter-start-time")?.value || thNow.time;
    let fEDate = document.getElementById("filter-end-date")?.value || thNext3.date;
    const fETime = document.getElementById("filter-end-time")?.value || thNow.time;

    // Prevent backdated contracts: start date must not be before today
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

    document.getElementById("book-discount-input").value = 0;
    this.recalcBookingModalFromDates(true);

    this.populateCustomerDropdowns(this.lastAddedCustomerName || null);
    this.openModal("modal-book-car");
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
            <span style="font-size:13.5px; font-weight:700; color:#1E293B;">🗓️ จำนวนวันเช่ารวม:</span>
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

    // 2. Render Top Car Preview Box (Screenshots 2 & 3: แสดงราคาตรงตามข้อมูลที่ลงไว้)
    const preview = document.getElementById("book-car-preview");
    if (preview) {
      const activeStyle = "background:#FFFBEB; color:#B45309; border:1.5px solid #F59E0B; font-weight:800;";
      const inactiveStyle = "background:#F1F5F9; color:#475569; border:1px solid #E2E8F0;";

      preview.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
          <div>
            <b style="font-size:15px; color:#1E293B;">${car.brand || ''} ${car.model || ''}</b> | ทะเบียน: <b style="color:#D97706;">${car.plate}</b><br/>
            <span style="font-size:12px; color:#64748B;">🏷️ กลุ่ม: ${car.car_group || 'รถยนต์'} | ⛽ ${car.fuel_type || 'เบนซิน'} | 🏢 ${car.company || '-'}</span>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; color:#64748B; margin-bottom:3px;">💰 อัตราค่าเช่าที่ตั้งค่าไว้:</div>
            <div style="display:flex; gap:4px; font-size:11.5px; justify-content:flex-end; flex-wrap:wrap;">
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายวัน' ? activeStyle : inactiveStyle}">฿${priceDay.toLocaleString()}/วัน</span>
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายสัปดาห์' ? activeStyle : inactiveStyle}">฿${priceWeek.toLocaleString()}/สัปดาห์</span>
              <span style="padding:2px 7px; border-radius:6px; ${cType === 'รายเดือน' ? activeStyle : inactiveStyle}">฿${priceMonth.toLocaleString()}/เดือน</span>
            </div>
          </div>
        </div>
        <div style="margin-top:7px; padding-top:6px; border-top:1px dashed #E2E8F0; font-size:12px; color:#475569;">
          💡 <b>คำนวณราคาประเภท ${cType}:</b> <span style="color:#D97706; font-weight:700;">${breakdownText}</span>
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

    // 1. Populate amount & payment method
    const amtEl = document.getElementById("deposit-amount-input");
    if (amtEl) amtEl.value = b.deposit_amount || 5000;
    const methEl = document.getElementById("deposit-method-input");
    if (methEl && b.deposit_method) {
      methEl.value = b.deposit_method;
    }

    // 2. Populate ref number
    const refEl = document.getElementById("deposit-ref-input");
    if (refEl) {
      refEl.value = b.deposit_ref || b.rental_ref || "";
    }

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
      <div style="font-size:13px; line-height:1.6;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
          <div>
            <b style="color:#92400E; font-size:14px;">${isEn ? 'ID' : 'รหัส'}: ${b.booking_id}</b> | ${isEn ? 'Plate' : 'ทะเบียน'}: <b>${b.car_id}</b><br/>
            👤 ${isEn ? 'Customer' : 'ลูกค้า'}: <b>${b.customer}</b> (📞 ${b.customer_phone || '-'})<br/>
            📅 ${isEn ? 'Duration' : 'ระยะเวลา'}: ${b.start_date_formatted || b.start_date} ${isEn ? 'to' : 'ถึง'} ${b.end_date_formatted || b.end_date}<br/>
            💰 ${isEn ? 'Net Rental' : 'ค่าเช่าสุทธิ'}: <b style="color:#D97706; font-size:15px;">฿${netP.toLocaleString()}</b> |
            🛡️ ${isEn ? 'Deposit' : 'มัดจำ'}: <b style="color:${isDep ? '#059669' : '#DC2626'};">${isDep ? (isEn ? 'Paid' : 'ชำระแล้ว') : (isEn ? 'Pending Deposit' : 'รอมัดจำ')}</b>
          </div>
          ${b.deposit_slip ? `
            <div>
              <a href="${b.deposit_slip}" target="_blank" title="${isEn ? 'Click to view full slip' : 'คลิกดูสลิปขนาดเต็ม'}">
                <img src="${b.deposit_slip}" alt="Slip" style="width:58px; height:58px; object-fit:cover; border-radius:6px; border:2px solid #CBD5E1; box-shadow:0 1px 3px rgba(0,0,0,0.1); cursor:pointer;">
              </a>
            </div>
          ` : ''}
        </div>
        ${slipBadges.length > 0 ? `
          <div style="margin-top:8px; padding-top:8px; border-top:1px dashed #FCD34D; display:flex; flex-wrap:wrap; gap:14px; align-items:center;">
            ${slipBadges.join("")}
          </div>
        ` : ''}
      </div>
    `;

    if (btnSaveSlip) btnSaveSlip.style.display = isDep ? "inline-flex" : "none";
    if (btnSettle) btnSettle.style.display = (!isRent && isDep) ? "inline-flex" : "none";
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
    const alsoRent = document.getElementById("deposit-also-rent").checked;

    try {
      this.showToast(`⏳ กำลังบันทึกรับเงินมัดจำ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deposit_amount: depAmt,
          payment_method: depMethod,
          payment_ref: depRef,
          slip_url: slipUrl,
          also_pay_rental: alsoRent
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ บันทึกรับเงินมัดจำ ${bkId} เรียบร้อย! กำลังพาไปหน้าออกใบงานส่ง/รับรถ...`, "success");
        await this.loadBookings();
        await this.loadCars();
        this.onSelectDepositBooking();
        await this.goToTabWithBooking("assign", bkId);
      } else {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async submitSettle() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depMethod = document.getElementById("deposit-method-input").value;
    const depRef = (document.getElementById("deposit-ref-input")?.value || "").trim();
    const slipUrl = (document.getElementById("deposit-slip-url")?.value || "").trim();

    try {
      this.showToast(`⏳ กำลังบันทึกชำระค่าเช่าคงเหลือ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_method: depMethod,
          payment_ref: depRef,
          slip_url: slipUrl
        })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🎉 บันทึกชำระค่าเช่าคงเหลือ ${bkId} ครบถ้วน!`, "success");
        await this.loadBookings();
        this.onSelectDepositBooking();
      } else {
        throw new Error(data.detail || "บันทึกไม่สำเร็จ");
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async submitUpdateSlipOnly() {
    if (!this.currentSelectedBooking) return;
    const bkId = this.currentSelectedBooking.booking_id;
    const depRef = (document.getElementById("deposit-ref-input")?.value || "").trim();
    const slipUrl = (document.getElementById("deposit-slip-url")?.value || "").trim();

    try {
      this.showToast(`⏳ กำลังอัปเดตสลิปและเลข Ref สำหรับ ${bkId}...`, "info");
      const res = await fetch(`/api/bookings/${bkId}/payment-slip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_ref: depRef,
          slip_url: slipUrl
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
        } else {
          html += `
            <div style="background:#EFF6FF; border:1px solid #93C5FD; border-radius:8px; padding:8px 12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
              <div style="font-size:12.5px; color:#1E40AF;">⏳ <b>${isEn ? 'Pending Rental Fee on Pick-up:' : 'รอชำระค่าเช่าวันรับรถ:'}</b> ฿${netP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
              <button type="button" onclick="app.goToTabWithBooking('deposit', '${b.booking_id}')" class="btn btn-secondary" style="padding:4px 10px; font-size:12px; font-weight:700;">💳 ${isEn ? 'Pay Rental Fee' : 'กดจ่ายเงินค่าเช่า'}</button>
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
    const b = this.bookings.find(x => x.booking_id === bkId);
    if (b) {
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

  async submitAssign(jobType, actionType = "prepare") {
    const isDisp = jobType === "Dispatch";
    const bkId = document.getElementById(isDisp ? "assign-disp-bk" : "assign-ret-bk").value;
    const worker = document.getElementById(isDisp ? "assign-disp-worker" : "assign-ret-worker").value;
    const loc = document.getElementById(isDisp ? "assign-disp-loc" : "assign-ret-loc").value;
    const tVal = document.getElementById(isDisp ? "assign-disp-time" : "assign-ret-time").value;
    const sDate = (isDisp ? document.getElementById("assign-disp-date")?.value : null) || document.getElementById(isDisp ? "assign-disp-start-date" : "assign-ret-start-date")?.value || "";
    const eDate = (!isDisp ? document.getElementById("assign-ret-date")?.value : null) || document.getElementById(isDisp ? "assign-disp-end-date" : "assign-ret-end-date")?.value || "";

    const thNow = this.getThaiDateTime(0);
    if (isDisp && sDate && sDate < thNow.dateStr && actionType !== "handover") {
      if (!confirm(`⚠️ วันที่ส่งมอบ (${sDate}) เป็นวันย้อนหลังก่อนวันปัจจุบัน (${thNow.dateStr})\nคุณต้องการดำเนินการต่อหรือไม่?`)) {
        return;
      }
    }

    try {
      const res = await fetch(`/api/bookings/${bkId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_type: jobType,
          action_type: actionType === "handover" ? "handover_now" : (actionType === "complete" ? "complete_now" : "assign"),
          worker: worker,
          location: loc,
          time: tVal,
          start_date: sDate,
          end_date: eDate
        })
      });
      const data = await res.json();
      if (data.success) {
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
          const nextSideLabel = isDisp ? "ออกใบงานรับรถคืน (ฝั่งขวา)" : "ออกใบงานส่งรถ (ฝั่งซ้าย)";
          this.showToast(`✅ บันทึกเตรียมนัดหมาย ${isDisp ? 'ส่งรถ' : 'รับรถคืน'} (${data.booking?.status || 'เตรียมส่งมอบ'}) เรียบร้อย! (กรุณากดยืนยัน ${nextSideLabel} ต่อ)`, "success");
        }
      }
    } catch (e) {
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
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
            ${['รอส่งมอบ', 'เตรียมส่งมอบ'].includes(b.status) ? `
            <button type="button" onclick="app.quickConfirmHandover('${b.booking_id}')" class="btn btn-success btn-sm" style="font-size:11.5px; padding:4px 10px; font-weight:600;" title="${isEn ? 'Handed vehicle over to customer ➔ Update status to Renting' : 'ส่งมอบรถให้ลูกค้าแล้ว ➔ ปรับสถานะเป็น กำลังเช่า'}">
              🚚 ${isEn ? 'Handed Over (Renting) ➔' : 'ส่งมอบรถแล้ว (กำลังเช่า) ➔'}
            </button>` : ''}
            ${['กำลังเช่า', 'เตรียมรับคืน'].includes(b.status) ? `
            <button type="button" onclick="app.quickConfirmReturn('${b.booking_id}')" class="btn btn-warning btn-sm" style="font-size:11.5px; padding:4px 10px; font-weight:600; color:#1E293B;" title="${isEn ? 'Customer returned vehicle ➔ Update status to Completed' : 'ลูกค้านำรถมาคืนแล้ว ➔ ปรับสถานะเป็น เสร็จสิ้น'}">
              🏁 ${isEn ? 'Returned (Completed) ➔' : 'รับคืนแล้ว (เสร็จสิ้น) ➔'}
            </button>` : ''}
          </div>
        </div>
      `;
    }

    // Financial
    const netP = parseFloat(b.net_price || 0);
    const depAmt = parseFloat(b.deposit_amount || 5000);
    const isDep = !!b.deposit_paid;
    const isRent = !!b.rental_paid;
    const remP = isRent ? 0 : parseFloat(b.remaining_rental || netP);

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
        : `<span style="color:#E85826;">฿${remP.toLocaleString('th-TH', {minimumFractionDigits: 2})}</span>`;
    }

    // Status pill
    const pill = document.getElementById("contract-issued-status-pill");
    if (pill) {
      if (b.contract_issued) {
        pill.innerHTML = `
          <span class="badge badge-success" style="font-size:13px; padding:6px 14px;">
            ✅ ${isEn ? 'Contract Issued' : 'ออกสัญญาเรียบร้อยแล้ว'}
          </span>
        `;
      } else {
        pill.innerHTML = `
          <button onclick="app.markContractIssued()" class="btn btn-success">
            ✅ ${isEn ? 'Confirm Contract Issued' : 'ยืนยันออกสัญญาเรียบร้อย'}
          </button>
        `;
      }
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
      else alert("เกิดข้อผิดพลาด: " + e.message);
    }
  }

  async quickConfirmHandover(bkId) {
    if (!bkId) return;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    const carPlate = b ? b.car_id : "";
    const custName = b ? b.customer : "";
    
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
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
  }

  async quickConfirmReturn(bkId) {
    if (!bkId) return;
    const b = (this.bookings || []).find(x => x.booking_id === bkId);
    const carPlate = b ? b.car_id : "";
    const custName = b ? b.customer : "";

    if (!confirm(`🏁 ยืนยันการรับคืนรถ ${carPlate} จากคุณ ${custName} เรียบร้อยแล้ว?\n\nระบบจะปรับสถานะรายการจองเป็น "เสร็จสิ้น" และปล่อยรถคันนี้กลับมา "ว่างพร้อมใช้งาน" ทันที`)) {
      return;
    }

    try {
      const res = await fetch(`/api/bookings/${bkId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "เสร็จสิ้น" })
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`🏁 รับคืนรถ ${carPlate} เรียบร้อย! สถานะเป็น "เสร็จสิ้น" และรถว่างพร้อมใช้งานแล้ว 🎉`, "success");
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
      this.showToast("เกิดข้อผิดพลาด: " + e.message, "danger");
    }
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
      }
    } catch (e) {
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
    this.showToast(`📝 กำลังดาวน์โหลดสัญญาเช่า PDF สำหรับ ${id}...`, "info");
    window.open(`/api/pdf/contract/${encodeURIComponent(id)}?t=${Date.now()}`, "_blank");
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

  // --- Walk-in Direct Contract Formulation Logic ---
  populateWalkinDropdowns() {
    // 1. Car select
    const carSel = document.getElementById("walkin-car-select");
    if (carSel) {
      const curVal = carSel.value;
      const opts = this.cars.map(c => {
        const { priceDay, priceWeek, priceMonth } = this.getCarRates(c);
        return `<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''} (฿${priceDay.toLocaleString()}/ว | ฿${priceWeek.toLocaleString()}/ส | ฿${priceMonth.toLocaleString()}/ด)</option>`;
      }).join("");
      carSel.innerHTML = '<option value="">-- เลือกรถยนต์จากฝูงรถ --</option>' + opts;
      if (curVal) carSel.value = curVal;
    }

    // 2. Customer select
    const custSel = document.getElementById("walkin-cust-select");
    if (custSel) {
      const curVal = custSel.value;
      const opts = this.customers.map(c => 
        `<option value="${c.full_name}">${c.full_name} (📞 ${c.contact_no || '-'})</option>`
      ).join("");
      custSel.innerHTML = '<option value="">-- เลือกลูกค้าผู้เช่า --</option>' + opts;
      if (curVal) custSel.value = curVal;
    }

    // 3. Worker select
    const workerSel = document.getElementById("walkin-worker-select");
    if (workerSel) {
      const curVal = workerSel.value;
      const approved = this.users.filter(u => u.status === "approved");
      const opts = approved.map(u => `<option value="${u.username}">${u.name || u.username} (${u.role})</option>`).join("");
      workerSel.innerHTML = opts || `<option value="admin">ผู้ดูแลระบบ (admin)</option>`;
      if (curVal) workerSel.value = curVal;
    }

    // 4. Default dates & times in Thailand timezone if empty
    const sDate = document.getElementById("walkin-start-date");
    const eDate = document.getElementById("walkin-end-date");
    const sTime = document.getElementById("walkin-start-time");
    const eTime = document.getElementById("walkin-end-time");
    const thNow = this.getThaiDateTime(0);
    const thNext3 = this.getThaiDateTime(3);
    if (sDate) {
      if (!sDate.value || sDate.value < thNow.dateStr) sDate.value = thNow.dateStr;
      sDate.min = thNow.dateStr;
    }
    if (eDate) {
      if (!eDate.value || eDate.value < (sDate?.value || thNow.dateStr)) eDate.value = thNext3.dateStr;
      eDate.min = (sDate?.value || thNow.dateStr);
    }
    if (sTime && !sTime.value) sTime.value = thNow.timeStr;
    if (eTime && !eTime.value) eTime.value = thNow.timeStr;

    this.recalcWalkinPrice(true);
  }

  calcWalkinDuration() {
    const isEn = (this.currentLang === "EN");
    const thNow = this.getThaiDateTime(0);
    const sDate = document.getElementById("walkin-start-date")?.value;
    const sTime = document.getElementById("walkin-start-time")?.value || thNow.timeStr;
    const eDate = document.getElementById("walkin-end-date")?.value;
    const eTime = document.getElementById("walkin-end-time")?.value || thNow.timeStr;

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
        ? `${baseDays} Days + Overtime ${extraHours} hrs ${remMins} mins (Over 4 hrs counted as 1 day ➔ Total ${billableDays} Days)`
        : `${baseDays} วัน + เกินเวลา ${extraHours} ชม. ${remMins} น. (เกิน 4 ชม. ปรับเป็น 1 วัน ➔ คิด ${billableDays} วัน)`;
    } else if (extraHours > 0 || remMins > 0) {
      desc = isEn
        ? `${baseDays} Days + Extra ${extraHours} hrs ${remMins} mins (≤ 4 hrs ➔ Total ${billableDays} Days)`
        : `${baseDays} วัน + เศษ ${extraHours} ชม. ${remMins} น. (ไม่เกิน 4 ชม. ➔ คิด ${billableDays} วัน)`;
    } else {
      desc = isEn ? `${baseDays} Days (Exact)` : `${baseDays} วัน (พอดี)`;
    }
    if (billableDays < 1) billableDays = 1;

    return { days: billableDays, text: desc };
  }

  recalcWalkinPrice(fromDateChange = false) {
    const isEn = (this.currentLang === "EN");
    const thNow = this.getThaiDateTime(0);
    const sDateInput = document.getElementById("walkin-start-date");
    const eDateInput = document.getElementById("walkin-end-date");
    if (sDateInput) {
      if (!sDateInput.min) sDateInput.min = thNow.dateStr;
      if (sDateInput.value && sDateInput.value < thNow.dateStr) {
        sDateInput.value = thNow.dateStr;
      }
    }
    if (eDateInput && sDateInput) {
      eDateInput.min = sDateInput.value || thNow.dateStr;
      if (eDateInput.value && eDateInput.value < sDateInput.value) {
        eDateInput.value = sDateInput.value;
      }
    }

    const carSel = document.getElementById("walkin-car-select");
    const carPlate = carSel?.value;
    const car = this.cars.find(c => c.plate === carPlate) || {};
    const discInput = document.getElementById("walkin-discount");
    const summaryBox = document.getElementById("walkin-price-summary");
    const discount = discInput ? parseFloat(discInput.value || 0) : 0;

    const dur = this.calcWalkinDuration();
    const cTypeEl = document.getElementById("walkin-contract-type");

    if (fromDateChange && cTypeEl) {
      if (dur.days >= 30) cTypeEl.value = isEn ? "Monthly" : "รายเดือน";
      else if (dur.days >= 7) cTypeEl.value = isEn ? "Weekly" : "รายสัปดาห์";
      else cTypeEl.value = isEn ? "Daily" : "รายวัน";
    }

    const cType = cTypeEl?.value || (isEn ? "Daily" : "รายวัน");
    const { basePrice, breakdownText } = this.calculateCarRentalPrice(car, dur.days, cType);
    const netPrice = Math.max(0, basePrice - discount);

    if (summaryBox) {
      summaryBox.innerHTML = `
        <div style="line-height:1.7;">
          ⏱️ <b>${isEn ? 'Calculated Duration:' : 'ระยะเวลาคำนวณ:'}</b> <span style="color:#D97706; font-weight:700;">${dur.text}</span> (${dur.days} ${isEn ? 'Days' : 'วัน'})<br/>
          💡 <b>${isEn ? 'Price Rate' : 'เรทราคา'} (${cType}):</b> <span style="color:#2563EB;">${breakdownText}</span><br/>
          💰 <b>${isEn ? 'Gross Rental:' : 'ค่าเช่าก่อนลด:'}</b> ฿${basePrice.toLocaleString('th-TH', {minimumFractionDigits: 2})} 
          | 🏷️ <b>${isEn ? 'Discount:' : 'ส่วนลด:'}</b> ฿${discount.toLocaleString('th-TH', {minimumFractionDigits: 2})}<br/>
          💵 <b>${isEn ? 'Net Rental Fee:' : 'ยอดค่าเช่าสุทธิ:'}</b> <b style="color:#B45309; font-size:16px;">฿${netPrice.toLocaleString('th-TH', {minimumFractionDigits: 2})}</b> 
          | 🛡️ <b>${isEn ? 'Security Deposit:' : 'มัดจำประกันสัญญา:'}</b> <b style="color:#059669;">฿5,000.00</b>
        </div>
      `;
    }

    return { basePrice, discount, netPrice, durationDays: dur.days };
  }

  async submitWalkinContract() {
    const thNow = this.getThaiDateTime(0);
    const carId = document.getElementById("walkin-car-select")?.value;
    const cust = document.getElementById("walkin-cust-select")?.value;
    const sDate = document.getElementById("walkin-start-date")?.value;
    const sTime = document.getElementById("walkin-start-time")?.value || thNow.timeStr;
    const eDate = document.getElementById("walkin-end-date")?.value;
    const eTime = document.getElementById("walkin-end-time")?.value || thNow.timeStr;
    const cType = document.getElementById("walkin-contract-type")?.value || "รายวัน";
    const worker = document.getElementById("walkin-worker-select")?.value || "admin";
    const loc = document.getElementById("walkin-loc")?.value || "หน้าร้านสาขา";
    const discount = parseFloat(document.getElementById("walkin-discount")?.value || 0);

    if (!carId) {
      this.showToast("⚠️ กรุณาเลือกรถยนต์สำหรับทำสัญญา", "warning");
      return;
    }
    if (!cust) {
      this.showToast("⚠️ กรุณาเลือกลูกค้าผู้เช่า", "warning");
      return;
    }
    if (!sDate || !eDate) {
      this.showToast("⚠️ กรุณาระบุวันรับรถและวันคืนรถ", "warning");
      return;
    }

    // Validation: prevent backdated contract
    if (sDate < thNow.dateStr) {
      alert(`⚠️ ไม่อนุญาตให้ทำสัญญาหรือจองรถย้อนหลัง!\nวันที่เริ่มต้น (${sDate}) ต้องไม่น้อยกว่าวันนี้ (${thNow.dateStr})`);
      this.showToast(`⚠️ ไม่อนุญาตให้ทำสัญญาย้อนหลัง: วันที่เริ่มต้นต้องเป็น ${thNow.dateStr} ขึ้นไป`, "danger");
      return;
    }
    if (eDate < sDate) {
      alert(`⚠️ วันที่สิ้นสุดสัญญา (${eDate}) ต้องไม่น้อยกว่าวันที่เริ่มต้น (${sDate})`);
      this.showToast(`⚠️ วันที่สิ้นสุดสัญญาต้องไม่น้อยกว่าวันที่เริ่มต้น`, "danger");
      return;
    }

    const { basePrice } = this.recalcWalkinPrice();

    const payload = {
      car_id: carId,
      customer: cust,
      contract_type: cType,
      start_date: sDate,
      end_date: eDate,
      start_time: sTime,
      end_time: eTime,
      base_price: basePrice,
      discount: discount,
      deposit_amount: 5000.0,
      worker_delivery: worker,
      loc_delivery: loc,
      created_by: this.user ? this.user.username : "admin"
    };

    try {
      this.showToast("⏳ กำลังสร้างสัญญาเช่า Walk-in และเตรียมเอกสาร PDF...", "info");
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || "เกิดข้อผิดพลาดในการสร้างสัญญา");
      }
      if (data.success) {
        this.showToast(`🎉 ออกสัญญาเช่า Walk-in ${data.booking_id} เรียบร้อย!`, "success");
        await this.loadBookings();
        await this.loadCars();

        // Select the newly created booking in Tab 4 dropdown
        const contractSel = document.getElementById("contract-sel-bk");
        if (contractSel) {
          contractSel.value = data.booking_id;
          this.onSelectContractBooking();
        }

        // Open official Rental Agreement PDF immediately in new tab
        window.open(`/api/pdf/contract/${data.booking_id}`, "_blank");
      } else {
        this.showToast("❌ สร้างสัญญาไม่สำเร็จ: " + (data.error || "เกิดข้อผิดพลาด"), "danger");
      }
    } catch (e) {
      alert(`❌ สร้างสัญญาไม่สำเร็จ:\n${e.message}`);
      this.showToast("❌ เกิดข้อผิดพลาด: " + e.message, "danger");
    }
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
              ${['รอส่งมอบ', 'เตรียมส่งมอบ'].includes(b.status) ? `
                <button type="button" onclick="app.quickConfirmHandover('${b.booking_id}')" class="btn btn-sm btn-success" style="font-size:11px; padding:2px 8px; white-space:nowrap; border-radius:4px; font-weight:600;" title="${isEn ? 'Handed vehicle over ➔ Update status to Renting' : 'ส่งมอบรถแล้ว ➔ ปรับสถานะเป็น กำลังเช่า'}">
                  🚚 ${isEn ? 'Handed Over' : 'ส่งมอบรถแล้ว'}
                </button>
              ` : ''}
              ${['กำลังเช่า', 'เตรียมรับคืน'].includes(b.status) ? `
                <button type="button" onclick="app.quickConfirmReturn('${b.booking_id}')" class="btn btn-sm btn-warning" style="font-size:11px; padding:2px 8px; white-space:nowrap; color:#1E293B; border-radius:4px; font-weight:600;" title="${isEn ? 'Customer returned vehicle ➔ Update status to Completed' : 'ลูกค้านำรถมาคืนแล้ว ➔ ปรับสถานะเป็น เสร็จสิ้น'}">
                  🏁 ${isEn ? 'Returned' : 'รับคืนแล้ว'}
                </button>
              ` : ''}
            </div>
          </td>
          <td style="text-align:center; white-space:nowrap;">
            ${(b.deposit_slip || b.rental_slip) ? `
              <a href="${b.deposit_slip || b.rental_slip}" target="_blank" class="btn btn-sm btn-secondary" style="background:#EFF6FF; border-color:#93C5FD; color:#1D4ED8; font-weight:700;" title="${isEn ? 'View Payment Slip' : 'ดูสลิปหลักฐานการชำระเงิน'} (Ref: ${b.deposit_ref || b.rental_ref || '-'})">📎 ${isEn ? 'Slip' : 'สลิป'}</a>
            ` : ''}
            <a href="/api/pdf/contract/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Rental Agreement PDF' : 'สัญญาเช่า (Rental Agreement PDF)'}">📝</a>
            <a href="/api/pdf/deposit-receipt/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Deposit Receipt PDF' : 'ใบเสร็จมัดจำ (Deposit Receipt PDF)'}">🛡️</a>
            <a href="/api/pdf/receipt/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Rental Receipt PDF' : 'ใบเสร็จค่าเช่า (Rental Receipt PDF)'}">🧾</a>
            <a href="/api/pdf/job/${b.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Vehicle Checklist PDF' : 'ใบตรวจสภาพรถ (Checklist PDF)'}">📋</a>
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

  // --- Back Office Rendering ---
  renderBackOfficeJobs() {
    const tbody = document.getElementById("backoffice-jobs-tbody");
    if (!tbody) return;

    const boKw = (document.getElementById("bo-search-input")?.value || "").toLowerCase().trim();
    const sbKw = (this.sidebarSearchKw || "").toLowerCase().trim();
    const kw = boKw || sbKw;

    const filtered = this.backofficeJobs.filter(j => {
      if (kw) {
        const s = `${j.booking_id} ${j.car_id} ${j.customer} ${j.job_type} ${j.worker || ''} ${j.location || ''}`.toLowerCase();
        if (!s.includes(kw)) return false;
      }
      return true;
    });

    const isEn = (this.currentLang === "EN");
    if (filtered.length === 0) {
      const emptyMsg = isEn ? "📋 No work orders in the system currently" : "📋 ไม่มีใบงานในระบบขณะนี้";
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#64748B;">${emptyMsg}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(j => {
      const isDisp = j.job_type === "Dispatch";
      const isMnt = j.is_maintenance || j.job_type === "Maintenance" || j.job_type === "Renewal";
      let typeBadge = '';
      if (j.job_type === "Maintenance") {
        typeBadge = `<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-weight:700;">${isEn ? '🛠️ Maintenance' : '🛠️ ซ่อมบำรุง'}</span>`;
      } else if (j.job_type === "Renewal") {
        typeBadge = `<span class="badge" style="background:#F0FDF4; color:#15803D; border:1px solid #BBF7D0; font-weight:700;">${isEn ? '📄 Renewal' : '📄 ต่อทะเบียน/พรบ./ประกัน'}</span>`;
      } else if (isDisp) {
        typeBadge = `<span class="badge badge-info">${isEn ? '🚚 Dispatch' : '🚚 ส่งมอบรถ (Dispatch)'}</span>`;
      } else {
        typeBadge = `<span class="badge badge-warning">${isEn ? '🔙 Return' : '🔙 รับรถคืน (Return)'}</span>`;
      }

      let actionButtons = '';
      if (isMnt) {
        const isRenewalJob = j.job_type === "Renewal" || (j.order_type && (String(j.order_type).includes("ต่อทะเบียน") || String(j.order_type).includes("ประกัน") || String(j.order_type).includes("พ.ร.บ.") || String(j.order_type).includes("ภาษี") || String(j.order_type).includes("แพ็กคู่")));
        const btnLabel = isRenewalJob ? (isEn ? "🏁 Submit / Update" : "🏁 ส่งงาน / อัปเดตวัน") : (isEn ? "🏁 Inspect & Close" : "🏁 ตรวจรับ & ปิดงาน");
        actionButtons = `
          <a href="/api/pdf/maintenance/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Print Job PDF' : 'พิมพ์ใบงาน PDF'}">${isEn ? '📄 Job PDF' : '📄 ใบงาน PDF'}</a>
          <button onclick="app.openCloseMaintenanceModal('${j.booking_id}')" class="btn btn-sm btn-success" style="font-weight:700;" title="${btnLabel}">
            ${btnLabel}
          </button>
        `;
      } else {
        const lockTitle = isEn ? 'Wait for Dispatch completion' : 'ต้องปิดงานส่งมอบก่อน';
        const inspectBtnLabel = isEn ? '🔍 Inspect & Complete' : '🔍 ตรวจรับส่ง & ปิดงาน';
        actionButtons = `
          <a href="/api/pdf/job/${j.booking_id}" target="_blank" class="btn btn-sm btn-secondary" title="${isEn ? 'Inspection PDF' : 'ใบตรวจสภาพ PDF'}">📋</a>
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
    }).join("");
  }

  // --- Modal: Handover Inspection ---
  openHandoverModal(bkId, jobType) {
    document.getElementById("insp-bk-id").value = bkId;
    document.getElementById("insp-job-type").value = jobType;
    document.getElementById("modal-handover-title").textContent = jobType === "Dispatch"
      ? `🚚 ตรวจสภาพและส่งมอบรถ (Dispatch - ${bkId})`
      : `🔙 ตรวจสภาพและรับรถคืน (Return - ${bkId})`;

    this.uploadedPhotos = [];
    document.getElementById("insp-uploaded-photos").innerHTML = "";
    this.openModal("modal-handover");
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

    const payload = {
      fuel_level: fuel,
      mileage: mileage,
      notes: notes,
      photos: this.uploadedPhotos
    };

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
        this.showToast(`🎉 ปิดงาน ${jobType} สำหรับ ${bkId} สมบูรณ์!`, "success");
        await this.loadBackOfficeJobs();
        await this.loadBookings();
        await this.loadCars();
        if (jobType === "Return") await this.loadDashboardKPIs();
      }
    } catch (e) {
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
        👤 <b>${cust.full_name}</b> | 📞 <b>${cust.contact_no || '-'}</b> | 🪪 เลขบัตร/Passport: <b style="color:#2563EB;">${cust.passport_id || '-'}</b> | 🚗 ใบขับขี่: <b>${cust.licence_no || '-'}</b><br/>
        📍 ที่อยู่: <span style="color:#64748B;">${cust.thai_address || cust.home_address || '-'}</span>
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
        👤 <b>${cust.full_name}</b> | 📞 <b>${cust.contact_no || '-'}</b> | 🪪 เลขบัตร/Passport: <b style="color:#2563EB;">${cust.passport_id || '-'}</b> | 🚗 ใบขับขี่: <b>${cust.licence_no || '-'}</b>
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
    document.getElementById("cust-phone-in").value = cust.contact_no !== "-" ? (cust.contact_no || "") : "";
    document.getElementById("cust-pass-in").value = cust.passport_id !== "-" ? (cust.passport_id || "") : "";
    document.getElementById("cust-lic-in").value = cust.licence_no !== "-" ? (cust.licence_no || "") : "";
    document.getElementById("cust-nat-in").value = cust.nationality || "THAI";
    document.getElementById("cust-wa-in").value = cust.whatsapp !== "-" ? (cust.whatsapp || "") : "";
    document.getElementById("cust-dob-in").value = cust.dob || "1990-01-01";
    document.getElementById("cust-licexp-in").value = cust.licence_expiry || "2030-01-01";
    document.getElementById("cust-home-in").value = cust.home_address !== "-" ? (cust.home_address || "") : "";
    document.getElementById("cust-thai-in").value = cust.thai_address !== "-" ? (cust.thai_address || "") : "";

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
    ["cust-name-in", "cust-phone-in", "cust-pass-in", "cust-lic-in", "cust-wa-in", "cust-home-in", "cust-thai-in"].forEach(id => {
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
    if (dobEl) dobEl.value = "1990-01-01";
    const licExpEl = document.getElementById("cust-licexp-in");
    if (licExpEl) licExpEl.value = "2030-01-01";

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

    const payload = {
      full_name: name,
      original_name: origName || name,
      contact_no: phone || "-",
      passport_id: passId || "-",
      licence_no: document.getElementById("cust-lic-in")?.value.trim() || "-",
      nationality: document.getElementById("cust-nat-in")?.value.trim() || "THAI",
      whatsapp: document.getElementById("cust-wa-in")?.value.trim() || "-",
      dob: document.getElementById("cust-dob-in")?.value || "1990-01-01",
      licence_expiry: document.getElementById("cust-licexp-in")?.value || "2030-01-01",
      home_address: document.getElementById("cust-home-in")?.value.trim() || "-",
      thai_address: document.getElementById("cust-thai-in")?.value.trim() || "-"
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
          ${dupCount === 0 ? (isEn ? '🛡️ No Duplicates (0 cars)' : '🛡️ ไม่พบรถซ้ำ (0 คัน)') : (isEn ? `⚠️ Duplicates (${dupCount} cars)` : `⚠️ พบรถซ้ำ (${dupCount} คัน)`)}
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
      tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:28px; color:#64748B;">${isEn ? '🔍 No vehicles found matching the search criteria' : 'ไม่พบข้อมูลรถยนต์ที่ค้นหา'}</td></tr>`;
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
            ${isEn ? '🏁 Submit Renewal' : '🏁 ส่งงานต่ออายุ'}
          </button>
        `;
      } else {
        renewBtnHtml = `
          <button type="button" onclick="app.openRenewalOrderModal('${safePlate}', 'both')" class="btn btn-sm" style="padding:3px 7px; font-size:11px; font-weight:700; background:#FFF7ED; color:#EA580C; border:1px solid #FDBA74;" title="${isEn ? 'Create dual work order for ACT & Insurance' : 'ออกใบงานต่ออายุทั้ง พ.ร.บ. และ ประกันภัย มอบหมายพนักงาน (ขึ้นหน้าตารางงาน)'}">
            ${isEn ? '📋 Dual Order' : '📋 ต่อคู่'}
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
        ? `<div style="font-size:10.5px; color:#0369A1; font-weight:700; margin-top:2px;">🛡️ ${c.ins_company}</div>`
        : "";

      const srvInfo = [];
      if (c.last_service_date && c.last_service_date !== "-") srvInfo.push(`ล่าสุด: ${c.last_service_date}`);
      if (c.next_service && c.next_service !== "-") srvInfo.push(`ถัดไป: ${c.next_service}`);
      const srvHtml = srvInfo.length > 0
        ? `<div style="font-size:10.5px; color:#475569;">🔧 ${srvInfo.join(" | ")}</div>`
        : "";

      const hpBadge = c.hp_contract_no
        ? `<div style="font-size:10.5px; color:#7C3AED; font-weight:700;">🏦 สัญญา: ${c.hp_contract_no}${c.hp_installment ? ` (฿${Number(c.hp_installment).toLocaleString()}/ด.)` : ''}</div>`
        : "";

      const notesShort = c.notes
        ? `<div style="font-size:11px; color:#334155; max-width:210px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${String(c.notes).replace(/"/g, '&quot;')}">${c.notes}</div>`
        : `<span style="color:#94A3B8; font-size:11px;">-</span>`;

      return `
        <tr style="${rowBg} transition: background 0.25s ease;">
          <td style="white-space:nowrap;">
            <b>🚘 ${c.plate}</b>
            ${regYearBadge}
          </td>
          <td>
            <b>${c.brand || ''}</b> ${c.model || ''}
            <div style="font-size:11px; color:#64748B;">🎨 ${c.color || '-'}</div>
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
    try {
      const res = await fetch("/api/hp-leasing");
      if (res.ok) {
        this.hpLeasingData = await res.json();
        this.renderHpLeasingTable();
      }
    } catch (e) {
      console.error("loadHpLeasingData error:", e);
    }
  }

  renderHpLeasingTable() {
    const data = this.hpLeasingData || {};
    const contracts = data.contracts || [];
    const summary = data.summary || {};
    const propIns = data.property_insurance || [];

    const isEn = (this.currentLang === "EN");
    const cardsEl = document.getElementById("hp-leasing-summary-cards");
    if (cardsEl && summary.total_contracts) {
      cardsEl.innerHTML = `
        <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#64748B; font-weight:600;">${isEn ? '📋 Total HP Contracts' : '📋 จำนวนสัญญาเช่าซื้อ'}</div>
          <div style="font-size:18px; font-weight:800; color:#1E293B; margin-top:2px;">${summary.total_contracts} ${isEn ? 'Contracts' : 'สัญญา'}</div>
        </div>
        <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#64748B; font-weight:600;">${isEn ? '💳 Total Monthly Installments' : '💳 ค่างวดต่อเดือนรวม'}</div>
          <div style="font-size:18px; font-weight:800; color:#EA580C; margin-top:2px;">฿${Number(summary.total_monthly_installment || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
        </div>
        <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#64748B; font-weight:600;">${isEn ? '✅ Total Paid Installments' : '✅ ชำระค่างวดแล้วรวม'}</div>
          <div style="font-size:18px; font-weight:800; color:#10B981; margin-top:2px;">฿${Number(summary.total_paid_amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
        </div>
        <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#64748B; font-weight:600;">${isEn ? '⏳ Total Remaining Balance' : '⏳ ยอดคงเหลือผ่อนชำระ'}</div>
          <div style="font-size:18px; font-weight:800; color:#DC2626; margin-top:2px;">฿${Number(summary.total_remaining_amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
        </div>
        <div style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:10px; padding:10px 12px;">
          <div style="font-size:11.5px; color:#64748B; font-weight:600;">${isEn ? '🏦 Total Vehicle Price (Inc. Down)' : '🏦 ราคารถรวมเงินดาวน์'}</div>
          <div style="font-size:18px; font-weight:800; color:#3B82F6; margin-top:2px;">฿${Number(summary.total_car_price || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
        </div>
      `;
    }

    const titleEl = document.getElementById("title-expander-hp");
    if (titleEl) {
      titleEl.textContent = isEn
        ? `Vehicle Installment Plan (HP / Leasing — ${contracts.length} Contracts) & Property Insurance Policies (${propIns.length} Policies)`
        : `ตารางผ่อนชำระค่างวดรถยนต์ (HP / Leasing — ${contracts.length} สัญญา) & กรมธรรม์ประกันภัยทรัพย์สิน (${propIns.length} รายการ)`;
    }

    const hpTbody = document.getElementById("hp-leasing-tbody");
    if (hpTbody) {
      if (contracts.length === 0) {
        hpTbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:30px; color:#64748B;">${isEn ? '💡 No HP/Leasing contract data available in the system... You can add new data to get started.' : '💡 ยังไม่มีข้อมูลสัญญาเช่าซื้อ (HP / Leasing) ในระบบ... คุณสามารถเพิ่มข้อมูลใหม่เพื่อเริ่มต้นใช้งานได้ครับ'}</td></tr>`;
      } else {
        hpTbody.innerHTML = contracts.map(item => `
        <tr>
          <td style="text-align:center; font-weight:700;">${item.no}</td>
          <td><b>${item.model}</b></td>
          <td>
            <div><b>🚘 ${item.plate}</b></div>
            <div style="font-family:monospace; font-size:11px; color:#64748B;">${item.chassis_no || '-'}</div>
          </td>
          <td><span class="badge badge-info">${item.contract_no}</span></td>
          <td>
            <div style="font-size:11.5px; color:#64748B;">📅 ${item.down_payment_date}</div>
            <div style="font-weight:700;">฿${Number(item.down_payment || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</div>
          </td>
          <td>
            <div style="font-size:11.5px;">${isEn ? 'Start:' : 'เริ่ม:'} ${item.first_payment_date}</div>
            <div style="font-size:11px; color:#B45309; font-weight:700;">${item.due_day}</div>
          </td>
          <td style="text-align:right; font-weight:700; color:#EA580C;">฿${Number(item.installment || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
          <td style="text-align:center;">
            <span style="font-weight:700; color:#047857;">${item.paid_months}</span> / ${item.total_months} ${isEn ? 'terms' : 'งวด'}
            <div style="font-size:10.5px; color:#64748B;">(${isEn ? 'left' : 'เหลือ'} ${item.remaining_months} ${isEn ? 'terms' : 'งวด'})</div>
          </td>
          <td style="text-align:right; font-weight:700; color:#059669;">฿${Number(item.paid_amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
          <td style="text-align:right; font-weight:700; color:#DC2626;">฿${Number(item.remaining_amount || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
          <td style="text-align:right; font-weight:700; color:#1E293B;">฿${Number(item.total_car_price || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
        </tr>
      `).join("");
      }
    }

    const propTbody = document.getElementById("property-insurance-tbody");
    if (propTbody) {
      if (propIns.length === 0) {
        propTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#64748B;">${isEn ? '💡 No property insurance policy data available in the system.' : '💡 ยังไม่มีข้อมูลกรมธรรม์ประกันภัยทรัพย์สินในระบบ'}</td></tr>`;
      } else {
        propTbody.innerHTML = propIns.map(p => `
        <tr>
          <td><span class="badge badge-gray">${p.id}</span></td>
          <td><b>${p.title}</b></td>
          <td>${p.owner}</td>
          <td><span style="color:#0369A1; font-weight:700;">🛡️ ${p.ins_company}</span></td>
          <td><b>📅 ${p.expiry_date}</b></td>
          <td style="font-size:12px; color:#475569;">${p.notes || '-'}</td>
        </tr>
      `).join("");
      }
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
    if (!dmyStr || dmyStr === "-") return "";
    const s = String(dmyStr).trim();
    if (s.includes("-")) {
      const parts = s.split("-");
      if (parts[0].length === 4) return s;
      if (parts[2].length === 4) return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    }
    if (s.includes("/")) {
      const parts = s.split("/");
      if (parts.length === 3 && parts[2].length === 4) {
        return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
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
    const canvas = document.getElementById("chart-fleet-status-donut");
    const badge = document.getElementById("donut-total-badge");
    const legend = document.getElementById("fleet-status-legend");
    if (!canvas || typeof Chart === "undefined") return;

    const isEn = (this.currentLang === "EN");
    const totalCars = (this.cars || []).length;
    let availCount = 0;
    let rentCount = 0;
    let bookCount = 0;
    let maintCount = 0;

    (this.cars || []).forEach(c => {
      const st = String(c.status || "").trim();
      const fst = String(c.fleet_status_key || "").trim();
      if (fst === "maintenance" || ["ซ่อมบำรุง", "ส่งซ่อม", "ไม่พร้อมใช้งาน"].includes(st)) {
        maintCount++;
      } else if (["กำลังเช่า", "เช่าอยู่"].includes(st)) {
        rentCount++;
      } else if (["ติดจอง", "จอง", "เตรียมส่งมอบ", "เตรียมรับคืน", "รอส่งมอบ"].includes(st)) {
        bookCount++;
      } else {
        availCount++;
      }
    });

    if (badge) {
      badge.textContent = isEn ? `${totalCars} cars` : `${totalCars} คัน`;
    }

    const dataArr = [availCount, rentCount, bookCount, maintCount];
    const labels = isEn 
      ? ["Available", "Rented", "Reserved", "Maintenance"]
      : ["ว่างพร้อมให้บริการ", "กำลังเช่า", "ติดจอง", "ซ่อมบำรุง"];
    const colors = ["#10B981", "#EF4444", "#F59E0B", "#F97316"]; // เขียว, แดง, เหลือง, ส้ม

    if (this.donutChart) {
      this.donutChart.destroy();
    }

    this.donutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: dataArr,
          backgroundColor: colors,
          borderColor: '#FFFFFF',
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
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
      legend.innerHTML = labels.map((lbl, idx) => {
        const val = dataArr[idx];
        const pct = totalCars > 0 ? ((val / totalCars) * 100).toFixed(1) : "0.0";
        const cDot = colors[idx];
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:12.5px; padding:3px 0;">
            <span><span style="color:${cDot}; font-size:14px; margin-right:6px;">●</span>${lbl}</span>
            <span style="font-weight:700; color:#1F2937;">${val} ${isEn ? 'cars' : 'คัน'} <span style="font-weight:400; color:#6B7280; font-size:11px;">(${pct}%)</span></span>
          </div>
        `;
      }).join("");
    }
  }

  renderTrendChart() {
    const canvas = document.getElementById("chart-revenue-trend");
    if (!canvas || typeof Chart === "undefined") return;

    const isEn = (this.currentLang === "EN");
    const thMonthNames = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const enMonthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthNames = isEn ? enMonthNames : thMonthNames;

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

    const labels = monthBins.map(b => b.label);
    const dataRev = monthBins.map(b => b.rev);
    const dataJobs = monthBins.map(b => b.jobs);

    if (this.trendChart) {
      this.trendChart.destroy();
    }

    const isBar = (this.trendType || "bar") === "bar";

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
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:32px; color:#64748B;">${isEn ? '🔍 No maintenance work orders match the selected filters' : '🔍 ไม่พบรายการใบงานซ่อมบำรุงตามเงื่อนไขที่เลือก'}</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(m => {
      const isRenewal = String(m.order_type || "").includes("ต่อทะเบียน") || String(m.order_type || "").includes("พ.ร.บ.") || String(m.order_type || "").includes("ประกัน");
      let typeBadge = '';
      if (isRenewal) {
        typeBadge = '<span class="badge" style="background:#F0FDF4; color:#15803D; border:1px solid #BBF7D0; font-weight:700;">📄 ' + m.order_type + '</span>';
      } else {
        typeBadge = '<span class="badge" style="background:#FFF7ED; color:#C2410C; border:1px solid #FDBA74; font-weight:700;">🛠️ ' + m.order_type + '</span>';
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

      const pdfBtnText = isEn ? "📄 Work Order PDF" : "📄 ใบงาน PDF";
      const finishBtnText = isRenewal ? (isEn ? '🏁 Submit & Renew' : '🏁 ส่งงาน/อัปเดตวัน') : (isEn ? '🏁 Close Job' : '🏁 ปิดงาน');
      const finishBtnTitle = isRenewal ? (isEn ? 'Submit job & specify new expiry date' : 'ส่งงาน & ระบุวันหมดอายุใหม่') : (isEn ? 'Inspect car & close work order' : 'ตรวจรับรถ & ปิดงาน');

      return `
        <tr>
          <td><b style="color:#C2410C;">${m.id}</b></td>
          <td>
            <b style="font-size:13px; color:#1F2937;">🚘 ${m.car_id}</b><br/>
            <span style="font-size:11.5px; color:#64748B;">${m.car_brand || ''} ${m.car_model || ''} (${m.car_color || '-'})</span>
          </td>
          <td>${typeBadge}</td>
          <td style="max-width:200px; white-space:pre-wrap; font-size:12px; line-height:1.4;">${m.service_items || '-'}</td>
          <td><b style="color:#047857; font-size:13px;">฿${costDisp.toLocaleString()}</b></td>
          <td>
            <b style="color:#1F2937; font-size:12.5px;">🏢 ${m.service_center || '-'}</b><br/>
            ${m.service_center_phone && m.service_center_phone !== '-' ? `<a href="tel:${m.service_center_phone}" style="color:#2563EB; font-size:11.5px; text-decoration:none;">📞 ${m.service_center_phone}</a>` : ''}
          </td>
          <td><span style="font-weight:600; color:#334155; font-size:12px;">👤 ${m.assigned_worker || '-'}</span></td>
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

  openNewMaintenanceModal(targetPlate = null, defaultType = null) {
    const carSel = document.getElementById("mnt-car-select");
    if (carSel) {
      const opts = (this.cars || []).map(c => `<option value="${c.plate}">${c.plate} - ${c.brand || ''} ${c.model || ''} (${c.color || ''}) [${c.status}]</option>`);
      carSel.innerHTML = opts.join("");
      if (targetPlate && this.cars.some(c => c.plate === targetPlate)) {
        carSel.value = targetPlate;
      }
    }

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

    const chosenPlate = targetPlate || (carSel ? carSel.value : (this.cars[0]?.plate || ""));
    this.onMaintenanceCarSelected(chosenPlate);

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

    document.getElementById("mnt-form-id").value = "";
    document.getElementById("mnt-cost").value = "";
    document.getElementById("mnt-notes").value = "";
    document.getElementById("mnt-update-car-status").checked = true;

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
    document.getElementById("mnt-mileage").value = rec.current_mileage || "";
    document.getElementById("mnt-service-center").value = rec.service_center || "";
    document.getElementById("mnt-service-phone").value = rec.service_center_phone || "";
    document.getElementById("mnt-service-loc").value = rec.service_location || "";
    document.getElementById("mnt-assigned-worker").value = rec.assigned_worker || "admin";
    document.getElementById("mnt-sched-date").value = rec.schedule_date || "";
    document.getElementById("mnt-sched-time").value = rec.schedule_time || "09:00";
    document.getElementById("mnt-exp-date").value = rec.expected_finish_date || "";
    document.getElementById("mnt-exp-time").value = rec.expected_finish_time || "17:00";
    document.getElementById("mnt-notes").value = rec.notes || "";
    document.getElementById("mnt-update-car-status").checked = Boolean(rec.update_car_status);
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
    if (!itemArea) return;

    if (typeVal.includes("ต่อทะเบียน") && (!itemArea.value || itemArea.value.includes("น้ำมันเครื่อง"))) {
      itemArea.value = "1. ตรวจสภาพรถยนต์ ตรอ.\n2. ยื่นต่อภาษีประจำปี ณ กรมการขนส่งทางบก\n3. จัดทำ พ.ร.บ. คุ้มครองผู้ประสบภัยจากรถ";
      if (garageInput && !garageInput.value) {
        garageInput.value = "สำนักงานขนส่งกรุงเทพมหานครพื้นที่ 5 (จตุจักร) / ตรอ.วิภาวดี";
      }
    } else if (typeVal.includes("ประกัน") && (!itemArea.value || itemArea.value.includes("น้ำมันเครื่อง"))) {
      itemArea.value = "1. ตรวจสอบเบี้ยประกันภัยรถยนต์ประจำปี\n2. ต่ออายุความคุ้มครองกรมธรรม์ประกันภัยรถยนต์ (ชั้น 1)";
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
    const actWrapper = document.getElementById("close-mnt-act-wrapper");
    const insWrapper = document.getElementById("close-mnt-ins-wrapper");
    const submitBtn = document.getElementById("close-mnt-submit-btn");

    if (isRenewal) {
      if (renewalSec) renewalSec.style.display = "block";
      const hasAct = oType.includes("พ.ร.บ.") || oType.includes("พรบ") || oType.includes("ต่อทะเบียน") || oType.includes("ภาษี") || oType.includes("แพ็กคู่");
      const hasIns = oType.includes("ประกัน") || oType.includes("แพ็กคู่");

      if (actWrapper) actWrapper.style.display = hasAct ? "block" : "none";
      if (insWrapper) insWrapper.style.display = hasIns ? "block" : "none";

      const curAct = car.act_expiry || "-";
      const curIns = car.ins_expiry || "-";
      const actCurrentEl = document.getElementById("close-mnt-act-current");
      const insCurrentEl = document.getElementById("close-mnt-ins-current");
      if (actCurrentEl) actCurrentEl.textContent = `(วันหมดอายุเดิม: ${curAct})`;
      if (insCurrentEl) insCurrentEl.textContent = `(วันหมดอายุเดิม: ${curIns})`;

      // Compute next 1 year default
      const nextActStr = this.computeRenewedDateStr(curAct);
      const nextInsStr = this.computeRenewedDateStr(curIns);

      const actInput = document.getElementById("close-mnt-act-expiry");
      const insInput = document.getElementById("close-mnt-ins-expiry");
      const policyInput = document.getElementById("close-mnt-policy-no");

      if (actInput) actInput.value = this.dmyToYmd(nextActStr);
      if (insInput) insInput.value = this.dmyToYmd(nextInsStr);
      if (policyInput) policyInput.value = rec.policy_no || "";

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

    let newActExpiry = "";
    let newInsExpiry = "";
    let policyNo = "";

    if (isRenewal) {
      const actRaw = document.getElementById("close-mnt-act-expiry")?.value;
      const insRaw = document.getElementById("close-mnt-ins-expiry")?.value;
      policyNo = document.getElementById("close-mnt-policy-no")?.value.trim() || "";

      const actWrapper = document.getElementById("close-mnt-act-wrapper");
      const insWrapper = document.getElementById("close-mnt-ins-wrapper");

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
          new_act_expiry: newActExpiry,
          new_ins_expiry: newInsExpiry,
          policy_no: policyNo,
          recorded_by: this.user?.name || this.user?.username || "Admin"
        })
      });
      const data = await res.json();
      if (data.success) {
        this.closeModal("modal-close-maintenance");
        let successMsg = `🏁 ปิดงาน ${mntId} เรียบร้อย!`;
        if (newActExpiry || newInsExpiry) {
          successMsg = `🏁 ส่งงานสำเร็จ! อัปเดตวันหมดอายุเรียบร้อย ${newActExpiry ? `(พ.ร.บ.: ${newActExpiry})` : ''} ${newInsExpiry ? `(ประกัน: ${newInsExpiry})` : ''}`;
        }
        this.showToast(successMsg, "success");
        await this.loadMaintenanceRecords();
        await this.loadCars();
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
    if (!confirm(`ยืนยันการลบใบงานซ่อมบำรุง ${mntId} ใช่หรือไม่?`)) return;
    try {
      const res = await fetch(`/api/maintenance/${mntId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        this.showToast(`ลบใบงาน ${mntId} เรียบร้อย`, "info");
        await this.loadMaintenanceRecords();
        await this.loadCars();
        await this.loadBackOfficeJobs();
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
      m.classList.add("open");
    }
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove("open");
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

}

// Global App Instance
const app = new App();
window.app = app;
